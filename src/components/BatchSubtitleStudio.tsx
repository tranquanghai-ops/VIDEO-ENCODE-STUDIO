import React, { useState, useEffect, useRef } from 'react';
import type { FFmpeg as FFmpegType } from '@ffmpeg/ffmpeg';
import {
  getVideoDuration,
  calculateChunkPlan,
  extractAndChunkAudio,
  DEFAULT_CHUNK_CONFIG,
  type ExtractedChunk,
  type ChunkPlan
} from '../services/audioExtractor';
import {
  processAudioChunk,
  assembleChunksToSrt,
  type ChunkProcessResult
} from '../services/geminiSubtitle';
import {
  getAvailableFreeModels,
  AUTO_MODEL_ID,
  getModelInfo
} from '../services/modelRegistry';
import { downloadSrtFile } from '../services/srtHelper';
import { downloadAllSrtAsZip } from '../services/zipHelper';

export interface VideoItem {
  id: string;
  file: File;
  url: string;
  duration: number;
  width: number;
  height: number;
  status: string;
}

interface BatchSubtitleStudioProps {
  videos: VideoItem[];
  onAddFiles: (files: FileList | File[]) => Promise<void>;
  onRemoveVideo: (id: string) => void;
  ffmpegLoader: () => Promise<FFmpegType>;
  apiKey: string;
  isConnected: boolean;
  selectedModel: string;
  onModelChange: (model: string) => void;
  onOpenKeyModal: () => void;
  onEmergencyStopEngine: () => void;
}

const LANGUAGES = [
  { code: 'auto', name: 'Tự động nhận diện' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'en', name: 'English' },
  { code: 'zh', name: '中文 (Chinese)' },
  { code: 'ja', name: '日本語 (Japanese)' },
  { code: 'ko', name: '한국어 (Korean)' },
  { code: 'fr', name: 'Français (French)' },
  { code: 'de', name: 'Deutsch (German)' },
  { code: 'es', name: 'Español (Spanish)' },
  { code: 'th', name: 'ไทย (Thai)' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'ru', name: 'Русский (Russian)' }
];

export interface VideoSubtitleState {
  checked: boolean;
  status: 'idle' | 'extracting' | 'processing' | 'done' | 'error' | 'stopped';
  statusText: string;
  progressPercent: number;
  chunkProgress?: string;
  cachedChunks?: ExtractedChunk[];
  chunkResults?: ChunkProcessResult[];
  srtContent?: string;
  errorMessage?: string;
  languageUsed?: string;
  logs?: string[];
}

const formatTime = (seconds: number) => {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

export const BatchSubtitleStudio: React.FC<BatchSubtitleStudioProps> = ({
  videos,
  onAddFiles,
  onRemoveVideo,
  ffmpegLoader,
  apiKey,
  isConnected,
  selectedModel,
  onModelChange,
  onOpenKeyModal,
  onEmergencyStopEngine
}) => {
  // Batch settings
  const [sourceLang, setSourceLang] = useState<string>('auto'); // Mặc định AUTO DETECT
  const [mode, setMode] = useState<'original' | 'translate'>('original');
  const [targetLang, setTargetLang] = useState<string>('vi'); // Mặc định dịch sang Tiếng Việt
  const [sendParts, setSendParts] = useState<1 | 2 | 3 | 4>(1);

  // Per-video subtitle states mapped by video.id
  const [subStates, setSubStates] = useState<Record<string, VideoSubtitleState>>({});
  const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);
  const [previewModal, setPreviewModal] = useState<{ filename: string; srt: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const activeVideoIdRef = useRef<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Synchronize subtitle states whenever videos list changes
  useEffect(() => {
    setSubStates((prev) => {
      const next: Record<string, VideoSubtitleState> = {};
      for (const v of videos) {
        if (prev[v.id]) {
          next[v.id] = prev[v.id];
        } else {
          next[v.id] = {
            checked: true, // Mặc định chọn tất cả video được thêm
            status: 'idle',
            statusText: 'Chờ xử lý',
            progressPercent: 0
          };
        }
      }
      return next;
    });
  }, [videos]);

  const updateVideoSubState = (id: string, patch: Partial<VideoSubtitleState>) => {
    setSubStates((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || { checked: true, status: 'idle', statusText: 'Chờ xử lý', progressPercent: 0 }),
        ...patch
      }
    }));
  };

  const appendLog = (id: string, message: string) => {
    const timestamp = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    setSubStates((prev) => {
      const current = prev[id] || { checked: true, status: 'idle', statusText: 'Chờ xử lý', progressPercent: 0 };
      return {
        ...prev,
        [id]: { ...current, logs: [...(current.logs || []), `[${timestamp}] ${message}`].slice(-80) }
      };
    });
  };

  const ensureNotStopped = (signal: AbortSignal) => {
    if (stopRequestedRef.current || signal.aborted) {
      throw new DOMException('Đã dừng theo yêu cầu.', 'AbortError');
    }
  };

  const toggleCheck = (id: string) => {
    setSubStates((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        checked: !prev[id]?.checked
      }
    }));
  };

  const selectAll = (checked: boolean) => {
    setSubStates((prev) => {
      const next: Record<string, VideoSubtitleState> = {};
      for (const k of Object.keys(prev)) {
        next[k] = { ...prev[k], checked };
      }
      return next;
    });
  };

  // Helper xử lý 1 video
  const processSingleVideo = async (video: VideoItem, signal: AbortSignal, isResume: boolean = false) => {
    const currentState = subStates[video.id];
    let chunks: ExtractedChunk[] = currentState?.cachedChunks || [];
    activeVideoIdRef.current = video.id;
    if (!isResume) updateVideoSubState(video.id, { logs: [] });
    appendLog(video.id, isResume ? 'Bắt đầu thử lại tác vụ.' : 'Bắt đầu tạo phụ đề.');

    try {
      ensureNotStopped(signal);
      // 1. Trích xuất âm thanh và phân đoạn nếu chưa có chunks
      if (!isResume || chunks.length === 0) {
        updateVideoSubState(video.id, {
          status: 'extracting',
          statusText: 'Đang trích xuất audio (FFmpeg WASM)...',
          progressPercent: 10,
          errorMessage: undefined
        });

        appendLog(video.id, 'Đang đọc thời lượng và lập kế hoạch chia đoạn audio.');
        const dur = video.duration > 0 ? video.duration : await getVideoDuration(video.file);
        ensureNotStopped(signal);
        const plans: ChunkPlan[] = calculateChunkPlan(dur, DEFAULT_CHUNK_CONFIG, sendParts);
        appendLog(video.id, sendParts === 1
          ? 'Đã chọn gửi toàn bộ audio trong 1 lượt; đang nạp FFmpeg.'
          : `Đã chia audio thành đúng ${plans.length} phần; đang nạp FFmpeg.`);
        const ffmpeg = await ffmpegLoader();
        ensureNotStopped(signal);
        appendLog(video.id, 'FFmpeg đã sẵn sàng; bắt đầu trích xuất audio.');

        chunks = await extractAndChunkAudio(ffmpeg, video.file, plans, (msg, pct) => {
          if (stopRequestedRef.current || signal.aborted) return;
          updateVideoSubState(video.id, {
            statusText: msg,
            progressPercent: Math.round(pct * 0.3) // 0% - 30%
          });
          appendLog(video.id, msg);
        });

        ensureNotStopped(signal);
        appendLog(video.id, `Đã trích xuất ${chunks.length} đoạn audio.`);
        updateVideoSubState(video.id, { cachedChunks: chunks });
      }

      // 2. Gửi từng chunk lên Gemini với Sequential processing
      updateVideoSubState(video.id, {
        status: 'processing',
        statusText: 'Đang tạo phụ đề AI...',
        progressPercent: 30
      });

      const totalChunks = chunks.length;
      const results: ChunkProcessResult[] = isResume && currentState?.chunkResults ? [...currentState.chunkResults] : [];

      const srcLangObj = LANGUAGES.find((l) => l.code === sourceLang);
      const tgtLangObj = LANGUAGES.find((l) => l.code === targetLang);

      for (let i = 0; i < totalChunks; i++) {
        ensureNotStopped(signal);
        const chunk = chunks[i];

        // Nếu đã có kết quả thành công trước đó thì bỏ qua (resume)
        const existing = results.find((r) => r.chunkId === chunk.id);
        if (existing && existing.status === 'success') {
          continue;
        }

        const chunkIndex = i + 1;
        appendLog(video.id, `Đang gửi đoạn ${chunkIndex}/${totalChunks} tới Gemini.`);
        updateVideoSubState(video.id, {
          statusText: `Đang xử lý đoạn ${chunkIndex}/${totalChunks}...`,
          chunkProgress: `Đoạn ${chunkIndex}/${totalChunks}`,
          progressPercent: 30 + Math.round(((i + 1) / totalChunks) * 65)
        });

        const res = await processAudioChunk(
          chunk,
          {
            sourceLang,
            sourceLangName: srcLangObj?.name || 'Tự động nhận diện',
            mode,
            targetLang,
            targetLangName: tgtLangObj?.name || 'Tiếng Việt',
            modelId: selectedModel,
            apiKey
          },
          apiKey,
          (noticeMsg) => {
            updateVideoSubState(video.id, { statusText: noticeMsg });
            appendLog(video.id, noticeMsg);
          },
          signal
        );
        ensureNotStopped(signal);

        const rIdx = results.findIndex((r) => r.chunkId === chunk.id);
        if (rIdx >= 0) results[rIdx] = res;
        else results.push(res);

        updateVideoSubState(video.id, { chunkResults: [...results] });

        if (res.status === 'error') {
          throw new Error(`Lỗi tại đoạn ${chunkIndex}/${totalChunks}: ${res.errorMessage || 'Gemini không phản hồi'}`);
        }
        appendLog(video.id, `Hoàn thành đoạn ${chunkIndex}/${totalChunks}${res.modelUsed ? ` bằng ${res.modelUsed}` : ''}.`);
      }

      // 3. Hoàn tất đóng gói SRT và dọn dẹp RAM
      ensureNotStopped(signal);
      appendLog(video.id, 'Đang ghép kết quả và đóng gói file SRT.');
      updateVideoSubState(video.id, { statusText: 'Đang hoàn tất đóng gói file SRT...' });
      const srt = assembleChunksToSrt(results, DEFAULT_CHUNK_CONFIG.overlapSeconds);

      const langCode = mode === 'translate' ? targetLang : sourceLang;

      updateVideoSubState(video.id, {
        status: 'done',
        statusText: '✓ Hoàn thành',
        progressPercent: 100,
        srtContent: srt,
        languageUsed: langCode,
        cachedChunks: undefined // Giải phóng audio blobs trong RAM
      });
      appendLog(video.id, 'Hoàn thành file SRT.');
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal.aborted || stopRequestedRef.current) {
        updateVideoSubState(video.id, {
          status: 'stopped',
          statusText: '■ Đã dừng khẩn cấp',
          errorMessage: undefined
        });
        appendLog(video.id, 'Đã dừng khẩn cấp theo yêu cầu của người dùng.');
        return;
      }
      console.error(`[BatchSubtitle] Lỗi xử lý video ${video.file.name}:`, err);
      updateVideoSubState(video.id, {
        status: 'error',
        statusText: '⚠ Lỗi',
        errorMessage: err.message || 'Đã xảy ra lỗi khi tạo phụ đề.'
      });
      appendLog(video.id, `Lỗi: ${err.message || 'Đã xảy ra lỗi khi tạo phụ đề.'}`);
    } finally {
      if (activeVideoIdRef.current === video.id) activeVideoIdRef.current = null;
    }
  };

  // Chạy Batch toàn bộ video được chọn (Sequential - Lần lượt)
  const handleStartBatch = async () => {
    if (!isConnected || !apiKey) {
      onOpenKeyModal();
      return;
    }

    const checkedVideos = videos.filter((v) => subStates[v.id]?.checked);
    if (checkedVideos.length === 0) {
      alert('Vui lòng tích chọn ít nhất 1 video để tạo phụ đề.');
      return;
    }

    stopRequestedRef.current = false;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsBatchRunning(true);

    try {
      // Xử lý LẦN LƯỢT từng video để tối ưu RAM và tránh 429
      for (const video of checkedVideos) {
        if (controller.signal.aborted || stopRequestedRef.current) break;
        // Nếu video đã hoàn thành thì không chạy lại
        if (subStates[video.id]?.status === 'done') continue;
        await processSingleVideo(video, controller.signal, false);
      }
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      setIsBatchRunning(false);
    }
  };

  const handleEmergencyStop = () => {
    if (!isBatchRunning) return;
    stopRequestedRef.current = true;
    const activeId = activeVideoIdRef.current;
    if (activeId) appendLog(activeId, 'Đang thực hiện lệnh dừng khẩn cấp…');
    abortControllerRef.current?.abort();
    onEmergencyStopEngine();
    setIsBatchRunning(false);
  };

  // Thử lại riêng 1 video bị lỗi
  const handleRetrySingle = async (video: VideoItem) => {
    if (!isConnected || !apiKey) {
      onOpenKeyModal();
      return;
    }
    stopRequestedRef.current = false;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsBatchRunning(true);
    try {
      await processSingleVideo(video, controller.signal, true);
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      setIsBatchRunning(false);
    }
  };

  // Tải file SRT đơn lẻ
  const handleDownloadSingleSrt = (video: VideoItem) => {
    const st = subStates[video.id];
    if (!st || !st.srtContent) return;
    const baseName = video.file.name.replace(/\.[^/.]+$/, '');
    const lang = st.languageUsed || (mode === 'translate' ? targetLang : sourceLang);
    const filename = `${baseName}.${lang}.srt`;
    downloadSrtFile(st.srtContent, filename);
  };

  // Tải tất cả file SRT dưới dạng ZIP
  const handleDownloadAllZip = async () => {
    const completedEntries: { filename: string; content: string }[] = [];

    for (const v of videos) {
      const st = subStates[v.id];
      if (st && st.status === 'done' && st.srtContent) {
        const baseName = v.file.name.replace(/\.[^/.]+$/, '');
        const lang = st.languageUsed || (mode === 'translate' ? targetLang : sourceLang);
        completedEntries.push({
          filename: `${baseName}.${lang}.srt`,
          content: st.srtContent
        });
      }
    }

    if (completedEntries.length === 0) return;
    await downloadAllSrtAsZip(completedEntries, 'tat-ca-phu-de-srt.zip');
  };

  const freeModels = getAvailableFreeModels();
  const checkedCount = videos.filter((v) => subStates[v.id]?.checked).length;
  const doneCount = videos.filter((v) => subStates[v.id]?.status === 'done').length;

  return (
    <section style={{
      maxWidth: '1280px',
      margin: '0 auto',
      padding: '1.5rem',
      boxSizing: 'border-box'
    }}>
      {/* 1. Thanh tiêu đề & Cấu hình Batch */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '1.5rem',
        marginBottom: '1.5rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.25rem',
          borderBottom: '1px solid #f1f5f9',
          paddingBottom: '1rem'
        }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: '0 0 0.35rem 0' }}>
              ✨ TẠO PHỤ ĐỀ HÀNG LOẠT (AI SUBTITLE BATCH)
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>
              Dùng chung danh sách video từ Encode Video. Xử lý tuần tự bằng Gemini BYOK cá nhân.
            </p>
          </div>

          {/* Trạng thái kết nối nhanh */}
          <div>
            {!isConnected && (
              <button
                type="button"
                onClick={onOpenKeyModal}
                style={{
                  background: '#1a3c5e',
                  border: 'none',
                  color: '#ffffff',
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                🔑 Kết nối Gemini cá nhân để bắt đầu
              </button>
            )}
          </div>
        </div>

        {/* Thiết lập cấu hình chung cho toàn bộ Batch */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem'
        }}>
          {/* Ngôn ngữ nguồn - MẶC ĐỊNH LÀ TỰ ĐỘNG NHẬN DIỆN */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
              Ngôn ngữ trong video:
            </label>
            <select
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
              disabled={isBatchRunning}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#fff',
                fontSize: '0.88rem'
              }}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name} {l.code === 'auto' ? '(Mặc định)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Chế độ phụ đề */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
              Chế độ phụ đề:
            </label>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', height: '38px' }}>
              <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="batchMode"
                  value="original"
                  checked={mode === 'original'}
                  onChange={() => setMode('original')}
                  disabled={isBatchRunning}
                />
                Phụ đề gốc
              </label>
              <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="batchMode"
                  value="translate"
                  checked={mode === 'translate'}
                  onChange={() => setMode('translate')}
                  disabled={isBatchRunning}
                />
                Dịch phụ đề
              </label>
            </div>
          </div>

          {/* Ngôn ngữ đích khi dịch */}
          {mode === 'translate' && (
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Dịch sang ngôn ngữ đích:
              </label>
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                disabled={isBatchRunning}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  fontSize: '0.88rem'
                }}
              >
                {LANGUAGES.filter((l) => l.code !== 'auto').map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Mô hình Gemini */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
              Mô hình Gemini:
            </label>
            <select
              value={selectedModel}
              onChange={(e) => onModelChange(e.target.value)}
              disabled={isBatchRunning}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#fff',
                fontSize: '0.88rem'
              }}
            >
              <option value={AUTO_MODEL_ID}>Tự động (Khuyến nghị)</option>
              {freeModels.map((m) => (
                <option key={m.modelId} value={m.modelId}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </div>

          {/* Số lượt gửi audio tới Gemini */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
              Cách gửi audio:
            </label>
            <select
              value={sendParts}
              onChange={(e) => setSendParts(Number(e.target.value) as 1 | 2 | 3 | 4)}
              disabled={isBatchRunning}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#fff',
                fontSize: '0.88rem'
              }}
            >
              <option value={1}>Gửi tất cả trong 1 lượt</option>
              <option value={2}>Chia đều thành 2 lượt</option>
              <option value={3}>Chia đều thành 3 lượt</option>
              <option value={4}>Chia đều thành 4 lượt</option>
            </select>
            <small style={{ display: 'block', marginTop: '0.3rem', color: '#64748b', fontSize: '0.72rem', lineHeight: 1.4 }}>
              Nếu một phần lỗi, nút thử lại chỉ gửi lại đúng phần đó.
            </small>
          </div>
        </div>
      </div>

      {/* 2. Thanh thao tác hàng loạt & Thêm video */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.75rem',
        marginBottom: '1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={() => selectAll(true)}
            disabled={isBatchRunning || videos.length === 0}
            style={{
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              padding: '0.4rem 0.8rem',
              borderRadius: '6px',
              fontSize: '0.8rem',
              cursor: isBatchRunning ? 'not-allowed' : 'pointer'
            }}
          >
            Chọn tất cả
          </button>
          <button
            type="button"
            onClick={() => selectAll(false)}
            disabled={isBatchRunning || videos.length === 0}
            style={{
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              padding: '0.4rem 0.8rem',
              borderRadius: '6px',
              fontSize: '0.8rem',
              cursor: isBatchRunning ? 'not-allowed' : 'pointer'
            }}
          >
            Bỏ chọn tất cả
          </button>
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
            {videos.length} video trong hàng đợi ({checkedCount} đã chọn, {doneCount} hoàn tất)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="video/*,.mp4,.mov,.avi,.wmv,.webm,.mkv"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) void onAddFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBatchRunning}
            style={{
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              color: '#334155',
              padding: '0.55rem 1rem',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: isBatchRunning ? 'not-allowed' : 'pointer'
            }}
          >
            + Thêm video
          </button>

          {doneCount >= 2 && (
            <button
              type="button"
              onClick={handleDownloadAllZip}
              style={{
                background: '#0284c7',
                color: '#ffffff',
                border: 'none',
                padding: '0.55rem 1.1rem',
                borderRadius: '8px',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}
            >
              📥 TẢI TẤT CẢ SRT (.ZIP) ({doneCount})
            </button>
          )}

          <button
            type="button"
            onClick={handleStartBatch}
            disabled={isBatchRunning || checkedCount === 0}
            style={{
              background: isBatchRunning || checkedCount === 0 ? '#cbd5e1' : '#10b981',
              color: '#ffffff',
              border: 'none',
              padding: '0.55rem 1.35rem',
              borderRadius: '8px',
              fontSize: '0.88rem',
              fontWeight: 700,
              cursor: isBatchRunning || checkedCount === 0 ? 'not-allowed' : 'pointer',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}
          >
            {isBatchRunning ? 'Đang xử lý tuần tự...' : `TẠO PHỤ ĐỀ CHO ${checkedCount} VIDEO ➔`}
          </button>
          {isBatchRunning && (
            <button
              type="button"
              onClick={handleEmergencyStop}
              style={{
                background: '#b91c1c',
                color: '#ffffff',
                border: 'none',
                padding: '0.55rem 1.15rem',
                borderRadius: '8px',
                fontSize: '0.88rem',
                fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '0 2px 5px rgba(185,28,28,0.25)'
              }}
            >
              ■ DỪNG KHẨN CẤP
            </button>
          )}
        </div>
      </div>

      {/* 3. Danh sách video hoặc Khung Dropzone khi trống */}
      {videos.length === 0 ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files) void onAddFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: isDragging ? '2px dashed #0284c7' : '2px dashed #cbd5e1',
            borderRadius: '12px',
            padding: '3.5rem 2rem',
            textAlign: 'center',
            background: isDragging ? '#f0f9ff' : '#ffffff',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🎬</div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#1e293b', margin: '0 0 0.4rem 0' }}>
            Chưa có video nào trong hàng đợi
          </h3>
          <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0 0 1rem 0' }}>
            Kéo thả video vào đây hoặc chọn từ tab Encode Video. Hai tab dùng chung danh sách tệp.
          </p>
          <button
            type="button"
            style={{
              background: '#1a3c5e',
              color: '#ffffff',
              border: 'none',
              padding: '0.6rem 1.25rem',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 600
            }}
          >
            Chọn video từ thiết bị
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {videos.map((video) => {
            const st = subStates[video.id] || {
              checked: true,
              status: 'idle',
              statusText: 'Chờ xử lý',
              progressPercent: 0
            };

            const isDone = st.status === 'done';
            const isError = st.status === 'error';
            const isStopped = st.status === 'stopped';
            const isWorking = st.status === 'extracting' || st.status === 'processing';
            const failedChunk = st.chunkResults?.find((result) => result.status === 'error');

            return (
              <div
                key={video.id}
                style={{
                  background: '#ffffff',
                  border: isDone ? '1px solid #a7f3d0' : isError ? '1px solid #fecaca' : isStopped ? '1px solid #fcd34d' : '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '1rem',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.03)'
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '0.75rem'
                }}>
                  {/* Tên & Checkbox */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: '240px' }}>
                    <input
                      type="checkbox"
                      checked={st.checked}
                      onChange={() => toggleCheck(video.id)}
                      disabled={isBatchRunning}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <div style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '6px',
                      background: '#f1f5f9',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.1rem'
                    }}>
                      🎬
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9rem', wordBreak: 'break-all' }}>
                        {video.file.name}
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        Thời lượng: {formatTime(video.duration)} · Dung lượng: {(video.file.size / (1024 * 1024)).toFixed(1)} MB
                      </div>
                    </div>
                  </div>

                  {/* Trạng thái & Nút thao tác */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {/* Badge trạng thái */}
                    <span style={{
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      padding: '0.25rem 0.65rem',
                      borderRadius: '20px',
                      background: isDone ? '#dcfce7' : isError ? '#fee2e2' : isStopped ? '#fef3c7' : isWorking ? '#e0f2fe' : '#f1f5f9',
                      color: isDone ? '#15803d' : isError ? '#b91c1c' : isStopped ? '#92400e' : isWorking ? '#0369a1' : '#475569'
                    }}>
                      {st.statusText}
                    </span>

                    {/* Nút Xem & Tải nếu Hoàn thành */}
                    {isDone && (
                      <>
                        <button
                          type="button"
                          onClick={() => setPreviewModal({ filename: video.file.name, srt: st.srtContent || '' })}
                          style={{
                            background: '#f8fafc',
                            border: '1px solid #cbd5e1',
                            color: '#334155',
                            padding: '0.35rem 0.75rem',
                            borderRadius: '6px',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          👁️ Xem SRT
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadSingleSrt(video)}
                          style={{
                            background: '#10b981',
                            border: 'none',
                            color: '#ffffff',
                            padding: '0.35rem 0.75rem',
                            borderRadius: '6px',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          📥 Tải SRT
                        </button>
                      </>
                    )}

                    {/* Nút Thử lại nếu Lỗi */}
                    {isError && (
                      <button
                        type="button"
                        onClick={() => handleRetrySingle(video)}
                        disabled={isBatchRunning}
                        style={{
                          background: '#f59e0b',
                          border: 'none',
                          color: '#ffffff',
                          padding: '0.35rem 0.75rem',
                          borderRadius: '6px',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          cursor: isBatchRunning ? 'not-allowed' : 'pointer'
                        }}
                      >
                        🔄 {failedChunk ? `Thử lại phần ${failedChunk.index}/${failedChunk.total}` : 'Thử lại'}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onRemoveVideo(video.id)}
                      disabled={isBatchRunning}
                      title="Xóa khỏi danh sách"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#94a3b8',
                        cursor: isBatchRunning ? 'not-allowed' : 'pointer',
                        fontSize: '1.1rem',
                        padding: '0.2rem 0.4rem'
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Thanh tiến trình riêng từng video */}
                {isWorking && (
                  <div style={{ marginTop: '0.65rem' }}>
                    <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${st.progressPercent}%`,
                          height: '100%',
                          background: '#0284c7',
                          transition: 'width 0.3s ease'
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Thông báo lỗi chi tiết nếu có */}
                {isError && st.errorMessage && (
                  <div style={{
                    marginTop: '0.5rem',
                    fontSize: '0.78rem',
                    color: '#b91c1c',
                    background: '#fef2f2',
                    padding: '0.35rem 0.65rem',
                    borderRadius: '4px'
                  }}>
                    {st.errorMessage}
                  </div>
                )}

                {!!st.logs?.length && (
                  <details open={isWorking} style={{ marginTop: '0.65rem' }}>
                    <summary style={{ cursor: 'pointer', color: '#475569', fontSize: '0.78rem', fontWeight: 700 }}>
                      Nhật ký tiến trình ({st.logs.length})
                    </summary>
                    <div style={{
                      marginTop: '0.45rem',
                      maxHeight: '150px',
                      overflowY: 'auto',
                      padding: '0.55rem 0.7rem',
                      borderRadius: '6px',
                      background: '#0f172a',
                      color: '#dbeafe',
                      fontFamily: 'Consolas, "Courier New", monospace',
                      fontSize: '0.72rem',
                      lineHeight: 1.55
                    }}>
                      {st.logs.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 4. Modal xem trước phụ đề SRT */}
      {previewModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(4px)',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            padding: '1.75rem',
            maxWidth: '640px',
            width: '100%',
            boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
            boxSizing: 'border-box'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
                Xem trước phụ đề: {previewModal.filename}
              </h3>
              <button
                type="button"
                onClick={() => setPreviewModal(null)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <textarea
              readOnly
              value={previewModal.srt}
              rows={14}
              style={{
                width: '100%',
                fontFamily: 'monospace',
                fontSize: '0.82rem',
                padding: '0.75rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#334155',
                boxSizing: 'border-box',
                whiteSpace: 'pre',
                lineHeight: 1.4,
                marginBottom: '1rem'
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setPreviewModal(null)}
                style={{
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  color: '#475569',
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Đóng
              </button>
              <button
                type="button"
                onClick={() => {
                  const baseName = previewModal.filename.replace(/\.[^/.]+$/, '');
                  downloadSrtFile(previewModal.srt, `${baseName}.srt`);
                }}
                style={{
                  background: '#10b981',
                  border: 'none',
                  color: '#ffffff',
                  padding: '0.5rem 1.25rem',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                📥 Tải file .SRT này
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

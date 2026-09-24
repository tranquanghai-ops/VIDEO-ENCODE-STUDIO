import React, { useState, useEffect } from 'react';
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
  getStoredApiKey,
  saveStoredApiKey,
  clearStoredApiKey,
  validateGeminiApiKey,
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

interface SubtitleGeneratorProps {
  ffmpegLoader: () => Promise<FFmpegType>;
  selectedVideoFile?: File;
}

const LANGUAGES = [
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'auto', name: 'Tự động nhận diện' },
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

export const SubtitleGenerator: React.FC<SubtitleGeneratorProps> = ({
  ffmpegLoader,
  selectedVideoFile
}) => {
  // Key state & Storage
  const [apiKey, setApiKey] = useState<string>('');
  const [keyStorageType, setKeyStorageType] = useState<'session' | 'local' | 'none'>('none');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [userEmail, setUserEmail] = useState<string>('');

  // Modal State
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [inputKey, setInputKey] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [rememberOption, setRememberOption] = useState<boolean>(false);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string>('');

  // Model & Language Configuration
  const [selectedModel, setSelectedModel] = useState<string>(AUTO_MODEL_ID);
  const [sourceLang, setSourceLang] = useState<string>('vi');
  const [mode, setMode] = useState<'original' | 'translate'>('translate');
  const [targetLang, setTargetLang] = useState<string>('en');

  // Processing & Chunk States
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [currentChunkInfo, setCurrentChunkInfo] = useState<{ index: number; total: number } | null>(null);
  const [chunkResults, setChunkResults] = useState<ChunkProcessResult[]>([]);
  const [cachedChunks, setCachedChunks] = useState<ExtractedChunk[]>([]);
  const [srtResult, setSrtResult] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Tự động nạp key đã lưu và thông tin Portal Auth
  useEffect(() => {
    const stored = getStoredApiKey();
    if (stored.key) {
      setApiKey(stored.key);
      setKeyStorageType(stored.type);
      setIsConnected(true);
    }

    // Đọc email người dùng từ Portal Auth Guard nếu có
    const checkUser = () => {
      const w = window as any;
      if (w.__tdtu_user_email) {
        setUserEmail(w.__tdtu_user_email);
      } else if (w.__tdtu_user?.email) {
        setUserEmail(w.__tdtu_user.email);
      }
    };
    checkUser();
    window.addEventListener('tdtu-user-change', checkUser);
    return () => window.removeEventListener('tdtu-user-change', checkUser);
  }, []);

  // Xử lý mở Modal kết nối
  const handleOpenKeyModal = () => {
    setInputKey(apiKey);
    setRememberOption(keyStorageType === 'local');
    setModalError('');
    setShowKeyModal(true);
  };

  // Xử lý kiểm tra và kết nối API Key
  const handleConnectKey = async () => {
    const clean = inputKey.trim();
    if (!clean) {
      setModalError('Vui lòng nhập Gemini API Key.');
      return;
    }

    setIsValidating(true);
    setModalError('');

    try {
      const res = await validateGeminiApiKey(clean);
      if (res.success) {
        saveStoredApiKey(clean, rememberOption);
        setApiKey(clean);
        setKeyStorageType(rememberOption ? 'local' : 'session');
        setIsConnected(true);
        setShowKeyModal(false);
      } else {
        setModalError(res.message);
      }
    } catch (err: any) {
      setModalError('Không thể xác thực: ' + (err.message || 'Lỗi mạng'));
    } finally {
      setIsValidating(false);
    }
  };

  // Xử lý ngắt kết nối
  const handleDisconnectKey = () => {
    clearStoredApiKey();
    setApiKey('');
    setKeyStorageType('none');
    setIsConnected(false);
    setChunkResults([]);
    setCachedChunks([]);
  };

  // Bắt đầu quy trình tạo phụ đề AI
  const handleStartSubtitle = async (retryOnlyErrors = false) => {
    if (!selectedVideoFile) {
      setErrorMessage('Vui lòng chọn hoặc kéo thả một video trước khi thực hiện.');
      return;
    }
    if (!apiKey) {
      handleOpenKeyModal();
      return;
    }

    setErrorMessage('');
    setIsProcessing(true);

    try {
      let chunksToProcess: ExtractedChunk[] = cachedChunks;

      // Nếu chưa có cache audio chunks hoặc không phải chỉ retry lỗi: thực hiện extract & chunk
      if (!retryOnlyErrors || cachedChunks.length === 0) {
        setStatusMessage('Đang phân tích thời lượng video...');
        setProgressPercent(5);

        const duration = await getVideoDuration(selectedVideoFile);
        const plans: ChunkPlan[] = calculateChunkPlan(duration, DEFAULT_CHUNK_CONFIG);

        setStatusMessage('Đang khởi động bộ giải mã FFmpeg WASM...');
        const ffmpeg = await ffmpegLoader();

        chunksToProcess = await extractAndChunkAudio(
          ffmpeg,
          selectedVideoFile,
          plans,
          (msg, pct) => {
            setStatusMessage(msg);
            setProgressPercent(pct);
          }
        );
        setCachedChunks(chunksToProcess);
      }

      // Xử lý từng chunk với Gemini API
      const total = chunksToProcess.length;
      const updatedResults: ChunkProcessResult[] = retryOnlyErrors ? [...chunkResults] : [];

      for (let i = 0; i < total; i++) {
        const chunk = chunksToProcess[i];

        // Nếu chỉ retry lỗi và chunk này đã thành công trước đó thì bỏ qua
        if (retryOnlyErrors) {
          const existing = chunkResults.find((r) => r.chunkId === chunk.id);
          if (existing && existing.status === 'success') {
            continue;
          }
        }

        setCurrentChunkInfo({ index: chunk.index, total: chunk.total });
        setStatusMessage(`Đang xử lý đoạn ${chunk.index}/${chunk.total}...`);
        const pct = Math.round(((i + 1) / total) * 100);
        setProgressPercent(pct);

        const srcLangObj = LANGUAGES.find((l) => l.code === sourceLang);
        const tgtLangObj = LANGUAGES.find((l) => l.code === targetLang);

        const result = await processAudioChunk(
          chunk,
          {
            sourceLang,
            sourceLangName: srcLangObj?.name || sourceLang,
            mode,
            targetLang,
            targetLangName: tgtLangObj?.name || targetLang,
            modelId: selectedModel,
            apiKey
          },
          apiKey,
          (noticeMsg) => setStatusMessage(noticeMsg)
        );

        // Cập nhật kết quả chunk
        const existingIdx = updatedResults.findIndex((r) => r.chunkId === chunk.id);
        if (existingIdx >= 0) {
          updatedResults[existingIdx] = result;
        } else {
          updatedResults.push(result);
        }
        setChunkResults([...updatedResults]);
      }

      // Kiểm tra xem có chunk nào bị lỗi không
      const failedChunks = updatedResults.filter((r) => r.status === 'error');
      if (failedChunks.length > 0) {
        setErrorMessage(
          `Có ${failedChunks.length}/${total} đoạn bị lỗi (429 hoặc kết nối). Kết quả các đoạn thành công đã được giữ lại.`
        );
        setStatusMessage('Quá trình tạm dừng do có đoạn bị lỗi.');
      } else {
        setStatusMessage('Đang ghép nối và đóng gói phụ đề SRT...');
        const srt = assembleChunksToSrt(updatedResults, DEFAULT_CHUNK_CONFIG.overlapSeconds);
        setSrtResult(srt);
        setStatusMessage('Hoàn tất tạo phụ đề AI!');
        setProgressPercent(100);
      }
    } catch (err: any) {
      console.error('[SubtitleGenerator] Lỗi quy trình:', err);
      setErrorMessage(err.message || 'Đã xảy ra lỗi trong quá trình xử lý.');
    } finally {
      setIsProcessing(false);
      setCurrentChunkInfo(null);
    }
  };

  const handleDownload = () => {
    if (!srtResult || !selectedVideoFile) return;
    const baseName = selectedVideoFile.name.replace(/\.[^/.]+$/, '');
    const langSuffix = mode === 'translate' ? targetLang : sourceLang;
    const filename = `${baseName}.${langSuffix}.srt`;
    downloadSrtFile(srtResult, filename);
  };

  const freeModels = getAvailableFreeModels();
  const currentModelDetails = getModelInfo(selectedModel);
  const hasFailedChunks = chunkResults.some((r) => r.status === 'error');

  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '12px',
      padding: '1.5rem',
      marginTop: '1.5rem',
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
    }}>
      {/* 1. Tiêu đề & Trạng thái kết nối Gemini BYOK */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1.25rem',
        flexWrap: 'wrap',
        gap: '0.75rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.4rem' }}>✨</span>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
            TẠO PHỤ ĐỀ AI
          </h3>
        </div>

        {/* Khối trạng thái kết nối */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {isConnected ? (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              background: '#ecfdf5',
              color: '#065f46',
              border: '1px solid #a7f3d0',
              borderRadius: '20px',
              padding: '0.35rem 0.85rem',
              fontSize: '0.8rem',
              fontWeight: 600
            }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              Gemini cá nhân: Đã kết nối
              <span style={{ opacity: 0.7, fontWeight: 400, fontSize: '0.75rem' }}>
                ({keyStorageType === 'local' ? 'Đã ghi nhớ' : 'Phiên làm việc'})
              </span>
            </div>
          ) : (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              background: '#f8fafc',
              color: '#64748b',
              border: '1px solid #cbd5e1',
              borderRadius: '20px',
              padding: '0.35rem 0.85rem',
              fontSize: '0.8rem',
              fontWeight: 600
            }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#94a3b8', display: 'inline-block' }} />
              Chưa kết nối Gemini cá nhân
            </div>
          )}

          {isConnected ? (
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                onClick={handleOpenKeyModal}
                disabled={isProcessing}
                style={{
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  color: '#334155',
                  padding: '0.35rem 0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: isProcessing ? 'not-allowed' : 'pointer'
                }}
              >
                Đổi key
              </button>
              <button
                onClick={handleDisconnectKey}
                disabled={isProcessing}
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#b91c1c',
                  padding: '0.35rem 0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: isProcessing ? 'not-allowed' : 'pointer'
                }}
              >
                Ngắt kết nối
              </button>
            </div>
          ) : (
            <button
              onClick={handleOpenKeyModal}
              style={{
                background: '#1a3c5e',
                border: 'none',
                color: '#ffffff',
                padding: '0.4rem 0.9rem',
                borderRadius: '6px',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}
            >
              Kết nối Gemini cá nhân
            </button>
          )}
        </div>
      </div>

      {/* Thông tin Portal User */}
      {userEmail && (
        <div style={{
          fontSize: '0.8rem',
          color: '#64748b',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem'
        }}>
          <span>👤 Portal:</span>
          <strong style={{ color: '#334155' }}>{userEmail}</strong>
          <span style={{ opacity: 0.7 }}>· Tín dụng AI sử dụng riêng qua Gemini BYOK</span>
        </div>
      )}

      {/* 2. Cấu hình Mô hình & Ngôn ngữ */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '1rem',
        marginBottom: '1.25rem'
      }}>
        {/* Chọn Mô hình Gemini */}
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
            Mô hình Gemini:
          </label>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={isProcessing}
            style={{
              width: '100%',
              padding: '0.55rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#fff',
              fontSize: '0.9rem'
            }}
          >
            <option value={AUTO_MODEL_ID}>Tự động (Khuyến nghị)</option>
            {freeModels.map((m) => (
              <option key={m.modelId} value={m.modelId}>
                {m.displayName}
              </option>
            ))}
          </select>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
            {selectedModel === AUTO_MODEL_ID
              ? 'Tự động chọn mô hình Free tối ưu nhất và tự động chuyển đổi nếu gặp quá tải.'
              : currentModelDetails?.description || 'Mô hình Free Tier khả dụng.'}
          </div>
        </div>

        {/* Ngôn ngữ nguồn */}
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
            Ngôn ngữ nguồn trong video:
          </label>
          <select
            value={sourceLang}
            onChange={(e) => setSourceLang(e.target.value)}
            disabled={isProcessing}
            style={{
              width: '100%',
              padding: '0.55rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#fff',
              fontSize: '0.9rem'
            }}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
        </div>

        {/* Chế độ phụ đề */}
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
            Chế độ phụ đề:
          </label>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', height: '38px' }}>
            <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="subMode"
                value="original"
                checked={mode === 'original'}
                onChange={() => setMode('original')}
                disabled={isProcessing}
              />
              Phụ đề ngôn ngữ gốc
            </label>
            <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="subMode"
                value="translate"
                checked={mode === 'translate'}
                onChange={() => setMode('translate')}
                disabled={isProcessing}
              />
              Dịch phụ đề
            </label>
          </div>
        </div>

        {/* Ngôn ngữ đích khi dịch */}
        {mode === 'translate' && (
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
              Ngôn ngữ đích:
            </label>
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              disabled={isProcessing}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#fff',
                fontSize: '0.9rem'
              }}
            >
              {LANGUAGES.filter((l) => l.code !== 'auto').map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 3. Thông tin video & Nút Bắt đầu */}
      <div style={{
        background: '#f8fafc',
        padding: '0.85rem 1rem',
        borderRadius: '8px',
        fontSize: '0.85rem',
        color: '#64748b',
        marginBottom: '1.25rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.75rem'
      }}>
        <div>
          <strong>Video nguồn:</strong>{' '}
          {selectedVideoFile ? selectedVideoFile.name : '(Chưa chọn video nào)'}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {hasFailedChunks && (
            <button
              onClick={() => handleStartSubtitle(true)}
              disabled={isProcessing}
              style={{
                background: '#f59e0b',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '0.55rem 1.1rem',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: isProcessing ? 'not-allowed' : 'pointer'
              }}
            >
              Thử lại các đoạn lỗi
            </button>
          )}

          <button
            onClick={() => handleStartSubtitle(false)}
            disabled={isProcessing || !selectedVideoFile}
            style={{
              background: isProcessing || !selectedVideoFile ? '#e2e8f0' : '#1a3c5e',
              color: isProcessing || !selectedVideoFile ? '#94a3b8' : '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '0.55rem 1.25rem',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: isProcessing || !selectedVideoFile ? 'not-allowed' : 'pointer',
              boxShadow: '0 2px 4px rgba(0,0,0,0.08)'
            }}
          >
            {isProcessing ? 'Đang tạo phụ đề...' : 'Bắt đầu tạo phụ đề AI'}
          </button>
        </div>
      </div>

      {/* 4. Thanh tiến trình & Trạng thái phân đoạn */}
      {(isProcessing || progressPercent > 0) && (
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.85rem',
            marginBottom: '0.35rem',
            fontWeight: 600,
            color: '#1e293b'
          }}>
            <span>{statusMessage}</span>
            <span>{progressPercent}%</span>
          </div>
          <div style={{ width: '100%', height: '8px', background: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
            <div
              style={{
                width: `${progressPercent}%`,
                height: '100%',
                background: progressPercent === 100 && !errorMessage ? '#10b981' : '#1a3c5e',
                transition: 'width 0.3s ease'
              }}
            />
          </div>
        </div>
      )}

      {/* 5. Thông báo lỗi nếu có */}
      {errorMessage && (
        <div style={{
          background: '#fef2f2',
          border: '1px solid #fecaca',
          color: '#b91c1c',
          padding: '0.75rem 1rem',
          borderRadius: '8px',
          fontSize: '0.85rem',
          marginBottom: '1rem'
        }}>
          {errorMessage}
        </div>
      )}

      {/* 6. Khung Preview Subtitle & Nút Download SRT */}
      {srtResult && (
        <div style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0f172a' }}>
              Xem trước cấu trúc phụ đề (.SRT):
            </span>
            <button
              onClick={handleDownload}
              style={{
                background: '#10b981',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '0.45rem 1rem',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}
            >
              📥 Tải file .SRT
            </button>
          </div>
          <textarea
            readOnly
            value={srtResult}
            rows={8}
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
              lineHeight: 1.4
            }}
          />
        </div>
      )}

      {/* 7. Modal Kết nối Gemini cá nhân (BYOK) */}
      {showKeyModal && (
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
            padding: '2rem',
            maxWidth: '520px',
            width: '100%',
            boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
            boxSizing: 'border-box'
          }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1a3c5e', margin: '0 0 0.75rem 0' }}>
              KẾT NỐI GEMINI CÁ NHÂN
            </h3>

            <p style={{ fontSize: '0.88rem', color: '#475569', lineHeight: 1.5, margin: '0 0 1.25rem 0' }}>
              Chức năng AI sử dụng Gemini API Key của riêng bạn.
              Hạn mức Gemini thuộc project Google của bạn.
              Khoa không cung cấp hoặc lưu trữ API Key dùng chung.
            </p>

            {/* Nút Lấy Gemini Key miễn phí */}
            <div style={{ marginBottom: '1.25rem' }}>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  color: '#0284c7',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  textDecoration: 'none'
                }}
              >
                [ Lấy Gemini Key miễn phí ↗ ]
              </a>
              <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.2rem' }}>
                Mở Google AI Studio để tạo API Key miễn phí cho tài khoản của bạn.
              </div>
            </div>

            {/* Ô nhập API Key */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                Gemini API Key:
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  placeholder="Nhập AIzaSy..."
                  autoComplete="off"
                  spellCheck="false"
                  disabled={isValidating}
                  style={{
                    width: '100%',
                    padding: '0.65rem 2.5rem 0.65rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem',
                    fontFamily: showPassword ? 'monospace' : 'inherit',
                    boxSizing: 'border-box'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  title={showPassword ? 'Ẩn khóa' : 'Hiện khóa'}
                  style={{
                    position: 'absolute',
                    right: '0.6rem',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '1rem',
                    color: '#64748b',
                    padding: '0.2rem'
                  }}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            {/* Tùy chọn lưu trữ */}
            <div style={{
              background: '#f8fafc',
              padding: '0.85rem',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              marginBottom: '1.25rem'
            }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                Tùy chọn lưu trữ khóa:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                <label style={{ fontSize: '0.82rem', color: '#475569', display: 'flex', alignItems: 'flex-start', gap: '0.4rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="storageOption"
                    checked={!rememberOption}
                    onChange={() => setRememberOption(false)}
                  />
                  <span>
                    <strong>Chỉ dùng trong phiên này (Khuyên dùng)</strong>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      Tự động xóa khi đóng tab hoặc khi đăng xuất Portal.
                    </div>
                  </span>
                </label>
                <label style={{ fontSize: '0.82rem', color: '#475569', display: 'flex', alignItems: 'flex-start', gap: '0.4rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="storageOption"
                    checked={rememberOption}
                    onChange={() => setRememberOption(true)}
                  />
                  <span>
                    <strong>Ghi nhớ trên thiết bị này</strong>
                    <div style={{ fontSize: '0.75rem', color: '#b45309' }}>
                      ⚠️ Chỉ nên ghi nhớ khóa trên thiết bị cá nhân.
                    </div>
                  </span>
                </label>
              </div>
            </div>

            {/* Lỗi xác thực nếu có */}
            {modalError && (
              <div style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                padding: '0.65rem 0.85rem',
                borderRadius: '6px',
                fontSize: '0.82rem',
                marginBottom: '1.25rem'
              }}>
                {modalError}
              </div>
            )}

            {/* Nút hành động */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setShowKeyModal(false)}
                disabled={isValidating}
                style={{
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  color: '#475569',
                  padding: '0.6rem 1.1rem',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: isValidating ? 'not-allowed' : 'pointer'
                }}
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleConnectKey}
                disabled={isValidating}
                style={{
                  background: '#1a3c5e',
                  border: 'none',
                  color: '#ffffff',
                  padding: '0.6rem 1.25rem',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: isValidating ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem'
                }}
              >
                {isValidating ? 'Đang kiểm tra...' : 'Kiểm tra & Kết nối'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * audioExtractor.ts
 * Trích xuất và phân đoạn âm thanh (audio chunking) tối ưu cho Gemini Speech AI.
 * 
 * QUY TẮC THIẾT KẾ:
 * 1. Toàn bộ xử lý 100% trên trình duyệt với FFmpeg WASM (không tải video/audio lên Firebase/Server).
 * 2. Cấu hình phân đoạn tập trung: Video <= 30 phút (60s/chunk), > 30 phút (90s/chunk), overlap 1.5s.
 * 3. Mỗi chunk lưu trữ id, startOffset, duration, overlap, base64, mimeType.
 */

import type { FFmpeg as FFmpegType } from '@ffmpeg/ffmpeg';

export interface AudioChunkConfig {
  shortVideoMaxSeconds: number; // Ngưỡng phân biệt video ngắn/dài (mặc định 1800s = 30 phút)
  shortChunkDuration: number;   // Độ dài chunk cho video <= 30m (mặc định 60s)
  longChunkDuration: number;    // Độ dài chunk cho video > 30m (mặc định 90s)
  overlapSeconds: number;       // Thời gian overlap giữa 2 chunk (mặc định 1.5s)
}

export const DEFAULT_CHUNK_CONFIG: AudioChunkConfig = {
  shortVideoMaxSeconds: 1800,
  shortChunkDuration: 60,
  longChunkDuration: 90,
  overlapSeconds: 1.5
};

export interface ChunkPlan {
  id: number;          // 0, 1, 2...
  index: number;       // 1-based (1, 2...)
  total: number;
  startOffset: number; // Giây bắt đầu tính từ đầu video
  duration: number;    // Thời lượng chunk (giây)
  overlap: number;     // Độ gối đầu với chunk trước (giây)
}

export interface ExtractedChunk extends ChunkPlan {
  blob: Blob;
  base64: string;
  mimeType: string;
}

/**
 * Lấy thời lượng video bằng HTML5 Video metadata
 */
export function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const cleanUp = () => {
      URL.revokeObjectURL(video.src);
      video.remove();
    };
    video.onloadedmetadata = () => {
      const dur = video.duration || 0;
      cleanUp();
      resolve(dur);
    };
    video.onerror = () => {
      cleanUp();
      resolve(0);
    };
    video.src = URL.createObjectURL(file);
  });
}

/**
 * Tính toán kế hoạch phân đoạn (Chunk Plan)
 */
export function calculateChunkPlan(
  totalDurationSeconds: number,
  config: AudioChunkConfig = DEFAULT_CHUNK_CONFIG
): ChunkPlan[] {
  if (totalDurationSeconds <= 0) {
    return [{
      id: 0,
      index: 1,
      total: 1,
      startOffset: 0,
      duration: 60,
      overlap: 0
    }];
  }

  const chunkDuration = totalDurationSeconds <= config.shortVideoMaxSeconds
    ? config.shortChunkDuration
    : config.longChunkDuration;
  const overlap = config.overlapSeconds;

  const plans: Omit<ChunkPlan, 'total'>[] = [];
  let currentStart = 0;
  let id = 0;

  while (currentStart < totalDurationSeconds) {
    const remaining = totalDurationSeconds - currentStart;
    const dur = Math.min(chunkDuration, remaining);

    plans.push({
      id,
      index: id + 1,
      startOffset: currentStart,
      duration: dur,
      overlap: id === 0 ? 0 : overlap
    });

    id++;
    // Điểm bắt đầu chunk tiếp theo lùi lại một đoạn overlap
    currentStart += (chunkDuration - overlap);
    if (dur < chunkDuration) break; // Đã đến đoạn cuối cùng
  }

  const total = plans.length;
  return plans.map((p) => ({ ...p, total }));
}

/**
 * Chuyển đổi Uint8Array/ArrayBuffer sang Base64 an toàn cho browser
 */
function uint8ArrayToBase64(uint8: Uint8Array): string {
  let binary = '';
  const len = uint8.byteLength;
  const chunkSize = 0x8000; // Tránh call stack overflow khi Uint8Array lớn
  for (let i = 0; i < len; i += chunkSize) {
    const sub = uint8.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Trích xuất toàn bộ âm thanh từ video sang định dạng 16kHz mono MP3
 * và cắt thành các chunk theo kế hoạch ChunkPlan.
 */
export async function extractAndChunkAudio(
  ffmpeg: FFmpegType,
  videoFile: File,
  plans: ChunkPlan[],
  onProgress?: (message: string, percent: number) => void
): Promise<ExtractedChunk[]> {
  const { fetchFile } = await import('@ffmpeg/util');

  const safeId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const ext = videoFile.name.split('.').pop()?.toLowerCase() || 'mp4';
  const inputName = 'input_' + safeId + '.' + ext;
  const fullAudioName = 'full_audio_' + safeId + '.mp3';

  try {
    if (onProgress) onProgress('Đang tải video vào bộ xử lý...', 5);
    await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

    if (onProgress) onProgress('Đang tách track âm thanh (16kHz mono)...', 15);

    // Trích xuất toàn bộ audio sang MP3 16kHz mono nhẹ nhất
    const extractCode = await ffmpeg.exec([
      '-i', inputName,
      '-vn',
      '-ar', '16000',
      '-ac', '1',
      '-b:a', '64k',
      '-y', fullAudioName
    ]);

    if (extractCode !== 0) {
      throw new Error('FFmpeg không thể trích xuất âm thanh từ tệp video này.');
    }

    // Xóa file video nguồn trong RAM ảo để tiết kiệm bộ nhớ
    await ffmpeg.deleteFile(inputName).catch(() => undefined);

    const chunks: ExtractedChunk[] = [];
    const totalChunks = plans.length;

    for (let i = 0; i < totalChunks; i++) {
      const plan = plans[i];
      const chunkName = 'chunk_' + safeId + '_' + plan.id + '.mp3';

      const pct = 30 + Math.round(((i + 1) / totalChunks) * 65);
      if (onProgress) {
        onProgress('Đang phân đoạn âm thanh (' + (i + 1) + '/' + totalChunks + ')...', pct);
      }

      // Cắt chunk từ fullAudioName
      const sliceCode = await ffmpeg.exec([
        '-ss', plan.startOffset.toFixed(2),
        '-t', plan.duration.toFixed(2),
        '-i', fullAudioName,
        '-ac', '1',
        '-ar', '16000',
        '-b:a', '64k',
        '-y', chunkName
      ]);

      if (sliceCode !== 0) {
        throw new Error('Không thể phân đoạn âm thanh tại vị trí ' + plan.startOffset + 's');
      }

      const chunkData = await ffmpeg.readFile(chunkName);
      const uint8 = typeof chunkData === 'string'
        ? new TextEncoder().encode(chunkData)
        : new Uint8Array(chunkData);

      const blob = new Blob([uint8], { type: 'audio/mp3' });
      const base64 = uint8ArrayToBase64(uint8);

      await ffmpeg.deleteFile(chunkName).catch(() => undefined);

      chunks.push({
        ...plan,
        blob,
        base64,
        mimeType: 'audio/mp3'
      });
    }

    if (onProgress) onProgress('Phân đoạn âm thanh hoàn tất.', 100);
    return chunks;
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => undefined);
    await ffmpeg.deleteFile(fullAudioName).catch(() => undefined);
  }
}

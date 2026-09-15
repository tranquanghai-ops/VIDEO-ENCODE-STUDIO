/**
 * geminiSubtitle.ts
 * Module kết nối Gemini API theo kiến trúc BYOK (Bring Your Own Key).
 * 
 * NGUYÊN TẮC AN TOÀN TUYỆT ĐỐI:
 * 1. Không hardcode bất kỳ API Key nào trong source code hoặc bundle.
 * 2. Gửi key qua header "x-goog-api-key" (không để key trên query string URL).
 * 3. Không console.log hoặc đưa key vào thông báo lỗi.
 * 4. Hỗ trợ 2 hình thức lưu trữ: sessionStorage (mặc định) và localStorage (khi chọn "Ghi nhớ").
 * 5. Structured JSON Output + Exponential Backoff khi gặp 429 + Chế độ fallback AUTO model.
 */

import { formatSrtTime } from './srtHelper';
import {
  AUTO_MODEL_ID,
  getAutoModelFallbackChain,
  getModelInfo,
  type GeminiModelInfo
} from './modelRegistry';
import type { ExtractedChunk } from './audioExtractor';

// Storage keys
const STORAGE_KEY_SESSION = 'tdtu_gemini_api_key_session';
const STORAGE_KEY_LOCAL = 'tdtu_gemini_api_key_local';
const STORAGE_KEY_TYPE = 'tdtu_gemini_storage_type';

export interface StoredKeyInfo {
  key: string;
  type: 'session' | 'local' | 'none';
}

/**
 * Lấy API key hiện được lưu trữ
 */
export function getStoredApiKey(): StoredKeyInfo {
  try {
    const sessionKey = sessionStorage.getItem(STORAGE_KEY_SESSION);
    if (sessionKey && sessionKey.trim()) {
      return { key: sessionKey.trim(), type: 'session' };
    }
    const localKey = localStorage.getItem(STORAGE_KEY_LOCAL);
    if (localKey && localKey.trim()) {
      return { key: localKey.trim(), type: 'local' };
    }
  } catch (e) {
    // Ignore storage access errors
  }
  return { key: '', type: 'none' };
}

/**
 * Lưu API key an toàn theo lựa chọn người dùng
 */
export function saveStoredApiKey(key: string, remember: boolean): void {
  const cleanKey = key.trim();
  if (!cleanKey) {
    clearStoredApiKey();
    return;
  }

  try {
    if (remember) {
      localStorage.setItem(STORAGE_KEY_LOCAL, cleanKey);
      localStorage.setItem(STORAGE_KEY_TYPE, 'local');
      sessionStorage.removeItem(STORAGE_KEY_SESSION);
    } else {
      sessionStorage.setItem(STORAGE_KEY_SESSION, cleanKey);
      sessionStorage.setItem(STORAGE_KEY_TYPE, 'session');
      localStorage.removeItem(STORAGE_KEY_LOCAL);
    }
  } catch (e) {
    // Fallback nếu storage bị chặn
  }
}

/**
 * Xóa API key khỏi cả sessionStorage và localStorage
 */
export function clearStoredApiKey(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY_SESSION);
    sessionStorage.removeItem(STORAGE_KEY_TYPE);
    localStorage.removeItem(STORAGE_KEY_LOCAL);
    localStorage.removeItem(STORAGE_KEY_TYPE);
  } catch (e) {}
}

/**
 * Kiểm tra tính hợp lệ của Gemini API Key bằng endpoint nhẹ nhất (listModels pageSize=1)
 * Không tiêu tốn token inference, không phụ thuộc vào bất kỳ model cũ hay ngừng hoạt động nào.
 */
export async function validateGeminiApiKey(
  apiKey: string
): Promise<{ success: boolean; status: number; message: string }> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    return {
      success: false,
      status: 400,
      message: 'Vui lòng nhập Gemini API Key.'
    };
  }

  try {
    // Gọi endpoint chính thức với header x-goog-api-key, KHÔNG đưa key vào URL query string
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
      {
        method: 'GET',
        headers: {
          'x-goog-api-key': cleanKey
        }
      }
    );

    if (response.ok) {
      return {
        success: true,
        status: 200,
        message: 'Gemini cá nhân: Đã kết nối'
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        status: response.status,
        message: 'Gemini API Key không hợp lệ hoặc không có quyền sử dụng.'
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        status: 429,
        message: 'Gemini của bạn đang đạt giới hạn sử dụng. Vui lòng thử lại sau.'
      };
    }

    return {
      success: false,
      status: response.status,
      message: 'Không thể kết nối đến Gemini API (Mã lỗi: ' + response.status + ').'
    };
  } catch (err: any) {
    return {
      success: false,
      status: 0,
      message: 'Lỗi mạng: Không thể kết nối tới máy chủ Google AI. Vui lòng kiểm tra kết nối Internet.'
    };
  }
}

export interface SubtitleConfig {
  sourceLang: string;     // vi, auto, en, etc.
  sourceLangName: string;
  mode: 'original' | 'translate';
  targetLang?: string;    // en, etc.
  targetLangName?: string;
  modelId: string;        // 'auto' hoặc model cụ thể
  apiKey?: string;
}

export interface RawSubtitleItem {
  start: number; // Thời gian giây tính từ đầu video
  end: number;
  text: string;
}

export interface ChunkProcessResult {
  chunkId: number;
  index: number;
  total: number;
  status: 'success' | 'error';
  items: RawSubtitleItem[];
  errorMessage?: string;
  modelUsed?: string;
}

/**
 * Trợ giúp delay cho exponential backoff
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Gọi Gemini API cho một chunk âm thanh đơn lẻ với xử lý Structured JSON và 429 Retry
 */
export async function processAudioChunk(
  chunk: ExtractedChunk,
  config: SubtitleConfig,
  apiKey: string,
  onRetryNotice?: (msg: string) => void
): Promise<ChunkProcessResult> {
  const modelChain = config.modelId === AUTO_MODEL_ID
    ? getAutoModelFallbackChain()
    : [config.modelId];

  let lastError = 'Không thể xử lý đoạn âm thanh này.';
  let successfulModel = '';

  for (const currentModel of modelChain) {
    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + currentModel + ':generateContent';

    // Xây dựng chỉ dẫn tạo Structured JSON
    let instruction = '';
    if (config.mode === 'original') {
      instruction = [
        'You are an expert audio transcription system.',
        'Listen carefully to the audio and transcribe speech into structured subtitles.',
        'Source language: ' + (config.sourceLang === 'auto' ? 'automatically detected' : config.sourceLangName) + '.',
        'Requirements:',
        '1. Return a STRICT JSON array matching this exact schema: [{"start": 0.5, "end": 3.2, "text": "transcribed speech"}]',
        '2. "start" and "end" MUST be floating-point numbers representing seconds relative to the audio chunk start (e.g. 1.25).',
        '3. Break dialogue into readable subtitle lines (max 10-14 words per line).',
        '4. Ensure timestamps are strictly monotonically increasing (start < end).',
        '5. Preserve Vietnamese accents and grammar accurately if audio contains Vietnamese.',
        '6. Output RAW JSON array only without markdown backticks or commentary.'
      ].join('\n');
    } else {
      instruction = [
        'You are an expert audio transcription and subtitle translation system.',
        'Listen carefully to the audio and translate the speech into ' + config.targetLangName + ' (' + config.targetLang + ').',
        'Source language: ' + (config.sourceLang === 'auto' ? 'automatically detected' : config.sourceLangName) + '.',
        'Requirements:',
        '1. Return a STRICT JSON array matching this exact schema: [{"start": 0.5, "end": 3.2, "text": "translated speech"}]',
        '2. "start" and "end" MUST be floating-point numbers representing seconds relative to the audio chunk start.',
        '3. Translate naturally into ' + config.targetLangName + ' while preserving conversational nuances.',
        '4. Break dialogue into readable subtitle lines (max 10-14 words per line).',
        '5. Ensure timestamps are strictly monotonically increasing (start < end).',
        '6. Output RAW JSON array only without markdown backticks or commentary.'
      ].join('\n');
    }

    const payload = {
      contents: [
        {
          parts: [
            { text: instruction },
            {
              inline_data: {
                mime_type: chunk.mimeType,
                data: chunk.base64
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        topP: 0.95,
        responseMimeType: 'application/json'
      }
    };

    // Retry loop với exponential backoff cho lỗi 429: 3s -> 6s -> 12s -> 24s
    const backoffDelays = [3000, 6000, 12000, 24000];
    let attempt = 0;
    let success = false;
    let rawResponseText = '';

    while (attempt <= backoffDelays.length && !success) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify(payload)
        });

        if (response.status === 429) {
          if (attempt < backoffDelays.length) {
            const waitMs = backoffDelays[attempt];
            const waitSec = waitMs / 1000;
            attempt++;
            if (onRetryNotice) {
              onRetryNotice(
                'Gemini đang giới hạn lượt dùng (429). Đang chờ ' + waitSec + 's và thử lại đoạn ' + chunk.index + '/' + chunk.total + ' (lần ' + attempt + '/' + backoffDelays.length + ')...'
              );
            }
            await sleep(waitMs);
            continue;
          } else {
            throw new Error('Gemini API đã đạt giới hạn quota (429) sau ' + backoffDelays.length + ' lần thử lại.');
          }
        }

        if (!response.ok) {
          let errText = '';
          try {
            const errJson = await response.json();
            errText = errJson.error?.message || response.statusText;
          } catch {
            errText = await response.text();
          }
          throw new Error('Lỗi từ Gemini API (' + response.status + '): ' + errText);
        }

        const data = await response.json();
        rawResponseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        success = true;
        successfulModel = currentModel;
        break;
      } catch (err: any) {
        lastError = err.message || 'Lỗi kết nối';
        // Nếu không phải 429 hoặc đã hết số lần retry, thử model tiếp theo trong chuỗi fallback
        break;
      }
    }

    if (success && rawResponseText) {
      try {
        // Làm sạch markdown fences nếu Gemini vô tình bọc JSON trong ```json ... ```
        let cleaned = rawResponseText.trim();
        if (cleaned.startsWith('```')) {
          cleaned = cleaned.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
        }

        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          const items: RawSubtitleItem[] = [];

          for (const item of parsed) {
            if (item && typeof item.text === 'string' && item.text.trim()) {
              const relStart = Number(item.start);
              const relEnd = Number(item.end);

              if (!isNaN(relStart) && !isNaN(relEnd) && relEnd > relStart) {
                // Điều chỉnh timestamp tương đối sang thời gian tuyệt đối của toàn video
                const absStart = chunk.startOffset + relStart;
                const absEnd = chunk.startOffset + relEnd;

                // Nếu có overlap với chunk trước, bỏ qua các câu nằm hoàn toàn trong vùng overlap đã xử lý
                if (chunk.overlap > 0 && absStart < (chunk.startOffset + chunk.overlap * 0.8)) {
                  // Vùng overlap được lọc và tinh chỉnh trong hàm assembleChunksToSrt
                }

                items.push({
                  start: absStart,
                  end: absEnd,
                  text: item.text.trim()
                });
              }
            }
          }

          return {
            chunkId: chunk.id,
            index: chunk.index,
            total: chunk.total,
            status: 'success',
            items,
            modelUsed: successfulModel
          };
        }
      } catch (parseErr: any) {
        lastError = 'Không thể phân tích dữ liệu JSON trả về từ AI: ' + parseErr.message;
      }
    }
  }

  return {
    chunkId: chunk.id,
    index: chunk.index,
    total: chunk.total,
    status: 'error',
    items: [],
    errorMessage: lastError,
    modelUsed: successfulModel
  };
}

/**
 * Hợp nhất các kết quả chunk, xử lý overlap, sắp xếp timestamp và xuất định dạng SRT hoàn chỉnh
 */
export function assembleChunksToSrt(
  results: ChunkProcessResult[],
  overlapSeconds: number = 1.5
): string {
  // Lấy tất cả items từ các chunk thành công
  const allItems: RawSubtitleItem[] = [];
  const sortedResults = [...results].sort((a, b) => a.chunkId - b.chunkId);

  for (const res of sortedResults) {
    if (res.status === 'success' && res.items.length > 0) {
      allItems.push(...res.items);
    }
  }

  if (allItems.length === 0) {
    return '';
  }

  // 1. Sắp xếp tăng dần theo start time
  allItems.sort((a, b) => a.start - b.start);

  // 2. Lọc bỏ các mục trùng lặp trong vùng overlap
  const deduped: RawSubtitleItem[] = [];

  for (let i = 0; i < allItems.length; i++) {
    const current = allItems[i];
    const prev = deduped[deduped.length - 1];

    if (!prev) {
      deduped.push(current);
      continue;
    }

    // Nếu thời gian bắt đầu cách nhau ít hơn 1.2s và nội dung tương tự -> Bỏ trùng lặp
    const timeDiff = Math.abs(current.start - prev.start);
    const isDuplicateText = current.text.toLowerCase() === prev.text.toLowerCase();

    if (timeDiff < 1.2 && isDuplicateText) {
      continue;
    }

    // Đảm bảo không bị overlap bất hợp lý giữa các dòng phụ đề liên tiếp
    if (current.start < prev.end) {
      if (current.start > prev.start + 0.3) {
        prev.end = current.start - 0.05;
      }
    }

    deduped.push(current);
  }

  // 3. Đánh lại số thứ tự và định dạng SRT
  const srtBlocks: string[] = [];

  for (let idx = 0; idx < deduped.length; idx++) {
    const item = deduped[idx];
    const blockNum = idx + 1;
    const startStr = formatSrtTime(item.start);
    const endStr = formatSrtTime(Math.max(item.end, item.start + 0.5));

    srtBlocks.push(blockNum + '\n' + startStr + ' --> ' + endStr + '\n' + item.text);
  }

  return srtBlocks.join('\n\n');
}

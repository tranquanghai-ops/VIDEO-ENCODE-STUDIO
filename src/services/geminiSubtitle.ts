/**
 * geminiSubtitle.ts
 * Tương tác với Gemini API để nhận dạng tiếng nói và tạo phụ đề SRT
 * ĐẢM BẢO AN TOÀN: Tuyệt đối không hardcode API key vào mã nguồn.
 */

import { cleanSrtOutput } from "./srtHelper";

export interface SubtitleConfig {
  sourceLang: string;     // Mã ngôn ngữ nguồn (vi, en, auto, ...)
  sourceLangName: string; // Tên hiển thị
  mode: "original" | "translate";
  targetLang?: string;    // Mã ngôn ngữ đích khi dịch
  targetLangName?: string;
  apiKey?: string;        // Key cá nhân của người dùng (BYOK)
}

const STORAGE_KEY = "tdtu_gemini_api_key";

export function getSavedApiKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function saveApiKey(key: string): void {
  try {
    if (key.trim()) {
      localStorage.setItem(STORAGE_KEY, key.trim());
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
}

export async function generateSubtitlesWithGemini(
  audioBase64: string,
  mimeType: string,
  config: SubtitleConfig,
  onStatusUpdate?: (statusMessage: string) => void
): Promise<string> {
  const apiKey = config.apiKey || getSavedApiKey();

  if (!apiKey) {
    throw new Error(
      "Chưa có Gemini API Key. Vui lòng nhấn vào nút 'Cài đặt API Key' để nhập khóa miễn phí từ Google AI Studio (aistudio.google.com)."
    );
  }

  if (onStatusUpdate) onStatusUpdate("Đang chuẩn bị prompt và gửi âm thanh tới Gemini AI...");

  // Tạo prompt chi tiết và chuẩn xác
  let instruction = "";
  if (config.mode === "original") {
    instruction = `You are an expert audio transcription system.
Listen carefully to the audio file provided.
The source language is ${config.sourceLang === "auto" ? "automatically detected" : config.sourceLangName} (${config.sourceLang}).
Transcribe ALL spoken speech into accurate, timestamped subtitles strictly in the SubRip (.srt) format.

Requirements:
1. Output ONLY the raw SRT format (no markdown fences, no explanatory text).
2. Number each subtitle block sequentially starting from 1.
3. Use precise timestamps: HH:MM:SS,mmm --> HH:MM:SS,mmm (e.g. 00:00:01,500 --> 00:00:04,200).
4. Break sentences into readable, natural phrases (max 10-15 words per subtitle block).
5. Ensure timestamps do NOT overlap and are monotonically increasing.
6. Preserve original spoken language without translating.
7. Correctly preserve Vietnamese accents and grammar if the speech is in Vietnamese.`;
  } else {
    instruction = `You are an expert audio transcription and subtitle translation system.
Listen carefully to the audio file provided.
The source language is ${config.sourceLang === "auto" ? "automatically detected" : config.sourceLangName} (${config.sourceLang}).
Translate the spoken dialogue into ${config.targetLangName} (${config.targetLang}) and generate timestamped subtitles strictly in the SubRip (.srt) format.

Requirements:
1. Output ONLY the raw SRT format (no markdown fences, no explanatory text).
2. Number each subtitle block sequentially starting from 1.
3. Use precise timestamps: HH:MM:SS,mmm --> HH:MM:SS,mmm matching the audio timing.
4. Translate naturally and accurately into ${config.targetLangName}, retaining conversational tone.
5. Break sentences into readable, natural phrases (max 10-15 words per subtitle block).
6. Ensure timestamps do NOT overlap and are monotonically increasing.
7. Output must be clean UTF-8 text.`;
  }

  if (onStatusUpdate) onStatusUpdate("AI đang nhận dạng lời nói và phân tích timestamp...");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: instruction },
          {
            inline_data: {
              mime_type: mimeType,
              data: audioBase64
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      topP: 0.95
    }
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    let errorDetail = "";
    try {
      const errJson = await response.json();
      errorDetail = errJson.error?.message || response.statusText;
    } catch {
      errorDetail = await response.text();
    }
    throw new Error(`Lỗi từ Gemini API (${response.status}): ${errorDetail}`);
  }

  if (onStatusUpdate) onStatusUpdate("Đang hoàn tất và đóng gói định dạng SRT...");

  const data = await response.json();
  const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  if (!rawContent) {
    throw new Error("Không nhận được nội dung phụ đề từ AI (audio có thể không có tiếng nói).");
  }

  return cleanSrtOutput(rawContent);
}

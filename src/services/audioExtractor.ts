/**
 * audioExtractor.ts
 * Trích xuất audio từ video bằng FFmpeg WASM trên trình duyệt (16kHz mono, tối ưu dung lượng cho Speech AI)
 */

import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

export async function extractAudioFromVideo(
  ffmpeg: FFmpegType,
  videoFile: File,
  onProgress?: (ratio: number) => void
): Promise<{ blob: Blob; base64: string; mimeType: string }> {
  const { fetchFile } = await import("@ffmpeg/util");

  const safeId = Date.now().toString(36);
  const ext = videoFile.name.split(".").pop()?.toLowerCase() || "mp4";
  const inputName = `input_${safeId}.${ext}`;
  const outputName = `audio_${safeId}.mp3`;

  try {
    // 1. Ghi file video vào virtual filesystem của FFmpeg
    await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

    // Lắng nghe tiến trình
    const progressHandler = ({ progress }: { progress: number }) => {
      if (onProgress) onProgress(Math.min(1, Math.max(0, progress)));
    };
    ffmpeg.on("progress", progressHandler);

    // 2. Trích xuất âm thanh: bỏ video (-vn), tần số lấy mẫu 16000Hz (-ar 16000), 1 kênh mono (-ac 1), bitrate 64k (-b:a 64k)
    // Định dạng MP3 64k 16kHz mono cực kỳ nhẹ (1 phút ~ 480 KB), hoàn hảo cho Gemini Speech API.
    const exitCode = await ffmpeg.exec([
      "-i", inputName,
      "-vn",
      "-ar", "16000",
      "-ac", "1",
      "-b:a", "64k",
      "-y", outputName
    ]);

    ffmpeg.off("progress", progressHandler);

    if (exitCode !== 0) {
      throw new Error("FFmpeg không thể trích xuất âm thanh từ video này.");
    }

    // 3. Đọc file kết quả
    const fileData = await ffmpeg.readFile(outputName);
    const uint8 = typeof fileData === "string" ? new TextEncoder().encode(fileData) : new Uint8Array(fileData);
    const audioBlob = new Blob([uint8], { type: "audio/mp3" });

    // 4. Chuyển sang Base64 để gửi tới Gemini API
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        // Bỏ tiền tố "data:audio/mp3;base64,"
        const base64Data = result.split(",")[1];
        resolve(base64Data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(audioBlob);
    });

    return {
      blob: audioBlob,
      base64,
      mimeType: "audio/mp3"
    };
  } finally {
    // Dọn dẹp virtual files
    await ffmpeg.deleteFile(inputName).catch(() => undefined);
    await ffmpeg.deleteFile(outputName).catch(() => undefined);
  }
}

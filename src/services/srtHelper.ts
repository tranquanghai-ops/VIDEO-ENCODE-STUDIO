/**
 * srtHelper.ts
 * Hỗ trợ tạo, định dạng và tải file phụ đề SRT chuẩn UTF-8
 */

export interface SubtitleItem {
  id: number;
  startTime: string; // 00:00:01,000
  endTime: string;   // 00:00:04,500
  text: string;
}

/**
 * Định dạng số giây sang định dạng SRT: HH:MM:SS,mmm
 */
export function formatSrtTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  const millis = Math.floor((s - Math.floor(s)) * 1000);

  return (
    String(hours).padStart(2, "0") +
    ":" +
    String(minutes).padStart(2, "0") +
    ":" +
    String(secs).padStart(2, "0") +
    "," +
    String(millis).padStart(3, "0")
  );
}

/**
 * Kiểm tra và làm sạch chuỗi SRT nhận được từ Gemini
 */
export function cleanSrtOutput(rawText: string): string {
  // Loại bỏ các khối code block markdown ```srt hoặc ``` nếu có
  let cleaned = rawText.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "");
  cleaned = cleaned.trim();
  return cleaned;
}

/**
 * Tải file SRT về máy người dùng
 */
export function downloadSrtFile(srtContent: string, filename: string) {
  // Thêm UTF-8 BOM (\uFEFF) để Windows Notepad / VLC đọc tiếng Việt chuẩn 100%
  const blob = new Blob(["\uFEFF" + srtContent], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".srt") ? filename : `${filename}.srt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

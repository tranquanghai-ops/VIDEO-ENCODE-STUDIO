import React, { useState } from "react";
import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";
import { extractAudioFromVideo } from "../services/audioExtractor";
import { downloadSrtFile } from "../services/srtHelper";

interface SubtitleGeneratorProps {
  ffmpegLoader: () => Promise<FFmpegType>;
  selectedVideoFile?: File;
}

const LANGUAGES = [
  { code: "vi", name: "Tiếng Việt" },
  { code: "auto", name: "Tự động nhận diện" },
  { code: "en", name: "English" },
  { code: "zh", name: "中文 (Chinese)" },
  { code: "ja", name: "日本語 (Japanese)" },
  { code: "ko", name: "한국어 (Korean)" },
  { code: "fr", name: "Français (French)" },
  { code: "de", name: "Deutsch (German)" },
  { code: "es", name: "Español (Spanish)" },
  { code: "th", name: "ไทย (Thai)" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "ru", name: "Русский (Russian)" },
];

export const SubtitleGenerator: React.FC<SubtitleGeneratorProps> = ({
  ffmpegLoader,
  selectedVideoFile,
}) => {
  const [sourceLang, setSourceLang] = useState("vi");
  const [mode, setMode] = useState<"original" | "translate">("original");
  const [targetLang, setTargetLang] = useState("en");

  // Tiến trình 7 giai đoạn
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [stepMessage, setStepMessage] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [srtResult, setSrtResult] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [audioExtracted, setAudioExtracted] = useState<boolean>(false);

  // Xử lý trích xuất âm thanh thử nghiệm trực tiếp trên trình duyệt
  const handleExtractAudio = async () => {
    if (!selectedVideoFile) {
      setErrorMessage("Vui lòng chọn hoặc kéo thả một video trước khi thử nghiệm.");
      return;
    }

    setErrorMessage("");
    setIsProcessing(true);
    setCurrentStep(1);
    setStepMessage("Đang khởi động bộ giải mã FFmpeg WASM...");

    try {
      const ffmpeg = await ffmpegLoader();
      
      setStepMessage("Đang tách âm thanh sang định dạng tối ưu 16kHz mono...");
      const audioData = await extractAudioFromVideo(ffmpeg, selectedVideoFile, (ratio) => {
        setStepMessage(`Đang tách âm thanh: ${Math.round(ratio * 100)}%`);
      });

      setCurrentStep(2);
      const sizeKb = Math.round(audioData.blob.size / 1024);
      setStepMessage(`Chuẩn bị audio hoàn tất (${sizeKb} KB).`);
      setAudioExtracted(true);

      // Tạo nội dung SRT mẫu chuẩn để kiểm tra chức năng Preview & Download
      const langSuffix = mode === "translate" ? targetLang : sourceLang;
      const sampleSrt = `1\n00:00:01,000 --> 00:00:04,500\nChào mừng quý thầy cô và các bạn sinh viên Khoa Mỹ thuật Công nghiệp.\n\n2\n00:00:05,000 --> 00:00:08,800\nĐây là bản phụ đề mẫu kiểm tra cấu hình ngôn ngữ: [${langSuffix.toUpperCase()}].\n\n3\n00:00:09,200 --> 00:00:13,000\nÂm thanh từ video [${selectedVideoFile.name}] đã được trích xuất thành công (${sizeKb} KB).`;
      setSrtResult(sampleSrt);
      setCurrentStep(7);
      setStepMessage(`Âm thanh (${sizeKb} KB) đã sẵn sàng. AI đang chờ kết nối dịch vụ.`);
    } catch (err: any) {
      console.error("[SubtitleGenerator] Lỗi tách âm thanh:", err);
      setErrorMessage(err.message || "Không thể trích xuất âm thanh từ video này.");
      setCurrentStep(0);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!srtResult || !selectedVideoFile) return;
    const baseName = selectedVideoFile.name.replace(/\.[^/.]+$/, "");
    const langSuffix = mode === "translate" ? targetLang : sourceLang;
    const filename = `${baseName}.${langSuffix}.srt`;
    downloadSrtFile(srtResult, filename);
  };

  const progressPercent = Math.min(100, Math.round((currentStep / 7) * 100));

  return (
    <div style={{
      background: "#ffffff",
      border: "1px solid #e2e8f0",
      borderRadius: "12px",
      padding: "1.5rem",
      marginTop: "1.5rem",
      boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
    }}>
      {/* Tiêu đề & Trạng thái Backend */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "1.4rem" }}>✨</span>
          <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#1e293b", margin: 0 }}>
            TẠO PHỤ ĐỀ AI
          </h3>
        </div>
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.4rem",
          background: "#f1f5f9",
          color: "#64748b",
          border: "1px solid #cbd5e1",
          borderRadius: "20px",
          padding: "0.3rem 0.85rem",
          fontSize: "0.78rem",
          fontWeight: 600,
        }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />
          AI đang chờ kết nối dịch vụ
        </div>
      </div>

      {/* Cấu hình ngôn ngữ và chế độ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
        {/* Ngôn ngữ nguồn */}
        <div>
          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: "0.35rem" }}>
            Ngôn ngữ nguồn trong video:
          </label>
          <select
            value={sourceLang}
            onChange={(e) => setSourceLang(e.target.value)}
            disabled={isProcessing}
            style={{
              width: "100%",
              padding: "0.55rem 0.75rem",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              background: "#fff",
              fontSize: "0.9rem"
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
          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: "0.35rem" }}>
            Chế độ phụ đề:
          </label>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", height: "38px" }}>
            <label style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.3rem", cursor: "pointer" }}>
              <input
                type="radio"
                name="subMode"
                value="original"
                checked={mode === "original"}
                onChange={() => setMode("original")}
                disabled={isProcessing}
              />
              Phụ đề ngôn ngữ gốc
            </label>
            <label style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.3rem", cursor: "pointer" }}>
              <input
                type="radio"
                name="subMode"
                value="translate"
                checked={mode === "translate"}
                onChange={() => setMode("translate")}
                disabled={isProcessing}
              />
              Dịch phụ đề
            </label>
          </div>
        </div>

        {/* Ngôn ngữ đích khi chọn Dịch phụ đề */}
        {mode === "translate" && (
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: "0.35rem" }}>
              Ngôn ngữ đích:
            </label>
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              disabled={isProcessing}
              style={{
                width: "100%",
                padding: "0.55rem 0.75rem",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                background: "#fff",
                fontSize: "0.9rem"
              }}
            >
              {LANGUAGES.filter((l) => l.code !== "auto").map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Thông tin video & Các nút thao tác */}
      <div style={{
        background: "#f8fafc",
        padding: "0.85rem 1rem",
        borderRadius: "8px",
        fontSize: "0.85rem",
        color: "#64748b",
        marginBottom: "1.25rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "0.75rem"
      }}>
        <div>
          <strong>Video nguồn:</strong>{" "}
          {selectedVideoFile ? selectedVideoFile.name : "(Chưa chọn video nào)"}
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            onClick={handleExtractAudio}
            disabled={isProcessing || !selectedVideoFile}
            style={{
              background: isProcessing || !selectedVideoFile ? "#e2e8f0" : "#0284c7",
              color: isProcessing || !selectedVideoFile ? "#94a3b8" : "#ffffff",
              border: "none",
              borderRadius: "6px",
              padding: "0.55rem 1.1rem",
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: isProcessing || !selectedVideoFile ? "not-allowed" : "pointer",
            }}
          >
            {isProcessing ? "Đang trích xuất..." : "Trích xuất Audio (Browser WASM)"}
          </button>
          <button
            disabled
            title="Dịch vụ AI đang chờ thiết lập backend an toàn để bảo vệ API key"
            style={{
              background: "#e2e8f0",
              color: "#94a3b8",
              border: "none",
              borderRadius: "6px",
              padding: "0.55rem 1.1rem",
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: "not-allowed",
            }}
          >
            AI đang chờ kết nối dịch vụ
          </button>
        </div>
      </div>

      {/* Thanh tiến trình Progress Bar */}
      {currentStep > 0 && (
        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "0.35rem", fontWeight: 600, color: "#1e293b" }}>
            <span>{stepMessage}</span>
            <span>{progressPercent}%</span>
          </div>
          <div style={{ width: "100%", height: "8px", background: "#e2e8f0", borderRadius: "999px", overflow: "hidden" }}>
            <div
              style={{
                width: `${progressPercent}%`,
                height: "100%",
                background: currentStep === 7 ? "#10b981" : "#0284c7",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
      )}

      {/* Thông báo lỗi nếu có */}
      {errorMessage && (
        <div style={{
          background: "#fef2f2",
          border: "1px solid #fecaca",
          color: "#b91c1c",
          padding: "0.75rem 1rem",
          borderRadius: "8px",
          fontSize: "0.85rem",
          marginBottom: "1rem"
        }}>
          {errorMessage}
        </div>
      )}

      {/* Khung Preview Subtitle & Nút Download SRT */}
      {srtResult && (
        <div style={{ marginTop: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "#0f172a" }}>
              Xem trước cấu trúc phụ đề (.SRT):
            </span>
            <button
              onClick={handleDownload}
              style={{
                background: "#10b981",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                padding: "0.45rem 1rem",
                fontWeight: 600,
                fontSize: "0.85rem",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem"
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
              width: "100%",
              fontFamily: "monospace",
              fontSize: "0.82rem",
              padding: "0.75rem",
              borderRadius: "8px",
              border: "1px solid #cbd5e1",
              background: "#f8fafc",
              color: "#334155",
              boxSizing: "border-box",
              whiteSpace: "pre",
              lineHeight: 1.4
            }}
          />
        </div>
      )}
    </div>
  );
};

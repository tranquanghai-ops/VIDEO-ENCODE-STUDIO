import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";
import { SubtitleGenerator } from "./components/SubtitleGenerator";

type Status = "ready" | "queued" | "encoding" | "done" | "error" | "stopped";
type AnalysisStatus = "pending" | "running" | "done" | "error";
type Format = "mp4" | "mov" | "webm" | "mkv";
type VideoCodec = "libx264" | "libvpx-vp9" | "mpeg4";
type AudioCodec = "aac" | "libmp3lame" | "libopus" | "libvorbis" | "none";
type AudioChannels = "source" | "1" | "2";
type AudioSampleRate = "source" | "32000" | "44100" | "48000";
type H264Level = "auto" | "2.1" | "2.2" | "3.0" | "3.1" | "4.0" | "4.1";

type Settings = {
  format: Format;
  videoCodec: VideoCodec;
  videoBitrate: string;
  h264Level: H264Level;
  audioCodec: AudioCodec;
  audioBitrate: string;
  audioChannels: AudioChannels;
  audioSampleRate: AudioSampleRate;
  resolution: string;
  customWidth: number;
  customHeight: number;
  aspect: string;
  trimStart: number;
  trimEnd: number;
};

type SourceInfo = {
  format: string;
  videoCodec: string;
  videoProfile?: string;
  videoLevel?: string;
  videoBitrate?: number;
  audioCodec: string;
  audioBitrate?: number;
  audioChannels?: number;
  audioSampleRate?: number;
  fps?: string;
};

type Thumbnail = { url: string; time: number };

type EncodeError = {
  code: string;
  title: string;
  message: string;
  suggestions: string[];
  technical?: string;
};

type VideoItem = {
  id: string;
  file: File;
  url: string;
  duration: number;
  width: number;
  height: number;
  checked: boolean;
  analysisStatus: AnalysisStatus;
  sourceInfo?: SourceInfo;
  thumbnails: Thumbnail[];
  status: Status;
  progress: number;
  settings: Settings;
  outputUrl?: string;
  outputName?: string;
  outputInfo?: SourceInfo;
  outputDuration?: number;
  outputWidth?: number;
  outputHeight?: number;
  outputSize?: number;
  error?: string;
  encodeError?: EncodeError;
};

const defaults: Settings = {
  format: "mp4", videoCodec: "libx264", videoBitrate: "auto", h264Level: "auto", audioCodec: "aac", audioBitrate: "128k",
  audioChannels: "source", audioSampleRate: "source",
  resolution: "source", customWidth: 1920, customHeight: 1080, aspect: "source", trimStart: 0, trimEnd: 0,
};

const APP_VERSION = "1.2.6";
const accepted = ".mp4,.mov,.avi,.wmv,.webm,.mkv,.m4v,.mpeg,.mpg";
const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const formatBytes = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(n < 1e6 ? 2 : 1)} MB`;
const formatBitrate = (n?: number) => !n ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)} Mbps` : `${Math.round(n / 1000)} kbps`;
const formatTime = (s: number) => {
  const value = Math.max(0, Number.isFinite(s) ? s : 0);
  const h = Math.floor(value / 3600), m = Math.floor((value % 3600) / 60), sec = Math.floor(value % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
const videoSummary = (info: SourceInfo | undefined, duration: number, size: number) => {
  const codec = info?.videoCodec ? info.videoCodec.toUpperCase() : "?";
  const profile = info?.videoProfile ? ` ${info.videoProfile}` : "";
  const level = info?.videoLevel ? ` L${info.videoLevel}` : "";
  return `${codec}${profile}${level} · ${formatBitrate(info?.videoBitrate)} · ${formatTime(duration)} · ${formatBytes(size)}`;
};

const parseBitrate = (value: string) => {
  const match = value.match(/([\d.]+)\s*([kKmM])?/);
  if (!match) return undefined;
  const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2]?.toLowerCase() === "k" ? 1_000 : 1;
  return Number(match[1]) * multiplier;
};

async function readH264Level(blob: Blob): Promise<string | undefined> {
  try {
    const { ALL_FORMATS, BlobSource, Input } = await import("mediabunny");
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    try {
      const track = await input.getPrimaryVideoTrack();
      const codec = (await track?.getDecoderConfig())?.codec || "";
      const match = codec.match(/^avc[13]\.([0-9a-f]{6})/i);
      if (!match) return undefined;
      const level = Number.parseInt(match[1].slice(4, 6), 16);
      return level ? `${Math.floor(level / 10)}.${level % 10}` : undefined;
    } finally { input.dispose(); }
  } catch { return undefined; }
}

function makeEncodeError(error: unknown, logs: string[], item: VideoItem): EncodeError {
  const rawMessage = error instanceof Error ? error.message : typeof error === "string" ? error : "Không thể mã hóa video.";
  const usefulLogs = logs
    .map((line) => line.trim())
    .filter((line) => line && !/^frame=|^size=|^time=|^bitrate=|^speed=/.test(line));
  const technical = usefulLogs.slice(-14).join("\n") || rawMessage;
  const joined = `${rawMessage}\n${technical}`.toLowerCase();

  if (/video av1 hiện được hỗ trợ.*mp4.*h\.264/.test(joined)) {
    return {
      code: "AV1_OUTPUT_REQUIRES_H264",
      title: "Video AV1 cần chọn MP4 và H.264",
      message: "Đường chuyển đổi AV1 trong trình duyệt hiện chỉ tạo đầu ra MP4 với video codec H.264.",
      suggestions: ["Chọn định dạng MP4.", "Chọn video codec H.264 — tương thích cao.", "Giữ AAC nếu muốn có âm thanh."],
      technical,
    };
  }
  if (item.sourceInfo?.videoCodec.toLowerCase() === "av1" && /decoder|decode|av1|discarded|invalid conversion/.test(joined)) {
    return {
      code: "AV1_DECODE_FAILED",
      title: "Không giải mã được video AV1",
      message: "Trình duyệt hoặc bộ giải mã hiện tại không thể đọc luồng hình AV1 của tệp này để chuyển sang định dạng mới.",
      suggestions: ["Thử lại bằng Chrome hoặc Edge phiên bản mới.", "Giữ định dạng MP4 và chọn video codec H.264.", "Đóng bớt ứng dụng khác nếu thiết bị đang thiếu bộ nhớ."],
      technical,
    };
  }
  if (/out of memory|memory access|allocation|abort\(oom\)|cannot enlarge memory/.test(joined)) {
    return {
      code: "NOT_ENOUGH_MEMORY",
      title: "Không đủ bộ nhớ để mã hóa",
      message: "Video cần nhiều bộ nhớ hơn mức trình duyệt hiện có thể cấp phát.",
      suggestions: ["Đóng bớt tab và ứng dụng khác rồi thử lại.", "Giảm kích thước khung hình hoặc cắt video thành đoạn ngắn hơn."],
      technical,
    };
  }
  if (/unknown encoder|encoder.*not found|no encodable target codec/.test(joined)) {
    return {
      code: "ENCODER_NOT_AVAILABLE",
      title: "Codec đầu ra không khả dụng",
      message: "Trình duyệt không hỗ trợ codec đầu ra đang chọn cho định dạng này.",
      suggestions: ["Chọn MP4 với H.264 và AAC để có độ tương thích cao nhất."],
      technical,
    };
  }
  if (/invalid argument|dimensions|width|height|not divisible|incorrect parameters/.test(joined)) {
    return {
      code: "INVALID_VIDEO_SETTINGS",
      title: "Thiết lập kích thước không hợp lệ",
      message: "Kích thước, tỉ lệ hoặc codec đã chọn không thể kết hợp với nhau.",
      suggestions: ["Dùng chiều rộng và chiều cao là số chẵn.", "Chọn Giữ nguyên hoặc thử 640 × 360."],
      technical,
    };
  }
  return {
    code: "ENCODE_FAILED",
    title: "Mã hóa không thành công",
    message: rawMessage === "Bộ mã hóa không thể xử lý thiết lập này." ? "FFmpeg đã dừng vì không xử lý được tệp hoặc thiết lập đang chọn." : rawMessage,
    suggestions: ["Kiểm tra lại định dạng, video codec và audio codec.", "Thử MP4, H.264, AAC và kích thước Giữ nguyên."],
    technical,
  };
}

function normalize(next: Settings): Settings {
  if (next.format === "webm") return { ...next, videoCodec: "libvpx-vp9", audioCodec: next.audioCodec === "none" ? "none" : "libopus" };
  if (next.format === "mp4" || next.format === "mov") {
    return { ...next, videoCodec: next.videoCodec === "libvpx-vp9" ? "libx264" : next.videoCodec, audioCodec: next.audioCodec === "none" ? "none" : (next.audioCodec === "libopus" || next.audioCodec === "libvorbis") ? "aac" : next.audioCodec };
  }
  return next;
}

async function readBrowserMetadata(file: File) {
  const url = URL.createObjectURL(file);
  return new Promise<{ url: string; duration: number; width: number; height: number }>((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => resolve({ url, duration: video.duration || 0, width: video.videoWidth, height: video.videoHeight });
    video.onerror = () => resolve({ url, duration: 0, width: 0, height: 0 });
    video.src = url;
  });
}

async function captureBrowserFilmstrip(url: string, duration: number): Promise<Thumbnail[]> {
  if (!duration) return [];
  const video = document.createElement("video");
  video.preload = "auto"; video.muted = true; video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("timeout")), 8000);
      video.onloadeddata = () => { window.clearTimeout(timer); resolve(); };
      video.onerror = () => { window.clearTimeout(timer); reject(new Error("unsupported")); };
    });
    const results: Thumbnail[] = [];
    for (let index = 0; index < 10; index++) {
      const time = Math.min(Math.max(0, duration - 0.08), duration * ((index + 0.5) / 10));
      video.currentTime = time;
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("seek timeout")), 4000);
        video.onseeked = () => { window.clearTimeout(timer); resolve(); };
        video.onerror = () => { window.clearTimeout(timer); reject(new Error("seek error")); };
      });
      const canvas = document.createElement("canvas");
      const ratio = video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
      canvas.width = 180; canvas.height = Math.max(90, Math.round(180 / ratio));
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      results.push({ url: canvas.toDataURL("image/jpeg", 0.72), time });
    }
    return results;
  } catch { return []; }
}

function parseFfmpegInfo(lines: string[], item: VideoItem, ext: string) {
  const inputLine = lines.find((line) => line.includes("Input #0,")) || "";
  const durationLine = lines.find((line) => line.includes("Duration:")) || "";
  const videoLine = lines.find((line) => line.includes("Video:")) || "";
  const audioLine = lines.find((line) => line.includes("Audio:")) || "";
  const durationMatch = durationLine.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = durationMatch ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]) : item.duration;
  const resolution = videoLine.match(/(\d{2,5})x(\d{2,5})/);
  const videoRate = videoLine.match(/(\d+(?:\.\d+)?)\s*kb\/s/);
  const audioRate = audioLine.match(/(\d+(?:\.\d+)?)\s*kb\/s/);
  const sampleRate = audioLine.match(/(\d+)\s*Hz/);
  const fps = videoLine.match(/(\d+(?:\.\d+)?)\s*fps/);
  const profile = videoLine.match(/Video:\s*[^,]+?\s*\(([^)]+)\)/);
  const sourceInfo: SourceInfo = {
    format: inputLine.match(/Input #0,\s*(.+),\s*from/)?.[1] || ext.toUpperCase(),
    videoCodec: videoLine.match(/Video:\s*([^,(]+)/)?.[1]?.trim() || "Không xác định",
    videoProfile: profile?.[1], videoBitrate: videoRate ? Number(videoRate[1]) * 1000 : undefined,
    audioCodec: audioLine.match(/Audio:\s*([^,(]+)/)?.[1]?.trim() || "Không có âm thanh",
    audioBitrate: audioRate ? Number(audioRate[1]) * 1000 : undefined,
    audioChannels: /\bmono\b/.test(audioLine) ? 1 : /\bstereo\b/.test(audioLine) ? 2 : Number(audioLine.match(/(\d+)\s*channels?/)?.[1]) || undefined,
    audioSampleRate: sampleRate ? Number(sampleRate[1]) : undefined, fps: fps?.[1],
  };
  return { sourceInfo, duration, width: resolution ? Number(resolution[1]) : item.width, height: resolution ? Number(resolution[2]) : item.height };
}

export default function App() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [engineLoading, setEngineLoading] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [notice, setNotice] = useState("Video được xử lý cục bộ — không tải lên máy chủ.");
  const inputRef = useRef<HTMLInputElement>(null);
  const ffmpegRef = useRef<FFmpegType | null>(null);
  const enginePromiseRef = useRef<Promise<FFmpegType> | null>(null);
  const analysisQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeIdRef = useRef<string | null>(null);
  const cancelCurrentRef = useRef(false);
  const cancelBatchRef = useRef(false);
  const activeMediaConversionRef = useRef<{ cancel: () => Promise<void> } | null>(null);
  const templateSettingsRef = useRef<Settings>({ ...defaults });

  const selected = useMemo(() => videos.find((v) => v.id === selectedId) ?? videos[0], [videos, selectedId]);
  const checkedCount = videos.filter((v) => v.checked).length;
  const doneCount = videos.filter((v) => v.status === "done").length;
  const failedVideos = videos.filter((v) => v.status === "error");
  const analyzingCount = videos.filter((v) => v.analysisStatus === "running" || v.analysisStatus === "pending").length;
  const totalSize = videos.reduce((sum, item) => sum + item.file.size, 0);
  const allChecked = videos.length > 0 && videos.every((v) => v.checked);

  const loadEngine = async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    if (enginePromiseRef.current) return enginePromiseRef.current;
    setEngineLoading(true); setNotice("Đang khởi động bộ phân tích và mã hóa…");
    enginePromiseRef.current = (async () => {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const ffmpeg = new FFmpeg();
      const runtimeBase = new URL("./ffmpeg/", window.location.href).href;
      const [part1, part2] = await Promise.all([
        fetch(`${runtimeBase}ffmpeg-core.wasm.part1`).then((response) => response.arrayBuffer()),
        fetch(`${runtimeBase}ffmpeg-core.wasm.part2`).then((response) => response.arrayBuffer()),
      ]);
      const wasmURL = URL.createObjectURL(new Blob([part1, part2], { type: "application/wasm" }));
      await ffmpeg.load({ coreURL: `${runtimeBase}ffmpeg-core.js`, wasmURL });
      URL.revokeObjectURL(wasmURL); ffmpegRef.current = ffmpeg; setEngineReady(true); return ffmpeg;
    })();
    try { return await enginePromiseRef.current; }
    finally { enginePromiseRef.current = null; setEngineLoading(false); }
  };

  const resetEngine = () => {
    ffmpegRef.current?.terminate(); ffmpegRef.current = null; enginePromiseRef.current = null; setEngineReady(false); setEngineLoading(false);
  };

  const makeFfmpegThumbnails = async (ffmpeg: FFmpegType, inputName: string, id: string, duration: number) => {
    const thumbs: Thumbnail[] = [];
    for (let index = 0; index < 10; index++) {
      const time = Math.min(Math.max(0, duration - 0.08), duration * ((index + 0.5) / 10));
      const name = `thumb-${id}-${index}.jpg`;
      const result = await ffmpeg.exec(["-ss", String(time), "-i", inputName, "-frames:v", "1", "-vf", "scale=180:-2", "-q:v", "3", "-y", name]);
      if (result === 0) {
        const data = await ffmpeg.readFile(name);
        if (typeof data !== "string") thumbs.push({ url: URL.createObjectURL(new Blob([new Uint8Array(data)], { type: "image/jpeg" })), time });
      }
      await ffmpeg.deleteFile(name).catch(() => undefined);
    }
    return thumbs;
  };

  const analyzeSource = async (item: VideoItem, browserThumbs: Thumbnail[]) => {
    setVideos((all) => all.map((v) => v.id === item.id ? { ...v, analysisStatus: "running", thumbnails: browserThumbs } : v));
    let ffmpeg: FFmpegType | null = null;
    const safeId = item.id.replaceAll("-", "");
    const ext = item.file.name.split(".").pop()?.toLowerCase() || "mp4";
    const inputName = `probe-${safeId}.${ext}`;
    try {
      ffmpeg = await loadEngine();
      const { fetchFile } = await import("@ffmpeg/util");
      await ffmpeg.writeFile(inputName, await fetchFile(item.file));
      const logLines: string[] = [];
      const onLog = ({ message }: { message: string }) => logLines.push(message);
      ffmpeg.on("log", onLog);
      await ffmpeg.exec(["-i", inputName]);
      ffmpeg.off("log", onLog);
      const { sourceInfo, duration, width, height } = parseFfmpegInfo(logLines, item, ext);
      sourceInfo.videoLevel = await readH264Level(item.file);
      if (!logLines.some((line) => line.includes("Input #0,"))) throw new Error("FFmpeg không đọc được tệp.");
      const thumbnails = browserThumbs.length ? browserThumbs : await makeFfmpegThumbnails(ffmpeg, inputName, safeId, duration || 1);
      setVideos((all) => all.map((v) => v.id === item.id ? {
        ...v, duration, width: width || v.width, height: height || v.height,
        settings: { ...v.settings, trimEnd: duration || v.settings.trimEnd }, sourceInfo, thumbnails, analysisStatus: "done",
      } : v));
    } catch {
      setVideos((all) => all.map((v) => v.id === item.id ? { ...v, analysisStatus: "error" } : v));
    } finally {
      if (ffmpeg) await ffmpeg.deleteFile(inputName).catch(() => undefined);
    }
  };

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => /video|mp4|quicktime|avi|matroska|webm|wmv|mpeg/i.test(`${file.type} ${file.name}`));
    if (!list.length) { setNotice("Không tìm thấy tệp video phù hợp."); return; }
    const prepared = await Promise.all(list.map(async (file): Promise<VideoItem> => {
      const meta = await readBrowserMetadata(file);
      return { id: makeId(), file, ...meta, checked: true, analysisStatus: "pending", thumbnails: [], status: "ready", progress: 0, settings: { ...templateSettingsRef.current, trimStart: 0, trimEnd: meta.duration || 0 } };
    }));
    setVideos((old) => [...old, ...prepared]); setSelectedId((old) => old ?? prepared[0].id);
    setNotice(`Đã thêm ${prepared.length} video. Đang đọc codec và tạo thumbnail…`);
    for (const item of prepared) {
      analysisQueueRef.current = analysisQueueRef.current.then(async () => {
        const thumbs = await captureBrowserFilmstrip(item.url, item.duration);
        await analyzeSource(item, thumbs);
      }).catch(() => undefined);
    }
  };

  const updateSettings = (patch: Partial<Settings>) => {
    if (selected) {
      const next = normalize({ ...selected.settings, ...patch });
      templateSettingsRef.current = { ...next };
      setVideos((items) => items.map((item) => item.id === selected.id ? { ...item, settings: next } : item));
    }
  };
  const toggleChecked = (id: string) => setVideos((items) => items.map((item) => item.id === id ? { ...item, checked: !item.checked } : item));
  const toggleAll = () => setVideos((items) => items.map((item) => ({ ...item, checked: !allChecked })));
  const applyToAll = () => {
    if (!selected) return;
    templateSettingsRef.current = { ...selected.settings };
    setVideos((items) => items.map((item) => ({ ...item, settings: { ...selected.settings, trimStart: 0, trimEnd: item.duration || 0 } })));
    setNotice(`Đã áp dụng thiết lập cho tất cả ${videos.length} video. Video thêm sau cũng dùng mẫu này.`);
  };

  const clearAll = () => {
    if (!videos.length || !window.confirm(`Xóa tất cả ${videos.length} video khỏi hàng đợi? Các kết quả chưa tải xuống cũng sẽ bị xóa.`)) return;
    cancelBatchRef.current = true; cancelCurrentRef.current = true;
    void activeMediaConversionRef.current?.cancel().catch(() => undefined);
    if (activeIdRef.current) resetEngine();
    videos.forEach((item) => {
      URL.revokeObjectURL(item.url);
      if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
      item.thumbnails.forEach((thumb) => thumb.url.startsWith("blob:") && URL.revokeObjectURL(thumb.url));
    });
    setVideos([]); setSelectedId(null); setIsBatchRunning(false);
    setNotice("Đã xóa tất cả video khỏi hàng đợi.");
  };

  const removeVideo = (id: string) => {
    if (activeIdRef.current === id) stopCurrentVideo(id);
    setVideos((items) => {
      const target = items.find((item) => item.id === id);
      if (target) { URL.revokeObjectURL(target.url); if (target.outputUrl) URL.revokeObjectURL(target.outputUrl); target.thumbnails.forEach((thumb) => thumb.url.startsWith("blob:") && URL.revokeObjectURL(thumb.url)); }
      const next = items.filter((item) => item.id !== id); if (selectedId === id) setSelectedId(next[0]?.id ?? null); return next;
    });
  };

  const buildArgs = (item: VideoItem, inputName: string, outputName: string) => {
    const s = item.settings, args: string[] = [];
    if (s.trimStart > 0) args.push("-ss", String(s.trimStart)); args.push("-i", inputName);
    if (s.trimEnd > s.trimStart && s.trimEnd < item.duration - 0.05) args.push("-t", String(s.trimEnd - s.trimStart));
    args.push("-c:v", s.videoCodec);
    if (s.videoCodec === "libx264") {
      args.push("-preset", "veryfast", "-crf", s.videoBitrate === "auto" ? "23" : "21", "-pix_fmt", "yuv420p");
      if (s.h264Level !== "auto") {
        if (s.h264Level === "2.1" || s.h264Level === "2.2") args.push("-profile:v", "main");
        args.push("-level:v", s.h264Level);
      }
    }
    if (s.videoCodec === "libvpx-vp9") args.push("-crf", s.videoBitrate === "auto" ? "32" : "28", "-b:v", s.videoBitrate === "auto" ? "0" : s.videoBitrate);
    if (s.videoCodec === "mpeg4") args.push("-q:v", "4");
    if (s.videoBitrate !== "auto" && s.videoCodec !== "libvpx-vp9") args.push("-b:v", s.videoBitrate);
    const filters: string[] = [];
    if (s.aspect !== "source") { const ratio = s.aspect.replace(":", "/"); filters.push(`crop='min(iw,ih*${ratio})':'min(ih,iw/(${ratio}))'`); }
    const heights: Record<string, number> = { "2160": 2160, "1080": 1080, "720": 720, "480": 480 }, height = heights[s.resolution];
    let size = s.resolution === "custom" ? `${s.customWidth}:${s.customHeight}` : undefined;
    if (height) { const d = s.aspect === "9:16" ? [height, Math.round(height * 16 / 9)] : s.aspect === "1:1" ? [height, height] : s.aspect === "4:3" ? [Math.round(height * 4 / 3), height] : [Math.round(height * 16 / 9), height]; size = `${d[0] % 2 ? d[0] + 1 : d[0]}:${d[1] % 2 ? d[1] + 1 : d[1]}`; }
    if (size) filters.push(`scale=${size}:force_original_aspect_ratio=decrease,pad=${size}:(ow-iw)/2:(oh-ih)/2`); if (filters.length) args.push("-vf", filters.join(","));
    if (s.audioCodec === "none") {
      args.push("-an");
    } else {
      args.push("-c:a", s.audioCodec, "-b:a", s.audioBitrate);
      if (s.audioChannels !== "source") args.push("-ac", s.audioChannels);
      if (s.audioSampleRate !== "source") args.push("-ar", s.audioSampleRate);
    }
    if (s.format === "mp4" || s.format === "mov") args.push("-movflags", "+faststart"); args.push("-y", outputName); return args;
  };

  const encodeH264WithBrowserCodecs = async (item: VideoItem) => {
    const {
      ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, Quality,
    } = await import("mediabunny");
    if (item.settings.format !== "mp4" || item.settings.videoCodec !== "libx264") {
      throw new Error("WebCodecs hiện được dùng khi đầu ra là MP4 và H.264.");
    }

    const target = new BufferTarget();
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(item.file) });
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
    const s = item.settings;
    const videoOptions: {
      codec: "avc";
      quality: InstanceType<typeof Quality>;
      forceTranscode: true;
      width?: number;
      height?: number;
      fit?: "contain";
      frameRate?: number;
    } = {
      codec: "avc",
      quality: s.videoBitrate === "auto" ? new Quality("high") : new Quality({ bitrate: parseBitrate(s.videoBitrate) }),
      forceTranscode: true,
    };

    const heights: Record<string, number> = { "2160": 2160, "1080": 1080, "720": 720, "480": 480 };
    if (s.resolution === "custom") {
      videoOptions.width = Math.max(16, Math.round(s.customWidth / 2) * 2);
      videoOptions.height = Math.max(16, Math.round(s.customHeight / 2) * 2);
      videoOptions.fit = "contain";
    } else if (heights[s.resolution]) {
      const height = heights[s.resolution];
      const ratio = s.aspect === "9:16" ? 9 / 16 : s.aspect === "1:1" ? 1 : s.aspect === "4:3" ? 4 / 3 : 16 / 9;
      videoOptions.height = height;
      videoOptions.width = Math.round(height * ratio / 2) * 2;
      videoOptions.fit = "contain";
    }

    const canCopySourceAac = s.audioCodec !== "none" && item.sourceInfo?.audioCodec.toLowerCase() === "aac";
    const audio = s.audioCodec === "none" ? { discard: true as const } : canCopySourceAac ? {
      codec: "aac" as const,
    } : {
      codec: "aac" as const,
      quality: new Quality({ bitrate: parseBitrate(s.audioBitrate) || 128_000 }),
      forceTranscode: true as const,
      numberOfChannels: s.audioChannels === "source" ? undefined : Number(s.audioChannels),
      sampleRate: s.audioSampleRate === "source" ? undefined : Number(s.audioSampleRate),
    };
    const trimChanged = s.trimStart > 0 || (s.trimEnd > s.trimStart && s.trimEnd < item.duration - 0.05);
    const conversion = await Conversion.init({
      input, output, tracks: "primary", video: videoOptions, audio,
      trim: trimChanged ? { start: s.trimStart, end: s.trimEnd } : undefined,
      tags: {}, showWarnings: false,
    });
    activeMediaConversionRef.current = conversion;
    const discardedRequiredAudio = s.audioCodec !== "none" && conversion.discardedTracks.find((entry) => entry.track.isAudioTrack());
    if (!conversion.isValid || discardedRequiredAudio) {
      const reasons = conversion.discardedTracks.map((entry) => entry.reason).join(", ");
      throw new Error(`Trình duyệt không thể thực hiện đầy đủ chuyển đổi sang H.264/AAC (${reasons || "không rõ nguyên nhân"}).`);
    }
    conversion.onProgress = (progress) => setVideos((all) => all.map((v) => v.id === item.id ? { ...v, progress: Math.min(99, Math.max(0, Math.round(progress * 100))) } : v));
    await conversion.execute();
    if (cancelCurrentRef.current) throw new Error("Đã dừng theo yêu cầu.");
    if (!target.buffer) throw new Error("Bộ mã hóa trình duyệt không tạo được dữ liệu đầu ra.");
    return new Uint8Array(target.buffer);
  };

  const encodeOne = async (item: VideoItem) => {
    cancelCurrentRef.current = false; activeIdRef.current = item.id;
    if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
    setVideos((all) => all.map((v) => v.id === item.id ? { ...v, status: "encoding", progress: 0, error: undefined, encodeError: undefined, outputUrl: undefined, outputName: undefined, outputInfo: undefined, outputDuration: undefined, outputWidth: undefined, outputHeight: undefined, outputSize: undefined } : v));
    let ffmpeg: FFmpegType | null = null; let onProgress: ((data: { progress: number }) => void) | null = null;
    let onLog: ((data: { message: string }) => void) | null = null; const logs: string[] = [];
    const safeId = item.id.replaceAll("-", ""), ext = item.file.name.split(".").pop()?.toLowerCase() || "mp4";
    const inputName = `input-${safeId}.${ext}`, outputName = `output-${safeId}.${item.settings.format}`, browserOutputName = `browser-${safeId}.mp4`;
    try {
      let bytes: Uint8Array;
      const sourceCodec = item.sourceInfo?.videoCodec.toLowerCase() || "";
      const useBrowserH264 = (sourceCodec === "av1" || sourceCodec === "h264" || sourceCodec.startsWith("avc"))
        && item.settings.format === "mp4"
        && item.settings.videoCodec === "libx264"
        && (item.settings.h264Level === "auto" || item.settings.h264Level === "3.1");
      let browserBytes: Uint8Array | undefined;
      if (useBrowserH264) {
        try {
          browserBytes = await encodeH264WithBrowserCodecs(item);
        } catch (browserError) {
          if (cancelCurrentRef.current) throw browserError;
          activeMediaConversionRef.current = null;
          const reason = browserError instanceof Error ? browserError.message : String(browserError);
          logs.push(`WebCodecs fallback: ${reason}`);
          setNotice("WebCodecs không hỗ trợ cấu hình này trên máy hiện tại; đang tự chuyển sang FFmpeg.");
        }
      }
      if (browserBytes) {
        bytes = browserBytes;
        ffmpeg = await loadEngine();
        onLog = ({ message }) => { logs.push(message); if (logs.length > 160) logs.shift(); };
        ffmpeg.on("log", onLog);
        await ffmpeg.writeFile(browserOutputName, new Uint8Array(bytes));
        const audioArgs = item.settings.audioCodec === "none" ? ["-an"] : [
          "-c:a", item.settings.audioCodec, "-b:a", item.settings.audioBitrate,
          ...(item.settings.audioCodec === "aac" ? ["-profile:a", "aac_low"] : []),
          ...(item.settings.audioChannels === "source" ? [] : ["-ac", item.settings.audioChannels]),
          ...(item.settings.audioSampleRate === "source" ? [] : ["-ar", item.settings.audioSampleRate]),
        ];
        const audioExitCode = await ffmpeg.exec(["-i", browserOutputName, "-c:v", "copy", ...audioArgs, "-movflags", "+faststart", "-y", outputName]);
        if (cancelCurrentRef.current) throw new Error("Đã dừng theo yêu cầu.");
        if (audioExitCode !== 0) throw new Error("Không thể tạo lại âm thanh theo bitrate đã chọn.");
        const audioFixedData = await ffmpeg.readFile(outputName);
        bytes = typeof audioFixedData === "string" ? new TextEncoder().encode(audioFixedData) : new Uint8Array(audioFixedData);
      } else {
        ffmpeg = await loadEngine(); const { fetchFile } = await import("@ffmpeg/util");
        onProgress = ({ progress }) => setVideos((all) => all.map((v) => v.id === item.id ? { ...v, progress: Math.min(99, Math.max(0, Math.round(progress * 100))) } : v));
        onLog = ({ message }) => { logs.push(message); if (logs.length > 160) logs.shift(); };
        ffmpeg.on("progress", onProgress); ffmpeg.on("log", onLog); await ffmpeg.writeFile(inputName, await fetchFile(item.file));
        const exitCode = await ffmpeg.exec(buildArgs(item, inputName, outputName));
        if (cancelCurrentRef.current) throw new Error("Đã dừng theo yêu cầu."); if (exitCode !== 0) throw new Error("Bộ mã hóa không thể xử lý thiết lập này.");
        const data = await ffmpeg.readFile(outputName); bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
      }
      const outputBlob = new Blob([new Uint8Array(bytes)], { type: `video/${item.settings.format}` });
      let outputInfo: SourceInfo = {
        format: item.settings.format.toUpperCase(),
        videoCodec: item.settings.videoCodec === "libx264" ? "h264" : item.settings.videoCodec === "libvpx-vp9" ? "vp9" : "mpeg4",
        videoBitrate: parseBitrate(item.settings.videoBitrate),
        videoLevel: item.settings.videoCodec === "libx264" && item.settings.h264Level !== "auto" ? item.settings.h264Level : undefined,
        audioCodec: item.settings.audioCodec === "none" ? "Không có âm thanh" : item.settings.audioCodec.replace("libmp3lame", "mp3").replace("libopus", "opus").replace("libvorbis", "vorbis"),
        audioBitrate: item.settings.audioCodec === "none" ? undefined : parseBitrate(item.settings.audioBitrate),
        audioChannels: item.settings.audioChannels === "source" ? item.sourceInfo?.audioChannels : Number(item.settings.audioChannels),
        audioSampleRate: item.settings.audioSampleRate === "source" ? item.sourceInfo?.audioSampleRate : Number(item.settings.audioSampleRate),
      };
      let outputDuration = item.settings.trimEnd > item.settings.trimStart ? item.settings.trimEnd - item.settings.trimStart : item.duration;
      let outputWidth = item.settings.resolution === "custom" ? item.settings.customWidth : item.width;
      let outputHeight = item.settings.resolution === "custom" ? item.settings.customHeight : item.height;
      try {
        if (!ffmpeg) {
          ffmpeg = await loadEngine();
          await ffmpeg.writeFile(outputName, new Uint8Array(bytes));
        }
        const probeLogs: string[] = [];
        const probeLog = ({ message }: { message: string }) => probeLogs.push(message);
        ffmpeg.on("log", probeLog);
        await ffmpeg.exec(["-i", outputName]);
        ffmpeg.off("log", probeLog);
        const parsed = parseFfmpegInfo(probeLogs, item, item.settings.format);
        outputInfo = parsed.sourceInfo;
        outputInfo.videoLevel = await readH264Level(outputBlob);
        outputDuration = parsed.duration;
        outputWidth = parsed.width;
        outputHeight = parsed.height;
      } catch { /* Giữ thông số suy ra nếu bước đọc kết quả không khả dụng. */ }
      const url = URL.createObjectURL(outputBlob);
      const base = item.file.name.replace(/\.[^.]+$/, "");
      setVideos((all) => all.map((v) => v.id === item.id ? { ...v, status: "done", progress: 100, outputUrl: url, outputName: `${base}-encoded.${item.settings.format}`, outputInfo, outputDuration, outputWidth, outputHeight, outputSize: bytes.byteLength } : v));
      return true;
    } catch (error) {
      const encodeError = makeEncodeError(error, logs, item);
      setVideos((all) => all.map((v) => v.id === item.id ? { ...v, status: cancelCurrentRef.current ? "stopped" : "error", error: encodeError.message, encodeError } : v));
      return false;
    } finally {
      if (ffmpeg && ffmpegRef.current) { if (onProgress) ffmpeg.off("progress", onProgress); if (onLog) ffmpeg.off("log", onLog); await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName), ffmpeg.deleteFile(browserOutputName)]); }
      activeMediaConversionRef.current = null; activeIdRef.current = null;
    }
  };

  const encodeChecked = async () => {
    const queue = videos.filter((video) => video.checked && video.status !== "done"); if (!queue.length) return;
    cancelBatchRef.current = false; setIsBatchRunning(true);
    setVideos((all) => all.map((v) => v.checked && v.status !== "done" ? { ...v, status: "queued" } : v));
    let completed = 0, failed = 0;
    for (const item of queue) {
      if (cancelBatchRef.current) break;
      const success = await encodeOne(item); success ? completed++ : failed++;
    }
    setIsBatchRunning(false);
    setNotice(cancelBatchRef.current ? "Đã dừng toàn bộ hàng đợi." : failed ? `Hoàn tất ${completed} video, có ${failed} video lỗi. Chọn video lỗi để xem nguyên nhân.` : `Đã mã hóa thành công ${completed} video.`);
  };

  const stopCurrentVideo = (id: string) => {
    if (activeIdRef.current !== id) return;
    cancelCurrentRef.current = true; void activeMediaConversionRef.current?.cancel().catch(() => undefined); resetEngine();
    setVideos((all) => all.map((v) => v.id === id ? { ...v, status: "stopped", error: "Đã dừng ngay theo yêu cầu." } : v));
    setNotice("Đã dừng video hiện tại. Các video còn lại vẫn tiếp tục nếu đang chạy hàng loạt.");
  };
  const stopBatch = () => {
    cancelBatchRef.current = true; cancelCurrentRef.current = true; void activeMediaConversionRef.current?.cancel().catch(() => undefined); resetEngine(); setIsBatchRunning(false);
    setVideos((all) => all.map((v) => v.status === "encoding" ? { ...v, status: "stopped", error: "Đã dừng hàng loạt." } : v.status === "queued" ? { ...v, status: "ready" } : v));
    setNotice("Đã dừng ngay toàn bộ tiến trình hàng loạt.");
  };

  const fullscreen = async (id: string) => {
    const video = document.getElementById(id) as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!video) return; if (video.requestFullscreen) await video.requestFullscreen(); else video.webkitEnterFullscreen?.();
  };
  const jumpToThumbnail = (item: VideoItem, thumb: Thumbnail) => { const video = document.getElementById(`source-${item.id}`) as HTMLVideoElement | null; if (video) { video.currentTime = thumb.time; void video.play(); } };
  const drop = (event: DragEvent) => { event.preventDefault(); setDragging(false); void addFiles(event.dataTransfer.files); };
  const changeFiles = (event: ChangeEvent<HTMLInputElement>) => { if (event.target.files) void addFiles(event.target.files); event.target.value = ""; };

  return (
    <main className="app-shell">
      <header className="topbar"><div className="brand"><span className="brand-mark">VE</span><div><h1>Video Encode Studio</h1><p>Chuyển đổi video an toàn trên trình duyệt</p></div></div><div className="privacy-pill"><span className="status-dot" /> Xử lý cục bộ</div></header>
      <section className="workspace">
        <aside className="queue-panel">
          <div className="panel-heading"><div><span className="eyebrow">HÀNG ĐỢI</span><h2>{videos.length ? `${videos.length} video` : "Video của bạn"}</h2></div>{videos.length > 0 && <div className="queue-actions"><button className="text-button delete-all" onClick={clearAll}>Xóa tất cả</button><button className="text-button" onClick={() => inputRef.current?.click()}>+ Thêm</button></div>}</div>
          <input ref={inputRef} className="sr-only" type="file" multiple accept={accepted} onChange={changeFiles} />
          {!videos.length ? <button className={`dropzone ${dragging ? "is-dragging" : ""}`} onClick={() => inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}><span className="upload-icon">↥</span><strong>Thả video vào đây</strong><span>hoặc nhấn để chọn nhiều tệp</span><small>MP4, MOV, AVI, WMV, WebM, MKV…</small></button> : <>
            <label className="select-all"><input type="checkbox" checked={allChecked} onChange={toggleAll} /> <span>Chọn tất cả</span><b>{checkedCount} đã chọn</b></label>
            <button className={`add-more-dropzone ${dragging ? "is-dragging" : ""}`} onClick={() => inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}><span>↥</span><strong>Kéo thả thêm video vào đây</strong><small>hoặc nhấn để chọn tệp</small></button>
            <div className="queue-list">{videos.map((item, index) => <div key={item.id} className={`video-card ${selected?.id === item.id ? "active" : ""} ${item.outputUrl ? "has-output" : ""}`}>
              <label className="file-check" title="Chọn để xử lý hàng loạt"><input type="checkbox" checked={item.checked} onChange={() => toggleChecked(item.id)} /></label>
              <button className="video-select" onClick={() => setSelectedId(item.id)}><span className="thumb">{item.thumbnails[0] ? <img src={item.thumbnails[0].url} alt="" /> : <video src={item.url} muted preload="metadata" />}<span>{formatTime(item.duration)}</span></span><span className="video-info"><strong title={item.file.name}>{item.file.name}</strong>{item.sourceInfo ? <small className="queue-spec source"><b>Gốc</b>{videoSummary(item.sourceInfo, item.duration, item.file.size)}</small> : <small>{item.analysisStatus === "error" ? "Không đọc được thông số video" : "Đang đọc codec, bitrate, thời lượng…"}</small>}{item.outputInfo && <small className="queue-spec output"><b>Nén</b>{videoSummary(item.outputInfo, item.outputDuration || item.duration, item.outputSize || 0)}</small>}<span className={`state state-${item.status}`} title={item.encodeError?.message}>{item.status === "ready" ? "Sẵn sàng" : item.status === "queued" ? "Đang chờ" : item.status === "encoding" ? `Đang mã hóa ${item.progress}%` : item.status === "done" ? "Hoàn tất" : item.status === "stopped" ? "Đã dừng" : item.encodeError?.title || "Có lỗi"}</span>{item.status === "encoding" && <i className="progress"><i style={{ width: `${item.progress}%` }} /></i>}</span><span className="index">{String(index + 1).padStart(2, "0")}</span></button>
              {item.outputUrl && <a className="queue-download" href={item.outputUrl} download={item.outputName} title={`Tải xuống ${item.outputName}`} onClick={(event) => event.stopPropagation()}>↓ Tải</a>}
              {item.status === "encoding" && <button className="row-stop" onClick={() => stopCurrentVideo(item.id)} title="Dừng ngay video này">■</button>}
            </div>)}</div>
          </>}
          {videos.length > 0 && <div className="queue-summary"><span>{formatBytes(totalSize)}</span><span>{doneCount}/{videos.length} hoàn tất</span></div>}
          {failedVideos.length > 0 && <section className="batch-errors"><strong>⚠ {failedVideos.length} video cần kiểm tra</strong>{failedVideos.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)}><span>{item.file.name}</span><small>{item.encodeError?.title || item.error || "Mã hóa không thành công"}</small></button>)}</section>}
        </aside>

        <section className="editor-panel">{!selected ? <div className="empty-editor"><span>▶</span><h2>Chưa có video</h2><p>Thêm một hoặc nhiều video để bắt đầu chuyển đổi.</p></div> : <>
          <div className="editor-title"><div><span className="eyebrow">THIẾT LẬP VIDEO</span><h2>{selected.file.name}</h2></div><button className="remove-button" onClick={() => removeVideo(selected.id)}>Xóa</button></div>
          <div className={`preview-grid ${selected.outputUrl ? "has-output" : ""}`}>
            <article className="video-preview-card"><div className="preview-card-head"><div><span>VIDEO GỐC</span><strong>{selected.width || "?"} × {selected.height || "?"}</strong></div><button onClick={() => void fullscreen(`source-${selected.id}`)}>⛶ Toàn màn hình</button></div><video id={`source-${selected.id}`} src={selected.url} controls preload="metadata" /></article>
            {selected.outputUrl ? <article className="video-preview-card output"><div className="preview-card-head"><div><span>SAU MÃ HÓA</span><strong>{selected.settings.format.toUpperCase()} · {selected.settings.videoCodec === "libx264" ? "H.264" : selected.settings.videoCodec === "libvpx-vp9" ? "VP9" : "MPEG-4"}</strong></div><button onClick={() => void fullscreen(`output-${selected.id}`)}>⛶ Toàn màn hình</button></div><video id={`output-${selected.id}`} src={selected.outputUrl} controls preload="metadata" /></article> : <article className="output-placeholder"><span>→</span><strong>Xem trước sau mã hóa</strong><small>Video kết quả sẽ xuất hiện tại đây để so sánh chất lượng.</small></article>}
          </div>

          <section className="source-info"><div className="section-title"><div><span className="eyebrow">THÔNG TIN FILE GỐC</span><h3>Thông số kỹ thuật</h3></div><span className={`analysis-badge ${selected.analysisStatus}`}>{selected.analysisStatus === "done" ? "Đã đọc bằng FFmpeg" : selected.analysisStatus === "error" ? "Không đọc được" : "Đang phân tích…"}</span></div><div className="metadata-grid"><div><span>Định dạng</span><strong>{selected.sourceInfo?.format || selected.file.name.split(".").pop()?.toUpperCase()}</strong></div><div><span>Video codec</span><strong>{selected.sourceInfo?.videoCodec || "Đang đọc…"}</strong><small>{[selected.sourceInfo?.videoProfile, selected.sourceInfo?.videoLevel ? `Level ${selected.sourceInfo.videoLevel}` : ""].filter(Boolean).join(" · ")}</small></div><div><span>Video bitrate</span><strong>{formatBitrate(selected.sourceInfo?.videoBitrate)}</strong></div><div><span>Audio codec</span><strong>{selected.sourceInfo?.audioCodec || "Đang đọc…"}</strong><small>{selected.sourceInfo?.audioChannels ? `${selected.sourceInfo.audioChannels} kênh · ${selected.sourceInfo.audioSampleRate || "?"} Hz` : ""}</small></div><div><span>Audio bitrate</span><strong>{formatBitrate(selected.sourceInfo?.audioBitrate)}</strong></div><div><span>Thời lượng / dung lượng</span><strong>{formatTime(selected.duration)} · {formatBytes(selected.file.size)}</strong></div></div></section>

          <section className="filmstrip-section"><div className="section-title"><div><span className="eyebrow">THUMBNAIL THEO THỜI GIAN</span><h3>10 đoạn đại diện của video</h3></div><small>Nhấn vào ảnh để xem đúng thời điểm</small></div><div className="filmstrip">{selected.thumbnails.length ? selected.thumbnails.map((thumb, index) => <button key={`${thumb.time}-${index}`} onClick={() => jumpToThumbnail(selected, thumb)}><img src={thumb.url} alt={`Đoạn ${index + 1}`} /><span>{formatTime(thumb.time)}</span></button>) : Array.from({ length: 10 }, (_, index) => <i key={index} className="thumb-skeleton" />)}</div></section>

          <div className="settings-grid">
            <fieldset><legend>Hình ảnh</legend><label>Định dạng<select value={selected.settings.format} onChange={(e) => updateSettings({ format: e.target.value as Format })}><option value="mp4">MP4</option><option value="mov">MOV</option><option value="webm">WebM</option><option value="mkv">MKV</option></select></label><label>Video codec<select value={selected.settings.videoCodec} onChange={(e) => updateSettings({ videoCodec: e.target.value as VideoCodec })}><option value="libx264">H.264 — tương thích cao</option><option value="libvpx-vp9">VP9 — dung lượng nhỏ</option><option value="mpeg4">MPEG-4</option></select></label><label>H.264 Level<select disabled={selected.settings.videoCodec !== "libx264"} value={selected.settings.h264Level} onChange={(e) => updateSettings({ h264Level: e.target.value as H264Level })}><option value="auto">Tự động</option><option value="2.1">Level 2.1</option><option value="2.2">Level 2.2 — đầu xe đời cũ</option><option value="3.0">Level 3.0</option><option value="3.1">Level 3.1</option><option value="4.0">Level 4.0</option><option value="4.1">Level 4.1</option></select></label><label>Video bitrate<select value={selected.settings.videoBitrate} onChange={(e) => updateSettings({ videoBitrate: e.target.value })}><option value="auto">Tự động (khuyên dùng)</option><option value="100k">100 kbps — cực nhỏ</option><option value="150k">150 kbps</option><option value="200k">200 kbps</option><option value="250k">250 kbps</option><option value="300k">300 kbps — rất nhỏ</option><option value="500k">500 kbps</option><option value="800k">800 kbps — phù hợp 360p/480p</option><option value="1M">1 Mbps</option><option value="1500k">1,5 Mbps</option><option value="2M">2 Mbps</option><option value="5M">5 Mbps</option><option value="10M">10 Mbps</option><option value="20M">20 Mbps</option></select></label><small className="setting-hint">AV1 thường cần bitrate thấp hơn H.264 để đạt chất lượng tương đương.</small></fieldset>
            <fieldset><legend>Âm thanh</legend><label>Audio codec<select value={selected.settings.audioCodec} onChange={(e) => updateSettings({ audioCodec: e.target.value as AudioCodec })}><option value="aac">AAC</option><option value="libmp3lame">MP3</option><option value="libopus">Opus</option><option value="libvorbis">Vorbis</option><option value="none">Không có âm thanh</option></select></label><label>Audio bitrate<select disabled={selected.settings.audioCodec === "none"} value={selected.settings.audioBitrate} onChange={(e) => updateSettings({ audioBitrate: e.target.value })}><option value="96k">96 kbps</option><option value="128k">128 kbps</option><option value="192k">192 kbps</option><option value="256k">256 kbps</option><option value="320k">320 kbps</option></select></label><label>Số kênh<select disabled={selected.settings.audioCodec === "none"} value={selected.settings.audioChannels} onChange={(e) => updateSettings({ audioChannels: e.target.value as AudioChannels })}><option value="source">Giữ nguyên{selected.sourceInfo?.audioChannels ? ` · ${selected.sourceInfo.audioChannels} kênh` : ""}</option><option value="1">Mono · 1 kênh</option><option value="2">Stereo · 2 kênh</option></select></label><label>Tần số âm thanh<select disabled={selected.settings.audioCodec === "none"} value={selected.settings.audioSampleRate} onChange={(e) => updateSettings({ audioSampleRate: e.target.value as AudioSampleRate })}><option value="source">Giữ nguyên{selected.sourceInfo?.audioSampleRate ? ` · ${selected.sourceInfo.audioSampleRate} Hz` : ""}</option><option value="32000">32.000 Hz</option><option value="44100">44.100 Hz</option><option value="48000">48.000 Hz</option></select></label></fieldset>
            <fieldset><legend>Khung hình</legend><label>Kích thước<select value={selected.settings.resolution} onChange={(e) => updateSettings({ resolution: e.target.value })}><option value="source">Giữ nguyên</option><option value="2160">4K · 3840×2160</option><option value="1080">Full HD · 1920×1080</option><option value="720">HD · 1280×720</option><option value="480">SD · 854×480</option><option value="custom">Tùy chỉnh</option></select></label><label>Tỉ lệ<select value={selected.settings.aspect} onChange={(e) => updateSettings({ aspect: e.target.value })}><option value="source">Giữ nguyên</option><option value="16:9">16:9 ngang</option><option value="9:16">9:16 dọc</option><option value="4:3">4:3</option><option value="1:1">1:1 vuông</option></select></label>{selected.settings.resolution === "custom" && <div className="dimension-row"><input aria-label="Chiều rộng" type="number" min="16" value={selected.settings.customWidth} onChange={(e) => updateSettings({ customWidth: Number(e.target.value) })}/><span>×</span><input aria-label="Chiều cao" type="number" min="16" value={selected.settings.customHeight} onChange={(e) => updateSettings({ customHeight: Number(e.target.value) })}/></div>}</fieldset>
            <fieldset><legend>Cắt video</legend><div className="trim-row"><label>Bắt đầu<input type="number" min="0" max={selected.settings.trimEnd} step="0.1" value={selected.settings.trimStart} onChange={(e) => updateSettings({ trimStart: Math.max(0, Number(e.target.value)) })}/><small>giây</small></label><label>Kết thúc<input type="number" min={selected.settings.trimStart} max={selected.duration} step="0.1" value={Number(selected.settings.trimEnd.toFixed(1))} onChange={(e) => updateSettings({ trimEnd: Math.min(selected.duration, Number(e.target.value)) })}/><small>giây</small></label></div><div className="trim-track"><i style={{ left: `${selected.duration ? selected.settings.trimStart / selected.duration * 100 : 0}%`, right: `${selected.duration ? 100 - selected.settings.trimEnd / selected.duration * 100 : 0}%` }} /></div><small>Thời lượng sau cắt: {formatTime(selected.settings.trimEnd - selected.settings.trimStart)}</small></fieldset>
          </div>
          {selected.outputUrl && <a className="download-card" href={selected.outputUrl} download={selected.outputName}><span>✓</span><div><strong>Video đã sẵn sàng</strong><small>{selected.outputName}</small></div><b>Tải xuống</b></a>}
          {selected.encodeError ? <section className="error-note detailed"><div className="error-heading"><span>!</span><div><small>MÃ LỖI: {selected.encodeError.code}</small><strong>{selected.encodeError.title}</strong></div></div><p>{selected.encodeError.message}</p><div className="error-context"><span>Tệp gốc</span><b>{selected.sourceInfo?.videoCodec?.toUpperCase() || "?"} · {selected.width || "?"} × {selected.height || "?"}</b><span>Đầu ra đã chọn</span><b>{selected.settings.format.toUpperCase()} · {selected.settings.videoCodec === "libx264" ? "H.264" : selected.settings.videoCodec === "libvpx-vp9" ? "VP9" : "MPEG-4"}</b></div><ul>{selected.encodeError.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul>{selected.encodeError.technical && <details><summary>Xem chi tiết kỹ thuật</summary><pre>{selected.encodeError.technical}</pre></details>}</section> : selected.error && <div className="error-note">{selected.error}</div>}

        </>}
          {/* Module Tạo Phụ Đề AI */}
          <SubtitleGenerator ffmpegLoader={loadEngine} selectedVideoFile={selected?.file} />
        </section>
      </section>

      <footer className="actionbar"><div className="footer-status"><span className={engineReady ? "engine ready" : "engine"}>{analyzingCount ? `Đang đọc thông tin gốc: còn ${analyzingCount} video…` : engineReady ? "Bộ mã hóa đã sẵn sàng" : engineLoading ? "Đang khởi động bộ mã hóa…" : notice}</span><small>Phát triển bởi ThS. Trần Quang Hải &amp; ChatGPT (OpenAI) · Phiên bản {APP_VERSION}</small></div><div className="actions"><button className="secondary" disabled={!selected || !videos.length || isBatchRunning} onClick={applyToAll}>Áp dụng cho tất cả tệp</button>{selected?.status === "encoding" && !isBatchRunning && <button className="danger" onClick={() => stopCurrentVideo(selected.id)}>Dừng video này</button>}{isBatchRunning ? <button className="danger" onClick={stopBatch}>Dừng hàng loạt</button> : <><button className="secondary compact" disabled={!selected || analyzingCount > 0} onClick={() => selected && void encodeOne(selected)}>Mã hóa video này</button><button className="primary" disabled={!checkedCount || engineLoading || analyzingCount > 0} onClick={() => void encodeChecked()}>Mã hóa {checkedCount} video <span>→</span></button></>}</div></footer>
    </main>
  );
}

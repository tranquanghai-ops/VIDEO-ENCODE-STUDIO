import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

type Status = "ready" | "queued" | "encoding" | "done" | "error" | "stopped";
type AnalysisStatus = "pending" | "running" | "done" | "error";
type Format = "mp4" | "mov" | "webm" | "mkv";
type VideoCodec = "libx264" | "libvpx-vp9" | "mpeg4";
type AudioCodec = "aac" | "libmp3lame" | "libopus" | "libvorbis" | "none";

type Settings = {
  format: Format;
  videoCodec: VideoCodec;
  videoBitrate: string;
  audioCodec: AudioCodec;
  audioBitrate: string;
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
  videoBitrate?: number;
  audioCodec: string;
  audioBitrate?: number;
  audioChannels?: number;
  audioSampleRate?: number;
  fps?: string;
};

type Thumbnail = { url: string; time: number };

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
  error?: string;
};

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  codec_long_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  bit_rate?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
};

type ProbeResult = {
  format?: { format_name?: string; format_long_name?: string; duration?: string; bit_rate?: string };
  streams?: ProbeStream[];
};

const defaults: Settings = {
  format: "mp4", videoCodec: "libx264", videoBitrate: "auto", audioCodec: "aac", audioBitrate: "192k",
  resolution: "source", customWidth: 1920, customHeight: 1080, aspect: "source", trimStart: 0, trimEnd: 0,
};

const accepted = ".mp4,.mov,.avi,.wmv,.webm,.mkv,.m4v,.mpeg,.mpg";
const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const safeNumber = (value?: string | number) => value ? Number(value) : undefined;
const formatBytes = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(n < 1e6 ? 2 : 1)} MB`;
const formatBitrate = (n?: number) => !n ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)} Mbps` : `${Math.round(n / 1000)} kbps`;
const formatTime = (s: number) => {
  const value = Math.max(0, Number.isFinite(s) ? s : 0);
  const h = Math.floor(value / 3600), m = Math.floor((value % 3600) / 60), sec = Math.floor(value % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

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

  const selected = useMemo(() => videos.find((v) => v.id === selectedId) ?? videos[0], [videos, selectedId]);
  const checkedCount = videos.filter((v) => v.checked).length;
  const doneCount = videos.filter((v) => v.status === "done").length;
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
    const inputName = `probe-${safeId}.${ext}`, probeName = `probe-${safeId}.json`;
    try {
      ffmpeg = await loadEngine();
      const { fetchFile } = await import("@ffmpeg/util");
      await ffmpeg.writeFile(inputName, await fetchFile(item.file));
      const code = await ffmpeg.ffprobe(["-v", "error", "-show_format", "-show_streams", "-of", "json", inputName, "-o", probeName]);
      if (code !== 0) throw new Error("FFprobe không đọc được tệp.");
      const raw = await ffmpeg.readFile(probeName, "utf8");
      const probe = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) as ProbeResult;
      const videoStream = probe.streams?.find((stream) => stream.codec_type === "video");
      const audioStream = probe.streams?.find((stream) => stream.codec_type === "audio");
      const duration = safeNumber(probe.format?.duration) || item.duration;
      const sourceInfo: SourceInfo = {
        format: probe.format?.format_long_name || probe.format?.format_name || ext.toUpperCase(),
        videoCodec: videoStream?.codec_long_name || videoStream?.codec_name || "Không xác định",
        videoProfile: videoStream?.profile, videoBitrate: safeNumber(videoStream?.bit_rate) || safeNumber(probe.format?.bit_rate),
        audioCodec: audioStream?.codec_long_name || audioStream?.codec_name || "Không có âm thanh",
        audioBitrate: safeNumber(audioStream?.bit_rate), audioChannels: audioStream?.channels,
        audioSampleRate: safeNumber(audioStream?.sample_rate), fps: videoStream?.r_frame_rate,
      };
      const thumbnails = browserThumbs.length ? browserThumbs : await makeFfmpegThumbnails(ffmpeg, inputName, safeId, duration || 1);
      setVideos((all) => all.map((v) => v.id === item.id ? {
        ...v, duration, width: videoStream?.width || v.width, height: videoStream?.height || v.height,
        settings: { ...v.settings, trimEnd: duration || v.settings.trimEnd }, sourceInfo, thumbnails, analysisStatus: "done",
      } : v));
    } catch {
      setVideos((all) => all.map((v) => v.id === item.id ? { ...v, analysisStatus: "error" } : v));
    } finally {
      if (ffmpeg) await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(probeName)]);
    }
  };

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => /video|mp4|quicktime|avi|matroska|webm|wmv|mpeg/i.test(`${file.type} ${file.name}`));
    if (!list.length) { setNotice("Không tìm thấy tệp video phù hợp."); return; }
    const prepared = await Promise.all(list.map(async (file): Promise<VideoItem> => {
      const meta = await readBrowserMetadata(file);
      return { id: makeId(), file, ...meta, checked: true, analysisStatus: "pending", thumbnails: [], status: "ready", progress: 0, settings: { ...defaults, trimEnd: meta.duration || 0 } };
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
    if (selected) setVideos((items) => items.map((item) => item.id === selected.id ? { ...item, settings: normalize({ ...item.settings, ...patch }) } : item));
  };
  const toggleChecked = (id: string) => setVideos((items) => items.map((item) => item.id === id ? { ...item, checked: !item.checked } : item));
  const toggleAll = () => setVideos((items) => items.map((item) => ({ ...item, checked: !allChecked })));
  const applyToChecked = () => {
    if (!selected) return;
    setVideos((items) => items.map((item) => item.checked ? { ...item, settings: { ...selected.settings, trimStart: 0, trimEnd: item.duration || 0 } } : item));
    setNotice(`Đã áp dụng thiết lập cho ${checkedCount} video được chọn.`);
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
    if (s.videoCodec === "libx264") args.push("-preset", "veryfast", "-crf", s.videoBitrate === "auto" ? "23" : "21");
    if (s.videoCodec === "libvpx-vp9") args.push("-crf", s.videoBitrate === "auto" ? "32" : "28", "-b:v", s.videoBitrate === "auto" ? "0" : s.videoBitrate);
    if (s.videoCodec === "mpeg4") args.push("-q:v", "4");
    if (s.videoBitrate !== "auto" && s.videoCodec !== "libvpx-vp9") args.push("-b:v", s.videoBitrate);
    const filters: string[] = [];
    if (s.aspect !== "source") { const ratio = s.aspect.replace(":", "/"); filters.push(`crop='min(iw,ih*${ratio})':'min(ih,iw/(${ratio}))'`); }
    const heights: Record<string, number> = { "2160": 2160, "1080": 1080, "720": 720, "480": 480 }, height = heights[s.resolution];
    let size = s.resolution === "custom" ? `${s.customWidth}:${s.customHeight}` : undefined;
    if (height) { const d = s.aspect === "9:16" ? [height, Math.round(height * 16 / 9)] : s.aspect === "1:1" ? [height, height] : s.aspect === "4:3" ? [Math.round(height * 4 / 3), height] : [Math.round(height * 16 / 9), height]; size = `${d[0] % 2 ? d[0] + 1 : d[0]}:${d[1] % 2 ? d[1] + 1 : d[1]}`; }
    if (size) filters.push(`scale=${size}:force_original_aspect_ratio=decrease,pad=${size}:(ow-iw)/2:(oh-ih)/2`); if (filters.length) args.push("-vf", filters.join(","));
    if (s.audioCodec === "none") args.push("-an"); else args.push("-c:a", s.audioCodec, "-b:a", s.audioBitrate);
    if (s.format === "mp4" || s.format === "mov") args.push("-movflags", "+faststart"); args.push("-y", outputName); return args;
  };

  const encodeOne = async (item: VideoItem) => {
    cancelCurrentRef.current = false; activeIdRef.current = item.id;
    setVideos((all) => all.map((v) => v.id === item.id ? { ...v, status: "encoding", progress: 0, error: undefined } : v));
    let ffmpeg: FFmpegType | null = null; let onProgress: ((data: { progress: number }) => void) | null = null;
    const safeId = item.id.replaceAll("-", ""), ext = item.file.name.split(".").pop()?.toLowerCase() || "mp4";
    const inputName = `input-${safeId}.${ext}`, outputName = `output-${safeId}.${item.settings.format}`;
    try {
      ffmpeg = await loadEngine(); const { fetchFile } = await import("@ffmpeg/util");
      onProgress = ({ progress }) => setVideos((all) => all.map((v) => v.id === item.id ? { ...v, progress: Math.min(99, Math.max(0, Math.round(progress * 100))) } : v));
      ffmpeg.on("progress", onProgress); await ffmpeg.writeFile(inputName, await fetchFile(item.file));
      const exitCode = await ffmpeg.exec(buildArgs(item, inputName, outputName));
      if (cancelCurrentRef.current) throw new Error("Đã dừng theo yêu cầu."); if (exitCode !== 0) throw new Error("Bộ mã hóa không thể xử lý thiết lập này.");
      const data = await ffmpeg.readFile(outputName); const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: `video/${item.settings.format}` }));
      const base = item.file.name.replace(/\.[^.]+$/, "");
      setVideos((all) => all.map((v) => v.id === item.id ? { ...v, status: "done", progress: 100, outputUrl: url, outputName: `${base}-encoded.${item.settings.format}` } : v));
    } catch (error) {
      const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Không thể mã hóa video.";
      setVideos((all) => all.map((v) => v.id === item.id ? { ...v, status: cancelCurrentRef.current ? "stopped" : "error", error: message } : v));
    } finally {
      if (ffmpeg && ffmpegRef.current) { if (onProgress) ffmpeg.off("progress", onProgress); await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)]); }
      activeIdRef.current = null;
    }
  };

  const encodeChecked = async () => {
    const queue = videos.filter((video) => video.checked && video.status !== "done"); if (!queue.length) return;
    cancelBatchRef.current = false; setIsBatchRunning(true);
    setVideos((all) => all.map((v) => v.checked && v.status !== "done" ? { ...v, status: "queued" } : v));
    for (const item of queue) { if (cancelBatchRef.current) break; await encodeOne(item); }
    setIsBatchRunning(false); setNotice(cancelBatchRef.current ? "Đã dừng toàn bộ hàng đợi." : "Đã xử lý xong các video được chọn.");
  };

  const stopCurrentVideo = (id: string) => {
    if (activeIdRef.current !== id) return;
    cancelCurrentRef.current = true; resetEngine();
    setVideos((all) => all.map((v) => v.id === id ? { ...v, status: "stopped", error: "Đã dừng ngay theo yêu cầu." } : v));
    setNotice("Đã dừng video hiện tại. Các video còn lại vẫn tiếp tục nếu đang chạy hàng loạt.");
  };
  const stopBatch = () => {
    cancelBatchRef.current = true; cancelCurrentRef.current = true; resetEngine(); setIsBatchRunning(false);
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
          <div className="panel-heading"><div><span className="eyebrow">HÀNG ĐỢI</span><h2>{videos.length ? `${videos.length} video` : "Video của bạn"}</h2></div>{videos.length > 0 && <button className="text-button" onClick={() => inputRef.current?.click()}>+ Thêm</button>}</div>
          <input ref={inputRef} className="sr-only" type="file" multiple accept={accepted} onChange={changeFiles} />
          {!videos.length ? <button className={`dropzone ${dragging ? "is-dragging" : ""}`} onClick={() => inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}><span className="upload-icon">↥</span><strong>Thả video vào đây</strong><span>hoặc nhấn để chọn nhiều tệp</span><small>MP4, MOV, AVI, WMV, WebM, MKV…</small></button> : <>
            <label className="select-all"><input type="checkbox" checked={allChecked} onChange={toggleAll} /> <span>Chọn tất cả</span><b>{checkedCount} đã chọn</b></label>
            <div className="queue-list">{videos.map((item, index) => <div key={item.id} className={`video-card ${selected?.id === item.id ? "active" : ""}`}>
              <label className="file-check" title="Chọn để xử lý hàng loạt"><input type="checkbox" checked={item.checked} onChange={() => toggleChecked(item.id)} /></label>
              <button className="video-select" onClick={() => setSelectedId(item.id)}><span className="thumb">{item.thumbnails[0] ? <img src={item.thumbnails[0].url} alt="" /> : <video src={item.url} muted preload="metadata" />}<span>{formatTime(item.duration)}</span></span><span className="video-info"><strong title={item.file.name}>{item.file.name}</strong><small>{item.sourceInfo ? `${item.sourceInfo.format} · ${item.sourceInfo.videoCodec}` : item.analysisStatus === "error" ? "Không đọc được codec" : "Đang đọc thông tin gốc…"}</small><span className={`state state-${item.status}`}>{item.status === "ready" ? "Sẵn sàng" : item.status === "queued" ? "Đang chờ" : item.status === "encoding" ? `Đang mã hóa ${item.progress}%` : item.status === "done" ? "Hoàn tất" : item.status === "stopped" ? "Đã dừng" : "Có lỗi"}</span>{item.status === "encoding" && <i className="progress"><i style={{ width: `${item.progress}%` }} /></i>}</span><span className="index">{String(index + 1).padStart(2, "0")}</span></button>
              {item.status === "encoding" && <button className="row-stop" onClick={() => stopCurrentVideo(item.id)} title="Dừng ngay video này">■</button>}
            </div>)}</div>
          </>}
          {videos.length > 0 && <div className="queue-summary"><span>{formatBytes(totalSize)}</span><span>{doneCount}/{videos.length} hoàn tất</span></div>}
        </aside>

        <section className="editor-panel">{!selected ? <div className="empty-editor"><span>▶</span><h2>Chưa có video</h2><p>Thêm một hoặc nhiều video để bắt đầu chuyển đổi.</p></div> : <>
          <div className="editor-title"><div><span className="eyebrow">THIẾT LẬP VIDEO</span><h2>{selected.file.name}</h2></div><button className="remove-button" onClick={() => removeVideo(selected.id)}>Xóa</button></div>
          <div className={`preview-grid ${selected.outputUrl ? "has-output" : ""}`}>
            <article className="video-preview-card"><div className="preview-card-head"><div><span>VIDEO GỐC</span><strong>{selected.width || "?"} × {selected.height || "?"}</strong></div><button onClick={() => void fullscreen(`source-${selected.id}`)}>⛶ Toàn màn hình</button></div><video id={`source-${selected.id}`} src={selected.url} controls preload="metadata" /></article>
            {selected.outputUrl ? <article className="video-preview-card output"><div className="preview-card-head"><div><span>SAU MÃ HÓA</span><strong>{selected.settings.format.toUpperCase()} · {selected.settings.videoCodec === "libx264" ? "H.264" : selected.settings.videoCodec === "libvpx-vp9" ? "VP9" : "MPEG-4"}</strong></div><button onClick={() => void fullscreen(`output-${selected.id}`)}>⛶ Toàn màn hình</button></div><video id={`output-${selected.id}`} src={selected.outputUrl} controls preload="metadata" /></article> : <article className="output-placeholder"><span>→</span><strong>Xem trước sau mã hóa</strong><small>Video kết quả sẽ xuất hiện tại đây để so sánh chất lượng.</small></article>}
          </div>

          <section className="source-info"><div className="section-title"><div><span className="eyebrow">THÔNG TIN FILE GỐC</span><h3>Thông số kỹ thuật</h3></div><span className={`analysis-badge ${selected.analysisStatus}`}>{selected.analysisStatus === "done" ? "Đã đọc bằng FFprobe" : selected.analysisStatus === "error" ? "Không đọc được" : "Đang phân tích…"}</span></div><div className="metadata-grid"><div><span>Định dạng</span><strong>{selected.sourceInfo?.format || selected.file.name.split(".").pop()?.toUpperCase()}</strong></div><div><span>Video codec</span><strong>{selected.sourceInfo?.videoCodec || "Đang đọc…"}</strong><small>{selected.sourceInfo?.videoProfile}</small></div><div><span>Video bitrate</span><strong>{formatBitrate(selected.sourceInfo?.videoBitrate)}</strong></div><div><span>Audio codec</span><strong>{selected.sourceInfo?.audioCodec || "Đang đọc…"}</strong><small>{selected.sourceInfo?.audioChannels ? `${selected.sourceInfo.audioChannels} kênh · ${selected.sourceInfo.audioSampleRate || "?"} Hz` : ""}</small></div><div><span>Audio bitrate</span><strong>{formatBitrate(selected.sourceInfo?.audioBitrate)}</strong></div><div><span>Thời lượng / dung lượng</span><strong>{formatTime(selected.duration)} · {formatBytes(selected.file.size)}</strong></div></div></section>

          <section className="filmstrip-section"><div className="section-title"><div><span className="eyebrow">THUMBNAIL THEO THỜI GIAN</span><h3>10 đoạn đại diện của video</h3></div><small>Nhấn vào ảnh để xem đúng thời điểm</small></div><div className="filmstrip">{selected.thumbnails.length ? selected.thumbnails.map((thumb, index) => <button key={`${thumb.time}-${index}`} onClick={() => jumpToThumbnail(selected, thumb)}><img src={thumb.url} alt={`Đoạn ${index + 1}`} /><span>{formatTime(thumb.time)}</span></button>) : Array.from({ length: 10 }, (_, index) => <i key={index} className="thumb-skeleton" />)}</div></section>

          <div className="settings-grid">
            <fieldset><legend>Hình ảnh</legend><label>Định dạng<select value={selected.settings.format} onChange={(e) => updateSettings({ format: e.target.value as Format })}><option value="mp4">MP4</option><option value="mov">MOV</option><option value="webm">WebM</option><option value="mkv">MKV</option></select></label><label>Video codec<select value={selected.settings.videoCodec} onChange={(e) => updateSettings({ videoCodec: e.target.value as VideoCodec })}><option value="libx264">H.264 — tương thích cao</option><option value="libvpx-vp9">VP9 — dung lượng nhỏ</option><option value="mpeg4">MPEG-4</option></select></label><label>Video bitrate<select value={selected.settings.videoBitrate} onChange={(e) => updateSettings({ videoBitrate: e.target.value })}><option value="auto">Tự động (khuyên dùng)</option><option value="2M">2 Mbps</option><option value="5M">5 Mbps</option><option value="10M">10 Mbps</option><option value="20M">20 Mbps</option></select></label></fieldset>
            <fieldset><legend>Âm thanh</legend><label>Audio codec<select value={selected.settings.audioCodec} onChange={(e) => updateSettings({ audioCodec: e.target.value as AudioCodec })}><option value="aac">AAC</option><option value="libmp3lame">MP3</option><option value="libopus">Opus</option><option value="libvorbis">Vorbis</option><option value="none">Không có âm thanh</option></select></label><label>Audio bitrate<select disabled={selected.settings.audioCodec === "none"} value={selected.settings.audioBitrate} onChange={(e) => updateSettings({ audioBitrate: e.target.value })}><option value="96k">96 kbps</option><option value="128k">128 kbps</option><option value="192k">192 kbps</option><option value="256k">256 kbps</option><option value="320k">320 kbps</option></select></label></fieldset>
            <fieldset><legend>Khung hình</legend><label>Kích thước<select value={selected.settings.resolution} onChange={(e) => updateSettings({ resolution: e.target.value })}><option value="source">Giữ nguyên</option><option value="2160">4K · 3840×2160</option><option value="1080">Full HD · 1920×1080</option><option value="720">HD · 1280×720</option><option value="480">SD · 854×480</option><option value="custom">Tùy chỉnh</option></select></label><label>Tỉ lệ<select value={selected.settings.aspect} onChange={(e) => updateSettings({ aspect: e.target.value })}><option value="source">Giữ nguyên</option><option value="16:9">16:9 ngang</option><option value="9:16">9:16 dọc</option><option value="4:3">4:3</option><option value="1:1">1:1 vuông</option></select></label>{selected.settings.resolution === "custom" && <div className="dimension-row"><input aria-label="Chiều rộng" type="number" min="16" value={selected.settings.customWidth} onChange={(e) => updateSettings({ customWidth: Number(e.target.value) })}/><span>×</span><input aria-label="Chiều cao" type="number" min="16" value={selected.settings.customHeight} onChange={(e) => updateSettings({ customHeight: Number(e.target.value) })}/></div>}</fieldset>
            <fieldset><legend>Cắt video</legend><div className="trim-row"><label>Bắt đầu<input type="number" min="0" max={selected.settings.trimEnd} step="0.1" value={selected.settings.trimStart} onChange={(e) => updateSettings({ trimStart: Math.max(0, Number(e.target.value)) })}/><small>giây</small></label><label>Kết thúc<input type="number" min={selected.settings.trimStart} max={selected.duration} step="0.1" value={Number(selected.settings.trimEnd.toFixed(1))} onChange={(e) => updateSettings({ trimEnd: Math.min(selected.duration, Number(e.target.value)) })}/><small>giây</small></label></div><div className="trim-track"><i style={{ left: `${selected.duration ? selected.settings.trimStart / selected.duration * 100 : 0}%`, right: `${selected.duration ? 100 - selected.settings.trimEnd / selected.duration * 100 : 0}%` }} /></div><small>Thời lượng sau cắt: {formatTime(selected.settings.trimEnd - selected.settings.trimStart)}</small></fieldset>
          </div>
          {selected.outputUrl && <a className="download-card" href={selected.outputUrl} download={selected.outputName}><span>✓</span><div><strong>Video đã sẵn sàng</strong><small>{selected.outputName}</small></div><b>Tải xuống</b></a>}
          {selected.error && <div className="error-note">{selected.error}</div>}
        </>}</section>
      </section>

      <footer className="actionbar"><div><span className={engineReady ? "engine ready" : "engine"}>{analyzingCount ? `Đang đọc thông tin gốc: còn ${analyzingCount} video…` : engineReady ? "Bộ mã hóa đã sẵn sàng" : engineLoading ? "Đang khởi động bộ mã hóa…" : notice}</span></div><div className="actions"><button className="secondary" disabled={!selected || !checkedCount || isBatchRunning} onClick={applyToChecked}>Áp dụng cho tệp đã chọn</button>{selected?.status === "encoding" && !isBatchRunning && <button className="danger" onClick={() => stopCurrentVideo(selected.id)}>Dừng video này</button>}{isBatchRunning ? <button className="danger" onClick={stopBatch}>Dừng hàng loạt</button> : <><button className="secondary compact" disabled={!selected || analyzingCount > 0} onClick={() => selected && void encodeOne(selected)}>Mã hóa video này</button><button className="primary" disabled={!checkedCount || engineLoading || analyzingCount > 0} onClick={() => void encodeChecked()}>Mã hóa {checkedCount} video <span>→</span></button></>}</div></footer>
    </main>
  );
}

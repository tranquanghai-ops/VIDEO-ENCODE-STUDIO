"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

type Status = "ready" | "queued" | "encoding" | "done" | "error" | "stopped";
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

type VideoItem = {
  id: string;
  file: File;
  url: string;
  duration: number;
  width: number;
  height: number;
  status: Status;
  progress: number;
  settings: Settings;
  outputUrl?: string;
  outputName?: string;
  error?: string;
};

const defaults: Settings = {
  format: "mp4",
  videoCodec: "libx264",
  videoBitrate: "auto",
  audioCodec: "aac",
  audioBitrate: "192k",
  resolution: "source",
  customWidth: 1920,
  customHeight: 1080,
  aspect: "source",
  trimStart: 0,
  trimEnd: 0,
};

const accepted = ".mp4,.mov,.avi,.wmv,.webm,.mkv,.m4v,.mpeg,.mpg";
const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const formatBytes = (n: number) => n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`;
const formatTime = (s: number) => {
  const value = Math.max(0, Number.isFinite(s) ? s : 0);
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const sec = Math.floor(value % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

function normalize(next: Settings): Settings {
  if (next.format === "webm") {
    return { ...next, videoCodec: "libvpx-vp9", audioCodec: next.audioCodec === "none" ? "none" : "libopus" };
  }
  if (next.format === "mp4" || next.format === "mov") {
    return {
      ...next,
      videoCodec: next.videoCodec === "libvpx-vp9" ? "libx264" : next.videoCodec,
      audioCodec: next.audioCodec === "none" ? "none" : (next.audioCodec === "libopus" || next.audioCodec === "libvorbis") ? "aac" : next.audioCodec,
    };
  }
  return next;
}

async function readMetadata(file: File) {
  const url = URL.createObjectURL(file);
  return await new Promise<{ url: string; duration: number; width: number; height: number }>((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => resolve({ url, duration: video.duration || 0, width: video.videoWidth, height: video.videoHeight });
    video.onerror = () => resolve({ url, duration: 0, width: 0, height: 0 });
    video.src = url;
  });
}

export default function Home() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [engineLoading, setEngineLoading] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [notice, setNotice] = useState("Video được xử lý cục bộ — không tải lên máy chủ.");
  const inputRef = useRef<HTMLInputElement>(null);
  const ffmpegRef = useRef<FFmpegType | null>(null);
  const stopRef = useRef(false);

  const selected = useMemo(() => videos.find((v) => v.id === selectedId) ?? videos[0], [videos, selectedId]);
  const doneCount = videos.filter((v) => v.status === "done").length;
  const totalSize = videos.reduce((sum, item) => sum + item.file.size, 0);

  useEffect(() => () => videos.forEach((v) => { URL.revokeObjectURL(v.url); if (v.outputUrl) URL.revokeObjectURL(v.outputUrl); }), []);

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => /video|mp4|quicktime|avi|matroska|webm|wmv/i.test(`${file.type} ${file.name}`));
    if (!list.length) { setNotice("Không tìm thấy tệp video phù hợp."); return; }
    const prepared = await Promise.all(list.map(async (file) => {
      const meta = await readMetadata(file);
      return {
        id: makeId(), file, ...meta, status: "ready" as Status, progress: 0,
        settings: { ...defaults, trimEnd: meta.duration || 0 },
      };
    }));
    setVideos((old) => [...old, ...prepared]);
    setSelectedId((old) => old ?? prepared[0].id);
    setNotice(`Đã thêm ${prepared.length} video vào hàng đợi.`);
  };

  const updateSettings = (patch: Partial<Settings>) => {
    if (!selected) return;
    setVideos((items) => items.map((item) => item.id === selected.id ? { ...item, settings: normalize({ ...item.settings, ...patch }) } : item));
  };

  const applyToAll = () => {
    if (!selected) return;
    setVideos((items) => items.map((item) => ({ ...item, settings: { ...selected.settings, trimStart: 0, trimEnd: item.duration || 0 } })));
    setNotice("Đã áp dụng thiết lập xuất cho toàn bộ video; thời gian cắt vẫn theo từng tệp.");
  };

  const removeVideo = (id: string) => {
    setVideos((items) => {
      const target = items.find((item) => item.id === id);
      if (target) { URL.revokeObjectURL(target.url); if (target.outputUrl) URL.revokeObjectURL(target.outputUrl); }
      const next = items.filter((item) => item.id !== id);
      if (selectedId === id) setSelectedId(next[0]?.id ?? null);
      return next;
    });
  };

  const loadEngine = async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    setEngineLoading(true);
    setNotice("Đang khởi động bộ mã hóa lần đầu…");
    try {
      const [{ FFmpeg }] = await Promise.all([import("@ffmpeg/ffmpeg")]);
      const ffmpeg = new FFmpeg();
      const runtimeBase = new URL("./ffmpeg/", window.location.href).href;
      const [part1, part2] = await Promise.all([
        fetch(`${runtimeBase}ffmpeg-core.wasm.part1`).then((response) => response.arrayBuffer()),
        fetch(`${runtimeBase}ffmpeg-core.wasm.part2`).then((response) => response.arrayBuffer()),
      ]);
      const wasmURL = URL.createObjectURL(new Blob([part1, part2], { type: "application/wasm" }));
      await ffmpeg.load({ coreURL: `${runtimeBase}ffmpeg-core.js`, wasmURL });
      URL.revokeObjectURL(wasmURL);
      ffmpegRef.current = ffmpeg;
      setEngineReady(true);
      return ffmpeg;
    } finally {
      setEngineLoading(false);
    }
  };

  const buildArgs = (item: VideoItem, inputName: string, outputName: string) => {
    const s = item.settings;
    const args: string[] = [];
    if (s.trimStart > 0) args.push("-ss", String(s.trimStart));
    args.push("-i", inputName);
    if (s.trimEnd > s.trimStart && s.trimEnd < item.duration - 0.05) args.push("-t", String(s.trimEnd - s.trimStart));
    args.push("-c:v", s.videoCodec);
    if (s.videoCodec === "libx264") args.push("-preset", "veryfast", "-crf", s.videoBitrate === "auto" ? "23" : "21");
    if (s.videoCodec === "libvpx-vp9") args.push("-crf", s.videoBitrate === "auto" ? "32" : "28", "-b:v", s.videoBitrate === "auto" ? "0" : s.videoBitrate);
    if (s.videoCodec === "mpeg4") args.push("-q:v", "4");
    if (s.videoBitrate !== "auto" && s.videoCodec !== "libvpx-vp9") args.push("-b:v", s.videoBitrate);

    const filters: string[] = [];
    if (s.aspect !== "source") {
      const ratio = s.aspect.replace(":", "/");
      filters.push(`crop='min(iw,ih*${ratio})':'min(ih,iw/(${ratio}))'`);
    }
    const heights: Record<string, number> = { "2160": 2160, "1080": 1080, "720": 720, "480": 480 };
    const height = heights[s.resolution];
    let size = s.resolution === "custom" ? `${s.customWidth}:${s.customHeight}` : undefined;
    if (height) {
      const dimensions = s.aspect === "9:16" ? [height, Math.round(height * 16 / 9)] : s.aspect === "1:1" ? [height, height] : s.aspect === "4:3" ? [Math.round(height * 4 / 3), height] : [Math.round(height * 16 / 9), height];
      size = `${dimensions[0] % 2 ? dimensions[0] + 1 : dimensions[0]}:${dimensions[1] % 2 ? dimensions[1] + 1 : dimensions[1]}`;
    }
    if (size) filters.push(`scale=${size}:force_original_aspect_ratio=decrease,pad=${size}:(ow-iw)/2:(oh-ih)/2`);
    if (filters.length) args.push("-vf", filters.join(","));

    if (s.audioCodec === "none") args.push("-an");
    else args.push("-c:a", s.audioCodec, "-b:a", s.audioBitrate);
    if (s.format === "mp4" || s.format === "mov") args.push("-movflags", "+faststart");
    args.push("-y", outputName);
    return args;
  };

  const encodeOne = async (id: string) => {
    const item = videos.find((video) => video.id === id);
    if (!item) return;
    stopRef.current = false;
    setVideos((all) => all.map((v) => v.id === id ? { ...v, status: "encoding", progress: 0, error: undefined } : v));
    try {
      const ffmpeg = await loadEngine();
      const { fetchFile } = await import("@ffmpeg/util");
      const safeId = item.id.replaceAll("-", "");
      const ext = item.file.name.split(".").pop()?.toLowerCase() || "mp4";
      const inputName = `input-${safeId}.${ext}`;
      const outputName = `output-${safeId}.${item.settings.format}`;
      const onProgress = ({ progress }: { progress: number }) => setVideos((all) => all.map((v) => v.id === id ? { ...v, progress: Math.min(99, Math.max(0, Math.round(progress * 100))) } : v));
      ffmpeg.on("progress", onProgress);
      await ffmpeg.writeFile(inputName, await fetchFile(item.file));
      await ffmpeg.exec(buildArgs(item, inputName, outputName));
      if (stopRef.current) throw new Error("Đã dừng theo yêu cầu.");
      const data = await ffmpeg.readFile(outputName);
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: `video/${item.settings.format}` }));
      const base = item.file.name.replace(/\.[^.]+$/, "");
      setVideos((all) => all.map((v) => v.id === id ? { ...v, status: "done", progress: 100, outputUrl: url, outputName: `${base}-encoded.${item.settings.format}` } : v));
      await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)]);
      ffmpeg.off("progress", onProgress);
    } catch (error) {
      const message = error instanceof Error ? error.message : typeof error === "string" ? error : `Không thể mã hóa video${error ? `: ${String(error)}` : "."}`;
      setVideos((all) => all.map((v) => v.id === id ? { ...v, status: stopRef.current ? "stopped" : "error", error: message } : v));
    }
  };

  const encodeAll = async () => {
    if (!videos.length) return;
    setIsBatchRunning(true);
    setVideos((all) => all.map((v) => v.status === "done" ? v : { ...v, status: "queued" }));
    for (const item of videos) {
      if (stopRef.current) break;
      if (item.status !== "done") await encodeOne(item.id);
    }
    setIsBatchRunning(false);
    setNotice(stopRef.current ? "Đã dừng hàng đợi." : "Đã xử lý xong hàng đợi.");
  };

  const stopEncoding = () => {
    stopRef.current = true;
    ffmpegRef.current?.terminate();
    ffmpegRef.current = null;
    setEngineReady(false);
    setIsBatchRunning(false);
    setVideos((all) => all.map((v) => v.status === "encoding" ? { ...v, status: "stopped", error: "Đã dừng theo yêu cầu." } : v.status === "queued" ? { ...v, status: "ready" } : v));
  };

  const drop = (event: DragEvent) => { event.preventDefault(); setDragging(false); void addFiles(event.dataTransfer.files); };
  const changeFiles = (event: ChangeEvent<HTMLInputElement>) => { if (event.target.files) void addFiles(event.target.files); event.target.value = ""; };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">VE</span><div><h1>Video Encode Studio</h1><p>Chuyển đổi video an toàn trên trình duyệt</p></div></div>
        <div className="privacy-pill"><span className="status-dot" /> Xử lý cục bộ</div>
      </header>

      <section className="workspace">
        <aside className="queue-panel">
          <div className="panel-heading"><div><span className="eyebrow">HÀNG ĐỢI</span><h2>{videos.length ? `${videos.length} video` : "Video của bạn"}</h2></div>{videos.length > 0 && <button className="text-button" onClick={() => inputRef.current?.click()}>+ Thêm</button>}</div>
          <input ref={inputRef} className="sr-only" type="file" multiple accept={accepted} onChange={changeFiles} />
          {!videos.length ? (
            <button className={`dropzone ${dragging ? "is-dragging" : ""}`} onClick={() => inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
              <span className="upload-icon">↥</span><strong>Thả video vào đây</strong><span>hoặc nhấn để chọn nhiều tệp</span><small>MP4, MOV, AVI, WMV, WebM, MKV…</small>
            </button>
          ) : (
            <div className="queue-list">
              {videos.map((item, index) => (
                <button key={item.id} className={`video-card ${selected?.id === item.id ? "active" : ""}`} onClick={() => setSelectedId(item.id)}>
                  <span className="thumb"><video src={item.url} muted preload="metadata" /><span>{formatTime(item.duration)}</span></span>
                  <span className="video-info"><strong title={item.file.name}>{item.file.name}</strong><small>{formatBytes(item.file.size)} · {item.width || "?"}×{item.height || "?"}</small><span className={`state state-${item.status}`}>{item.status === "ready" ? "Sẵn sàng" : item.status === "queued" ? "Đang chờ" : item.status === "encoding" ? `Đang mã hóa ${item.progress}%` : item.status === "done" ? "Hoàn tất" : item.status === "stopped" ? "Đã dừng" : "Có lỗi"}</span>{item.status === "encoding" && <i className="progress"><i style={{ width: `${item.progress}%` }} /></i>}</span>
                  <span className="index">{String(index + 1).padStart(2, "0")}</span>
                </button>
              ))}
            </div>
          )}
          {videos.length > 0 && <div className="queue-summary"><span>{formatBytes(totalSize)}</span><span>{doneCount}/{videos.length} hoàn tất</span></div>}
        </aside>

        <section className="editor-panel">
          {!selected ? (
            <div className="empty-editor"><span>▶</span><h2>Chưa có video</h2><p>Thêm một hoặc nhiều video để bắt đầu chuyển đổi.</p></div>
          ) : (
            <>
              <div className="editor-title"><div><span className="eyebrow">THIẾT LẬP VIDEO</span><h2>{selected.file.name}</h2></div><button className="remove-button" onClick={() => removeVideo(selected.id)}>Xóa</button></div>
              <div className="preview-strip"><video src={selected.url} controls preload="metadata" /><div><span>Đầu vào</span><strong>{selected.width || "?"} × {selected.height || "?"}</strong><small>{formatTime(selected.duration)} · {formatBytes(selected.file.size)}</small></div><span className="flow-arrow">→</span><div><span>Đầu ra</span><strong>{selected.settings.format.toUpperCase()}</strong><small>{selected.settings.videoCodec === "libx264" ? "H.264" : selected.settings.videoCodec === "libvpx-vp9" ? "VP9" : "MPEG-4"}</small></div></div>
              <div className="settings-grid">
                <fieldset><legend>Hình ảnh</legend><label>Định dạng<select value={selected.settings.format} onChange={(e) => updateSettings({ format: e.target.value as Format })}><option value="mp4">MP4</option><option value="mov">MOV</option><option value="webm">WebM</option><option value="mkv">MKV</option></select></label><label>Video codec<select value={selected.settings.videoCodec} onChange={(e) => updateSettings({ videoCodec: e.target.value as VideoCodec })}><option value="libx264">H.264 — tương thích cao</option><option value="libvpx-vp9">VP9 — dung lượng nhỏ</option><option value="mpeg4">MPEG-4</option></select></label><label>Video bitrate<select value={selected.settings.videoBitrate} onChange={(e) => updateSettings({ videoBitrate: e.target.value })}><option value="auto">Tự động (khuyên dùng)</option><option value="2M">2 Mbps</option><option value="5M">5 Mbps</option><option value="10M">10 Mbps</option><option value="20M">20 Mbps</option></select></label></fieldset>
                <fieldset><legend>Âm thanh</legend><label>Audio codec<select value={selected.settings.audioCodec} onChange={(e) => updateSettings({ audioCodec: e.target.value as AudioCodec })}><option value="aac">AAC</option><option value="libmp3lame">MP3</option><option value="libopus">Opus</option><option value="libvorbis">Vorbis</option><option value="none">Không có âm thanh</option></select></label><label>Audio bitrate<select disabled={selected.settings.audioCodec === "none"} value={selected.settings.audioBitrate} onChange={(e) => updateSettings({ audioBitrate: e.target.value })}><option value="96k">96 kbps</option><option value="128k">128 kbps</option><option value="192k">192 kbps</option><option value="256k">256 kbps</option><option value="320k">320 kbps</option></select></label></fieldset>
                <fieldset><legend>Khung hình</legend><label>Kích thước<select value={selected.settings.resolution} onChange={(e) => updateSettings({ resolution: e.target.value })}><option value="source">Giữ nguyên</option><option value="2160">4K · 3840×2160</option><option value="1080">Full HD · 1920×1080</option><option value="720">HD · 1280×720</option><option value="480">SD · 854×480</option><option value="custom">Tùy chỉnh</option></select></label><label>Tỉ lệ<select value={selected.settings.aspect} onChange={(e) => updateSettings({ aspect: e.target.value })}><option value="source">Giữ nguyên</option><option value="16:9">16:9 ngang</option><option value="9:16">9:16 dọc</option><option value="4:3">4:3</option><option value="1:1">1:1 vuông</option></select></label>{selected.settings.resolution === "custom" && <div className="dimension-row"><input aria-label="Chiều rộng" type="number" min="16" value={selected.settings.customWidth} onChange={(e) => updateSettings({ customWidth: Number(e.target.value) })}/><span>×</span><input aria-label="Chiều cao" type="number" min="16" value={selected.settings.customHeight} onChange={(e) => updateSettings({ customHeight: Number(e.target.value) })}/></div>}</fieldset>
                <fieldset><legend>Cắt video</legend><div className="trim-row"><label>Bắt đầu<input type="number" min="0" max={selected.settings.trimEnd} step="0.1" value={selected.settings.trimStart} onChange={(e) => updateSettings({ trimStart: Math.max(0, Number(e.target.value)) })}/><small>giây</small></label><label>Kết thúc<input type="number" min={selected.settings.trimStart} max={selected.duration} step="0.1" value={Number(selected.settings.trimEnd.toFixed(1))} onChange={(e) => updateSettings({ trimEnd: Math.min(selected.duration, Number(e.target.value)) })}/><small>giây</small></label></div><div className="trim-track"><i style={{ left: `${selected.duration ? selected.settings.trimStart / selected.duration * 100 : 0}%`, right: `${selected.duration ? 100 - selected.settings.trimEnd / selected.duration * 100 : 0}%` }} /></div><small>Thời lượng sau cắt: {formatTime(selected.settings.trimEnd - selected.settings.trimStart)}</small></fieldset>
              </div>
              {selected.status === "done" && selected.outputUrl && <a className="download-card" href={selected.outputUrl} download={selected.outputName}><span>✓</span><div><strong>Video đã sẵn sàng</strong><small>{selected.outputName}</small></div><b>Tải xuống</b></a>}
              {selected.error && <div className="error-note">{selected.error}</div>}
            </>
          )}
        </section>
      </section>

      <footer className="actionbar"><div><span className={engineReady ? "engine ready" : "engine"}>{engineReady ? "Bộ mã hóa đã sẵn sàng" : engineLoading ? "Đang khởi động bộ mã hóa…" : notice}</span></div><div className="actions"><button className="secondary" disabled={!selected || isBatchRunning} onClick={applyToAll}>Áp dụng cho tất cả</button>{isBatchRunning ? <button className="danger" onClick={stopEncoding}>Dừng mã hóa</button> : <><button className="secondary compact" disabled={!selected} onClick={() => selected && void encodeOne(selected.id)}>Mã hóa video này</button><button className="primary" disabled={!videos.length || engineLoading} onClick={() => void encodeAll()}>Mã hóa tất cả <span>→</span></button></>}</div></footer>
    </main>
  );
}

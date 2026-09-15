# VIDEO-ENCODE-STUDIO — AI Handover & Portal Integration Guide

## 1. Tổng quan Dự án

- **Repository:** [`tranquanghai-ops/VIDEO-ENCODE-STUDIO`](https://github.com/tranquanghai-ops/VIDEO-ENCODE-STUDIO)
- **Công nghệ:** React + Vite + TypeScript + WebCodecs API + FFmpeg WebAssembly.
- **Mục tiêu:** Công cụ mã hóa, nén và chuyển đổi video client-side chất lượng cao, an toàn trên trình duyệt.
- **Mount trên Portal:** Được tích hợp vào `TDTU-TKNT-Portal` tại đường dẫn con `https://tknt-tdtu.web.app/video-encode/`.

## 2. Kiến trúc Tương thích Subpath / Subfolder

Để ứng dụng có thể chạy mượt mà dưới bất kỳ subfolder nào (như `/video-encode/`):
- `vite.config.ts`: Cấu hình `base: './'`.
- Tất cả assets sinh ra trong `dist/` (JS, CSS, static files) đều được import và liên kết bằng đường dẫn tương đối.
- FFmpeg WASM core files (`ffmpeg-core.js`, `ffmpeg-core.wasm` trong `dist/ffmpeg/`) được nạp qua relative path hoặc `import.meta.url`.

## 3. Quy trình Tự động Đóng gói & Phát hành (CI/CD)

- **Workflow:** `.github/workflows/release.yml`
- **Cơ chế:** Kích hoạt tự động khi push code lên nhánh `main`.
- **Các bước thực hiện:**
  1. Kiểm tra mã nguồn.
  2. Thiết lập môi trường Node.js 20.
  3. Cài đặt dependencies (`npm ci`).
  4. Build production bundle (`npm run build`).
  5. Đóng gói toàn bộ thư mục `dist/` thành file zip `video-encode.zip` (đảm bảo `index.html` nằm ở root của zip).
  6. Đọc version từ `package.json` và tạo GitHub Release kèm artifact `video-encode.zip`.
  7. Tự động gửi GitHub REST API `workflow_dispatch` sang workflow `deploy-production.yml` của `tranquanghai-ops/TDTU-TKNT-Portal` (yêu cầu secret `PORTAL_DISPATCH_TOKEN` với quyền tối thiểu duy nhất `Actions: Read and write`).

## 4. Tích hợp với TDTU-TKNT-Portal

- `TDTU-TKNT-Portal` đăng ký ứng dụng trong `apps-registry.json` với `id: "video-encode"` và `version: "latest"`.
- Khi Portal build, workflow sẽ tự động tải file `video-encode.zip` từ release mới nhất của repo này, giải nén vào `build/video-encode/` và triển khai lên Firebase Hosting `tknt-tdtu.web.app`.

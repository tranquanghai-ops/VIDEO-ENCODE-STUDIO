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
- **Cơ chế:** Kích hoạt khi push immutable release tag `vX.Y.Z` khớp với `package.json`.
- **Các bước thực hiện:**
  1. Kiểm tra mã nguồn.
  2. Thiết lập môi trường Node.js 20.
  3. Cài đặt dependencies (`npm ci`).
  4. Build production bundle (`npm run build`).
  5. Đóng gói toàn bộ thư mục `dist/` thành file zip `video-encode.zip` (đảm bảo `index.html` nằm ở root của zip).
  6. Đọc version từ `package.json` và tạo GitHub Release kèm artifact `video-encode.zip`.
  7. Xuất bản artifact bất biến. Workflow này không deploy Firebase và không kích hoạt production deployment của Portal.

## 4. Tích hợp với TDTU-TKNT-Portal

- `TDTU-TKNT-Portal` đăng ký ứng dụng trong `apps-registry.json` với `id: "video-encode"`, release tag và SHA-256 bất biến.
- Portal manifest updater chỉ tạo PR khi phát hiện release mới. Sau review và merge Portal `main`, Portal tải đúng artifact đã pin, verify SHA-256, giải nén vào `build/video-encode/` và là authority duy nhất deploy Firebase Hosting `tknt-tdtu.web.app`.

End-to-end auto deployment test completed.

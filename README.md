# Video Encode Studio

Ứng dụng web chuyển đổi, mã hóa và cắt nhiều video trực tiếp trong trình duyệt. Video không được tải lên máy chủ.

## Đưa lên GitHub Pages

1. Tạo một repository mới trên GitHub.
2. Tải toàn bộ thư mục này lên repository và đặt nhánh chính là `main`.
3. Mở **Settings → Pages**.
4. Trong **Build and deployment**, chọn **Source: GitHub Actions**.
5. Mở thẻ **Actions**, chờ quy trình “Deploy Video Encode Studio” hoàn tất.
6. Đường dẫn trang web sẽ xuất hiện trong **Settings → Pages**. Trang không yêu cầu đăng nhập.

## Chạy trên máy tính

Yêu cầu cài Node.js 22 trở lên. Mở Terminal/Command Prompt tại thư mục dự án và chạy:

```bash
npm install
npm run dev
```

Sau đó mở địa chỉ do chương trình hiển thị.

## Bản website dựng sẵn

Thư mục `dist` là bản website đã dựng sẵn. Có thể tải toàn bộ nội dung trong thư mục này lên Netlify, Cloudflare Pages, Vercel hoặc một dịch vụ lưu trữ website tĩnh.

Không nên nhấp trực tiếp vào `dist/index.html` bằng đường dẫn `file://`, vì trình duyệt giới hạn Web Worker và WebAssembly. Hãy chạy qua máy chủ web hoặc dịch vụ hosting.

## Chức năng

- Tải nhiều video: MP4, MOV, AVI, WMV, WebM, MKV và các định dạng thông dụng khác.
- Thiết lập riêng từng video hoặc áp dụng cho toàn bộ hàng đợi.
- Xuất MP4, MOV, WebM hoặc MKV.
- Video codec: H.264, VP9, MPEG-4.
- Audio codec: AAC, MP3, Opus, Vorbis hoặc loại bỏ âm thanh.
- Điều chỉnh bitrate, kích thước, tỉ lệ khung hình và thời gian cắt.
- Mã hóa từng video hoặc toàn bộ hàng đợi; có thể dừng tiến trình.

## Lưu ý

Ứng dụng sử dụng FFmpeg WebAssembly và xử lý cục bộ. Video rất lớn sẽ phụ thuộc vào RAM, CPU và giới hạn bộ nhớ của trình duyệt.

# Personal Work OS — Vercel

Bản Next.js độc lập, đã loại bỏ runtime dành riêng cho ChatGPT Sites/Cloudflare.
Ứng dụng lưu công việc trong `localStorage` của trình duyệt, nên không cần database,
API key hoặc biến môi trường.

## Chạy thử trên máy

```bash
npm ci
npm run dev
```

Mở `http://localhost:3000`. Kiểm tra production đầy đủ bằng:

```bash
npm run check
```

## Đưa lên Vercel bằng giao diện

1. Giải nén gói này và đẩy thư mục lên một GitHub repository.
2. Vào <https://vercel.com/new> và chọn **Import Git Repository**.
3. Chọn repository vừa tạo. Vercel sẽ nhận diện **Next.js** tự động.
4. Giữ nguyên Build Command là `npm run build`; không cần Environment Variables.
5. Chọn **Deploy**. Khi hoàn tất, Vercel cung cấp URL HTTPS công khai.

## Đưa lên Vercel bằng CLI

```bash
npx vercel
npx vercel --prod
```

Lần đầu chạy, đăng nhập Vercel và chọn tạo project mới. Không commit thư mục
`.vercel`, `.next` hoặc `node_modules`.

## Dữ liệu

Dữ liệu được lưu riêng trong trình duyệt và thiết bị đang sử dụng. Xóa dữ liệu
trình duyệt hoặc dùng thiết bị khác sẽ không có danh sách công việc cũ.

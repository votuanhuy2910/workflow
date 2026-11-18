# Quy trình làm việc đại học – triển khai trên Vercel

HTML thuần + Vercel Serverless Functions (Node.js) + Upstash Redis. Không cần bước build.

## Cấu trúc
```
public/index.html   Giao diện
api/_lib.js         Redis, phiên đăng nhập, băm mật khẩu
api/auth.js         Đăng nhập / đăng xuất / me
api/flows.js        GET (ai cũng xem) · PUT (Admin/Editor)
api/users.js        Quản lý người dùng (chỉ Admin)
package.json
```

## Triển khai
1. Đẩy thư mục này lên GitHub, rồi Vercel → **Add New Project** → chọn repo (Framework Preset: **Other**).
   Hoặc dùng CLI: `npm i -g vercel && vercel`.
2. Trong dự án Vercel → **Storage** (hoặc Marketplace) → thêm **Upstash Redis**, nối với dự án.
   Vercel sẽ tự thêm biến `KV_REST_API_URL` và `KV_REST_API_TOKEN`.
3. Vào **Settings → Environment Variables**, thêm:
   - `ADMIN_USER` – tên tài khoản Admin gốc (vd: `admin`)
   - `ADMIN_PASSWORD` – mật khẩu Admin gốc
   - `SESSION_SECRET` – chuỗi ngẫu nhiên dài (vd: `openssl rand -hex 32`)
4. **Redeploy**. Mở web, bấm Đăng nhập bằng tài khoản Admin gốc, bấm **Phân quyền** để tạo user.

## Vai trò
- Chưa đăng nhập hoặc **Viewer**: chỉ xem.
- **Editor**: thêm/sửa/xóa/kéo thả quy trình và các bước.
- **Admin**: như Editor, cộng thêm quản lý người dùng.

## Chạy thử máy local
`vercel env pull .env.local` rồi `vercel dev`.

## Lưu ý
- Dữ liệu quy trình lưu thành một khối; hai người cùng sửa một lúc thì lần lưu sau ghi đè lần trước.
- Chưa giới hạn số lần đăng nhập sai; nếu cần, thêm rate limit (vd. `@upstash/ratelimit`).

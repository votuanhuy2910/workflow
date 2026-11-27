# Quy trình làm việc đại học – triển khai trên Vercel

HTML thuần + Vercel Serverless Functions (Node.js) + Upstash Redis. Không cần bước build.

## Cấu trúc
```
public/index.html   Giao diện
api/_lib.js         Redis, phiên đăng nhập, băm mật khẩu
api/auth.js         Đăng nhập / đăng xuất / me
api/flows.js        GET (ai cũng xem) · PUT (Admin/Editor)
api/users.js        Quản lý người dùng (chỉ Admin)
api/history.js      Lịch sử thay đổi (xem: Admin/Editor · khôi phục: Admin)
api/image.js        Xem ảnh (ai cũng xem) · tải ảnh lên (Admin/Editor)
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
- Chưa đăng nhập hoặc **Viewer**: chỉ thấy nội dung các quy trình (không có thanh công cụ nào khác).
- **Editor**: thêm/sửa/xóa/kéo thả quy trình, bước và hình minh họa; có nút **Đổi mật khẩu**.
- **Admin**: như Editor, cộng thêm nút **Phân quyền** để quản lý người dùng.
- Admin gốc (khai báo bằng biến môi trường) đổi mật khẩu qua `ADMIN_PASSWORD`.

## Hình minh họa
Mỗi bước có thể kèm 1 hình. Ảnh được nén thành JPEG (tối đa 1000px) ngay trên trình duyệt rồi lưu trong Redis (khóa `img:<id>`). Ảnh không còn bước nào dùng sẽ tự bị xóa khi lưu.

## Chạy thử máy local
`vercel env pull .env.local` rồi `vercel dev`.

## Lưu ý
- Dữ liệu quy trình lưu thành một khối; hai người cùng sửa một lúc thì lần lưu sau ghi đè lần trước.
- Chưa giới hạn số lần đăng nhập sai; nếu cần, thêm rate limit (vd. `@upstash/ratelimit`).

## Chống ghi đè & lịch sử
- Mỗi lần lưu gửi kèm số phiên bản; nếu người khác đã lưu trước, server trả lỗi 409 và giao diện hỏi: tải bản mới hoặc ghi đè.
- Trang tự làm mới sau tối đa 20 giây nếu người khác đã thay đổi (và bạn không đang nhập dở).
- Lưu 50 thay đổi gần nhất kèm bản chụp dữ liệu; Admin khôi phục được từng bản.
- Ảnh chỉ bị xóa khi không còn quy trình hiện tại hoặc bản lịch sử nào dùng.

## Swimlane, in/PDF, kéo thả cảm ứng
- Mỗi quy trình có 2 chế độ xem: Danh sách và Swimlane (mỗi đơn vị phụ trách một hàng).
- Nút **In / Xuất PDF** in đúng quy trình đang xem; trong hộp thoại in chọn "Lưu dạng PDF".
- Kéo ⠿ hoạt động bằng cả chuột và cảm ứng.

## Bảng trong từng bước
Admin/Editor có thể **Chèn bảng** khi thêm hoặc sửa bước: thêm/xóa hàng và cột, gộp ô, tách ô (ô đã gộp thì tách lại, ô thường thì chia theo số cột × hàng), bật/tắt hàng tiêu đề. Mọi người đều xem được bảng; bảng cũng có trong bản in/PDF. Giới hạn 60 hàng × 20 cột, mỗi ô tối đa 500 ký tự.

# Ma Sói Huyền Bí – Mobile-first

Website Ma Sói chơi trực tuyến thời gian thực, tối đa 12 người/phòng, quản trò tự động. Chế độ đấu với máy gồm 1 người chơi và 11 bot; phòng thường cho phép chủ phòng thêm bot từng người. Bao gồm 10 màn hình và chế độ xem thử.

## AI nhân vật trong chế độ Đấu trường với máy

Chế độ đấu với máy hỗ trợ hội thoại AI có cá tính, suy luận theo diễn biến công khai, ghi nhớ riêng qua các vòng và đề xuất mục tiêu bỏ phiếu. AI chỉ hoạt động ở máy chủ; API Key không được đưa vào mã JavaScript phía trình duyệt.

Để bật AI trên Render, vào **Dashboard → dịch vụ MaSoiHuyenBi → Environment** và thêm:

- `OPENAI_API_KEY`: API Key của tài khoản OpenAI.
- `OPENAI_MODEL` (không bắt buộc): tên model chat tương thích; mặc định là `gpt-4o-mini`.

Lưu thay đổi để Render khởi động lại dịch vụ. Nếu chưa có `OPENAI_API_KEY`, trò chơi vẫn hoạt động bằng hội thoại dự phòng, không gọi API. AI tạo lời thoại cho tối đa 3 máy mỗi lượt thảo luận; lựa chọn bỏ phiếu AI của các máy đã phát biểu được dùng ở vòng bỏ phiếu. Nếu API lỗi hoặc hết thời gian chờ, máy tự chuyển sang lời thoại và chiến thuật dự phòng để ván chơi không bị gián đoạn.

## Chạy trên máy tính

Yêu cầu Node.js 20+.

```bash
npm install
npm start
```

Mở `http://localhost:3000`.

## Chơi trên điện thoại

Cho điện thoại và máy tính cùng mạng Wi-Fi, tìm IP nội bộ của máy tính rồi mở `http://IP-CUA-MAY:3000` trên điện thoại. Nếu không truy cập được, kiểm tra tường lửa và cho phép cổng 3000.

Để chơi qua Internet, triển khai **toàn bộ dự án** lên dịch vụ hỗ trợ Node.js + WebSocket và HTTPS. **GitHub Pages chỉ phục vụ tệp tĩnh nên không chạy được máy chủ Socket.IO.**

## Cấu trúc

- `server.js`: Máy chủ Express/Socket.IO, phân vai, quản trò, luật cơ bản và quản lý phòng.
- `public/index.html`: Điểm vào website.
- `public/style.css`: Giao diện responsive mobile-first.
- `public/app.js`: Giao diện 10 màn hình, hành động, chat, kết nối lại.
- `public/manifest.webmanifest`: Metadata PWA.

## Luật hiện tại

- Tối thiểu 5 người để bắt đầu, tối đa 12 người.
- Chế độ đấu với máy: 12 người (1 người chơi và 11 bot).
- Phòng thường: chủ phòng có thể thêm từng bot trong phòng chờ; mỗi bot chiếm một chỗ và tự động sẵn sàng.
- 1 Sói cho phòng 5–6 người, 2 Sói cho phòng 7–9 người, 3 Sói cho phòng 10–12 người.
- Vai trò đặc biệt được phân ngẫu nhiên: Tiên tri, Phù thủy, Bảo vệ, Thợ săn, Cupid; số vai đặc biệt được cắt bớt ở phòng nhỏ.
- Cupid ghép đôi hai người khác mình trong đêm đầu; một người bị loại thì người kia cũng bị loại.
- Sói bỏ phiếu chọn mục tiêu trong đêm; hòa phiếu được chọn ngẫu nhiên.
- Tiên tri soi một người mỗi đêm; kết quả chỉ người soi biết.
- Bảo vệ không thể chọn cùng mục tiêu ở hai đêm liên tiếp.
- Phù thủy có một lượt cứu và một lượt độc; bản MVP mỗi đêm chỉ được chọn **một** trong hai hành động hoặc bỏ qua, không thấy mục tiêu Sói trước khi chọn.
- Thợ săn khi bị loại có một lượt chọn mục tiêu, tối đa 20 giây.
- Ban ngày bỏ phiếu; hòa phiếu hoặc không có phiếu thì không ai bị loại.
- Phe Làng thắng khi không còn Sói; phe Sói thắng khi số Sói >= số người còn lại. Đôi tình nhân còn sống cuối cùng (2 người) có thể thắng riêng.

## Giới hạn phiên bản MVP

- Dữ liệu phòng lưu trong bộ nhớ, sẽ mất khi máy chủ khởi động lại; chưa có cơ sở dữ liệu, tài khoản hoặc xếp hạng.
- Người chơi kết nối lại trong cùng tab/phiên trình duyệt (sessionStorage). Nếu mất phiên hoặc server khởi động lại thì không thể phục hồi.
- Chưa có tự động ghép trận, voice chat, thông báo đẩy hay công cụ quản trị.
- Chưa triển khai đầy đủ mọi biến thể luật Ma Sói (ví dụ xử lý Thợ săn dây chuyền, các trường hợp thắng Cupid đặc biệt, và cứu người theo luật truyền thống).
- Nên bổ sung kiểm thử nhiều máy, rate limit theo IP, chống spam, kiểm tra an toàn và lưu trữ bền vững trước khi mở công khai.


## Triển khai lên Render

Dự án cần **Node.js + WebSocket**; GitHub Pages không thể vận hành máy chủ game.

1. Mở https://dashboard.render.com/ và đăng nhập.
2. Chọn **New > Blueprint** và kết nối repository `thanhsangchess/MaSoiHuyenBi`.
3. Chọn nhánh `main`. Render sẽ đọc `render.yaml` để tạo dịch vụ web.
4. Chờ build và deploy hoàn tất; truy cập URL `https://...onrender.com/health` để kiểm tra. Phản hồi thành công có trường `ok: true`.
5. Mở URL gốc trên hai điện thoại để kiểm tra tạo phòng, vào phòng, chat và kết nối lại.

**Giới hạn:** Gói miễn phí có thể tạm ngừng khi không có truy cập, làm mất dữ liệu phòng lưu trong RAM. Nên dùng một instance duy nhất; nhiều instance đòi hỏi kho trạng thái và adapter Socket.IO chia sẻ. Chưa nên sử dụng cho các ván quan trọng trước khi hoàn thiện lưu trữ bền vững, chống lạm dụng và bảo mật phiên.

**Lưu ý Git:** `.gitignore` không ngừng theo dõi các tệp `node_modules` đã commit. Trên máy có Git, chạy `git rm -r --cached node_modules`, sau đó commit và push để loại chúng khỏi nhánh hiện tại (không xóa thư viện trên máy).

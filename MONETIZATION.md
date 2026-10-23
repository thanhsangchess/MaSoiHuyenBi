# Ma Sói Huyền Bí — Android & Premium

## Android (giai đoạn thử nghiệm)

Dự án dùng Capacitor để mở ứng dụng web đang chạy trên Render bên trong ứng dụng Android. Đây là cấu hình **thử nghiệm**, chưa phải gói phát hành Google Play hoàn chỉnh. Máy chủ vẫn xử lý Socket.IO, phòng chơi và luật chơi như trước.

### Tạo project Android

1. Cài Node.js 20+, Android Studio và Android SDK.
2. Chạy `npm install`.
3. Chạy `npm run android:add` (chỉ lần đầu), sau đó `npm run android:sync`.
4. Chạy `npm run android:open`, dùng Android Studio để build và kiểm thử trên máy thật.
5. Để phát hành, cần chuyển sang đóng gói assets nội bộ và kết nối API/Socket.IO qua HTTPS, thay vì phụ thuộc vào `server.url` ở production. Cần thêm icon adaptive, splash, back navigation, offline/error state, kiểm thử các thiết bị và chính sách quyền riêng tư.

**Không chạy `android:add` lần nữa sau khi thư mục android đã được tạo.** Thư mục `android/` sinh bởi Capacitor cần được commit riêng sau khi kiểm thử, không chứa signing keys.

## Premium & vật phẩm trang trí — thiết kế chuẩn bị triển khai

- **Miễn phí:** tất cả vai trò, tham gia/tạo phòng, chat, chơi cùng bạn bè; không giới hạn cơ hội thắng.
- **Premium:** khung avatar, hiệu ứng tên, chủ đề giao diện phòng, biểu tượng cảm xúc đặc biệt, không có lợi thế về luật chơi.
- **Vật phẩm trang trí:** bộ khung nhân vật, nền thẻ người chơi, hiệu ứng vào phòng. Không bán vai trò mạnh hoặc quyền biết thông tin bí mật.
- **Thanh toán:** chưa tích hợp Google Play Billing; **không thu tiền hoặc đánh dấu đã mua** khi chưa có xác minh giao dịch phía server. Sản phẩm số trong app Play phải tuân thủ chính sách Google Play Billing áp dụng.
- **Tài khoản & dữ liệu:** trước khi bán Premium cần hệ thống đăng nhập, định danh người mua, lưu entitlement bền vững và cơ chế khôi phục giao dịch. ID phòng / localStorage hiện tại không đủ để làm chủ sở hữu vật phẩm.
- **An toàn:** không để client tự cấp Premium, không dùng nút mua giả, không khuyến khích chi tiêu với người dùng nhỏ tuổi. Cần chính sách tuổi và xử lý nội dung chat/người dùng trước khi phát hành rộng rãi.

## Checklist phát hành

- [ ] Xây dựng Android assets cục bộ, tách kết nối Socket.IO về URL HTTPS
- [ ] Kiểm thử phòng 5–12 người, reconnect, thông báo lỗi mạng, quay lại Android
- [ ] Thiết kế icon, splash, screenshot, mô tả và chính sách quyền riêng tư
- [ ] Đăng ký tài khoản Play Console hợp lệ, hoàn tất yêu cầu kiểm thử
- [ ] Tích hợp Google Play Billing và xác minh server trước khi mở bán
- [ ] Build Android App Bundle đã ký, tải lên Play Console để xét duyệt

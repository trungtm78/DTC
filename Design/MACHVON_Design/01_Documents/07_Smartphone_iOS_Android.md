# Hệ Thống Lý Dự Án Đầu Tư Công thiết kế ứng dụng smartphone
Baseline 1.3 | 22/10/2026 | Ứng dụng iOS và Android, đồng bộ cùng tenant và nguồn dữ liệu web.

## Phạm vi và chiến lược ứng dụng
Ứng dụng hướng tới lãnh đạo phê duyệt/điều hành, cán bộ báo cáo, hiện trường, kế toán theo dõi và chuyên gia đọc tóm tắt AI. Các công việc cấu hình BI phức tạp, bảng giá LLM, master data hàng loạt và quản trị platform thực hiện ưu tiên trên web; mobile có quyền xem/hành động được thiết kế riêng. Không thu nhỏ nguyên màn hình desktop để gọi là thiết kế mobile.

Baseline có 66 màn hình MOB-01 đến MOB-66, cộng component/state dùng chung. Một ứng dụng đa tenant, sau tenant discovery nhận theme và IdP config hợp lệ; logout/đổi tenant dọn cache đúng namespace. App white-label riêng là tùy chọn gói triển khai với bundle ID, signing, push credentials và release train riêng.

## Điều hướng và luồng công việc
Thanh dưới gồm Trang chủ, Dự án, Phê duyệt, Thông báo, Cá nhân; mục có badge không gây quá tải. Hành động nổi tạo báo cáo/vướng mắc tùy role. Home cán bộ đưa việc đến hạn lên trước; home lãnh đạo có tóm tắt vốn và quyết định cần duyệt. Back quay về đúng scroll/filter; deep link cần đăng nhập và kiểm tenant trước mở.

Luồng báo cáo: MOB-13 chọn kỳ → 14 khối lượng → 15 vốn năm → 16 vốn kéo dài → 17 vốn khác → 18 đăng ký tháng sau → 19 đính kèm → 20 rà soát → 21 kết quả. Có lưu nháp ở mỗi bước, hiển thị đơn vị tiền sát input. CTMTQG nằm dưới nguồn cha và hiện như subset, không là ô cộng độc lập. Khi không áp dụng hiển thị “Không áp dụng”, không dùng ô 0 khiến hiểu nhầm.

Luồng duyệt: MOB-23 danh sách → 24 chi tiết, so sánh và chứng từ → 25 xác nhận/step-up → kết quả. Trả lại qua MOB-26 với lý do và mục cần sửa. Chữ ký số dùng provider/SDK đã thẩm định, sinh trắc học chỉ mở khóa credential hoặc step-up theo IdP, không tự là chữ ký pháp lý.

Luồng hiện trường: MOB-28 nhập → 29 ảnh/chú thích → 30 vị trí/checklist → 31 theo dõi. Camera và location chỉ xin khi dùng, có đường thay thế đính tệp hoặc nhập vị trí thủ công có nhãn. Không yêu cầu background location mặc định. Ảnh trước upload được kiểm kích thước, loại, nén phù hợp và giữ bản gốc theo retention nếu cần chứng cứ.

Luồng AI: MOB-37 hỏi đáp theo ACL; 38 tóm tắt nhà thầu; 39 mở nguồn. Màn nhỏ ưu tiên một finding mỗi card, hiển thị trạng thái cần kiểm chứng; chuyển sang tablet/web cho so sánh bảng nhiều nhà thầu. Không phê duyệt tự động bằng swipe hoặc push action một chạm.

## Offline và đồng bộ
MOB-41 queue hiển thị từng item, dung lượng, tiến trình và lý do lỗi; 42 conflict so sánh bản local/server; 43 offline giải thích khả năng hiện tại. Dữ liệu cache có as_of/TTL; offline không được hiển thị “mới nhất”. Nháp có UUID để retry không nhân đôi. Attachment upload resumable, checksum và liên kết sau virus scan.

Mất kết nối khi submit: hiển thị “Chưa xác định kết quả”, tra status theo idempotency key khi nối lại; không tự tạo submit mới. Nếu kỳ/license/quyền thay đổi, nháp được giữ an toàn nhưng gửi bị từ chối với hướng dẫn. Server là nguồn thẩm quyền; không lấy giờ máy để đánh giá license hoặc deadline. Conflict tiền phải người dùng xem, không auto last-write-wins.

## Push và đa kênh
APNs/FCM là adapter. Device registration gắn tenant/user/device/platform/token fingerprint, permission state và last_seen. Một người nhiều thiết bị có policy dedupe/chủ thiết bị. Token refresh cập nhật idempotent; logout revoke server token và cache; token invalid bị loại. Push chỉ chứa nội dung tối thiểu và opaque deep link; không chứa hồ sơ thầu, tiền nhạy cảm hoặc URL download dài hạn.

MOB-32/33 có hộp thông báo và detail, filter unread/priority, read khác acknowledged. MOB-34 chỉnh kênh, loại sự kiện, quiet hours và digest. MOB-35/36 hội thoại gắn hồ sơ; rõ nội bộ hay gửi bên ngoài. Thu hồi consent trên mobile đồng bộ vào cùng preference service của web. Không giả định push đến nghĩa người dùng đã đọc.

## Thiết kế thích ứng và tương tác
Khung tham chiếu 390×844, kiểm thêm 360×800 và 430×932, safe area/notch, landscape cho tài liệu, tablet split view cho evidence. Touch target iOS ≥44 pt, Android ≥48 dp. Cỡ input 16 px tránh zoom không chủ ý trên browser prototype; native dùng dynamic type/font scaling. CTA chính nằm trong vùng dễ chạm, keyboard không che input/error; confirm dài có tóm tắt trước nút.

Microinteraction: trạng thái đang lưu, checkmark đã lưu, progress upload thực, pull-to-refresh cho danh sách, haptic nhẹ khi hoàn tất theo tùy chọn. Không dùng gesture là cách duy nhất cho chức năng quan trọng. Reduced motion, screen reader labels, contrast và focus native phải được test trên thiết bị thật.

## Bảo mật và vòng đời phát hành
OIDC Authorization Code + PKCE, system browser, refresh token secure storage/keychain, rotation và revoke. Pinning/MDM/root policy là quyết định theo threat model và có kế hoạch rotation; không hard-code chặn mọi thiết bị mà thiếu hỗ trợ. Local DB encrypted; khóa theo user/tenant, khóa nháp khi phiên hết hạn. Screenshot protection cho hồ sơ mật theo khả năng OS/chính sách, không coi là bảo vệ tuyệt đối.

API version tương thích với N và N-1 app theo chính sách phát hành. Remote config có ký/kiểm tra, không được cấp quyền vượt server. Forced upgrade chỉ khi không còn an toàn/tương thích, hiển thị lý do và xử lý nháp. Crash log redact; analytics không gửi nội dung hồ sơ. Staged rollout, rollback server features và danh sách lỗi thiết bị.

## Tiêu chí bàn giao và kiểm thử
Kiểm trên iOS/Android thiết bị thật cho PKCE/MFA, camera, location từ chối, push permission denied/token rotate, background/foreground, app killed khi lưu/upload, đổi tenant, license expired, network flapping, conflict và accessibility. Xác nhận cold-start/tải danh sách theo thiết bị mục tiêu, không dùng số desktop để khẳng định mobile performance.

Prototype HTML có thể mở trong browser điện thoại khi được phục vụ qua mạng nội bộ hoặc hosting được cho phép. Đây chưa phải APK/IPA, chưa có push native hay sync backend. Để sử dụng nghiệp vụ thật cần xây ứng dụng, triển khai API/IdP, ký ứng dụng, kiểm thử và phân phối qua cửa hàng hoặc MDM theo tổ chức.


## Theme & thương hiệu theo tenant — SAS-04

Chỉ System Admin được cấu hình thương hiệu cho các tenant: màu sắc, logo, menu, header, footer, tên hệ thống, địa chỉ và thông tin liên hệ. Tenant Admin chỉ được đọc cấu hình đã công bố của tenant mình, không được sửa, lưu nháp, tải logo, tạo review, áp dụng hoặc khôi phục. Các quyền quản trị nội bộ tenant khác không bao gồm quyền cấu hình thương hiệu.

Bản nháp tách biệt theo tenant và không thay đổi giao diện đang dùng. Xem trước web/smartphone trong vùng riêng; bước review hiển thị chênh lệch trước/sau, tenant đích và phiên bản gốc. Xác nhận áp dụng tạo phiên bản bất biến mới. Khôi phục cũng phải review và tạo phiên bản mới, giữ nguyên lịch sử. Kiểm tra trường bắt buộc, email, tệp logo và sáu cặp màu tương phản tối thiểu 4,5:1 trước khi công bố.

Server phải xác thực System Admin cho mọi lệnh ghi; không tin vai trò, tenant_id hoặc cờ quyền do trình duyệt gửi. Review gắn actor, tenant, hash nội dung, base version và hạn sử dụng. Kiểm tra lại quyền và phiên bản trong giao dịch công bố; trả 403 khi thiếu quyền, 409 khi xung đột, 422 khi cấu hình không hợp lệ. Audit ghi người thực hiện, tenant, bản trước/sau, lý do khôi phục và thời điểm; không ghi bí mật vào log.

Prototype SAS-04 dùng localStorage và bộ chọn vai trò mô phỏng để kiểm tra trải nghiệm. Đây không phải hệ thống xác thực hoặc cách ly tenant thật. Chi tiết triển khai và tiêu chí nghiệm thu nằm tại 03_Engineering/Tenant_Theme_Specification.html.


## Kế hoạch triển khai mobile và kiểm thử
66 route mobile giữ nguyên; chia slice theo API backend đã chốt. Offline chỉ draft; approval cần online và recheck quyền. Device matrix và phiên bản OS chốt D09; test real iOS/Android về camera, secure storage, biometric, background/kill, push deep link, upload resume và text scaling. App nhận published theme đúng tenant; đổi icon/tên store riêng là P2 white-label build, không thuộc đổi token runtime. MOB01/MOB02 kiểm sync/cache; viewport browser không thay test native.

Tài liệu điều phối: 09_Ke_hoach_trien_khai; 10_Ke_hoach_kiem_thu_va_chuyen_doi; 03_Engineering/Implementation_Backlog.html; 03_Engineering/Test_Case_Catalogue.html; 03_Engineering/Decision_Register.html.

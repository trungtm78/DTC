# MOB — Ứng dụng smartphone iOS/Android (Flutter)
Baseline 1.4 | Quyết định D-B12 (Flutter), A1 (sync rules cách ly), R6 (tenant), R7 (không auto-merge tiền). Màn hình MOB-01…MOB-66 giữ nguyên ID; thêm MOB-67, MOB-68.

## 1. Mục đích, phạm vi, ranh giới
Ứng dụng một mã nguồn Flutter cho iOS và Android phục vụ lãnh đạo (xem, phê duyệt, ký), cán bộ báo cáo, hiện trường (vướng mắc, nhật ký, khối lượng, ảnh), kế toán theo dõi và chuyên gia đọc tóm tắt AI. Cấu hình BI phức tạp, bảng giá LLM, master data hàng loạt và quản trị nền tảng ở lại web. Không thu nhỏ màn hình desktop; mỗi luồng có thiết kế riêng cho màn nhỏ.
- **Phụ thuộc:** IAM (đăng nhập OIDC, chọn đơn vị/vai trò, thiết bị), DIS/CAP/PRJ (báo cáo, dự án, vốn), CTR/QMS/PAY/ISS (hiện trường, nghiệm thu, thanh toán), NOT/OMNI (thông báo, hội thoại), DOC (văn bản chờ ký), LLM/BID (AI có nguồn), SAS (license/entitlement), BI (dashboard cá nhân).
- **Ngoài phạm vi R1:** white-label bundle riêng (tùy chọn gói), phê duyệt online trên mobile khi quyền/audit chưa hoàn tất, thanh toán trong ứng dụng.
- **Căn cứ:** tài liệu 07; thực tiễn offline-first của PowerSync/Procore mobile; Luật BVDLCN 91/2025 cho vị trí/ảnh/thiết bị.

## 2. Actor, tenant và phạm vi quyền
| Actor | Phạm vi | Được phép | Bị cấm |
|---|---|---|---|
| Lãnh đạo | Cây đơn vị được cấp | Xem tổng hợp, duyệt/trả lại, ký (step-up) | Duyệt bằng swipe hoặc một chạm từ push |
| Cán bộ báo cáo | Dự án thuộc đơn vị | Lập/nộp báo cáo, nháp, đính kèm | Sửa số đã nộp (phải qua điều chỉnh) |
| Hiện trường | Dự án/hợp đồng được giao | Vướng mắc, nhật ký, ảnh, vị trí, khối lượng | Duyệt nghiệm thu khi offline |
| Kế toán | Hợp đồng/thanh toán được cấp | Theo dõi thanh toán, đối soát | Tạo đề nghị thanh toán |
| Nhà thầu (guest) | Hợp đồng được mời | Nhật ký, khối lượng, phản hồi nghiệm thu | Xem hợp đồng khác, dữ liệu vốn tỉnh |
Một ứng dụng đa tenant: sau tenant discovery nhận theme và cấu hình IdP hợp lệ; **mỗi tenant một vùng lưu trữ cục bộ riêng**; đổi tenant hoặc đăng xuất xóa vùng đó theo lựa chọn bảo mật (có cảnh báo mất nháp).

## 3. Luồng nghiệp vụ
**L1 Đăng nhập (MOB-01→06):** nhận diện tenant → OIDC Authorization Code + PKCE qua trình duyệt hệ thống → MFA → chọn đơn vị/vai trò → xin quyền thông báo, camera/vị trí chỉ khi dùng (có đường thay thế đính tệp hoặc nhập vị trí thủ công có nhãn). Lỗi: phiên hết hạn (MOB-44), không đủ quyền (MOB-45), license hết hạn (MOB-46).
**L2 Báo cáo tuần (MOB-13→21):** chọn kỳ → khối lượng → vốn năm → vốn kéo dài → vốn khác → đăng ký tháng sau → đính kèm → rà soát → kết quả. Lưu nháp từng bước, đơn vị tiền sát ô nhập, CTMTQG là subset (không là ô cộng), hiển thị hai tỷ lệ giải ngân theo DIS. Nộp = một command có `client_operation_id`.
**L3 Phê duyệt (MOB-23→26, 65, 67):** danh sách → chi tiết + so sánh + chứng từ → xác nhận với **step-up** (IdP) → kết quả; trả lại có lý do và mục cần sửa. Chữ ký số qua nhà cung cấp/SDK đã thẩm định; sinh trắc học chỉ mở khóa credential, không tự là chữ ký pháp lý.
**L4 Hiện trường (MOB-28→31, 62→64):** nhập vướng mắc/nhật ký → ảnh có chú thích (kiểm kích thước, loại, nén; giữ bản gốc theo retention) → vị trí/checklist → theo dõi. Không yêu cầu background location mặc định.
**L5 Offline và đồng bộ (MOB-41→43):** xem mục 4 và 6.
**L6 AI (MOB-37→39):** hỏi đáp theo ACL, một phát hiện mỗi thẻ, mở nguồn; so sánh bảng nhiều nhà thầu chuyển sang web/tablet. Không phê duyệt tự động bằng swipe hay push một chạm.
**Xử lý đồng thời:** nháp là bản ghi cục bộ có UUID; hai thiết bị cùng sửa một nháp → server từ chối bản cũ bằng `409 DRAFT_VERSION_CONFLICT` kèm bản server; người dùng chọn (MOB-42).

## 4. State machine
Mục lệnh trong hàng đợi (`queued_command`):
```
 QUEUED ──send──► SENDING ──accepted──► ACCEPTED (xóa khỏi hàng đợi, giữ biên nhận)
    │                │ ├─rejected──► REJECTED (hiển thị lý do, người dùng sửa hoặc bỏ)
    │                │ ├─conflict──► CONFLICT ──resolve──► QUEUED
    │                │ └─timeout/ngắt kết nối──► UNKNOWN (tra theo idempotency key khi nối lại)
    └─discard─► DISCARDED
```
| Từ | Sự kiện | Đến | Guard |
|---|---|---|---|
| QUEUED | gửi khi online | SENDING | quyền/kỳ/license còn hiệu lực theo server |
| SENDING | mất kết nối trước phản hồi | UNKNOWN | **không tự tạo lệnh mới**; hiển thị "Chưa xác định kết quả" |
| UNKNOWN | nối lại | ACCEPTED hoặc REJECTED | `GET /sync/commands/{key}` theo idempotency key |
| SENDING | server trả conflict | CONFLICT | trường tiền luôn cần người dùng xem, không last-write-wins |
Cấm: gửi lệnh duyệt/nộp từ cache khi quyền, kỳ hoặc license chưa kiểm online; dùng giờ máy để đánh giá hạn hoặc license (server là nguồn thẩm quyền).

## 5. Quy tắc nghiệp vụ và công thức
- **BR-MOB-01** Cache dữ liệu có `as_of` và TTL; offline không được hiển thị "mới nhất".
- **BR-MOB-02** Trường tiền offline là chỉ-đọc ở dữ liệu tham chiếu; chỉ nhập mới được xếp hàng dưới dạng lệnh.
- **BR-MOB-03** Đính kèm: tải lên chia khối, tiếp tục được, checksum SHA-256; chỉ liên kết vào hồ sơ sau khi quét virus thành công.
- **BR-MOB-04** Push chỉ chứa nội dung tối thiểu và liên kết sâu mờ (opaque); không chứa hồ sơ thầu, số tiền nhạy cảm hay URL tải dài hạn. Push không có nghĩa đã đọc; "đã đọc" khác "đã xác nhận".
- **BR-MOB-05** Liên kết sâu luôn yêu cầu đăng nhập và kiểm tenant trước khi mở.
- **BR-MOB-06** Ảnh hiện trường lưu EXIF GPS/thời điểm chỉ khi người dùng đồng ý; vị trí thủ công mang nhãn nguồn.

## 6. Dữ liệu
Cục bộ (SQLite mã hóa, khóa trong Keychain/Keystore): `local_draft`, `queued_command`, `cached_row` (theo bucket đồng bộ), `attachment_upload`. Máy chủ (mới):
| Bảng | Trường chính | Ràng buộc |
|---|---|---|
| `sync_membership_scope` | tenant_id, membership_id, scope_kind (unit_subtree/project/contract), scope_ref_id, effective_from/until | Nguồn duy nhất để PowerSync suy ra bucket; RLS + chỉ ghi qua command IAM |
| `sync_command_receipt` | tenant_id, device_id, idempotency_key (unique theo tenant+device), command_type, status, result_ref, received_at | Dùng cho tra trạng thái UNKNOWN; giữ 7 ngày theo retention idempotency của lệnh hàng đợi offline (`04_Thiet_ke_co_ban.md`, CR-04-37) |
| `sync_attachment` | tenant_id, id, device_id, sha256, size_bytes, status (UPLOADING/SCANNING/CLEAN/INFECTED), storage_key | Liên kết chỉ khi CLEAN; storage_key có tiền tố tenant |
Phân loại: nháp và ảnh là dữ liệu nội bộ; vị trí và định danh thiết bị là dữ liệu cá nhân (consent, retention theo chính sách thiết bị).

## 7. API / command
| operationId | Method path | Quyền | Ghi chú |
|---|---|---|---|
| `post_sync_batches` | POST /sync/batches | `sync.submit` | Idempotency-Key từng mục; trả accepted/conflict/rejected theo mục, không hỏng cả lô vì một lỗi |
| `get_sync_commands_key` | GET /sync/commands/{idempotencyKey} | `sync.submit` | Tra trạng thái UNKNOWN |
| `post_sync_attachments` | POST /sync/attachments | `sync.upload` | Khởi tạo tải lên; khối gửi bằng URL ký ngắn hạn có tiền tố tenant |
| `post_sync_attachments_id_complete` | POST /sync/attachments/{id}/complete | `sync.upload` | So checksum; chuyển sang SCANNING |
Đăng ký thiết bị và thu hồi dùng `/devices` và `/me/devices/{deviceId}/revoke` của IAM. Lỗi: `400 FIELD_NOT_ALLOWED`, `403 SCOPE_DENIED`, `409 DRAFT_VERSION_CONFLICT`, `409 IDEMPOTENCY_CONFLICT`, `422 PERIOD_LOCKED`, `422 LICENSE_EXPIRED`. Rà soát GET scaffold `device_registration`: DTO riêng (ẩn `push_secret_ref`, `token_fingerprint`).

## 8. UI/UX
Khung tham chiếu 390×844, kiểm 360×800 và 430×932, safe area, tablet split view cho bằng chứng; chạm tối thiểu 44 pt (iOS) và 48 dp (Android); dynamic type/font scaling; không dùng cử chỉ là cách duy nhất cho chức năng quan trọng. Theme sinh từ `design_tokens.json` (ThemeData) và theme tenant công bố; thanh dưới gồm Trang chủ, Dự án, Phê duyệt, Thông báo, Cá nhân. **MOB-67 Văn bản chờ ký** (kind `approval`: xem PDF, so sánh phiên bản, ký step-up) và **MOB-68 Nhiệm vụ GPMB hiện trường** (kind `form`: cập nhật kiểm đếm, ảnh, hẹn dân). MOB-41 thêm trường dung lượng và lý do lỗi; MOB-42 hiển thị bản máy/bản server/chênh lệch. Trạng thái chuẩn thêm: offline, sync pending/conflict, từ chối quyền camera/push.

## 9. Sự kiện, job, tích hợp, quan sát
Sự kiện: `sync.command_accepted.v1`, `sync.command_rejected.v1`, `sync.attachment_clean.v1`. APNs/FCM là adapter; token refresh idempotent; đăng xuất thu hồi token phía server. Chỉ số: độ dài hàng đợi, tỷ lệ UNKNOWN, độ trễ đồng bộ, tỷ lệ conflict, crash-free sessions (không PII, có `tenant_id`). Cảnh báo khi UNKNOWN > ngưỡng hoặc bucket đồng bộ trống bất thường.

## 10. Kiểm thử
| ID | Loại | P | Kịch bản (tóm tắt) | Expected |
|---|---|---|---|---|
| UAT-AC500 | E2E bảo mật | P0 | Người dùng tenant A đồng bộ; tenant B có dữ liệu | Không dòng nào của B nằm trong DB cục bộ |
| UAT-AC501 | E2E bảo mật | P0 | Thu hồi membership khi thiết bị offline, rồi nối lại | Lần đồng bộ kế tiếp làm bucket rỗng và xóa dữ liệu cũ |
| UAT-AC502 | E2E | P0 | Nộp báo cáo, ngắt mạng trước phản hồi, nối lại | Trạng thái "Chưa xác định" rồi ACCEPTED; một bản ghi |
| UAT-AC503 | domain | P0 | Gửi lại cùng key khác nội dung | 409 `IDEMPOTENCY_CONFLICT` |
| UAT-AC504 | E2E | P0 | Hai thiết bị sửa cùng nháp, số tiền khác nhau | Conflict hiển thị cả hai bản; không tự ghi đè |
| UAT-AC505 | E2E | P1 | Đổi tenant | Không tải lên bằng tenant mới; vùng cũ xử lý đúng chính sách |
| UAT-AC506 | integration | P1 | Tệp nhiễm virus | Không liên kết vào hồ sơ; người dùng thấy lý do |
| UAT-AC507 | E2E | P1 | Kỳ bị khóa trong lúc nháp offline | Nháp giữ nguyên, gửi bị từ chối `PERIOD_LOCKED` |
Chi tiết bước, dữ liệu synthetic và bằng chứng nằm trong `test_cases.json`.

## 11. Tiêu chí nghiệm thu
- **AC-MOB-01** Given tenant A và B có dữ liệu, When người dùng A đồng bộ, Then DB cục bộ không chứa dòng nào của B (UAT-AC500).
- **AC-MOB-02** Given thiết bị offline và membership bị thu hồi, When nối lại, Then bucket rỗng và dữ liệu cũ bị xóa trong một lần đồng bộ (UAT-AC501).
- **AC-MOB-03** Given mất kết nối khi nộp, When nối lại, Then chỉ có một bản ghi và trạng thái được tra theo idempotency key (UAT-AC502).
- **AC-MOB-04** Given xung đột số tiền, When đồng bộ, Then người dùng phải chọn; hệ thống không last-write-wins (UAT-AC504).

## 12. Mức tối thiểu cho R1 và phần sâu hóa R2+
R1 (dùng thật): L1, L2 (báo cáo tuần), L3 (phê duyệt không ký), L4 (vướng mắc + ảnh), offline queue với UNKNOWN/conflict, thông báo, sync rules cách ly. R2: nhật ký/khối lượng/nghiệm thu, MOB-67 ký số, MOB-68, đối soát thanh toán. R3: push đa thiết bị, chữ ký số bằng SDK nhà cung cấp, AI trên mobile. **Bắt buộc người duyệt:** sync rules (cách ly tenant), đường tiền trong báo cáo, quy trình ký. Ước tính giờ review: `[GIẢ ĐỊNH]` đặt sau spike Flutter.

## 13. Rủi ro, câu hỏi mở, phụ thuộc bên thứ ba
| Mục | Owner | Điều kiện giải quyết |
|---|---|---|
| PowerSync cần `wal_level=logical` trên cloud VN | Security/Platform | Spike 2 (tài liệu 09): nhà cung cấp cho phép hoặc Postgres tự quản |
| SDK chữ ký số di động | Integration Lead (D05) | Nhà cung cấp và hợp đồng SDK được duyệt |
| Pinning/MDM/root policy | Security | Kết quả threat model; không chặn cứng thiết bị khi thiếu hỗ trợ |
| Ước tính giờ review Flutter | PO | Sau spike Flutter (OIDC+PKCE, offline queue, upload tiếp tục) |

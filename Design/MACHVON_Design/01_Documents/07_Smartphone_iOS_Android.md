# Hệ Thống Lý Dự Án Đầu Tư Công thiết kế ứng dụng smartphone
Baseline 1.4 | 22/10/2026 | Ứng dụng iOS và Android viết bằng Flutter (D-B12), đồng bộ cùng tenant và nguồn dữ liệu web. Đặc tả phân hệ chi tiết: `05_modules/MOB.md`; khi tài liệu này và MOB.md khác nhau về luồng, trạng thái, API hay test thì MOB.md thắng. (Cập nhật 1.4 — CR-SMP-00)

(Bổ sung 1.4 — CR-SMP-00) Quy ước baseline 1.4: đoạn không có nhãn là nguyên văn baseline 1.3 và vẫn đúng; "(Cập nhật 1.4 — CR-SMP-nn)" là đoạn baseline được sửa; "(Bổ sung 1.4 — CR-SMP-nn)" là nội dung mới; đoạn bị bỏ được liệt kê ở "Phụ lục: ánh xạ nội dung baseline 1.3". Mã màn hình MOB-01..66 giữ nguyên.

## Phạm vi và chiến lược ứng dụng
Ứng dụng hướng tới lãnh đạo phê duyệt/điều hành, cán bộ báo cáo, hiện trường, kế toán theo dõi và chuyên gia đọc tóm tắt AI. Các công việc cấu hình BI phức tạp, bảng giá LLM, master data hàng loạt và quản trị platform thực hiện ưu tiên trên web; mobile có quyền xem/hành động được thiết kế riêng. Không thu nhỏ nguyên màn hình desktop để gọi là thiết kế mobile.

Baseline 1.4 có 68 màn hình MOB-01 đến MOB-68 (MOB-01..66 của baseline 1.3 giữ nguyên; thêm MOB-67 Văn bản chờ ký, kiểu approval: xem PDF, so sánh phiên bản, ký với step-up; MOB-68 Nhiệm vụ GPMB hiện trường, kiểu form: cập nhật kiểm đếm, ảnh, hẹn dân), cộng component/state dùng chung. Một ứng dụng đa tenant, sau tenant discovery nhận theme và IdP config hợp lệ; mỗi tenant một vùng lưu trữ cục bộ riêng; logout/đổi tenant dọn cache đúng namespace. Nhà thầu dùng cùng ứng dụng với tư cách Contractor Guest, chỉ thấy hợp đồng được mời. App white-label riêng là tùy chọn gói triển khai với bundle ID, signing, push credentials và release train riêng. (Cập nhật 1.4 — CR-SMP-01)

(Bổ sung 1.4 — CR-SMP-02) **Công nghệ (D-B12, thay mọi phương án React Native hoặc "Flutter/React Native sau spike" của baseline 1.3).** Một mã nguồn Flutter (Dart) cho iOS và Android; client API Dart sinh từ `03_Engineering/openapi.json`; `ThemeData` sinh từ `design_tokens.json` cộng theme tenant đã công bố (SAS-04); đồng bộ offline bằng PowerSync Flutter SDK trên PowerSync Open Edition tự host tại cloud nội địa; SQLite cục bộ mã hóa, khóa lưu trong Keychain/Keystore; đăng nhập OIDC Authorization Code + PKCE qua trình duyệt hệ thống; push qua adapter APNs/FCM. Vì không chia sẻ mã TypeScript với web, contract test giữa backend và client Dart là cổng bắt buộc trong CI. Spike Flutter (OIDC + PKCE, hàng đợi lệnh offline, tải ảnh có checksum tiếp tục khi mất mạng, theme sinh từ tokens) chạy ở R0 theo `09_Ke_hoach_trien_khai.md` mục 6.

## Điều hướng và luồng công việc
Thanh dưới gồm Trang chủ, Dự án, Phê duyệt, Thông báo, Cá nhân; mục có badge không gây quá tải. Hành động nổi tạo báo cáo/vướng mắc tùy role. Home cán bộ đưa việc đến hạn lên trước; home lãnh đạo có tóm tắt vốn và quyết định cần duyệt. Back quay về đúng scroll/filter; deep link cần đăng nhập và kiểm tenant trước mở.

Luồng báo cáo: MOB-13 chọn kỳ → 14 khối lượng → 15 vốn năm → 16 vốn kéo dài → 17 vốn khác → 18 đăng ký tháng sau → 19 đính kèm → 20 rà soát → 21 kết quả. Có lưu nháp ở mỗi bước, hiển thị đơn vị tiền sát input. CTMTQG nằm dưới nguồn cha và hiện như subset, không là ô cộng độc lập. Khi không áp dụng hiển thị “Không áp dụng”, không dùng ô 0 khiến hiểu nhầm.

(Bổ sung 1.4 — CR-SMP-03) Luồng báo cáo dùng cùng command và DTO với web (`05_modules/DIS.md`, MOB-13 = DIS-02 … MOB-21 = DIS-07/18), cùng validation server; hiển thị hai tỷ lệ giải ngân song song theo DIS [CXN-03]; nộp là một command có `client_operation_id` và Idempotency-Key. Kỳ có ba trạng thái Open, SoftClosed (vẫn nhận, đánh dấu trễ), Locked (từ chối `PERIOD_LOCKED` trừ cửa sổ mở lại đã duyệt).

Luồng duyệt: MOB-23 danh sách → 24 chi tiết, so sánh và chứng từ → 25 xác nhận/step-up → kết quả. Trả lại qua MOB-26 với lý do và mục cần sửa. Chữ ký số dùng provider/SDK đã thẩm định, sinh trắc học chỉ mở khóa credential hoặc step-up theo IdP, không tự là chữ ký pháp lý.

(Bổ sung 1.4 — CR-SMP-03) Phê duyệt gồm thêm MOB-65 (duyệt nghiệm thu) và MOB-67 (văn bản chờ ký của DOC: lãnh đạo ký PAdES trên bản PDF cuối; cấp số và ký số cơ quan do văn thư thực hiện trên web, R8). Phê duyệt chỉ thực hiện khi online, sau khi server kiểm lại quyền, kỳ và license; không có phê duyệt từ cache, swipe hay một chạm từ push.

Luồng hiện trường: MOB-28 nhập → 29 ảnh/chú thích → 30 vị trí/checklist → 31 theo dõi. Camera và location chỉ xin khi dùng, có đường thay thế đính tệp hoặc nhập vị trí thủ công có nhãn. Không yêu cầu background location mặc định. Ảnh trước upload được kiểm kích thước, loại, nén phù hợp và giữ bản gốc theo retention nếu cần chứng cứ.

(Bổ sung 1.4 — CR-SMP-03) Hiện trường gồm thêm MOB-62 nhật ký công trường, MOB-63 khối lượng và bằng chứng, MOB-64 kiểm tra chất lượng (QMS/CTR) và MOB-68 nhiệm vụ GPMB (LND). Dữ liệu hộ dân, CCCD là dữ liệu cá nhân, không đồng bộ xuống thiết bị trừ trường đặc tả LND cho phép theo vai trò; vị trí và định danh thiết bị là dữ liệu cá nhân, chỉ lưu EXIF GPS/thời điểm khi người dùng đồng ý (BR-MOB-06).

Luồng AI: MOB-37 hỏi đáp theo ACL; 38 tóm tắt nhà thầu; 39 mở nguồn. Màn nhỏ ưu tiên một finding mỗi card, hiển thị trạng thái cần kiểm chứng; chuyển sang tablet/web cho so sánh bảng nhiều nhà thầu. Không phê duyệt tự động bằng swipe hoặc push action một chạm.

## Offline và đồng bộ
MOB-41 queue hiển thị từng item, dung lượng, tiến trình và lý do lỗi; 42 conflict so sánh bản local/server; 43 offline giải thích khả năng hiện tại. Dữ liệu cache có as_of/TTL; offline không được hiển thị “mới nhất”. Nháp có UUID để retry không nhân đôi. Attachment upload resumable, checksum và liên kết sau virus scan.

Mất kết nối khi submit: hiển thị “Chưa xác định kết quả”, tra status theo idempotency key khi nối lại; không tự tạo submit mới. Nếu kỳ/license/quyền thay đổi, nháp được giữ an toàn nhưng gửi bị từ chối với hướng dẫn. Server là nguồn thẩm quyền; không lấy giờ máy để đánh giá license hoặc deadline. Conflict tiền phải người dùng xem, không auto last-write-wins.

(Bổ sung 1.4 — CR-SMP-04) **Cách ly tenant trong đồng bộ (A1).** PowerSync đọc WAL bằng role replication nên không đi qua RLS của PostgreSQL; cách ly tenant trên mobile là trách nhiệm của sync rules:
- JWT cho PowerSync do backend MACHVON cấp (TTL ≤ 5 phút), chứa người dùng, `tenant_id` của tenant đang hoạt động, membership và `scope_version`; không dùng tham số do client gửi để phân quyền.
- Mọi bucket có tham số lấy từ bảng `sync_membership_scope` (MOB sở hữu; ADM/IAM cập nhật qua sự kiện; `scope_kind` = cây đơn vị, dự án hoặc hợp đồng; có hiệu lực theo thời gian), lọc theo người dùng và tenant trong JWT; mọi truy vấn dữ liệu của bucket có điều kiện `tenant_id = bucket.tenant_id` và điều kiện scope. Ví dụ cú pháp ở `04_Thiet_ke_co_ban.md` mục PowerSync, xác nhận ở spike.
- Hợp đồng sync liệt kê bảng và cột được đồng bộ cho từng màn hình; trường tiền chỉ đọc; dữ liệu cá nhân không sync trừ khi đặc tả phân hệ cho phép.
- Thu hồi membership/grant hoặc `scope_version` tăng → bucket rỗng ở lần đồng bộ kế tiếp và app xóa dòng cục bộ, kể cả khi thiết bị offline lúc thu hồi.
- Đăng xuất hoặc đổi tenant: app xóa SQLite cục bộ, khóa mã hóa và cache tệp của tenant cũ; nếu còn lệnh chưa gửi, app chặn đổi tenant cho tới khi người dùng gửi xong hoặc chủ động hủy (cảnh báo mất nháp); lệnh mang `tenant_id`, `user_id` trong envelope và không bao giờ được gửi dưới tenant khác.

(Bổ sung 1.4 — CR-SMP-05) **Hàng đợi lệnh và trạng thái UNKNOWN.** Offline chỉ xếp hàng **lệnh** (command), không ghi trực tiếp bảng, không last-write-wins. Mỗi lệnh (`queued_command`) có Idempotency-Key = `local_uuid`, `base_server_version` và trạng thái:

| Từ | Sự kiện | Đến | Ghi chú |
|---|---|---|---|
| QUEUED | gửi khi online | SENDING | Server kiểm quyền, kỳ, license tại thời điểm nhận |
| SENDING | server chấp nhận | ACCEPTED | Xóa khỏi hàng đợi, giữ biên nhận |
| SENDING | server từ chối | REJECTED | Hiện lý do; người dùng sửa hoặc bỏ |
| SENDING | xung đột phiên bản | CONFLICT | MOB-42 hiển thị bản máy, bản server, chênh lệch; trường tiền luôn cần người dùng chọn; giải quyết xong quay lại QUEUED |
| SENDING | mất kết nối/timeout trước phản hồi | UNKNOWN | Hiển thị "Chưa xác định kết quả"; không tự tạo lệnh mới |
| UNKNOWN | nối lại | ACCEPTED hoặc REJECTED | Tra `GET /sync/commands/{idempotencyKey}` |
| QUEUED | người dùng hủy | DISCARDED | Không gửi |

API: `POST /sync/batches` (Idempotency-Key từng mục, trả accepted/conflict/rejected theo mục, một mục lỗi không hỏng cả lô), `GET /sync/commands/{idempotencyKey}`, `POST /sync/attachments` và `POST /sync/attachments/{id}/complete` (tải chia khối qua URL ký ngắn hạn có tiền tố tenant, so SHA-256, chỉ liên kết khi quét virus CLEAN). Lỗi: `409 DRAFT_VERSION_CONFLICT`, `409 IDEMPOTENCY_BODY_MISMATCH` (cùng key khác nội dung), `422 PERIOD_LOCKED`, `422 LICENSE_EXPIRED`, `403 SCOPE_DENIED`. Biên nhận lưu ở `sync_command_receipt` (unique theo tenant + thiết bị + key) theo retention idempotency. Chi tiết ở `05_modules/MOB.md` mục 4, 6, 7.

## Push và đa kênh
APNs/FCM là adapter. Device registration gắn tenant/user/device/platform/token fingerprint, permission state và last_seen. Một người nhiều thiết bị có policy dedupe/chủ thiết bị. Token refresh cập nhật idempotent; logout revoke server token và cache; token invalid bị loại. Push chỉ chứa nội dung tối thiểu và opaque deep link; không chứa hồ sơ thầu, tiền nhạy cảm hoặc URL download dài hạn.

MOB-32/33 có hộp thông báo và detail, filter unread/priority, read khác acknowledged. MOB-34 chỉnh kênh, loại sự kiện, quiet hours và digest. MOB-35/36 hội thoại gắn hồ sơ; rõ nội bộ hay gửi bên ngoài. Thu hồi consent trên mobile đồng bộ vào cùng preference service của web. Không giả định push đến nghĩa người dùng đã đọc.

(Bổ sung 1.4 — CR-SMP-06) Thời điểm kênh theo quy tắc chung của BRD: push và hộp thông báo trong ứng dụng có từ R1; hội thoại với kênh ngoài (Zalo, WhatsApp, SMS) ở MOB-35/36 chỉ bật khi D06 hoàn tất, không sớm hơn R2. Thông báo không trùng theo khóa chống trùng của NOT (tenant, sự kiện nguồn, người nhận, mục đích) dù người dùng có nhiều thiết bị.

## Thiết kế thích ứng và tương tác
Khung tham chiếu 390×844, kiểm thêm 360×800 và 430×932, safe area/notch, landscape cho tài liệu, tablet split view cho evidence. Touch target iOS ≥44 pt, Android ≥48 dp. Cỡ input 16 px tránh zoom không chủ ý trên browser prototype; native dùng dynamic type/font scaling. CTA chính nằm trong vùng dễ chạm, keyboard không che input/error; confirm dài có tóm tắt trước nút.

Microinteraction: trạng thái đang lưu, checkmark đã lưu, progress upload thực, pull-to-refresh cho danh sách, haptic nhẹ khi hoàn tất theo tùy chọn. Không dùng gesture là cách duy nhất cho chức năng quan trọng. Reduced motion, screen reader labels, contrast và focus native phải được test trên thiết bị thật.

## Bảo mật và vòng đời phát hành
OIDC Authorization Code + PKCE, system browser, refresh token secure storage/keychain, rotation và revoke. Pinning/MDM/root policy là quyết định theo threat model và có kế hoạch rotation; không hard-code chặn mọi thiết bị mà thiếu hỗ trợ. Local DB encrypted; khóa theo user/tenant, khóa nháp khi phiên hết hạn. Screenshot protection cho hồ sơ mật theo khả năng OS/chính sách, không coi là bảo vệ tuyệt đối.

API version tương thích với N và N-1 app theo chính sách phát hành. Remote config có ký/kiểm tra, không được cấp quyền vượt server. Forced upgrade chỉ khi không còn an toàn/tương thích, hiển thị lý do và xử lý nháp. Crash log redact; analytics không gửi nội dung hồ sơ. Staged rollout, rollback server features và danh sách lỗi thiết bị.

## Tiêu chí bàn giao và kiểm thử
Kiểm trên iOS/Android thiết bị thật cho PKCE/MFA, camera, location từ chối, push permission denied/token rotate, background/foreground, app killed khi lưu/upload, đổi tenant, license expired, network flapping, conflict và accessibility. Xác nhận cold-start/tải danh sách theo thiết bị mục tiêu, không dùng số desktop để khẳng định mobile performance.

(Bổ sung 1.4 — CR-SMP-07) Ca bắt buộc theo `05_modules/MOB.md` mục 10–11 (chi tiết bước và dữ liệu synthetic trong `test_cases.json`): UAT-AC500 người dùng tenant A đồng bộ không nhận dòng nào của tenant B (AC-MOB-01); UAT-AC501 thu hồi membership khi offline → lần đồng bộ kế bucket rỗng, dữ liệu cũ bị xóa (AC-MOB-02); UAT-AC502 mất mạng khi nộp → "Chưa xác định" rồi ACCEPTED, một bản ghi (AC-MOB-03); UAT-AC503 cùng key khác nội dung → 409 `IDEMPOTENCY_BODY_MISMATCH`; UAT-AC504 hai thiết bị sửa cùng nháp khác số tiền → conflict hiển thị cả hai, không tự ghi đè (AC-MOB-04); UAT-AC505 đổi tenant không tải lên bằng tenant mới; UAT-AC506 tệp nhiễm virus không liên kết; UAT-AC507 kỳ bị khóa khi nháp offline → nháp giữ nguyên, gửi bị `PERIOD_LOCKED`. Trợ năng theo NFR-ACCESSIBILITY-02 (TalkBack/VoiceOver, text scaling 200%, vùng chạm ≥ 48 dp).

Prototype HTML có thể mở trong browser điện thoại khi được phục vụ qua mạng nội bộ hoặc hosting được cho phép. Đây chưa phải APK/IPA, chưa có push native hay sync backend. Để sử dụng nghiệp vụ thật cần xây ứng dụng, triển khai API/IdP, ký ứng dụng, kiểm thử và phân phối qua cửa hàng hoặc MDM theo tổ chức.

## Theme & thương hiệu theo tenant — SAS-04
(Cập nhật 1.4 — CR-SMP-08) Khối đặc tả SAS-04 dán lặp của baseline 1.3 được thay bằng con trỏ. Ứng dụng chỉ nhận theme tenant đã công bố (chỉ System Admin cấu hình; Tenant Admin chỉ đọc) và áp lên `ThemeData` sinh từ `design_tokens.json`; đổi icon hoặc tên trên cửa hàng không thuộc đổi token runtime. Đặc tả, ma trận quyền, mã lỗi và tiêu chí nghiệm thu: `03_Engineering/Tenant_Theme_Specification.html` và `05_modules/SAS.md`.

## Kế hoạch triển khai mobile và kiểm thử
68 route mobile (66 của baseline 1.3 giữ nguyên, thêm MOB-67, MOB-68); chia slice theo API backend đã chốt. Offline chỉ xếp hàng lệnh và nháp; approval cần online và recheck quyền. Theo `05_modules/MOB.md` mục 12: R1 (dùng thật) gồm đăng nhập, báo cáo tuần, phê duyệt không ký, vướng mắc + ảnh, hàng đợi lệnh có UNKNOWN/CONFLICT, thông báo, sync rules cách ly; R2 gồm nhật ký/khối lượng/nghiệm thu, MOB-67 ký số, MOB-68, đối soát thanh toán; R3 gồm push đa thiết bị, chữ ký số bằng SDK nhà cung cấp (D05), AI trên mobile. PowerSync chỉ dựng ở slice mobile offline đầu tiên kèm runbook, backup/restore đã thử và cảnh báo (R1 hạ tầng). Device matrix và phiên bản OS chốt trong pilot charter D09; test real iOS/Android về camera, secure storage, biometric, background/kill, push deep link, upload resume và text scaling. App nhận published theme đúng tenant; đổi icon/tên store riêng thuộc white-label build ngoài R0–R4, không thuộc đổi token runtime. MOB01/MOB02 kiểm sync/cache; viewport browser không thay test native. Hạng mục bắt buộc người duyệt: sync rules (cách ly tenant), đường tiền trong báo cáo, quy trình ký. (Cập nhật 1.4 — CR-SMP-09)

Tài liệu điều phối: 05_modules/MOB.md; 04_Thiet_ke_co_ban; 09_Ke_hoach_trien_khai; 10_Ke_hoach_kiem_thu_va_chuyen_doi; 03_Engineering/Implementation_Backlog.html; 03_Engineering/Test_Case_Catalogue.html; 03_Engineering/Decision_Register.html. (Cập nhật 1.4 — CR-SMP-00)

## Danh sách CR của tài liệu 07 baseline 1.4
| CR | Nội dung | Nguồn quyết định |
|---|---|---|
| CR-SMP-00 | Header, quy ước, MOB.md là nguồn chi tiết, tài liệu điều phối | Plan 22/10 |
| CR-SMP-01 | 68 màn hình (MOB-67, MOB-68), vùng lưu trữ cục bộ theo tenant, Contractor Guest | MOB.md, R6 |
| CR-SMP-02 | Flutter thay React Native/chưa quyết; client Dart, ThemeData, PowerSync Flutter SDK, contract test | D-B12 |
| CR-SMP-03 | Luồng báo cáo/duyệt/hiện trường bổ sung (DIS parity, MOB-62..65, 67, 68, dữ liệu cá nhân) | MOB.md, DIS.md, R8 |
| CR-SMP-04 | Sync rules PowerSync tham số theo tenant/membership/scope | A1 |
| CR-SMP-05 | Hàng đợi lệnh với trạng thái UNKNOWN, API /sync | MOB.md §4, §7 |
| CR-SMP-06 | Thời điểm kênh ngoài, dedupe thông báo | CR-BRD-06, NOT.md |
| CR-SMP-07 | Ca kiểm thử UAT-AC500..507, AC-MOB-01..04 | MOB.md §10–11 |
| CR-SMP-08 | Bỏ khối SAS-04 dán lặp, thay con trỏ | O11 |
| CR-SMP-09 | Kế hoạch mobile theo R1/R2/R3, P2 → ngoài R0–R4 | Tài liệu 09, CR-BRD-02 |

## Phụ lục: ánh xạ nội dung baseline 1.3
| Đoạn baseline 1.3 bị bỏ | Nội dung nay nằm ở |
|---|---|
| SAS-04 đoạn 1 (chỉ System Admin cấu hình thương hiệu; Tenant Admin chỉ đọc) | Mục SAS-04 (con trỏ) của tài liệu này; `Tenant_Theme_Specification.html` |
| SAS-04 đoạn 2 (nháp tách tenant, xem trước web/smartphone, review, phiên bản bất biến, tương phản) | `Tenant_Theme_Specification.html`; `05_modules/SAS.md` §3.12 |
| SAS-04 đoạn 3 (server xác thực System Admin, review gắn actor/tenant/hash, 403/409/422, audit) | `Tenant_Theme_Specification.html`; `05_modules/SAS.md` BR-SAS-17 |
| SAS-04 đoạn 4 (prototype localStorage, không phải xác thực thật) | `Tenant_Theme_Specification.html` |
| "Baseline có 66 màn hình MOB-01 đến MOB-66, cộng component/st" (đoạn baseline) | Mục "Phạm vi và chiến lược ứng dụng", đoạn 68 màn hình MOB-01..68 và Flutter (CR-SMP-01, CR-SMP-02) |
| "Chỉ System Admin được cấu hình thương hiệu cho các tenant: m" (đoạn baseline) | Mục SAS-04 (con trỏ); `Tenant_Theme_Specification.html` |
| "Bản nháp tách biệt theo tenant và không thay đổi giao diện đ" (đoạn baseline) | `Tenant_Theme_Specification.html`; `05_modules/SAS.md` §3.12 |
| "Server phải xác thực System Admin cho mọi lệnh ghi; không ti" (đoạn baseline) | `Tenant_Theme_Specification.html`; `05_modules/SAS.md` BR-SAS-17 |
| "Prototype SAS-04 dùng localStorage và bộ chọn vai trò mô phỏ" (đoạn baseline) | `Tenant_Theme_Specification.html` |
| "## Kế hoạch triển khai mobile và kiểm thử 66 route mobile gi" (đoạn baseline) | Mục "Kế hoạch triển khai mobile và kiểm thử", viết lại theo R1/R2/R3 của MOB.md (CR-SMP-09) |
| "Tài liệu điều phối: 09_Ke_hoach_trien_khai; 10_Ke_hoach_kiem" (đoạn baseline) | Dòng "Tài liệu điều phối" cuối tài liệu (thêm 04, NFR, MOB/MDM/DGV, CR-…-00) |

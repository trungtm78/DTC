# Khung đặc tả phân hệ (áp dụng cho mọi tệp trong 05_modules)

Mỗi phân hệ một tệp `05_modules/<MÃ>.md`. Viết tiếng Việt, mã định danh (ID, operationId, tên bảng, trạng thái, mã lỗi) bằng tiếng Anh. Chỉ viết nội dung riêng của phân hệ; quy ước chung (tenant, RLS, idempotency, audit/outbox, lỗi, i18n, UI state) đã nằm ở `05_Thiet_ke_chi_tiet.md` và `04_Thiet_ke_co_ban.md` — tham chiếu, không chép lại. Mọi điểm chưa có căn cứ ghi `[GIẢ ĐỊNH]` hoặc `[CXN-<id>]` (chờ xác nhận pháp lý, xem sổ xác nhận trong `implementation_decisions.json`).

## 1. Mục đích, phạm vi, ranh giới
- Vấn đề nghiệp vụ, người dùng, giá trị; trong/ngoài phạm vi; phụ thuộc phân hệ khác (theo ID).
- Căn cứ pháp lý (số văn bản + hiệu lực) hoặc thực tiễn/thị trường (hệ thống tham chiếu).

## 2. Actor, tenant và phạm vi quyền
| Actor | Tenant/scope (cây đơn vị, dự án, hợp đồng, guest) | Hành động được phép | Hành động bị cấm |

## 3. Luồng nghiệp vụ (mỗi luồng trọng yếu)
- Tiền điều kiện / hậu điều kiện.
- Luồng chính (đánh số), nhánh thay thế, lỗi, hủy, retry, xử lý đồng thời (ai thắng, mã lỗi trả về).
- Màn hình liên quan (ID) và command/operationId mỗi bước.

## 4. State machine
Sơ đồ ASCII + bảng: `Từ | Command | Đến | Ai được làm | Guard (điều kiện) | Audit/Event`. Liệt kê chuyển trạng thái bị cấm và mã lỗi.

## 5. Quy tắc nghiệp vụ và công thức
ID `BR-<MÃ>-NN`; công thức kèm đơn vị (VND nguyên, %, ngày), làm tròn, thời điểm hiệu lực, nguồn dữ liệu, trường hợp mẫu số 0/không áp dụng. Quy tắc có căn cứ pháp lý lưu dạng dữ liệu (rule version có `legal_basis`, `effective_from/until`).

## 6. Dữ liệu
Bảng/thực thể (mới hoặc sửa): trường, kiểu, bắt buộc/null, mặc định, unique/FK/index, version, owner, classification (công khai/nội bộ/mật/cá nhân), retention. Bất biến DB (CHECK, unique một phần, ràng buộc lũy kế).

## 7. API / command
| operationId | Method path | Quyền (x-permission) | Request DTO (trường được phép) | Response | Lỗi (HTTP + code) | Idempotency | If-Match |
Rà soát GET scaffold của phân hệ: mỗi tài nguyên ghi `giữ (DTO đọc + mask)` / `DTO riêng` / `không expose` và lý do. Không có endpoint ghi chung cho status, tenant_id, role, số tiền đã chốt.

## 8. UI/UX
Màn hình (ID cũ giữ nguyên; ID mới theo đuôi tiếp), field thêm (ghi FR nguồn), validation, 7 trạng thái chuẩn + trạng thái riêng, quyền thao tác, khác biệt web/mobile. Tuân thủ mockup (D-B11): dùng đúng component families và tokens.

## 9. Sự kiện, job, tích hợp, quan sát
Domain event (tên, version, payload tối thiểu), outbox consumer, job nền/Temporal workflow, cache key (có tenant), telemetry (metric, log không PII), cảnh báo.

## 10. Kiểm thử
Bảng test: `ID | Loại (domain/integration/security/E2E/UAT) | Ưu tiên | Setup | Input | Bước | Expected | Bằng chứng`. Bắt buộc có: positive, negative, boundary, đồng thời, bảo mật (cách ly tenant, tự nâng quyền), idempotency. Dữ liệu synthetic.

## 11. Tiêu chí nghiệm thu (đo được)
`AC-<MÃ>-NN` dạng Given/When/Then, mỗi AC gắn test ID.

## 12. Mức tối thiểu cho R1 và phần sâu hóa R2+
Danh sách cụ thể phần nào thuộc R1 "dùng thật", phần nào R2/R3, và giờ review người dự kiến (hạng mục bắt buộc người duyệt: tiền, quyền, migration, mẫu văn bản pháp lý, quyết định AI).

## 13. Rủi ro, câu hỏi mở, phụ thuộc bên thứ ba
Mỗi mục có owner vai trò và điều kiện giải quyết.

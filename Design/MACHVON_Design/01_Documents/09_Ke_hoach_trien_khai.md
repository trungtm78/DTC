# Kế hoạch triển khai và kiểm soát phạm vi
Baseline 1.3 | 22/10/2026 | Kế hoạch đề xuất để refinement và phê duyệt, không phải cam kết tiến độ.

## Cách sử dụng bộ bàn giao
Đọc BRD để chốt phạm vi; FRD để chốt nghiệp vụ; thiết kế cơ bản để chốt kiến trúc; thiết kế chi tiết và Module_Implementation_Contracts.html để chia công việc; screen_catalog và prototype để review UI. implementation_backlog.json gồm đủ 327 màn hình, giữ nguyên ID; test_cases.json liên kết yêu cầu và checklist. Mỗi hạng mục phải chốt operationId, schema, rule và test data trước khi đưa vào sprint.

## Trạng thái thực tế
Đã có baseline thiết kế và prototype web/mobile; đã kiểm render và một số tương tác cục bộ. Chưa có backend production, app ký phát hành, database migration đã chạy, tenant security test trên server, provider sandbox hoặc business UAT. Các API CRUD tham chiếu chưa đồng nghĩa command contract hoàn chỉnh. Không dùng số màn hình hoặc kết quả prototype để kết luận sẵn sàng go-live.

## Nhân sự và giả định lập kế hoạch
Giả định một đội gồm Product Owner/BA1, Tech Lead1, backend3, web2, mobile2, QA2, data1, DevOps/Security1 (một số vai trò có thể chia sẻ nhưng năng lực giảm tương ứng). Sprint 2 tuần, lấy60–70% thời gian danh nghĩa cho feature sau meeting/support/review; theo dõi velocity thực sau2 sprint. Không ước lượng chính xác ngày công từ catalogue. Chi phí = ngày công được duyệt × đơn giá từng vai trò + hạ tầng + provider + kiểm thử chuyên sâu + dự phòng được tài trợ riêng.

## G0 — Khóa nền tảng, dự kiến tuần 1–2
BA/PO chốt D03 và pilot charter; Tech Lead chốt D01/D02; Data Owner nhận mẫu nguồn và lập mapping; QA chọn golden fixtures. Dựng CI/CD, repository conventions, environments và threat model. Gate: glossary tài chính, phân quyền, data ownership, stack và backlog sprint1 được ký. Nếu chưa có sandbox Kho bạc vẫn triển khai adapter interface và mock; không cam kết lịch kết nối thật.

## G1 — Foundation, dự kiến tuần 3–6
IAM/MDM/ADM, tenant context, RLS, audit/outbox, object storage, secrets, license entitlement tối thiểu, design tokens và shell không refresh menu. Theme SAS-04 với System Admin-only, draft/review/publish/rollback nằm foundation; billing thương mại để giai đoạn sau. Gate: integration tests tenant isolation trên API/DB/search/file/cache; migration chạy mới và upgrade; role matrix phủ mọi command; basic observability và restore thử.

## G2 — Nghiệp vụ pilot, dự kiến tuần 7–12
PRJ/CAP/DIS/ISS/HOME, notification in-app/email/push tối thiểu; master và reporting calendar; import staging và đối soát. Mobile ưu tiên login, việc của tôi, nháp hiện trường, upload, notification; online approval chỉ khi quyền/audit đã hoàn tất. Gate: số liệu golden khớp, maker-checker, lock kỳ, cạnh tranh phân bổ, offline conflict và hai kỳ báo cáo song song. Nếu kỳ báo cáo không nằm trong cửa sổ12 tuần, kéo dài pilot tới đủ bằng chứng.

## G3 — Kiểm soát và analytics, dự kiến tuần 13–18
CTR/PAY, nghiệm thu/đối soát/quyết toán; BI builder, semantic layer, drill/export; DGV lineage/quality; hoàn thiện mobile tương ứng. Tích hợp Kho bạc/ký số chỉ sau D05. Gate: end-to-end hợp đồng→nghiệm thu→thanh toán→đối soát; không double count; dashboard tổng/chi tiết cùng snapshot; báo cáo lỗi dữ liệu có owner.

## G4 — AI và thương mại hóa, dự kiến tuần 19–24
LLM gateway/FinOps trước BID AI; omnichannel sau Notification Center; SaaS subscription/billing/license nâng cao. Tài khoản kênh, provider AI và chính sách thương mại cần D06–D08. Gate: AI eval + evidence + human decision; cost reservation/reconcile; webhook/dedupe; license boundary; invoice reconciliation và theme isolation.

## G5 — Hardening và rollout, dự kiến tuần 25–28
QA/Security thực hiện pentest, load, accessibility, DR, upgrade mobile và rollback. PO ký UAT; Ops diễn tập runbook; cohort pilot→5 tenant→mở rộng theo SLO. 28 tuần chỉ là kịch bản planning cho đội giả định, phải re-estimate sau G0. Phạm vi327 màn hình có thể cần thêm sprint; không ép chất lượng để giữ mốc giả định.

## Đường phụ thuộc và cách chia backlog
IAM/tenant boundary → MDM → dự án/kế hoạch → báo cáo → semantic metrics/drill. CTR→PAY; DGV+LLM→BID AI; NOT→OMNI; entitlement nền tảng trước mọi module có license. Mobile đi song song khi API ổn định. UI, command/API và migration là các subtasks của cùng vertical slice; tránh hoàn thành tất cả UI rồi mới xử lý quyền/dữ liệu.

## Definition of Ready
Có owner nghiệp vụ; rule và trạng thái thống nhất; API request/response/error và idempotency; field type/nullability/format; tenant/scope/action policy; migration/index plan; positive/negative fixtures; UI states và dependency đã giải quyết hoặc mock có hợp đồng. Các dòng backlog đang SPEC_REVIEW_REQUIRED cho tới khi đội thực hiện xác nhận các mục này.

## Definition of Done và go-live
Code review; migration mới/upgrade pass; unit/domain và integration tests; authorization negative tests; audit/outbox và telemetry; UI responsive/accessibility; UAT evidence; hướng dẫn vận hành; không P0/P1 mở. Critical financial/isolation/restore case phải100% pass. Test còn NOT_RUN không được tính là pass. Người ký: PO cho nghiệp vụ, Data Owner cho đối soát, Security cho quyền, Ops cho DR/SLO, Tech Lead cho compatibility.

## Kiểm soát thay đổi và báo cáo tiến độ
Mỗi thay đổi có CR ID, yêu cầu nguồn, tác động FR/screen/API/table/test/cost/schedule và người duyệt. Không sửa ngầm baseline. Báo cáo mỗi sprint theo accepted business slices, blocked decisions, defects, evidence và dự báo; không đo phần trăm hoàn tất chỉ bằng số màn hình đã vẽ. Decision_Register chứa owner/gate/bằng chứng; các owner cần được gán tên khi kickoff.

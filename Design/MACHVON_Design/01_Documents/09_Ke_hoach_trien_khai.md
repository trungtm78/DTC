# Kế hoạch triển khai và kiểm soát phạm vi

Baseline 1.4 | 22/10/2026 | Kế hoạch đề xuất để refinement và phê duyệt, không phải cam kết tiến độ. Nội dung baseline 1.3 được giữ nguyên; phần bổ sung 1.4 được đánh dấu "Cập nhật 1.4" kèm mã CR.

## Cách sử dụng bộ bàn giao

Đọc BRD để chốt phạm vi; FRD để chốt nghiệp vụ; thiết kế cơ bản để chốt kiến trúc; thiết kế chi tiết và Module_Implementation_Contracts.html để chia công việc; screen_catalog và prototype để review UI. implementation_backlog.json gồm đủ 478 màn hình (Cập nhật 1.4 — CR-PLAN-10: 406 web + 72 mobile; baseline 1.3 có 327 màn hình, vẫn giữ nguyên ID), giữ nguyên ID; test_cases.json liên kết yêu cầu và checklist. Mỗi hạng mục phải chốt operationId, schema, rule và test data trước khi đưa vào sprint.

**Cập nhật 1.4 — CR-PLAN-01.** Đọc `04_Thiet_ke_co_ban.md` để chốt kiến trúc và quyết định đã khóa; `05_modules/<MÃ>.md` cho đặc tả từng phân hệ (luồng, state machine, quy tắc, dữ liệu, API, test, tiêu chí nghiệm thu); `03_Engineering/implementation_backlog.json` cho hạng mục, phụ thuộc và mức tối thiểu của từng release; `test_cases.json` và `traceability.json` cho truy vết; `Decision_Register.html` cho quyết định và sổ xác nhận pháp lý. Mỗi slice phải chốt operationId, schema, quy tắc và dữ liệu test trước khi vào lịch làm việc (Definition of Ready, mục 9).

## Trạng thái thực tế

Đã có baseline thiết kế và prototype web/mobile; đã kiểm render và một số tương tác cục bộ. Chưa có backend production, app ký phát hành, database migration đã chạy, tenant security test trên server, provider sandbox hoặc business UAT. Các API CRUD tham chiếu chưa đồng nghĩa command contract hoàn chỉnh. Không dùng số màn hình hoặc kết quả prototype để kết luận sẵn sàng go-live.

**Cập nhật 1.4 — CR-PLAN-01.** Có baseline thiết kế, prototype web/mobile và bộ công cụ kiểm nhất quán chạy được (`work/tools`, `ci/`). Chưa có backend, ứng dụng ký phát hành, migration đã chạy, kiểm thử cách ly tenant trên server, sandbox nhà cung cấp hay UAT nghiệp vụ. Số màn hình, số endpoint hay số test case không được dùng làm bằng chứng sẵn sàng go-live hay làm căn cứ suy ra ngày công.

## Nhân sự và giả định lập kế hoạch

Giả định một đội gồm Product Owner/BA1, Tech Lead1, backend3, web2, mobile2, QA2, data1, DevOps/Security1 (một số vai trò có thể chia sẻ nhưng năng lực giảm tương ứng). Sprint 2 tuần, lấy60–70% thời gian danh nghĩa cho feature sau meeting/support/review; theo dõi velocity thực sau2 sprint. Không ước lượng chính xác ngày công từ catalogue. Chi phí = ngày công được duyệt × đơn giá từng vai trò + hạ tầng + provider + kiểm thử chuyên sâu + dự phòng được tài trợ riêng.

**Cập nhật 1.4 — CR-PLAN-02 (quyết định D-B02).** Quyết định D-B02: AI agent viết phần lớn mã theo `AUTONOMOUS_EXECUTION_PROTOCOL.md`; 1–3 người đảm nhiệm PO/BA, review nghiệp vụ và UAT; Codex review mã. Nút cổ chai thật là **giờ review của người**, không phải tốc độ viết mã. Vì vậy:
- Mỗi slice khai báo hạng mục **bắt buộc người duyệt**: đường tiền và công thức, phân quyền và cách ly tenant, migration, mẫu văn bản pháp lý, quyết định AI. Phần còn lại do cổng tự động chặn (test, coverage 90%, quét protocol, Codex).
- Giờ review ước tính mỗi slice nằm trong `03_Engineering/implementation_plan.json` (`stories[].review.hours`, gồm `min`/`max`; danh sách hạng mục bắt buộc người duyệt ở `stories[].review.required`); mỗi dòng backlog mang `release` và `stories` để tra ngược tới slice. **Không quá 2 slice cùng chờ người duyệt** (giới hạn WIP); slice thứ ba chỉ bắt đầu khi một slice được duyệt hoặc trả lại.
- Tối đa 5 agent chạy song song (giới hạn ràng buộc của người dùng), mỗi agent một nhóm phân hệ rời nhau; hợp nhất qua công cụ gộp fragment, không sửa chung tệp danh mục.
- Lịch được lập theo giờ review đã cam kết của người duyệt mỗi tuần; calendar duration = tổng giờ review ÷ giờ review khả dụng, cộng thời gian chờ quyết định bên ngoài. **Effort** (giờ agent, giờ người) và **calendar** luôn được báo riêng.

## Lộ trình baseline 1.3 (G0–G5)

Sáu giai đoạn dưới đây là nội dung baseline 1.3, giữ nguyên làm khung đối chiếu; lịch tuần chỉ là kịch bản lập kế hoạch cho đội giả định, không phải cam kết.

### G0 — Khóa nền tảng, dự kiến tuần 1–2

BA/PO chốt D03 và pilot charter; Tech Lead chốt D01/D02; Data Owner nhận mẫu nguồn và lập mapping; QA chọn golden fixtures. Dựng CI/CD, repository conventions, environments và threat model. Gate: glossary tài chính, phân quyền, data ownership, stack và backlog sprint1 được ký. Nếu chưa có sandbox Kho bạc vẫn triển khai adapter interface và mock; không cam kết lịch kết nối thật.

### G1 — Foundation, dự kiến tuần 3–6

IAM/MDM/ADM, tenant context, RLS, audit/outbox, object storage, secrets, license entitlement tối thiểu, design tokens và shell không refresh menu. Theme SAS-04 với System Admin-only, draft/review/publish/rollback nằm foundation; billing thương mại để giai đoạn sau. Gate: integration tests tenant isolation trên API/DB/search/file/cache; migration chạy mới và upgrade; role matrix phủ mọi command; basic observability và restore thử.

### G2 — Nghiệp vụ pilot, dự kiến tuần 7–12

PRJ/CAP/DIS/ISS/HOME, notification in-app/email/push tối thiểu; master và reporting calendar; import staging và đối soát. Mobile ưu tiên login, việc của tôi, nháp hiện trường, upload, notification; online approval chỉ khi quyền/audit đã hoàn tất. Gate: số liệu golden khớp, maker-checker, lock kỳ, cạnh tranh phân bổ, offline conflict và hai kỳ báo cáo song song. Nếu kỳ báo cáo không nằm trong cửa sổ12 tuần, kéo dài pilot tới đủ bằng chứng.

### G3 — Kiểm soát và analytics, dự kiến tuần 13–18

CTR/PAY, nghiệm thu/đối soát/quyết toán; BI builder, semantic layer, drill/export; DGV lineage/quality; hoàn thiện mobile tương ứng. Tích hợp Kho bạc/ký số chỉ sau D05. Gate: end-to-end hợp đồng→nghiệm thu→thanh toán→đối soát; không double count; dashboard tổng/chi tiết cùng snapshot; báo cáo lỗi dữ liệu có owner.

### G4 — AI và thương mại hóa, dự kiến tuần 19–24

LLM gateway/FinOps trước BID AI; omnichannel sau Notification Center; SaaS subscription/billing/license nâng cao. Tài khoản kênh, provider AI và chính sách thương mại cần D06–D08. Gate: AI eval + evidence + human decision; cost reservation/reconcile; webhook/dedupe; license boundary; invoice reconciliation và theme isolation.

### G5 — Hardening và rollout, dự kiến tuần 25–28

QA/Security thực hiện pentest, load, accessibility, DR, upgrade mobile và rollback. PO ký UAT; Ops diễn tập runbook; cohort pilot→5 tenant→mở rộng theo SLO. 28 tuần chỉ là kịch bản planning cho đội giả định, phải re-estimate sau G0. Phạm vi 478 màn hình (Cập nhật 1.4 — CR-PLAN-10; baseline 1.3 là 327 màn hình) có thể cần thêm sprint; không ép chất lượng để giữ mốc giả định.

## Ánh xạ lộ trình baseline G0–G5 sang release 1.4 (R0–R4)

**Cập nhật 1.4 — CR-PLAN-03.** Thứ tự thực hiện được phép khác G0–G5 nhưng nội dung từng giai đoạn không bị giảm:

| Giai đoạn baseline 1.3 | Release 1.4 | Ghi chú |
|---|---|---|
| G0 Khóa nền tảng | R0 (phần quyết định và spike) | Quyết định D01/D02 được ghi nhận bằng D-B07, D-B12, D-B03; D03/D04 vẫn chờ chủ nghiệp vụ |
| G1 Foundation | R0 | Tenant, RLS, IAM, audit/outbox, entitlement tối thiểu, theme, shell |
| G2 Nghiệp vụ pilot | R1 | Phủ rộng mức tối thiểu dùng thật cho 25 phân hệ (D-B01) |
| G3 Kiểm soát và analytics | R2 | CTR/PAY, BI, DGV, GPMB, văn bản và báo cáo nhà nước |
| G4 AI và thương mại hóa | R3 | LLM/BID, OMNI, SaaS nâng cao khi D05–D08 có hợp đồng |
| G5 Hardening và rollout | R4 | Pentest, tải, trợ năng, DR, UAT 100%, pilot rồi mở rộng |

Phase của từng dòng backlog (P0/P1) ánh xạ vào release qua trường `release` của `implementation_backlog.json`: P0 vào R0–R1, P1 vào R2–R3, là `[GIẢ ĐỊNH]` được kiểm lại theo từng dòng khi tinh chỉnh backlog.

**Cập nhật 1.4 — CR-PLAN-08.** Giả định trên đã được đo và **không đúng**: phase của màn hình không quyết định release. Ánh xạ thực tế dưới đây tính từ `screen_catalog.json` (trường `phase`) và `implementation_plan.json` (`stories[].screens`, `stories[].release`; màn hình thuộc nhiều slice lấy release sớm nhất, trùng với trường `release` của `implementation_backlog.json`; 10 màn hình thuộc slice của nhiều release). Tổng 478 màn hình (406 web + 72 mobile).

| Phase | R0 | R1 | R2 | R3 | Tổng |
|---|---|---|---|---|---|
| P0 | 27 | 192 | 24 | 0 | 243 |
| P1 | 0 | 130 | 93 | 4 | 227 |
| P2 | 0 | 1 | 6 | 1 | 8 |
| **Tổng** | 27 | 323 | 123 | 5 | 478 |

Như vậy 130 màn hình P1 thuộc R1 (R1 là mức tối thiểu dùng thật cho cả 25 phân hệ) và 24 màn hình P0 chỉ vào R2; phase là mức ưu tiên nghiệp vụ, còn release do slice quyết định. Bảng được sinh lại từ hai tệp JSON khi backlog hoặc kế hoạch đổi, không sửa tay.

Thứ tự thực hiện được phép khác mốc G0–G5 cũ; nội dung từng release không bị giảm.

| Release | Mục tiêu | Cổng vào | Cổng ra (đo được) |
|---|---|---|---|
| **R0 — Nền tảng** | Tenant, RLS, IAM (cây đơn vị, guest nhà thầu), audit/outbox/idempotency, entitlement tối thiểu, theme SAS-04, shell web, công cụ sinh client, bộ DOC engine (soạn, số, ký, đóng dấu), spike rủi ro (mục 6) | Quyết định D01/D02 đã ghi nhận (D-B07, D-B12, D-B03); môi trường dev + CI chạy; PROGRESS/protocol sẵn sàng | Test cách ly tenant API/DB/cache/search/file/export/sync = 100% pass; migration mới và nâng cấp chạy; ma trận quyền phủ mọi command; restore thử thành công; spike có kết luận bằng văn bản |
| **R1 — Phủ rộng mức tối thiểu dùng thật** | Mỗi phân hệ (25) có luồng chính end-to-end, quyền, audit và màn hình lõi; luồng tài chính đúng số liệu với fixture | R0 đạt; mức tối thiểu của từng phân hệ trong mục 12 của đặc tả đã được PO duyệt; fixture golden CHỜ KÝ được soạn (D03) | Golden số liệu khớp (hoặc ghi rõ phần CHỜ KÝ chưa tính); maker-checker; khóa kỳ; cạnh tranh phân bổ; xung đột offline; **một kỳ báo cáo chạy thử với fixture golden (Cập nhật 1.4 — CR-PLAN-03: hai kỳ báo cáo song song với hệ thống cũ thực hiện ở pilot R4, story ST-DIS-024 và ST-KERNEL-103)**; không P0/P1 mở |
| **R2 — Sâu hóa** | Hoàn thiện nghiệp vụ tài chính (hợp đồng→nghiệm thu→thanh toán→đối soát→quyết toán), GPMB, văn bản/báo cáo nhà nước, BI drill, DGV, thông báo đa kênh nội bộ | R1 đạt; sổ xác nhận pháp lý của các quy tắc dùng trong release đã xác nhận (R4) | Chu trình hợp đồng→quyết toán không đếm trùng; dashboard tổng/chi tiết cùng snapshot; báo cáo lỗi dữ liệu có owner; mẫu biểu nhà nước được owner xác nhận |
| **R3 — Tích hợp ngoài và AI** | Kho bạc/ký số/kênh ngoài/AI production khi hợp đồng bên thứ ba có | D05–D07 có hợp đồng, sandbox và thông tin xác thực qua vault | Adapter qua contract test với sandbox; AI có đánh giá, bằng chứng, người quyết định, ngân sách và định tuyến theo phân loại dữ liệu |
| **R4 — Hardening và rollout** | Pentest, tải, trợ năng, DR, nâng cấp mobile, rollback; UAT ký; pilot rồi mở rộng | R3 đạt hoặc ghi rõ phần chưa tích hợp | `UAT-COVERAGE.md` 100% PASS; case critical (tiền, cách ly, restore) 100% pass; Ops diễn tập runbook; SLO và RPO/RTO được chốt (D10) |

Không có release nào được ép chất lượng để giữ mốc. Nếu R1 cho thấy một phân hệ chưa đủ bằng chứng nghiệp vụ, phân hệ đó ở trạng thái SPEC_REVIEW_REQUIRED và không vào pilot.

## Đường phụ thuộc và cách chia backlog

IAM/tenant boundary → MDM → dự án/kế hoạch → báo cáo → semantic metrics/drill. CTR→PAY; DGV+LLM→BID AI; NOT→OMNI; entitlement nền tảng trước mọi module có license. Mobile đi song song khi API ổn định. UI, command/API và migration là các subtasks của cùng vertical slice; tránh hoàn thành tất cả UI rồi mới xử lý quyền/dữ liệu.

**Cập nhật 1.4 — CR-PLAN-04.** Mỗi slice gồm UI, command/API, migration, test và tài liệu vận hành của cùng một năng lực, có thể demo và nghiệm thu độc lập; không hoàn thành toàn bộ UI rồi mới xử lý quyền và dữ liệu.

```
IAM/tenant ─► MDM ─► PRJ ─► CAP ─► DIS ─► MNE ─► HOME/BI
   │            │                      └────► DOC (mẫu báo cáo/quyết định)
   │            └─► CTR ─► QMS ─► PAY ─► settlement ─► AST
   ├─► NOT ─► OMNI          PMT / LND ─► (mốc dự án CTR)
   ├─► LLM ─► BID           AUD ◄─ PAY (thu hồi)
   └─► SAS (entitlement) ─► mọi phân hệ có license
Mobile (Flutter) chạy song song khi API của luồng tương ứng ổn định.
```
**Đường găng** (theo thứ tự): quyết định hạ tầng và spike → R0 tenant/RLS/IAM → MDM → PRJ → CAP → DIS → xác nhận pháp lý các công thức → R2 chu trình tài chính → hardening. Việc làm song song được: DOC, NOT/OMNI, LLM/BID, SAS, mobile shell, công cụ và CI.

## Sản phẩm baseline làm nền tảng triển khai

**Cập nhật 1.4 — CR-PLAN-05.** Bộ thiết kế baseline là nền tảng, không dựng lại từ đầu. Mỗi sản phẩm dưới đây là đầu vào bắt buộc của kế hoạch triển khai và được cổng bảo toàn baseline (`work/tools`, tag `baseline-v1.3`) bảo vệ khỏi mất mát.

| Sản phẩm baseline | Vai trò nền tảng | Công việc triển khai | Release |
|---|---|---|---|
| `schema_reference.sql` (79 bảng, RLS) | Nguồn của migration đầu tiên | Sinh migration V1 trực tiếp từ SQL baseline; bảng mới là migration tăng thêm; kiểm cách ly tenant trên mọi bảng | R0 |
| `data_dictionary.json`, `ERD.mmd` | Mô hình thực thể | Sinh mô hình miền; kiểm khớp từ điển với SQL bằng bộ kiểm nhất quán | R0 |
| `openapi.json` (180 operation) | Hợp đồng API contract-first | Sinh DTO máy chủ và client Dart/TypeScript; 38 command trước; GET scaffold xử lý theo `x-exposure` | R0–R1 |
| `02_Prototype`, `design_tokens.json`, `Design_Board.html`, `04_Design_Assets` | Giao diện ràng buộc (D-B11) | Dựng component web và Flutter ThemeData từ prototype và token; ảnh PNG là baseline thị giác cho kiểm thử hồi quy | R0–R1 |
| `screen_catalog.json`, `Screen_Specifications.html`, `implementation_backlog.json` | Danh mục màn hình và backlog | Mỗi dòng là một hạng mục; ID giữ nguyên; mức tối thiểu R1 ghi trong đặc tả phân hệ | R1 |
| `test_cases.json`, `test_fixtures.json`, `mapping_source_template.json` | Hạt giống bộ kiểm thử | Seed bộ test và oracle; fixture là dữ liệu chuẩn của R1; mapping chờ D04 | R1 |
| `Tenant_Theme_Specification.html`, SAS-04 | Đặc tả theme theo tenant | Triển khai ở R0 theo đúng hợp đồng 403/409/422 | R0 |
| `Module_Implementation_Contracts.html`, `Command_Contracts_and_QA.html` | Hợp đồng command theo phân hệ | Căn cứ chia công việc và kiểm tra command | R0–R2 |
| `traceability.json` | Ma trận truy vết | Kiểm tự động không tham chiếu treo, không test mồ côi | mọi release |
| BRD, FRD, tài liệu 04–08 | Yêu cầu và thiết kế nguồn | Đối chiếu ở mỗi mốc bằng `/plan-eng-review` | mọi release |

## Spike

Mỗi spike có câu hỏi, tiêu chí và kết luận bằng văn bản trước khi vào R0 exit.
1. **Chữ ký số:** ký PAdES lãnh đạo → cấp số bằng incremental update → ký số cơ quan; xác minh cả hai trên CA sandbox thật (R8). Nếu chưa có sandbox, đường tải lên văn bản đã ký bên ngoài là đường chính của R1.
2. **PowerSync trên Postgres tại cloud VN:** nhà cung cấp có cho `wal_level=logical`; nếu không, Postgres tự quản trên VM. Kèm kiểm sync rules cách ly tenant/scope và thu hồi quyền.
3. **Mô hình AI trong nước hoặc tự host:** chất lượng tiếng Việt và chi phí cho phân tích hồ sơ thầu; bộ đánh giá chạy trên cả hai tuyến (R5).
4. **Temporal tự host:** vận hành, nâng version workflow, khôi phục sau lỗi.
5. **Flutter:** đăng nhập OIDC + PKCE, offline queue lệnh, tải ảnh có checksum và tiếp tục khi mất mạng, theme sinh từ `design_tokens.json`.
6. **Cloud VN:** RPO/RTO thực tế của sao lưu/PITR và object storage S3-compatible.

## Hạ tầng theo slice đầu tiên cần nó

Quyết định R1 (người dùng chốt): giữ đủ thành phần của D-B07, nhưng mỗi thành phần chỉ được dựng khi slice đầu tiên cần nó, với điều kiện vào bắt buộc: **runbook, backup/restore đã thử, cảnh báo giám sát**. Postgres, Redis, Keycloak vào ở R0; Temporal ở slice provisioning hoặc phê duyệt đầu tiên; LiteLLM + Langfuse khi LLM/BID bắt đầu; PowerSync khi mobile offline bắt đầu. Không dịch vụ nào chạy mà chưa có quy trình khôi phục.

## Môi trường, CI/CD, quan sát và bảo mật

- **Môi trường:** dev (dữ liệu synthetic, nhà cung cấp giả có contract), test (instance biệt lập cho integration), staging (gần production, dữ liệu masked, sandbox thật), production. Dữ liệu thật chỉ ở production.
- **CI/CD:** cổng protocol chạy cả trên GitHub Actions và trước mỗi lần push (`ci/`): quét lối tắt bị cấm, mã tiếng Anh, secret, hợp đồng `PROGRESS.md`, thông điệp commit, test với sàn coverage 90%, báo cáo nhất quán thiết kế, Codex review cục bộ. Job triển khai chỉ thêm khi có sản phẩm và luôn phụ thuộc các cổng.
- **Quan sát:** OpenTelemetry có `tenant_id`, không PII; SLO theo quy tắc ngân sách lỗi trong thiết kế cơ bản; cảnh báo hàng đợi, DLQ, ngân sách AI, license invalidation, sự cố chất lượng dữ liệu.
- **Bảo mật:** threat model trước R0; kiểm cách ly trên mọi kênh (API, DB, cache, tìm kiếm, vector, file, export, sync); quản lý secret qua vault; kiểm toán phụ thuộc (`npm audit`, tương đương cho Dart); pentest ở R4; hồ sơ cấp độ an toàn thông tin [CXN].

## Definition of Ready

Có owner nghiệp vụ; rule và trạng thái thống nhất; API request/response/error và idempotency; field type/nullability/format; tenant/scope/action policy; migration/index plan; positive/negative fixtures; UI states và dependency đã giải quyết hoặc mock có hợp đồng. Các dòng backlog đang SPEC_REVIEW_REQUIRED cho tới khi đội thực hiện xác nhận các mục này.

## Definition of Done và go-live

Code review; migration mới/upgrade pass; unit/domain và integration tests; authorization negative tests; audit/outbox và telemetry; UI responsive/accessibility; UAT evidence; hướng dẫn vận hành; không P0/P1 mở. Critical financial/isolation/restore case phải100% pass. Test còn NOT_RUN không được tính là pass. Người ký: PO cho nghiệp vụ, Data Owner cho đối soát, Security cho quyền, Ops cho DR/SLO, Tech Lead cho compatibility.

**Cập nhật 1.4 — CR-PLAN-06.** **Ready:** có owner nghiệp vụ; quy tắc và trạng thái thống nhất; API request/response/lỗi và idempotency; kiểu/null/định dạng trường; chính sách tenant/scope/hành động; kế hoạch migration và index; fixture dương/âm; trạng thái UI và phụ thuộc đã giải quyết hoặc có mock theo contract; các mục [CXN] mà slice dùng đã được xác nhận hoặc slice đánh dấu CHỜ KÝ.
**Done (cả 6 điều kiện của protocol §3):** đúng mọi tiêu chí nghiệm thu; patch coverage ≥ 90% line; toàn bộ test suite pass không regression; lint/type-check/build sạch không warning mới; không TODO, mã chết hay workaround; `PROGRESS.md` cập nhật. Cộng: review mã (`/review` rồi Codex), migration mới và nâng cấp pass, test quyền âm, audit/outbox/telemetry, UI responsive và trợ năng, bằng chứng UAT, hướng dẫn vận hành, không P0/P1 mở. Test còn NOT_RUN không được tính là đạt.

**Cập nhật 1.4 — CR-PLAN-09.** **Cổng thực thi được (WIP và review chéo).** (a) *WIP:* mỗi slice đang chờ người duyệt có trạng thái `AWAITING_HUMAN_REVIEW` trong `PROGRESS.md`. Khi đã có 2 slice ở trạng thái này, **không slice nào khác được chuyển sang `IN_PROGRESS`** cho tới khi một slice được duyệt (`DONE`) hoặc trả lại (`RETURNED`). Quy tắc này hiện do agent kiểm khi nhận slice và do người duyệt kiểm khi ký; **chưa có stage tự động** trong `ci/`, nên thêm stage `wip` vào `ci/src` (đếm slice `AWAITING_HUMAN_REVIEW` trong `PROGRESS.md`, thất bại khi > 2) là việc công cụ bắt buộc trước khi chạy slice thực. (b) *Codex review mọi slice:* slice chỉ được `DONE` khi có kết quả `codex-review` với dòng `Recommendation:` và không có phát hiện Critical hoặc High. Theo `ci/README.md`, stage `codex-review` chạy bằng `node ci/src/verify-cli.mjs --codex` (cục bộ); `--ship` làm Codex bắt buộc (Codex không sẵn sàng thì lần chạy thất bại, không được bỏ qua) và hook `.githooks/pre-push` chạy các cổng trước khi đẩy. GitHub Actions (`.github/workflows/ci.yml`, `release.yml`) chạy lại các cổng tự động còn lại nhưng **không** chạy Codex, vì vậy bằng chứng Codex của slice là điều kiện của lệnh `--ship` cục bộ trước khi mở PR. Một lần chạy Codex ở trạng thái `SKIPPED` không được tính là đã review.

## Ước lượng, rủi ro và dự phòng

- Ước lượng theo **khoảng** cho từng loại slice (CRUD có phê duyệt, luồng tài chính, tích hợp file, màn hình báo cáo/BI, mobile offline), tách giờ agent, giờ review người và thời gian chờ bên ngoài. Giá trị ban đầu là `[GIẢ ĐỊNH]` và được thay bằng số đo thật sau 2 slice R0.
- Độ tin cậy được ghi cùng ước lượng; slice phụ thuộc quyết định hoặc bên thứ ba mở có độ tin cậy thấp và nằm ngoài đường găng.
- Dự phòng rủi ro được tài trợ riêng, không lấy từ thời gian kiểm thử.
- Sổ rủi ro: mỗi rủi ro có xác suất, tác động, owner, tín hiệu cảnh báo và hành động; xem mục 13.

**Cập nhật 1.4 — CR-PLAN-04: kế hoạch chi tiết theo story.** Kế hoạch epic → feature → story → task kỹ thuật → task QA nằm ở `03_Engineering/implementation_plan.json` (26 epic, 138 feature, 400 story, 2142 task) và được trình bày ở `03_Engineering/Implementation_Plan.html` (đường găng, giờ review, lịch theo 1–3 người duyệt). Mỗi dòng backlog baseline có `release` và danh sách `stories`. Công cụ kiểm tra bắt buộc phủ mọi màn hình, operation, bảng và NFR, tiêu chí nghiệm thu gắn test có thật, mỗi story có task QA, phụ thuộc không vòng và không trỏ tới release sau.

| Release | Số story | Giờ review của người (min–max) | Giờ agent (min–max) |
|---|---|---|---|
| R0 | 54 | 125–247 | 1206–2508 |
| R1 | 205 | 335.5–618 | 4236–8710 |
| R2 | 99 | 117.5–234.5 | 1830–3798 |
| R3 | 22 | 36–73 | 512–1134 |
| R4 | 20 | 87–176 | 408–1046 |

Đây là khoảng ước lượng `[GIẢ ĐỊNH]` (độ tin cậy ghi theo từng story), không phải ngày lịch; lịch thật được tính bằng giờ review chia cho năng lực người duyệt.


## Chuyển đổi dữ liệu, cutover, DR, pilot và rollout

Quy trình migration, dual-run, cutover, rollback và DR nằm ở `10_Ke_hoach_kiem_thu_va_chuyen_doi.md`; mọi bước cần dữ liệu nguồn chờ D04. **Pilot:** một tenant, một nhóm dự án, hai kỳ báo cáo song song với hệ thống hiện hữu (D09). **Rollout:** pilot → 5 tenant → mở rộng theo cohort và SLO; mỗi bước có tiêu chí vào/ra và đường rollback bằng routing, không restore DB làm mất giao dịch mới.

## Vận hành, hỗ trợ, đào tạo và bàn giao

- **Vận hành:** lịch trực, escalation, runbook từng thành phần hạ tầng, diễn tập DR; thông báo vận hành qua kênh độc lập khi Notification Center lỗi.
- **Hỗ trợ:** phân loại sự cố P0–P3 theo tài liệu 10; thời gian phản hồi chốt ở D10.
- **Đào tạo:** theo vai trò (lãnh đạo, cán bộ báo cáo, kế toán, quản trị tenant, quản trị nền tảng); tài liệu và môi trường đào tạo dữ liệu synthetic; **hypercare** sau mỗi cohort.
- **Bàn giao:** mã nguồn, đặc tả, runbook, sổ xác nhận pháp lý, kết quả UAT và danh sách nợ kỹ thuật.

## Blocker, phụ thuộc bên thứ ba và quyết định mở

| ID | Owner (vai trò) | Cần để | Điều kiện giải quyết |
|---|---|---|---|
| D03 | Chủ nghiệp vụ vốn | Công thức kỳ/YTD/project-to-date, mẫu số tỷ lệ giải ngân, fixture golden | Glossary và bộ số liệu golden được ký |
| D04 | Data Owner | Mapping nguồn, mã đơn vị lịch sử, retention, migration | Mẫu dữ liệu được phép dùng và mapping được đối soát |
| D05 | Integration Lead | Kho bạc, ký số, hệ thống thông tin quốc gia | Hợp đồng, sandbox, xác thực, callback; chưa có thì dùng file import/export |
| D06 | Integration/Business | Zalo/WhatsApp/email/push | Tài khoản được duyệt, template, consent, giá, quota; sandbox pass |
| D07 | AI Lead/Security | AI production | Nhà cung cấp/mô hình/vùng dữ liệu, bộ đánh giá được chuyên gia ký, trần chi phí |
| D08 | Product/Commercial | Gói, seat, proration, hóa đơn | Entitlement matrix và điều khoản hợp đồng |
| D09 | Product/QA | Pilot | Tenant pilot, nhóm dự án, thiết bị, dữ liệu thử, capacity profile |
| D10 | Operations/Owner | Go-live | SLO, RPO/RTO, lịch hỗ trợ, DR drill, runbook có người trực |
| CXN-* | Pháp chế / chủ nghiệp vụ | Công thức và mẫu biểu có căn cứ pháp lý | Bản gốc văn bản (Công báo hoặc cơ sở dữ liệu pháp luật quốc gia) được đối chiếu và ký; slice dùng quy tắc chưa xác nhận không được DONE |

D01/D02 được ghi nhận bằng D-B07, D-B12 và D-B03 trong bản thiết kế cơ bản; Tech Lead/Security có thể đổi qua CR.

## Kiểm soát thay đổi và báo cáo tiến độ

Mỗi thay đổi có CR ID, yêu cầu nguồn, tác động FR/screen/API/table/test/cost/schedule và người duyệt. Không sửa ngầm baseline. Báo cáo mỗi sprint theo accepted business slices, blocked decisions, defects, evidence và dự báo; không đo phần trăm hoàn tất chỉ bằng số màn hình đã vẽ. Decision_Register chứa owner/gate/bằng chứng; các owner cần được gán tên khi kickoff.

**Cập nhật 1.4 — CR-PLAN-07.** Mỗi thay đổi có CR ID, yêu cầu nguồn, tác động FR/màn hình/API/bảng/test/chi phí/lịch và người duyệt; không sửa ngầm baseline. Báo cáo tiến độ theo slice nghiệp vụ đã nghiệm thu, giờ review đã dùng so với cam kết, quyết định bị chặn, lỗi, bằng chứng và dự báo; không đo phần trăm hoàn tất bằng số màn hình đã vẽ.

Nguyên tắc **baseline-first**: baseline v1.3 (tag `baseline-v1.3`) là nền tảng. Không bản ghi, ID, cột hay đoạn tài liệu baseline nào được biến mất; mỗi thay đổi có bản ghi trong `baseline_change_register.json` (mã CR, lý do) và được `change_log.json` tổng hợp. Cổng `baseline-cli` chặn thay đổi không có CR.

## Phụ lục: ánh xạ nội dung baseline 1.3

Không đoạn nào của tài liệu 09 baseline bị bỏ: các đoạn còn nguyên văn ở mục tương ứng; G0–G5 được giữ trong "Lộ trình baseline 1.3"; nội dung mới được thêm trong các khối "Cập nhật 1.4".

- "# Kế hoạch triển khai và kiểm soát phạm vi Baseline 1.3 | 22/10/2026 | Kế hoạch đề xuất để refinement" → dòng tiêu đề và nhãn baseline ở đầu tài liệu, được nâng lên Baseline 1.4 (CR-BASE-01); nội dung của dòng đó vẫn còn nguyên trong phần mô tả ngay dưới tiêu đề.
- "implementation_backlog.json gồm đủ 327 màn hình, giữ nguyên ID; test_cases.json liên kết yêu cầu và checklist." và "Phạm vi327 màn hình có thể cần thêm sprint" → vẫn nằm nguyên văn đầu đoạn ở mục "Cách sử dụng bộ bàn giao" và G5; con số 327 là số của baseline 1.3, được bổ sung số hiện hành 478 màn hình (406 web + 72 mobile) kèm CR-PLAN-10.
- "Phase của từng dòng backlog (P0/P1) ánh xạ vào release qua trường `release`" → phần đầu câu giữ nguyên; vế giả định P0 vào R0–R1 và P1 vào R2–R3 (`[GIẢ ĐỊNH]`) được đo lại và thay bằng bảng phase × release thực tế (CR-PLAN-08).

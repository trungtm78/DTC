# Kế hoạch triển khai và kiểm soát phạm vi
Baseline 1.4 | 22/10/2026 | Kế hoạch đề xuất để phê duyệt và tinh chỉnh; không phải cam kết ngày giao. Mọi ước lượng là khoảng và được tính lại sau khi R0 cho số đo thật.

## 1. Cách sử dụng bộ bàn giao
Đọc `04_Thiet_ke_co_ban.md` để chốt kiến trúc và quyết định đã khóa; `05_modules/<MÃ>.md` cho đặc tả từng phân hệ (luồng, state machine, quy tắc, dữ liệu, API, test, tiêu chí nghiệm thu); `03_Engineering/implementation_backlog.json` cho hạng mục, phụ thuộc và mức tối thiểu của từng release; `test_cases.json` và `traceability.json` cho truy vết; `Decision_Register.html` cho quyết định và sổ xác nhận pháp lý. Mỗi slice phải chốt operationId, schema, quy tắc và dữ liệu test trước khi vào lịch làm việc (Definition of Ready, mục 9).

## 2. Trạng thái thực tế
Có baseline thiết kế, prototype web/mobile và bộ công cụ kiểm nhất quán chạy được (`work/tools`, `ci/`). Chưa có backend, ứng dụng ký phát hành, migration đã chạy, kiểm thử cách ly tenant trên server, sandbox nhà cung cấp hay UAT nghiệp vụ. Số màn hình, số endpoint hay số test case không được dùng làm bằng chứng sẵn sàng go-live hay làm căn cứ suy ra ngày công.

## 3. Mô hình thực hiện và năng lực
Quyết định D-B02: AI agent viết phần lớn mã theo `AUTONOMOUS_EXECUTION_PROTOCOL.md`; 1–3 người đảm nhiệm PO/BA, review nghiệp vụ và UAT; Codex review mã. Nút cổ chai thật là **giờ review của người**, không phải tốc độ viết mã. Vì vậy:
- Mỗi slice khai báo hạng mục **bắt buộc người duyệt**: đường tiền và công thức, phân quyền và cách ly tenant, migration, mẫu văn bản pháp lý, quyết định AI. Phần còn lại do cổng tự động chặn (test, coverage 90%, quét protocol, Codex).
- Giờ review ước tính mỗi slice nằm trong backlog (`review_hours`). **Không quá 2 slice cùng chờ người duyệt** (giới hạn WIP); slice thứ ba chỉ bắt đầu khi một slice được duyệt hoặc trả lại.
- Tối đa 3 agent chạy song song, mỗi agent một nhóm phân hệ rời nhau; hợp nhất qua công cụ gộp fragment, không sửa chung tệp danh mục.
- Lịch được lập theo giờ review đã cam kết của người duyệt mỗi tuần; calendar duration = tổng giờ review ÷ giờ review khả dụng, cộng thời gian chờ quyết định bên ngoài. **Effort** (giờ agent, giờ người) và **calendar** luôn được báo riêng.

## 4. Release và cổng vào/ra
Thứ tự thực hiện được phép khác mốc G0–G5 cũ; nội dung từng release không bị giảm.

| Release | Mục tiêu | Cổng vào | Cổng ra (đo được) |
|---|---|---|---|
| **R0 — Nền tảng** | Tenant, RLS, IAM (cây đơn vị, guest nhà thầu), audit/outbox/idempotency, entitlement tối thiểu, theme SAS-04, shell web, công cụ sinh client, bộ DOC engine (soạn, số, ký, đóng dấu), spike rủi ro (mục 6) | Quyết định D01/D02 đã ghi nhận (D-B07, D-B12, D-B03); môi trường dev + CI chạy; PROGRESS/protocol sẵn sàng | Test cách ly tenant API/DB/cache/search/file/export/sync = 100% pass; migration mới và nâng cấp chạy; ma trận quyền phủ mọi command; restore thử thành công; spike có kết luận bằng văn bản |
| **R1 — Phủ rộng mức tối thiểu dùng thật** | Mỗi phân hệ (25) có luồng chính end-to-end, quyền, audit và màn hình lõi; luồng tài chính đúng số liệu với fixture | R0 đạt; mức tối thiểu của từng phân hệ trong mục 12 của đặc tả đã được PO duyệt; fixture golden CHỜ KÝ được soạn (D03) | Golden số liệu khớp (hoặc ghi rõ phần CHỜ KÝ chưa tính); maker-checker; khóa kỳ; cạnh tranh phân bổ; xung đột offline; **hai kỳ báo cáo song song**; không P0/P1 mở |
| **R2 — Sâu hóa** | Hoàn thiện nghiệp vụ tài chính (hợp đồng→nghiệm thu→thanh toán→đối soát→quyết toán), GPMB, văn bản/báo cáo nhà nước, BI drill, DGV, thông báo đa kênh nội bộ | R1 đạt; sổ xác nhận pháp lý của các quy tắc dùng trong release đã xác nhận (R4) | Chu trình hợp đồng→quyết toán không đếm trùng; dashboard tổng/chi tiết cùng snapshot; báo cáo lỗi dữ liệu có owner; mẫu biểu nhà nước được owner xác nhận |
| **R3 — Tích hợp ngoài và AI** | Kho bạc/ký số/kênh ngoài/AI production khi hợp đồng bên thứ ba có | D05–D07 có hợp đồng, sandbox và thông tin xác thực qua vault | Adapter qua contract test với sandbox; AI có đánh giá, bằng chứng, người quyết định, ngân sách và định tuyến theo phân loại dữ liệu |
| **R4 — Hardening và rollout** | Pentest, tải, trợ năng, DR, nâng cấp mobile, rollback; UAT ký; pilot rồi mở rộng | R3 đạt hoặc ghi rõ phần chưa tích hợp | `UAT-COVERAGE.md` 100% PASS; case critical (tiền, cách ly, restore) 100% pass; Ops diễn tập runbook; SLO và RPO/RTO được chốt (D10) |

Không có release nào được ép chất lượng để giữ mốc. Nếu R1 cho thấy một phân hệ chưa đủ bằng chứng nghiệp vụ, phân hệ đó ở trạng thái SPEC_REVIEW_REQUIRED và không vào pilot.

## 5. Vertical slice, phụ thuộc và đường găng
Mỗi slice gồm UI, command/API, migration, test và tài liệu vận hành của cùng một năng lực, có thể demo và nghiệm thu độc lập; không hoàn thành toàn bộ UI rồi mới xử lý quyền và dữ liệu.

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

## 6. Spike (làm trước khi cam kết thiết kế)
Mỗi spike có câu hỏi, tiêu chí và kết luận bằng văn bản trước khi vào R0 exit.
1. **Chữ ký số:** ký PAdES lãnh đạo → cấp số bằng incremental update → ký số cơ quan; xác minh cả hai trên CA sandbox thật (R8). Nếu chưa có sandbox, đường tải lên văn bản đã ký bên ngoài là đường chính của R1.
2. **PowerSync trên Postgres tại cloud VN:** nhà cung cấp có cho `wal_level=logical`; nếu không, Postgres tự quản trên VM. Kèm kiểm sync rules cách ly tenant/scope và thu hồi quyền.
3. **Mô hình AI trong nước hoặc tự host:** chất lượng tiếng Việt và chi phí cho phân tích hồ sơ thầu; bộ đánh giá chạy trên cả hai tuyến (R5).
4. **Temporal tự host:** vận hành, nâng version workflow, khôi phục sau lỗi.
5. **Flutter:** đăng nhập OIDC + PKCE, offline queue lệnh, tải ảnh có checksum và tiếp tục khi mất mạng, theme sinh từ `design_tokens.json`.
6. **Cloud VN:** RPO/RTO thực tế của sao lưu/PITR và object storage S3-compatible.

## 7. Hạ tầng theo slice đầu tiên cần nó
Quyết định R1 (người dùng chốt): giữ đủ thành phần của D-B07, nhưng mỗi thành phần chỉ được dựng khi slice đầu tiên cần nó, với điều kiện vào bắt buộc: **runbook, backup/restore đã thử, cảnh báo giám sát**. Postgres, Redis, Keycloak vào ở R0; Temporal ở slice provisioning hoặc phê duyệt đầu tiên; LiteLLM + Langfuse khi LLM/BID bắt đầu; PowerSync khi mobile offline bắt đầu. Không dịch vụ nào chạy mà chưa có quy trình khôi phục.

## 8. Môi trường, CI/CD, quan sát và bảo mật
- **Môi trường:** dev (dữ liệu synthetic, nhà cung cấp giả có contract), test (instance biệt lập cho integration), staging (gần production, dữ liệu masked, sandbox thật), production. Dữ liệu thật chỉ ở production.
- **CI/CD:** cổng protocol chạy cả trên GitHub Actions và trước mỗi lần push (`ci/`): quét lối tắt bị cấm, mã tiếng Anh, secret, hợp đồng `PROGRESS.md`, thông điệp commit, test với sàn coverage 90%, báo cáo nhất quán thiết kế, Codex review cục bộ. Job triển khai chỉ thêm khi có sản phẩm và luôn phụ thuộc các cổng.
- **Quan sát:** OpenTelemetry có `tenant_id`, không PII; SLO theo quy tắc ngân sách lỗi trong thiết kế cơ bản; cảnh báo hàng đợi, DLQ, ngân sách AI, license invalidation, sự cố chất lượng dữ liệu.
- **Bảo mật:** threat model trước R0; kiểm cách ly trên mọi kênh (API, DB, cache, tìm kiếm, vector, file, export, sync); quản lý secret qua vault; kiểm toán phụ thuộc (`npm audit`, tương đương cho Dart); pentest ở R4; hồ sơ cấp độ an toàn thông tin [CXN].

## 9. Definition of Ready và Definition of Done
**Ready:** có owner nghiệp vụ; quy tắc và trạng thái thống nhất; API request/response/lỗi và idempotency; kiểu/null/định dạng trường; chính sách tenant/scope/hành động; kế hoạch migration và index; fixture dương/âm; trạng thái UI và phụ thuộc đã giải quyết hoặc có mock theo contract; các mục [CXN] mà slice dùng đã được xác nhận hoặc slice đánh dấu CHỜ KÝ.
**Done (cả 6 điều kiện của protocol §3):** đúng mọi tiêu chí nghiệm thu; patch coverage ≥ 90% line; toàn bộ test suite pass không regression; lint/type-check/build sạch không warning mới; không TODO, mã chết hay workaround; `PROGRESS.md` cập nhật. Cộng: review mã (`/review` rồi Codex), migration mới và nâng cấp pass, test quyền âm, audit/outbox/telemetry, UI responsive và trợ năng, bằng chứng UAT, hướng dẫn vận hành, không P0/P1 mở. Test còn NOT_RUN không được tính là đạt.

## 10. Ước lượng, rủi ro và dự phòng
- Ước lượng theo **khoảng** cho từng loại slice (CRUD có phê duyệt, luồng tài chính, tích hợp file, màn hình báo cáo/BI, mobile offline), tách giờ agent, giờ review người và thời gian chờ bên ngoài. Giá trị ban đầu là `[GIẢ ĐỊNH]` và được thay bằng số đo thật sau 2 slice R0.
- Độ tin cậy được ghi cùng ước lượng; slice phụ thuộc quyết định hoặc bên thứ ba mở có độ tin cậy thấp và nằm ngoài đường găng.
- Dự phòng rủi ro được tài trợ riêng, không lấy từ thời gian kiểm thử.
- Sổ rủi ro: mỗi rủi ro có xác suất, tác động, owner, tín hiệu cảnh báo và hành động; xem mục 13.

## 11. Chuyển đổi dữ liệu, cutover, DR, pilot và rollout
Quy trình migration, dual-run, cutover, rollback và DR nằm ở `10_Ke_hoach_kiem_thu_va_chuyen_doi.md`; mọi bước cần dữ liệu nguồn chờ D04. **Pilot:** một tenant, một nhóm dự án, hai kỳ báo cáo song song với hệ thống hiện hữu (D09). **Rollout:** pilot → 5 tenant → mở rộng theo cohort và SLO; mỗi bước có tiêu chí vào/ra và đường rollback bằng routing, không restore DB làm mất giao dịch mới.

## 12. Vận hành, hỗ trợ, đào tạo và bàn giao
- **Vận hành:** lịch trực, escalation, runbook từng thành phần hạ tầng, diễn tập DR; thông báo vận hành qua kênh độc lập khi Notification Center lỗi.
- **Hỗ trợ:** phân loại sự cố P0–P3 theo tài liệu 10; thời gian phản hồi chốt ở D10.
- **Đào tạo:** theo vai trò (lãnh đạo, cán bộ báo cáo, kế toán, quản trị tenant, quản trị nền tảng); tài liệu và môi trường đào tạo dữ liệu synthetic; **hypercare** sau mỗi cohort.
- **Bàn giao:** mã nguồn, đặc tả, runbook, sổ xác nhận pháp lý, kết quả UAT và danh sách nợ kỹ thuật.

## 13. Blocker, phụ thuộc bên thứ ba và quyết định mở
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

## 14. Kiểm soát thay đổi và báo cáo tiến độ
Mỗi thay đổi có CR ID, yêu cầu nguồn, tác động FR/màn hình/API/bảng/test/chi phí/lịch và người duyệt; không sửa ngầm baseline. Báo cáo tiến độ theo slice nghiệp vụ đã nghiệm thu, giờ review đã dùng so với cam kết, quyết định bị chặn, lỗi, bằng chứng và dự báo; không đo phần trăm hoàn tất bằng số màn hình đã vẽ.

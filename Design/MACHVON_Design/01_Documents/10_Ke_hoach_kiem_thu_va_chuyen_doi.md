# Kế hoạch kiểm thử, dữ liệu và chuyển đổi

Baseline 1.4 | 22/10/2026 | Test design, chưa phải kết quả nghiệm thu production. Nội dung baseline 1.3 được giữ nguyên; phần bổ sung 1.4 được đánh dấu "Cập nhật 1.4" kèm mã CR.

## Phạm vi và tầng kiểm thử

Unit/domain kiểm tiền, subset, ratio, state machine, entitlement, budget và reducer callback. Integration dùng DB thật/queue/object store test cho transaction, RLS, idempotency, audit/outbox, migration và contract. Adapter contract dùng sandbox hoặc mock theo hợp đồng đã xác minh. E2E kiểm vertical slice web/mobile; UAT do owner nghiệp vụ xác nhận. Security, load, DR và accessibility là gate riêng, không thay bằng E2E happy path.

**Cập nhật 1.4 — CR-TEST-01.** **Cổng tự động** (xem `ci/README.md`): quét lối tắt bị cấm, mã tiếng Anh, secret, test với coverage ≥ 90% line, hợp đồng `PROGRESS.md`, review chéo Codex. **Cổng người:** mỗi slice khai báo hạng mục bắt buộc người duyệt (đường tiền, quyền và cách ly tenant, migration, mẫu văn bản pháp lý, quyết định AI); phần còn lại không chờ người.

## Danh mục test và truy vết

Test_Case_Catalogue.html và test_cases.json bao gồm AC01–AC67, ca xuyên module và checklist327 màn hình. Mỗi case lưu id, setup, steps, expected, priority, status và evidence. UI checklist cần API binding/fixtures trước thực thi; không diễn giải nó là một bộ integration test tự động sẵn chạy. Test ID được gắn trong implementation_backlog và traceability; thêm automated_test_path/build_id/run_id/actual_result khi đội triển khai có code.

**Cập nhật 1.4 — CR-TEST-02.** `test_cases.json` phân biệt rõ năm trạng thái, không lẫn nhau:
1. **Checklist UI** (`UI-<màn hình>`, loại screen-contract): kiểm trạng thái, quyền, bố cục theo mockup; chưa phải test domain.
2. **Test thủ công có bước và dữ liệu cụ thể** (`UAT-AC*`, `UAT-NFR-*`, ca xuyên module).
3. **Test tự động dự kiến:** có đường dẫn mã dự kiến (`automated_test_path`) nhưng chưa có mã.
4. **Test tự động đã có mã:** có `automated_test_path` thật và `build_id`.
5. **Test đã chạy:** có `run_id`, `actual_result`, bằng chứng.
Mỗi test quan trọng có setup, input, bước, expected, ưu tiên và bằng chứng cần thu. Mỗi test **phải** gắn ít nhất một yêu cầu qua `covers` hoặc truy vết; bộ kiểm nhất quán chặn test mồ côi, test P0 dùng chung bước mẫu và yêu cầu không có test. Ma trận truy vết đầy đủ: yêu cầu → màn hình/luồng → API → dữ liệu → task → test → bằng chứng nghiệm thu (`traceability.json`, `Traceability.html`). Yêu cầu phi chức năng (cách ly, DR, retention, quan sát) truy vết tới cơ chế kiểm soát và test, không bị ép gắn màn hình hay API công khai (R11).

## Dữ liệu chuẩn và oracle

test_fixtures.json dùng dữ liệu giả, tenant A/B và vai trò riêng. Sáu ô nguồn tổng420 triệu, CTMTQG40 là subset không cộng thành460. Hai snapshot100→150 lấy150; hai tỷ lệ50/100 và90/900 tổng14%. Fixture hợp đồng gross100-recovery20-retention5-tax10=net65 chỉ áp cho hợp đồng test đó. Oracle tính bằng Decimal độc lập khỏi UI. LLM input1000 gồm cache200 thì noncached800; reasoning100 thuộc output300 không cộng thành400 theo adapter fixture. Thay provider phải kiểm semantics riêng.

**Cập nhật 1.4 — CR-TEST-03.** 

## Ma trận môi trường và thiết bị

Dev dùng synthetic và provider stub; test dùng service instances biệt lập; staging gần production nhưng masked data và sandbox credentials; production smoke không tạo giao dịch vốn giả. Chốt browser/version và OS/thiết bị tại D09; tối thiểu desktop Chromium và một engine khác, Android/iOS vật lý, màn390px và tablet, mạng chậm/offline,200% zoom, text scaling, keyboard và screen reader. Không coi viewport mobile trong browser là đã test native app.

**Cập nhật 1.4 — CR-TEST-04.** Viewport mobile trong trình duyệt không được coi là test ứng dụng Flutter native; thiết bị vật lý Android và iOS là bắt buộc cho cổng mobile.

## Thiết kế lỗi và cạnh tranh

Tiêm timeout trước/sau commit, webhook duplicate/đảo thứ tự, queue at-least-once, provider429/5xx, DB serialization, token revoked, disk quota, expired URL và app kill. Ghi lại request/result và side effects. Lệnh idempotent cùng key/body trả cùng kết quả; khác body409. Giao dịch thất bại không để audit/outbox ghi thành công; provider accepted nhưng ACK mất vào trạng thái uncertain và reconcile.

## Kiểm thử tải đề xuất

Chốt capacity profile trước chạy; baseline BRD100 tenant/50.000 dự án/5.000 concurrent là giả định, không số đã đạt. Ramp, steady load và spike, ghi distribution read/write/import/BI/notification riêng. Đo p50/p95/p99, error, DB locks, queue lag và noisy neighbor. Mục tiêu đọc phổ biến p95≤800ms, màn nghiệp vụ≤2,5s, BI thông dụng≤5s trên dataset/scope đã công bố; job nặng có deadline riêng. Không lấy trung bình che tenant chậm.

## Migration rehearsal và đối soát

Inventory → profile → mapping có version → extract manifest/checksum → staging → validate/quarantine → master match → load idempotent → reconcile totals/count/FK/file → owner signoff. mapping_source_template.json là mẫu phải điền tên trường thật; chưa có quyền/dataset thì không ghi mapping là đã hoàn tất. Đối soát theo tenant/project/kỳ/nguồn/currency/basis, không chỉ tổng toàn hệ thống. Tolerance tiền mặc định0 cho cùng basis; ngoại lệ timing/rounding cần rule được ký. Giữ source IDs và run_id để truy ngược.

**Cập nhật 1.4 — CR-TEST-05.** Import từ tệp (Kho bạc, hệ thống nguồn) **idempotent**: băm tệp và khóa nghiệp vụ, nạp lại cùng tệp không tạo bản ghi mới. Đối soát theo tenant, dự án, kỳ, nguồn, tiền tệ và basis, không chỉ tổng toàn hệ thống; dung sai tiền mặc định 0 cho cùng basis, ngoại lệ thời điểm/làm tròn cần quy tắc được ký. Giữ source ID và run_id để truy ngược.
**Dual-run:** vận hành song song hệ thống hiện hữu ít nhất hai kỳ báo cáo; chênh lệch được phân loại (định nghĩa, thời điểm, lỗi dữ liệu) và có owner.

## Cutover và rollback

Trước cutover: backup/PITR, freeze window được duyệt, stop/drain writers và integrations, final delta, reconcile, đổi routing, smoke quyền/số liệu, mở cohort. Rollback nếu sai tiền, cross-tenant, mất dữ liệu hoặc SLO critical: dừng writers mới, preserve delta/audit, quay ứng dụng tương thích và routing theo runbook; không restore DB cũ làm mất giao dịch mới. Nếu có giao dịch đã phát ra provider, reconcile trước tiếp tục. Thử diễn tập ở staging với owner Data/Ops; ghi downtime thực tế.

**Cập nhật 1.4 — CR-TEST-06.** Trước cutover: backup/PITR đã thử khôi phục, cửa sổ đóng băng được duyệt, dừng và xả writer cùng tích hợp, delta cuối, đối soát, đổi routing, smoke quyền và số liệu, mở cohort. Rollback nếu sai tiền, rò tenant, mất dữ liệu hoặc SLO nghiêm trọng: dừng writer mới, giữ delta và audit, quay ứng dụng tương thích và routing theo runbook; **không restore DB cũ làm mất giao dịch mới**. Giao dịch đã phát ra nhà cung cấp phải đối soát trước khi tiếp tục. Diễn tập ở staging do Data/Ops, ghi downtime thực tế.
**DR:** RPO ≤ 15 phút và RTO ≤ 4 giờ là đề xuất chờ D10; SLO 99,9% hàng tháng chỉ khả thi nếu coi mọi sự cố DR là tiêu hao ngân sách lỗi (xem thiết kế cơ bản). Diễn tập kiểm cả DB, object storage và checksum liên kết.

## Defect và điều kiện nghiệm thu

P0: rò tenant, sai tiền được công bố, mất dữ liệu, vượt quyền hoặc provider side effect không kiểm soát; dừng release. P1: luồng lõi không hoàn thành, không có workaround chấp nhận; chặn gate. P2/P3 có owner, workaround và hạn xử lý được PO duyệt. Evidence gồm build/schema version, dataset hash, request IDs, screenshots/log đã redact, expected/actual, người chạy và thời điểm. Tất cả case critical pass và không P0/P1 mở; test skip phải có lý do, không tính pass.

**Cập nhật 1.4 — CR-TEST-07.** P0: rò tenant, sai tiền đã công bố, mất dữ liệu, vượt quyền hoặc tác động ngoài không kiểm soát; dừng release. P1: luồng lõi không hoàn thành, không có workaround chấp nhận; chặn cổng. P2/P3: có owner, workaround và hạn do PO duyệt. Bằng chứng gồm build/schema version, hash dữ liệu, request ID, ảnh chụp và log đã che, expected/actual, người chạy và thời điểm. Mọi case critical (tiền, cách ly, restore) 100% pass và không P0/P1 mở; test bị skip phải có lý do và không tính là đạt. **UAT phủ 100%:** `UAT-COVERAGE.md` liệt kê mọi màn hình và chức năng; chỉ khi mọi dòng PASS mới được tuyên bố hoàn tất.

## Vận hành sau ra mắt

Canary theo cohort, theo dõi error/SLO, reconcile backlog, DLQ, budget reservations pending, license invalidation và DQ incidents. Ops trực, escalation rõ; notification vận hành dùng kênh độc lập khi Notification Center lỗi. DR drill kiểm cả DB/object và checksum liên kết; security review kiểm cả export/search/vector/cache, không chỉ REST. Chỉ xác nhận trưởng thành bằng bằng chứng vận hành và đánh giá owner.

**Cập nhật 1.4 — CR-TEST-08.** Canary theo cohort, theo dõi lỗi/SLO, hàng đợi đối soát, DLQ, ngân sách AI đang giữ chỗ, vô hiệu license và sự cố chất lượng dữ liệu. Ops trực, escalation rõ; thông báo vận hành dùng kênh độc lập khi Notification Center lỗi. Đào tạo theo vai trò và hypercare sau mỗi cohort. Security review kiểm cả export, tìm kiếm, vector, cache và đồng bộ, không chỉ REST. Chỉ xác nhận mức trưởng thành bằng bằng chứng vận hành và đánh giá của owner.

## Ưu tiên kiểm thử theo rủi ro chặn release

**Cập nhật 1.4 — CR-TEST-09.** 1. **Cách ly tenant trên mọi kênh:** API, DB (RLS), cache, tìm kiếm, vector, file, export, **đồng bộ mobile**. Test người dùng A không đọc, không đoán được ID, không nhận qua sync dữ liệu tenant B; thu hồi membership làm bucket rỗng; đổi tenant không rò cache hay tệp.
2. **Quyền System Admin và chống tự nâng quyền:** không ai cấp vai trò cao hơn hoặc bằng quyền của mình; kiểm `tenant_id` do trình duyệt gửi bị bỏ qua.
3. **Sai số tiền:** snapshot, subset CTMTQG (không cộng), hai tỷ lệ giải ngân, drill tới nguồn đúng tổng.
4. **Chống trùng nghĩa vụ tài chính (R7):** hai người, hai Idempotency-Key khác nhau, cùng một nghiệm thu → một thành công, một nhận `409 ACCEPTANCE_ALREADY_CLAIMED` hoặc `VALUE_EXCEEDED`; sổ lũy kế đúng sau reversal; idempotency cùng key khác nội dung → `409 IDEMPOTENCY_BODY_MISMATCH`.
5. **Đồng thời và trạng thái bất biến:** nộp đồng thời, cạnh tranh phân bổ, bản đã nộp không sửa được, khóa kỳ.
6. **Mobile offline và đồng bộ:** mất kết nối khi nộp → "Chưa xác định" rồi tra theo key; xung đột tiền không last-write-wins; đổi tenant.
7. **Webhook, retry, consent, thông báo:** chữ ký, trùng/đảo thứ tự, giới hạn retry, ghi nhận consent, dedupe một khóa.
8. **AI:** bằng chứng có trích dẫn, chống prompt injection, ngân sách; **dữ liệu phân loại quan trọng không bao giờ tới mô hình quốc tế** (R5), eval chạy trên cả hai tuyến.
9. **License:** ranh giới, thu hồi, vô hiệu cache, `EntitlementChanged` tới client.
10. **DOC:** cấp số đồng thời không trùng và không hậu tố; chữ ký giữ hiệu lực sau khi cấp số (R8).
11. **Quy tắc pháp lý dạng dữ liệu (R4):** đổi `effective_from` thì bản ghi kỳ cũ giữ quy tắc cũ; slice dùng mục [CXN] chưa xác nhận không được DONE.
12. **Migration, restore, hiệu năng, trợ năng** (mục 7–9).

## Pilot và rollout theo tenant

**Cập nhật 1.4 — CR-TEST-10.** **Pilot:** một tenant, một nhóm dự án, hai kỳ báo cáo song song (D09); tiêu chí vào: R1 đạt, mapping nguồn được ký, người dùng đã đào tạo. Tiêu chí ra: không P0/P1 mở, số liệu pilot khớp nguồn theo quy tắc dung sai, SUS ≥ 80 và ≥ 90% tác vụ lõi hoàn thành không trợ giúp (đo thực tế, không tự chấm). **Rollout:** pilot → 5 tenant → mở rộng theo cohort và SLO; mỗi bước có đường rollback bằng routing và canary.

## Phụ lục: ánh xạ nội dung baseline 1.3

Không đoạn nào của tài liệu 10 baseline bị bỏ: mọi đoạn còn nguyên văn ở mục cùng tên; nội dung mới nằm trong các khối "Cập nhật 1.4" và hai mục bổ sung ở cuối.

- "# Kế hoạch kiểm thử, dữ liệu và chuyển đổi Baseline 1.3 | 22/10/2026 | Test design, chưa phải kết quả nghiệm thu" → dòng tiêu đề và nhãn baseline ở đầu tài liệu, được nâng lên Baseline 1.4 (CR-BASE-01); nội dung của dòng đó vẫn còn nguyên trong phần mô tả ngay dưới tiêu đề.

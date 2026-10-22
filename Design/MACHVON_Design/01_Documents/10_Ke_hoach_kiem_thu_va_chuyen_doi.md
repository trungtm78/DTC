# Kế hoạch kiểm thử, dữ liệu và chuyển đổi
Baseline 1.3 | 22/10/2026 | Test design, chưa phải kết quả nghiệm thu production.

## Phạm vi và tầng kiểm thử
Unit/domain kiểm tiền, subset, ratio, state machine, entitlement, budget và reducer callback. Integration dùng DB thật/queue/object store test cho transaction, RLS, idempotency, audit/outbox, migration và contract. Adapter contract dùng sandbox hoặc mock theo hợp đồng đã xác minh. E2E kiểm vertical slice web/mobile; UAT do owner nghiệp vụ xác nhận. Security, load, DR và accessibility là gate riêng, không thay bằng E2E happy path.

## Danh mục test và truy vết
Test_Case_Catalogue.html và test_cases.json bao gồm AC01–AC67, ca xuyên module và checklist327 màn hình. Mỗi case lưu id, setup, steps, expected, priority, status và evidence. UI checklist cần API binding/fixtures trước thực thi; không diễn giải nó là một bộ integration test tự động sẵn chạy. Test ID được gắn trong implementation_backlog và traceability; thêm automated_test_path/build_id/run_id/actual_result khi đội triển khai có code.

## Dữ liệu chuẩn và oracle
test_fixtures.json dùng dữ liệu giả, tenant A/B và vai trò riêng. Sáu ô nguồn tổng420 triệu, CTMTQG40 là subset không cộng thành460. Hai snapshot100→150 lấy150; hai tỷ lệ50/100 và90/900 tổng14%. Fixture hợp đồng gross100-recovery20-retention5-tax10=net65 chỉ áp cho hợp đồng test đó. Oracle tính bằng Decimal độc lập khỏi UI. LLM input1000 gồm cache200 thì noncached800; reasoning100 thuộc output300 không cộng thành400 theo adapter fixture. Thay provider phải kiểm semantics riêng.

## Ma trận môi trường và thiết bị
Dev dùng synthetic và provider stub; test dùng service instances biệt lập; staging gần production nhưng masked data và sandbox credentials; production smoke không tạo giao dịch vốn giả. Chốt browser/version và OS/thiết bị tại D09; tối thiểu desktop Chromium và một engine khác, Android/iOS vật lý, màn390px và tablet, mạng chậm/offline,200% zoom, text scaling, keyboard và screen reader. Không coi viewport mobile trong browser là đã test native app.

## Thiết kế lỗi và cạnh tranh
Tiêm timeout trước/sau commit, webhook duplicate/đảo thứ tự, queue at-least-once, provider429/5xx, DB serialization, token revoked, disk quota, expired URL và app kill. Ghi lại request/result và side effects. Lệnh idempotent cùng key/body trả cùng kết quả; khác body409. Giao dịch thất bại không để audit/outbox ghi thành công; provider accepted nhưng ACK mất vào trạng thái uncertain và reconcile.

## Kiểm thử tải đề xuất
Chốt capacity profile trước chạy; baseline BRD100 tenant/50.000 dự án/5.000 concurrent là giả định, không số đã đạt. Ramp, steady load và spike, ghi distribution read/write/import/BI/notification riêng. Đo p50/p95/p99, error, DB locks, queue lag và noisy neighbor. Mục tiêu đọc phổ biến p95≤800ms, màn nghiệp vụ≤2,5s, BI thông dụng≤5s trên dataset/scope đã công bố; job nặng có deadline riêng. Không lấy trung bình che tenant chậm.

## Migration rehearsal và đối soát
Inventory → profile → mapping có version → extract manifest/checksum → staging → validate/quarantine → master match → load idempotent → reconcile totals/count/FK/file → owner signoff. mapping_source_template.json là mẫu phải điền tên trường thật; chưa có quyền/dataset thì không ghi mapping là đã hoàn tất. Đối soát theo tenant/project/kỳ/nguồn/currency/basis, không chỉ tổng toàn hệ thống. Tolerance tiền mặc định0 cho cùng basis; ngoại lệ timing/rounding cần rule được ký. Giữ source IDs và run_id để truy ngược.

## Cutover và rollback
Trước cutover: backup/PITR, freeze window được duyệt, stop/drain writers và integrations, final delta, reconcile, đổi routing, smoke quyền/số liệu, mở cohort. Rollback nếu sai tiền, cross-tenant, mất dữ liệu hoặc SLO critical: dừng writers mới, preserve delta/audit, quay ứng dụng tương thích và routing theo runbook; không restore DB cũ làm mất giao dịch mới. Nếu có giao dịch đã phát ra provider, reconcile trước tiếp tục. Thử diễn tập ở staging với owner Data/Ops; ghi downtime thực tế.

## Defect và điều kiện nghiệm thu
P0: rò tenant, sai tiền được công bố, mất dữ liệu, vượt quyền hoặc provider side effect không kiểm soát; dừng release. P1: luồng lõi không hoàn thành, không có workaround chấp nhận; chặn gate. P2/P3 có owner, workaround và hạn xử lý được PO duyệt. Evidence gồm build/schema version, dataset hash, request IDs, screenshots/log đã redact, expected/actual, người chạy và thời điểm. Tất cả case critical pass và không P0/P1 mở; test skip phải có lý do, không tính pass.

## Vận hành sau ra mắt
Canary theo cohort, theo dõi error/SLO, reconcile backlog, DLQ, budget reservations pending, license invalidation và DQ incidents. Ops trực, escalation rõ; notification vận hành dùng kênh độc lập khi Notification Center lỗi. DR drill kiểm cả DB/object và checksum liên kết; security review kiểm cả export/search/vector/cache, không chỉ REST. Chỉ xác nhận trưởng thành bằng bằng chứng vận hành và đánh giá owner.

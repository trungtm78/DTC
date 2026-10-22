# Kế hoạch kiểm thử, dữ liệu và chuyển đổi
Baseline 1.4 | 22/10/2026 | Thiết kế kiểm thử, chưa phải kết quả nghiệm thu production. Test còn NOT_RUN không được tính là đạt.

## 1. Phạm vi và tầng kiểm thử
Unit/domain kiểm tiền, subset, ratio, state machine, entitlement, ngân sách và reducer callback. Integration dùng DB thật, queue và object store test cho transaction, RLS, idempotency, audit/outbox, migration và contract. Adapter contract dùng sandbox hoặc mock theo hợp đồng đã xác minh. E2E kiểm vertical slice web và mobile; UAT do owner nghiệp vụ xác nhận. Security, tải, DR và trợ năng là cổng riêng, không thay bằng E2E happy path.

**Cổng tự động** (xem `ci/README.md`): quét lối tắt bị cấm, mã tiếng Anh, secret, test với coverage ≥ 90% line, hợp đồng `PROGRESS.md`, review chéo Codex. **Cổng người:** mỗi slice khai báo hạng mục bắt buộc người duyệt (đường tiền, quyền và cách ly tenant, migration, mẫu văn bản pháp lý, quyết định AI); phần còn lại không chờ người.

## 2. Danh mục test, loại và truy vết
`test_cases.json` phân biệt rõ năm trạng thái, không lẫn nhau:
1. **Checklist UI** (`UI-<màn hình>`, loại screen-contract): kiểm trạng thái, quyền, bố cục theo mockup; chưa phải test domain.
2. **Test thủ công có bước và dữ liệu cụ thể** (`UAT-AC*`, `UAT-NFR-*`, ca xuyên module).
3. **Test tự động dự kiến:** có đường dẫn mã dự kiến (`automated_test_path`) nhưng chưa có mã.
4. **Test tự động đã có mã:** có `automated_test_path` thật và `build_id`.
5. **Test đã chạy:** có `run_id`, `actual_result`, bằng chứng.
Mỗi test quan trọng có setup, input, bước, expected, ưu tiên và bằng chứng cần thu. Mỗi test **phải** gắn ít nhất một yêu cầu qua `covers` hoặc truy vết; bộ kiểm nhất quán chặn test mồ côi, test P0 dùng chung bước mẫu và yêu cầu không có test. Ma trận truy vết đầy đủ: yêu cầu → màn hình/luồng → API → dữ liệu → task → test → bằng chứng nghiệm thu (`traceability.json`, `Traceability.html`). Yêu cầu phi chức năng (cách ly, DR, retention, quan sát) truy vết tới cơ chế kiểm soát và test, không bị ép gắn màn hình hay API công khai (R11).

## 3. Ưu tiên kiểm thử (thứ tự chặn release)
1. **Cách ly tenant trên mọi kênh:** API, DB (RLS), cache, tìm kiếm, vector, file, export, **đồng bộ mobile**. Test người dùng A không đọc, không đoán được ID, không nhận qua sync dữ liệu tenant B; thu hồi membership làm bucket rỗng; đổi tenant không rò cache hay tệp.
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

## 4. Dữ liệu chuẩn và oracle
`test_fixtures.json` chỉ dùng dữ liệu synthetic hoặc masked: tenant A/B, vai trò riêng, mã đơn vị giả. **Oracle** tính bằng Decimal độc lập khỏi UI. Quy ước giữ từ baseline 1.3: sáu ô nguồn tổng 420 triệu, CTMTQG 40 là subset không cộng thành 460; hai snapshot 100→150 lấy 150; hai tỷ lệ 50/100 và 90/900 tổng 14%; hợp đồng gross 100 − thu hồi 20 − giữ lại 5 − thuế 10 = net 65 chỉ áp cho hợp đồng test đó; LLM input 1000 gồm cache 200 thì không-cache 800, reasoning 100 thuộc output 300.
**Bộ golden tài chính** (D03) cần chủ nghiệp vụ ký; trong lúc chờ, fixture mang nhãn CHỜ KÝ và test dùng chúng không được tính là đạt cho tiêu chí "số liệu golden khớp". Mỗi fixture có ID (FX-*) và test tham chiếu fixture theo ID. Không đưa secret hay dữ liệu thật vào tài liệu.

## 5. Ma trận môi trường và thiết bị
Dev dùng synthetic và nhà cung cấp giả có contract; test dùng instance biệt lập; staging gần production với dữ liệu masked và sandbox credentials; production smoke không tạo giao dịch vốn giả. Chốt trình duyệt, OS và thiết bị tại D09; tối thiểu Chromium và một engine khác, Android và iOS vật lý, màn 390 px và tablet, mạng chậm/offline, zoom 200%, text scaling, bàn phím và trình đọc màn hình. Viewport mobile trong trình duyệt không được coi là test ứng dụng Flutter native.

## 6. Thiết kế lỗi và cạnh tranh
Tiêm timeout trước/sau commit, webhook trùng/đảo thứ tự, queue at-least-once, nhà cung cấp 429/5xx, lỗi tuần tự hóa DB, token bị thu hồi, hết hạn mức đĩa, URL hết hạn và app bị kill. Ghi request/kết quả và hiệu ứng phụ. Lệnh idempotent cùng key và nội dung trả cùng kết quả, khác nội dung 409. Giao dịch thất bại không để audit/outbox ghi thành công; nhà cung cấp đã nhận mà ACK mất chuyển sang trạng thái chưa xác định và đối soát.

## 7. Kiểm thử tải
Chốt capacity profile (D09) trước khi chạy; baseline BRD 100 tenant / 50.000 dự án / 5.000 đồng thời là giả định, không phải số đã đạt. Ramp, steady và spike; đo riêng phân bố đọc/ghi/import/BI/thông báo; p50/p95/p99, lỗi, khóa DB, độ trễ queue và noisy neighbor. Mục tiêu đề xuất: đọc phổ biến p95 ≤ 800 ms, màn nghiệp vụ ≤ 2,5 s, BI thông dụng ≤ 5 s trên dữ liệu và phạm vi đã công bố; job nặng có hạn riêng. Không lấy trung bình che tenant chậm; thử cách ly tài nguyên giữa các tenant.

## 8. Migration, rehearsal và đối soát
Inventory → profile → mapping có version → extract manifest/checksum → staging → validate/quarantine → master match → load idempotent → reconcile tổng/số lượng/FK/tệp → owner ký. `mapping_source_template.json` là mẫu phải điền tên trường thật; chưa có quyền hoặc dữ liệu thì không ghi mapping là hoàn tất (D04). Import từ tệp (Kho bạc, hệ thống nguồn) **idempotent**: băm tệp và khóa nghiệp vụ, nạp lại cùng tệp không tạo bản ghi mới. Đối soát theo tenant, dự án, kỳ, nguồn, tiền tệ và basis, không chỉ tổng toàn hệ thống; dung sai tiền mặc định 0 cho cùng basis, ngoại lệ thời điểm/làm tròn cần quy tắc được ký. Giữ source ID và run_id để truy ngược.
**Dual-run:** vận hành song song hệ thống hiện hữu ít nhất hai kỳ báo cáo; chênh lệch được phân loại (định nghĩa, thời điểm, lỗi dữ liệu) và có owner.

## 9. Cutover, rollback, DR
Trước cutover: backup/PITR đã thử khôi phục, cửa sổ đóng băng được duyệt, dừng và xả writer cùng tích hợp, delta cuối, đối soát, đổi routing, smoke quyền và số liệu, mở cohort. Rollback nếu sai tiền, rò tenant, mất dữ liệu hoặc SLO nghiêm trọng: dừng writer mới, giữ delta và audit, quay ứng dụng tương thích và routing theo runbook; **không restore DB cũ làm mất giao dịch mới**. Giao dịch đã phát ra nhà cung cấp phải đối soát trước khi tiếp tục. Diễn tập ở staging do Data/Ops, ghi downtime thực tế.
**DR:** RPO ≤ 15 phút và RTO ≤ 4 giờ là đề xuất chờ D10; SLO 99,9% hàng tháng chỉ khả thi nếu coi mọi sự cố DR là tiêu hao ngân sách lỗi (xem thiết kế cơ bản). Diễn tập kiểm cả DB, object storage và checksum liên kết.

## 10. Pilot và rollout theo tenant
**Pilot:** một tenant, một nhóm dự án, hai kỳ báo cáo song song (D09); tiêu chí vào: R1 đạt, mapping nguồn được ký, người dùng đã đào tạo. Tiêu chí ra: không P0/P1 mở, số liệu pilot khớp nguồn theo quy tắc dung sai, SUS ≥ 80 và ≥ 90% tác vụ lõi hoàn thành không trợ giúp (đo thực tế, không tự chấm). **Rollout:** pilot → 5 tenant → mở rộng theo cohort và SLO; mỗi bước có đường rollback bằng routing và canary.

## 11. Defect và điều kiện nghiệm thu
P0: rò tenant, sai tiền đã công bố, mất dữ liệu, vượt quyền hoặc tác động ngoài không kiểm soát; dừng release. P1: luồng lõi không hoàn thành, không có workaround chấp nhận; chặn cổng. P2/P3: có owner, workaround và hạn do PO duyệt. Bằng chứng gồm build/schema version, hash dữ liệu, request ID, ảnh chụp và log đã che, expected/actual, người chạy và thời điểm. Mọi case critical (tiền, cách ly, restore) 100% pass và không P0/P1 mở; test bị skip phải có lý do và không tính là đạt. **UAT phủ 100%:** `UAT-COVERAGE.md` liệt kê mọi màn hình và chức năng; chỉ khi mọi dòng PASS mới được tuyên bố hoàn tất.

## 12. Vận hành, hỗ trợ và đào tạo sau ra mắt
Canary theo cohort, theo dõi lỗi/SLO, hàng đợi đối soát, DLQ, ngân sách AI đang giữ chỗ, vô hiệu license và sự cố chất lượng dữ liệu. Ops trực, escalation rõ; thông báo vận hành dùng kênh độc lập khi Notification Center lỗi. Đào tạo theo vai trò và hypercare sau mỗi cohort. Security review kiểm cả export, tìm kiếm, vector, cache và đồng bộ, không chỉ REST. Chỉ xác nhận mức trưởng thành bằng bằng chứng vận hành và đánh giá của owner.

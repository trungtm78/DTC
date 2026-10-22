# Hệ Thống Lý Dự Án Đầu Tư Công quản trị dữ liệu và trưởng thành sản phẩm
Baseline 1.3 | 22/10/2026 | Phạm vi baseline 327 màn hình gồm 261 web và 66 mobile. Đánh giá hiện trạng là đánh giá khả năng quan sát từ tài liệu, không thay kiểm định CSDL thật.

## Nguyên tắc toàn vẹn dữ liệu
Một hệ thống đầy đủ cần hơn danh sách màn hình. Mỗi năng lực phải có dữ liệu đầu vào, người chịu trách nhiệm, nguồn sự thật, grain, quan hệ, quy tắc kiểm tra, vòng đời, quyền và bằng chứng. Ma trận coverage nối yêu cầu → màn hình → data domain → service/API → validation → test. Khoảng trống được ghi nhận và có owner đóng, không được lấp bằng dữ liệu giả hoặc suy đoán không gắn nhãn.

Ba nhóm dữ liệu: master/reference (tổ chức, địa bàn, nguồn, chương trình, kỳ, loại hồ sơ); transactional/evidence (quyết định, phân bổ, báo cáo revision, giao dịch, chứng từ, hội thoại, license); derived/analytical (chỉ tiêu, snapshot BI, scoring hỗ trợ, quality score, cost projection). Dữ liệu derived phải dựng lại được hoặc có snapshot nguồn và version logic; không dùng kết quả LLM làm master fact chưa kiểm chứng.

## Bản đồ domain và chủ sở hữu
Tổ chức/danh tính do tenant owner và IAM steward quản; nguồn vốn/kế hoạch do đầu mối tài chính; dự án/tiến độ do chủ đầu tư; report accepted do bộ phận tổng hợp; actual Kho bạc do kế toán đối soát; đề án/tiêu chí do bên mời thầu/tổ chuyên gia; tài liệu do document controller; metric/BI do data owner chỉ tiêu; notification/consent do communication owner; model/AI do AI governance; usage/cost do FinOps; SaaS/license do commercial owner; audit/security do bộ phận an toàn và kiểm toán độc lập.

RACI: owner chịu trách nhiệm định nghĩa/chấp nhận chất lượng; steward vận hành danh mục và xử lý lỗi; producer tạo dữ liệu; consumer dùng đúng contract; custodian vận hành kỹ thuật; approver chấp nhận thay đổi trọng yếu. Một tài khoản không nên vừa sửa master tài chính vừa tự phê duyệt điều chỉnh số liệu phát sinh từ master đó.

## Master data đầy đủ và hiệu lực theo thời gian
MDM-01..33 bao phủ trung tâm danh mục, địa bàn/sáp nhập, cơ quan/chủ đầu tư, nguồn vốn, CTMTQG, lĩnh vực, nhóm/loại/giai đoạn dự án, thẩm quyền/quyết định, kỳ, đơn vị tính, tiền tệ, loại hồ sơ, hợp đồng, thanh toán, Kho bạc, vướng mắc/SLA, tiêu chí thầu, chuyên môn, sự kiện/mục đích liên hệ, ngôn ngữ, classification, mapping mã, CRUD, impact, version, import, merge, deactivate và publish.

MasterRecord identity gồm tenant_scope + master_type + code; code đã phát hành không tái sử dụng cho ý nghĩa khác. Version có valid_from/until và recorded_at để phân biệt ngày nghiệp vụ với ngày nhập. Mã đổi tên vẫn cùng identity; sáp nhập tổ chức có predecessor/successor mapping. Global baseline do platform quản; tenant extension riêng, không ghi đè khóa chuẩn làm sai tích hợp. Tenant override chỉ với trường được policy cho phép.

Trước ngừng dùng: kiểm số hồ sơ tham chiếu, source mapping, workflow và metric bị ảnh hưởng; tạo effective end, không xóa FK. Merge cần preview bản ghi và nguồn, golden record, mapping redirect, audit và phương án đảo trước khi commit. Không tự merge nhà thầu chỉ dựa tên gần giống; ưu tiên mã số thuế định danh đã xác minh và kiểm tra pháp lý.

## Data contract và quản lý schema
Mỗi dataset công bố producer/consumer, business purpose, grain, key, schema/version, required/null semantics, currency/unit, timestamps, classification, owner, update frequency, SLO freshness, validation, dedupe key, reconciliation totals, lineage và retention. Schema backward-compatible thêm optional field; thay nghĩa/đơn vị/grain phải version mới và dual-run. Contract registry chặn publish thay đổi breaking chưa được consumers chấp nhận.

Import pipeline: Receive → malware/type check → raw immutable → parse → mapping → validate → quarantine/ready → dry-run impact → approval → transaction load → reconcile → publish. Mỗi batch có checksum file, schema version, số dòng nhận/hợp lệ/lỗi/ghi và tổng tiền trước/sau. Quarantine không tính vào báo cáo chính thức. Reprocess dùng cùng business key để không trùng số.

## Chất lượng dữ liệu và điểm đo
Completeness: required_present/required_expected trên đúng scope, null “không áp dụng” không coi là thiếu nếu contract quy định. Validity: số bản ghi qua rule/type/domain/temporal; uniqueness: key collision count; consistency: CTMTQG≤parent, dates/relations hợp lệ; timeliness: age so với SLA; accuracy: cần đối chiếu nguồn xác nhận hoặc lấy mẫu chuyên gia, không suy từ việc field có giá trị. Integrity: FK/orphan/cross-tenant references phải 0.

Mục tiêu đề xuất cho dữ liệu tài chính trọng yếu: required completeness 100%, FK/key validity 100%, duplicate transaction 0, sai lệch tổng ngoài tolerance đã duyệt 0. Với OCR/ngoại vi, low-confidence và missing field phải vào review, không ép đạt 100% bằng tự điền. Quality score tổng hợp có trọng số theo criticality; một lỗi cross-tenant hoặc sai tổng trọng yếu là hard fail dù điểm trung bình cao.

Quality incident lưu rule, affected rows reference, impact, owner, severity, SLA, root cause, remediation và verification. Sửa upstream ưu tiên hơn chỉnh projection BI. Khi dữ liệu không đạt certification, dashboard có badge provisional/stale/failed; không công bố như số đã chốt. Exception có ngày hết hạn, người duyệt và lý do; không dùng exception vĩnh viễn để che lỗi.

## Maturity model đề xuất
Tham chiếu tư duy DCAM về năng lực quản trị dữ liệu, NIST AI RMF về Govern/Map/Measure/Manage và FinOps về trách nhiệm chi phí. Thang 1–5 dưới đây là rubric riêng cho dự án, không phải chứng nhận DCAM/NIST: L1 ad hoc; L2 có tài liệu và người chịu trách nhiệm cục bộ; L3 tiêu chuẩn hóa và thực thi toàn tenant; L4 đo/giám sát/tự động kiểm soát; L5 tối ưu liên tục dựa trên bằng chứng và value.

Tám trụ cột: governance/ownership; master/metadata; quality; integration; security/privacy; lineage/BI; AI readiness/governance; cost/value operations. Điểm chỉ chốt khi có artifact, log, phỏng vấn và kiểm thử, kèm người đánh giá/ngày/sample/confidence. “Chưa có bằng chứng” là Unknown, không tự cho 0 hoặc 1 và không coi là đã đạt.

Hiện trạng quan sát: biểu mẫu có các nhóm nguồn và kỳ (bằng chứng cấu trúc thu thập); có trạng thái lưu/gửi và menu theo dõi (bằng chứng luồng); chưa có bằng chứng đủ về master versioning, audit immutable, RLS, data contracts, semantic layer, lineage, quality profiling, AI governance hay FinOps. Vì vậy chưa thể chấm một điểm maturity tổng thể cho hệ thống cũ. Ngay cả tỷ lệ/giá trị khác nhau trong clip cần dữ liệu nguồn và định nghĩa để kết luận đúng/sai.

Mục tiêu trước pilot: L3 cho governance/master/security, L2→L3 cho quality/integration/lineage; trước SaaS scale: L4 cho tenant security, license, usage/cost và critical quality; trước đưa AI vào đánh giá thật: L3 trở lên về hồ sơ/criteria/evidence, L4 về evaluation và giám sát rủi ro. L5 là mục tiêu vận hành dài hạn, không đạt chỉ bằng tài liệu thiết kế.

## Lộ trình trưởng thành và bằng chứng thoát giai đoạn
0–30 ngày đề xuất: inventory, owner, glossary, profile dữ liệu được phép truy cập, xác định CDE và baseline defects. Bằng chứng: data catalogue được ký, mapping trường, mẫu dữ liệu đã phân loại, gap register. 31–60 ngày: chuẩn hóa master, contract/schema, validation/quarantine và reconcile tự động. Bằng chứng: hai chu kỳ nhập không trùng, totals khớp, xử lý orphan và history. 61–90 ngày: semantic metrics, lineage, quality SLO, tenant isolation tests và DR. Bằng chứng: KPI truy tới source và kiểm thử export/search/cache.

Sau 90 ngày tùy tiến độ triển khai: mở AI eval dataset, model/profile review, cost reservation/invoice reconciliation, notification consent/retry và SaaS meter audit. Các mốc là kế hoạch đề xuất phụ thuộc đội và dữ liệu, không phải cam kết hoàn tất. Mỗi giai đoạn có owner, chi phí, dependency và gate; không đưa AI scoring production trước khi nguồn/tiêu chí đủ trưởng thành.

## Rubric mục tiêu sản phẩm 9 đến 10 điểm
Trọng số đề xuất: nghiệp vụ vốn/kiểm soát tài chính 20%; quản trị/chất lượng dữ liệu 15%; BI/drill-down 10%; SaaS/license 10%; AI có bằng chứng và FinOps 10%; đa kênh/notification 10%; UX/mobile/accessibility 10%; security/operations/integration 15%. Mỗi nhóm chấm 0–10 theo bằng chứng: 0 chưa có; 3 tài liệu; 5 prototype; 7 triển khai có tests; 9 pilot đạt SLO/UX và audit; 10 vận hành nhiều khách hàng có benchmark bền vững.

Score = SUM(weight × verified_group_score). Chưa chấm điểm sản phẩm hiện tại vì mới là bộ thiết kế/prototype, chưa có pilot và audit production. Để mục tiêu tổng ≥9, mọi nhóm trọng yếu phải ≥8, không có blocker sai số tài chính/cross-tenant/mất dữ liệu/quyết định AI không kiểm chứng. Một nhóm security fail chặn ra mắt bất kể tổng điểm. Đánh giá thị trường còn cần RFP, demo đối chứng, TCO, khả năng triển khai và phản hồi người dùng, không suy từ marketing của đối thủ.

## Danh mục bằng chứng và nguồn nghiên cứu
Evidence pack cần có: glossary/owner signoff, schema/contracts, profiling report, DQ incidents, sample reconciliation, tenant penetration test, restore drill, SLO dashboard, LLM eval & invoice reconciliation, notification provider callback test, UX task completion/SUS và commercial billing reconciliation. Danh mục thiết kế/ảnh không thay thế các bằng chứng vận hành này.

Nguồn chính thức: EDM Council frameworks https://edmcouncil.org/frameworks/ ; NIST AI RMF https://airc.nist.gov/airmf-resources/airmf/5-sec-core/ ; FinOps Framework https://www.finops.org/framework/ ; Unit economics https://www.finops.org/framework/capabilities/unit-economics/ . Các khung tham chiếu hỗ trợ thiết kế, không tuyên bố sản phẩm được chứng nhận bởi các tổ chức này.


## Theme & thương hiệu theo tenant — SAS-04

Chỉ System Admin được cấu hình thương hiệu cho các tenant: màu sắc, logo, menu, header, footer, tên hệ thống, địa chỉ và thông tin liên hệ. Tenant Admin chỉ được đọc cấu hình đã công bố của tenant mình, không được sửa, lưu nháp, tải logo, tạo review, áp dụng hoặc khôi phục. Các quyền quản trị nội bộ tenant khác không bao gồm quyền cấu hình thương hiệu.

Bản nháp tách biệt theo tenant và không thay đổi giao diện đang dùng. Xem trước web/smartphone trong vùng riêng; bước review hiển thị chênh lệch trước/sau, tenant đích và phiên bản gốc. Xác nhận áp dụng tạo phiên bản bất biến mới. Khôi phục cũng phải review và tạo phiên bản mới, giữ nguyên lịch sử. Kiểm tra trường bắt buộc, email, tệp logo và sáu cặp màu tương phản tối thiểu 4,5:1 trước khi công bố.

Server phải xác thực System Admin cho mọi lệnh ghi; không tin vai trò, tenant_id hoặc cờ quyền do trình duyệt gửi. Review gắn actor, tenant, hash nội dung, base version và hạn sử dụng. Kiểm tra lại quyền và phiên bản trong giao dịch công bố; trả 403 khi thiếu quyền, 409 khi xung đột, 422 khi cấu hình không hợp lệ. Audit ghi người thực hiện, tenant, bản trước/sau, lý do khôi phục và thời điểm; không ghi bí mật vào log.

Prototype SAS-04 dùng localStorage và bộ chọn vai trò mô phỏng để kiểm tra trải nghiệm. Đây không phải hệ thống xác thực hoặc cách ly tenant thật. Chi tiết triển khai và tiêu chí nghiệm thu nằm tại 03_Engineering/Tenant_Theme_Specification.html.


## Bằng chứng trưởng thành và migration gate
D04 yêu cầu source inventory và mapping từng trường; mapping_source_template chưa điền là đầu vào mở. Theo dõi coverage owner, glossary, certified metrics, lineage và DQ; missing evidence vẫn NotAssessed. Mỗi gate lưu dataset hash, reconcile count/totals/FK/files và exception signed. Không đưa dữ liệu quarantine vào dashboard certified. Readiness của bộ thiết kế khác maturity vận hành; signoff Data Owner, Security và Ops cần test trên hệ thống thực.

Tài liệu điều phối: 09_Ke_hoach_trien_khai; 10_Ke_hoach_kiem_thu_va_chuyen_doi; 03_Engineering/Implementation_Backlog.html; 03_Engineering/Test_Case_Catalogue.html; 03_Engineering/Decision_Register.html.

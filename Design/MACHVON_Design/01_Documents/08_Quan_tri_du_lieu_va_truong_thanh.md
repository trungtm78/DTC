# Hệ Thống Lý Dự Án Đầu Tư Công quản trị dữ liệu và trưởng thành sản phẩm
Baseline 1.4 | 22/10/2026 | Phạm vi 25 phân hệ; danh mục màn hình theo `screen_catalog.json` (327 màn hình baseline 1.3 gồm 261 web và 66 mobile giữ nguyên mã, cộng màn hình mới của baseline 1.4). Đánh giá hiện trạng là đánh giá khả năng quan sát từ tài liệu, không thay kiểm định CSDL thật. (Cập nhật 1.4 — CR-DGM-00)

(Bổ sung 1.4 — CR-DGM-00) Quy ước baseline 1.4: đoạn không có nhãn là nguyên văn baseline 1.3 và vẫn đúng; "(Cập nhật 1.4 — CR-DGM-nn)" là đoạn baseline được sửa; "(Bổ sung 1.4 — CR-DGM-nn)" là nội dung mới; đoạn bị bỏ được liệt kê ở "Phụ lục: ánh xạ nội dung baseline 1.3". Nguồn chi tiết: `05_modules/MDM.md` (master data, crosswalk, glossary) và `05_modules/DGV.md` (data contract, chất lượng, lineage, trưởng thành — chưa phát hành khi viết; khi phát hành, đặc tả DGV thắng về chi tiết và tài liệu này giữ vai trò chính sách).

(Bổ sung 1.4 — CR-DGM-01) **Thuật ngữ thống nhất: NotAssessed.** Trong quản trị dữ liệu chỉ dùng một trạng thái cho "chưa có bằng chứng hoặc chưa được đánh giá": **NotAssessed** (mã API `NOT_ASSESSED`, nhãn giao diện "Chưa đánh giá"). Áp dụng cho điểm trưởng thành thiếu bằng chứng, dataset chưa có quality run (badge chất lượng ở HOME/BI) và tiêu chí chưa đo. NotAssessed không phải 0, không phải mức 1, không vào mẫu số trung bình và không được coi là đạt. Từ "Unknown" của baseline 1.3 trong ngữ cảnh này được thay bằng NotAssessed; "Unknown/UNKNOWN" chỉ còn dùng cho kết quả giao tin chưa xác định (NOT) và lệnh mobile chưa biết kết quả (MOB). Giá trị số thiếu dùng nhãn "Chưa có dữ liệu" hoặc "Chưa có cơ sở tính" (DIS), cũng không đổi thành 0.

## Nguyên tắc toàn vẹn dữ liệu
Một hệ thống đầy đủ cần hơn danh sách màn hình. Mỗi năng lực phải có dữ liệu đầu vào, người chịu trách nhiệm, nguồn sự thật, grain, quan hệ, quy tắc kiểm tra, vòng đời, quyền và bằng chứng. Ma trận coverage nối yêu cầu → màn hình → data domain → service/API → validation → test. Khoảng trống được ghi nhận và có owner đóng, không được lấp bằng dữ liệu giả hoặc suy đoán không gắn nhãn.

Ba nhóm dữ liệu: master/reference (tổ chức, địa bàn, nguồn, chương trình, kỳ, loại hồ sơ); transactional/evidence (quyết định, phân bổ, báo cáo revision, giao dịch, chứng từ, hội thoại, license); derived/analytical (chỉ tiêu, snapshot BI, scoring hỗ trợ, quality score, cost projection). Dữ liệu derived phải dựng lại được hoặc có snapshot nguồn và version logic; không dùng kết quả LLM làm master fact chưa kiểm chứng.

(Bổ sung 1.4 — CR-DGM-02) Phân loại dữ liệu là thuộc tính bắt buộc của mọi dataset và trường nhạy cảm: PUBLIC, INTERNAL, CONFIDENTIAL, PERSONAL, IMPORTANT_CORE. Phân loại quyết định che dữ liệu trong DTO/export, đồng bộ mobile, retention và tuyến AI. Dữ liệu cá nhân (hộ dân GPMB, CCCD, liên hệ OMNI, vị trí thiết bị) theo Luật BVDLCN 91/2025 và NĐ 356/2025: consent theo mục đích, quyền chủ thể dữ liệu do Data Protection Officer xử lý, ngoại lệ do nghĩa vụ lưu trữ và legal hold được ghi rõ [CXN]. Dữ liệu và bản sao lưu lưu tại Việt Nam (D-B03; Luật Dữ liệu 60/2024 và NĐ 165/2025 [CXN-13]).

## Bản đồ domain và chủ sở hữu
Tổ chức/danh tính do tenant owner và IAM steward quản; nguồn vốn/kế hoạch do đầu mối tài chính; dự án/tiến độ do chủ đầu tư; report accepted do bộ phận tổng hợp; actual Kho bạc do kế toán đối soát; đề án/tiêu chí do bên mời thầu/tổ chuyên gia; tài liệu do document controller; metric/BI do data owner chỉ tiêu; notification/consent do communication owner; model/AI do AI governance; usage/cost do FinOps; SaaS/license do commercial owner; audit/security do bộ phận an toàn và kiểm toán độc lập.

(Bổ sung 1.4 — CR-DGM-03) Domain của phân hệ mới: văn bản, sổ đăng ký số và hồ sơ lưu trữ (DOC) do văn thư/đơn vị lưu trữ; thửa đất, hộ bị ảnh hưởng, phương án và chi trả GPMB (LND) do tổ chức làm nhiệm vụ bồi thường, dữ liệu cá nhân dưới giám sát của Data Protection Officer; giấy phép và hồ sơ pháp lý (PMT) do chủ đầu tư; nhật ký thi công và nghiệm thu chất lượng (QMS) do chủ đầu tư/tư vấn giám sát; kết luận và kiến nghị thanh tra, kiểm toán (AUD) do đầu mối theo dõi thanh tra; tài sản bàn giao và bảo hành (AST) do đơn vị tiếp nhận; báo cáo giám sát đánh giá (MNE) do cơ quan tổng hợp. Tên vai trò theo bảng "Thuật ngữ vai trò" của `04_Thiet_ke_co_ban.md` (Data Owner, Data Steward, Data Protection Officer, Tenant Owner, Billing Admin…).

RACI: owner chịu trách nhiệm định nghĩa/chấp nhận chất lượng; steward vận hành danh mục và xử lý lỗi; producer tạo dữ liệu; consumer dùng đúng contract; custodian vận hành kỹ thuật; approver chấp nhận thay đổi trọng yếu. Một tài khoản không nên vừa sửa master tài chính vừa tự phê duyệt điều chỉnh số liệu phát sinh từ master đó.

## Master data đầy đủ và hiệu lực theo thời gian
MDM-01..33 bao phủ trung tâm danh mục, địa bàn/sáp nhập, cơ quan/chủ đầu tư, nguồn vốn, CTMTQG, lĩnh vực, nhóm/loại/giai đoạn dự án, thẩm quyền/quyết định, kỳ, đơn vị tính, tiền tệ, loại hồ sơ, hợp đồng, thanh toán, Kho bạc, vướng mắc/SLA, tiêu chí thầu, chuyên môn, sự kiện/mục đích liên hệ, ngôn ngữ, classification, mapping mã, CRUD, impact, version, import, merge, deactivate và publish.

MasterRecord identity gồm tenant_scope + master_type + code; code đã phát hành không tái sử dụng cho ý nghĩa khác. Version có valid_from/until và recorded_at để phân biệt ngày nghiệp vụ với ngày nhập. Mã đổi tên vẫn cùng identity; sáp nhập tổ chức có predecessor/successor mapping. Global baseline do platform quản; tenant extension riêng, không ghi đè khóa chuẩn làm sai tích hợp. Tenant override chỉ với trường được policy cho phép.

Trước ngừng dùng: kiểm số hồ sơ tham chiếu, source mapping, workflow và metric bị ảnh hưởng; tạo effective end, không xóa FK. Merge cần preview bản ghi và nguồn, golden record, mapping redirect, audit và phương án đảo trước khi commit. Không tự merge nhà thầu chỉ dựa tên gần giống; ưu tiên mã số thuế định danh đã xác minh và kiểm tra pháp lý.

(Bổ sung 1.4 — CR-DGM-04) Baseline 1.4 mở rộng MDM tới MDM-37 (`05_modules/MDM.md`): crosswalk mã ngoài (Kho bạc, mã dự án TTQG, muasamcong) với đúng một crosswalk ACTIVE mỗi mã ngoài; merge theo survivorship từng thuộc tính và unmerge đảo được (không unmerge hai lần); baseline cải cách tổ chức 2025 (tỉnh/xã, đơn vị kế thừa) do platform phát hành, tenant chỉ alias, không ghi đè [CXN-34]. **Glossary nghiệp vụ được quản lý trong MDM** (`glossary_term`: đề xuất → duyệt bởi người khác → PUBLISHED, một bản PUBLISHED mỗi mã); DGV, BI và chỉ tiêu DIS tham chiếu thuật ngữ đã công bố, không giữ glossary riêng. Định nghĩa kỳ/YTD/lũy kế là thuật ngữ thuộc domain giải ngân, CHỜ KÝ D03.

## Data contract và quản lý schema
Mỗi dataset công bố producer/consumer, business purpose, grain, key, schema/version, required/null semantics, currency/unit, timestamps, classification, owner, update frequency, SLO freshness, validation, dedupe key, reconciliation totals, lineage và retention. Schema backward-compatible thêm optional field; thay nghĩa/đơn vị/grain phải version mới và dual-run. Contract registry chặn publish thay đổi breaking chưa được consumers chấp nhận.

(Bổ sung 1.4 — CR-DGM-05) Data contract là dữ liệu có version theo cấu trúc Open Data Contract Standard (ODCS): phần cơ bản (dataset, domain, owner, trạng thái), schema (trường, kiểu, null semantics, đơn vị, phân loại), quy tắc chất lượng (gắn DQ rule), SLA (freshness, completeness), consumer và điều khoản thay đổi. Contract ở trạng thái DRAFT → PUBLISHED → DEPRECATED; thay đổi breaking tạo version mới và cần consumer chấp thuận (AC50). Contract của luồng tài chính (DIS, CAP, PAY) là hạng mục bắt buộc người duyệt (R2).

Import pipeline: Receive → malware/type check → raw immutable → parse → mapping → validate → quarantine/ready → dry-run impact → approval → transaction load → reconcile → publish. Mỗi batch có checksum file, schema version, số dòng nhận/hợp lệ/lỗi/ghi và tổng tiền trước/sau. Quarantine không tính vào báo cáo chính thức. Reprocess dùng cùng business key để không trùng số.

## Chất lượng dữ liệu và điểm đo
Completeness: required_present/required_expected trên đúng scope, null “không áp dụng” không coi là thiếu nếu contract quy định. Validity: số bản ghi qua rule/type/domain/temporal; uniqueness: key collision count; consistency: CTMTQG≤parent, dates/relations hợp lệ; timeliness: age so với SLA; accuracy: cần đối chiếu nguồn xác nhận hoặc lấy mẫu chuyên gia, không suy từ việc field có giá trị. Integrity: FK/orphan/cross-tenant references phải 0.

Mục tiêu đề xuất cho dữ liệu tài chính trọng yếu: required completeness 100%, FK/key validity 100%, duplicate transaction 0, sai lệch tổng ngoài tolerance đã duyệt 0. Với OCR/ngoại vi, low-confidence và missing field phải vào review, không ép đạt 100% bằng tự điền. Quality score tổng hợp có trọng số theo criticality; một lỗi cross-tenant hoặc sai tổng trọng yếu là hard fail dù điểm trung bình cao.

Quality incident lưu rule, affected rows reference, impact, owner, severity, SLA, root cause, remediation và verification. Sửa upstream ưu tiên hơn chỉnh projection BI. Khi dữ liệu không đạt certification, dashboard có badge provisional/stale/failed; không công bố như số đã chốt. Exception có ngày hết hạn, người duyệt và lý do; không dùng exception vĩnh viễn để che lỗi.

(Bổ sung 1.4 — CR-DGM-06) Chuỗi chất lượng: DQ rule (gắn contract, có version, mức hard-block hoặc warning) → DQ result của mỗi quality run (đóng dấu snapshot) → DQ incident khi vi phạm, có assignee, severity, hạn, nguyên nhân, khắc phục và bước xác minh; incident trùng của cùng rule và cùng đối tượng gộp vào một incident mở. Badge chất lượng dataset gồm certified, provisional, stale, failed và NotAssessed (chưa có quality run). Sự kiện incident đi qua outbox tới NOT để nhắc owner; cảnh báo vận hành về incident đi kênh vận hành độc lập.

## Maturity model đề xuất
Tham chiếu khung CMMI Data Management Maturity (DMM) và DCAM của EDM Council về năng lực quản trị dữ liệu, NIST AI RMF về Govern/Map/Measure/Manage và FinOps về trách nhiệm chi phí. Thang 1–5 dưới đây là rubric riêng cho dự án, ánh xạ khái niệm từ DMM/DCAM, không phải chứng nhận DMM/DCAM/NIST: L1 ad hoc; L2 có tài liệu và người chịu trách nhiệm cục bộ; L3 tiêu chuẩn hóa và thực thi toàn tenant; L4 đo/giám sát/tự động kiểm soát; L5 tối ưu liên tục dựa trên bằng chứng và value. (Cập nhật 1.4 — CR-DGM-07)

Tám trụ cột: governance/ownership; master/metadata; quality; integration; security/privacy; lineage/BI; AI readiness/governance; cost/value operations. Điểm chỉ chốt khi có artifact, log, phỏng vấn và kiểm thử, kèm người đánh giá/ngày/sample/confidence. “Chưa có bằng chứng” là NotAssessed, không tự cho 0 hoặc 1 và không coi là đã đạt. (Cập nhật 1.4 — CR-DGM-01)

(Bổ sung 1.4 — CR-DGM-07) Mỗi đánh giá (MaturityAssessment) có kỳ đánh giá, phạm vi tenant/domain, tiêu chí từng mức cho từng trụ cột, liên kết bằng chứng (EvidenceItem: loại, nguồn, ngày, người cung cấp, hash tệp), người đánh giá khác người cung cấp bằng chứng, và hành động khắc phục có owner. Chỉ tính điểm tổng khi coverage bằng chứng đạt ngưỡng được phê duyệt; công bố kèm coverage, trọng số và danh sách trụ cột NotAssessed.

Hiện trạng quan sát: biểu mẫu có các nhóm nguồn và kỳ (bằng chứng cấu trúc thu thập); có trạng thái lưu/gửi và menu theo dõi (bằng chứng luồng); chưa có bằng chứng đủ về master versioning, audit immutable, RLS, data contracts, semantic layer, lineage, quality profiling, AI governance hay FinOps. Vì vậy chưa thể chấm một điểm maturity tổng thể cho hệ thống cũ. Ngay cả tỷ lệ/giá trị khác nhau trong clip cần dữ liệu nguồn và định nghĩa để kết luận đúng/sai.

Mục tiêu tại cổng ra R1 (trước pilot): L3 cho governance/master/security, L2→L3 cho quality/integration/lineage; tại cổng ra R3/rollout R4 (trước SaaS scale): L4 cho tenant security, license, usage/cost và critical quality; tại cổng vào AI production ở R3 (trước đưa AI vào đánh giá thật): L3 trở lên về hồ sơ/criteria/evidence, L4 về evaluation và giám sát rủi ro. L5 là mục tiêu vận hành dài hạn, không đạt chỉ bằng tài liệu thiết kế. (Cập nhật 1.4 — CR-DGM-08)

## Lưu trữ, legal hold và định tuyến AI theo phân loại
(Bổ sung 1.4 — CR-DGM-09) **Retention là dữ liệu.** Mỗi loại hồ sơ có RetentionPolicy (thời hạn, căn cứ pháp lý, mốc tính, hành động khi hết hạn: lưu trữ lịch sử, ẩn danh, đề nghị hủy qua hội đồng) có version và hiệu lực; thời hạn theo Luật Lưu trữ 33/2024, NĐ 113/2025 và các thông tư thời hạn lưu trữ (TT 74/2025/TT-BTC, TT 10/2022/TT-BNV, TT 08/2025/TT-BNV) là [CXN-05]. Job retention chỉ chạy khi hết hạn và không có legal hold; mọi xóa/hủy có biên bản (NFR-RETENTION-01).

(Bổ sung 1.4 — CR-DGM-09) **Legal hold là dữ liệu.** Legal hold (ADM) có nguồn (thanh tra, kiểm toán, khiếu nại GPMB, yêu cầu cơ quan có thẩm quyền), phạm vi (tenant, đơn vị, dự án, hồ sơ), người đặt, lý do và ngày gỡ có lý do. Đối tượng dưới hold không bị xóa, tiêu hủy, ẩn danh hay purge bởi job retention, yêu cầu của chủ thể dữ liệu, offboarding tenant hay xóa nguồn sau chuyển silo (NFR-RETENTION-02, AC-ADM-09, BR-SAS-03). Lineage và export ghi trạng thái hold.

(Bổ sung 1.4 — CR-DGM-10) **Định tuyến AI theo phân loại dữ liệu (R5).** Mỗi yêu cầu AI mang `data_classification` do server xác định từ nguồn dữ liệu đưa vào prompt (lấy mức cao nhất), không do client khai. PUBLIC hoặc đã ẩn danh: được tới model quốc tế chỉ khi D07 duyệt và tenant bật; INTERNAL, CONFIDENTIAL, PERSONAL, IMPORTANT_CORE: chỉ tới model trong nước hoặc tự host trên cloud nội địa qua gateway LiteLLM. Không có tuyến hợp lệ → từ chối `AI_ROUTE_NOT_ALLOWED`, không hạ phân loại. Audit ghi tuyến đã dùng; bộ eval chạy trên mọi tuyến sẽ dùng trước khi bật profile; kết quả AI không thành master fact khi chưa kiểm chứng. Trace AI che dữ liệu cá nhân và lưu tại Việt Nam.

## Lộ trình trưởng thành và bằng chứng thoát giai đoạn
Lộ trình gắn với release R0–R4 của `09_Ke_hoach_trien_khai.md` thay cho mốc ngày cố định 0–30/31–60/61–90 ngày của baseline 1.3 (mốc ngày mâu thuẫn với lịch tính theo giờ review của kế hoạch; riêng kiểm thử cách ly tenant không thể chờ tới "61–90 ngày" vì là cổng ra R0). R0: inventory, owner, khung glossary trong MDM, phân loại dataset, xác định CDE, dịch vụ legal hold và RetentionPolicy, kiểm thử cách ly tenant trên API/DB/cache/tìm kiếm/file/export/sync. Bằng chứng: data catalogue được ký, phân loại dữ liệu, gap register, kết quả test cách ly. R1: chuẩn hóa master, contract/schema, validation/quarantine, import idempotent và reconcile tự động, profile dữ liệu được phép truy cập và baseline defects. Bằng chứng: hai chu kỳ nhập không trùng, totals khớp, xử lý orphan và history. R2: semantic metrics, lineage, quality SLO và DQ incident, đánh giá trưởng thành lần đầu có bằng chứng, diễn tập DR. Bằng chứng: KPI truy tới source và kiểm thử export/search/cache. (Cập nhật 1.4 — CR-DGM-11)

R3 (khi D05–D07 có hợp đồng): mở AI eval dataset, model/profile review, định tuyến theo phân loại, cost reservation/invoice reconciliation, notification consent/retry và SaaS meter audit. R4: đánh giá trưởng thành trước go-live/rollout, migration gate và evidence pack đầy đủ. Các mốc là kế hoạch đề xuất phụ thuộc đội và dữ liệu, không phải cam kết hoàn tất; lịch thực tế tính theo giờ review của người (R2). Mỗi giai đoạn có owner, chi phí, dependency và gate; không đưa AI scoring production trước khi nguồn/tiêu chí đủ trưởng thành. (Cập nhật 1.4 — CR-DGM-11)

## Rubric mục tiêu sản phẩm 9 đến 10 điểm
Trọng số đề xuất: nghiệp vụ vốn/kiểm soát tài chính 20%; quản trị/chất lượng dữ liệu 15%; BI/drill-down 10%; SaaS/license 10%; AI có bằng chứng và FinOps 10%; đa kênh/notification 10%; UX/mobile/accessibility 10%; security/operations/integration 15%. Mỗi nhóm chấm 0–10 theo bằng chứng: 0 chưa có; 3 tài liệu; 5 prototype; 7 triển khai có tests; 9 pilot đạt SLO/UX và audit; 10 vận hành nhiều khách hàng có benchmark bền vững.

Score = SUM(weight × verified_group_score). Chưa chấm điểm sản phẩm hiện tại vì mới là bộ thiết kế/prototype, chưa có pilot và audit production. Để mục tiêu tổng ≥9, mọi nhóm trọng yếu phải ≥8, không có blocker sai số tài chính/cross-tenant/mất dữ liệu/quyết định AI không kiểm chứng. Một nhóm security fail chặn ra mắt bất kể tổng điểm. Đánh giá thị trường còn cần RFP, demo đối chứng, TCO, khả năng triển khai và phản hồi người dùng, không suy từ marketing của đối thủ.

## Danh mục bằng chứng và nguồn nghiên cứu
Evidence pack cần có: glossary/owner signoff, schema/contracts, profiling report, DQ incidents, sample reconciliation, tenant penetration test, restore drill, SLO dashboard, LLM eval & invoice reconciliation, notification provider callback test, UX task completion/SUS và commercial billing reconciliation. Danh mục thiết kế/ảnh không thay thế các bằng chứng vận hành này.

Nguồn chính thức: EDM Council frameworks https://edmcouncil.org/frameworks/ ; NIST AI RMF https://airc.nist.gov/airmf-resources/airmf/5-sec-core/ ; FinOps Framework https://www.finops.org/framework/ ; Unit economics https://www.finops.org/framework/capabilities/unit-economics/ . Các khung tham chiếu hỗ trợ thiết kế, không tuyên bố sản phẩm được chứng nhận bởi các tổ chức này.

(Bổ sung 1.4 — CR-DGM-07) Nguồn bổ sung theo nghiên cứu thị trường của plan (URL lưu trong `03_Engineering/Market_Research.html`): CMMI Data Management Maturity (DMM), Open Data Contract Standard (ODCS), các nền tảng MDM/catalog tham chiếu (Reltio, Atlan, OpenMetadata, Collibra). Chỉ dùng làm tham chiếu khái niệm.

## Bằng chứng trưởng thành và migration gate
D04 yêu cầu source inventory và mapping từng trường; mapping_source_template chưa điền là đầu vào mở. Theo dõi coverage owner, glossary, certified metrics, lineage và DQ; missing evidence vẫn NotAssessed. Mỗi gate lưu dataset hash, reconcile count/totals/FK/files và exception signed. Không đưa dữ liệu quarantine vào dashboard certified. Readiness của bộ thiết kế khác maturity vận hành; signoff Data Owner, Security và Ops cần test trên hệ thống thực.

## Theme & thương hiệu theo tenant — SAS-04
(Cập nhật 1.4 — CR-DGM-12) Khối đặc tả SAS-04 dán lặp của baseline 1.3 được thay bằng con trỏ: `03_Engineering/Tenant_Theme_Specification.html` và `05_modules/SAS.md`. Về quản trị dữ liệu, theme là dữ liệu cấu hình có phiên bản bất biến, chỉ System Admin ghi, có audit trước/sau.

Tài liệu điều phối: 05_modules/MDM.md; 05_modules/DGV.md (khi phát hành); 04_Thiet_ke_co_ban; 09_Ke_hoach_trien_khai; 10_Ke_hoach_kiem_thu_va_chuyen_doi; 03_Engineering/nonfunctional_requirements.json; 03_Engineering/Implementation_Backlog.html; 03_Engineering/Test_Case_Catalogue.html; 03_Engineering/Decision_Register.html. (Cập nhật 1.4 — CR-DGM-00)

## Danh sách CR của tài liệu 08 baseline 1.4
| CR | Nội dung | Nguồn quyết định |
|---|---|---|
| CR-DGM-00 | Header, quy ước, nguồn chi tiết MDM/DGV, tài liệu điều phối | Plan 22/10 |
| CR-DGM-01 | NotAssessed là thuật ngữ duy nhất; Unknown chỉ cho giao tin/lệnh mobile | O11, HOME.md CR-HOME-01 |
| CR-DGM-02 | Phân loại dữ liệu bắt buộc, dữ liệu cá nhân, lưu tại Việt Nam | D-B03, R5, Luật BVDLCN |
| CR-DGM-03 | Domain và owner của 7 phân hệ mới; tên vai trò chuẩn | D-B09, tài liệu 04 |
| CR-DGM-04 | MDM-37, crosswalk, merge/unmerge, glossary quản lý trong MDM | MDM.md, plan research |
| CR-DGM-05 | Data contract theo ODCS | Plan research MDM/DGV |
| CR-DGM-06 | Chuỗi DQ rule → result → incident | Plan research MDM/DGV |
| CR-DGM-07 | Maturity theo DMM/DCAM có bằng chứng | Plan research |
| CR-DGM-08 | Mục tiêu trưởng thành gắn cổng release | Tài liệu 09 |
| CR-DGM-09 | Retention và legal hold là dữ liệu | R4, NFR-RETENTION-01/02, ADM.md |
| CR-DGM-10 | Định tuyến AI theo phân loại dữ liệu | R5 |
| CR-DGM-11 | Lộ trình theo R0–R4 thay mốc 0–30/31–60/61–90 ngày | Tài liệu 09, CR-BRD-02 |
| CR-DGM-12 | Bỏ khối SAS-04 dán lặp, thay con trỏ | O11 |

## Phụ lục: ánh xạ nội dung baseline 1.3
| Đoạn baseline 1.3 bị bỏ | Nội dung nay nằm ở |
|---|---|
| SAS-04 đoạn 1 (chỉ System Admin cấu hình thương hiệu; Tenant Admin chỉ đọc) | Mục SAS-04 (con trỏ) của tài liệu này; `Tenant_Theme_Specification.html` |
| SAS-04 đoạn 2 (nháp tách tenant, review, phiên bản bất biến, tương phản) | `Tenant_Theme_Specification.html`; `05_modules/SAS.md` §3.12 |
| SAS-04 đoạn 3 (server xác thực System Admin, 403/409/422, audit) | `Tenant_Theme_Specification.html`; `05_modules/SAS.md` BR-SAS-17 |
| SAS-04 đoạn 4 (prototype localStorage, không phải xác thực thật) | `Tenant_Theme_Specification.html` |
| "## Maturity model đề xuất Tham chiếu tư duy DCAM về năng lực" (đoạn baseline) | Mục "Maturity model đề xuất": khung DMM/DCAM và NotAssessed (CR-DGM-07, CR-DGM-01) |
| "Mục tiêu trước pilot: L3 cho governance/master/security, L2→" (đoạn baseline) | Mục "Maturity model đề xuất", đoạn mục tiêu gắn cổng ra R1/R3/R4 (CR-DGM-08) |
| "## Lộ trình trưởng thành và bằng chứng thoát giai đoạn 0–30 " (đoạn baseline) | Mục "Lộ trình trưởng thành và bằng chứng thoát giai đoạn", đoạn R0/R1/R2 thay mốc 0–30/31–60/61–90 ngày (CR-DGM-11) |
| "Sau 90 ngày tùy tiến độ triển khai: mở AI eval dataset, mode" (đoạn baseline) | Mục "Lộ trình trưởng thành…", đoạn R3/R4 thay mốc "sau 90 ngày" (CR-DGM-11) |
| "Chỉ System Admin được cấu hình thương hiệu cho các tenant: m" (đoạn baseline) | Mục SAS-04 (con trỏ); `Tenant_Theme_Specification.html` |
| "Bản nháp tách biệt theo tenant và không thay đổi giao diện đ" (đoạn baseline) | `Tenant_Theme_Specification.html`; `05_modules/SAS.md` §3.12 |
| "Server phải xác thực System Admin cho mọi lệnh ghi; không ti" (đoạn baseline) | `Tenant_Theme_Specification.html`; `05_modules/SAS.md` BR-SAS-17 |
| "Prototype SAS-04 dùng localStorage và bộ chọn vai trò mô phỏ" (đoạn baseline) | `Tenant_Theme_Specification.html` |
| "Tài liệu điều phối: 09_Ke_hoach_trien_khai; 10_Ke_hoach_kiem" (đoạn baseline) | Dòng "Tài liệu điều phối" cuối tài liệu (thêm 04, NFR, MOB/MDM/DGV, CR-…-00) |

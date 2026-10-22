# Hệ Thống Lý Dự Án Đầu Tư Công thiết kế chi tiết
(Cập nhật 1.4 — CR-05-01) Baseline 1.4 | 22/10/2026. Tài liệu này mô tả quy ước thực thi dùng chung cho mọi phân hệ và các thuật toán trọng yếu cắt ngang. Các tệp OpenAPI/SQL đi kèm là baseline kỹ thuật cần mở rộng trong sprint, không phải backend đã hoàn thành.

(Cập nhật 1.4 — CR-05-02) Vị trí của tài liệu. Từ baseline 1.4, chi tiết riêng của từng phân hệ (actor, luồng, state machine, quy tắc `BR-<MÃ>-NN`, bảng, command, màn hình, test, AC) nằm trong `05_modules/<MÃ>.md` theo khung `05_modules/_KHUNG_DAC_TA.md`. Tài liệu này chỉ giữ phần dùng chung: quy ước dữ liệu, tenant và RLS, thuật toán tổng hợp, giao dịch và đồng thời, API, lỗi, idempotency, If-Match, điều phối, sổ cái tiền, ký số, quy tắc pháp lý dạng dữ liệu, AI, thông báo, SaaS, drill, đồng bộ mobile, kiểm thử và quan sát. Thứ tự thẩm quyền: `04_Thiet_ke_co_ban.md` thắng về kiến trúc (tenant, ranh giới module, stack, RLS, đồng bộ, điều phối, tích hợp, hosting); tài liệu này thắng về quy ước chung; đặc tả phân hệ thắng về chi tiết nghiệp vụ của phân hệ đó. Mâu thuẫn được ghi CR. Đoạn baseline 1.3 bị sửa hoặc bỏ được chép nguyên văn ở phụ lục cuối tài liệu. [CXN-nn] là căn cứ pháp lý chờ xác nhận (R4); [GIẢ ĐỊNH] là lựa chọn theo D-B04 chờ đo hoặc chốt.

## Chỉ mục 25 phân hệ
(Cập nhật 1.4 — CR-05-03) Bảng sinh từ `03_Engineering/screen_catalog.json` và thư mục `05_modules` ngày 22/10/2026. 18 phân hệ có từ baseline 1.3, 7 phân hệ mới theo D-B09 (DOC, LND, PMT, QMS, AUD, AST, MNE). Phân hệ chưa có màn hình trong catalogue nhận ID mới theo đuôi tiếp (D-B11, R10). Lớp và phụ thuộc theo đồ thị ở `04_Thiet_ke_co_ban.md` mục Bản đồ module. Owner kỹ thuật là đề xuất (kế thừa Module_Implementation_Contracts v1.3); vai trò nghiệp vụ là người duyệt hạng mục bắt buộc theo R2.

| Mã | Tên | Lớp | Mục đích | Đặc tả | Màn hình (đo từ screen_catalog.json) | Owner kỹ thuật / vai trò nghiệp vụ duyệt |
|---|---|---|---|---|---|---|
| IAM | Truy cập và cá nhân | L1 | Định danh, phiên, MFA, consent, mô hình tenant R6 và thuật toán quyền hiệu lực | [IAM.md](05_modules/IAM.md) | IAM-01 … IAM-09 (9 web) | Identity/Security / Security Officer + DPO |
| SAS | SaaS và tenant (control plane) | L1 | Vòng đời tenant, placement, gói, subscription, entitlement, license, hóa đơn, theme SAS-04 | [SAS.md](05_modules/SAS.md) | SAS-01 … SAS-25 (25 web) | Platform/Backend / Product/Commercial + System Admin |
| LLM | Quản trị AI và LLM | L1 | Registry model, profile, prompt, ngân sách AI, định tuyến theo data_classification (R5), eval | [LLM.md](05_modules/LLM.md) | LLM-01 … LLM-21 (21 web) | AI/FinOps / AI Lead + Security |
| ADM | Quản trị tenant | L1 | Cây đơn vị, membership, role grant, ủy quyền, DoA matrix, workflow_version, dịch vụ nền tảng | [ADM.md](05_modules/ADM.md) | ADM-01 … ADM-18 (18 web) | Platform/Backend / Tenant Admin + Chủ nghiệp vụ vốn (DoA) |
| MDM | Master data | L1 | Bản ghi chủ có hiệu lực, crosswalk, merge/unmerge, kế thừa đơn vị, glossary | [MDM.md](05_modules/MDM.md) | MDM-01 … MDM-37 (37 web) | Data/Backend / Data Owner / Data Steward |
| DGV | Quản trị và trưởng thành dữ liệu | L1 | Data contract, DQ rule/result/incident, glossary duyệt, đánh giá trưởng thành có evidence | [DGV.md](05_modules/DGV.md) | DGV-01 … DGV-21 (21 web) | Data / Data Owner |
| DOC (mới) | Văn bản và báo cáo theo chuẩn nhà nước | L2 | Mẫu văn bản có legal_basis, sổ cấp số, ký số PAdES + cấp số + ký cơ quan (R8), văn bản đến, hồ sơ lưu trữ | [DOC.md](05_modules/DOC.md) | DOC-01 … DOC-23 (21 web, 2 mobile) | Core/Integration / Văn thư + Pháp chế |
| PRJ | Danh mục dự án | L2 | Vòng đời PIMA, thẩm định, mã dự án TTQG, trách nhiệm giải ngân, giải trình, rủi ro | [PRJ.md](05_modules/PRJ.md) | PRJ-01 … PRJ-21 (21 web) | Core/Backend / Chủ nghiệp vụ vốn |
| CAP | Kế hoạch và nguồn vốn | L3 | FundSource → Appropriation → AllocationLine, sổ cái vốn, AVC, earmark, điều chuyển | [CAP.md](05_modules/CAP.md) | CAP-01 … CAP-21 (21 web) | Core/Backend / Chủ nghiệp vụ vốn |
| PMT (mới) | Hồ sơ pháp lý và giấy phép | L3 | Hồ sơ giấy phép (ĐTM/GPMT, PCCC, GPXD…), mốc, hạn hiệu lực, cảnh báo | [PMT.md](05_modules/PMT.md) | PMT-01 … PMT-06 (6 web) | Core/Backend / Ban QLDA + Pháp chế |
| ISS | Vướng mắc và hiện trường | L3 | Vướng mắc, phân công, SLA, giải quyết, chuyến hiện trường | [ISS.md](05_modules/ISS.md) | ISS-01 … ISS-11 (11 web) | Core/Mobile / Ban QLDA |
| BID | Nhà thầu và phân tích AI | L3 | Gói thầu, hồ sơ dự thầu, phân tích AI có bằng chứng, đánh giá nhà thầu | [BID.md](05_modules/BID.md) | BID-01 … BID-21 (21 web) | AI/Core / Tổ chuyên gia |
| LND (mới) | GPMB, bồi thường, tái định cư | L3 | Thửa đất, hộ bị ảnh hưởng (dữ liệu cá nhân), phương án, chi trả, khiếu nại | [LND.md](05_modules/LND.md) | LND-01 … LND-13 (13 web) | Core/Backend / Ban QLDA + DPO |
| CTR | Hợp đồng và thực hiện | L3 | Hợp đồng có phiên bản, BOQ, ChangeEvent → PCO → CO, nghiệm thu khối lượng, bảo lãnh, giữ lại | [CTR.md](05_modules/CTR.md) | CTR-01 … CTR-26 (26 web) | Core/Backend / Chủ đầu tư/Ban QLDA |
| QMS (mới) | Chất lượng, nhật ký thi công, nghiệm thu | L4 | Nhật ký thi công điện tử, kiểm tra, nghiệm thu chất lượng, ảnh geotag | [QMS.md](05_modules/QMS.md) | QMS-01 … QMS-11 (9 web, 2 mobile) | Core/Mobile / Tư vấn giám sát + Ban QLDA |
| PAY | Thanh toán và Kho bạc | L4 | Đề nghị thanh toán/tạm ứng, sổ lũy kế R7, hồ sơ Kho bạc, đối soát sao kê, quyết toán | [PAY.md](05_modules/PAY.md) | PAY-01 … PAY-17 (17 web) | Core/Integration / Kế toán trưởng |
| DIS | Báo cáo giải ngân | L5 | Kỳ báo cáo, revision, 6 ô nguồn + CTMTQG, hai tỷ lệ giải ngân, PeriodSnapshot, cảnh báo sớm | [DIS.md](05_modules/DIS.md) | DIS-01 … DIS-25 (25 web) | Core/Backend / Chủ nghiệp vụ vốn |
| MNE (mới) | Giám sát, đánh giá đầu tư | L5 | Báo cáo giám sát pháp định từ PeriodSnapshot, lịch nghĩa vụ, đánh giá đầu tư | [MNE.md](05_modules/MNE.md) | MNE-01 … MNE-10 (10 web) | Core/BI / Chủ nghiệp vụ vốn |
| AUD (mới) | Thanh tra, kiểm toán | L5 | Cuộc thanh tra/kiểm toán, kết luận, kiến nghị, theo dõi khắc phục | [AUD.md](05_modules/AUD.md) | AUD-01 … AUD-11 (11 web) | Core/Backend / Auditor + Pháp chế |
| AST (mới) | Bàn giao tài sản và bảo hành | L5 | Bàn giao tài sản hình thành sau đầu tư, nghĩa vụ bảo hành | [AST.md](05_modules/AST.md) | AST-01 … AST-07 (7 web) | Core/Backend / Chủ đầu tư + Kế toán |
| BI | BI và dashboard động | L6 | Metric as code có version, dataset, dashboard, query context, export | [BI.md](05_modules/BI.md) | BI-01 … BI-18 (18 web) | Data/Web / Data Owner |
| HOME | Điều hành | L6 | Trung tâm điều hành giải ngân: tổng quan, cảnh báo, xếp hạng, truy nguồn số liệu | [HOME.md](05_modules/HOME.md) | HOME-01 … HOME-10 (10 web) | Web/BI / Lãnh đạo UBND/Sở |
| NOT | Notification Center | L6 | Sự kiện → luồng → đồng ý → gửi đa kênh, dedupe, retry, digest | [NOT.md](05_modules/NOT.md) | NOT-01 … NOT-17 (17 web) | Integration / DPO + Tenant Admin |
| OMNI | Tương tác đa kênh | L6 | Hộp thư Zalo OA/WhatsApp/email theo tenant, phân công, SLA, chuyển vướng mắc | [OMNI.md](05_modules/OMNI.md) | OMNI-01 … OMNI-11 (11 web) | Integration / Ban QLDA + DPO |
| MOB | Ứng dụng iOS và Android | L6 | Ứng dụng Flutter, offline queue command, sync rules PowerSync theo tenant/scope (A1) | [MOB.md](05_modules/MOB.md) | MOB-01 … MOB-68 (68 mobile) | Mobile / PO |

## Quy ước dữ liệu
ID dùng UUID; code nghiệp vụ là unique theo tenant/loại và có thể hiển thị riêng. Timestamp lưu UTC timestamptz, ngày nghiệp vụ dùng date và calendar_version. Tiền VND lưu numeric(24,0) tại ledger; tiền ngoại tệ numeric(24,6) kèm currency/FX; trình bày triệu đồng bằng chia chính xác 1.000.000. API truyền money dưới dạng chuỗi decimal, không float JavaScript. Rate và tỷ lệ lưu/compute numeric, chỉ làm tròn khi hiển thị.

Mọi row mutable có version bigint, created_at/by, updated_at/by; archive/soft-delete có deleted_at/reason. Dữ liệu được phê duyệt có immutable revision, effective dates và supersedes_id. Audit append-only gồm actor, impersonator nếu có, tenant, action, resource, before/after hoặc diff được redact, reason, request_id, timestamp, IP/thiết bị phù hợp chính sách. Bí mật, token và toàn bộ nội dung đề án không ghi vào audit.

(Cập nhật 1.4 — CR-05-04) Bổ sung quy ước baseline 1.4:
- Bảng dữ liệu tenant có `tenant_id uuid NOT NULL`, khóa chính `(tenant_id, id)` và khóa ngoại composite `(tenant_id, x_id)`, nên không thể tham chiếu chéo tenant ở tầng DB. Bảng control plane ở schema `control` không mang `tenant_id` của RLS.
- Mọi cột `*_id` có index dẫn đầu `tenant_id`, tên `<table>_<col>_idx` (P1). Unique nghiệp vụ luôn có `tenant_id` đứng đầu.
- Tiền VND là `numeric(24,0)` (đồng nguyên) ở mọi bảng, không chỉ ở ledger. API truyền chuỗi số nguyên; mọi phép chia (tỷ lệ, triệu đồng) chỉ làm tròn khi hiển thị.
- Enum lưu chữ hoa, trùng giữa DB, DTO và OpenAPI (ví dụ `CURRENT_YEAR|CARRYOVER|OTHER`). Đổi enum là thay đổi hợp đồng có CR.
- Mỗi bảng khai báo `classification` ∈ {PUBLIC, INTERNAL, CONFIDENTIAL, PERSONAL, IMPORTANT_CORE} và retention. Xóa theo retention bỏ qua mọi phạm vi đang có legal hold (`legal_hold`, ADM).
- Dữ liệu có hiệu lực theo thời gian dùng `valid_from`/`valid_until` (hoặc `effective_from`/`effective_until`) nửa mở `[from, until)`; khoảng chồng lấn bị chặn bằng exclusion constraint hoặc kiểm trong transaction có khóa.

### Mô hình tenant (R6)
(Cập nhật 1.4 — CR-05-05) Tenant là cơ quan chủ quản ký hợp đồng (UBND tỉnh hoặc bộ/ngành). Sở, ban QLDA, chủ đầu tư, UBND xã là `organization_unit` trong tenant, dạng cây có hiệu lực theo thời gian. Quyền đọc/ghi = ranh giới tenant (RLS) ∩ scope của `role_grant` (TENANT, UNIT_TREE, PROJECT, CONTRACT) ∩ classification. Nhà thầu là `membership.kind = GUEST` với scope CONTRACT. Tổng hợp toàn tỉnh chạy trong một tenant; báo cáo cấp trên đi qua DOC hoặc xuất tệp; không có truy vấn cross-tenant ở runtime. Chuyển dự án giữa đơn vị là command `TransferProjectOwnership`; giữa tenant là export/import có audit. Định nghĩa đầy đủ và thuật toán quyết định quyền: `05_modules/IAM.md` mục 1 và 5; kiến trúc: `04_Thiet_ke_co_ban.md` mục Mô hình tenant.

### Mẫu chính sách RLS
(Cập nhật 1.4 — CR-05-06) Mọi bảng tenant dùng đúng mẫu sau. Cần cả hai policy: PostgreSQL từ chối mọi dòng nếu bảng chỉ có policy RESTRICTIVE, còn policy RESTRICTIVE bảo đảm một policy PERMISSIVE thêm sau này (ví dụ theo scope đơn vị) không nới được ranh giới tenant.

```sql
ALTER TABLE machvon.report_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE machvon.report_revision FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON machvon.report_revision AS PERMISSIVE FOR ALL
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_boundary ON machvon.report_revision AS RESTRICTIVE FOR ALL
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
-- Chỉ khi đặc tả phân hệ yêu cầu (dữ liệu nhạy cảm như hộ dân LND, đề xuất nhà thầu BID):
CREATE POLICY unit_scope ON machvon.<bảng_nhạy_cảm> AS RESTRICTIVE FOR SELECT
  USING (org_unit_id = ANY (string_to_array(nullif(current_setting('app.scope_units', true), ''), ',')::uuid[]));
```

Kernel mở transaction và chạy `SET LOCAL app.tenant_id`, `app.actor_id`, `app.request_id` (và `app.scope_units` khi cần) trước câu lệnh đầu. Thiếu context thì `nullif` trả NULL: đọc 0 dòng, ghi lỗi `WITH CHECK`. Role runtime `machvon_app` là `NOSUPERUSER NOBYPASSRLS` và không sở hữu bảng. View dùng `security_invoker = true`. CI chạy truy vấn catalog chặn merge khi có bảng chứa cột `tenant_id` mà `relrowsecurity` hoặc `relforcerowsecurity` là false, hoặc thiếu một trong hai policy `tenant_access` (PERMISSIVE) và `tenant_boundary` (RESTRICTIVE) trong `pg_policies`; thêm một test kết nối bằng `machvon_app` không đặt context phải đọc 0 dòng. Danh sách role và quy tắc đầy đủ: `04_Thiet_ke_co_ban.md` mục PostgreSQL và RLS.

## Từ điển dữ liệu báo cáo
(Cập nhật 1.4 — CR-05-07) Định nghĩa cột của `report_revision`, `funding_snapshot_line`, `progress_snapshot` và `reporting_period` là chi tiết của phân hệ DIS. Chúng nằm ở `05_modules/DIS.md` mục 6 (đã mở rộng: `allocated_vnd`, `fund_source_version_id`, `allocation_line_id`, trạng thái kỳ OPEN/SOFT_CLOSED/LOCKED, `period_reopen`, `period_snapshot`), và ở `03_Engineering/data_dictionary.json` + `schema_reference.sql`. Bốn đoạn baseline 1.3 được chép ở phụ lục. Các thuật toán dưới đây vẫn dùng tên cột đó.

## Thuật toán tổng hợp và kiểm tra
Tổng lũy kế kỳ = SUM(disbursed_cumulative_vnd) của sáu ô nguồn hợp lệ trong một report revision. CTMTQG là thuộc tính subset, không cộng vào tổng. Ví dụ: năm TW=100, năm ĐP=200, kéo dài TW=30, kéo dài ĐP=70, khác TW=0, khác ĐP=20 triệu → tổng 420 triệu. CTMTQG 40 triệu trong nhóm năm TW vẫn tổng 420, không phải 460.

Tổng danh mục tại as_of chọn revision accepted hiện hành của mỗi project+period theo chính sách snapshot. Báo cáo tuần 39 lũy kế 100 và tuần 40 lũy kế 150 cho cùng dự án thì số cuối tuần 40 là 150, không phải 250. Tăng kỳ = current cumulative − previous comparable cumulative; nếu âm, yêu cầu adjustment/reclassification và giải trình, không tự ép 0. Chuyển nguồn/kế hoạch mới phải chuẩn hóa scope trước so sánh.

Tỷ lệ giải ngân = SUM(actual) / SUM(allocated) × 100 trong cùng scope/snapshot. Mẫu số 0 → null + reason ZERO_DENOMINATOR. Tổng tỷ lệ của dự án 1 (50/100) và dự án 2 (90/900) là 140/1000=14%, không phải trung bình 30%. Distinct count cần set union hoặc aggregate sketch có sai số công bố; không cộng số người của các nhóm chồng lấn.

Các kiểm tra: required field; format/scale; CTMTQG ≤ source parent; source_year hợp lệ; period open; project scope; plan effective; revision current; amount anomalies. Hard validation khác warning: CTMTQG vượt parent chặn, khối lượng vượt kế hoạch có thể warning vì khác basis; warning override phải lưu lý do nếu policy yêu cầu.

(Cập nhật 1.4 — CR-05-08) Bổ sung baseline 1.4. (1) Hai tỷ lệ giải ngân hiển thị song song: mẫu số là kế hoạch Thủ tướng Chính phủ giao, và mẫu số gồm cả phần địa phương giao thêm; giải ngân tính theo ngày Kho bạc thanh toán [CXN-03]. Mỗi tỷ lệ vẫn là SUM(tử)/SUM(mẫu) theo quy tắc trên và trả cả tử số, mẫu số. (2) Kỳ có trạng thái OPEN → SOFT_CLOSED (vẫn nhận gửi, đánh dấu trễ) → LOCKED (`locked_at`, `locked_by`); mở lại chỉ qua `period_reopen` có lý do, người duyệt khác người đề nghị, phạm vi và thời hạn. Baseline 1.3 dùng song song "Closed" và `locked_at`; baseline 1.4 chỉ dùng bộ trạng thái này. (3) Số liệu điều hành đọc từ PeriodSnapshot FROZEN có `as_of`. Công thức chi tiết (`BR-DIS-*`), basis kỳ/YTD (D03) và cảnh báo sớm: `05_modules/DIS.md`; nguồn và hạn mức vốn (AVC, earmark): `05_modules/CAP.md`.

### Quy tắc pháp lý và mẫu biểu là dữ liệu (R4)
(Cập nhật 1.4 — CR-05-09) Mọi quy tắc hoặc mẫu biểu có căn cứ pháp lý (trần tạm ứng, ngưỡng thu hồi 80%, hạn thẩm tra quyết toán theo nhóm dự án, hạn báo cáo giám sát, mẫu 03.a/04.a/05.a, thời hạn bảo quản…) được lưu thành phiên bản dữ liệu, không viết cứng trong mã:
- Trường tối thiểu của một phiên bản quy tắc: `rule_code`, `version`, `legal_basis` (số hiệu văn bản + điều/khoản), `effective_from`, `effective_until` (nửa mở), `parameters` (JSON có schema), `confirmation_ref` (mã `CXN-*` nếu chưa xác nhận), `status` ∈ {DRAFT, PENDING_LEGAL_CONFIRMATION, ACTIVE, RETIRED}. Kernel sở hữu registry dùng chung (`RuleVersion`, tên bảng vật lý chưa có trong `data_dictionary.json` — [GIẢ ĐỊNH], xem Implementation_Readiness); các phân hệ có bảng quy tắc riêng (`doa_rule`, `mne_obligation_rule`, `early_warning_rule`, mẫu DOC `document_template`) theo cùng bộ trường.
- Chọn phiên bản theo ngày nghiệp vụ của bản ghi, không theo ngày hệ thống. Bản ghi nghiệp vụ lưu ID phiên bản đã áp dụng; đổi `effective_from` không tính lại bản ghi cũ.
- Gate R4: slice dùng quy tắc có `confirmation_ref` chưa xác nhận không được DONE; mẫu văn bản đang chờ xác nhận chỉ được dựng có watermark và không phát hành (`422 TEMPLATE_PENDING_LEGAL_CONFIRMATION` trong DOC). Fixture test gắn mã mục `CXN-*`. Sổ xác nhận: `03_Engineering/Implementation_Readiness.html` mục Sổ xác nhận pháp lý.

## Giao dịch gửi báo cáo và cạnh tranh
BEGIN → SET LOCAL tenant context → SELECT report FOR UPDATE → kiểm membership/action/license kỳ hạn mới nhất → kiểm status/version → validate fields và references → persist immutable submission snapshot/hash → increment version → insert audit → insert outbox report.submitted → COMMIT. Dispatch notification xảy ra sau commit. Nếu outbox worker lỗi, báo cáo vẫn Submitted; retry không gửi trùng logical event.

PATCH dùng If-Match version; mismatch trả 409 VERSION_CONFLICT với current_version và safe diff. Submit/approve/payment request/license issue dùng Idempotency-Key và lưu request_hash/result trong TTL phù hợp. Transaction retry chỉ cho lỗi serialization/deadlock, cap số lần và không lặp side effect ngoài DB trong transaction. Lock allocation balance khi kiểm trần ngân sách.

(Cập nhật 1.4 — CR-05-10) Quy tắc đồng thời dùng chung:
- Mỗi command khai báo thứ tự khóa cố định trong đặc tả phân hệ (ví dụ PAY: hợp đồng → dòng sổ lũy kế theo `boq_item_id` tăng dần → tạm ứng → CAP); mọi đường mã dùng đúng thứ tự đó để tránh deadlock.
- `lock_timeout` mặc định 3 giây cho khóa hàng nghiệp vụ [GIẢ ĐỊNH]; hết thời gian trả 409 có `retryable=true`, không chờ vô hạn.
- Retry transaction chỉ cho `40001` (serialization) và `40P01` (deadlock), tối đa 3 lần có jitter [GIẢ ĐỊNH]; không gọi mạng ngoài trong transaction.
- Hai người hoặc hai màn hình cùng ý định nghiệp vụ với hai Idempotency-Key khác nhau được chặn bằng ràng buộc DB (unique một phần, CHECK lũy kế) cộng khóa hàng, không bằng idempotency key (R7). Người thua nhận 409 với mã nghiệp vụ cụ thể.
- Ai thắng: bản có `version` khớp và commit trước. Bên thua nhận `409 VERSION_CONFLICT` kèm `current_version` và diff an toàn (không lộ trường ngoài quyền).

### Sổ cái lũy kế thanh toán (R7)
(Cập nhật 1.4 — CR-05-11) Sổ `cumulative_ledger` có một dòng cho mỗi khóa (tenant, hợp đồng, `boq_item`, nghiệm thu, thành viên liên danh) với `accepted_vnd`, `requested_vnd`, `paid_vnd`, `advance_recovered_vnd`, `retention_held_vnd`. Bất biến là CHECK DB: `0 ≤ paid ≤ requested ≤ accepted`, `advance_recovered + retention_held ≤ requested`; ở mức hợp đồng `paid_total ≤ requested_total ≤ accepted_total ≤ contract_value`. Một nghiệm thu chỉ gắn với một đề nghị còn hiệu lực (unique một phần trên `claims_acceptance`). Submit khóa hàng hợp đồng trong transaction rồi cập nhật sổ, ghi bút toán `cumulative_ledger_entry` (CLAIM, PAYMENT, ADVANCE_RECOVERY, RETENTION_HOLD…), audit và outbox trong cùng commit. Vi phạm trả `409 VALUE_EXCEEDED` hoặc `409 ACCEPTANCE_ALREADY_CLAIMED`. Sửa sai bằng bút toán đảo có `reversal_of_id` (mỗi bút toán chỉ đảo một lần), không UPDATE/DELETE. Test bắt buộc: hai người, hai key, cùng nghiệm thu → một thành công, một nhận 409. Chi tiết: `05_modules/PAY.md` (BR-PAY-01, bảng `cumulative_ledger`), `05_modules/CTR.md` (VolumeAcceptance).

### Hợp đồng ký số, cấp số và đóng dấu văn bản (R8)
(Cập nhật 1.4 — CR-05-12) Văn bản đi: lãnh đạo ký PAdES trên PDF cuối (revision có sẵn trường số/ký hiệu/ngày và hai trường chữ ký) → văn thư cấp số + ngày bằng incremental update chỉ điền ba trường đó, trong transaction khóa hàng sổ đăng ký (`SELECT … FOR UPDATE`, không sequence toàn cục, số đã cấp không bao giờ cấp lại) → ký số cơ quan bao toàn bộ tệp → hệ thống xác minh cả hai chữ ký, chuỗi chứng thư và việc chỉ có thay đổi được phép sau mỗi chữ ký. R1 có hai đường: (i) ký trong hệ thống qua adapter ký số (trạng thái PROPOSED, spike CA sandbox thật ở R0); (ii) tải lên văn bản đã ký bên ngoài → xác minh → đăng ký số vào sổ. Mock chỉ dùng cho test tự động. Phân hệ nguồn chỉ coi văn bản là đã phát hành khi nhận `doc.issued.v1` khớp `source_ref` và băm payload. Chi tiết byte-level (BR-DOC-14), lỗi và test: `05_modules/DOC.md`.

### Điều phối luồng dài bằng Temporal (R9)
(Cập nhật 1.4 — CR-05-13) Temporal là chủ điều phối duy nhất cho provisioning tenant, phê duyệt nhiều bước theo `workflow_version`, ký số/cấp số DOC, import tệp, nhắc hạn, leo thang, hủy, retry và nâng version. Workflow không ghi trạng thái trực tiếp: mỗi bước gọi command domain qua command bus nội bộ với Idempotency-Key `wf:{workflowId}:{activityId}:{attempt-group}`. Bảng transition của domain (từ, command, đến, quyền, guard) là guard bắt buộc; guard từ chối trả Problem code để workflow rẽ nhánh bù trừ hoặc thông báo. `workflow_version` được ghim khi bắt đầu; tenant_id lấy từ context đã ký trong memo, không lấy từ input tùy ý. Chi tiết: `04_Thiet_ke_co_ban.md` mục Điều phối luồng dài bằng Temporal.

## API convention và lỗi
(Cập nhật 1.4 — CR-05-14) Base /api/v1. OIDC bearer token; server lấy tenant context từ membership + tenant selection đã xác thực. Header X-Tenant-ID chỉ là đề nghị chọn tenant, không là bằng chứng quyền. Commands POST /reports/{id}/submit, /decision, /corrections, /withdrawal; không dùng PATCH status tùy ý. GET /metrics/{id}/query nhận bộ lọc và snapshot qua query job POST nếu payload dài. Pagination cursor opaque/signed, page_size cap 200. Error envelope chuẩn theo OpenAPI Problem (RFC 7807): type, title, status, code, correlation_id; detail, errors[{field,code,message}] và retryable là tùy chọn. Không dùng message/field_errors khác schema trong adapter trả về client.

Mã lỗi: 400 INVALID_REQUEST; 401 SESSION_EXPIRED; 403 SCOPE_DENIED/ENTITLEMENT_DENIED; 404 RESOURCE_NOT_FOUND trong scope; 409 VERSION_CONFLICT/IDEMPOTENCY_CONFLICT/PERIOD_LOCKED; 422 VALIDATION_FAILED; 429 RATE_LIMIT/BUDGET_EXCEEDED theo contract; 503 PROVIDER_UNAVAILABLE. Không dùng 402 như bảo mật duy nhất; entitlement service trả lý do cụ thể an toàn cho UI. Signed download URL kiểm quyền lại trước cấp.

### Mô hình lệnh ghi (K3)
(Cập nhật 1.4 — CR-05-15)
- Mọi thay đổi trạng thái là domain command `POST /api/v1/<resource>/{id}/<action>` (hoặc `POST /<resource>` để tạo), có `operationId`, `x-permission`, DTO request dạng allowlist (trường thừa → `400 FIELD_NOT_ALLOWED`) và test oracle.
- Không có endpoint chung nào ghi được `status`, `tenant_id`, role/grant hoặc số tiền đã chốt (đã duyệt, đã gửi Kho bạc, đã thanh toán, đã khóa kỳ). Các trường này chỉ đổi qua command có guard trong bảng transition.
- Các GET scaffold (`x-contract-maturity: reference-scaffolding`) là read model. Mỗi tài nguyên được phân loại `x-exposure` = `keep` (DTO đọc + mask), `dto` (DTO riêng) hoặc `internal` (không expose), kèm `x-exposure-reason`. Không triển khai auto-CRUD hay mass assignment.
- Command recheck quyền, scope, version và trạng thái trong cùng transaction với thay đổi; ghi aggregate + `audit_event` + `outbox_event` trong một commit; tác dụng phụ ngoài (gửi tin, gọi provider) chỉ sau commit qua outbox.
- Danh mục operation sinh từ `openapi.json`: `03_Engineering/API_Catalogue.html`. Command của từng phân hệ: mục 7 của `05_modules/<MÃ>.md`.

### Danh mục mã lỗi dùng chung
(Cập nhật 1.4 — CR-05-16) Mã ổn định trong trường `code` của Problem. Phân hệ chỉ thêm mã riêng khi ý nghĩa nghiệp vụ khác, và phải khai báo trong mục 7 của đặc tả phân hệ.

| HTTP | code | Ý nghĩa | retryable |
|---|---|---|---|
| 400 | INVALID_REQUEST | Cú pháp/định dạng sai, thiếu header bắt buộc (Idempotency-Key, If-Match) | không |
| 400 | FIELD_NOT_ALLOWED | DTO chứa trường ngoài allowlist | không |
| 401 | SESSION_EXPIRED | Token hết hạn hoặc bị thu hồi | không (đăng nhập lại) |
| 403 | SCOPE_DENIED | Ngoài tenant/scope/classification được cấp | không |
| 403 | ENTITLEMENT_DENIED | Gói/license không có quyền lợi | không |
| 403 | MFA_REQUIRED | Thao tác cần MFA/step-up | không (xác thực lại) |
| 403 | SELF_APPROVAL_DENIED | Người lập tự duyệt (maker = checker) | không |
| 403 | TENANT_SUSPENDED | Tenant tạm ngừng, lệnh ghi bị chặn | không |
| 404 | RESOURCE_NOT_FOUND | Không tồn tại trong scope (không phân biệt với không có quyền) | không |
| 409 | VERSION_CONFLICT | If-Match hoặc base version lệch | không (tải lại) |
| 409 | IDEMPOTENCY_CONFLICT | Cùng key, khác `request_hash` | không |
| 409 | IDEMPOTENCY_IN_PROGRESS | Cùng key đang xử lý; có `Retry-After` | có |
| 409 | PERIOD_LOCKED | Kỳ đã khóa | không |
| 409 | `<AGGREGATE>_STATE_INVALID` | Command không hợp lệ ở trạng thái hiện tại (ví dụ REPORT_STATE_INVALID, CONTRACT_STATE_INVALID) | không |
| 409 | REVIEW_INVALID | Review/preview không còn hợp lệ (hết hạn, đã dùng, khác actor/tenant, hash đổi) | không (tạo review mới) |
| 409 | VALUE_EXCEEDED, ACCEPTANCE_ALREADY_CLAIMED | Vi phạm bất biến tiền R7 | không |
| 413 | PAYLOAD_TOO_LARGE | Tệp vượt giới hạn | không |
| 422 | VALIDATION_FAILED | Vi phạm quy tắc nghiệp vụ; chi tiết trong `errors[]` | không |
| 422 | AI_ROUTE_NOT_ALLOWED | Không có tuyến model hợp lệ cho `data_classification` (R5) | không |
| 429 | RATE_LIMIT, BUDGET_EXCEEDED | Vượt hạn mức tần suất hoặc ngân sách | có (theo `Retry-After`) |
| 503 | PROVIDER_UNAVAILABLE | Adapter/provider ngoài không sẵn sàng | có |

Chuẩn hóa tên mã ở baseline 1.4: chỉ dùng `REVIEW_INVALID` (bỏ bí danh `REVIEW_STALE` — CR-SAS-02, `05_modules/SAS.md` BR-SAS-17); `IDEMPOTENCY_BODY_MISMATCH` (MOB) và `SELF_APPROVAL_FORBIDDEN` (CTR, PAY) là bí danh cần đổi về `IDEMPOTENCY_CONFLICT` và `SELF_APPROVAL_DENIED`; `PERIOD_LOCKED` luôn là 409 (MOB đang ghi 422). Các mục này được ghi là yêu cầu sửa cho chủ đặc tả phân hệ.

### Idempotency và If-Match
(Cập nhật 1.4 — CR-05-17)
- `Idempotency-Key` (UUID hoặc chuỗi ≤ 128 ký tự) bắt buộc cho mọi command. Bản ghi `idempotency_record` có khóa duy nhất `(tenant_id, subject_id, operation, key_hash)` (Cập nhật 1.4 — CR-05-17), lưu `request_hash` (SHA-256 của JSON chuẩn hóa: khóa sắp xếp, bỏ trường không ảnh hưởng nghiệp vụ), trạng thái, mã HTTP và body phản hồi, ghi trong cùng transaction với thay đổi; giữ tối thiểu 72 giờ cho mọi command và 7 ngày cho command chuyển tiền hoặc ghi sổ tài chính (quy tắc duy nhất ở `04_Thiet_ke_co_ban.md`, CR-04-37); lệnh từ hàng đợi offline mobile giữ 7 ngày, `sync_command_receipt` giữ theo cùng thời hạn.
- Cùng key + cùng hash → trả lại đúng phản hồi đã lưu (kể cả lỗi 4xx nghiệp vụ). Cùng key + hash khác → `409 IDEMPOTENCY_CONFLICT`. Key đang xử lý → `409 IDEMPOTENCY_IN_PROGRESS` kèm `Retry-After`.
- Workflow Temporal dùng key `wf:{workflowId}:{activityId}:{attempt-group}`; mobile dùng `local_uuid` của mục hàng đợi; adapter gửi ra ngoài dùng key riêng của provider khi provider hỗ trợ.
- Bản ghi có version trả `ETag` = version. Lệnh sửa bản ghi có version bắt buộc `If-Match`; thiếu → `400 INVALID_REQUEST` (giữ quy ước v1.3 của theme), lệch → `409 VERSION_CONFLICT` kèm `current_version`. Lệnh tạo mới không cần If-Match.

## Dữ liệu và lifecycle AI
analysis_run liên kết tenant/project/package/criteria_version/profile_version/status/budget_reservation_id. analysis_attempt gồm run_id, ordinal, provider_request_id, actual_model, pricing_version, input_tokens, cached_tokens, output_tokens, reasoning_tokens_info, tool_units, latency_ms, original_currency, cost, reconcile_status. finding gồm criterion_id, status, text, evidence_refs và reviewer decision. evidence gồm document_version_id, page_index, bbox, snippet_hash và retrieval_score chỉ phục vụ debug được phân quyền.

Reserve: transaction khóa budget counters ở thứ tự tenant→unit→project→user; available = limit − settled − open_reservations. Ước tính tối đa theo input bound, output cap, tool cap, fallback cap; không đủ thì reject hoặc yêu cầu phê duyệt tăng giới hạn. Khi settle dùng actual provider usage, release phần dư; actual cao hơn reserve đưa exception và ngăn job tiếp theo theo policy, không sửa hóa đơn để khớp giả. Reservation timeout chỉ release sau reconcile hoặc quyết định có audit.

Pricing row có model, modality, meter, unit_size, price, currency, effective_from/to, source_url, verified_by. Token cached nằm trong input_total của một số provider: normalized noncached = input_total − cached; adapter phải khai báo semantics. Reasoning là breakdown của output nếu provider quy định như vậy, không cộng hai lần. Test bằng fixture có cache/reasoning/retry/tool và invoice rounding.

Guardrail: classify trước export dữ liệu ra provider; redact PII phù hợp mục đích; allowlist file và công cụ; structured output validate JSON schema; kiểm dẫn chứng tồn tại trong đúng document version. Model refusal/timeout/invalid JSON phải có trạng thái riêng. Không lưu chain-of-thought ẩn; lưu input/output phù hợp retention và giải thích có nguồn do hệ thống tạo.

(Cập nhật 1.4 — CR-05-18) Định tuyến theo phân loại dữ liệu (R5). Mỗi request AI mang `data_classification` ∈ {PUBLIC, INTERNAL, CONFIDENTIAL, PERSONAL, IMPORTANT_CORE}, do server xác định bằng mức cao nhất của các tài liệu và trường được đưa vào prompt, không do client khai. INTERNAL trở lên chỉ tới model trong nước hoặc tự host trên cloud nội địa. Model quốc tế chỉ nhận PUBLIC hoặc dữ liệu đã ẩn danh, khi D07 duyệt và tenant bật. LiteLLM chọn route theo bảng chính sách; không có route hợp lệ → `422 AI_ROUTE_NOT_ALLOWED`, không hạ cấp phân loại. `analysis_attempt` ghi thêm `route_id`, `data_classification` và vùng của model; audit ghi tuyến đã dùng. Bộ eval chạy trên mọi tuyến được bật trước khi bật profile. Nội dung truy xuất là dữ liệu không tin cậy (OWASP LLM01); câu trả lời không có citation trong scope bị từ chối; mọi hành động ghi, tiền hoặc quyết định cần bản ghi người duyệt. Chi tiết phân hệ: `05_modules/LLM.md`, `05_modules/BID.md`.

## Notification và omnichannel chi tiết
(Cập nhật 1.4 — CR-05-19) event_id + tenant + event_version định danh domain event. notification_instance có workflow_version, recipient, purpose, dedupe_key, expires_at. Khóa chống trùng duy nhất của thông báo: `dedupe_key = 'n1:' || hex(sha256(tenant_id || '|' || source_event_id || '|' || recipient_id || '|' || purpose))`, UNIQUE `(tenant_id, dedupe_key)`; kênh không nằm trong khóa thông báo mà là chiều của attempt, UNIQUE `delivery_attempt (tenant_id, notification_id, channel, attempt_no)` (BR-NOT-01, CR-NOT-01). delivery_attempt có channel_account_id, provider_message_id, status, error_code, attempt_no, next_retry_at, accepted/delivered/read timestamps, cost meter. Consent và preferences được snapshot cho audit nhưng quyền hiện thời kiểm lại trước gửi.

Webhook inbox lưu raw_payload_hash, provider_event_id, received_at, signature_valid, processing_status. Xác thực signature theo provider, reject body sửa; dedupe index tenant/provider/event_id. Callback monotonic reducer cho các trạng thái đã biết; callback chưa biết provider_message_id giữ pending mapping, không bỏ lặng. Received read không thay nghĩa business acknowledged. Nếu cancel sau ProviderAccepted, trạng thái cancel_requested, không báo đã hủy nếu provider không hỗ trợ.

(Cập nhật 1.4 — CR-05-20) Khóa `tenant/provider/event_id` ở đoạn trên là khóa của inbox webhook vào (`integration_event_inbox`), không phải khóa chống trùng thông báo. Ba định nghĩa khóa chống trùng của baseline 1.3 được hợp nhất thành hai khóa có tên riêng như trên.

(Cập nhật 1.4 — CR-05-21) Retry có giới hạn: tối đa 5 lần gửi mỗi kênh = 1 lần đầu + 4 lần thử lại sau 30 s, 2 phút, 10 phút, 30 phút tính từ lần trước, mỗi khoảng nhân hệ số jitter ngẫu nhiên [0,8; 1,2]; nếu provider trả `Retry-After` lớn hơn thì dùng giá trị đó; không lên lịch lần nào có thời điểm ≥ `expires_at`. Chỉ retry lỗi RETRYABLE (timeout trước khi gửi, 408, 429, 5xx); lỗi PERMANENT dừng ngay. Hết 5 lần → fallback sang kênh kế tiếp trong `channel_plan`; hết kênh → Failed → DLQ. Timeout sau khi request đã tới provider → Unknown, không tự gửi lại kênh tính phí. Cấu hình phải điều chỉnh theo provider. DLQ replay không bypass suppression, opt-out, license hoặc data access. Outbound bảo mật dùng deep link chỉ chứa opaque resource ID, không token truy cập dài hạn. (Thay câu "lịch 30 s, 2 m, 10 m, 30 m … cap 5 lần" mâu thuẫn của baseline 1.3 — CR-NOT-02.)

(Cập nhật 1.4 — CR-05-22) Tổng quan và nguồn chi tiết: luồng sự kiện → workflow → đồng ý (consent theo người × kênh × mục đích, Luật BVDLCN 91/2025 + NĐ 356/2025) → giờ yên lặng → digest → gửi → reducer trạng thái đơn điệu; "đã đọc" khác "đã xác nhận". Kênh R1: IN_APP, EMAIL, PUSH; Zalo ZNS/OA và WhatsApp sau khi D06 có tài khoản và mẫu được duyệt. Đặc tả: `05_modules/NOT.md` (BR-NOT-01..16), hội thoại hai chiều `05_modules/OMNI.md`.

## Tenant SaaS và license chi tiết
(Cập nhật 1.4 — CR-05-23) Tenant status [Requested, Provisioning, Active, Suspended, Offboarding, Archived, Failed] theo `05_modules/SAS.md` (thay hai bộ trạng thái mâu thuẫn của baseline 1.3); subscription status theo billing lifecycle; license status theo FRD; resource access quyết định từ policy kết hợp, không đồng nhất payment_failed với revoked (thanh toán quá hạn không tự Suspend — BR-SAS-04). Tenant domain uniqueness toàn platform; kiểm TXT trước enable và kiểm tiếp khi chuyển owner. Không nạp branding trước xác minh origin bằng nội dung tùy ý. HTML email/template sandbox và escape biến.

License payload ký bất đối xứng chứa issuer, tenant_id, license_id, revision, valid_from/until, grace_until, entitlements_hash, quota, deployment binding khi Private, key_id. Giữ private key tại KMS/HSM; verify bằng public key; rotation có overlap và revoked_key list. SaaS kiểm entitlement service online; cache TTL đề xuất 60 giây với invalidation event. Revocation hard-deny trong lần refresh kế tiếp; hành động rủi ro cao kiểm online trực tiếp.

Billing ledger dùng meter_event idempotent và invoice_line snapshot. Chuyển gói có preview proration theo điều khoản; sửa billing không sửa usage gốc. Thanh toán ngân hàng/cổng thanh toán có reconciliation và approval cho manual adjustment. Thời hạn license và subscription không nhất thiết bằng nhau vì hợp đồng mua sắm trả chậm; cần policy rõ, không tự gia hạn theo email hay chat.

(Cập nhật 1.4 — CR-05-24) Hóa đơn điện tử theo NĐ 123/2020 sửa bởi NĐ 70/2025: không hủy hóa đơn đã phát hành, chỉ điều chỉnh hoặc thay thế; adapter nhà cung cấp hóa đơn ở trạng thái MISSING cho tới khi D08 chọn nhà cung cấp. Provisioning tenant là saga Temporal (SAS-02). Theme và thương hiệu tenant: nguồn duy nhất `03_Engineering/Tenant_Theme_Specification.html`. Chi tiết: `05_modules/SAS.md`.

## DrillContext và query security
Context gồm tenant_id, subject_scope_hash, metric_id/version, dataset_snapshot, filters AST, dimensions/path, unit/currency và as_of. Context token ký hoặc ID server-side, không tin JSON client tự sửa. Một drill request phải xác minh membership hiện tại rồi giao scope cũ với scope hiện tại; quyền bị thu hồi có hiệu lực ngay cả khi snapshot cũ vẫn còn.

Query compiler cho phép field IDs có trong semantic model, join path đã duyệt, operator allowlist và parameterized predicates. Áp tenant filter vào mọi bảng/join; tránh many-to-many fanout bằng grain và bridge weighting được khai báo. Ratio trả numerator/denominator để UI giải thích. Pagination drill có stable ordering; sum pagination lấy query aggregate riêng, không chỉ tổng trang đang xem. Export cap/hàng đợi và watermark scope.

## Mobile sync protocol
Local draft envelope gồm tenant_id, user_id, device_id, local_uuid, base_server_version, changed_fields, attachment hashes, created_at và schema_version. Hàng đợi lưu encrypted, xác thực thiết bị từ secure storage. Sync POST /sync/batches có idempotency key từng item; trả accepted/conflict/rejected theo item, không fail cả batch vì một lỗi. Upload resumable chunks checksum; file chỉ liên kết báo cáo sau scan thành công.

Conflict field-level đối với nháp; số tiền không last-write-wins tự động. UI hiển thị bản máy, bản server, chênh lệch và lựa chọn; server revalidate sau merge. Không sync action approve/submit từ cache khi quyền/kỳ/license chưa kiểm online. Logout hoặc đổi tenant xóa cache/draft theo lựa chọn bảo mật và cảnh báo trước mất nháp; không đưa draft A sang B.

(Cập nhật 1.4 — CR-05-25) Đồng bộ theo MOB và A1:
- Đọc: PowerSync (Open Edition tự host) đọc WAL bằng role replication nên không đi qua RLS; cách ly tenant nằm ở sync rules. JWT PowerSync do backend cấp, TTL ≤ 5 phút, chứa `sub`, `tenant_id` đang hoạt động và `scope_version`. Mọi bucket lấy tham số từ `sync_membership_scope` theo user và tenant trong JWT; data query luôn có `tenant_id = bucket.tenant_id` cộng điều kiện scope. Hợp đồng sync liệt kê bảng và cột được sync; tiền chỉ đọc; dữ liệu cá nhân (hộ dân LND, CCCD) không sync trừ khi đặc tả phân hệ cho phép theo vai trò.
- Thu hồi membership/grant → `sync_membership_scope.revoked` → bucket rỗng ở lần sync kế và app xóa dòng cục bộ. Logout hoặc đổi tenant xóa SQLite, khóa và cache tệp của tenant cũ; còn lệnh chưa gửi thì chặn đổi tenant tới khi gửi xong hoặc người dùng hủy.
- Ghi: hàng đợi chỉ chứa command (`queued_command`: QUEUED → SENDING → ACCEPTED | REJECTED | CONFLICT | UNKNOWN; DISCARDED). Gửi qua `POST /sync/batches` (kết quả theo từng mục) hoặc command của phân hệ, Idempotency-Key = `local_uuid`, kèm `base_server_version`. Mất kết nối trước phản hồi → UNKNOWN, tra `GET /sync/commands/{idempotencyKey}` khi nối lại, không tự tạo lệnh mới. Tệp: `POST /sync/attachments` + `/complete`, checksum SHA-256, chỉ liên kết khi quét sạch.
- Lỗi: `409 DRAFT_VERSION_CONFLICT`, `409 IDEMPOTENCY_CONFLICT`, `409 PERIOD_LOCKED`, `422 LICENSE_EXPIRED`, `403 SCOPE_DENIED`. Chi tiết: `05_modules/MOB.md`, `04_Thiet_ke_co_ban.md` mục PowerSync, `07_Smartphone_iOS_Android.md`.

### Import tệp idempotent (A3)
(Cập nhật 1.4 — CR-05-26) Hệ thống TTQG về đầu tư công, muasamcong, dịch vụ công Kho bạc/TABMIS không có API công khai cho bên thứ ba; không thiết kế lời gọi API giả định. Mọi import tệp: tính SHA-256 của tệp và khóa nghiệp vụ từng dòng (ví dụ số chứng từ Kho bạc + ngày + tài khoản); nạp lại cùng tệp trả "đã nạp" (`409 IMPORT_FILE_ALREADY_APPLIED`) và không tạo bản ghi; dòng lỗi vào quarantine có báo cáo; ghi vào domain luôn qua command; chênh lệch đối soát tạo hạng mục có owner và hạn xử lý. Luồng import chạy trên Temporal.

## Kiểm thử và quan sát
Unit tests cho công thức nguồn/CTMTQG/tỷ lệ/lũy kế và thời điểm license. Integration tests transaction submit/outbox/idempotency và allocation race. Security tests tenant B qua URL/body/search/vector/export/cache/webhook/job; object storage path traversal; IDOR; quyền revoked giữa query và download. AI tests prompt injection trong tài liệu, OCR sai số, missing evidence, criterion version mismatch, cost concurrency. Notification tests callback duplicate/out-of-order/unknown, provider timeout, consent revoked và DST/quiet hours.

Contract tests adapter Kho bạc/LLM/channel với fixtures đã anonymize. E2E web/mobile cho nháp → gửi → trả lại → sửa → accept → drill. Performance theo mô hình BRD và tenant noisy-neighbor; failover test broker/provider/DB replica. Observability trace xuyên request→outbox→worker→provider, có correlation_id và tenant nhưng không log secrets. Chỉ đóng UAT khi có bằng chứng kết quả và người chấp nhận.

(Cập nhật 1.4 — CR-05-27) Test bắt buộc thêm ở baseline 1.4 (mỗi mục có setup, input, bước, expected cụ thể trong `test_cases.json`): sync rules PowerSync tenant A không nhận dòng tenant B, thu hồi membership làm bucket rỗng, đổi tenant/logout xóa DB (A1); dữ liệu INTERNAL trở lên không tới model quốc tế (R5, eval); hai đề nghị thanh toán hai key cùng nghiệm thu → một 409 (R7); cấp số chèn bằng incremental update không làm hỏng chữ ký lãnh đạo và hai văn thư cấp số đồng thời nhận số duy nhất liên tục (R8, P3); đổi `effective_from` không đổi bản ghi cũ (R4); nạp lại cùng tệp Kho bạc không tạo bản ghi (A3); kiểm catalog RLS. Yêu cầu phi chức năng đo được nằm ở `03_Engineering/nonfunctional_requirements.json` (`NFR-<AREA>-NN`, test `UAT-NFR-*`). Quy tắc truy vết theo loại (R11): FR chức năng → màn hình/luồng + operation + entity + story + test; NFR/kiểm soát → cơ chế + story + test hoặc bằng chứng vận hành. Script `work/tools/src/check-cli.mjs` kiểm truy vết, test mồ côi và bước template. Thuộc tính telemetry bắt buộc và danh sách cấm PII: `04_Thiet_ke_co_ban.md` mục Quan sát.

## Theme & thương hiệu theo tenant — SAS-04
(Cập nhật 1.4 — CR-05-28) Nguồn duy nhất: `03_Engineering/Tenant_Theme_Specification.html` (quyền System Admin, Tenant Admin chỉ đọc, review gắn hash và base version, 403/409/422/413, mã lỗi duy nhất `REVIEW_INVALID`). Saga publish/rollback: `03_Engineering/Command_Contracts_and_QA.html`. Bốn đoạn SAS-04 của baseline 1.3 được chép ở phụ lục.

## Hợp đồng chi tiết và điều kiện đưa vào sprint
Bổ sung theme endpoints, entity schema và review token theo đặc tả tenant; public read không trả draft/history hoặc review token. Các generic resource endpoints trong OpenAPI vẫn là reference scaffolding: không triển khai mass assignment toàn schema, không dùng thay approve/publish/revoke. Trước coding mỗi action phải có operationId, DTO allowlist, If-Match/idempotency, policy và test oracle. Module_Implementation_Contracts và test_cases là checklist kiểm soát đầy đủ phạm vi, chưa chứng minh endpoint bindings đã được nghiệm thu.

(Cập nhật 1.4 — CR-05-29) Điều kiện bổ sung ở baseline 1.4: phân hệ có đặc tả `05_modules/<MÃ>.md` đủ 13 mục của khung; mỗi command có `x-permission`, Idempotency-Key, If-Match khi sửa bản có version và danh sách Problem code; mỗi GET scaffold đã được phân loại `x-exposure`; mục `CXN-*` mà slice dùng đã được xác nhận hoặc slice ghi rõ không DONE (R4); hạng mục bắt buộc người duyệt và giờ review đã khai báo (R2); thành phần hạ tầng slice cần đã đạt điều kiện vào (R1).

(Cập nhật 1.4 — CR-05-30) Tài liệu điều phối: 04_Thiet_ke_co_ban; 05_modules (chỉ mục ở đầu tài liệu); 09_Ke_hoach_trien_khai; 10_Ke_hoach_kiem_thu_va_chuyen_doi; 03_Engineering/API_Catalogue.html; 03_Engineering/Module_Implementation_Contracts.html; 03_Engineering/Command_Contracts_and_QA.html; 03_Engineering/Implementation_Backlog.html; 03_Engineering/Test_Case_Catalogue.html; 03_Engineering/Decision_Register.html; 03_Engineering/Implementation_Readiness.html.

## Phụ lục: ánh xạ nội dung baseline 1.3
Danh sách dưới chép nguyên văn mọi đoạn baseline 1.3 đã sửa hoặc bỏ, kèm nơi nội dung hiện nằm. Đoạn không có ở đây được giữ nguyên văn trong thân tài liệu. Mã đoạn `Bnn` đánh số các đoạn không phải tiêu đề của baseline 1.3 theo thứ tự xuất hiện, bắt đầu từ B00.

- **B00** — Sửa (CR-05-01). Nội dung hiện nằm ở: dòng phiên bản đầu tài liệu (Baseline 1.4; tài liệu thành quy ước cắt ngang).
  > # Hệ Thống Lý Dự Án Đầu Tư Công thiết kế chi tiết Baseline 1.3 | 22/10/2026. Tài liệu này mô tả hợp đồng thực thi và thuật toán trọng yếu. Các tệp OpenAPI/SQL đi kèm là baseline kỹ thuật cần mở rộng trong sprint, không phải backend đã hoàn thành.
- **B03** — Bỏ (chi tiết phân hệ DIS) (CR-05-07). Nội dung hiện nằm ở: 05_modules/DIS.md mục 6 (report_revision) + data_dictionary.json + schema_reference.sql.
  > ## Từ điển dữ liệu báo cáo report_revision: id UUID; tenant_id UUID; project_id UUID; period_id UUID; plan_version_id UUID; revision integer >0; status enum; version bigint; submitted_at timestamptz nullable; accepted_at nullable; supersedes_id nullable; amendment_reason text; source_kind enum manual/import/integration; payload_hash char64. Unique tenant/project/period/revision; partial unique current accepted theo business key.
- **B04** — Bỏ (chi tiết phân hệ DIS) (CR-05-07). Nội dung hiện nằm ở: 05_modules/DIS.md mục 5–6 (funding_snapshot_line, CTMTQG subset, BR-DIS) + data_dictionary.json.
  > funding_snapshot_line: report_revision_id; capital_bucket [CURRENT_YEAR,CARRYOVER,OTHER]; budget_level [CENTRAL,LOCAL]; allocated_vnd; disbursed_cumulative_vnd; ctmtqg_subset_vnd nullable; next_month_registered_vnd; next_month_ctmtqg_subset_vnd nullable; original_source_year nullable; source_reference. CTMTQG chỉ áp nhóm được chính sách cho phép; null nghĩa không áp dụng/chưa khai báo, khác 0. Giá trị âm không hợp lệ trừ bút toán điều chỉnh ở ledger có lý do.
- **B05** — Bỏ (chi tiết phân hệ DIS) (CR-05-07). Nội dung hiện nằm ở: 05_modules/DIS.md mục 3 (F1 bước DIS-03, measurement_basis mặc định YTD theo D03) và mục 6 (progress_snapshot).
  > progress_snapshot: construction_value_vnd, acceptance_value_vnd, treasury_submitted_value_vnd, preparing_dossier_value_vnd, measurement_basis [PERIOD,YTD,PROJECT_TO_DATE], as_of_date. Cần owner xác nhận basis vì nguồn demo chưa đủ rõ. Không suy luận nghiệm thu phải ≤ vốn giao năm trong mọi trường hợp; validation dùng basis và ngưỡng đúng loại.
- **B06** — Bỏ (chi tiết phân hệ DIS) (CR-05-07). Nội dung hiện nằm ở: 05_modules/DIS.md mục 3 F4 (lịch kỳ, calendar_version, khóa sổ) và mục 6 (reporting_period); trạng thái kỳ ở CR-05-08.
  > reporting_period: type, code, start_date, end_date, deadline_at, locked_at, calendar_version. Lịch tuần cấu hình theo tenant; khóa date range không chồng lấn trong cùng calendar/type. Period mang fiscal_year tách năm lịch nếu hợp đồng cần. Dự án kéo dài vẫn liên kết original_source_year để không mất niên độ vốn.
- **B13** — Sửa (CR-05-14). Nội dung hiện nằm ở: API convention và lỗi, đoạn 1 (đường dẫn command theo openapi.json: /decision, /corrections, /withdrawal thay /review, /amend; ghi rõ RFC 7807).
  > ## API convention và lỗi Base /api/v1. OIDC bearer token; server lấy tenant context từ membership + tenant selection đã xác thực. Header X-Tenant-ID chỉ là đề nghị chọn tenant, không là bằng chứng quyền. Commands POST /reports/{id}/submit, /review, /amend; không dùng PATCH status tùy ý. GET /metrics/{id}/query nhận bộ lọc và snapshot qua query job POST nếu payload dài. Pagination cursor opaque/signed, page_size cap 200. Error envelope chuẩn theo OpenAPI Problem: type, title, status, code, correlation_id; detail, errors[{field,code,message}] và retryable là tùy chọn. Không dùng message/field_errors khác schema trong adapter trả về client.
- **B19** — Sửa (CR-05-19). Nội dung hiện nằm ở: Notification và omnichannel, đoạn 1 (thêm định nghĩa dedupe_key duy nhất BR-NOT-01 và khóa attempt).
  > ## Notification và omnichannel chi tiết event_id + tenant + event_version định danh domain event. notification_instance có workflow_version, recipient, purpose, dedupe_key, expires_at. delivery_attempt có channel_account_id, provider_message_id, status, error_code, attempt_no, next_retry_at, accepted/delivered/read timestamps, cost meter. Consent và preferences được snapshot cho audit nhưng quyền hiện thời kiểm lại trước gửi.
- **B21** — Sửa (CR-05-21). Nội dung hiện nằm ở: Notification và omnichannel, đoạn retry (1 lần đầu + 4 lần thử lại = tối đa 5 lần mỗi kênh, BR-NOT-03).
  > Retry lịch đề xuất 30 s, 2 m, 10 m, 30 m với jitter và provider Retry-After; cap 5 lần và không vượt expires_at. Cấu hình phải điều chỉnh theo provider. DLQ replay không bypass suppression, opt-out, license hoặc data access. Outbound bảo mật dùng deep link chỉ chứa opaque resource ID, không token truy cập dài hạn.
- **B22** — Sửa (CR-05-23). Nội dung hiện nằm ở: Tenant SaaS và license, đoạn 1 (bộ trạng thái tenant theo SAS.md).
  > ## Tenant SaaS và license chi tiết Tenant status [Provisioning,Active,Suspended,Offboarding,Archived]; subscription status theo billing lifecycle; license status theo FRD; resource access quyết định từ policy kết hợp, không đồng nhất payment_failed với revoked. Tenant domain uniqueness toàn platform; kiểm TXT trước enable và kiểm tiếp khi chuyển owner. Không nạp branding trước xác minh origin bằng nội dung tùy ý. HTML email/template sandbox và escape biến.
- **B31** — Bỏ (trùng lặp SAS-04) (CR-05-28). Nội dung hiện nằm ở: 03_Engineering/Tenant_Theme_Specification.html mục Ma trận quyền.
  > Chỉ System Admin được cấu hình thương hiệu cho các tenant: màu sắc, logo, menu, header, footer, tên hệ thống, địa chỉ và thông tin liên hệ. Tenant Admin chỉ được đọc cấu hình đã công bố của tenant mình, không được sửa, lưu nháp, tải logo, tạo review, áp dụng hoặc khôi phục. Các quyền quản trị nội bộ tenant khác không bao gồm quyền cấu hình thương hiệu.
- **B32** — Bỏ (trùng lặp SAS-04) (CR-05-28). Nội dung hiện nằm ở: 03_Engineering/Tenant_Theme_Specification.html mục Trạng thái và luồng, Kiểm tra cấu hình.
  > Bản nháp tách biệt theo tenant và không thay đổi giao diện đang dùng. Xem trước web/smartphone trong vùng riêng; bước review hiển thị chênh lệch trước/sau, tenant đích và phiên bản gốc. Xác nhận áp dụng tạo phiên bản bất biến mới. Khôi phục cũng phải review và tạo phiên bản mới, giữ nguyên lịch sử. Kiểm tra trường bắt buộc, email, tệp logo và sáu cặp màu tương phản tối thiểu 4,5:1 trước khi công bố.
- **B33** — Bỏ (trùng lặp SAS-04) (CR-05-28). Nội dung hiện nằm ở: 03_Engineering/Tenant_Theme_Specification.html mục Hợp đồng lỗi và Nghiệm thu; 05_modules/SAS.md BR-SAS-17.
  > Server phải xác thực System Admin cho mọi lệnh ghi; không tin vai trò, tenant_id hoặc cờ quyền do trình duyệt gửi. Review gắn actor, tenant, hash nội dung, base version và hạn sử dụng. Kiểm tra lại quyền và phiên bản trong giao dịch công bố; trả 403 khi thiếu quyền, 409 khi xung đột, 422 khi cấu hình không hợp lệ. Audit ghi người thực hiện, tenant, bản trước/sau, lý do khôi phục và thời điểm; không ghi bí mật vào log.
- **B34** — Bỏ (trùng lặp SAS-04) (CR-05-28). Nội dung hiện nằm ở: 03_Engineering/Tenant_Theme_Specification.html mục Prototype và bằng chứng.
  > Prototype SAS-04 dùng localStorage và bộ chọn vai trò mô phỏng để kiểm tra trải nghiệm. Đây không phải hệ thống xác thực hoặc cách ly tenant thật. Chi tiết triển khai và tiêu chí nghiệm thu nằm tại 03_Engineering/Tenant_Theme_Specification.html.
- **B36** — Sửa (CR-05-30). Nội dung hiện nằm ở: Hợp đồng chi tiết và điều kiện đưa vào sprint, đoạn cuối (thêm 04, 05_modules, API_Catalogue, Module_Implementation_Contracts, Command_Contracts, Implementation_Readiness).
  > Tài liệu điều phối: 09_Ke_hoach_trien_khai; 10_Ke_hoach_kiem_thu_va_chuyen_doi; 03_Engineering/Implementation_Backlog.html; 03_Engineering/Test_Case_Catalogue.html; 03_Engineering/Decision_Register.html.

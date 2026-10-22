# LND — GPMB, bồi thường, hỗ trợ, tái định cư

Đặc tả phân hệ mới (D-B09) theo `_KHUNG_DAC_TA.md`, baseline 1.4 (22/10/2026). Quy ước chung ở `04_Thiet_ke_co_ban.md`, `05_Thiet_ke_chi_tiet.md`. Đây là phân hệ có dữ liệu cá nhân nhạy cảm nhất của hệ thống.

## 1. Mục đích, phạm vi, ranh giới

**Vấn đề.** Giải phóng mặt bằng là nguyên nhân hàng đầu làm chậm giải ngân. Tỉnh và chủ đầu tư cần biết theo từng dự án/đoạn: bao nhiêu thửa, hộ, đã kiểm đếm, đã niêm yết phương án, đã phê duyệt, đã chi trả, còn khiếu nại/cưỡng chế, diện tích nào đã bàn giao cho nhà thầu — kể cả khi Trung tâm phát triển quỹ đất hoặc Ban GPMB cấp huyện/xã là đơn vị thực hiện và tự quản lý hồ sơ.

**Trong phạm vi.** Đoạn/km bàn giao; thửa đất (không chứa thông tin chủ sử dụng); hộ bị ảnh hưởng (PERSONAL) với căn cứ xử lý dữ liệu và thời hạn lưu; liên kết hộ–thửa; kiểm đếm theo quyết định giá có hiệu lực; phương án bồi thường, hỗ trợ, tái định cư; niêm yết và lấy ý kiến; phê duyệt; chi trả và gửi tiền; hoàn ứng tạm ứng GPMB (PAY); khiếu nại; cưỡng chế; phân bổ tái định cư; bộ đếm thời hạn 90/180/30/30 ngày; theo dõi tiến độ theo giai đoạn ở hai chế độ NATIVE và TRACKED_EXTERNAL; xử lý yêu cầu của chủ thể dữ liệu.

**Ngoài phạm vi.** Hệ thống địa chính/đăng ký đất đai (không tích hợp; nhập tệp danh sách thửa); định giá đất (chỉ tham chiếu quyết định giá); chi tiền thực (qua Kho bạc/ngân hàng, LND ghi chứng từ); GIS đầy đủ (R2+, ranh giới lưu GeoJSON).

**Phụ thuộc.** LND → PRJ, CAP (vốn GPMB), DOC (quyết định, biên bản), PAY (tạm ứng GPMB `contract_advance` kind GPMB, `treasury_transaction`), IAM (ConsentRecord), MDM (địa bàn); phát sự kiện cho ISS, PAY, CTR (mặt bằng sẵn sàng), HOME/BI.

**Căn cứ.** Luật Đất đai 2024 và NĐ 88/2024/NĐ-CP (bồi thường, hỗ trợ, tái định cư): thông báo thu hồi đất trước 90 ngày (đất nông nghiệp)/180 ngày (đất phi nông nghiệp), niêm yết/lấy ý kiến phương án tối thiểu 30 ngày, chi trả trong 30 ngày kể từ quyết định phê duyệt, trình tự cưỡng chế [CXN-12]; NĐ 254/2025 (tạm ứng GPMB thu hồi trong 30 ngày) [CXN-12, CXN-02]; Luật BVDLCN 91/2025 + NĐ 356/2025 (căn cứ xử lý, quyền chủ thể, DPO) [CXN-EXE-06]; Luật Dữ liệu 60/2024 + NĐ 165/2025 (dữ liệu lưu tại Việt Nam) [CXN-13]. Số ngày là dữ liệu rule `LND.TIMERS` có `legal_basis` + hiệu lực.

## 2. Actor, tenant và phạm vi quyền

| Actor | Scope | Được phép | Bị cấm |
|---|---|---|---|
| Cán bộ GPMB (Ban QLDA/Trung tâm quỹ đất/Ban GPMB) | UNIT_TREE của đơn vị thực hiện; dữ liệu hộ giới hạn `owner_unit_id` | `land.manage`, `land.process`, `land.household.write/read`, `land.plan.write`, `land.payment.write`, `land.complaint.write` | Đọc hộ thuộc đơn vị khác (RLS `scope_units_guard`); giải mã CCCD không có `lnd.pii.read` |
| UBND xã/phường | UNIT_TREE xã | `land.process` (kiểm đếm, xác nhận), `land.complaint.write`, `land.household.read` | Duyệt phương án |
| Lãnh đạo có thẩm quyền | UNIT_TREE / TENANT | `land.plan.approve`, `land.complaint.resolve`, `land.enforce.write` (bước cần quyết định) | Duyệt phương án do mình lập |
| Chủ đầu tư/Ban QLDA | PROJECT | `land.handover`, `land.progress.report`, `land.read` (tổng hợp, không PII) | Xem dữ liệu cá nhân hộ khi không có grant riêng |
| DPO | TENANT | `land.dsr.handle`, xem nhật ký truy cập PII | Sửa dữ liệu nghiệp vụ ngoài phạm vi yêu cầu chủ thể |
| Đơn vị thực hiện ngoài (Trung tâm quỹ đất) báo cáo | membership của đơn vị | `land.progress.report` chế độ TRACKED_EXTERNAL | Sửa giai đoạn NATIVE |
| Auditor | Scope cấp | `land.read`; PII che hoàn toàn | Ghi; giải mã PII |

## 3. Luồng nghiệp vụ

### 3.1 Kiểm đếm → phương án → niêm yết → phê duyệt (UC-LND-01) — LND-02, LND-04, LND-05, LND-06, LND-12
1. `createLandSection`, `createLandParcel`/`importLandParcels` (idempotent theo SHA-256 tệp + `parcel_code`).
2. `recordRecoveryNotice`: bắt đầu bộ đếm NOTICE_AGRICULTURAL_90 hoặc NOTICE_NON_AGRICULTURAL_180 theo `land_use_group`; quyết định thu hồi chỉ ghi được khi `recovery_decision_on ≥ notice_on + days` (CHECK `land_parcel_notice_chk`).
3. `registerAffectedHousehold` (căn cứ xử lý bắt buộc; CCCD/điện thoại nhận một lần, lưu mã hóa phong bì + HMAC), `linkHouseholdParcel`.
4. `recordInventory` theo quyết định giá có hiệu lực tại ngày khảo sát; `confirmInventory` (hộ xác nhận hoặc phản đối → DISPUTED).
5. `draftCompensationPlan` → `addCompensationPlanItems` (chỉ từ kiểm đếm CONFIRMED) → `postCompensationPlan` (bộ đếm PLAN_POSTING_30) → `recordPlanFeedback` → `closePlanPosting` (không trước `posting_ends_on`) → `approveCompensationPlan` (ý kiến đã xử lý; quyết định; người duyệt khác người lập) → bộ đếm PAYMENT_30.
6. Điều chỉnh: `revisePlan` tạo phiên bản mới; nếu thay đổi bất lợi cho hộ thì niêm yết lại.
7. Tái định cư: `allocateResettlement` (một lô/căn một hộ).

### 3.2 Chi trả và tạm ứng GPMB (UC-LND-02) — LND-07, PAY-12
`scheduleCompensationPayments` lập khoản chi từng hộ (Σ ≤ tổng phương án, `PAYMENT_EXCEEDS_PLAN`); `confirmCompensationPayment` với chứng từ (và giao dịch Kho bạc nếu có); khoản chi gắn `advance_id` tạo thu hồi tạm ứng GPMB ở PAY (không vượt phần còn lại, `ADVANCE_RECOVERY_EXCEEDED`); chi sau `due_on` cần lý do (`PAYMENT_LATE_REASON_REQUIRED`); hộ không nhận → `depositCompensationPayment` với biên bản.

### 3.3 Khiếu nại và cưỡng chế (UC-LND-03) — LND-08, LND-09
`fileLandComplaint` tạo khiếu nại có hạn giải quyết (rule) và vướng mắc ISS chỉ chứa mã; `resolveLandComplaint` có văn bản trả lời. `startEnforcement` kiểm điều kiện tiên quyết (đã có quyết định thu hồi, đã vận động, đã giao hoặc gửi tiền theo quy định — `PAYMENT_NOT_OFFERED`); `advanceEnforcement` qua NOTICE → ORGANIZATION_DECISION → ENFORCEMENT_DECISION → EXECUTING → COMPLETED (bước thực hiện cần quyết định và ngày dự kiến), có thể SUSPENDED với lý do.

### 3.4 Bàn giao mặt bằng và tiến độ (UC-LND-04) — LND-01, LND-10, LND-11
`recordSectionHandover` ghi diện tích đã bàn giao cho hợp đồng thi công ACTIVE (không vượt diện tích cần) → PARTIAL/HANDED_OVER; phát `lnd.section.handed_over.v1` (CTR/QMS hiển thị mặt bằng sẵn sàng). Tiến độ giai đoạn: chế độ NATIVE tính từ dữ liệu LND (số thửa qua giai đoạn); chế độ TRACKED_EXTERNAL khi Trung tâm quỹ đất thực hiện bằng hệ thống/hồ sơ riêng: đơn vị đó báo cáo `reportLandStageProgress` (tổng/xong, ngày, bằng chứng); job phát hiện trễ (`planned_end` qua mà chưa DONE) → LATE + vướng mắc ISS.

### 3.5 Dữ liệu cá nhân (UC-LND-05) — LND-03, LND-13
Thu thập tối thiểu (họ tên chủ hộ, CCCD, điện thoại, địa chỉ, số nhân khẩu, đối tượng chính sách); căn cứ xử lý mặc định PUBLIC_TASK_LAND_LAW (nhiệm vụ theo Luật Đất đai) hoặc LEGAL_OBLIGATION, CONSENT khi xử lý ngoài nghĩa vụ (ví dụ nhận tin nhắn) [CXN-EXE-06]; `handleHouseholdDataRequest` xử lý truy cập, đính chính, rút đồng ý, hạn chế, xóa — từ chối một phần khi dữ liệu là chứng từ chi trả phải lưu (legal hold); mọi lần giải mã CCCD ghi audit (không ghi giá trị).

## 4. State machine

```
LandParcel: SURVEYED ─inventory─► INVENTORIED ─plan─► PLAN_DRAFTED ─post─► PLAN_POSTED ─approve─► PLAN_APPROVED ─pay─► PAID ─section handover─► HANDED_OVER
            (bất kỳ trước PAID) ─complaint─► DISPUTED ;  PLAN_APPROVED|DISPUTED ─enforcement─► ENFORCEMENT
CompensationPlan: DRAFT ─post─► POSTING ─close-posting─► POSTING_CLOSED ─approve─► APPROVED ─schedule payments─► PAYING ─(mọi khoản PAID/DEPOSITED)─► COMPLETED
                  APPROVED|PAYING ─revise─► REVISED (+ bản mới DRAFT) ;  DRAFT|POSTING ─cancel─► CANCELLED
CompensationPayment: PENDING ─confirm─► PAID | ─deposit─► DEPOSITED ; PENDING ─cancel─► CANCELLED
LandComplaint: RECEIVED ─► UNDER_REVIEW ─resolve─► RESOLVED_ACCEPTED | RESOLVED_REJECTED | ESCALATED ─► CLOSED
EnforcementCase: PERSUASION ─► NOTICE ─► ORGANIZATION_DECISION ─► ENFORCEMENT_DECISION ─► EXECUTING ─► COMPLETED ; (bất kỳ) ─► SUSPENDED
LandDeadline: RUNNING ─► SATISFIED | BREACHED | CANCELLED
LandHandoverSection: NOT_READY ─► PARTIAL ─► HANDED_OVER
```

| Từ | Command | Đến | Ai | Guard | Event |
|---|---|---|---|---|---|
| DRAFT | `postCompensationPlan` | POSTING | `land.plan.write` | mọi khoản dựa trên kiểm đếm CONFIRMED; rule timer đã xác nhận | `lnd.plan.posted.v1` |
| POSTING | `closePlanPosting` | POSTING_CLOSED | `land.plan.write` | `today ≥ posting_ends_on` | `lnd.plan.posting_closed.v1` |
| POSTING_CLOSED | `approveCompensationPlan` | APPROVED | `land.plan.approve` | ý kiến đã xử lý; quyết định; khác người lập; CHECK `compensation_plan_approved_chk` | `lnd.plan.approved.v1` |
| APPROVED | `scheduleCompensationPayments` | PAYING | `land.payment.write` | Σ ≤ tổng phương án | `lnd.payment.scheduled.v1` |
| PENDING | `confirmCompensationPayment` | PAID | `land.payment.write` | chứng từ; trễ cần lý do; hoàn ứng không vượt | `lnd.payment.paid.v1` |
| ENFORCEMENT_DECISION | `advanceEnforcement(EXECUTING)` | EXECUTING | `land.enforce.write` | quyết định + ngày; khác người lập | `lnd.enforcement.advanced.v1` |

Cấm (409 `*_STATE_INVALID`): phê duyệt khi đang POSTING; chi trả khi chưa APPROVED; sửa phương án đã APPROVED (phải revise); EXECUTING thiếu quyết định (CHECK `land_enforcement_exec_chk`); sửa giai đoạn NATIVE bằng báo cáo thủ công (`NATIVE_STAGE_READONLY`).

## 5. Quy tắc nghiệp vụ và công thức

- **BR-LND-01 (bộ đếm).** `due_on = started_on + days_applied` (ngày lịch) với: NOTICE_AGRICULTURAL_90 = 90, NOTICE_NON_AGRICULTURAL_180 = 180, PLAN_POSTING_30 = 30, PAYMENT_30 = 30 (rule `LND.TIMERS` [CXN-12]); ví dụ thông báo 2026-07-01 → 2026-09-29 (90) và 2026-12-28 (180). Thửa có nhiều nhóm đất dùng số ngày lớn nhất [GIẢ ĐỊNH].
- **BR-LND-02 (niêm yết).** `posting_ends_on ≥ posting_started_on + 30`; phê duyệt không trước `posting_ends_on`.
- **BR-LND-03 (chi trả).** `payment_due_on = approved_on + 30`; cảnh báo T−7, T; vượt hạn → BREACHED + vướng mắc; khoản chi sau hạn cần lý do và vẫn được ghi để báo cáo trung thực.
- **BR-LND-04 (kiểm đếm).** `amount_vnd = làm tròn(quantity × unit_price_vnd)` HALF_UP; đơn giá theo quyết định giá có hiệu lực tại `surveyed_on`.
- **BR-LND-05 (phương án).** `grand_total = Σ bồi thường + Σ hỗ trợ + Σ tái định cư` (cột sinh); mỗi khoản dựa trên kiểm đếm CONFIRMED hoặc chính sách hỗ trợ có `legal_basis`.
- **BR-LND-06 (tiến độ).** `progress_pct = round(100 × parcels_done / parcels_total, 2)`, 0 khi `parcels_total = 0`; tỷ lệ bàn giao dự án = Σ `handed_area_m2` / Σ `required_area_m2` × 100.
- **BR-LND-07 (dữ liệu cá nhân).** Mã hóa phong bì cho CCCD/điện thoại/tài khoản ngân hàng; HMAC theo khóa tenant để chống trùng; hiển thị che (4 ký tự cuối) cho người có quyền đọc; giải mã chỉ với `lnd.pii.read` và ghi audit; không đưa PII vào log, audit, outbox, vướng mắc, thông báo, prompt AI (định tuyến R5: PERSONAL → chỉ model trong nước/tự host và mặc định không gửi).
- **BR-LND-08 (phạm vi).** Policy RESTRICTIVE `scope_units_guard`: dòng thấy được khi `app.scope_units = '*'` hoặc `owner_unit_id` thuộc danh sách; thiếu giá trị → không thấy dòng nào.
- **BR-LND-09 (lưu giữ).** `retention_until` bắt buộc; hết hạn và không có legal hold → ẩn danh (xóa CCCD, điện thoại, tài khoản; giữ mã hộ, số tiền, chứng từ).
- **BR-LND-10 (tạm ứng GPMB).** Khoản chi gắn `advance_id` ghi thu hồi ở PAY; Σ thu hồi ≤ tạm ứng đã chi; hạn thu hồi 30 ngày theo PAY BR-PAY-11.

## 6. Dữ liệu

Phân hệ LND sở hữu 13 bảng (0 bảng hiện có được mở rộng, 13 bảng mới). Quy ước chung: khóa chính `(tenant_id, id)`, khóa ngoại tổng hợp `(tenant_id, x_id)`, tiền `numeric(24,0)` VND nguyên, mọi bảng ENABLE + FORCE RLS với policy RESTRICTIVE `tenant_boundary` và PERMISSIVE `tenant_access` (04 §PostgreSQL và RLS). Mọi cột `*_id` có chỉ mục `<bảng>_<cột>_idx ON (tenant_id, <cột>)`. Cột NOT NULL thêm vào bảng hiện có được thêm nullable hoặc có DEFAULT, backfill rồi mới SET NOT NULL (expand-contract).

#### Bảng `land_handover_section` (mới)
Phân loại: Nội bộ. Lưu giữ: Theo RetentionPolicy hồ sơ dự án (DOC) [CXN-05]; legal hold chặn xóa.

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `tenant_id` | uuid | có |  |  |  |
| `id` | uuid | có |  |  |  |
| `project_id` | uuid | có |  | FK project |  |
| `contract_id` | uuid | không |  | FK contract | Hợp đồng thi công nhận mặt bằng đoạn này |
| `code` | text | có |  |  |  |
| `name` | text | có |  |  |  |
| `from_km` | numeric(8,2) | không |  |  | Km đầu (m, 3 chữ số thập phân cho tuyến) |
| `to_km` | numeric(8,2) | không |  |  |  |
| `required_area_m2` | numeric(14,2) | có |  | required_area_m2 >= 0 |  |
| `handed_area_m2` | numeric(14,2) | có | 0 | handed_area_m2 >= 0 |  |
| `target_date` | date | không |  |  |  |
| `handed_over_on` | date | không |  |  |  |
| `status` | text | có | 'NOT_READY' | ∈ {NOT_READY, PARTIAL, HANDED_OVER} |  |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | có |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | có |  |  |  |
| `version` | bigint | có | 1 |  |  |

Bất biến DB:
- CHECK `land_section_area_chk`: handed_area_m2 <= required_area_m2
- CHECK `land_section_km_chk`: from_km IS NULL OR to_km IS NULL OR from_km <= to_km
- UNIQUE INDEX `land_section_code_uq` (tenant_id, project_id, code)

Chỉ mục: `land_handover_section_project_id_idx`, `land_handover_section_contract_id_idx`.

#### Bảng `land_parcel` (mới)
Phân loại: Nội bộ. Lưu giữ: Theo RetentionPolicy hồ sơ dự án (DOC) [CXN-05]; legal hold chặn xóa.

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `tenant_id` | uuid | có |  |  |  |
| `id` | uuid | có |  |  |  |
| `project_id` | uuid | có |  | FK project |  |
| `section_id` | uuid | không |  | FK land_handover_section |  |
| `owner_unit_id` | uuid | có |  | FK organization_unit | Đơn vị phụ trách (xã/Trung tâm quỹ đất/Ban GPMB) — khóa phạm vi dữ liệu cá nhân |
| `parcel_code` | text | có |  |  | Số tờ/số thửa chuẩn hóa |
| `address_text` | text | không |  |  |  |
| `ward_master_version_id` | uuid | không |  | FK master_record_version | Địa bàn xã/phường (MDM) |
| `land_use_group` | text | có |  | ∈ {AGRICULTURAL, NON_AGRICULTURAL_RESIDENTIAL, NON_AGRICULTURAL_OTHER, PUBLIC} |  |
| `area_total_m2` | numeric(14,2) | có |  | area_total_m2 > 0 |  |
| `area_affected_m2` | numeric(14,2) | có |  | area_affected_m2 >= 0 |  |
| `boundary_geojson` | jsonb | không |  |  | Ranh giới (không chứa thông tin chủ sử dụng) |
| `status` | text | có | 'SURVEYED' | ∈ {SURVEYED, INVENTORIED, PLAN_DRAFTED, PLAN_POSTED, PLAN_APPROVED, PAID, HANDED_OVER, DISPUTED, ENFORCEMENT} |  |
| `recovery_notice_on` | date | không |  |  | Ngày thông báo thu hồi đất |
| `notice_days_applied` | smallint | không |  | ∈ {90, 180} | Số ngày thông báo áp dụng (90 nông nghiệp; 180 phi nông nghiệp) [CXN-12] |
| `recovery_decision_on` | date | không |  |  |  |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | có |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | có |  |  |  |
| `version` | bigint | có | 1 |  |  |

Bất biến DB:
- CHECK `land_parcel_area_chk`: area_affected_m2 <= area_total_m2
- CHECK `land_parcel_notice_chk`: recovery_decision_on IS NULL OR (recovery_notice_on IS NOT NULL AND notice_days_applied IS NOT NULL AND recovery_decision_on >= recovery_notice_on + notice_days_applied)
- UNIQUE INDEX `land_parcel_code_uq` (tenant_id, project_id, parcel_code)

Chỉ mục: `land_parcel_project_id_idx`, `land_parcel_section_id_idx`, `land_parcel_owner_unit_id_idx`, `land_parcel_ward_master_version_id_idx`, `land_parcel_status_idx`.

#### Bảng `affected_household` (mới)
Phân loại: Cá nhân (PERSONAL). Lưu giữ: Theo retention_until của hộ (cấu hình theo mục đích) và legal hold; xóa/ẩn danh theo yêu cầu chủ thể khi không còn nghĩa vụ lưu trữ [CXN-EXE-06]. Có thêm policy RESTRICTIVE `scope_units_guard` theo `app.scope_units` (fail-closed: thiếu giá trị thì không thấy dòng nào; `*` = cả tenant).

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `tenant_id` | uuid | có |  |  |  |
| `id` | uuid | có |  |  |  |
| `project_id` | uuid | có |  | FK project |  |
| `owner_unit_id` | uuid | có |  | FK organization_unit | Đơn vị phụ trách (xã/Trung tâm quỹ đất/Ban GPMB) — khóa phạm vi dữ liệu cá nhân |
| `household_code` | text | có |  |  | Mã hộ do hệ thống cấp (không dùng CCCD làm khóa) |
| `head_name` | text | có |  |  | PERSONAL — chủ hộ |
| `national_id_enc` | bytea | không |  |  | PERSONAL — mã hóa phong bì (KMS); chỉ giải mã khi có quyền lnd.pii.read |
| `national_id_hash` | char(64) | không |  |  | HMAC-SHA-256 có khóa theo tenant để chống trùng, không đảo ngược |
| `phone_enc` | bytea | không |  |  |  |
| `address_text` | text | không |  |  |  |
| `member_count` | integer | không |  | member_count > 0 |  |
| `policy_beneficiary` | boolean | có | false |  | Thuộc đối tượng chính sách (dữ liệu nhạy cảm) |
| `legal_basis` | text | có |  | ∈ {PUBLIC_TASK_LAND_LAW, LEGAL_OBLIGATION, CONSENT} | Căn cứ xử lý dữ liệu theo Luật BVDLCN 91/2025 [CXN-EXE-06] |
| `legal_basis_ref` | text | có |  |  | Điều khoản/Quyết định làm căn cứ |
| `consent_record_id` | uuid | không |  |  | ConsentRecord (IAM) — logical ref, bắt buộc khi legal_basis = CONSENT |
| `retention_until` | date | có |  |  |  |
| `dsr_open` | boolean | có | false |  | Có yêu cầu của chủ thể dữ liệu đang xử lý (chặn xóa/xuất) |
| `status` | text | có | 'REGISTERED' | ∈ {REGISTERED, INVENTORIED, PLAN_LISTED, COMPENSATED, RESETTLED, CLOSED, DISPUTED} |  |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | có |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | có |  |  |  |
| `version` | bigint | có | 1 |  |  |

Bất biến DB:
- CHECK `affected_household_consent_chk`: legal_basis <> 'CONSENT' OR consent_record_id IS NOT NULL
- UNIQUE INDEX `affected_household_code_uq` (tenant_id, project_id, household_code)
- UNIQUE INDEX `affected_household_nid_uq` (tenant_id, project_id, national_id_hash) WHERE national_id_hash IS NOT NULL

Chỉ mục: `affected_household_project_id_idx`, `affected_household_owner_unit_id_idx`, `affected_household_consent_record_id_idx`, `affected_household_status_idx`.

#### Bảng `household_parcel` (mới)
Phân loại: Cá nhân (PERSONAL). Lưu giữ: Theo retention_until của hộ (cấu hình theo mục đích) và legal hold; xóa/ẩn danh theo yêu cầu chủ thể khi không còn nghĩa vụ lưu trữ [CXN-EXE-06]. Có thêm policy RESTRICTIVE `scope_units_guard` theo `app.scope_units` (fail-closed: thiếu giá trị thì không thấy dòng nào; `*` = cả tenant).

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `tenant_id` | uuid | có |  |  |  |
| `id` | uuid | có |  |  |  |
| `household_id` | uuid | có |  | FK affected_household |  |
| `parcel_id` | uuid | có |  | FK land_parcel |  |
| `owner_unit_id` | uuid | có |  | FK organization_unit | Đơn vị phụ trách (xã/Trung tâm quỹ đất/Ban GPMB) — khóa phạm vi dữ liệu cá nhân |
| `right_kind` | text | có |  | ∈ {OWNER, USER, LESSEE, OCCUPANT_NO_TITLE} |  |
| `share_pct` | numeric(7,4) | có | 100 | share_pct > 0 AND share_pct <= 100 |  |
| `title_document_version_id` | uuid | không |  | FK document_version | Giấy chứng nhận/giấy tờ (PERSONAL) |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | có |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | có |  |  |  |
| `version` | bigint | có | 1 |  |  |

Bất biến DB:
- UNIQUE INDEX `household_parcel_uq` (tenant_id, household_id, parcel_id)

Chỉ mục: `household_parcel_household_id_idx`, `household_parcel_parcel_id_idx`, `household_parcel_owner_unit_id_idx`, `household_parcel_title_document_version_id_idx`.

#### Bảng `land_inventory_record` (mới)
Phân loại: Cá nhân (PERSONAL). Lưu giữ: Theo retention_until của hộ (cấu hình theo mục đích) và legal hold; xóa/ẩn danh theo yêu cầu chủ thể khi không còn nghĩa vụ lưu trữ [CXN-EXE-06]. Có thêm policy RESTRICTIVE `scope_units_guard` theo `app.scope_units` (fail-closed: thiếu giá trị thì không thấy dòng nào; `*` = cả tenant).

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `tenant_id` | uuid | có |  |  |  |
| `id` | uuid | có |  |  |  |
| `household_id` | uuid | có |  | FK affected_household |  |
| `parcel_id` | uuid | có |  | FK land_parcel |  |
| `owner_unit_id` | uuid | có |  | FK organization_unit | Đơn vị phụ trách (xã/Trung tâm quỹ đất/Ban GPMB) — khóa phạm vi dữ liệu cá nhân |
| `item_kind` | text | có |  | ∈ {LAND, HOUSE, STRUCTURE, CROP, TREE, GRAVE, BUSINESS_LOSS, OTHER} |  |
| `description` | text | có |  |  |  |
| `quantity` | numeric(24,6) | có |  | quantity > 0 |  |
| `unit_code` | text | có |  |  |  |
| `unit_price_vnd` | numeric(24,0) | có |  | unit_price_vnd >= 0 | Đơn giá theo quyết định giá đất/bảng giá còn hiệu lực |
| `amount_vnd` | numeric(24,0) | có |  | amount_vnd >= 0 |  |
| `price_decision_ref` | text | có |  |  | Quyết định giá áp dụng |
| `surveyed_on` | date | có |  |  |  |
| `surveyed_by` | uuid | có |  |  |  |
| `household_confirmed_on` | date | không |  |  |  |
| `household_dispute` | boolean | có | false |  |  |
| `evidence_photo_id` | uuid | không |  | FK site_photo |  |
| `document_version_id` | uuid | không |  | FK document_version | Biên bản kiểm đếm |
| `status` | text | có | 'DRAFT' | ∈ {DRAFT, CONFIRMED, DISPUTED, SUPERSEDED} |  |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | có |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | có |  |  |  |
| `version` | bigint | có | 1 |  |  |

Bất biến DB:
- CHECK `land_inventory_confirm_chk`: status <> 'CONFIRMED' OR household_confirmed_on IS NOT NULL

Chỉ mục: `land_inventory_record_household_id_idx`, `land_inventory_record_parcel_id_idx`, `land_inventory_record_owner_unit_id_idx`, `land_inventory_record_evidence_photo_id_idx`, `land_inventory_record_document_version_id_idx`, `land_inventory_household_status_idx`.

#### Bảng `compensation_plan` (mới)
Phân loại: Nội bộ. Lưu giữ: Theo RetentionPolicy hồ sơ dự án (DOC) [CXN-05]; legal hold chặn xóa.

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `tenant_id` | uuid | có |  |  |  |
| `id` | uuid | có |  |  |  |
| `project_id` | uuid | có |  | FK project |  |
| `section_id` | uuid | không |  | FK land_handover_section |  |
| `executor_unit_id` | uuid | có |  | FK organization_unit | Đơn vị thực hiện (Trung tâm quỹ đất/Hội đồng/Chủ đầu tư) |
| `executor_kind` | text | có |  | ∈ {PROJECT_OWNER, LAND_FUND_CENTRE, DISTRICT_BOARD} |  |
| `plan_code` | text | có |  |  |  |
| `revision` | integer | có | 1 | revision > 0 |  |
| `total_compensation_vnd` | numeric(24,0) | có | 0 |  |  |
| `total_support_vnd` | numeric(24,0) | có | 0 |  |  |
| `total_resettlement_vnd` | numeric(24,0) | có | 0 |  |  |
| `grand_total_vnd` | numeric(24,0) | không |  | sinh: total_compensation_vnd + total_support_vnd + total_resettlement_vnd |  |
| `status` | text | có | 'DRAFT' | ∈ {DRAFT, POSTING, POSTING_CLOSED, APPROVED, PAYING, COMPLETED, CANCELLED, REVISED} |  |
| `posting_started_on` | date | không |  |  |  |
| `posting_ends_on` | date | không |  |  | >= posting_started_on + số ngày niêm yết (30) [CXN-12] |
| `posting_place_text` | text | không |  |  |  |
| `feedback_summary` | text | không |  |  |  |
| `decision_document_version_id` | uuid | không |  | FK document_version | Quyết định phê duyệt phương án |
| `approved_on` | date | không |  |  |  |
| `payment_due_on` | date | không |  |  | approved_on + 30 ngày [CXN-12] |
| `timer_rule_version_id` | uuid | không |  |  | rule registry LND.TIMERS |
| `supersedes_id` | uuid | không |  | FK compensation_plan |  |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | có |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | có |  |  |  |
| `version` | bigint | có | 1 |  |  |

Bất biến DB:
- CHECK `compensation_plan_posting_chk`: status NOT IN ('POSTING','POSTING_CLOSED','APPROVED','PAYING','COMPLETED') OR (posting_started_on IS NOT NULL AND posting_ends_on IS NOT NULL AND posting_ends_on >= posting_started_on)
- CHECK `compensation_plan_approved_chk`: status NOT IN ('APPROVED','PAYING','COMPLETED') OR (approved_on IS NOT NULL AND payment_due_on IS NOT NULL AND decision_document_version_id IS NOT NULL AND approved_on >= posting_ends_on)
- UNIQUE INDEX `compensation_plan_rev_uq` (tenant_id, project_id, plan_code, revision)

Chỉ mục: `compensation_plan_project_id_idx`, `compensation_plan_section_id_idx`, `compensation_plan_executor_unit_id_idx`, `compensation_plan_decision_document_version_id_idx`, `compensation_plan_timer_rule_version_id_idx`, `compensation_plan_supersedes_id_idx`, `compensation_plan_status_idx`.

#### Bảng `compensation_plan_item` (mới)
Phân loại: Cá nhân (PERSONAL). Lưu giữ: Theo retention_until của hộ (cấu hình theo mục đích) và legal hold; xóa/ẩn danh theo yêu cầu chủ thể khi không còn nghĩa vụ lưu trữ [CXN-EXE-06]. Có thêm policy RESTRICTIVE `scope_units_guard` theo `app.scope_units` (fail-closed: thiếu giá trị thì không thấy dòng nào; `*` = cả tenant).

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `tenant_id` | uuid | có |  |  |  |
| `id` | uuid | có |  |  |  |
| `plan_id` | uuid | có |  | FK compensation_plan |  |
| `household_id` | uuid | có |  | FK affected_household |  |
| `parcel_id` | uuid | không |  | FK land_parcel |  |
| `owner_unit_id` | uuid | có |  | FK organization_unit | Đơn vị phụ trách (xã/Trung tâm quỹ đất/Ban GPMB) — khóa phạm vi dữ liệu cá nhân |
| `item_kind` | text | có |  | ∈ {COMPENSATION_LAND, COMPENSATION_ASSET, SUPPORT_LIVELIHOOD, SUPPORT_RELOCATION, SUPPORT_TRAINING, RESETTLEMENT_LAND, RESETTLEMENT_HOUSE} |  |
| `amount_vnd` | numeric(24,0) | có |  | amount_vnd >= 0 |  |
| `basis_inventory_id` | uuid | không |  | FK land_inventory_record |  |
| `legal_basis` | text | có |  |  |  |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | có |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | có |  |  |  |
| `version` | bigint | có | 1 |  |  |

Chỉ mục: `compensation_plan_item_plan_id_idx`, `compensation_plan_item_household_id_idx`, `compensation_plan_item_parcel_id_idx`, `compensation_plan_item_owner_unit_id_idx`, `compensation_plan_item_basis_inventory_id_idx`, `compensation_plan_item_plan_household_idx`.

#### Bảng `compensation_payment` (mới)
Phân loại: Cá nhân (PERSONAL). Lưu giữ: Theo retention_until của hộ (cấu hình theo mục đích) và legal hold; xóa/ẩn danh theo yêu cầu chủ thể khi không còn nghĩa vụ lưu trữ [CXN-EXE-06]. Có thêm policy RESTRICTIVE `scope_units_guard` theo `app.scope_units` (fail-closed: thiếu giá trị thì không thấy dòng nào; `*` = cả tenant).

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `tenant_id` | uuid | có |  |  |  |
| `id` | uuid | có |  |  |  |
| `plan_id` | uuid | có |  | FK compensation_plan |  |
| `household_id` | uuid | có |  | FK affected_household |  |
| `owner_unit_id` | uuid | có |  | FK organization_unit | Đơn vị phụ trách (xã/Trung tâm quỹ đất/Ban GPMB) — khóa phạm vi dữ liệu cá nhân |
| `payment_no` | smallint | có | 1 | payment_no > 0 |  |
| `amount_vnd` | numeric(24,0) | có |  | amount_vnd > 0 |  |
| `due_on` | date | có |  |  |  |
| `paid_on` | date | không |  |  |  |
| `method` | text | không |  | ∈ {BANK_TRANSFER, CASH_VOUCHER, TREASURY, DEPOSITED} |  |
| `bank_account_enc` | bytea | không |  |  | PERSONAL — mã hóa phong bì |
| `treasury_transaction_id` | uuid | không |  | FK treasury_transaction |  |
| `advance_id` | uuid | không |  | FK contract_advance | Tạm ứng GPMB được thu hồi bằng khoản chi này |
| `voucher_document_version_id` | uuid | không |  | FK document_version |  |
| `deposit_reason` | text | không |  |  |  |
| `status` | text | có | 'PENDING' | ∈ {PENDING, PAID, DEPOSITED, CANCELLED} |  |
| `overdue_flagged_at` | timestamptz | không |  |  |  |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | có |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | có |  |  |  |
| `version` | bigint | có | 1 |  |  |

Bất biến DB:
- CHECK `compensation_payment_paid_chk`: status NOT IN ('PAID','DEPOSITED') OR (paid_on IS NOT NULL AND method IS NOT NULL AND voucher_document_version_id IS NOT NULL)
- CHECK `compensation_payment_deposit_chk`: status <> 'DEPOSITED' OR deposit_reason IS NOT NULL
- UNIQUE INDEX `compensation_payment_uq` (tenant_id, plan_id, household_id, payment_no)

Chỉ mục: `compensation_payment_plan_id_idx`, `compensation_payment_household_id_idx`, `compensation_payment_owner_unit_id_idx`, `compensation_payment_treasury_transaction_id_idx`, `compensation_payment_advance_id_idx`, `compensation_payment_voucher_document_version_id_idx`, `compensation_payment_due_idx`.

#### Bảng `land_complaint` (mới)
Phân loại: Cá nhân (PERSONAL). Lưu giữ: Theo retention_until của hộ (cấu hình theo mục đích) và legal hold; xóa/ẩn danh theo yêu cầu chủ thể khi không còn nghĩa vụ lưu trữ [CXN-EXE-06]. Có thêm policy RESTRICTIVE `scope_units_guard` theo `app.scope_units` (fail-closed: thiếu giá trị thì không thấy dòng nào; `*` = cả tenant).

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `tenant_id` | uuid | có |  |  |  |
| `id` | uuid | có |  |  |  |
| `project_id` | uuid | có |  | FK project |  |
| `household_id` | uuid | có |  | FK affected_household |  |
| `plan_id` | uuid | không |  | FK compensation_plan |  |
| `owner_unit_id` | uuid | có |  | FK organization_unit | Đơn vị phụ trách (xã/Trung tâm quỹ đất/Ban GPMB) — khóa phạm vi dữ liệu cá nhân |
| `complaint_no` | text | có |  |  |  |
| `filed_on` | date | có |  |  |  |
| `channel` | text | có |  | ∈ {IN_PERSON, LETTER, PORTAL, MEETING} |  |
| `subject` | text | có |  | ∈ {PRICE, AREA, ELIGIBILITY, RESETTLEMENT, PROCEDURE, OTHER} |  |
| `description` | text | có |  |  | PERSONAL |
| `status` | text | có | 'RECEIVED' | ∈ {RECEIVED, UNDER_REVIEW, RESOLVED_ACCEPTED, RESOLVED_REJECTED, ESCALATED, CLOSED} |  |
| `due_on` | date | có |  |  | Hạn giải quyết theo rule |
| `resolved_on` | date | không |  |  |  |
| `resolution_document_version_id` | uuid | không |  | FK document_version |  |
| `issue_id` | uuid | không |  | FK issue | Vướng mắc ISS tự tạo (chỉ chứa mã, không chứa nội dung khiếu nại) |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | có |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | có |  |  |  |
| `version` | bigint | có | 1 |  |  |

Bất biến DB:
- CHECK `land_complaint_resolved_chk`: status NOT IN ('RESOLVED_ACCEPTED','RESOLVED_REJECTED') OR (resolved_on IS NOT NULL AND resolution_document_version_id IS NOT NULL)
- UNIQUE INDEX `land_complaint_no_uq` (tenant_id, project_id, complaint_no)

Chỉ mục: `land_complaint_project_id_idx`, `land_complaint_household_id_idx`, `land_complaint_plan_id_idx`, `land_complaint_owner_unit_id_idx`, `land_complaint_resolution_document_version_id_idx`, `land_complaint_issue_id_idx`, `land_complaint_due_idx`.

#### Bảng `land_enforcement_case` (mới)
Phân loại: Cá nhân (PERSONAL). Lưu giữ: Theo retention_until của hộ (cấu hình theo mục đích) và legal hold; xóa/ẩn danh theo yêu cầu chủ thể khi không còn nghĩa vụ lưu trữ [CXN-EXE-06]. Có thêm policy RESTRICTIVE `scope_units_guard` theo `app.scope_units` (fail-closed: thiếu giá trị thì không thấy dòng nào; `*` = cả tenant).

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `tenant_id` | uuid | có |  |  |  |
| `id` | uuid | có |  |  |  |
| `project_id` | uuid | có |  | FK project |  |
| `parcel_id` | uuid | có |  | FK land_parcel |  |
| `household_id` | uuid | không |  | FK affected_household |  |
| `plan_id` | uuid | không |  | FK compensation_plan |  |
| `owner_unit_id` | uuid | có |  | FK organization_unit | Đơn vị phụ trách (xã/Trung tâm quỹ đất/Ban GPMB) — khóa phạm vi dữ liệu cá nhân |
| `authority_unit_id` | uuid | không |  | FK organization_unit | Cơ quan ban hành quyết định cưỡng chế |
| `step` | text | có | 'PERSUASION' | ∈ {PERSUASION, NOTICE, ORGANIZATION_DECISION, ENFORCEMENT_DECISION, EXECUTING, COMPLETED, SUSPENDED} |  |
| `started_on` | date | có |  |  |  |
| `decision_document_version_id` | uuid | không |  | FK document_version |  |
| `planned_on` | date | không |  |  |  |
| `executed_on` | date | không |  |  |  |
| `legal_basis` | text | có |  |  |  |
| `suspend_reason` | text | không |  |  |  |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | có |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | có |  |  |  |
| `version` | bigint | có | 1 |  |  |

Bất biến DB:
- CHECK `land_enforcement_exec_chk`: step NOT IN ('EXECUTING','COMPLETED') OR (decision_document_version_id IS NOT NULL AND planned_on IS NOT NULL)
- CHECK `land_enforcement_suspend_chk`: step <> 'SUSPENDED' OR suspend_reason IS NOT NULL

Chỉ mục: `land_enforcement_case_project_id_idx`, `land_enforcement_case_parcel_id_idx`, `land_enforcement_case_household_id_idx`, `land_enforcement_case_plan_id_idx`, `land_enforcement_case_owner_unit_id_idx`, `land_enforcement_case_authority_unit_id_idx`, `land_enforcement_case_decision_document_version_id_idx`.

#### Bảng `resettlement_allocation` (mới)
Phân loại: Cá nhân (PERSONAL). Lưu giữ: Theo retention_until của hộ (cấu hình theo mục đích) và legal hold; xóa/ẩn danh theo yêu cầu chủ thể khi không còn nghĩa vụ lưu trữ [CXN-EXE-06]. Có thêm policy RESTRICTIVE `scope_units_guard` theo `app.scope_units` (fail-closed: thiếu giá trị thì không thấy dòng nào; `*` = cả tenant).

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `tenant_id` | uuid | có |  |  |  |
| `id` | uuid | có |  |  |  |
| `household_id` | uuid | có |  | FK affected_household |  |
| `plan_item_id` | uuid | không |  | FK compensation_plan_item |  |
| `owner_unit_id` | uuid | có |  | FK organization_unit | Đơn vị phụ trách (xã/Trung tâm quỹ đất/Ban GPMB) — khóa phạm vi dữ liệu cá nhân |
| `unit_kind` | text | có |  | ∈ {PLOT, APARTMENT, HOUSE} |  |
| `unit_code` | text | có |  |  |  |
| `site_text` | text | có |  |  | Khu tái định cư |
| `area_m2` | numeric(14,2) | không |  | area_m2 > 0 |  |
| `priority_rank` | integer | không |  |  |  |
| `allocated_on` | date | không |  |  |  |
| `handed_on` | date | không |  |  |  |
| `status` | text | có | 'ELIGIBLE' | ∈ {ELIGIBLE, ALLOCATED, HANDED_OVER, DECLINED} |  |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | có |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | có |  |  |  |
| `version` | bigint | có | 1 |  |  |

Bất biến DB:
- CHECK `resettlement_handed_chk`: status <> 'HANDED_OVER' OR (allocated_on IS NOT NULL AND handed_on IS NOT NULL)
- UNIQUE INDEX `resettlement_unit_uq` (tenant_id, unit_code) WHERE status IN ('ALLOCATED','HANDED_OVER')

Chỉ mục: `resettlement_allocation_household_id_idx`, `resettlement_allocation_plan_item_id_idx`, `resettlement_allocation_owner_unit_id_idx`.

#### Bảng `land_stage_progress` (mới)
Phân loại: Nội bộ. Lưu giữ: Theo RetentionPolicy hồ sơ dự án (DOC) [CXN-05]; legal hold chặn xóa.

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `tenant_id` | uuid | có |  |  |  |
| `id` | uuid | có |  |  |  |
| `project_id` | uuid | có |  | FK project |  |
| `section_id` | uuid | có |  | FK land_handover_section |  |
| `plan_id` | uuid | không |  | FK compensation_plan |  |
| `stage_code` | text | có |  | ∈ {SURVEY, NOTICE, INVENTORY, PLAN_DRAFT, PLAN_POSTING, PLAN_APPROVAL, PAYMENT, HANDOVER, ENFORCEMENT} |  |
| `executor_kind` | text | có |  | ∈ {PROJECT_OWNER, LAND_FUND_CENTRE, DISTRICT_BOARD} |  |
| `executor_unit_id` | uuid | có |  | FK organization_unit |  |
| `mode` | text | có |  | ∈ {NATIVE, TRACKED_EXTERNAL} | TRACKED_EXTERNAL = Trung tâm quỹ đất thực hiện, MACHVON chỉ theo dõi tiến độ |
| `planned_start` | date | không |  |  |  |
| `planned_end` | date | không |  |  |  |
| `actual_start` | date | không |  |  |  |
| `actual_end` | date | không |  |  |  |
| `parcels_total` | integer | có | 0 | parcels_total >= 0 |  |
| `parcels_done` | integer | có | 0 | parcels_done >= 0 |  |
| `progress_pct` | numeric(5,2) | không |  | sinh: CASE WHEN parcels_total = 0 THEN 0 ELSE round(100.0 * parcels_done / parcels_total, 2) END |  |
| `last_reported_by` | uuid | không |  |  |  |
| `last_reported_at` | timestamptz | không |  |  |  |
| `evidence_document_version_id` | uuid | không |  | FK document_version |  |
| `status` | text | có | 'NOT_STARTED' | ∈ {NOT_STARTED, IN_PROGRESS, DONE, BLOCKED, LATE} |  |
| `blocker_issue_id` | uuid | không |  | FK issue |  |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | có |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | có |  |  |  |
| `version` | bigint | có | 1 |  |  |

Bất biến DB:
- CHECK `land_stage_progress_done_chk`: parcels_done <= parcels_total
- CHECK `land_stage_done_chk`: status <> 'DONE' OR actual_end IS NOT NULL
- UNIQUE INDEX `land_stage_progress_uq` (tenant_id, section_id, stage_code, plan_id) NULLS NOT DISTINCT

Chỉ mục: `land_stage_progress_project_id_idx`, `land_stage_progress_section_id_idx`, `land_stage_progress_plan_id_idx`, `land_stage_progress_executor_unit_id_idx`, `land_stage_progress_evidence_document_version_id_idx`, `land_stage_progress_blocker_issue_id_idx`.

#### Bảng `land_deadline` (mới)
Phân loại: Nội bộ. Lưu giữ: Theo RetentionPolicy hồ sơ dự án (DOC) [CXN-05]; legal hold chặn xóa.

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `tenant_id` | uuid | có |  |  |  |
| `id` | uuid | có |  |  |  |
| `project_id` | uuid | có |  | FK project |  |
| `subject_kind` | text | có |  | ∈ {PARCEL, PLAN, PAYMENT, COMPLAINT} |  |
| `subject_id` | uuid | có |  |  | Đối tượng bị đếm ngày (logical, theo subject_kind) |
| `timer_code` | text | có |  | ∈ {NOTICE_AGRICULTURAL_90, NOTICE_NON_AGRICULTURAL_180, PLAN_POSTING_30, PAYMENT_30, COMPLAINT_RESOLUTION} |  |
| `days_applied` | integer | có |  | days_applied > 0 |  |
| `started_on` | date | có |  |  |  |
| `due_on` | date | có |  |  |  |
| `satisfied_on` | date | không |  |  |  |
| `status` | text | có | 'RUNNING' | ∈ {RUNNING, SATISFIED, BREACHED, CANCELLED} |  |
| `rule_version_id` | uuid | không |  |  | rule registry LND.TIMERS (legal_basis + hiệu lực) [CXN-12] |
| `alert_level_sent` | smallint | có | 0 | alert_level_sent BETWEEN 0 AND 4 |  |
| `issue_id` | uuid | không |  | FK issue |  |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | có |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | có |  |  |  |
| `version` | bigint | có | 1 |  |  |

Bất biến DB:
- CHECK `land_deadline_dates_chk`: due_on >= started_on
- CHECK `land_deadline_satisfied_chk`: status <> 'SATISFIED' OR satisfied_on IS NOT NULL
- UNIQUE INDEX `land_deadline_running_uq` (tenant_id, subject_kind, subject_id, timer_code) WHERE status = 'RUNNING'

Chỉ mục: `land_deadline_project_id_idx`, `land_deadline_subject_id_idx`, `land_deadline_rule_version_id_idx`, `land_deadline_issue_id_idx`, `land_deadline_due_idx`.


## 7. API / command

Mọi lệnh ghi: `Idempotency-Key` (≥16 ký tự) bắt buộc; `If-Match` bắt buộc khi đổi bản ghi có version (cột "If-Match" = có); lỗi trả RFC 7807 Problem với `code` ổn định; DTO là allowlist (trường thừa → 400 INVALID_REQUEST); không có endpoint ghi chung cho `status`, `tenant_id`, role hoặc số tiền đã chốt. Mã lỗi chung ngoài bảng: 401 SESSION_EXPIRED, 403 SCOPE_DENIED, 404 RESOURCE_NOT_FOUND, 409 IDEMPOTENCY_CONFLICT, 422 VALIDATION_FAILED, 429 RATE_LIMIT, 503 PROVIDER_UNAVAILABLE.

| operationId | Method path | Quyền (x-permission) | Request DTO (trường được phép; * = bắt buộc) | Response | Lỗi (HTTP + code) | Idempotency | If-Match |
|---|---|---|---|---|---|---|---|
| `createLandSection` | `POST /land-sections` | `land.manage` | project_id*, contract_id, code*, name*, from_km, to_km, required_area_m2*, target_date | CommandResult | 409 SECTION_CODE_DUPLICATE; 422 VALIDATION_FAILED; 403 SCOPE_DENIED | bắt buộc | không |
| `recordSectionHandover` | `POST /land-sections/{id}/handover` | `land.handover` | handed_area_m2*, handed_over_on*, handover_document_version_id* | CommandResult | 422 HANDED_AREA_EXCEEDS_REQUIRED; 422 PARCELS_NOT_READY; 409 CONTRACT_STATE_INVALID; 409 VERSION_CONFLICT | bắt buộc | có |
| `createLandParcel` | `POST /land-parcels` | `land.manage` | project_id*, section_id, owner_unit_id*, parcel_code*, address_text, ward_master_version_id, land_use_group*, area_total_m2*, area_affected_m2*, boundary_geojson | CommandResult | 409 PARCEL_CODE_DUPLICATE; 422 AREA_INVALID; 422 VALIDATION_FAILED | bắt buộc | không |
| `importLandParcels` | `POST /land-parcels/import` | `land.manage` | project_id*, file_object_id*, file_sha256* | CommandResult | 422 FILE_NOT_CLEAN; 422 HASH_MISMATCH; 422 IMPORT_SCHEMA_INVALID | bắt buộc | không |
| `recordRecoveryNotice` | `POST /land-parcels/{id}/recovery-notice` | `land.process` | notice_on*, notice_document_version_id* | CommandResult | 409 PARCEL_STATE_INVALID; 422 TIMER_RULE_UNCONFIRMED; 409 VERSION_CONFLICT | bắt buộc | có |
| `registerAffectedHousehold` | `POST /affected-households` | `land.household.write` | project_id*, owner_unit_id*, head_name*, national_id, phone, address_text, member_count, policy_beneficiary, legal_basis*, legal_basis_ref*, consent_record_id, retention_until* | CommandResult | 422 LEGAL_BASIS_REQUIRED; 422 CONSENT_REQUIRED; 409 HOUSEHOLD_DUPLICATE; 403 SCOPE_DENIED; 422 VALIDATION_FAILED | bắt buộc | không |
| `linkHouseholdParcel` | `POST /affected-households/{id}/parcels` | `land.household.write` | parcel_id*, right_kind*, share_pct, title_document_version_id | CommandResult | 409 LINK_DUPLICATE; 422 SHARE_EXCEEDS_100; 403 SCOPE_DENIED | bắt buộc | không |
| `handleHouseholdDataRequest` | `POST /affected-households/{id}/data-requests` | `land.dsr.handle` | request_kind*, requester_verified*, outcome*, reason* | CommandResult | 409 RETENTION_LEGAL_HOLD; 422 REQUESTER_NOT_VERIFIED; 403 SCOPE_DENIED | bắt buộc | không |
| `recordInventory` | `POST /land-inventory-records` | `land.process` | household_id*, parcel_id*, item_kind*, description*, quantity*, unit_code*, unit_price_vnd*, price_decision_ref*, surveyed_on*, evidence_photo_id, document_version_id | CommandResult | 422 PRICE_DECISION_NOT_EFFECTIVE; 422 HOUSEHOLD_PARCEL_NOT_LINKED; 422 VALIDATION_FAILED | bắt buộc | không |
| `confirmInventory` | `POST /land-inventory-records/{id}/confirm` | `land.process` | outcome*, household_confirmed_on*, note | CommandResult | 409 INVENTORY_STATE_INVALID; 409 VERSION_CONFLICT | bắt buộc | có |
| `draftCompensationPlan` | `POST /compensation-plans` | `land.plan.write` | project_id*, section_id, executor_unit_id*, executor_kind*, plan_code* | CommandResult | 409 PLAN_CODE_DUPLICATE; 422 VALIDATION_FAILED | bắt buộc | không |
| `addCompensationPlanItems` | `POST /compensation-plans/{id}/items` | `land.plan.write` | items* | CommandResult | 409 PLAN_STATE_INVALID; 422 INVENTORY_NOT_CONFIRMED; 409 VERSION_CONFLICT | bắt buộc | có |
| `postCompensationPlan` | `POST /compensation-plans/{id}/post` | `land.plan.write` | posting_started_on*, posting_place_text* | CommandResult | 409 PLAN_STATE_INVALID; 422 INVENTORY_NOT_CONFIRMED; 422 TIMER_RULE_UNCONFIRMED; 409 VERSION_CONFLICT | bắt buộc | có |
| `recordPlanFeedback` | `POST /compensation-plans/{id}/feedback` | `land.plan.write` | household_id, summary*, channel* | CommandResult | 409 PLAN_STATE_INVALID | bắt buộc | không |
| `closePlanPosting` | `POST /compensation-plans/{id}/close-posting` | `land.plan.write` | feedback_summary* | CommandResult | 422 POSTING_PERIOD_NOT_ELAPSED; 409 PLAN_STATE_INVALID; 409 VERSION_CONFLICT | bắt buộc | có |
| `approveCompensationPlan` | `POST /compensation-plans/{id}/approve` | `land.plan.approve` | approved_on*, decision_document_version_id* | CommandResult | 422 POSTING_PERIOD_NOT_ELAPSED; 422 UNRESOLVED_FEEDBACK; 403 SELF_APPROVAL_FORBIDDEN; 422 DECISION_DOCUMENT_REQUIRED; 409 PLAN_STATE_INVALID; 409 VERSION_CONFLICT | bắt buộc | có |
| `revisePlan` | `POST /compensation-plans/{id}/revise` | `land.plan.write` | reason* | CommandResult | 409 PLAN_STATE_INVALID; 409 VERSION_CONFLICT | bắt buộc | có |
| `scheduleCompensationPayments` | `POST /compensation-plans/{id}/payments` | `land.payment.write` | payments* | CommandResult | 409 PLAN_STATE_INVALID; 422 PAYMENT_EXCEEDS_PLAN; 409 VERSION_CONFLICT | bắt buộc | có |
| `confirmCompensationPayment` | `POST /compensation-payments/{id}/confirm` | `land.payment.write` | paid_on*, method*, voucher_document_version_id*, treasury_transaction_id, advance_id | CommandResult | 409 PAYMENT_STATE_INVALID; 422 PAYMENT_LATE_REASON_REQUIRED; 422 ADVANCE_RECOVERY_EXCEEDED; 409 VERSION_CONFLICT | bắt buộc | có |
| `depositCompensationPayment` | `POST /compensation-payments/{id}/deposit` | `land.payment.write` | deposit_reason*, voucher_document_version_id*, paid_on* | CommandResult | 409 PAYMENT_STATE_INVALID; 409 VERSION_CONFLICT | bắt buộc | có |
| `fileLandComplaint` | `POST /land-complaints` | `land.complaint.write` | project_id*, household_id*, plan_id, owner_unit_id*, channel*, subject*, description*, filed_on* | CommandResult | 422 HOUSEHOLD_NOT_FOUND; 422 VALIDATION_FAILED | bắt buộc | không |
| `resolveLandComplaint` | `POST /land-complaints/{id}/resolve` | `land.complaint.resolve` | outcome*, resolution_document_version_id, resolved_on*, note* | CommandResult | 422 DECISION_DOCUMENT_REQUIRED; 409 COMPLAINT_STATE_INVALID; 409 VERSION_CONFLICT | bắt buộc | có |
| `startEnforcement` | `POST /land-enforcement-cases` | `land.enforce.write` | project_id*, parcel_id*, household_id, plan_id, owner_unit_id*, authority_unit_id*, legal_basis*, started_on* | CommandResult | 422 PRECONDITION_NOT_MET; 422 PAYMENT_NOT_OFFERED; 422 VALIDATION_FAILED | bắt buộc | không |
| `advanceEnforcement` | `POST /land-enforcement-cases/{id}/advance` | `land.enforce.write` | to_step*, decision_document_version_id, planned_on, executed_on, suspend_reason | CommandResult | 422 DECISION_DOCUMENT_REQUIRED; 422 ENFORCEMENT_STEP_INVALID; 403 SELF_APPROVAL_FORBIDDEN; 409 VERSION_CONFLICT | bắt buộc | có |
| `allocateResettlement` | `POST /resettlement-allocations` | `land.resettle.write` | household_id*, plan_item_id, owner_unit_id*, unit_kind*, unit_code*, site_text*, area_m2, priority_rank | CommandResult | 409 UNIT_ALREADY_ALLOCATED; 422 HOUSEHOLD_NOT_ELIGIBLE; 422 VALIDATION_FAILED | bắt buộc | không |
| `reportLandStageProgress` | `POST /land-stage-progress/report` | `land.progress.report` | project_id*, section_id*, plan_id, stage_code*, executor_kind*, executor_unit_id*, mode*, parcels_total*, parcels_done*, planned_start, planned_end, actual_start, actual_end, evidence_document_version_id, blocker_note | CommandResult | 422 PARCELS_DONE_EXCEEDS_TOTAL; 422 NATIVE_STAGE_READONLY; 422 VALIDATION_FAILED | bắt buộc | không |
| `getLandProgress` | `GET /projects/{id}/land-progress` | `land.read` | section_id | DTO đọc (read model) | — | — | không |
| `getCompensationPlanTimers` | `GET /compensation-plans/{id}/timers` | `land.read` | (không) | DTO đọc (read model) | — | — | không |
| `listUpcomingLandDeadlines` | `GET /land-deadlines/upcoming` | `land.read` | within_days, cursor, limit | DTO đọc (read model) | — | — | không |
| `listAffectedHouseholds` | `GET /affected-households` | `land.household.read` | project_id, status, cursor, limit | DTO đọc (read model) | — | — | không |

Mô tả ngắn từng lệnh (summary OpenAPI) và guard trạng thái nằm ở `openapi.json` (`x-state-guard`, `x-domain-events`, `x-error-codes`).

GET scaffold: phân hệ LND không có tài nguyên `/resources/*` từ baseline; mọi đọc đi qua read model DTO (`listAffectedHouseholds`, `getLandProgress`, `getCompensationPlanTimers`, `listUpcomingLandDeadlines`) — không expose bảng hộ dân dạng thô.

## 8. UI/UX

Tuân thủ mockup (D-B11). Dữ liệu cá nhân che mặc định với biểu tượng “hiện” chỉ khi có quyền (mỗi lần hiện ghi audit). Bản đồ thửa không hiển thị tên chủ sử dụng.

| ID | Tên màn hình | Loại | Nền tảng | Phase | Trường chính | Command / API | Ghi chú nghiệp vụ |
|---|---|---|---|---|---|---|---|
| LND-01 | Tổng quan GPMB theo dự án | dashboard | web | P1 | Số thửa, Số hộ, Đã niêm yết, Đã chi trả, Diện tích đã bàn giao, Giai đoạn trễ, Đơn vị thực hiện | `getLandProgress` | Số liệu theo snapshot; tiến độ hiển thị kể cả khi Trung tâm quỹ đất thực hiện (UC-LND-04) |
| LND-02 | Thửa đất và ranh giới | map | web | P1 | Thửa, Địa bàn, Nhóm đất, Diện tích, Diện tích thu hồi, Thông báo thu hồi, Trạng thái | `createLandParcel`, `importLandParcels`, `recordRecoveryNotice` | Không hiển thị chủ sử dụng; nhóm đất quyết định bộ đếm 90/180 ngày (UC-LND-01) |
| LND-03 | Hộ bị ảnh hưởng | table | web | P1 | Mã hộ, Chủ hộ, CCCD (che), Thửa, Căn cứ xử lý dữ liệu, Trạng thái | `registerAffectedHousehold`, `linkHouseholdParcel`, `listAffectedHouseholds` | Dữ liệu PERSONAL: mã hóa, che khi hiển thị, giới hạn theo đơn vị; cần căn cứ xử lý và thời hạn lưu (UC-LND-05) |
| LND-04 | Kiểm đếm | form | web | P1 | Hộ, Thửa, Loại tài sản, Số lượng, Đơn giá (quyết định giá), Thành tiền, Hộ xác nhận | `recordInventory`, `confirmInventory` | Đơn giá phải theo quyết định giá còn hiệu lực; hộ phản đối chuyển DISPUTED (UC-LND-01) |
| LND-05 | Phương án bồi thường, hỗ trợ, tái định cư | approval | web | P1 | Phương án, Đơn vị thực hiện, Tổng bồi thường, Tổng hỗ trợ, Tổng tái định cư, Tổng cộng, Quyết định | `draftCompensationPlan`, `addCompensationPlanItems`, `approveCompensationPlan`, `revisePlan` | Chỉ dựa trên kiểm đếm đã xác nhận; duyệt sau niêm yết đủ ngày và xử lý ý kiến; duyệt khác người lập (UC-LND-01) |
| LND-06 | Niêm yết 30 ngày và ý kiến | timeline | web | P1 | Phương án, Bắt đầu niêm yết, Kết thúc tối thiểu, Ý kiến, Đã xử lý, Mốc còn lại | `postCompensationPlan`, `recordPlanFeedback`, `closePlanPosting`, `getCompensationPlanTimers` | Bộ đếm theo rule hiệu lực; không đóng niêm yết sớm (UC-LND-01) |
| LND-07 | Chi trả bồi thường | funding | web | P1 | Hộ, Số tiền, Hạn chi trả, Ngày chi, Phương thức, Chứng từ, Tạm ứng GPMB liên quan | `scheduleCompensationPayments`, `confirmCompensationPayment`, `depositCompensationPayment` | Chi trong 30 ngày kể từ phê duyệt; trễ phải có lý do; gửi tiền khi hộ không nhận (UC-LND-02) |
| LND-08 | Khiếu nại | board | web | P1 | Mã, Hộ, Nội dung (PERSONAL), Hạn giải quyết, Trạng thái, Vướng mắc liên kết | `fileLandComplaint`, `resolveLandComplaint` | Vướng mắc ISS chỉ chứa mã, không chứa nội dung khiếu nại (UC-LND-03) |
| LND-09 | Cưỡng chế | workflow | web | P2 | Thửa, Bước, Cơ quan, Quyết định, Ngày dự kiến, Ngày thực hiện | `startEnforcement`, `advanceEnforcement` | Cần điều kiện tiên quyết và quyết định cho bước thực hiện; người chuyển bước khác người lập (UC-LND-03) |
| LND-10 | Bàn giao mặt bằng theo đoạn/km | table | web | P1 | Đoạn, Từ km – đến km, Diện tích cần, Đã bàn giao, Hợp đồng nhận, Hạn mục tiêu, Trạng thái | `createLandSection`, `recordSectionHandover` | Chỉ bàn giao cho hợp đồng ACTIVE; không vượt diện tích cần (UC-LND-04) |
| LND-11 | Theo dõi tiến độ khi Trung tâm quỹ đất thực hiện | board | web | P1 | Giai đoạn, Đơn vị thực hiện, Chế độ (tự thực hiện / theo dõi ngoài), Số thửa xong / tổng, Tiến độ %, Hạn, Trạng thái | `reportLandStageProgress`, `listUpcomingLandDeadlines` | Chế độ theo dõi ngoài nhận báo cáo có bằng chứng; trễ hạn tạo vướng mắc (UC-LND-04) |
| LND-12 | Tái định cư | form | web | P2 | Hộ, Loại, Mã lô/căn, Khu tái định cư, Thứ tự ưu tiên, Ngày bàn giao | `allocateResettlement` | Một lô/căn chỉ gán cho một hộ tại một thời điểm (UC-LND-01) |
| LND-13 | Yêu cầu của chủ thể dữ liệu | confirm | web | P1 | Hộ, Loại yêu cầu, Đã xác minh người yêu cầu, Kết quả, Lý do | `handleHouseholdDataRequest` | Không xóa dữ liệu đang là chứng từ chi trả; ghi lý do từ chối một phần (UC-LND-05) |


**Trạng thái riêng.** “Đang niêm yết – còn n ngày”, “quá hạn chi trả n ngày”, “tranh chấp”, “đơn vị thực hiện ngoài – theo dõi”, “PII bị che”. **Web/mobile.** Web. Không đồng bộ bảng hộ dân, kiểm đếm, chi trả, khiếu nại lên thiết bị di động (04 §PowerSync); app chỉ chụp ảnh hiện trường thửa (QMS-10) và xem tổng hợp không PII.

## 9. Sự kiện, job, tích hợp, quan sát

**Phát.** `lnd.section.created/handed_over.v1` {section_id, project_id, contract_id, handed_area_m2}; `lnd.parcel.created/imported/notice_recorded.v1`; `lnd.household.registered/parcel_linked/dsr_handled.v1` (chỉ id); `lnd.inventory.recorded/confirmed.v1`; `lnd.plan.drafted/items_changed/posted/feedback_recorded/posting_closed/approved/revised.v1`; `lnd.payment.scheduled/paid/deposited.v1` {payment_id, plan_id, amount_vnd, advance_id?}; `lnd.complaint.filed/resolved.v1`; `lnd.enforcement.started/advanced.v1`; `lnd.resettlement.allocated.v1`; `lnd.stage_progress.reported.v1`; `lnd.deadline.breached.v1`. Payload không chứa PII.
**Job.** `land-deadlines` (06:00 VN: cảnh báo, BREACHED, vướng mắc), `land-stage-late` (06:00 VN), `household-retention` (hằng tuần: ẩn danh khi hết hạn lưu).
**Tích hợp.** Nhập tệp danh sách thửa/hộ (PROPOSED); không có API địa chính (MISSING).
**Quan sát.** `lnd_parcels{status}`, `lnd_payment_overdue`, `lnd_pii_decrypt_total` (cảnh báo khi tăng bất thường), `lnd_stage_late`. Log không chứa PII; trace attribute chỉ id.

## 10. Kiểm thử

Bộ fixture synthetic dùng chung được định nghĩa tại `PAY.md` §10 (nhãn [EXE-FX]); mọi ID/người dùng trong bảng là dữ liệu giả. Các test dưới đây là nguồn của `test_cases.json` (ID `UAT-AC…`); loại: domain / integration / security / concurrency / performance / E2E.

| ID | Loại | Ưu tiên | Tình huống | Setup | Input | Bước | Expected | Bằng chứng |
|---|---|---|---|---|---|---|---|---|
| UAT-AC376 | domain | P0 | Bộ đếm thông báo thu hồi đất 90/180 ngày theo loại đất | [EXE-FX] Rule LND.TIMERS fixture RULE-LND-FIX-1 (không phải văn bản pháp luật, trạng thái CXN-12 chưa xác nhận): NOTICE_AGRICULTURAL_90 = 90 ngày, NOTICE_NON_AGRICULTURAL_180 = 180 ngày; thửa LP-A-001 land_use_group AGRICULTURAL, LP-A-002 NON_AGRICULTURAL_RESIDENTIAL; chưa có thông báo. | recordRecoveryNotice notice_on=2026-07-01 cho cả hai; ghi recovery_decision_on=2026-09-28 và 2026-09-29 cho LP-A-001; 2026-12-27 và 2026-12-28 cho LP-A-002 (UPDATE trực tiếp để kiểm CHECK). | 1. Ghi thông báo cho LP-A-001 và LP-A-002; đọc land_deadline. 2. Cập nhật recovery_decision_on LP-A-001 = 2026-09-28 rồi 2026-09-29. 3. Cập nhật LP-A-002 = 2026-12-27 rồi 2026-12-28. 4. Đổi rule sang bản chưa bật và ghi thông báo cho LP-A-003. | LP-A-001: days_applied=90, due_on=2026-09-29; LP-A-002: days_applied=180, due_on=2026-12-28 (notice_days_applied lưu 90/180). Quyết định 2026-09-28: lỗi CHECK land_parcel_notice_chk / 422 NOTICE_PERIOD_NOT_ELAPSED; 2026-09-29: chấp nhận, land_deadline SATISFIED. LP-A-002 2026-12-27 bị chặn, 2026-12-28 chấp nhận. Rule chưa bật: 422 TIMER_RULE_UNCONFIRMED. | Bảng land_parcel/land_deadline, lỗi CHECK |
| UAT-AC377 | domain | P0 | Niêm yết phương án 30 ngày và xử lý ý kiến trước khi phê duyệt | [EXE-FX] Phương án CP-A-001 DRAFT, 12 khoản đều dựa trên kiểm đếm CONFIRMED; rule PLAN_POSTING_30 = 30 ngày (RULE-LND-FIX-1); có 2 ý kiến chưa xử lý. | postCompensationPlan posting_started_on=2026-08-01; closePlanPosting ngày 2026-08-30 và 2026-08-31; approveCompensationPlan khi còn ý kiến chưa xử lý và khi đã xử lý. | 1. Niêm yết 2026-08-01; đọc posting_ends_on và land_deadline PLAN_POSTING_30. 2. closePlanPosting với đồng hồ 2026-08-30. 3. closePlanPosting 2026-08-31. 4. approveCompensationPlan khi 2 ý kiến chưa xử lý; xử lý xong rồi duyệt kèm QĐ. 5. Thử approve ngay sau khi tạo một plan khác chưa qua niêm yết. | posting_ends_on ≥ 2026-08-31; hạn PLAN_POSTING_30 due_on=2026-08-31. 08-30: 422 POSTING_PERIOD_NOT_ELAPSED. 08-31: POSTING_CLOSED. Duyệt khi còn ý kiến: 422 UNRESOLVED_FEEDBACK. Duyệt sau xử lý: APPROVED, approved_on ≥ posting_ends_on (CHECK compensation_plan_approved_chk). Plan chưa niêm yết: 422 PLAN_STATE_INVALID. | Bảng compensation_plan/land_deadline, response |
| UAT-AC378 | domain | P0 | Chi trả trong 30 ngày kể từ ngày phê duyệt; cảnh báo và chặn trễ không có lý do | [EXE-FX] CP-A-001 APPROVED approved_on=2026-09-10, payment_due_on=2026-10-10; 3 khoản compensation_payment PENDING (HH-A-001 450.000.000, HH-A-002 300.000.000, HH-A-003 120.000.000); voucher đã quét. | Job cảnh báo 2026-10-03 và 2026-10-11; confirmCompensationPayment HH-A-001 ngày 2026-10-10; HH-A-002 ngày 2026-10-11 không lý do và có lý do; HH-A-003 depositCompensationPayment. | 1. Chạy job 2026-10-03; đọc land_deadline.alert_level_sent. 2. Xác nhận HH-A-001 ngày 2026-10-10. 3. Chạy job 2026-10-11; xác nhận HH-A-002 ngày 2026-10-11 không lý do, rồi có lý do. 4. Gửi tiền HH-A-003 thiếu lý do, rồi đủ. | 10-03: cảnh báo T-7 gửi 1 lần. HH-A-001: PAID đúng hạn, land_deadline PAYMENT_30 SATISFIED. 10-11: PAYMENT_30 BREACHED, ISS vướng mắc tạo 1 lần; HH-A-002 không lý do: 422 PAYMENT_LATE_REASON_REQUIRED; có lý do: PAID và ghi nhận trễ 1 ngày. HH-A-003 thiếu lý do: 422; đủ: DEPOSITED với deposit_reason, voucher, paid_on (CHECK compensation_payment_deposit_chk). Tổng PAID+DEPOSITED = 870.000.000 ≤ grand_total của plan. | Bảng compensation_payment/land_deadline/issue |
| UAT-AC379 | security | P0 | Dữ liệu cá nhân hộ dân: mã hóa, che hiển thị, phạm vi đơn vị | [EXE-FX] Hộ HH-A-001 (chủ hộ giả "Nguyễn Văn A", CCCD giả 079000000001, điện thoại giả 0900000001) thuộc owner_unit_id=UBND-XA-A1; u.xa thuộc UBND-XA-A1 (scope UNIT_TREE) có land.household.read và lnd.pii.read; u.ttqd thuộc TTQD-A có land.household.read nhưng scope không gồm UBND-XA-A1; u.audit chỉ đọc cả tenant không có lnd.pii.read. | registerAffectedHousehold; GET /affected-households bởi u.xa, u.ttqd, u.audit; truy vấn SQL với app.scope_units khác nhau; xuất Excel danh sách. | 1. Đăng ký hộ; đọc cột national_id_enc, national_id_hash trong DB. 2. u.xa, u.ttqd, u.audit GET danh sách. 3. SQL với app.scope_units=<UBND-XA-A1>, =<TTQD-A>, ="*" và không đặt. 4. Xuất danh sách bởi u.audit; grep audit/log tìm 079000000001 và 0900000001. | DB: national_id_enc là bytea (không chứa chuỗi 079000000001), national_id_hash là HMAC-SHA-256 64 hex. u.xa thấy hộ với CCCD che "•••••••0001" (giải mã chỉ khi lnd.pii.read, có audit đọc); u.ttqd: 0 dòng (RESTRICTIVE scope_units_guard); u.audit: thấy hộ nhưng CCCD/điện thoại che hoàn toàn. SQL: scope UBND-XA-A1 → 1 dòng, TTQD-A → 0, "*" → 1, không đặt → 0 (fail-closed). File xuất che CCCD; không có chuỗi CCCD/điện thoại trong audit_entry, log ứng dụng, outbox. | Dump bảng (mã hóa), response ba người dùng, kết quả grep log |
| UAT-AC380 | security | P0 | Căn cứ xử lý dữ liệu cá nhân (Luật BVDLCN 91/2025) bắt buộc khi đăng ký hộ | [EXE-FX] ConsentRecord CR-001 hợp lệ cho mục đích GPMB; hộ mới HH-A-010. | registerAffectedHousehold với legal_basis=CONSENT không consent_record_id; với CR-001; legal_basis=PUBLIC_TASK_LAND_LAW không legal_basis_ref; bỏ retention_until. | 1. Đăng ký với CONSENT thiếu consent_record_id. 2. Đăng ký với CONSENT và CR-001. 3. Đăng ký PUBLIC_TASK_LAND_LAW thiếu legal_basis_ref. 4. Đăng ký thiếu retention_until. 5. Đọc affected_household. | Bước 1: 422 CONSENT_REQUIRED (CHECK affected_household_consent_chk nếu bỏ qua ứng dụng). Bước 3: 422 LEGAL_BASIS_REQUIRED. Bước 4: 422 VALIDATION_FAILED. Bước 2: 200, legal_basis=CONSENT, consent_record_id=CR-001, retention_until ≠ NULL. Mọi hộ trong DB có legal_basis, legal_basis_ref, retention_until. | Response, bảng affected_household |
| UAT-AC381 | security | P1 | Yêu cầu của chủ thể dữ liệu: xóa bị hạn chế khi còn chứng từ chi trả | [EXE-FX] HH-A-001 có compensation_payment PAID (chứng từ phải giữ); HH-A-011 chưa có chi trả; dpo thực hiện. | handleHouseholdDataRequest request_kind=ERASE cho HH-A-001 và HH-A-011; ACCESS; WITHDRAW_CONSENT. | 1. ERASE HH-A-001 outcome=FULFILLED. 2. ERASE HH-A-001 outcome=PARTIAL kèm lý do. 3. ERASE HH-A-011 outcome=FULFILLED. 4. ACCESS HH-A-001 với requester_verified=false. | Bước 1: 409 RETENTION_LEGAL_HOLD (còn chứng từ chi trả). Bước 2: 200, các trường không bắt buộc (điện thoại, địa chỉ) bị xóa/che, head_name và mã hộ giữ vì nghĩa vụ lưu trữ; dsr_open=false sau xử lý, lý do lưu. Bước 3: xóa thành công (national_id_enc, phone_enc = NULL), bản ghi giữ lại dạng ẩn danh. Bước 4: 422 REQUESTER_NOT_VERIFIED. Mọi bước có audit nhưng không chứa dữ liệu cá nhân. | Response, bảng affected_household, audit |
| UAT-AC382 | domain | P1 | Phương án chỉ dựa trên kiểm đếm đã xác nhận và đơn giá còn hiệu lực | [EXE-FX] Kiểm đếm INV-001 (nhà cấp 4, 80 m2 × 4.500.000 = 360.000.000) CONFIRMED; INV-002 DISPUTED; INV-003 DRAFT; quyết định giá QD-GIA-2024 hết hiệu lực 2026-06-30, QD-GIA-2026 hiệu lực từ 2026-07-01. | addCompensationPlanItems với INV-001, INV-002, INV-003; recordInventory dùng price_decision_ref=QD-GIA-2024 ngày 2026-07-15; postCompensationPlan khi còn INV-002 tranh chấp. | 1. Thêm khoản dựa INV-001. 2. Thêm khoản dựa INV-002 và INV-003. 3. recordInventory ngày khảo sát 2026-07-15 với QD-GIA-2024. 4. postCompensationPlan khi INV-002 vẫn DISPUTED. | INV-001: 200 amount 360.000.000 = 80 × 4.500.000. INV-002/INV-003: 422 INVENTORY_NOT_CONFIRMED. recordInventory: 422 PRICE_DECISION_NOT_EFFECTIVE. postCompensationPlan: 422 INVENTORY_NOT_CONFIRMED cho các hộ còn tranh chấp (hoặc phải loại hộ khỏi phương án). | Response, bảng land_inventory_record/compensation_plan_item |
| UAT-AC383 | integration | P1 | Tạm ứng GPMB được thu hồi bằng khoản chi trả trong 30 ngày | [EXE-FX] ADV-G-001 GPMB 1.000.000.000 chi 2026-07-01 (recovery_deadline 2026-07-31); CP-A-001 PAYING; chi trả HH-A-001 450.000.000 và HH-A-002 300.000.000. | confirmCompensationPayment HH-A-001 với advance_id=ADV-G-001; HH-A-002 với advance_id; HH-A-003 580.000.000 vượt phần còn lại của tạm ứng. | 1. Xác nhận HH-A-001 (450.000.000) gắn ADV-G-001. 2. Xác nhận HH-A-002 (300.000.000). 3. Xác nhận chi 580.000.000 gắn ADV-G-001. 4. Đọc contract_advance và advance_ledger_entry. | Sau hai khoản: recovered_vnd = 750.000.000, outstanding = 250.000.000, trạng thái RECOVERING; mỗi khoản tạo 1 advance_ledger_entry RECOVER. Khoản 580.000.000: 422 ADVANCE_RECOVERY_EXCEEDED (chỉ còn 250.000.000), chi trả không bị đánh dấu PAID. Ngày 2026-08-01 outstanding 250.000.000 → quá hạn (xem UAT-AC328). | Bảng contract_advance/advance_ledger_entry/compensation_payment |
| UAT-AC384 | integration | P1 | Khiếu nại: tạo vướng mắc không chứa dữ liệu cá nhân, hạn giải quyết và văn bản trả lời | [EXE-FX] Hộ HH-A-001; rule hạn giải quyết khiếu nại fixture 30 ngày (CXN-12 chưa xác nhận). | fileLandComplaint filed_on=2026-09-15 subject=PRICE; resolveLandComplaint RESOLVED_ACCEPTED không văn bản; có văn bản. | 1. Nộp khiếu nại; đọc due_on, issue_id. 2. Đọc issue (title, description). 3. Giải quyết thiếu văn bản. 4. Giải quyết có resolution_document_version_id. | due_on = 2026-10-15; tạo issue source_module=LND với title chỉ có mã LC-A-xxx và nhóm "Giá bồi thường", description không chứa họ tên/nội dung khiếu nại. Giải quyết thiếu văn bản: 422 DECISION_DOCUMENT_REQUIRED (CHECK land_complaint_resolved_chk). Có văn bản: RESOLVED_ACCEPTED, issue liên kết được đóng theo quy trình ISS (cần xác nhận độc lập). | Bảng land_complaint/issue |
| UAT-AC385 | domain | P1 | Cưỡng chế: điều kiện tiên quyết và cần quyết định cho bước thực hiện | [EXE-FX] Thửa LP-A-005 hộ HH-A-005 đã có QĐ thu hồi; đã vận động 2 lần; chưa giao tiền/gửi tiền; rule điều kiện cưỡng chế fixture (CXN-12). | startEnforcement; advanceEnforcement tới EXECUTING không quyết định; sau khi có quyết định và đã gửi tiền; bởi chính người lập. | 1. startEnforcement khi chưa giao/gửi tiền. 2. Gửi tiền theo quy định (depositCompensationPayment) rồi startEnforcement. 3. advanceEnforcement EXECUTING thiếu quyết định. 4. Có QĐ cưỡng chế và planned_on; chính người lập chuyển bước; u.lanhdao chuyển bước. | Bước 1: 422 PAYMENT_NOT_OFFERED. Bước 2: 200 PERSUASION. Bước 3: 422 DECISION_DOCUMENT_REQUIRED (CHECK land_enforcement_exec_chk). Bước 4: người lập 403 SELF_APPROVAL_FORBIDDEN; u.lanhdao: EXECUTING; parcel.status chuyển ENFORCEMENT; mỗi bước ghi audit và land_stage_progress. | Bảng land_enforcement_case/land_parcel |
| UAT-AC386 | domain | P0 | Bàn giao mặt bằng theo đoạn/km cho hợp đồng thi công | [EXE-FX] Đoạn SEC-01 km0+000–km3+000 required_area_m2 30.000, gắn HD-A-001 ACTIVE; SEC-02 km3–km6 required 28.000 gắn HD-A-004 (SIGNED). | recordSectionHandover SEC-01 handed 18.000; 30.000; 30.001; SEC-02 handed 10.000. | 1. Bàn giao SEC-01 18.000 m2. 2. Bàn giao SEC-01 đến 30.000 m2. 3. Bàn giao SEC-01 30.001 m2. 4. Bàn giao SEC-02 10.000 m2. | 18.000: status PARTIAL, handed_area_m2 18.000. 30.000: HANDED_OVER, handed_over_on lưu. 30.001: 422 HANDED_AREA_EXCEEDS_REQUIRED (CHECK land_section_area_chk). SEC-02: 409 CONTRACT_STATE_INVALID (HD-A-004 chưa ACTIVE). LND-01 hiển thị tỷ lệ bàn giao toàn dự án = (30.000 / 58.000) = 51,72%. | Bảng land_handover_section, response |
| UAT-AC387 | integration | P1 | Theo dõi tiến độ GPMB khi Trung tâm quỹ đất thực hiện (TRACKED_EXTERNAL) | [EXE-FX] Phương án CP-A-001 do TTQD-A thực hiện (executor_kind LAND_FUND_CENTRE); stage INVENTORY mode TRACKED_EXTERNAL planned_end 2026-08-31; stage PLAN_DRAFT mode NATIVE. | reportLandStageProgress INVENTORY parcels_total=120 parcels_done=45; parcels_done=121; NATIVE stage; đồng hồ 2026-09-02. | 1. Báo cáo INVENTORY 45/120. 2. Báo cáo 121/120. 3. Thử báo cáo thủ công cho stage PLAN_DRAFT (NATIVE). 4. Chạy job trễ hạn ngày 2026-09-02; đọc land_stage_progress và issue. | progress_pct = 37,50 (cột sinh). 121/120: 422 PARCELS_DONE_EXCEEDS_TOTAL (CHECK land_stage_progress_done_chk). NATIVE: 422 NATIVE_STAGE_READONLY. 2026-09-02: INVENTORY trễ hạn → status LATE, tạo blocker_issue_id (ISS) 1 lần; LND-01 hiển thị giai đoạn trễ và đơn vị thực hiện TTQD-A. Báo cáo kèm evidence_document_version_id được lưu và kiểm quyền người báo cáo. | Bảng land_stage_progress/issue |

## 11. Tiêu chí nghiệm thu

- **AC-LND-01**: Given thông báo thu hồi đất, When tính bộ đếm, Then 90 ngày với đất nông nghiệp và 180 ngày với đất phi nông nghiệp [CXN-12], quyết định thu hồi sớm hơn bị chặn. Test: UAT-AC376.
- **AC-LND-02**: Given phương án bồi thường, When niêm yết và duyệt, Then niêm yết tối thiểu 30 ngày, phải xử lý ý kiến, chỉ dựa trên kiểm đếm đã xác nhận với đơn giá còn hiệu lực, duyệt khác người lập. Test: UAT-AC377, UAT-AC382.
- **AC-LND-03**: Given phương án đã duyệt, When chi trả, Then trong 30 ngày kể từ phê duyệt, trễ phải có lý do, gửi tiền khi hộ không nhận và hoàn ứng GPMB theo các khoản chi. Test: UAT-AC378, UAT-AC383.
- **AC-LND-04**: Given dữ liệu hộ dân, When đăng ký/hiển thị/xử lý yêu cầu chủ thể, Then có căn cứ xử lý và thời hạn lưu, mã hóa, che hiển thị, giới hạn theo đơn vị (fail-closed) và không đưa vào log/audit/outbox. Test: UAT-AC379, UAT-AC380, UAT-AC381.
- **AC-LND-05**: Given khiếu nại, When tiếp nhận và giải quyết, Then có hạn, có văn bản trả lời và vướng mắc ISS không chứa dữ liệu cá nhân. Test: UAT-AC384.
- **AC-LND-06**: Given cưỡng chế, When mở và chuyển bước, Then thỏa điều kiện tiên quyết và có quyết định cho bước thực hiện, người chuyển bước khác người lập. Test: UAT-AC385.
- **AC-LND-07**: Given đoạn/km, When bàn giao mặt bằng, Then không vượt diện tích cần, chỉ cho hợp đồng ACTIVE và tỷ lệ bàn giao tính đúng. Test: UAT-AC386.
- **AC-LND-08**: Given Trung tâm quỹ đất thực hiện quy trình, When báo cáo tiến độ, Then tiến độ vẫn được theo dõi (TRACKED_EXTERNAL) kèm bằng chứng, trễ hạn tạo vướng mắc. Test: UAT-AC387.

## 12. Mức tối thiểu cho R1 và phần sâu hóa R2+

**R1.** Đoạn/thửa/hộ (PII đầy đủ biện pháp), kiểm đếm, phương án, niêm yết 30 ngày, phê duyệt, chi trả 30 ngày, hoàn ứng GPMB, bàn giao theo đoạn, tiến độ TRACKED_EXTERNAL, yêu cầu chủ thể dữ liệu. Màn hình LND-01…LND-08, LND-10, LND-11, LND-13. **R2.** Cưỡng chế (LND-09), tái định cư (LND-12), GIS ranh giới, nhập tệp từ đơn vị thực hiện tự động. **R3.** Liên thông hệ thống quản lý đất đai khi có hợp đồng.

| Hạng mục bắt buộc người duyệt | Giờ dự kiến | Người duyệt |
|---|---|---|
| Căn cứ xử lý dữ liệu cá nhân, che/mã hóa, retention | 4 | DPO [CXN-EXE-06] |
| Bộ đếm 90/180/30/30 và điều kiện cưỡng chế | 3 | Chủ nghiệp vụ GPMB [CXN-12] |
| Chi trả và hoàn ứng GPMB (tiền) | 3 | Kế toán trưởng |
| RLS `scope_units_guard` | 2 | Security |

## 13. Rủi ro, câu hỏi mở, phụ thuộc bên thứ ba

| ID | Rủi ro / câu hỏi | Owner | Điều kiện giải quyết |
|---|---|---|---|
| R-LND-01 | Mốc 90/180/30/30 ngày và hạn giải quyết khiếu nại [CXN-12] | Chủ nghiệp vụ GPMB | Luật Đất đai 2024 + NĐ 88/2024 bản gốc; rule ký |
| R-LND-02 | Căn cứ xử lý dữ liệu hộ dân không cần đồng ý (nhiệm vụ công) [CXN-EXE-06] | DPO | Ý kiến pháp chế; DPIA trước go-live |
| R-LND-03 | Đơn vị thực hiện ngoài không cung cấp dữ liệu đúng hạn | PO | Quy chế phối hợp; cảnh báo LATE |
| R-LND-04 | Khóa KMS cho mã hóa phong bì phụ thuộc chọn cloud (04 §Hosting) | Security/Platform | Chọn KMS hoặc OpenBao |

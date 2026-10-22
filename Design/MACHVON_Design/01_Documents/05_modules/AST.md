# AST — Bàn giao tài sản và bảo hành

Đặc tả phân hệ mới (D-B09) theo `_KHUNG_DAC_TA.md`, baseline 1.4 (22/10/2026). Quy ước chung ở `04_Thiet_ke_co_ban.md`, `05_Thiet_ke_chi_tiet.md`. Bảng `handover` và `asset_record` có từ baseline v1.3 được giữ nguyên cột, chỉ mở rộng; FRD UC16 (bàn giao có punch list, đơn vị nhận, hồ sơ vận hành, liên kết sổ tài sản; bảo hành theo hạng mục; giải tỏa bảo lãnh theo bằng chứng) được chi tiết hóa.

## 1. Mục đích, phạm vi, ranh giới

**Vấn đề.** Công trình hoàn thành thường bàn giao khi còn tồn tại chưa khắc phục, hồ sơ hoàn công và hướng dẫn vận hành thiếu, tài sản không được ghi nhận đúng giá trị và đơn vị tiếp nhận, khoản giữ lại/bảo lãnh bảo hành bị giải tỏa khi còn yêu cầu bảo hành mở, và đánh giá sau đầu tư không được kích hoạt.

**Trong phạm vi.** Hồ sơ bàn giao (một phần, hoàn thành, chuyển giao tài sản) với danh sách tồn tại có mức độ, bằng chứng và xác nhận độc lập; quyết định nhận bàn giao của đơn vị tiếp nhận; ghi nhận tài sản hình thành (giá trị theo hợp đồng/quyết toán/thẩm định) và chuyển giao; nghĩa vụ bảo hành theo hạng mục/tài sản, yêu cầu bảo hành và xử lý; đóng bảo hành làm điều kiện giải tỏa giữ lại và bảo lãnh bảo hành (CTR); liên kết vận hành–bảo trì; kích hoạt đánh giá sau đầu tư cho MNE.

**Ngoài phạm vi.** Kế toán tài sản công và sổ tài sản quốc gia (adapter MISSING — mã tài sản ngoài nhập tay); bảo trì chi tiết; đánh giá sau đầu tư (MNE); nghiệm thu hoàn thành (QMS); giải tỏa giữ lại/bảo lãnh (CTR thực hiện, AST cung cấp điều kiện).

**Phụ thuộc.** AST → PRJ, CTR (hợp đồng, bảo lãnh, giữ lại), QMS (nghiệm thu hoàn thành, NCR, ảnh), PAY (giá trị quyết toán), DOC (biên bản, hồ sơ hoàn công); phát sự kiện cho CTR, MNE, ISS, NOT.

**Căn cứ.** Luật Xây dựng 135/2025 và NĐ 06/2021 → NĐ 207/2026 (nghiệm thu hoàn thành, bàn giao, bảo hành: thời hạn tối thiểu theo cấp công trình, mức bảo đảm bảo hành) [CXN-07, CXN-EXE-04]; TT 91/2025 (giá trị tài sản theo quyết toán) [CXN-09]; NĐ 19/2026 + TT 44/2026 (đánh giá sau đầu tư — MNE) [CXN-10]. Thời hạn tối thiểu/mức giữ lại là rule `AST.WARRANTY`.

## 2. Actor, tenant và phạm vi quyền

| Actor | Scope | Được phép | Bị cấm |
|---|---|---|---|
| Ban QLDA/chủ đầu tư | PROJECT / UNIT_TREE | `handover.manage`, `handover.verify`, `asset.manage`, `warranty.manage`, `warranty.verify`, `evaluation.trigger.manage` | Xác nhận khắc phục do chính mình báo đã sửa |
| Đơn vị tiếp nhận (sở chuyên ngành, đơn vị vận hành) | UNIT_TREE của đơn vị nhận | `handover.approve`, `asset.transfer`, `warranty.claim`, `warranty.verify` | Nhận bàn giao khi còn tồn tại CRITICAL |
| Lãnh đạo có thẩm quyền | UNIT_TREE | `handover.waive` (tồn tại không trọng yếu) | Miễn tồn tại CRITICAL |
| Nhà thầu (khách) | CONTRACT | `handover.respond` (báo đã khắc phục), `warranty.respond` | Tự xác nhận; xem tài sản ngoài hợp đồng |
| MNE (phân hệ) | interface | `acknowledgeEvaluationTrigger` | — |

## 3. Luồng nghiệp vụ

### 3.1 Bàn giao và tồn tại (UC-AST-01) — AST-01, AST-02, CTR-15
1. `createHandover` sau khi QMS có nghiệm thu hoàn thành APPROVED (bắt buộc với COMPLETION); cổng PMT `HANDOVER` khi có quy tắc.
2. `addPunchItem` (mức CRITICAL/MAJOR/MINOR, hạn, nhà thầu chịu trách nhiệm, ảnh) → PUNCH_PENDING; `open_critical_punch_count` cập nhật trong cùng giao dịch, khóa hàng `handover`.
3. Nhà thầu `markPunchItemFixed` kèm bằng chứng; Ban QLDA/giám sát `verifyPunchItem` (khác nhà thầu) → VERIFIED hoặc mở lại; tồn tại không trọng yếu có thể `waivePunchItem` với lý do và người duyệt.
4. Đơn vị nhận `post_handovers_id_decision` approve: không còn CRITICAL mở (CHECK `handover_accepted_chk`), đủ hồ sơ hoàn công, hướng dẫn vận hành, giấy bảo hành; tài sản đã đăng ký → ACCEPTED; phát `ast.handover.accepted.v1`.

### 3.2 Tài sản (UC-AST-02) — AST-03, AST-06, CTR-18
`registerAsset` (sau ACCEPTED): mã duy nhất theo dự án, giá trị cơ sở CONTRACT_VALUE → cập nhật SETTLED_VALUE khi quyết toán CLOSED (sự kiện PAY); Σ giá trị tài sản của hợp đồng ≤ giá trị hợp đồng hiệu lực (`VALUE_EXCEEDS_CONTRACT`). `transferAsset` cần biên bản vận hành thử/chuyển giao; `linkOmPlan` liên kết đơn vị vận hành, kế hoạch và hợp đồng O&M, chu kỳ bảo trì.

### 3.3 Bảo hành (UC-AST-03, UC-AST-04 phần giải tỏa) — AST-04, AST-05, CTR-16, CTR-21
`createWarrantyObligation` từ ngày nghiệm thu hoàn thành; `period_months ≥ tối thiểu` theo cấp công trình (rule); gắn bảo lãnh bảo hành hoặc khoản giữ lại. Yêu cầu bảo hành trong hạn: `fileWarrantyClaim` → nhà thầu `acknowledgeWarrantyClaim` (cam kết ngày) → `recordWarrantyFix` → `verifyWarrantyClaim` (khác người báo) VERIFIED hoặc DISPUTED; quá hạn phản hồi tạo vướng mắc ISS và gợi ý vi phạm CTR. Job hết hạn → EXPIRED; `closeWarrantyObligation` khi không còn yêu cầu mở → phát `ast.warranty.closed.v1` → CTR cho phép giải tỏa giữ lại (WARRANTY_END) và bảo lãnh bảo hành.

### 3.4 Đánh giá sau đầu tư (UC-AST-04) — AST-07
Khi bàn giao ACCEPTED hệ thống đề xuất trigger POST_HANDOVER_12M (và 24M theo quy chế); khi quyết toán dự án CLOSED đề xuất SETTLEMENT_CLOSED; `scheduleEvaluationTrigger` lưu; job đến hạn phát `ast.evaluation.due.v1` một lần; MNE tạo `mne_evaluation` và gọi `acknowledgeEvaluationTrigger`.

## 4. State machine

```
Handover: DRAFT ─add punch─► PUNCH_PENDING ─decision(approve, count=0)─► ACCEPTED
          DRAFT|INSPECTING|PUNCH_PENDING ─decision(reject)─► REJECTED ;  DRAFT ─cancel─► CANCELLED
PunchItem: OPEN ─fixed─► FIXED ─verify─► VERIFIED | OPEN ;  OPEN|FIXED ─waive─► WAIVED (không cho CRITICAL)
AssetRecord: DRAFT ─register─► REGISTERED ─transfer─► TRANSFERRED ─(vận hành)─► IN_OPERATION ─► DISPOSED
WarrantyObligation: ACTIVE ─job─► EXPIRED ─close─► CLOSED
WarrantyClaim: OPEN ─ack─► ACKNOWLEDGED ─(REPAIRING)─► FIXED ─verify─► VERIFIED ─► CLOSED ;  FIXED ─verify(dispute)─► DISPUTED
EvaluationTrigger: SCHEDULED ─job─► FIRED ─ack─► ACKNOWLEDGED ;  SCHEDULED ─► CANCELLED
```

| Từ | Command | Đến | Ai | Guard | Event |
|---|---|---|---|---|---|
| PUNCH_PENDING/INSPECTING | `post_handovers_id_decision(approve)` | ACCEPTED | `handover.approve` | count CRITICAL = 0; hồ sơ hoàn công; khác người lập | `ast.handover.accepted.v1` |
| OPEN/FIXED | `waivePunchItem` | WAIVED | `handover.waive` | không CRITICAL; lý do + người duyệt | `ast.punch_item.waived.v1` |
| ∅ | `registerAsset` | REGISTERED | `asset.manage` | bàn giao ACCEPTED; Σ giá trị ≤ hợp đồng | `ast.asset.registered.v1` |
| EXPIRED | `closeWarrantyObligation` | CLOSED | `warranty.manage` | không còn yêu cầu mở | `ast.warranty.closed.v1` |
| SCHEDULED | job | FIRED | hệ thống | `due_on ≤ hôm nay` | `ast.evaluation.due.v1` |

Cấm (409 `*_STATE_INVALID`): nhận bàn giao đã REJECTED (phải lập hồ sơ mới), miễn tồn tại CRITICAL (`CRITICAL_CANNOT_BE_WAIVED`), yêu cầu bảo hành sau hạn (`WARRANTY_EXPIRED`), đóng bảo hành chưa hết hạn (`WARRANTY_NOT_EXPIRED`).

## 5. Quy tắc nghiệp vụ và công thức

- **BR-AST-01 (tồn tại trọng yếu).** `open_critical_punch_count = số punch item CRITICAL có status ∉ {VERIFIED}`; ACCEPTED yêu cầu = 0 (CHECK DB); cập nhật trong cùng giao dịch với punch item.
- **BR-AST-02 (giá trị tài sản).** Σ `value_vnd` các tài sản có `source_contract_id = c` ≤ `contract.contract_value_vnd`; khi quyết toán CLOSED, giá trị cập nhật theo phân bổ quyết toán (bản ghi mới của giá trị, `value_basis = SETTLED_VALUE`, audit giữ giá trị cũ).
- **BR-AST-03 (thời hạn bảo hành).** `ends_on = starts_on + period_months`; `period_months ≥ min_months(cấp công trình)` theo rule (fixture: cấp đặc biệt/I 24 tháng, còn lại 12 tháng) [CXN-EXE-04]; yêu cầu bảo hành hợp lệ khi `reported_on < ends_on`.
- **BR-AST-04 (phản hồi bảo hành).** `response_due_on = reported_on + n ngày` (rule theo mức độ, mặc định CRITICAL 2, MAJOR 7, MINOR 15 ngày [GIẢ ĐỊNH]); quá hạn → vướng mắc ISS.
- **BR-AST-05 (giải tỏa).** Giữ lại điều kiện WARRANTY_END và bảo lãnh bảo hành chỉ được giải tỏa (CTR) khi nghĩa vụ CLOSED; không tự giải tỏa.
- **BR-AST-06 (đánh giá sau đầu tư).** `due_on = ngày ACCEPTED + 12 tháng` (POST_HANDOVER_12M) hoặc theo quy chế MNE; mỗi (dự án, loại, bàn giao) một trigger.

## 6. Dữ liệu

Phân hệ AST sở hữu 7 bảng (2 bảng hiện có được mở rộng, 5 bảng mới). Quy ước chung: khóa chính `(tenant_id, id)`, khóa ngoại tổng hợp `(tenant_id, x_id)`, tiền `numeric(24,0)` VND nguyên, mọi bảng ENABLE + FORCE RLS với policy RESTRICTIVE `tenant_boundary` và PERMISSIVE `tenant_access` (04 §PostgreSQL và RLS). Mọi cột `*_id` có chỉ mục `<bảng>_<cột>_idx ON (tenant_id, <cột>)`. Cột NOT NULL thêm vào bảng hiện có được thêm nullable hoặc có DEFAULT, backfill rồi mới SET NOT NULL (expand-contract).

#### Bảng `handover` (hiện có, mở rộng)
Phân loại: Nội bộ. Lưu giữ: Theo RetentionPolicy hồ sơ dự án (DOC) [CXN-05]; legal hold chặn xóa.
Cột hiện có giữ nguyên: `tenant_id`, `id`, `project_id`, `contract_id`, `recipient_unit_id`, `document_version_id`, `punch_list`, `accepted_at`, `status`.

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `handover_no` | text | không |  |  |  |
| `handover_kind` | text | có | 'COMPLETION' | ∈ {PARTIAL, COMPLETION, ASSET_TRANSFER} |  |
| `quality_acceptance_id` | uuid | không |  | FK quality_acceptance | Nghiệm thu hoàn thành QMS |
| `planned_on` | date | không |  |  |  |
| `handed_on` | date | không |  |  |  |
| `accepted_by` | uuid | không |  |  |  |
| `rejection_reason` | text | không |  |  |  |
| `open_critical_punch_count` | integer | có | 0 | open_critical_punch_count >= 0 | Đếm tồn tại trọng yếu chưa đóng (duy trì cùng giao dịch, khóa hàng) |
| `as_built_document_version_id` | uuid | không |  | FK document_version | Hồ sơ hoàn công |
| `om_manual_document_version_id` | uuid | không |  | FK document_version | Hướng dẫn vận hành, bảo trì |
| `warranty_certificate_document_version_id` | uuid | không |  | FK document_version |  |
| `version` | bigint | có | 1 |  |  |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | không |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | không |  |  |  |

Bất biến DB:
- CHECK `handover_accepted_chk`: status <> 'ACCEPTED' OR (accepted_at IS NOT NULL AND accepted_by IS NOT NULL AND open_critical_punch_count = 0 AND as_built_document_version_id IS NOT NULL)
- CHECK `handover_reject_chk`: status <> 'REJECTED' OR rejection_reason IS NOT NULL
- UNIQUE INDEX `handover_no_uq` (tenant_id, contract_id, handover_no) WHERE handover_no IS NOT NULL

Chỉ mục: `handover_quality_acceptance_id_idx`, `handover_as_built_document_version_id_idx`, `handover_om_manual_document_version_id_idx`, `handover_warranty_certificate_document_version_id_idx`, `handover_project_id_idx`, `handover_contract_id_idx`, `handover_recipient_unit_id_idx`, `handover_document_version_id_idx`.

#### Bảng `handover_punch_item` (mới)
Phân loại: Nội bộ. Lưu giữ: Theo RetentionPolicy hồ sơ dự án (DOC) [CXN-05]; legal hold chặn xóa.

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `tenant_id` | uuid | có |  |  |  |
| `id` | uuid | có |  |  |  |
| `handover_id` | uuid | có |  | FK handover |  |
| `item_no` | integer | có |  | item_no > 0 |  |
| `description` | text | có |  |  |  |
| `severity` | text | có |  | ∈ {CRITICAL, MAJOR, MINOR} |  |
| `location_text` | text | không |  |  |  |
| `responsible_contractor_id` | uuid | không |  | FK contractor |  |
| `due_on` | date | có |  |  |  |
| `status` | text | có | 'OPEN' | ∈ {OPEN, FIXED, VERIFIED, WAIVED} |  |
| `evidence_photo_id` | uuid | không |  | FK site_photo |  |
| `evidence_document_version_id` | uuid | không |  | FK document_version |  |
| `verified_by` | uuid | không |  |  |  |
| `verified_at` | timestamptz | không |  |  |  |
| `waiver_reason` | text | không |  |  |  |
| `waiver_approved_by` | uuid | không |  |  |  |
| `nonconformance_id` | uuid | không |  | FK quality_nonconformance |  |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | có |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | có |  |  |  |
| `version` | bigint | có | 1 |  |  |

Bất biến DB:
- CHECK `punch_item_waiver_chk`: status <> 'WAIVED' OR (waiver_reason IS NOT NULL AND waiver_approved_by IS NOT NULL)
- CHECK `punch_item_verify_chk`: status <> 'VERIFIED' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL AND (evidence_photo_id IS NOT NULL OR evidence_document_version_id IS NOT NULL))
- UNIQUE INDEX `punch_item_no_uq` (tenant_id, handover_id, item_no)

Chỉ mục: `handover_punch_item_handover_id_idx`, `handover_punch_item_responsible_contractor_id_idx`, `handover_punch_item_evidence_photo_id_idx`, `handover_punch_item_evidence_document_version_id_idx`, `handover_punch_item_nonconformance_id_idx`.

#### Bảng `asset_record` (hiện có, mở rộng)
Phân loại: Nội bộ. Lưu giữ: Theo RetentionPolicy hồ sơ dự án (DOC) [CXN-05]; legal hold chặn xóa.
Cột hiện có giữ nguyên: `tenant_id`, `id`, `project_id`, `handover_id`, `asset_code`, `value_vnd`, `recipient_unit_id`, `warranty_until`, `external_asset_id`.

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `name` | text | không |  |  |  |
| `asset_class_master_version_id` | uuid | không |  | FK master_record_version | Nhóm tài sản (MDM) |
| `source_contract_id` | uuid | không |  | FK contract |  |
| `settlement_revision_id` | uuid | không |  | FK settlement_revision | Giá trị theo quyết toán |
| `value_basis` | text | có | 'CONTRACT_VALUE' | ∈ {CONTRACT_VALUE, SETTLED_VALUE, APPRAISED_VALUE} |  |
| `funding_origin` | text | không |  |  | Nguồn hình thành tài sản (nguồn vốn đầu tư) |
| `status` | text | có | 'DRAFT' | ∈ {DRAFT, REGISTERED, TRANSFERRED, IN_OPERATION, DISPOSED} |  |
| `registered_on` | date | không |  |  |  |
| `transferred_on` | date | không |  |  |  |
| `commissioning_document_version_id` | uuid | không |  | FK document_version |  |
| `version` | bigint | có | 1 |  |  |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | không |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | không |  |  |  |

Bất biến DB:
- CHECK `asset_record_value_chk`: value_vnd >= 0
- CHECK `asset_record_transfer_chk`: status NOT IN ('TRANSFERRED','IN_OPERATION') OR transferred_on IS NOT NULL
- UNIQUE INDEX `asset_record_code_uq` (tenant_id, project_id, asset_code)

Chỉ mục: `asset_record_asset_class_master_version_id_idx`, `asset_record_source_contract_id_idx`, `asset_record_settlement_revision_id_idx`, `asset_record_commissioning_document_version_id_idx`, `asset_record_project_id_idx`, `asset_record_handover_id_idx`, `asset_record_recipient_unit_id_idx`, `asset_record_external_asset_id_idx`.

#### Bảng `warranty_obligation` (mới)
Phân loại: Nội bộ. Lưu giữ: Theo RetentionPolicy hồ sơ dự án (DOC) [CXN-05]; legal hold chặn xóa.

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `tenant_id` | uuid | có |  |  |  |
| `id` | uuid | có |  |  |  |
| `project_id` | uuid | có |  | FK project |  |
| `contract_id` | uuid | có |  | FK contract |  |
| `handover_id` | uuid | có |  | FK handover |  |
| `asset_id` | uuid | không |  | FK asset_record |  |
| `scope_description` | text | có |  |  |  |
| `starts_on` | date | có |  |  |  |
| `ends_on` | date | có |  |  |  |
| `period_months` | integer | có |  | period_months > 0 |  |
| `warranty_guarantee_id` | uuid | không |  | FK guarantee |  |
| `retention_amount_vnd` | numeric(24,0) | có | 0 |  |  |
| `rule_version_id` | uuid | không |  |  | rule registry AST.WARRANTY (mức/thời hạn theo cấp công trình) [CXN-EXE-04] |
| `status` | text | có | 'ACTIVE' | ∈ {ACTIVE, EXPIRED, CLOSED} |  |
| `alert_level_sent` | smallint | có | 0 | alert_level_sent BETWEEN 0 AND 4 |  |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | có |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | có |  |  |  |
| `version` | bigint | có | 1 |  |  |

Bất biến DB:
- CHECK `warranty_obligation_dates_chk`: ends_on > starts_on
- UNIQUE INDEX `warranty_obligation_scope_uq` (tenant_id, contract_id, handover_id, asset_id) NULLS NOT DISTINCT

Chỉ mục: `warranty_obligation_project_id_idx`, `warranty_obligation_contract_id_idx`, `warranty_obligation_handover_id_idx`, `warranty_obligation_asset_id_idx`, `warranty_obligation_warranty_guarantee_id_idx`, `warranty_obligation_rule_version_id_idx`, `warranty_obligation_expiry_idx`.

#### Bảng `warranty_claim` (mới)
Phân loại: Nội bộ. Lưu giữ: Theo RetentionPolicy hồ sơ dự án (DOC) [CXN-05]; legal hold chặn xóa.

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `tenant_id` | uuid | có |  |  |  |
| `id` | uuid | có |  |  |  |
| `obligation_id` | uuid | có |  | FK warranty_obligation |  |
| `claim_no` | text | có |  |  |  |
| `reported_on` | date | có |  |  |  |
| `reported_by` | uuid | có |  |  |  |
| `defect_description` | text | có |  |  |  |
| `severity` | text | có |  | ∈ {CRITICAL, MAJOR, MINOR} |  |
| `location_text` | text | không |  |  |  |
| `evidence_photo_id` | uuid | không |  | FK site_photo |  |
| `evidence_document_version_id` | uuid | không |  | FK document_version |  |
| `responder_contractor_id` | uuid | không |  | FK contractor |  |
| `response_due_on` | date | có |  |  |  |
| `status` | text | có | 'OPEN' | ∈ {OPEN, ACKNOWLEDGED, REPAIRING, FIXED, VERIFIED, CLOSED, DISPUTED} |  |
| `fixed_on` | date | không |  |  |  |
| `verified_by` | uuid | không |  |  |  |
| `verified_at` | timestamptz | không |  |  |  |
| `cost_borne_by` | text | có | 'UNDETERMINED' | ∈ {CONTRACTOR, OWNER, THIRD_PARTY, UNDETERMINED} |  |
| `issue_id` | uuid | không |  | FK issue | Vướng mắc ISS khi quá hạn phản hồi |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | có |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | có |  |  |  |
| `version` | bigint | có | 1 |  |  |

Bất biến DB:
- CHECK `warranty_claim_verify_chk`: status NOT IN ('VERIFIED','CLOSED') OR (verified_by IS NOT NULL AND verified_at IS NOT NULL AND fixed_on IS NOT NULL)
- UNIQUE INDEX `warranty_claim_no_uq` (tenant_id, obligation_id, claim_no)

Chỉ mục: `warranty_claim_obligation_id_idx`, `warranty_claim_evidence_photo_id_idx`, `warranty_claim_evidence_document_version_id_idx`, `warranty_claim_responder_contractor_id_idx`, `warranty_claim_issue_id_idx`, `warranty_claim_due_idx`.

#### Bảng `om_link` (mới)
Phân loại: Nội bộ. Lưu giữ: Theo RetentionPolicy hồ sơ dự án (DOC) [CXN-05]; legal hold chặn xóa.

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `tenant_id` | uuid | có |  |  |  |
| `id` | uuid | có |  |  |  |
| `asset_id` | uuid | có |  | FK asset_record |  |
| `operator_unit_id` | uuid | có |  | FK organization_unit |  |
| `om_plan_document_version_id` | uuid | không |  | FK document_version |  |
| `om_contract_id` | uuid | không |  | FK contract | Hợp đồng vận hành, bảo trì (nếu có) |
| `maintenance_cycle_months` | integer | không |  | maintenance_cycle_months > 0 |  |
| `next_maintenance_due` | date | không |  |  |  |
| `external_system_ref` | text | không |  |  | Mã ở hệ thống vận hành bên ngoài (adapter MISSING — nhập tay) |
| `status` | text | có | 'DRAFT' | ∈ {DRAFT, LINKED, SUSPENDED} |  |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | có |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | có |  |  |  |
| `version` | bigint | có | 1 |  |  |

Bất biến DB:
- UNIQUE INDEX `om_link_asset_uq` (tenant_id, asset_id) WHERE status <> 'SUSPENDED'

Chỉ mục: `om_link_asset_id_idx`, `om_link_operator_unit_id_idx`, `om_link_om_plan_document_version_id_idx`, `om_link_om_contract_id_idx`.

#### Bảng `evaluation_trigger` (mới)
Phân loại: Nội bộ. Lưu giữ: Theo RetentionPolicy hồ sơ dự án (DOC) [CXN-05]; legal hold chặn xóa.

| Cột | Kiểu | Bắt buộc | Mặc định | Ràng buộc | Ghi chú |
|---|---|---|---|---|---|
| `tenant_id` | uuid | có |  |  |  |
| `id` | uuid | có |  |  |  |
| `project_id` | uuid | có |  | FK project |  |
| `trigger_kind` | text | có |  | ∈ {POST_HANDOVER_12M, POST_HANDOVER_24M, SETTLEMENT_CLOSED, MANUAL} |  |
| `source_handover_id` | uuid | không |  | FK handover |  |
| `due_on` | date | có |  |  |  |
| `status` | text | có | 'SCHEDULED' | ∈ {SCHEDULED, FIRED, ACKNOWLEDGED, CANCELLED} |  |
| `fired_at` | timestamptz | không |  |  |  |
| `mne_evaluation_id` | uuid | không |  | FK mne_evaluation | Bản đánh giá MNE được tạo từ trigger |
| `outbox_event_id` | uuid | không |  |  |  |
| `rule_version_id` | uuid | không |  |  |  |
| `created_at` | timestamptz | có | now() |  |  |
| `created_by` | uuid | có |  |  |  |
| `updated_at` | timestamptz | có | now() |  |  |
| `updated_by` | uuid | có |  |  |  |
| `version` | bigint | có | 1 |  |  |

Bất biến DB:
- CHECK `evaluation_trigger_fired_chk`: status NOT IN ('FIRED','ACKNOWLEDGED') OR fired_at IS NOT NULL
- UNIQUE INDEX `evaluation_trigger_uq` (tenant_id, project_id, trigger_kind, source_handover_id) NULLS NOT DISTINCT

Chỉ mục: `evaluation_trigger_project_id_idx`, `evaluation_trigger_source_handover_id_idx`, `evaluation_trigger_mne_evaluation_id_idx`, `evaluation_trigger_outbox_event_id_idx`, `evaluation_trigger_rule_version_id_idx`, `evaluation_trigger_due_idx`.


## 7. API / command

Mọi lệnh ghi: `Idempotency-Key` (≥16 ký tự) bắt buộc; `If-Match` bắt buộc khi đổi bản ghi có version (cột "If-Match" = có); lỗi trả RFC 7807 Problem với `code` ổn định; DTO là allowlist (trường thừa → 400 INVALID_REQUEST); không có endpoint ghi chung cho `status`, `tenant_id`, role hoặc số tiền đã chốt. Mã lỗi chung ngoài bảng: 401 SESSION_EXPIRED, 403 SCOPE_DENIED, 404 RESOURCE_NOT_FOUND, 409 IDEMPOTENCY_CONFLICT, 422 VALIDATION_FAILED, 429 RATE_LIMIT, 503 PROVIDER_UNAVAILABLE.

| operationId | Method path | Quyền (x-permission) | Request DTO (trường được phép; * = bắt buộc) | Response | Lỗi (HTTP + code) | Idempotency | If-Match |
|---|---|---|---|---|---|---|---|
| `createHandover` | `POST /handovers` | `handover.manage` | project_id*, contract_id*, recipient_unit_id*, handover_kind*, handover_no*, quality_acceptance_id, planned_on, document_version_id* | CommandResult | 422 QUALITY_ACCEPTANCE_REQUIRED; 409 CONTRACT_STATE_INVALID; 409 PERMIT_GATE_BLOCKED; 422 VALIDATION_FAILED | bắt buộc | không |
| `addPunchItem` | `POST /handovers/{id}/punch-items` | `handover.manage` | description*, severity*, location_text, responsible_contractor_id, due_on*, evidence_photo_id | CommandResult | 409 HANDOVER_STATE_INVALID; 409 VERSION_CONFLICT | bắt buộc | có |
| `markPunchItemFixed` | `POST /punch-items/{id}/fixed` | `handover.respond` | evidence_photo_id, evidence_document_version_id, note* | CommandResult | 422 EVIDENCE_REQUIRED; 409 PUNCH_STATE_INVALID; 403 SCOPE_DENIED | bắt buộc | không |
| `verifyPunchItem` | `POST /punch-items/{id}/verify` | `handover.verify` | outcome*, note* | CommandResult | 403 SELF_APPROVAL_FORBIDDEN; 409 PUNCH_STATE_INVALID | bắt buộc | không |
| `waivePunchItem` | `POST /punch-items/{id}/waive` | `handover.waive` | waiver_reason* | CommandResult | 422 CRITICAL_CANNOT_BE_WAIVED; 403 SELF_APPROVAL_FORBIDDEN; 409 PUNCH_STATE_INVALID | bắt buộc | không |
| `post_handovers_id_decision` | `POST /handovers/{id}/decision` | `handover.approve` | decision*, reason*, evidence_ids*, as_built_document_version_id, om_manual_document_version_id, warranty_certificate_document_version_id | CommandResult | 422 OPEN_CRITICAL_PUNCH; 422 ASSET_NOT_REGISTERED; 422 AS_BUILT_REQUIRED; 403 SELF_APPROVAL_FORBIDDEN; 409 HANDOVER_STATE_INVALID; 409 VERSION_CONFLICT | bắt buộc | có |
| `registerAsset` | `POST /asset-records` | `asset.manage` | project_id*, handover_id*, asset_code*, name*, asset_class_master_version_id, source_contract_id, recipient_unit_id*, value_vnd*, value_basis*, funding_origin, warranty_until | CommandResult | 409 ASSET_CODE_DUPLICATE; 409 HANDOVER_STATE_INVALID; 422 VALUE_EXCEEDS_CONTRACT; 422 VALIDATION_FAILED | bắt buộc | không |
| `transferAsset` | `POST /asset-records/{id}/transfer` | `asset.transfer` | transferred_on*, commissioning_document_version_id*, external_asset_id | CommandResult | 422 HANDOVER_NOT_ACCEPTED; 409 ASSET_STATE_INVALID; 409 VERSION_CONFLICT | bắt buộc | có |
| `createWarrantyObligation` | `POST /warranty-obligations` | `warranty.manage` | contract_id*, handover_id*, asset_id, scope_description*, starts_on*, period_months*, warranty_guarantee_id, retention_amount_vnd | CommandResult | 422 WARRANTY_PERIOD_BELOW_MINIMUM; 422 HANDOVER_NOT_ACCEPTED; 422 GUARANTEE_REQUIRED; 422 VALIDATION_FAILED | bắt buộc | không |
| `fileWarrantyClaim` | `POST /warranty-obligations/{id}/claims` | `warranty.claim` | claim_no*, reported_on*, defect_description*, severity*, location_text, evidence_photo_id, evidence_document_version_id, responder_contractor_id* | CommandResult | 422 WARRANTY_EXPIRED; 409 CLAIM_NO_DUPLICATE; 422 VALIDATION_FAILED | bắt buộc | không |
| `acknowledgeWarrantyClaim` | `POST /warranty-claims/{id}/acknowledge` | `warranty.respond` | committed_fix_on*, note | CommandResult | 409 CLAIM_STATE_INVALID; 409 VERSION_CONFLICT | bắt buộc | có |
| `recordWarrantyFix` | `POST /warranty-claims/{id}/fixed` | `warranty.respond` | fixed_on*, evidence_photo_id, evidence_document_version_id, note* | CommandResult | 422 EVIDENCE_REQUIRED; 409 CLAIM_STATE_INVALID; 409 VERSION_CONFLICT | bắt buộc | có |
| `verifyWarrantyClaim` | `POST /warranty-claims/{id}/verify` | `warranty.verify` | outcome*, cost_borne_by*, note* | CommandResult | 403 SELF_APPROVAL_FORBIDDEN; 409 CLAIM_STATE_INVALID; 409 VERSION_CONFLICT | bắt buộc | có |
| `closeWarrantyObligation` | `POST /warranty-obligations/{id}/close` | `warranty.manage` | note | CommandResult | 422 WARRANTY_NOT_EXPIRED; 422 OPEN_WARRANTY_CLAIMS; 409 WARRANTY_STATE_INVALID | bắt buộc | không |
| `linkOmPlan` | `POST /asset-records/{id}/om-link` | `asset.manage` | operator_unit_id*, om_plan_document_version_id, om_contract_id, maintenance_cycle_months, next_maintenance_due, external_system_ref | CommandResult | 422 ASSET_NOT_TRANSFERRED; 422 VALIDATION_FAILED | bắt buộc | không |
| `scheduleEvaluationTrigger` | `POST /projects/{id}/evaluation-triggers` | `evaluation.trigger.manage` | trigger_kind*, source_handover_id, due_on* | CommandResult | 409 TRIGGER_DUPLICATE; 422 PROJECT_STAGE_INVALID; 422 VALIDATION_FAILED | bắt buộc | không |
| `acknowledgeEvaluationTrigger` | `POST /evaluation-triggers/{id}/acknowledge` | `evaluation.trigger.manage` | mne_evaluation_id* | CommandResult | 409 TRIGGER_STATE_INVALID | bắt buộc | không |
| `listExpiringWarranties` | `GET /warranty-obligations/expiring` | `warranty.read` | within_days, cursor, limit | DTO đọc (read model) | — | — | không |
| `getHandoverTrace` | `GET /handovers/{id}/trace` | `handover.read` | (không) | DTO đọc (read model) | — | — | không |

Mô tả ngắn từng lệnh (summary OpenAPI) và guard trạng thái nằm ở `openapi.json` (`x-state-guard`, `x-domain-events`, `x-error-codes`).

Rà soát GET scaffold (`x-contract-maturity: reference-scaffolding`) của tài nguyên thuộc phân hệ:

| Tài nguyên | Quyết định | Lý do |
|---|---|---|
| `/resources/handover` (list + get) | DTO riêng | punch_list là bản chụp; nguồn chi tiết ở handover_punch_item qua getHandoverTrace. |
| `/resources/asset_record` (list + get) | DTO riêng | Giá trị tài sản chỉ vai trò tài sản/tài chính; che mã tài sản ngoài khi chưa chuyển giao. |

## 8. UI/UX

Tuân thủ mockup (D-B11): list/review/detail/board/confirm theo tài liệu 06; tồn tại CRITICAL nổi bật bằng nhãn chữ + màu cảnh báo.

| ID | Tên màn hình | Loại | Nền tảng | Phase | Trường chính | Command / API | Ghi chú nghiệp vụ |
|---|---|---|---|---|---|---|---|
| AST-01 | Danh sách bàn giao | list | web | P1 | Số bàn giao, Hợp đồng, Loại, Đơn vị nhận, Tồn tại trọng yếu, Trạng thái | `createHandover` | Hiển thị số tồn tại trọng yếu chưa đóng (UC-AST-01) |
| AST-02 | Biên bản bàn giao và tồn tại | review | web | P1 | Tồn tại, Mức độ, Nhà thầu xử lý, Hạn, Bằng chứng, Xác nhận, Quyết định nhận | `addPunchItem`, `markPunchItemFixed`, `verifyPunchItem`, `waivePunchItem`, `post_handovers_id_decision`, `getHandoverTrace` | Không nhận khi còn tồn tại CRITICAL; CRITICAL không được miễn; người xác nhận khác nhà thầu (UC-AST-01) |
| AST-03 | Hồ sơ tài sản | detail | web | P1 | Mã tài sản, Tên, Nhóm, Nguồn hình thành, Giá trị ghi nhận, Đơn vị tiếp nhận, Mã tài sản ngoài | `registerAsset`, `transferAsset` | Tổng giá trị tài sản không vượt giá trị hợp đồng; mã ngoài nhập tay (adapter MISSING) (UC-AST-02) |
| AST-04 | Bảo hành và giữ lại | table | web | P2 | Nghĩa vụ bảo hành, Phạm vi, Bắt đầu – kết thúc, Bảo lãnh bảo hành, Giữ lại, Trạng thái | `createWarrantyObligation`, `closeWarrantyObligation`, `listExpiringWarranties` | Thời hạn tối thiểu theo rule [CXN-EXE-04]; hết hạn và hết yêu cầu mở mới đóng và cho giải tỏa (UC-AST-03) |
| AST-05 | Yêu cầu bảo hành | board | web | P2 | Yêu cầu, Mức độ, Nhà thầu, Hạn phản hồi, Bằng chứng, Trạng thái, Chi phí chịu | `fileWarrantyClaim`, `acknowledgeWarrantyClaim`, `recordWarrantyFix`, `verifyWarrantyClaim` | Quá hạn phản hồi tạo vướng mắc; xác nhận độc lập (UC-AST-03) |
| AST-06 | Liên kết vận hành bảo trì | detail | web | P2 | Tài sản, Đơn vị vận hành, Kế hoạch O&M, Hợp đồng O&M, Chu kỳ bảo trì, Hạn bảo trì kế | `linkOmPlan` | Chỉ liên kết tài sản đã chuyển giao (UC-AST-02) |
| AST-07 | Kích hoạt đánh giá sau đầu tư | confirm | web | P2 | Dự án, Loại kích hoạt, Bàn giao nguồn, Ngày đến hạn, Trạng thái, Đánh giá MNE | `scheduleEvaluationTrigger`, `acknowledgeEvaluationTrigger` | Chỉ đặt kích hoạt; việc đánh giá do MNE thực hiện (UC-AST-04) |


**Trạng thái riêng.** “Còn n tồn tại trọng yếu”, “thiếu hồ sơ hoàn công”, “bảo hành còn n ngày”, “yêu cầu quá hạn phản hồi”, “mã tài sản ngoài nhập tay”. **Web/mobile.** Web; mobile qua MOB-66 (bàn giao và bảo hành, thuộc MOB): chụp ảnh tồn tại/khiếm khuyết, nhà thầu báo đã sửa; xác nhận và quyết định nhận bàn giao chỉ online.

## 9. Sự kiện, job, tích hợp, quan sát

**Phát.** `ast.handover.drafted/accepted.v1` {handover_id, contract_id, recipient_unit_id, accepted_at}; `ast.punch_item.added/fixed/verified/waived.v1`; `ast.asset.registered/transferred.v1`; `ast.warranty.created/closed.v1` {obligation_id, contract_id, handover_id} → CTR; `ast.warranty_claim.filed/acknowledged/fixed/verified.v1`; `ast.om_link.linked.v1`; `ast.evaluation_trigger.scheduled/acknowledged.v1`; `ast.evaluation.due.v1` {project_id, trigger_kind, handover_id, due_on} → MNE.
**Nhận.** `qms.quality_acceptance.approved.v1` (COMPLETION), `ctr.contract.completed.v1` (đề xuất bảo hành), `pay.settlement.closed.v1` (giá trị quyết toán, trigger SETTLEMENT_CLOSED).
**Job.** `warranty-expiry` (06:00 VN, cảnh báo 90/30/7 ngày), `warranty-claim-overdue` (mỗi giờ), `evaluation-trigger` (06:00 VN).
**Quan sát.** `ast_open_critical_punch`, `ast_warranty_expiring`, `ast_claim_overdue`, `ast_evaluation_due_fired_total`.

## 10. Kiểm thử

Bộ fixture synthetic dùng chung được định nghĩa tại `PAY.md` §10 (nhãn [EXE-FX]); mọi ID/người dùng trong bảng là dữ liệu giả. Các test dưới đây là nguồn của `test_cases.json` (ID `UAT-AC…`); loại: domain / integration / security / concurrency / performance / E2E.

| ID | Loại | Ưu tiên | Tình huống | Setup | Input | Bước | Expected | Bằng chứng |
|---|---|---|---|---|---|---|---|---|
| UAT-AC65 | business | P1 | Bàn giao truy được tồn tại, tài sản, biên bản và đơn vị nhận | [EXE-FX] HO-A-001 cho HD-A-001: biên bản BB-BG-001 (document_version DV-901), đơn vị nhận SOGT-A, 3 punch item (P1 CRITICAL OPEN, P2 MAJOR FIXED, P3 MINOR WAIVED), 2 tài sản AS-001 (3.200.000.000), AS-002 (1.800.000.000). | getHandoverTrace; post_handovers_id_decision approve khi P1 còn OPEN; sau khi P1 VERIFIED. | 1. Gọi getHandoverTrace HO-A-001. 2. Duyệt bàn giao khi P1 CRITICAL còn OPEN. 3. Verify P1 (người khác nhà thầu), xác nhận P2; duyệt lại. 4. Đọc handover.open_critical_punch_count và asset_record. | bàn giao phải truy được tồn tại, tài sản, biên bản và đơn vị nhận. Cụ thể: Trace trả đủ: 3 punch item với trạng thái, 2 tài sản (tổng 5.000.000.000), biên bản DV-901, đơn vị nhận SOGT-A, hợp đồng HD-A-001. Duyệt khi còn CRITICAL: 422 OPEN_CRITICAL_PUNCH. Sau P1 VERIFIED, P2 VERIFIED: bàn giao ACCEPTED, open_critical_punch_count=0, accepted_by lưu; P3 giữ WAIVED với lý do và người duyệt. Tổng tài sản không vượt giá trị hợp đồng. | Response trace, bảng handover/handover_punch_item/asset_record |
| UAT-AC388 | domain | P0 | Chặn nhận bàn giao khi còn tồn tại trọng yếu; không miễn tồn tại CRITICAL | [EXE-FX] HO-A-002 PUNCH_PENDING: P1 CRITICAL OPEN, P2 MAJOR OPEN; open_critical_punch_count=1; hồ sơ hoàn công đã nộp. | waivePunchItem P1; approve; verify P1 bởi nhà thầu; markPunchItemFixed P1 thiếu bằng chứng; đủ; verify bởi giám sát; UPDATE trực tiếp status=ACCEPTED. | 1. waivePunchItem P1. 2. decision approve khi count=1. 3. markPunchItemFixed P1 thiếu bằng chứng, rồi kèm ảnh geotag. 4. Nhà thầu tự verify; giám sát verify. 5. UPDATE handover SET status='ACCEPTED' khi count=1 bằng SQL. | Bước 1: 422 CRITICAL_CANNOT_BE_WAIVED. Bước 2: 422 OPEN_CRITICAL_PUNCH. Bước 3 thiếu bằng chứng: 422 EVIDENCE_REQUIRED. Bước 4: nhà thầu 403 SELF_APPROVAL_FORBIDDEN, giám sát: VERIFIED và count→0. Bước 5: lỗi CHECK handover_accepted_chk khi count>0. Sau khi count=0: approve thành công. | Response, lỗi CHECK, bảng handover_punch_item |
| UAT-AC389 | domain | P1 | Đăng ký tài sản: hồ sơ hoàn công và giá trị không vượt hợp đồng | [EXE-FX] HO-A-003 PUNCH_PENDING; HD-A-001 giá trị 10.000.000.000; tài sản đã đăng ký 5.000.000.000. | registerAsset khi handover chưa ACCEPTED; sau khi ACCEPTED với value 5.000.000.001; 5.000.000.000; trùng asset_code. | 1. registerAsset khi bàn giao chưa ACCEPTED. 2. registerAsset 5.000.000.001 sau khi ACCEPTED. 3. registerAsset 5.000.000.000. 4. registerAsset trùng AS-001. 5. transferAsset thiếu commissioning document. | Bước 1: 409 HANDOVER_STATE_INVALID. Bước 2: 422 VALUE_EXCEEDS_CONTRACT (tổng tài sản 10.000.000.001 > 10.000.000.000). Bước 3: 200 REGISTERED, tổng = giá trị hợp đồng. Bước 4: 409 ASSET_CODE_DUPLICATE. Bước 5: 422 (CHECK/DTO); transferAsset đủ hồ sơ: TRANSFERRED với transferred_on. | Response, bảng asset_record |
| UAT-AC390 | domain | P1 | Thời hạn bảo hành tối thiểu theo rule và chặn yêu cầu sau hết hạn | [EXE-FX] Rule AST.WARRANTY fixture RULE-WAR-FIX-1 (không phải quy định, CXN-EXE-04 chưa xác nhận): công trình cấp I/đặc biệt tối thiểu 24 tháng, còn lại 12 tháng; HO-A-001 ACCEPTED; HD-A-001 công trình cấp II. | createWarrantyObligation period_months=6; 12; sau đó fileWarrantyClaim ngày trong và sau hạn. | 1. Tạo nghĩa vụ 6 tháng starts_on=2026-09-01. 2. Tạo 12 tháng. 3. Đọc ends_on. 4. fileWarrantyClaim reported_on=2027-08-31 và 2027-09-02. | 6 tháng: 422 WARRANTY_PERIOD_BELOW_MINIMUM (tối thiểu 12). 12 tháng: ACTIVE, ends_on = 2027-09-01 (starts_on + 12 tháng). Claim 2027-08-31: 200; claim 2027-09-02: 422 WARRANTY_EXPIRED. rule_version_id lưu RULE-WAR-FIX-1 và hiển thị cảnh báo chưa xác nhận. | Bảng warranty_obligation/warranty_claim |
| UAT-AC391 | integration | P1 | Yêu cầu bảo hành: phản hồi, sửa chữa, xác nhận độc lập và leo thang khi quá hạn | [EXE-FX] WO-A-001 ACTIVE; claim WC-001 reported_on 2027-01-10, response_due_on 2027-01-17, nhà thầu NT-A-01. | acknowledgeWarrantyClaim; job quá hạn 2027-01-18; recordWarrantyFix; verifyWarrantyClaim bởi người báo cáo và bởi người khác. | 1. Chạy job 2027-01-18 khi chưa phản hồi; đọc issue_id. 2. u.nt acknowledge với committed_fix_on. 3. recordWarrantyFix kèm ảnh. 4. Người báo cáo verify; u.cv.hd verify. | Job: tạo 1 vướng mắc ISS (source_module=AST) và gán issue_id, chạy lại không tạo trùng. acknowledge: ACKNOWLEDGED. Fix: FIXED với fixed_on. Người báo cáo verify: 403 SELF_APPROVAL_FORBIDDEN; u.cv.hd: VERIFIED, cost_borne_by lưu; CHECK warranty_claim_verify_chk thỏa. | Bảng warranty_claim/issue |
| UAT-AC392 | integration | P0 | Hết hạn bảo hành và giải tỏa giữ lại: yêu cầu mở chặn giải tỏa | [EXE-FX] WO-A-001 hết hạn 2027-09-01, retention_hold B01 100.000.000 và B02 50.000.000 điều kiện WARRANTY_END; bảo lãnh bảo hành BL-W-001 ACTIVE; claim WC-002 OPEN. | closeWarrantyObligation ngày 2027-09-02 khi WC-002 mở; sau khi WC-002 CLOSED; releaseRetention và releaseGuarantee. | 1. Chạy job hết hạn 2027-09-02; đọc status. 2. closeWarrantyObligation khi WC-002 mở. 3. Đóng WC-002; closeWarrantyObligation. 4. releaseRetention B01, B02 và releaseGuarantee BL-W-001. | Job: obligation EXPIRED. Close khi claim mở: 422 OPEN_WARRANTY_CLAIMS. Sau khi đóng claim: CLOSED, phát ast.warranty.closed.v1; CTR cho phép releaseRetention (điều kiện WARRANTY_END thỏa) tổng 150.000.000 và releaseGuarantee BL-W-001 (có bằng chứng). Trước khi obligation CLOSED: releaseRetention trả 422 RELEASE_CONDITION_NOT_MET. | Bảng warranty_obligation/retention_hold/guarantee, outbox |
| UAT-AC393 | domain | P1 | Liên kết vận hành bảo trì và mã tài sản ngoài | [EXE-FX] AS-001 REGISTERED chưa chuyển giao; AS-002 TRANSFERRED; không có adapter hệ thống tài sản ngoài (MISSING). | linkOmPlan cho AS-001 và AS-002; liên kết lần hai cho AS-002; transferAsset với external_asset_id. | 1. linkOmPlan AS-001. 2. linkOmPlan AS-002 operator_unit_id=SOGT-A maintenance_cycle_months=6 next_maintenance_due=2027-03-01. 3. linkOmPlan AS-002 lần 2. 4. transferAsset AS-001 với external_asset_id="TS-2027-009". | AS-001: 422 ASSET_NOT_TRANSFERRED. AS-002: 200 LINKED. Lần 2: 409 do unique om_link_asset_uq (chỉ một liên kết hoạt động). external_asset_id lưu dạng nhập tay, hiển thị nhãn "nhập tay — không đồng bộ". | Bảng om_link/asset_record |
| UAT-AC394 | integration | P1 | Kích hoạt đánh giá sau đầu tư cho MNE | [EXE-FX] HO-A-001 ACCEPTED ngày 2027-01-15; MNE có mne_evaluation ME-001 chờ gắn. | scheduleEvaluationTrigger POST_HANDOVER_12M due_on 2028-01-15; lần hai; job 2028-01-15; acknowledgeEvaluationTrigger. | 1. Đặt trigger; đặt lần hai cùng loại và handover. 2. Chạy job ngày 2028-01-14 và 2028-01-15; đọc outbox. 3. MNE acknowledge với mne_evaluation_id=ME-001. 4. Chạy lại job. | Trigger lần 2: 409 TRIGGER_DUPLICATE (unique evaluation_trigger_uq). Job 01-14: vẫn SCHEDULED; 01-15: FIRED, fired_at, outbox ast.evaluation.due.v1 (project_id, trigger_kind, handover_id). Acknowledge: ACKNOWLEDGED, mne_evaluation_id=ME-001. Job lại: không phát sự kiện thứ hai. | Bảng evaluation_trigger, outbox |
| UAT-AC395 | security | P1 | Cách ly tenant cho bàn giao, tài sản và bảo hành | [EXE-FX] Tài sản AS-B-001 và bảo hành WO-B-001 thuộc TNT-B. | GET /handovers/{HO-B-001}/trace; POST /asset-records/{AS-B-001}/transfer; POST /warranty-obligations/{WO-B-001}/claims bởi token TNT-A. | 1. Gọi ba endpoint với id TNT-B. 2. SQL count trên asset_record, warranty_claim khi chưa đặt app.tenant_id. | Ba endpoint: 404 RESOURCE_NOT_FOUND; không thay đổi dữ liệu TNT-B; SQL không tenant trả 0 dòng. | Response và kết quả SQL |

## 11. Tiêu chí nghiệm thu

- **AC-AST-01**: Given hồ sơ bàn giao, When nhận bàn giao, Then truy được tồn tại, tài sản, biên bản và đơn vị nhận; còn tồn tại CRITICAL thì không nhận và không được miễn. Test: UAT-AC65, UAT-AC388.
- **AC-AST-02**: Given tài sản hình thành, When đăng ký, Then chỉ sau khi bàn giao ACCEPTED, tổng giá trị không vượt giá trị hợp đồng, mã ngoài nhập tay. Test: UAT-AC389.
- **AC-AST-03**: Given nghĩa vụ bảo hành, When lập và nhận yêu cầu, Then thời hạn không dưới tối thiểu theo rule [CXN-EXE-04], yêu cầu sau hạn bị chặn, quá hạn phản hồi leo thang và xác nhận độc lập. Test: UAT-AC390, UAT-AC391.
- **AC-AST-04**: Given hết hạn bảo hành, When đóng nghĩa vụ, Then chỉ khi không còn yêu cầu mở, sau đó mới cho giải tỏa giữ lại và bảo lãnh bảo hành. Test: UAT-AC392.
- **AC-AST-05**: Given liên kết vận hành bảo trì, When tạo, Then chỉ cho tài sản đã chuyển giao và một liên kết hoạt động mỗi tài sản. Test: UAT-AC393.
- **AC-AST-06**: Given bàn giao đã nhận, When tới mốc, Then phát sự kiện kích hoạt đánh giá sau đầu tư đúng một lần cho MNE. Test: UAT-AC394.
- **AC-AST-07**: Given hai tenant, When truy cập chéo, Then 404/0 dòng. Test: UAT-AC395.

## 12. Mức tối thiểu cho R1 và phần sâu hóa R2+

**R1.** Bàn giao + tồn tại + quyết định nhận (AST-01, AST-02), đăng ký và chuyển giao tài sản (AST-03), điều kiện giải tỏa từ đóng bảo hành (tối thiểu nghĩa vụ + đóng). **R2.** Yêu cầu bảo hành đầy đủ (AST-05), O&M (AST-06), kích hoạt đánh giá (AST-07), cập nhật giá trị theo quyết toán. **R3.** Tích hợp sổ tài sản công khi có đặc tả.

| Hạng mục bắt buộc người duyệt | Giờ dự kiến | Người duyệt |
|---|---|---|
| Điều kiện nhận bàn giao và miễn tồn tại | 2 | Chủ nghiệp vụ xây dựng |
| Thời hạn bảo hành tối thiểu, giải tỏa giữ lại | 2 | Chủ nghiệp vụ xây dựng / Kế toán [CXN-EXE-04] |
| Giá trị tài sản theo quyết toán | 2 | Kế toán [CXN-09] |

## 13. Rủi ro, câu hỏi mở, phụ thuộc bên thứ ba

| ID | Rủi ro / câu hỏi | Owner | Điều kiện giải quyết |
|---|---|---|---|
| R-AST-01 | Thời hạn/mức bảo hành theo cấp công trình [CXN-EXE-04] | Chủ nghiệp vụ xây dựng | Văn bản gốc; rule AST.WARRANTY |
| R-AST-02 | Không có đặc tả hệ thống quản lý tài sản công (adapter MISSING) | Integration Lead | Đặc tả từ cơ quan khách hàng (D05) |
| R-AST-03 | Thời hạn phản hồi bảo hành là [GIẢ ĐỊNH] | PO | Quy chế tenant / điều khoản hợp đồng |
| R-AST-04 | Mốc đánh giá sau đầu tư phụ thuộc quy chế MNE [CXN-10] | Chủ nghiệp vụ vốn | MNE công bố rule |

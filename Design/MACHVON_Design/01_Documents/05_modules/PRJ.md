# PRJ — Danh mục dự án, vòng đời PIMA và trách nhiệm giải ngân

Phiên bản đặc tả M1 · 22/10/2026 · Nguồn dữ liệu máy: `work/staging/capital.json` (bảng `project`, `project_revision`, `project_component`, `project_milestone`, `project_appraisal`, `project_risk`, `project_accountability`, `task_force`, `task_force_member`, `explanation_request`, `project_transfer`). Quy ước chung (tenant, RLS, idempotency, audit/outbox, Problem, i18n, 7 trạng thái UI) theo `04_Thiet_ke_co_ban.md` và `05_Thiet_ke_chi_tiet.md`; tài liệu này chỉ nêu phần riêng của PRJ.

## 1. Mục đích, phạm vi, ranh giới

**Vấn đề nghiệp vụ.** Tỉnh/bộ cần một danh mục dự án duy nhất, có vòng đời đầu tư rõ ràng từ ý tưởng tới đóng hồ sơ, để (a) chỉ bố trí vốn cho dự án đã qua thẩm định và có mã trên Hệ thống thông tin quốc gia về đầu tư công (Hệ thống TTQG về ĐTC), (b) biết ai chịu trách nhiệm giải ngân từng dự án và (c) yêu cầu giải trình có hạn khi dự án chậm. Bản v1.3 chỉ có trạng thái `Draft → InReview → Approved → Active → Closed`; M1 thay bằng vòng đời theo khung PIMA của IMF (Concept → Appraisal → Pipeline/ngân hàng dự án → Budgeted → Implementation → Completed → Settled → Closed).

**Trong phạm vi:** tạo/sửa dự án trong tenant; vòng đời PIMA có guard; chấm điểm thẩm định theo bộ tiêu chí có phiên bản; nhóm dự án QTQG/A/B/C; mã dự án TTQG (gán tay và nhập tệp đối chiếu); điều chỉnh dự án bằng revision có quyết định; WBS và mốc tiến độ; sổ đăng ký rủi ro; phân công lãnh đạo phụ trách, tổ công tác đôn đốc giải ngân và giải trình theo Công điện 162/CĐ-TTg [CXN-33]; chuyển dự án giữa đơn vị trong cùng tenant.

**Ngoài phạm vi:** kế hoạch vốn và số tiền giao (CAP); báo cáo giải ngân (DIS); hợp đồng, nghiệm thu, thanh toán, quyết toán (CTR/PAY — PRJ chỉ nhận sự kiện `settlement.closed`); hồ sơ pháp lý/giấy phép chi tiết (PMT/LGL); soạn, ký, cấp số văn bản (DOC — PRJ chỉ lưu `*_document_id` tham chiếu văn bản đã đăng ký); GPMB (LND). Chuyển dự án **giữa tenant** không phải command PRJ mà là export/import có audit của SAS (R6).

**Phụ thuộc:** IAM (membership, cây `organization_unit`, scope), MDM (địa bàn, lĩnh vực, loại dự án, chương trình/CTMTQG, bộ tiêu chí thẩm định `APPRAISAL_CRITERIA`, nhóm rủi ro `RISK_CATEGORY`, quy tắc nhóm dự án `PROJECT_GROUP_THRESHOLDS`), DOC (văn bản quyết định), CAP (sự kiện `capital.plan_published` đưa dự án sang BUDGETED), DIS (cảnh báo sinh yêu cầu giải trình), NOT (nhắc hạn), ISS (liên kết rủi ro ↔ vướng mắc).

**Căn cứ.** Luật Đầu tư công 58/2024/QH15 (sửa bởi Luật 90/2025/QH15): chủ trương đầu tư, quyết định đầu tư, phân nhóm dự án; NĐ 85/2025/NĐ-CP (sửa bởi NĐ 275/2025) [CXN-13]; nhóm QTQG/A/B/C và ngưỡng theo lĩnh vực là dữ liệu quy tắc [CXN-32]; mã dự án trên Hệ thống TTQG về ĐTC bắt buộc, quy tắc "không có mã thì không bố trí/giải ngân" [CXN-01]; Công điện 162/CĐ-TTg về phân công lãnh đạo, tổ công tác, kế hoạch giải ngân từng dự án và giải trình [CXN-33]. Thị trường: IMF PIMA (appraisal → selection → project bank), SAP PPM/Oracle Unifier (gate review, risk register), Procore (ownership và audit).

## 2. Actor, tenant và phạm vi quyền

| Actor | Tenant/scope | Hành động được phép | Hành động bị cấm |
|---|---|---|---|
| Cán bộ chủ đầu tư / Ban QLDA (maker) | Membership tenant; scope = đơn vị `owner_unit_id`/`investor_unit_id` và đơn vị con | `createProject`, `updateProjectProfile`, `submitProjectForAppraisal`, `proposeProjectRevision`, `requestProjectTransfer`, WBS/mốc, `registerProjectRisk`, `submitExplanation` khi là người được yêu cầu | Tự chấm thẩm định dự án mình đề xuất; tự duyệt revision/chuyển; đổi `status`, `code`, `tenant_id`, `total_investment_vnd` qua profile |
| Người thẩm định (Sở Tài chính/hội đồng) | Scope đơn vị thẩm định được giao | `recordProjectAppraisal` | Chấm dự án do chính mình tạo (`SELF_APPROVAL_DENIED`) |
| Người quyết định (lãnh đạo Sở/UBND) | Scope theo cấp quyết định `decision_authority_unit_id` | `decideProjectAppraisal`, `decideProjectRevision`, `decideProjectTransfer`, `startProjectImplementation`, `completeProject`, `closeProject`, `cancelProject`, `suspendProject` | Duyệt hồ sơ do mình đề xuất; quyết định ngoài cấp thẩm quyền |
| Quản trị mã TTQG (chuyên viên kế hoạch) | Toàn tenant hoặc đơn vị được giao | `assignNationalProjectCode`, `importNationalProjectCodes` | Sửa mã đã gán cho dự án đã IMPLEMENTATION mà không có lý do + audit |
| Lãnh đạo phụ trách / trưởng tổ công tác | Dự án được phân công; phạm vi tổ | `requestExplanation`, `reviewExplanation`, xem PRJ-17/18/19, DIS-24 | Kết luận giải trình do chính mình phản hồi |
| Quản trị phân công (Văn phòng UBND/Sở) | Toàn tenant | `assignProjectLeader`, `endProjectLeaderAssignment`, `createTaskForce`, `addTaskForceMember`, `dissolveTaskForce` | Thêm thành viên ngoài tenant hoặc ngoài phạm vi tổ |
| Auditor | Đọc theo scope | GET mọi tài nguyên PRJ, lịch sử | Mọi command |
| Nhà thầu (guest) | Chỉ hợp đồng được mời | Đọc tên/mã dự án qua CTR | Mọi API PRJ khác (404) |
| System actor | Consumer sự kiện | PIPELINE→BUDGETED (khi kế hoạch có vốn công bố), COMPLETED→SETTLED (khi `settlement.closed`), đánh dấu OVERDUE giải trình | Bất kỳ chuyển nào khác |

Mọi truy vấn áp RLS tenant rồi lọc cây đơn vị; người ngoài scope nhận 404 (không 403) để không lộ tồn tại.

## 3. Luồng nghiệp vụ

**F1 — Tạo dự án (PRJ-02).** Tiền điều kiện: actor có `project.create` trên `owner_unit_id`; master địa bàn/lĩnh vực có version EFFECTIVE tại ngày tạo. (1) Nhập mã nội bộ, tên, đơn vị, địa bàn, lĩnh vực, tổng mức dự kiến. (2) `createProject` (Idempotency-Key) → `project.status = CONCEPT`, `version = 1`, `project_revision` r1 `INITIAL`. (3) Audit + outbox `project.created.v1`. Lỗi: mã trùng → 409 `PROJECT_CODE_DUPLICATE`; master hết hiệu lực → 422 `MASTER_NOT_EFFECTIVE`. Đồng thời: hai request cùng mã khác key → unique `(tenant_id, code)` chặn, request sau 409. Hậu điều kiện: dự án xuất hiện cột "Ý tưởng" ở PRJ-14.

**F2 — Thẩm định và vào ngân hàng dự án (PRJ-09 → PRJ-10/15 → PRJ-14).** (1) Maker `submitProjectForAppraisal` kèm hồ sơ đề xuất chủ trương (`policy_proposal_document_id`) → APPRAISAL. (2) Mỗi người thẩm định `recordProjectAppraisal` theo bộ tiêu chí hiện hành; hệ thống tính `total_score` (BR-PRJ-03). (3) Người quyết định `decideProjectAppraisal`: ADMIT (cần `decision_document_id` QĐ chủ trương, `project_group`) → PIPELINE, cập nhật `appraisal_score`, `policy_decision_document_id`; REJECT → REJECTED; RETURN → CONCEPT (revision hồ sơ mới). Nhánh: quyết định trái khuyến nghị cần `override_reason` ≥ 20 ký tự (`OVERRIDE_REASON_REQUIRED`). Đồng thời: hai người quyết định cùng phiếu → If-Match; người sau 409 `VERSION_CONFLICT`.

**F3 — Bố trí vốn (CAP → PRJ).** Khi `capital.plan_published.v1` có dòng vốn > 0 cho dự án PIPELINE, consumer (idempotent theo `event_id`) chuyển BUDGETED. Guard: nếu quy tắc `NATIONAL_CODE_REQUIRED` = BLOCK thì CAP đã chặn publish trước đó (`NATIONAL_CODE_REQUIRED`) — PRJ không tự sửa.

**F4 — Khởi công/thực hiện (PRJ-14).** `startProjectImplementation` cần `investment_decision_document_id` và mã TTQG (theo rule). Thành công → IMPLEMENTATION, phát `project.stage_changed.v1` (MNE tạo nghĩa vụ báo cáo khởi công). Tạm dừng/tiếp tục: `suspendProject`/`resumeProject` có văn bản.

**F5 — Hoàn thành → quyết toán → đóng.** `completeProject` (biên bản hoàn thành) → COMPLETED; sự kiện `settlement.closed` (PAY) → SETTLED; `closeProject` → CLOSED. Hủy: `cancelProject` chỉ từ CONCEPT/APPRAISAL/PIPELINE/BUDGETED và khi không còn nghĩa vụ vốn (allocation_balance committed/disbursed = 0, không có reservation ACTIVE) — ngược lại 409 `OPEN_OBLIGATIONS_EXIST`.

**F6 — Điều chỉnh dự án (PRJ-06).** `proposeProjectRevision` tạo `project_revision` DRAFT→IN_REVIEW với before/after; `decideProjectRevision` approve cần `decision_document_id` + `effective_from`; revision cũ → SUPERSEDED; `project.total_investment_vnd` lấy theo revision APPROVED hiện hành. Chỉ một revision đang chờ (`REVISION_PENDING_EXISTS`).

**F7 — Mã TTQG (PRJ-21).** Gán tay `assignNationalProjectCode` hoặc nhập tệp đối chiếu `importNationalProjectCodes` (dry-run → apply). Idempotent theo `(tenant, file_sha256)`; mã trùng trong tenant → lỗi dòng `NATIONAL_CODE_DUPLICATE`. Không gọi API hệ thống quốc gia (adapter PROPOSED, tệp do người dùng tải từ hệ thống đó).

**F8 — Rủi ro (PRJ-16).** Ghi, cập nhật (If-Match), đóng/chấp nhận có lý do. Điểm ≥ 15 phát `project.risk_registered.v1` severity CRITICAL → HOME-03.

**F9 — Trách nhiệm giải ngân (PRJ-17/18/19).** Phân công lãnh đạo (tối đa một `LEADER_IN_CHARGE` ACTIVE/dự án); tổ công tác có phạm vi đơn vị; giải trình: lãnh đạo hoặc rule DIS (`auto_explanation`) tạo `explanation_request` REQUESTED → người được yêu cầu `submitExplanation` → RESPONDED → lãnh đạo `reviewExplanation` ACCEPTED/RETURNED. Job hằng giờ chuyển REQUESTED quá `due_at` → OVERDUE (vẫn nhận phản hồi, `is_late = true`). ACCEPTED đóng cảnh báo liên kết (DIS `early_warning` → RESOLVED).

**F10 — Chuyển dự án (PRJ-20).** `requestProjectTransfer` (đơn vị nhận phải cùng tenant, nếu không → 404) → `decideProjectTransfer` (người khác) → APPLIED tại `effective_date`: cập nhật `owner_unit_id` hoặc `investor_unit_id`, version+1, outbox `project.transferred.v1`. Báo cáo/snapshot trước `effective_date` giữ đơn vị cũ (đọc theo `period_snapshot_line.unit_id`).

## 4. State machine

```
            submit                 decide ADMIT           plan_published(vốn>0)      implementation-start
 CONCEPT ───────────► APPRAISAL ─────────────► PIPELINE ────────────────────► BUDGETED ─────────────────────► IMPLEMENTATION
   ▲   │                 │  │ decide REJECT                                            │                          │  ▲
   │   │cancel           │  └──────────► REJECTED                                      │cancel           suspend  │  │ resume
   │   ▼                 │ decide RETURN                                               ▼                          ▼  │
   │ CANCELLED ◄─────────┴──(cancel từ APPRAISAL/PIPELINE)                          CANCELLED                 SUSPENDED
   └──────────────────────────(RETURN)                                                                          │
                                                                          completion                            │
 IMPLEMENTATION ──────────────────────────────────────────────────────────────────► COMPLETED ──settlement.closed──► SETTLED ──closure──► CLOSED
```

| Từ | Command | Đến | Ai được làm | Guard | Audit/Event |
|---|---|---|---|---|---|
| CONCEPT | `submitProjectForAppraisal` | APPRAISAL | maker có `project.stage.submit` | hồ sơ đề xuất đính kèm; tổng mức > 0 | `project.stage_changed.v1` |
| APPRAISAL | `decideProjectAppraisal` ADMIT | PIPELINE | `project.appraisal.decide`, ≠ người đề xuất | ≥1 phiếu SUBMITTED; `decision_document_id`; `project_group`; override cần lý do | `project.stage_changed.v1` |
| APPRAISAL | `decideProjectAppraisal` REJECT | REJECTED | như trên | lý do | như trên |
| APPRAISAL | `decideProjectAppraisal` RETURN | CONCEPT | như trên | lý do | như trên |
| PIPELINE | (system) `capital.plan_published` | BUDGETED | system actor | dòng vốn PUBLISHED > 0 | như trên |
| BUDGETED | `startProjectImplementation` | IMPLEMENTATION | `project.stage.implement` | QĐ đầu tư; mã TTQG theo rule [CXN-01] | như trên; MNE nghĩa vụ khởi công |
| IMPLEMENTATION | `suspendProject` | SUSPENDED | `project.stage.suspend` | văn bản | như trên |
| SUSPENDED | `resumeProject` | IMPLEMENTATION | `project.stage.suspend` | lý do | như trên |
| IMPLEMENTATION | `completeProject` | COMPLETED | `project.stage.complete` | văn bản hoàn thành | như trên; MNE nghĩa vụ kết thúc |
| COMPLETED | (system) `settlement.closed` | SETTLED | system actor | event từ PAY, dedupe inbox | như trên |
| SETTLED | `closeProject` | CLOSED | `project.stage.close` | không reservation/obligation mở | như trên |
| CONCEPT/APPRAISAL/PIPELINE/BUDGETED | `cancelProject` | CANCELLED | `project.stage.cancel` | văn bản; không nghĩa vụ vốn | như trên |

Chuyển bị cấm (409 `STAGE_TRANSITION_DENIED`): mọi cặp không có trong bảng, ví dụ CONCEPT→IMPLEMENTATION, PIPELINE→IMPLEMENTATION (bỏ qua bố trí vốn), CLOSED/REJECTED/CANCELLED → bất kỳ (trạng thái cuối), IMPLEMENTATION→CANCELLED (phải dừng + quyết toán). Bảng transition nằm trong code domain (K5) và là guard bắt buộc mà workflow Temporal gọi qua command (R9).

**Ánh xạ trạng thái cũ (CR-PRJ-01):** Draft→CONCEPT, InReview→APPRAISAL, Approved→PIPELINE, Active→IMPLEMENTATION, Closed→CLOSED. Dữ liệu migration theo ánh xạ này; dự án Active có kế hoạch vốn → BUDGETED nếu chưa có QĐ đầu tư.

State phụ: `project_revision` DRAFT→IN_REVIEW→APPROVED|REJECTED, APPROVED→SUPERSEDED; `project_appraisal` DRAFT→SUBMITTED→DECIDED|VOID; `project_risk` OPEN→MITIGATING→ESCALATED→CLOSED|ACCEPTED; `project_accountability` ACTIVE→ENDED; `task_force` ACTIVE→DISSOLVED; `explanation_request` REQUESTED→RESPONDED→ACCEPTED|RETURNED(→RESPONDED), REQUESTED→OVERDUE→RESPONDED, REQUESTED→CANCELLED; `project_transfer` REQUESTED→APPROVED→APPLIED, REQUESTED→REJECTED|CANCELLED.

## 5. Quy tắc nghiệp vụ và công thức

- **BR-PRJ-01** Mã nội bộ `code` duy nhất theo tenant, không tái sử dụng sau CANCELLED/CLOSED. Mã giống nhau ở hai tenant là hợp lệ.
- **BR-PRJ-02** Mã TTQG `national_project_code` duy nhất trong tenant khi khác null; định dạng kiểm bằng regex lưu trong rule `NATIONAL_CODE_FORMAT` (dữ liệu, [CXN-01]); thiếu mã khi dự án có dòng vốn: rule `NATIONAL_CODE_REQUIRED` mode `BLOCK|WARN` có `legal_basis`, `effective_from/until` — mặc định BLOCK ở publish kế hoạch và khởi công.
- **BR-PRJ-03** Điểm thẩm định: `total_score = Σ(score_i × weight_i) / 5`, `score_i ∈ {0..5}` nguyên, `Σ weight_i = 100` (sai → `CRITERIA_WEIGHT_INVALID`); kết quả numeric(5,2), làm tròn half-up 2 chữ số; ví dụ trọng số 30/25/20/15/10, điểm 4/3/5/2/4 → 73.00. Nhiều phiếu: điểm dự án = trung bình cộng các phiếu SUBMITTED của vòng hiện tại (làm tròn 2 chữ số).
- **BR-PRJ-04** Ngưỡng khuyến nghị ADMIT ≥ 60.00 [GIẢ ĐỊNH, dữ liệu trong bộ tiêu chí `APPRAISAL_CRITERIA`]; dưới ngưỡng → REJECT; thiếu tiêu chí bắt buộc → RETURN. Người quyết định có thể khác khuyến nghị với `override_reason`.
- **BR-PRJ-05** Nhóm dự án gợi ý theo `PROJECT_GROUP_THRESHOLDS` (lĩnh vực × tổng mức, phiên bản hiệu lực tại ngày đề xuất) [CXN-32]; bắt buộc từ PIPELINE (CHECK `project_group_required_chk`). Nhóm quyết định hạn thẩm tra quyết toán (PAY, [CXN-09]) và cấp thẩm định.
- **BR-PRJ-06** Thứ hạng ngân hàng dự án `pipeline_priority`: sắp theo `appraisal_score` giảm dần, rồi số mốc sẵn sàng (GPMB, pháp lý) giảm dần, rồi ngày PIPELINE tăng dần.
- **BR-PRJ-07** Điểm rủi ro `score = likelihood × impact` (1–25, cột GENERATED); 1–5 LOW, 6–14 MEDIUM, ≥15 CRITICAL; CRITICAL hoặc quá `due_date` phát cảnh báo cho HOME-03.
- **BR-PRJ-08** WBS: Σ `planned_value_vnd` cấu phần cấp 1 > `total_investment_vnd` → cảnh báo `WBS_EXCEEDS_TOTAL` (không chặn, vì cấu phần có thể chứa dự phòng khác basis).
- **BR-PRJ-09** Mốc: DONE cần `actual_date`; trễ = `actual_date (hoặc hôm nay) − baseline_date` ngày lịch > 0 → DELAYED.
- **BR-PRJ-10** Một `LEADER_IN_CHARGE` ACTIVE mỗi dự án (unique partial); khoảng hiệu lực các phân công cùng vai trò không chồng lấn.
- **BR-PRJ-11** Hạn giải trình mặc định = ngày yêu cầu + 3 ngày làm việc theo lịch tenant (MDM-18) [GIẢ ĐỊNH, chờ [CXN-33]]; người kết luận ≠ người phản hồi (CHECK `explanation_sod_chk`).
- **BR-PRJ-12** Chuyển dự án chỉ trong tenant; `effective_date` ≥ ngày duyệt; báo cáo đã gửi không đổi đơn vị.
- **BR-PRJ-13** Tiền là `numeric(24,0)` VND nguyên; API chuỗi decimal. Không trường tiền nào thay đổi qua `updateProjectProfile`.

## 6. Dữ liệu

| Bảng | Trường chính (mới/sửa) | Ràng buộc/Index | Owner | Classification | Retention |
|---|---|---|---|---|---|
| `project` (sửa) | + `national_project_code`, `project_group`, `investor_unit_id`, `decision_authority_unit_id`, `sector/project_type/program_master_version_id`, `policy_decision_document_id`, `investment_decision_document_id`, `start_year`, `end_year`, `appraisal_score`, `pipeline_priority`, `status_changed_at`, audit cols; `status` mang giai đoạn PIMA; `classification` = phân loại dữ liệu | UNIQUE (tenant, code); UNIQUE partial (tenant, national_project_code); CHECK status/group/money/years/score; index mọi `*_id` | PRJ | INTERNAL (mặc định), CONFIDENTIAL cho dự án quốc phòng/an ninh | Vĩnh viễn theo hồ sơ dự án [CXN-05] |
| `project_revision` | before/after jsonb, `total_investment_vnd`, `decision_document_id`, `effective_from`, `supersedes_id` | UNIQUE (tenant, project, revision); APPROVED ⇒ có văn bản; decided_by ≠ created_by | PRJ | INTERNAL | Vĩnh viễn |
| `project_component`, `project_milestone` | WBS cây, mốc baseline/planned/actual, phụ thuộc | UNIQUE code/dự án; DONE ⇒ actual_date | PRJ | INTERNAL | Theo dự án |
| `project_appraisal` | `round`, `criteria_set_version_id`, `scores_json`, `total_score`, `recommendation`, `decision` | UNIQUE (project, round, appraiser); DECIDED ⇒ decision + decided_by | PRJ | INTERNAL | Vĩnh viễn |
| `project_risk` | likelihood/impact, `score` GENERATED, owner, mitigation, `linked_issue_id` | UNIQUE code/dự án; CLOSED/ACCEPTED ⇒ lý do | PRJ | INTERNAL | 10 năm sau CLOSED [GIẢ ĐỊNH] |
| `project_accountability` | leader, vai trò, văn bản, hiệu lực | unique partial 1 leader ACTIVE | PRJ | INTERNAL | Vĩnh viễn |
| `task_force`, `task_force_member` | phạm vi đơn vị, trưởng tổ, thành viên, dự án theo dõi | UNIQUE code; member active unique | PRJ | INTERNAL | 10 năm |
| `explanation_request` | subject PROJECT/UNIT, `warning_id`, `period_id`, câu hỏi, hạn, phản hồi, `is_late`, kết luận | CHECK subject; reviewer ≠ responder | PRJ | INTERNAL (có thể chứa đánh giá cá nhân → không đưa vào AI quốc tế) | 10 năm |
| `project_transfer` | from/to unit, scope, `effective_date`, văn bản | from ≠ to; một yêu cầu mở/scope | PRJ | INTERNAL | Vĩnh viễn |

FK composite `(tenant_id, x_id)`; mọi cột `*_id` có index `(tenant_id, col)`. Các cột `*_document_id` là tham chiếu logic tới sổ văn bản DOC (FK thêm khi bảng DOC ổn định — xem §13). `version` tăng mỗi command; ETag = `"<version>"`.

## 7. API / command

| operationId | Method path | x-permission | Request DTO | Lỗi chính | Idem | If-Match |
|---|---|---|---|---|---|---|
| `createProject` | POST /projects | project.create | `PrjProjectCreate` | 409 PROJECT_CODE_DUPLICATE, 422 MASTER_NOT_EFFECTIVE | ✔ | – |
| `updateProjectProfile` | POST /projects/{id}/profile | project.update | `PrjProfileChange` (không có code/status/tiền) | 400 FIELD_NOT_ALLOWED, 409 VERSION_CONFLICT, 422 STAGE_LOCKED_FIELD | ✔ | ✔ |
| `submitProjectForAppraisal` | POST /projects/{id}/appraisal-submissions | project.stage.submit | `PrjStageCommand` | 409 STAGE_TRANSITION_DENIED | ✔ | ✔ |
| `recordProjectAppraisal` | POST /projects/{id}/appraisals | project.appraise | `PrjAppraisalScore` | 403 SELF_APPROVAL_DENIED, 422 CRITERIA_WEIGHT_INVALID/SCORE_OUT_OF_RANGE | ✔ | – |
| `decideProjectAppraisal` | POST /project-appraisals/{id}/decision | project.appraisal.decide | `PrjAppraisalDecision` | 422 DECISION_REQUIRED/PROJECT_GROUP_REQUIRED/OVERRIDE_REASON_REQUIRED | ✔ | ✔ |
| `startProjectImplementation` | POST /projects/{id}/implementation-start | project.stage.implement | `PrjStageCommand` | 422 NATIONAL_CODE_REQUIRED, 409 STAGE_TRANSITION_DENIED | ✔ | ✔ |
| `suspendProject` / `resumeProject` | POST /projects/{id}/suspension, /resumption | project.stage.suspend | `PrjStageCommand` | 409 STAGE_TRANSITION_DENIED | ✔ | ✔ |
| `completeProject` / `closeProject` / `cancelProject` | POST /projects/{id}/completion, /closure, /cancellation | project.stage.complete/close/cancel | `PrjStageCommand` | 409 OPEN_OBLIGATIONS_EXIST, STAGE_TRANSITION_DENIED | ✔ | ✔ |
| `assignNationalProjectCode` | POST /projects/{id}/national-code | project.national_code.manage | `PrjNationalCode` | 409 NATIONAL_CODE_DUPLICATE, 422 NATIONAL_CODE_FORMAT_INVALID | ✔ | ✔ |
| `importNationalProjectCodes` | POST /project-national-code-imports | project.national_code.manage | `PrjImportRequest` | 409 IMPORT_FILE_ALREADY_APPLIED, 422 IMPORT_HAS_ERRORS | ✔ | – |
| `proposeProjectRevision` / `decideProjectRevision` | POST /projects/{id}/revisions; /project-revisions/{id}/decision | project.revision.propose/approve | `PrjRevisionProposal` / `PrjRevisionDecision` | 409 REVISION_PENDING_EXISTS; 403 SELF_APPROVAL_DENIED; 422 DECISION_REQUIRED | ✔ | ✔ |
| `requestProjectTransfer` / `decideProjectTransfer` | POST /projects/{id}/transfers; /project-transfers/{id}/decision | project.transfer.request/approve | `PrjTransferRequest` / `MdmDecision` | 404 (unit ngoài tenant), 409 TRANSFER_PENDING_EXISTS, 403 SELF_APPROVAL_DENIED | ✔ | ✔ |
| `addProjectComponent`, `addProjectMilestone`, `recordMilestoneProgress` | POST /projects/{id}/components, /milestones; /project-milestones/{id}/progress | project.update | `PrjComponentInput`, `PrjMilestoneInput`, `PrjMilestoneActual` | 409 *_CODE_DUPLICATE, DEPENDENCY_CYCLE | ✔ | ✔ (progress) |
| `registerProjectRisk`, `updateProjectRisk`, `closeProjectRisk` | POST /projects/{id}/risks; /project-risks/{id}/update, /closure | project.risk.manage | `PrjRiskEntry`, `PrjRiskClosure` | 409 RISK_CODE_DUPLICATE/VERSION_CONFLICT | ✔ | ✔ |
| `assignProjectLeader`, `endProjectLeaderAssignment` | POST /projects/{id}/accountability-assignments; /accountability-assignments/{id}/end | project.accountability.assign | `PrjLeaderAssignment`, `PrjAssignmentEnd` | 409 LEADER_ALREADY_ASSIGNED, 422 LEADER_NOT_ELIGIBLE | ✔ | ✔ (end) |
| `createTaskForce`, `addTaskForceMember`, `dissolveTaskForce` | POST /task-forces; /task-forces/{id}/members, /dissolution | taskforce.manage | `PrjTaskForceCreate`, `PrjTaskForceMember` | 422 MEMBER_OUT_OF_SCOPE, 409 TASK_FORCE_DISSOLVED | ✔ | ✔ (dissolve) |
| `requestExplanation`, `submitExplanation`, `reviewExplanation` | POST /explanation-requests; /{id}/response; /{id}/decision | explanation.request/respond/review | `PrjExplanationRequest/Response/Review` | 409 EXPLANATION_ALREADY_OPEN/SUBMITTED; 403 SELF_APPROVAL_DENIED | ✔ | ✔ |
| `getProjectLifecycle`, `listProjectPipeline`, `listProjectRisks`, `listExplanationRequests` | GET | project.read / explanation.read | – | 404 ngoài scope | – | – |

**Rà soát GET scaffold:** `GET /resources/project`, `/resources/project/{id}` → `x-exposure: dto` (DTO allowlist, lọc cây đơn vị; lịch sử qua `getProjectLifecycle`). Không có endpoint ghi chung; `status`, `tenant_id`, `code`, `total_investment_vnd`, `national_project_code` chỉ đổi bằng command tương ứng.

## 8. UI/UX

Màn hình giữ ID: PRJ-01…PRJ-13. Field thêm (nguồn FR): PRJ-01 + "Mã dự án TTQG", "Giai đoạn PIMA", "Lãnh đạo phụ trách" (FR-PRJ-21/14/17); PRJ-02 + "Nhóm dự án (QTQG/A/B/C)", "Mã dự án TTQG", "Cấp quyết định đầu tư", "Năm bắt đầu–kết thúc" (FR-PRJ-02); PRJ-10 + "Điểm thẩm định", "Khuyến nghị" (FR-PRJ-15).

Màn hình mới (style mockup D-B11, component families tài liệu 06): **PRJ-14** ngân hàng dự án dạng `board` (cột = giai đoạn, thẻ = MetricTile thu gọn, kéo-thả bị vô hiệu — chuyển giai đoạn qua nút command có hộp xác nhận nêu guard còn thiếu); **PRJ-15** chấm điểm (`criteria`: bảng tiêu chí × điểm 0–5 bằng segmented control, EvidenceViewer, tổng điểm cập nhật tức thì nhưng giá trị chuẩn do server trả); **PRJ-16** sổ rủi ro (DataTable + ma trận 5×5 heatmap, không chỉ dùng màu — có số điểm); **PRJ-17** phân công lãnh đạo; **PRJ-18** tổ công tác; **PRJ-19** giải trình (ComparePanel câu hỏi/phản hồi, đồng hồ hạn, nhãn "Quá hạn" kèm ngày hạn gốc); **PRJ-20** chuyển dự án (form + preview tác động: số báo cáo, kế hoạch vốn, người dùng mất/được scope); **PRJ-21** đối chiếu mã TTQG (`reconcile`: tệp → dry-run → lỗi theo dòng → áp dụng).

Trạng thái riêng: "Thiếu mã TTQG" (badge cảnh báo trên PRJ-01/14), "Đang chờ quyết định" (revision/transfer pending), "Giải trình quá hạn". Quyền: nút command ẩn khi thiếu quyền, disabled kèm tooltip khi guard chưa đạt. Mobile: MOB-09/10 hiển thị giai đoạn, mã TTQG, lãnh đạo phụ trách (đọc); phản hồi giải trình trên mobile đề xuất cho MOB (§13).

## 9. Sự kiện, job, tích hợp, quan sát

Domain events (outbox, `payload_version = 1`, payload tối thiểu `tenant_id, project_id, version, actor_id, occurred_at` + trường riêng): `project.created.v1`, `project.profile_changed.v1`, `project.stage_changed.v1 {from, to, decision_document_id}`, `project.appraisal_recorded.v1`, `project.revised.v1`, `project.national_code_assigned.v1`, `project.transferred.v1 {from_unit_id, to_unit_id, effective_date}`, `project.risk_registered.v1 {score, severity}`, `project.risk_updated.v1`, `project.leader_assigned.v1`, `project.leader_unassigned.v1`, `project.milestone_updated.v1`, `taskforce.created.v1`, `taskforce.dissolved.v1`, `explanation.requested.v1`, `explanation.responded.v1`, `explanation.reviewed.v1`.

Consumer (idempotent theo `integration_event_inbox`/`event_id`): `capital.plan_published.v1` → PIPELINE→BUDGETED; `settlement.closed.v1` (PAY) → COMPLETED→SETTLED; `warning.opened.v1` với rule `auto_explanation` (DIS) → tạo `explanation_request`. Job: `prj.explanation-overdue` (mỗi giờ, Temporal timer per request), `prj.risk-due` (hằng ngày), `prj.transfer-apply` (áp dụng chuyển có `effective_date` tương lai lúc 00:05 giờ VN). Cache: `t:{tenant}:prj:pipeline:{stage}` TTL 60 s, vô hiệu khi `project.stage_changed`. Telemetry: `prj_stage_transition_total{to}`, `prj_explanation_overdue_gauge`, `prj_national_code_missing_gauge`; log không chứa tên người/nội dung giải trình.

## 10. Kiểm thử

| ID | Loại | Ưu tiên | Setup | Input/Bước | Expected | Bằng chứng |
|---|---|---|---|---|---|---|
| UAT-AC200 | domain/security | P0 | mã DA-2026-001 tồn tại ở TNT-A | tạo mã mới, mã trùng, trùng ở TNT-B | CONCEPT; 409; TNT-B hợp lệ | API log + DB |
| UAT-AC201 | security | P0 | version=4 | If-Match cũ; body có status/tenant_id | 409; 400 FIELD_NOT_ALLOWED | API log |
| UAT-AC202 | E2E | P0 | P-A-010 CONCEPT | submit → chấm 72.50 → ADMIT | PIPELINE, group B, 2 event | outbox |
| UAT-AC203 | security | P0 | người đề xuất chấm | tự chấm; quyết định trái khuyến nghị | 403; 422 OVERRIDE_REASON_REQUIRED | audit |
| UAT-AC204 | domain | P0 | trọng số 30/25/20/15/10 | điểm 4,3,5,2,4 | 73.00; lỗi trọng số/điểm | unit test |
| UAT-AC205 | domain (negative) | P0 | CONCEPT | implementation-start, closure | 409 STAGE_TRANSITION_DENIED | API log |
| UAT-AC206 | integration | P0 | BUDGETED không mã | khởi công trước/sau gán mã; rule WARN | 422 / 200 / 200+warning | rule version |
| UAT-AC207 | integration (idempotency) | P0 | tệp mã 3 dòng | dry-run, apply, apply lại | lỗi dòng; 409 IMPORT_FILE_ALREADY_APPLIED | batch record |
| UAT-AC208 | domain | P1 | APPRAISAL | ADMIT không/sai/đúng nhóm | 422/422/200 | DB CHECK |
| UAT-AC209 | business | P1 | IMPLEMENTATION | rủi ro 4×5 | score 20 CRITICAL, HOME-03 | UI screenshot |
| UAT-AC210 | concurrency/domain | P0 | leader ACTIVE | phân công thứ hai | 409 LEADER_ALREADY_ASSIGNED | DB unique |
| UAT-AC211 | security | P1 | tổ TF-01 | thêm ngoài scope / tenant khác; giải thể | 422 / 404 / members ended | audit |
| UAT-AC212 | business | P0 | EW-01 OPEN | yêu cầu → quá hạn → phản hồi → kết luận | OVERDUE, is_late, 403 tự kết luận, RESOLVED | event log |
| UAT-AC213 | business/security | P0 | P-A-003 | chuyển, tự duyệt, unit TNT-B | 403; APPLIED; 404 | DIS-12 so sánh |
| UAT-AC214 | business | P1 | revision 1 | điều chỉnh tổng mức | 422 thiếu QĐ; r2 APPROVED | PRJ-06 |
| UAT-AC215 | domain | P1 | committed 500 triệu | hủy dự án | 409 OPEN_OBLIGATIONS_EXIST | API log |
| UAT-AC216 | integration (idempotency) | P1 | COMPLETED | closure sớm; event lặp | 409; SETTLED 1 lần | inbox |
| UAT-AC217 | security (cách ly tenant) | P0 | B-maker | GET/POST dự án TNT-A | 404 | RLS log |
| UAT-AC218 | business | P1 | WBS 40/45 tỷ | thêm 8 tỷ; mốc trễ | warning; DELAYED; 422 | UI |
| UAT-AC219 | integration | P1 | PIPELINE có dòng vốn | publish kế hoạch | BUDGETED (system) | outbox |
| UI-PRJ-14…UI-PRJ-21 | screen-contract | theo phase | dữ liệu synthetic | 7 trạng thái, quyền | đúng field/rule | screenshot |

## 11. Tiêu chí nghiệm thu

- **AC-PRJ-01** Given mã nội bộ đã tồn tại trong tenant, When tạo dự án cùng mã, Then 409 `PROJECT_CODE_DUPLICATE` và không tạo bản ghi; mã trùng ở tenant khác vẫn tạo được. → UAT-AC200
- **AC-PRJ-02** Given profile có version 4, When gửi If-Match cũ hoặc trường ngoài allowlist, Then 409/400 và dữ liệu không đổi. → UAT-AC201
- **AC-PRJ-03** Given dự án CONCEPT, When đi đủ thẩm định với tổng điểm 72.50 và quyết định ADMIT có văn bản + nhóm, Then trạng thái PIPELINE và phát 2 sự kiện stage_changed. → UAT-AC202, UAT-AC204
- **AC-PRJ-04** Given người đề xuất, When tự chấm hoặc tự quyết định, Then 403 `SELF_APPROVAL_DENIED`. → UAT-AC203
- **AC-PRJ-05** Given chuyển không có trong bảng, When gọi command, Then 409 `STAGE_TRANSITION_DENIED`. → UAT-AC205, UAT-AC216
- **AC-PRJ-06** Given rule mã TTQG BLOCK và dự án thiếu mã, When khởi công, Then 422 `NATIONAL_CODE_REQUIRED`; nạp lại cùng tệp mã → 409. → UAT-AC206, UAT-AC207
- **AC-PRJ-07** Given một lãnh đạo phụ trách đang ACTIVE, When phân công người thứ hai, Then 409 cho tới khi phân công cũ kết thúc. → UAT-AC210
- **AC-PRJ-08** Given yêu cầu giải trình quá hạn, When người được yêu cầu phản hồi và lãnh đạo kết luận, Then `is_late=true`, cảnh báo liên kết RESOLVED, người phản hồi không tự kết luận được. → UAT-AC212
- **AC-PRJ-09** Given chuyển dự án được duyệt hiệu lực 01/10, Then báo cáo trước 01/10 tính cho đơn vị cũ, sau đó cho đơn vị mới; đơn vị tenant khác → 404. → UAT-AC213
- **AC-PRJ-10** Given người dùng tenant B, When đọc/ghi dự án tenant A, Then 404 ở mọi đường. → UAT-AC217

## 12. Mức tối thiểu cho R1 và phần sâu hóa R2+

**R1 (dùng thật):** F1, F2 (một vòng thẩm định, một người quyết định), F3/F4/F5 (đủ bảng transition), F7 gán tay + nhập tệp, F9 phân công lãnh đạo + giải trình (tổ công tác đơn giản), F10, PRJ-01..04, 09, 10, 13, 14, 15, 17, 18, 19, 20, 21; migration trạng thái cũ.
**R2:** điều chỉnh dự án đầy đủ (PRJ-06), WBS/mốc (PRJ-05/07), sổ rủi ro (PRJ-16) + liên kết ISS, ưu tiên ngân hàng dự án nhiều tiêu chí, bàn giao/quyết toán UI (PRJ-11/12 phối hợp AST/PAY), mobile phản hồi giải trình.
**R3:** đồng bộ mã TTQG khi có hợp đồng tích hợp (D05) — vẫn qua adapter, không bịa API.
**Giờ review người (R2/D5):** quyền và maker-checker (4 h), bảng transition + migration trạng thái (4 h), quy tắc pháp lý mã TTQG/nhóm dự án [CXN-01]/[CXN-32] (3 h, Chủ nghiệp vụ vốn), giải trình CĐ 162 [CXN-33] (2 h). Tổng ≈ 13 h.

## 13. Rủi ro, câu hỏi mở, phụ thuộc bên thứ ba

| Mục | Owner (vai trò) | Điều kiện giải quyết |
|---|---|---|
| [CXN-01] Quy tắc chặn khi thiếu mã TTQG và định dạng mã | Chủ nghiệp vụ vốn | Văn bản gốc; cập nhật rule `NATIONAL_CODE_REQUIRED/FORMAT` (dữ liệu) |
| [CXN-32] Ngưỡng nhóm QTQG/A/B/C theo lĩnh vực (Luật 58/2024 sửa 90/2025) — đề xuất thêm vào sổ xác nhận | Pháp chế | Bảng ngưỡng ký duyệt → seed `PROJECT_GROUP_THRESHOLDS` |
| [CXN-33] Nội dung Công điện 162/CĐ-TTg: phân công lãnh đạo, tổ công tác, kế hoạch tuần, hạn giải trình — đề xuất thêm vào sổ | Chủ nghiệp vụ vốn | Văn bản gốc; chốt hạn giải trình và mẫu báo cáo tổ công tác |
| Ngưỡng ADMIT 60 điểm và bộ tiêu chí thẩm định [GIẢ ĐỊNH] | Sở Tài chính | Ban hành bộ tiêu chí MDM `APPRAISAL_CRITERIA` |
| Bảng sổ văn bản DOC chưa ổn định → `*_document_id` chưa có FK | DOC owner | Thêm FK composite khi bảng DOC chốt |
| Cột `organization_unit` lịch sử khi chuyển dự án | IAM owner | IAM cung cấp `valid_from/until` + successor (đã có) |
| Không có API Hệ thống TTQG về ĐTC | Integration Lead (D05) | Giữ import tệp, adapter PROPOSED |

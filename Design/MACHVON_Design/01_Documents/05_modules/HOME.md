# HOME — Tổng quan điều hành và trung tâm điều hành giải ngân

Phiên bản đặc tả M1 · 22/10/2026 · HOME **không sở hữu bảng ghi**; mọi số đọc từ PeriodSnapshot FROZEN của DIS (`period_snapshot`, `period_snapshot_line`, `disbursement_ranking`, `early_warning`), CAP (`appropriation`, `allocation_balance`, `reallocation_proposal`), PRJ (`project`, `project_accountability`, `explanation_request`) và ISS. Quy ước chung theo `04_Thiet_ke_co_ban.md`, `05_Thiet_ke_chi_tiet.md` (DrillContext và query security).

## 1. Mục đích, phạm vi, ranh giới

**Vấn đề.** Lãnh đạo UBND/Sở cần một màn hình trả lời trong 30 giây: giải ngân đang ở đâu so với hai mẫu số, đơn vị nào chậm, dự án nào có cảnh báo, ai chịu trách nhiệm, giải trình nào quá hạn, có đề xuất điều chuyển nào chờ — và bấm vào bất kỳ số nào để thấy công thức, phạm vi, thời điểm chốt và bản ghi nguồn mà không mất ngữ cảnh. Đây là "trung tâm điều hành giải ngân" theo Công điện 162/CĐ-TTg [CXN-33] (theo dõi kế hoạch tuần/tháng từng dự án, cảnh báo sớm, xếp hạng, điều chuyển).

**Trong phạm vi:** HOME-01…HOME-10: tổng quan, việc của tôi, cảnh báo sớm, xếp hạng, bản đồ, hồ sơ cảnh báo, cơ cấu nguồn, chi tiết nguồn và phạm vi tính, **HOME-09** trung tâm điều hành, **HOME-10** ngữ cảnh số liệu/truy nguồn; read-model và drill có kiểm quyền lại ở đích.
**Ngoài phạm vi:** tính số liệu (DIS snapshot); quy tắc cảnh báo (DIS); dashboard tự dựng, semantic layer, export lịch (BI); chất lượng/lineage dữ liệu (DGV).

**Giải quyết xung đột HOME↔DGV (O11, CR-HOME-01).** Baseline ghi HOME phụ thuộc "DIS, DGV" nhưng DGV nằm ở G3 trong khi HOME ở G2. Quyết định (Claude quyết, D-B04): phụ thuộc **cứng** của HOME = DIS (PeriodSnapshot + ranking + warning), CAP, PRJ, ISS — đều R1. DGV là phụ thuộc **mềm** từ R2: HOME hiển thị `quality_badge = NOT_ASSESSED` ("Chưa đánh giá chất lượng") và độ mới lấy từ `as_of` của snapshot cho tới khi DGV có `quality_run`; khi DGV sẵn sàng, badge đọc kết quả quality run của dataset snapshot. HOME giữ phase P0/R1. Không có tính năng nào của HOME bị chặn vì thiếu DGV.

**Căn cứ:** CĐ 162/CĐ-TTg [CXN-33]; CV 16437/BTC-ĐTPT [CXN-03]; nguyên tắc BR-R06/BR-R10 của BRD (không công bố số không rõ grain/định nghĩa/nguồn/độ mới; drill giữ scope và snapshot). Thị trường: Power BI RLS, dbt/Cube metric layer (công thức là dữ liệu, tử/mẫu số trả riêng).

## 2. Actor, tenant và phạm vi quyền

| Actor | Scope | Được phép | Bị cấm |
|---|---|---|---|
| Lãnh đạo UBND tỉnh/bộ | Toàn tenant hoặc theo cây đơn vị được cấp | Mọi màn HOME, drill tới giao dịch Kho bạc/chứng từ nếu có quyền đích | Sửa số; xem dữ liệu ngoài scope qua drill |
| Lãnh đạo Sở/Ban | Đơn vị mình + con | HOME-01..10 trong scope | Như trên |
| Chuyên viên | Scope được giao | HOME-01..08, HOME-10 | HOME-09 tile điều chuyển nếu thiếu `capital.read` |
| Chủ đầu tư | Dự án mình | HOME-01/02/03/06 theo dự án | Xếp hạng đơn vị khác (hiện vị trí của mình + tổng nhóm, không lộ tên đơn vị khác nếu policy `ranking_visibility = OWN_ONLY`) |
| Auditor | Đọc | Như lãnh đạo trong scope audit | Command |

HOME chỉ có thao tác ghi gián tiếp qua command của module nguồn (ví dụ nút "Yêu cầu giải trình" gọi `requestExplanation` của PRJ, "Ghi nhận" gọi `acknowledgeEarlyWarning` của DIS) — quyền kiểm theo command đó.

## 3. Luồng nghiệp vụ

**F1 — Mở trung tâm điều hành (HOME-09).** (1) Client gọi `getCommandCenter?snapshot_id=` (mặc định snapshot FROZEN mới nhất loại PERIOD_CLOSE của kỳ tuần gần nhất mà user có quyền). (2) Server: xác thực membership → tính scope hash → đọc snapshot lines trong scope → trả tiles (hai tỷ lệ, đã giải ngân, kế hoạch hai mẫu số, EAC, số cảnh báo mở theo mức độ, giải trình quá hạn, đề xuất điều chuyển chờ duyệt) mỗi tile kèm `formula`, `numerator`, `denominator`, `null_reason`, `definition_status`, `context_token` ký (HMAC, chứa tenant, scope hash, snapshot, metric, filters, TTL 30 phút). (3) UI hiển thị "Số liệu tại [as_of], Kho bạc tới [cutoff], snapshot [id rút gọn]" cố định ở header.
Nhánh: chưa có snapshot FROZEN → trạng thái Empty "Chưa chốt số liệu kỳ nào" + link DIS-21 (nếu có quyền); snapshot cũ hơn 8 ngày → trạng thái Stale.

**F2 — Drill truy nguồn (HOME-10).** Bấm tile → `explainHomeMetric?context_token=…&child_dimension=unit` → trả children (đơn vị) với tử/mẫu, `reconciles_to_parent` (Σ con = cha) hoặc `non_additive_reason` (tỷ lệ, distinct). Tiếp tục drill: đơn vị → dự án → ô nguồn (`period_snapshot_line`) → report revision (DIS-07) → giao dịch Kho bạc (PAY) → chứng từ (DOC/document_version). Mỗi bước: server xác minh chữ ký token, tenant, membership **hiện tại** và giao scope cũ ∩ scope hiện tại (quyền bị thu hồi có hiệu lực ngay → 403 `SCOPE_DENIED`), giữ nguyên snapshot (không nhảy số mới). Token hết hạn → 409 `SNAPSHOT_EXPIRED` (UI làm mới token cùng snapshot).

**F3 — Xếp hạng (HOME-04).** `getDisbursementRankings?snapshot_id&comparison_group&denominator_kind` đọc `disbursement_ranking`; UI cho đổi mẫu số (hai bảng riêng, không trộn) và hiển thị đơn vị bị loại kèm lý do.

**F4 — Cảnh báo (HOME-03/06).** `getHomeWarnings` lọc theo mức độ/quy tắc; HOME-06 hiển thị nguyên nhân (giá trị quan sát vs ngưỡng), bằng chứng (dòng snapshot), người phụ trách (lãnh đạo phụ trách hiện hành từ PRJ), giải trình liên kết, lịch sử; nút "Yêu cầu giải trình" (PRJ) và "Ghi nhận/Bỏ qua" (DIS).

**F5 — Việc của tôi (HOME-02).** `getMyWork` gộp: giải trình được yêu cầu/đang chờ kết luận (PRJ), báo cáo trả lại/nháp quá hạn (DIS), phê duyệt chờ (CAP/DIS/MDM/MNE qua `approval_task` của ADM), nghĩa vụ MNE sắp hạn. Thứ tự: quá hạn → hạn gần → ưu tiên.

**F6 — Cơ cấu nguồn (HOME-07/08).** Đọc appropriation PUBLISHED theo năm: thẻ vốn TTg giao, vốn địa phương giao thêm, vốn kéo dài, vốn hỗ trợ, vốn tăng thu NSTW, ODA; CTMTQG hiển thị "trong đó" của nguồn cha (không cộng); HOME-08 cột "Quan hệ bao hàm" và "Thời điểm chốt".

Đồng thời: HOME chỉ đọc; snapshot mới FROZEN trong khi user đang xem → banner "Có số liệu mới (snapshot …) — Làm mới", không tự đổi số.

## 4. State machine

HOME không có đối tượng nghiệp vụ có trạng thái. Trạng thái màn hình (từ hợp đồng Module_Implementation_Contracts):

```
 Loading ──ok──► Ready ──(snapshot mới FROZEN)──► Ready+NewDataBanner ──refresh──► Loading
    │  └─empty──► Empty (chưa có snapshot / không có dữ liệu trong scope)
    │  └─stale──► Stale (as_of quá ngưỡng 8 ngày)
    ├─403──► Denied (scope bị thu hồi; không lộ tên hồ sơ)
    └─5xx/timeout──► Error (retry; giữ bộ lọc)
```

| Từ | Sự kiện | Đến | Guard | Ghi nhận |
|---|---|---|---|---|
| Loading | 200 có tiles | Ready | snapshot FROZEN, scope hợp lệ | telemetry `home_load_ms` |
| Loading | 200 không snapshot | Empty | – | – |
| Ready | `snapshot.frozen` (SSE/poll) | Ready+NewDataBanner | snapshot mới cùng kind, khác id | – |
| Ready | drill 403 | Denied (drawer) | membership hiện tại không giao scope | audit `home.drill_denied` |
| Ready | token hết hạn | Ready (token mới cùng snapshot) | snapshot chưa bị xóa | – |

Bị cấm: hiển thị số không có `as_of`; tự đổi sang snapshot khác khi drill; hiển thị 0 khi `null_reason` khác null.

## 5. Quy tắc nghiệp vụ và công thức

- **BR-HOME-01** Mọi tile mang: scope (đơn vị/dự án/nguồn), `as_of_date`, `treasury_cutoff_date`, `snapshot_id`, đơn vị tính (VND, hiển thị triệu/tỷ có ghi rõ), công thức, `definition_status`. Thiếu bất kỳ → không hiển thị số (METRIC_UNAVAILABLE).
- **BR-HOME-02** Tỷ lệ luôn hiển thị theo cặp DIS BR-DIS-05 (KH TTg giao / KH gồm giao thêm) với cùng tử số; tooltip nêu [CXN-03].
- **BR-HOME-03** Tổng cha = Σ con cho đại lượng cộng được (tiền), kiểm ở server (`reconciles_to_parent`); với tỷ lệ trả tử/mẫu và `non_additive_reason = RATIO`.
- **BR-HOME-04** Unknown ≠ zero: `NO_DATA`, `ZERO_DENOMINATOR`, `TREASURY_COVERAGE_NONE` hiển thị nhãn chữ, không màu đơn thuần; đếm số dự án chưa có dữ liệu ở footer.
- **BR-HOME-05** Tile "Giải trình quá hạn" = số `explanation_request` OVERDUE + RESPONDED quá hạn chưa kết luận trong scope; "Đề xuất điều chuyển chờ" = `reallocation_proposal` SUBMITTED/APPROVED chưa APPLIED.
- **BR-HOME-06** Xếp hạng chỉ từ `disbursement_ranking` của snapshot đang xem; policy `ranking_visibility` (ALL | OWN_ONLY) theo tenant.
- **BR-HOME-07** Bản đồ (HOME-05): vị trí dự án từ địa bàn master version hiệu lực tại as_of (sau cải cách 2025 hiển thị cấp tỉnh–xã) [CXN-34]; dự án không có tọa độ liệt kê riêng, không đặt tại tâm tỉnh.
- **BR-HOME-08** Drill token: HMAC-SHA256 với khóa per-tenant; payload không chứa PII; TTL 30 phút; mỗi lần dùng kiểm lại membership.

## 6. Dữ liệu

HOME không tạo bảng. Read-model (view `security_invoker`, RLS áp dụng):

| Read-model | Nguồn | Grain | Ghi chú |
|---|---|---|---|
| `v_home_tiles` | `period_snapshot_line` ⨝ `period_snapshot` | snapshot × scope | tổng hợp theo cây đơn vị tại as_of (đơn vị lịch sử từ snapshot line, không từ cơ cấu hiện tại) |
| `v_home_rankings` | `disbursement_ranking` | snapshot × group × denominator × unit | – |
| `v_home_warnings` | `early_warning` ⨝ `early_warning_rule` ⨝ `project_accountability` | warning | người phụ trách = LEADER_IN_CHARGE ACTIVE tại thời điểm xem |
| `v_home_my_work` | `explanation_request`, `report_revision`, `approval_task`, `mne_report` | việc | lọc theo user |
| `v_home_funding_structure` | `appropriation` PUBLISHED | năm × origin × nguồn | CTMTQG subset |

Classification: INTERNAL; tile có thể chứa số liệu CONFIDENTIAL nếu dự án CONFIDENTIAL — lọc ở view theo classification grant. Không cache dữ liệu theo user ở client ngoài phiên.

## 7. API / command

| operationId | Method path | x-permission | Request | Response | Lỗi |
|---|---|---|---|---|---|
| `getCommandCenter` | GET /home/command-center | home.read | `snapshot_id?`, `unit_id?`, `denominator_kind?` | `HomeCommandCenter` | 403 SCOPE_DENIED, 404, 422 METRIC_UNAVAILABLE |
| `getDisbursementRankings` | GET /home/rankings | home.read | `snapshot_id`, `comparison_group`, `denominator_kind` | danh sách xếp hạng | 404 |
| `getHomeWarnings` | GET /home/warnings | home.read | `snapshot_id`, `severity`, cursor | danh sách | – |
| `explainHomeMetric` | GET /home/drill | home.read (+ quyền đọc của đích) | `context_token`, `child_dimension`, cursor | `HomeDrillExplanation` | 403 SCOPE_DENIED, 409 SNAPSHOT_EXPIRED, 400 INVALID_REQUEST (token sai chữ ký/tenant) |
| `getMyWork` | GET /home/my-work | home.read | cursor | danh sách việc | – |

Không có command ghi riêng của HOME (Idempotency/If-Match không áp dụng); các nút hành động gọi command của PRJ/DIS/CAP. Không có GET scaffold riêng của HOME.

## 8. UI/UX

Giữ HOME-01…HOME-08. Field thêm: HOME-01 + "Thời điểm số liệu (as_of)", "Công thức" (FR-HOME-10); HOME-04 + "Snapshot", "Lý do loại khỏi xếp hạng" (FR-DIS-21); HOME-07 + "Vốn ODA", "Vốn địa phương giao thêm" (FR-CAP-16).
Mới: **HOME-09** (dashboard theo mockup HOME-01: hàng MetricTile cặp hai tỷ lệ, cột phải "Cảnh báo mở" + "Giải trình quá hạn", bảng xếp hạng thu gọn top/bottom 5, thẻ "Đề xuất điều chuyển chờ", header ngữ cảnh as_of/snapshot cố định); **HOME-10** (DrillDrawer: breadcrumb, tử/mẫu, công thức, loại trừ, bảng con, footer đối soát "Σ con = cha ✔" hoặc lý do không cộng, link nguồn).
Component: AppShell, MetricTile, DrillDrawer, DataTable, FilterBar, QualityBadge (NOT_ASSESSED tới R2). Bảy trạng thái + NewDataBanner. Không dùng chỉ màu: mỗi mức cảnh báo có chữ + icon. Mobile: MOB-07 (trang chủ lãnh đạo) dùng cùng `getCommandCenter` (tiles rút gọn, cùng as_of) — đề nghị MOB owner hiển thị hai tỷ lệ (§13).

## 9. Sự kiện, job, tích hợp, quan sát

Consumer: `snapshot.frozen.v1` → làm mới cache `t:{tenant}:home:cc:{snapshot}:{scope_hash}` (TTL 10 phút) và đẩy SSE "dữ liệu mới"; `warning.opened/resolved.v1`, `explanation.*` → vô hiệu cache tile cảnh báo. Không có job riêng. Telemetry: `home_load_ms` p95 ≤ 2 s với 5.000 dự án [GIẢ ĐỊNH, D09], `home_drill_denied_total`, `home_null_tile_total{reason}`; audit đọc nhạy cảm (drill tới chứng từ) theo chính sách audit đọc của tenant.

## 10. Kiểm thử

| ID | Loại | Ưu tiên | Setup | Bước | Expected | Bằng chứng |
|---|---|---|---|---|---|---|
| UAT-AC266 | E2E | P0 | S-40 FROZEN | mở HOME-09, drill 4 cấp | as_of/snapshot/công thức mỗi bước; tổng khớp | video |
| UAT-AC267 | security | P0 | thu hồi scope U-BQL2 | drill U-BQL2 | 403 SCOPE_DENIED, không lộ tên | API log |
| UAT-AC268 | business | P0 | dự án không dữ liệu | xem HOME-01/08 | "Chưa có dữ liệu" | screenshot |
| UAT-AC269 | business | P1 | CTMTQG 40 tỷ ⊂ NSTW | HOME-07/08 | không cộng | screenshot |
| UAT-AC270 | business | P1 | không DGV | HOME-01/09 | NOT_ASSESSED, không lỗi | screenshot |
| UAT-AC271 | business | P1 | EW-01 có giải trình | HOME-06 | đủ nguyên nhân/bằng chứng/người | screenshot |
| UAT-AC272 | business | P1 | 3 giải trình | HOME-02 | 3 việc, 1 quá hạn | screenshot |
| UAT-AC04 | domain | P0 | mẫu số 0 | HOME-04 | loại khỏi xếp hạng, lý do | API |
| UAT-AC06 | business | P0 | điều chỉnh chưa accept | HOME-01 | số chưa đổi | snapshot |
| UAT-AC242, UAT-AC254 | domain | P0 | FX-DIS-003/007 | xếp hạng/tỷ lệ | 14%; thứ tự | API |
| UAT-AC265 | security | P0 | token tenant A | B dùng token | 404/400 | log |
| UI-HOME-09, UI-HOME-10 | screen-contract | P0 | synthetic | 7 trạng thái + banner | đúng field/rule | screenshot |

## 11. Tiêu chí nghiệm thu

- **AC-HOME-01** Given snapshot FROZEN, When mở HOME-09, Then mọi tile có scope, as_of, snapshot, công thức; hai tỷ lệ cạnh nhau. → UAT-AC266
- **AC-HOME-02** Given drill nhiều cấp, Then mỗi cấp giữ snapshot và Σ con = cha cho tiền. → UAT-AC266
- **AC-HOME-03** Given scope bị thu hồi sau khi mở trang, When drill, Then 403 `SCOPE_DENIED` không lộ tên hồ sơ. → UAT-AC267
- **AC-HOME-04** Given thiếu dữ liệu hoặc mẫu số 0, Then hiện nhãn chữ, không 0%. → UAT-AC268, UAT-AC04
- **AC-HOME-05** Given DGV chưa triển khai, Then HOME hoạt động với badge NOT_ASSESSED. → UAT-AC270
- **AC-HOME-06** Given báo cáo điều chỉnh chưa được chấp nhận, Then HOME không đổi số. → UAT-AC06
- **AC-HOME-07** Cảnh báo/giải trình/việc của tôi hiển thị đúng người phụ trách và hạn. → UAT-AC271, UAT-AC272

## 12. Mức tối thiểu cho R1 và phần sâu hóa R2+

**R1:** HOME-01..04, 06..10 trên snapshot DIS; drill tới report revision và giao dịch Kho bạc; việc của tôi gồm giải trình + báo cáo + phê duyệt; xung đột DGV xử lý bằng NOT_ASSESSED.
**R2:** HOME-05 bản đồ GIS đầy đủ, badge chất lượng từ DGV, so sánh nhiều snapshot (xu hướng tuần), SSE thời gian thực, cá nhân hóa tile.
**Giờ review người:** quyền drill và rò rỉ scope 3 h; trình bày hai tỷ lệ/định nghĩa với Chủ nghiệp vụ vốn 2 h; UX lãnh đạo (test 5 người) 3 h. Tổng ≈ 8 h.

## 13. Rủi ro, câu hỏi mở, phụ thuộc bên thứ ba

| Mục | Owner | Điều kiện giải quyết |
|---|---|---|
| CR-HOME-01: đổi phụ thuộc HOME từ "DIS,DGV" sang "DIS,CAP,PRJ,ISS (DGV mềm R2)" | PO | Ghi CR vào Decision_Register |
| Chính sách hiển thị xếp hạng (ALL vs OWN_ONLY) | Lãnh đạo tenant | Cấu hình tenant |
| Ngưỡng stale 8 ngày, p95 2 s [GIẢ ĐỊNH] | Ops/PO (D09/D10) | Capacity profile pilot |
| BI owner: `drill_context` (BI) và HOME token phải dùng chung chuẩn ký/kiểm scope | BI owner | Thống nhất thư viện DrillContext |
| MOB-07 cần hai tỷ lệ + as_of | MOB owner | Cập nhật screen MOB-07 |
| [CXN-03], [CXN-33] như DIS/PRJ | Chủ nghiệp vụ vốn | Xem DIS.md, PRJ.md |

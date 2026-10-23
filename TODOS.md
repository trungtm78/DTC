# TODOS — MACHVON giai đoạn thiết kế (M1)

Cập nhật: 2026-10-22. Nguồn trạng thái chính vẫn là `PROGRESS.md`; tệp này là danh sách để người dùng kiểm tra.
Repo: https://github.com/trungtm78/PIS (nhánh `main`). Tag baseline: `baseline-v1.3` (commit `82a707f`).

## A. Đang làm gì
- Nâng bộ thiết kế `Design/MACHVON_Design` từ baseline v1.3 lên v1.4 theo nguyên tắc **baseline-first**: giữ nguyên nền tảng, chỉ thêm hoặc sửa tại chỗ có mã CR, không viết lại cả tài liệu.
- Không còn agent nào chạy; đang chuẩn bị bước backlog epic → story → task (T13) và các bước rà soát cuối M1.
- Chưa viết mã sản phẩm (đúng yêu cầu giai đoạn này).

## B. Đã xong (kiểm tra bằng lệnh ghi bên phải)
- [x] Tag `baseline-v1.3` và cổng bảo toàn baseline — `node Design/MACHVON_Design/work/tools/src/baseline-cli.mjs` (1165 thay đổi bản ghi baseline, 100% có CR; 0 ID/bảng/cột bị mất)
- [x] CI/CD theo protocol: `ci/`, `.github/workflows/ci.yml` và `release.yml`, hook `pre-push`, PR template — `node ci/src/verify-cli.mjs`; Actions: https://github.com/trungtm78/PIS/actions
- [x] Công cụ thiết kế `work/tools` (kiểm nhất quán, sinh HTML/PDF, gộp fragment, đồng bộ prototype, sổ pháp lý, chuẩn hóa RLS) — `cd Design/MACHVON_Design/work/tools && npm test` (80 test, coverage 97%)
- [x] 25 đặc tả phân hệ theo khung 13 mục — `Design/MACHVON_Design/01_Documents/05_modules/`
- [x] Tài liệu dựng lại trên nền baseline (giữ nguyên đoạn gốc, thêm khối "Cập nhật 1.4" kèm CR, có phụ lục ánh xạ): 01, 02 BRD, 03 FRD, 04, 05, 07, 08, 09, 10 (06 còn 12 đoạn cần ánh xạ)
- [x] Prototype phủ 478 màn hình (406 web + 72 mobile) không lỗi, giữ nguyên mockup của bạn
- [x] Hợp nhất quy ước RLS cho 246+ bảng tenant (RESTRICTIVE `tenant_boundary` + PERMISSIVE `tenant_access`)
- [x] Sửa lỗi SQL bị nhân bản khi gộp (từ 11 MB/2.990 `CREATE TABLE` xuống 739 KB/291 bảng)

## C. Số đo hiện tại
Màn hình 478 (v1.3: 327) · operation 815 (180) · bảng 291 (79) · test 1023 (420) · NFR 53 · 25 module spec · 1165 thay đổi baseline đều có CR · sổ pháp lý 58 mục [CXN] chưa xác nhận · bộ kiểm nhất quán và cổng bảo toàn baseline: 0 lỗi.

## D. Còn phải làm (theo thứ tự)
- [x] Gộp fragment cuối, bộ kiểm nhất quán sạch (đã sửa 92 lỗi chỉ mục)
- [x] Ánh xạ nốt các đoạn baseline của 04, 05, 06; gán/viết lại dấu [CXN] thiếu mã
- [x] Đồng bộ mã lỗi (IDEMPOTENCY_CONFLICT, SELF_APPROVAL_DENIED) và kiểm tra alias
- [x] Sinh lại trang HTML và PDF; cập nhật index.html; bật design-check bắt buộc
- [ ] Lập `legal_confirmation_register.json` (owner, bằng chứng) theo R4 khi có chủ nghiệp vụ
- [x] Kế hoạch epic → feature → story → task: 26 epic, 138 feature, 400 story, ~2.140 task (`03_Engineering/implementation_plan.json`, trang `Implementation_Plan.html`); backlog 478 dòng đã nối release + story — `node Design/MACHVON_Design/work/tools/src/plan-link-cli.mjs`
- [x] Cập nhật `implementation_decisions.json` (D01, D02 đã quyết), `implementation_readiness.json`, `AGENTS.md`, `Navigation_Architecture.md`
- [ ] Đọc độc lập: Codex đã review kế hoạch (25 phát hiện, đã sửa trong commit bd8c17f); còn chờ subagent "builder check" báo cáo "mỗi sản phẩm baseline dùng ở đâu trong kế hoạch"
- [ ] `/plan-eng-review` đối chiếu spec (§6), cập nhật `PROGRESS.md`, push
- [ ] Sau M1: `superpowers:writing-plans` cho M2 (R0 nền tảng) với đầu vào là bảng "sản phẩm baseline → công việc triển khai" trong tài liệu 09

## E. Việc dành cho bạn kiểm tra / quyết định
- [ ] **Đổi thư mục làm việc `C:DTC` → `C:PIS`:** repo GitHub đã đổi thành `trungtm78/PIS` (remote đã trỏ lại), nội dung repo và bộ nhớ Claude đã đổi. Thư mục đang bị VS Code/phiên Claude giữ nên chưa đổi được. Cách làm: đóng VS Code và mọi cửa sổ Claude Code, chạy `C:UsersPNE_AI_01ename-dtc-to-pis.cmd` (đổi tên thư mục và sửa 2 đường dẫn hook trong `.claude/settings.json`), mở lại VS Code tại `C:PIS`, bấm "tin cậy thư mục" nếu được hỏi.
- [ ] Xem lại các thay đổi Codex làm kế hoạch đổi: thêm story ST-KERNEL-110 (cửa sổ xác nhận pháp lý ở R1, R2 phụ thuộc vào đó), đổi mục thoát R1 trong tài liệu 09 (hai kỳ song song chuyển sang pilot R4, CR-PLAN-03), 13 test mới `UAT-PLAN-01..13`; giờ review IAM-001 nâng lên 6–10 giờ
- [ ] Đã cài `rtk` (tiết kiệm token): khởi động lại Claude Code để hook có hiệu lực; gỡ bằng `rtk init -g --uninstall`
- [ ] Mockup `02_Prototype`: mở `Design/MACHVON_Design/02_Prototype/index.html` kiểm các màn hình mới (MNE, DOC, LND, PMT, QMS, AUD, AST…) có đúng phong cách. Web ở 390 px còn 9 màn dạng dashboard tràn ngang (có từ trước hoặc mới: HOME-09), chưa chỉnh vì mockup là của bạn
- [ ] Xem `change_log.json` + `baseline_change_register.json`: 1165 thay đổi baseline đã gắn CR theo nhóm. Cần bạn xác nhận các CR ngữ nghĩa: `project.status` (vòng đời PIMA), `payment_request.acceptance_id` và `issue.assignee_id` (NOT NULL → nullable), `reporting_period.locked_at` (dẫn xuất)
- [ ] Xác nhận các giả định `[GIẢ ĐỊNH]` và danh sách `[CXN]` cần chủ nghiệp vụ/pháp chế ký (sổ: `03_Engineering/legal_confirmation_ledger.json`)
- [ ] D03 (định nghĩa kỳ/YTD, bộ số liệu golden), D04 (mapping nguồn), D05–D10: cần chủ thật; hiện chỉ soạn đề xuất, trạng thái CHỜ KÝ
- [ ] Xóa tay khung Java cũ `C:\PIS\backend` và `C:\PIS\.tools` (settings chặn `rm -rf`); thư mục đã bị gitignore
- [ ] Hook `.claude/hooks/stop-guard.bat` chặn kết thúc lượt đến khi `PROGRESS.md` có `STATUS` cuối; tắt trong `.claude/settings.json` nếu không muốn

## F. Lỗi đã phát hiện và xử lý trong phiên (để bạn biết)
- Tôi đã viết lại 04, 09, 10 và BRD thay vì xây tiếp trên nền baseline; đã sửa lại bằng cách dựng lại từ baseline và thêm cổng bảo toàn
- Công cụ gộp SQL làm nhân bản nội dung (11 MB); đã sửa và thêm test
- Công cụ sổ pháp lý bỏ sót mã `CXN-ORG-01`; đã sửa
- Cổng CI chặn nhầm chữ tiếng Việt trong mockup; đã loại riêng thư mục mockup khỏi quy tắc "mã tiếng Anh"

## M2b design drift to feed back into the design package
- `schema_reference.sql` makes `tenant_boundary` RESTRICTIVE for every role, which hides every row from `machvon_outbox_relay` despite its permissive policy `outbox_relay_access`. V003 narrows the restrictive policy on `outbox_event` to the other roles. Change request needed so the design SQL matches.

## M2b carry-overs
- Lên lịch job (seal audit mỗi 5 phút, verify hằng giờ, relay, purge idempotency hằng giờ): Temporal schedules, ST-KERNEL-044; định tuyến cảnh báo AUDIT_CHAIN_BROKEN và OUTBOX_LAG sang kênh vận hành: ST-KERNEL-051. M2b chỉ có hàm gọi được cùng MetricsSink/AlertSink.
- Endpoint đọc get_resources_audit_event*, get_resources_outbox_event*: chờ PDP (ST-IAM-004) và web shell.
- ST-KERNEL-028 TK-4: chạy bộ conformance trên 10 lệnh thuộc các phân hệ khác nhau, chỉ làm được khi các slice M3 có lệnh thật (hiện 3 lệnh mẫu + cổng commands:check).
- CR cho audit_event: lưu hash từng dòng để định vị chính xác dòng bị sửa (hiện báo theo cửa sổ seal).
- Mọi migration sau V003 viết tay trong db/migrations; db:generate chỉ sở hữu V001/V002.

## M2c design drift
- `membership.scope_version` (BR-IAM-03, BR-IAM-13) is not in `schema_reference.sql`; V004 adds it with default 1. Change request needed so the design SQL matches.
- The role to permission matrix of the 14 system roles comes verbatim from the IAM.md role table (column "Quyền tiêu biểu"); roles whose rights the table does not name (SPECIALIST, INVESTOR_OFFICER, the read and export rights of LEADER, AUDITOR, GUEST_CONTRACTOR) are empty or minimal until the business owner signs the matrix (CHỜ KÝ).

## M2c carry-overs
- Ký ma trận quyền 14 vai trò hệ thống (SPECIALIST, INVESTOR_OFFICER đang rỗng; LEADER chỉ có approval.decide; audit.read của TENANT_ADMIN/AUDITOR không có trong catalogue: catalogue dùng audit_event.read và audit.export) và danh sách trạng thái hợp đồng hiệu lực cho khách nhà thầu.
- CR cho schema: membership.scope_version (V004), unique grant Active (V006), policy outbox_event cho relay (V003).
- Chưa có: ủy quyền có thời hạn (ADM-04), số hạng entitlement (SAS-002), Redis/Keycloak transport cho cache, deny-list và sự kiện iam.access.changed.v1, màn hình ADM-01/ADM-03, chọn tenant (IAM-003), mời thành viên (ADM-006).
- Test hạ tầng: các suite dùng PostgreSQL nhúng; máy Windows cần đủ commit memory; khi chạy bị dừng giữa chừng hãy dọn tiến trình postgres.exe mồ côi của repo.

## M2d carry-overs
- Quy trình R10: PO duyệt baseline hình ảnh mới cho ADM-01 và ADM-03 (nội dung thật thay placeholder; chỉ khung được so khớp).
- Chưa có nút Xuất / Lưu-Tiếp tục của mockup trên ADM-01/03; chưa có sắp xếp thứ tự ghim ở sidebar ngoài hộp thoại ghim; chưa có API get_resources_membership (ADM-03 nhập ID người nhận).
- Đã thêm get_resources_role_definition (CR-ADM-05): cần chủ nghiệp vụ xác nhận phạm vi hiển thị vai trò theo người cấp.

## M2e carry-overs
- Change request: x-feature trong openapi.json; hàm tra membership xuyên tenant (SECURITY DEFINER hẹp, V008); tenant giả của nền tảng cho lệnh control-plane; view tenant_user_directory; API liệt kê membership ứng viên (CR-IAM-14); token tenant do API phát hành (CR-IAM-13); cột subdomain đặt trước trên tenant; lưu giữ initial_owner_email.
- Cần quyết định: ai.review/ai.cancel và feature; hành vi license Superseded.

## M2f lane A design gaps (change request entries needed)
- SAS-03 (SAS.md section 8) lists "Vòng đời, Lý do trạng thái, Owner" but `TenantDetail` of `getSystemTenant` has no `lifecycle_reason`, `suspended_at` or owner: add the fields (CR on openapi) so the screen can show why a tenant is suspended; until then it shows the status and the version only.
- `TenantSuspend.access_policy` (openapi) is a free choice, but the database function `tenant_runtime` derives the policy from the stored reason (SECURITY_INCIDENT is NO_ACCESS, any other reason READ_ONLY_EXPORT): the API refuses a pair that disagrees with 422 `VALIDATION_FAILED` on `access_policy`. Decide: drop `access_policy` from the contract, or store it on the tenant and read it in `tenant_runtime`.
- `suspendTenant` and `resumeTenant` list `sas.entitlement.changed.v1` in `x-events`, but suspending changes no entitlement version (the features stay): the commands emit only `sas.tenant.status_changed.v1`, and its consumer drops the entitlement and access caches. Remove the event from `x-events` or define what version it would record.
- The live tenant state is read per request with a 1 second process-local cache and dropped by the command (and by the status event in other processes); a shared cache (Redis) is not available here.



## M2f lane B design gaps (change request entries needed)
- `acceptInvitation` is declared `x-plane: tenant` with permission `invitation.accept`, but the person who accepts holds an identity token and no tenant token yet (the invitation is what gives them a membership). It is implemented like `selectTenantContext`: an identity command (`@Public` plus the invitee guard), idempotent and audited by its own pipeline. Change the contract to say so (no tenant plane, no permission).
- IAM.md 3.3 answers an already used token with 409 `INVITATION_EXPIRED` (there is no used-invitation code); a token that names no invitation, a wrong secret and a token of another tenant are all the same 404 `RESOURCE_NOT_FOUND`, so the answer never says whether an invitation exists.
- The seat limit comes from the latest valid `license_revision`: `seats` for staff, `quota_json.guest_seats` for guest contractors (IAM.md 3.3 names `guest_seats` but SAS never defines the key). A tenant with no revision has no limit. Define the key in the licence claims.
- `MemberInvite` has no `reason`, so the audit row of `inviteMember` has none; without `initial_grants` the person receives the MEMBER role on their unit (what `session.self` needs), which no document states.
- The invitation message goes through the `InvitationMailer` port; the only adapter is the in-memory MOCK one until the OMNI email channel exists (R1), so no invitation mail leaves the system yet. The events `iam.membership.invited|activated|suspended|ended.v1` are not in the notification catalogue.
- The hourly job that expires pending invitations (IAM.md section 9) is not implemented here; an expired invitation is expired on its next acceptance attempt. It belongs to the scheduler of Task 12.
- The last-owner guard (BR-IAM-07) runs before the rank rule on purpose: no one outranks a TENANT_OWNER (rank 99), so after the rank rule it could never be reached.
- `EffectiveAccess` (openapi, `getMyEffectiveAccess`) has `additionalProperties: false` and free-form `grants` and `delegations_in` items, and no `mode` or permission list at the top: the API puts role, scope (units with breadcrumb, projects, contracts), permissions, window and `state` (ACTIVE, EXPIRED, FUTURE) inside each grant, and the screen derives the effective permissions as the union of the ACTIVE ones (the property test proves it equals `effectivePermissions`). The session `mode` stays with the tenant selection answer. Change request: describe the grant and delegation items, and decide whether `mode` belongs in this answer.
- IAM-09 of the mockup has four tabs (Tổng quan, Số liệu, Tải liệu, Lịch sử) and a chart that no operation backs; they are not built, so the visual case compares the frame and the heading only.
- The unit-tree scope predicate wrapped the unit path in `rtrim(path, '/') || '/'`, which made the planner scan `organization_unit` for every scoped list (units, members, audit reads); it now tests the bare column with `starts_with`, which uses `organization_unit_path_idx` (p95 2 ms on 5,000 units and 50,000 grants). No migration was needed. `membershipsAffectedByUnits` (the holders to notify when a unit moves) still costs about 0.2 s at p95 for a department of 259 units, because it compares every subtree grant with the changed units; it runs on a reorganisation, not on a read. Two set-based rewrites were measured and the planner chose scans of `role_grant` for both, so the original query stays.

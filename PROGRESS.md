STATUS: IN_PROGRESS

# PROGRESS
Cập nhật: 2026-10-23T09:30+07:00 | Milestone: M2/6 | Task: M2c 0/8 (plan đã viết); M2b đã push (5e5363e)

Spec gốc: `Design/MACHVON_Design` (baseline v1.3, commit 82a707f). Kế hoạch đã duyệt: `C:\Users\PNE_AI_01\.claude\plans\pasted-content-id-f8fb-h-y-s-unified-brook.md` (sổ quyết định D-B01..D-B12, ledger R1..R11, task T1..T12).
Luật vận hành: `AUTONOMOUS_EXECUTION_PROTOCOL.md`. Quy tắc làm việc trong deliverable: `Design/MACHVON_Design/AGENTS.md` (sửa tại chỗ, giữ ID màn hình/yêu cầu, không tạo bản sao/ZIP).

## Milestone map
- M1 — Thiết kế triển khai + kế hoạch (cập nhật tài liệu O1–O11, chưa viết code sản phẩm)
- M2 — R0 nền tảng (tenant/RLS/IAM/audit/outbox/entitlement/theme/shell/DOC engine) — lập plan bằng writing-plans sau M1
- M3 — R1 lát rộng 25 phân hệ "mức tối thiểu dùng thật"
- M4 — R2 sâu hóa (tài chính, GPMB, văn bản, BI drill)
- M5 — R3 tích hợp ngoài (khi D05–D07 có hợp đồng)
- M6 — R4 hardening + UAT 100% (`UAT-COVERAGE.md`)

## Đã hoàn thành
- [x] M1-T1 Dọn khung Java khỏi git + baseline v1.3 vào git — commit 82a707f — n/a (tài liệu)
- [x] M1-T1b CI/CD theo protocol: ci/ (6 cổng), .github/workflows/ci.yml, PR template, hook pre-push — commit 9bdc5a8, b129f44 — 26 test PASS, line coverage 98% — GitHub Actions success
- [x] M1-T3..T9 (một phần) Đặc tả phân hệ: platform (IAM, ADM, SAS, NOT, OMNI), capital (MDM, PRJ, CAP, DIS, HOME, MNE), MOB (Flutter) — commit c6b66c3, 07083b0, 05ee036 — 0 lỗi nhất quán trong phạm vi mỗi nhóm
- [x] M1-T11/T12 Kế hoạch triển khai (09) và kế hoạch kiểm thử/chuyển đổi (10) viết lại — commit f80fbde, 4007310
- [x] M1-A Bảo toàn baseline: tag baseline-v1.3 (82a707f), cổng baseline-cli (change_log.json, ID/cột mất, đoạn tài liệu bị xóa không ánh xạ) — commit 9388823 — 69 test, coverage 96%
- [x] M1-B (một phần) 09 và 10 dựng lại trên nền baseline, giữ nguyên mọi đoạn gốc, thêm ánh xạ G0–G5→R0–R4 và bảng sản phẩm baseline→công việc triển khai — commit 85288b2
- [x] M1-C Đồng bộ mã lỗi (error_codes.json, kiểm alias), RLS một quy ước cho mọi bảng tenant, sổ CR 1165 thay đổi, sổ pháp lý 58 mục, design-check và baseline-preservation bắt buộc trong CI — commit trong phiên 22/10
- [x] M1-T2 Công cụ thiết kế node: check (8f02510), sinh HTML/PDF (860a4ee), gộp fragment (efa7fb7) — 45 test PASS — line coverage 98.8%
- [x] M1-T13/T14 Kế hoạch epic→story→task (26 epic, 138 feature, 401 story, ~2.200 task), Codex review (25 phát hiện đã sửa), builder check, sổ mã lỗi 629 mã, ERD 291 bảng, schema chạy được trên PostgreSQL 18 thật (sql-verify), prototype 478 màn hình có điều hướng + ảnh — commit 43578c7, bd8c17f, e94043e, 047221e, 461c528 — 217 test công cụ, coverage 98,3% — CI gate sql-verify đạt
- [x] M1 hoàn tất (tài liệu + kế hoạch); còn lại chỉ là mục chờ người dùng/chủ nghiệp vụ trong TODOS.md mục E
- [x] Đổi viết tắt DTC → PIS (Public Investment System): nội dung repo (commit 704691e), repo GitHub `trungtm78/PIS`, bộ nhớ Claude; còn việc người dùng đổi tên thư mục `C:DTC` → `C:PIS` (xem TODOS.md mục E)
- [x] M2a (10 task): monorepo + cổng merge + cổng nhãn review (độc lập, gắn với commit), harness PostgreSQL thật, migration V001/V002 sinh từ schema thiết kế (vai trò, GRANT/REVOKE theo bảng control-plane và append-only), test RLS catalog, TenantDatabase, ngữ cảnh tenant ký cho worker, Problem+JSON/allowlist/lint mã lỗi, khóa cache theo tenant, contracts lint/generate, API shell + bộ test cách ly tenant (API + DB) — commit 3fd31fd..e7351d1 — kernel 126, db 71, api 95, contracts 37, ci 73 test; Codex review từng task (nhiều vòng sửa)
- [x] M2b (8 task): migration V003 viết tay (trigger append-only audit_event/audit_seal, grant relay, policy outbox_event cho relay), primitive kernel (canonical JSON, Idempotency-Key, If-Match, Merkle seal, backoff, redact), IdempotencyStore (claim/takeover có rào), outbox + relay SKIP LOCKED + consumer inbox (test kill giữa chừng: đúng 100 hiệu ứng), AuditWriter + AuditSealJob (niêm phong và xác minh, 6 kiểu giả mạo), CommandInterceptor (@Command/@Scope: idempotent, If-Match, audit cùng transaction, DENIED transaction riêng), bộ sinh ca conformance từ openapi.json (574 thao tác ghi, 384 có If-Match) + cổng commands:check trong lint, sửa TenantDatabase khi backend bị kill — commit 3bbd767..020cb39 — kernel 198, db 147, api 115, contracts 37, scripts 20, ci 84 test; Codex review 3 vòng (4 + 2 phát hiện đã sửa, vòng cuối sạch)

## Đang làm dở
Task: M2c — lõi phân quyền (plan: docs/superpowers/plans/2026-10-23-m2c-authorization-core.md, 8 task; ST-IAM-004, ST-ADM-004/005 phần backend, ST-KERNEL-027 một phần)
Đã làm: M2b xong và đã push; plan M2c viết xong.
BƯỚC TIẾP THEO: Task 1 (V004 + vai trò hệ thống) và Task 2 (PDP thuần trong kernel) song song → Task 3 (EffectiveAccess, cache) → Task 4 (policy guard) → Task 5/6 song song (cây đơn vị; vai trò và grant) → Task 7 (ma trận âm) → Task 8 (đóng M2c, plan M2d: web nền KERNEL-031/111 và màn hình ADM-01/03; Keycloak khi có môi trường).
File liên quan: docs/superpowers/plans/2026-10-23-m2c-authorization-core.md, Design/MACHVON_Design/01_Documents/05_modules/IAM.md

## Hàng đợi task kế tiếp (M1)
1. M1-T3 O2 research → `01_Documents/01_Nghien_cuu_va_phan_tich_nguon.md` + `03_Engineering/Market_Research.html` (pháp lý VN, thị trường, văn bản nhà nước, khoảng trống chức năng)
2. M1-T4 O3 `04_Thiet_ke_co_ban.md`: tenant = cơ quan chủ quản (R6), stack D-B07/D-B12, Temporal chủ duy nhất (R9), AI theo phân loại dữ liệu (R5), hạ tầng theo slice (R1)
3. M1-T5 O4–O6 lõi: IAM/tenant, MDM, PRJ, CAP, DIS (05, openapi, sql, data_dictionary, index P1)
4. M1-T6 O4–O6 kiểm soát: CTR/PAY sổ lũy kế (R7), ISS, NOT/OMNI, BI/DGV, import idempotent (A3)
5. M1-T7 O4–O6 AI/SaaS: BID, LLM, SAS (entitlement, billing, theme)
6. M1-T8 Phân hệ mới DOC (R8), LND, PMT, QMS, AUD, AST, MNE
7. M1-T9 Mobile Flutter + sync rules PowerSync (A1) — `07_Smartphone_iOS_Android.md`
8. M1-T10 Prototype màn hình mới + field mới theo mockup (R10, D-B11)
9. M1-T11 O7 backlog epic→story→task + O8 kế hoạch `09` (giờ review, WIP≤2 — R2)
10. M1-T12 O9 QA/migration/fixtures (`10`, test_cases, test_fixtures, mapping)
11. M1-T13 O10 truy vết + O1 readiness/quyết định + sổ xác nhận pháp lý (R4) + O11 mâu thuẫn
12. M1-T14 Sinh HTML/PDF, chạy check, builder check, Codex review, /plan-eng-review

## Quyết định kiến trúc
| Ngày | Quyết định | Lý do | Ảnh hưởng |
|---|---|---|---|
| 2026-10-22 | Stack: NestJS modular monolith + React/Vite + Flutter + PostgreSQL RLS + Redis + Keycloak + Temporal + LiteLLM/Langfuse + PowerSync, cloud VN | D-B07 (Claude quyết), D-B12 Flutter (người dùng chốt), D-B03 | Thay kế hoạch Java cũ |
| 2026-10-22 | `Design/MACHVON_Design` vào git (trừ `work/` lịch sử 194 MB, ZIP, bản v1.2, PDF/MP4 nguồn) | Protocol yêu cầu commit theo task; cần diff tài liệu | `.gitignore` |
| 2026-10-22 | Tài liệu danh mục: JSON/SQL/OpenAPI là nguồn duy nhất; HTML/PDF sinh bằng script node | D3 (người dùng chốt), máy không có Python | `work/tools/` |

## Assumption đã tự quyết
| Audit seal: định vị dòng bị sửa | Báo theo cửa sổ seal (from_seq..to_seq), không theo từng dòng vì thiết kế không lưu hash từng dòng; muốn chính xác cần CR cho audit_event | ST-KERNEL-023 AC-2, ADM-002 |
| Replay trả status của route hiện hành, không phải status đã lưu | Nest áp status route sau interceptor; status gốc vẫn lưu trong idempotency_record. Đổi @HttpCode của lệnh đang chạy là đổi hợp đồng | Codex P2 vòng 1 |
| Bảng inbox cho consumer nội bộ | Dùng lại integration_event_inbox (provider=consumer:<tên>) | bảo toàn baseline |
| Điểm mơ hồ | Diễn giải đã chọn | Căn cứ trong spec |
|---|---|---|
| Tenant là gì | Cơ quan chủ quản ký hợp đồng (UBND tỉnh/bộ); đơn vị con là organization_unit | R6 (người dùng chốt D9) |
| Định nghĩa kỳ/YTD, golden data (D03), mapping nguồn (D04) | Soạn đề xuất, trạng thái CHỜ KÝ; không tự chốt | D-B04 ngoại lệ |
| Căn cứ pháp lý thứ cấp [CXN] | Vào sổ xác nhận; slice dùng chưa được DONE khi chưa xác nhận | R4 |

## Trạng thái test
Full suite: `npm test` (kernel 198, db 147, api 115, contracts 37, scripts 20) + `cd ci && npm test` 84 + `node work/tools/check.mjs` | Coverage dòng ≥ 95% mỗi package | Test fail: không

## Nợ kỹ thuật / rủi ro
- `C:\PIS\backend` và `C:\PIS\.tools` (khung Java cũ) còn trên đĩa vì `.claude/settings.json` chặn `rm -rf`; đã gitignore. Người dùng xóa tay khi tiện.
- Đã bật required=true cho design-check và baseline-preservation trong ci/config.json (22/10).
- Sổ pháp lý: 58 mục [CXN] chưa xác nhận (owner mặc định Pháp chế); cần legal_confirmation_register.json khi có chủ nghiệp vụ.
- Mã lỗi chuẩn: IDEMPOTENCY_CONFLICT, SELF_APPROVAL_DENIED (error_codes.json).
- Stop hook `.claude/hooks/stop-guard.bat` chặn kết thúc lượt tới khi có STATUS cuối; không ghi trạng thái giả.
- 10 quyết định D01–D10 trong spec cần owner thật cho D03/D04/D05–D10.
- ST-KERNEL-030 follow-up: phát hiện breaking change giữa openapi N và N-1 chưa làm (M2a-T8 chỉ có lint x-permission/dto_exposes_secret + sinh permissions/types).

STATUS: IN_PROGRESS

# PROGRESS
Cập nhật: 2026-10-22T14:45+07:00 | Milestone: M1/6 | Task: 1/14

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

## Đang làm dở
Task: M1-T2 — Công cụ node kiểm truy vết theo loại yêu cầu + sinh HTML + xuất PDF (D3, R11, C1)
Đã làm: chưa bắt đầu
BƯỚC TIẾP THEO: đọc cấu trúc JSON (traceability.json, test_cases.json, implementation_backlog.json, screen_catalog.json, openapi.json) rồi viết `Design/MACHVON_Design/work/tools/check.mjs` + test fixture (TDD: fixture hỏng phải đỏ trước).
File liên quan: `Design/MACHVON_Design/work/tools/`, `Design/MACHVON_Design/03_Engineering/*.json`

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
| Điểm mơ hồ | Diễn giải đã chọn | Căn cứ trong spec |
|---|---|---|
| Tenant là gì | Cơ quan chủ quản ký hợp đồng (UBND tỉnh/bộ); đơn vị con là organization_unit | R6 (người dùng chốt D9) |
| Định nghĩa kỳ/YTD, golden data (D03), mapping nguồn (D04) | Soạn đề xuất, trạng thái CHỜ KÝ; không tự chốt | D-B04 ngoại lệ |
| Căn cứ pháp lý thứ cấp [CXN] | Vào sổ xác nhận; slice dùng chưa được DONE khi chưa xác nhận | R4 |

## Trạng thái test
Full suite: CHƯA CÓ (M1 là tài liệu; "suite" = `node work/tools/check.mjs` từ M1-T2) | Patch coverage: n/a | Test fail: không

## Nợ kỹ thuật / rủi ro
- `C:\DTC\backend` và `C:\DTC\.tools` (khung Java cũ) còn trên đĩa vì `.claude/settings.json` chặn `rm -rf`; đã gitignore. Người dùng xóa tay khi tiện.
- Stop hook `.claude/hooks/stop-guard.bat` chặn kết thúc lượt tới khi có STATUS cuối; không ghi trạng thái giả.
- 10 quyết định D01–D10 trong spec cần owner thật cho D03/D04/D05–D10.

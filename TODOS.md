# TODOS — MACHVON giai đoạn thiết kế (M1)

Cập nhật: 2026-10-22. Nguồn trạng thái chính vẫn là `PROGRESS.md`; tệp này là danh sách để người dùng kiểm tra.
Repo: https://github.com/trungtm78/DTC (nhánh `main`). Tag baseline: `baseline-v1.3` (commit `82a707f`).

## A. Đang làm gì
- Nâng bộ thiết kế `Design/MACHVON_Design` từ baseline v1.3 lên v1.4 theo nguyên tắc **baseline-first**: giữ nguyên nền tảng, chỉ thêm hoặc sửa tại chỗ có mã CR, không viết lại cả tài liệu.
- Không còn agent nào chạy; đang chuẩn bị bước backlog epic → story → task (T13) và các bước rà soát cuối M1.
- Chưa viết mã sản phẩm (đúng yêu cầu giai đoạn này).

## B. Đã xong (kiểm tra bằng lệnh ghi bên phải)
- [x] Tag `baseline-v1.3` và cổng bảo toàn baseline — `node Design/MACHVON_Design/work/tools/src/baseline-cli.mjs` (1165 thay đổi bản ghi baseline, 100% có CR; 0 ID/bảng/cột bị mất)
- [x] CI/CD theo protocol: `ci/`, `.github/workflows/ci.yml` và `release.yml`, hook `pre-push`, PR template — `node ci/src/verify-cli.mjs`; Actions: https://github.com/trungtm78/DTC/actions
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
- [ ] Viết lại `implementation_backlog.json` thành epic → feature → story → task kỹ thuật → task QA, phụ thuộc mức story, `review_hours`, khoảng ước lượng, cột `release` (P0/P1 ↔ R0–R4)
- [ ] Cập nhật `implementation_decisions.json` (D01/D02 đã phủ bởi D-B07/D-B12/D-B03) và `implementation_readiness.json`; cập nhật `AGENTS.md`, `Navigation_Architecture.md` (còn ghi 261/66 màn hình)
- [ ] Đọc độc lập (subagent mới + Codex): "mỗi sản phẩm baseline được dùng ở đâu trong plan?"; sửa chỗ thiếu
- [ ] `/plan-eng-review` đối chiếu spec (§6), cập nhật `PROGRESS.md`, push
- [ ] Sau M1: `superpowers:writing-plans` cho M2 (R0 nền tảng) với đầu vào là bảng "sản phẩm baseline → công việc triển khai" trong tài liệu 09

## E. Việc dành cho bạn kiểm tra / quyết định
- [ ] Mockup `02_Prototype`: mở `Design/MACHVON_Design/02_Prototype/index.html` kiểm các màn hình mới (MNE, DOC, LND, PMT, QMS, AUD, AST…) có đúng phong cách. Web ở 390 px còn 9 màn dạng dashboard tràn ngang (có từ trước hoặc mới: HOME-09), chưa chỉnh vì mockup là của bạn
- [ ] Xem `change_log.json` + `baseline_change_register.json`: 1165 thay đổi baseline đã gắn CR theo nhóm. Cần bạn xác nhận các CR ngữ nghĩa: `project.status` (vòng đời PIMA), `payment_request.acceptance_id` và `issue.assignee_id` (NOT NULL → nullable), `reporting_period.locked_at` (dẫn xuất)
- [ ] Xác nhận các giả định `[GIẢ ĐỊNH]` và danh sách `[CXN]` cần chủ nghiệp vụ/pháp chế ký (sổ: `03_Engineering/legal_confirmation_ledger.json`)
- [ ] D03 (định nghĩa kỳ/YTD, bộ số liệu golden), D04 (mapping nguồn), D05–D10: cần chủ thật; hiện chỉ soạn đề xuất, trạng thái CHỜ KÝ
- [ ] Xóa tay khung Java cũ `C:\DTC\backend` và `C:\DTC\.tools` (settings chặn `rm -rf`); thư mục đã bị gitignore
- [ ] Hook `.claude/hooks/stop-guard.bat` chặn kết thúc lượt đến khi `PROGRESS.md` có `STATUS` cuối; tắt trong `.claude/settings.json` nếu không muốn

## F. Lỗi đã phát hiện và xử lý trong phiên (để bạn biết)
- Tôi đã viết lại 04, 09, 10 và BRD thay vì xây tiếp trên nền baseline; đã sửa lại bằng cách dựng lại từ baseline và thêm cổng bảo toàn
- Công cụ gộp SQL làm nhân bản nội dung (11 MB); đã sửa và thêm test
- Công cụ sổ pháp lý bỏ sót mã `CXN-ORG-01`; đã sửa
- Cổng CI chặn nhầm chữ tiếng Việt trong mockup; đã loại riêng thư mục mockup khỏi quy tắc "mã tiếng Anh"

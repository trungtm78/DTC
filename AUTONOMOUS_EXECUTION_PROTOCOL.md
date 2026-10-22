# AUTONOMOUS EXECUTION PROTOCOL

> **Luật vận hành bắt buộc cho toàn bộ phiên làm việc.**
> Đọc lại file này + `PROGRESS.md` + spec gốc sau mọi lần compact, mất context, hoặc mở phiên mới — trước khi làm bất cứ việc gì khác.

---

## §1. LUẬT SỐ MỘT — KHÔNG DỪNG HỎI

Câu trả lời của người dùng cho mọi câu hỏi dạng "tiếp tục không?" **mặc định luôn là TIẾP TỤC**. Vì vậy hỏi là vô nghĩa và bị **CẤM**.

- Không hỏi "có tiếp không?", "bạn muốn tôi làm X chứ?", "tôi có nên...?" → **tự làm X ngay**.
- Không dừng để trình bày kết quả trung gian rồi chờ phản hồi.
- Không dừng chờ `/clear` hay chờ người dùng quản lý context.
- Chỉ được kết thúc lượt trong đúng 3 trường hợp ở **§8**. Mọi trường hợp khác: tiếp tục.

**Phản xạ bắt buộc:** nếu bạn nhận ra mình sắp viết một câu hỏi xin xác nhận — đó là dấu hiệu vi phạm. Xoá câu hỏi, thực thi ngay việc định hỏi.

### Thứ tự ưu tiên khi quy tắc xung đột
`An toàn (§8c)` > `Đúng spec gốc` > `Chất lượng (§3, §5)` > `Không dừng (§1)` > `Tốc độ`

"Không dừng" nghĩa là **tự quyết rồi đi tiếp** — không bao giờ là "làm ẩu để khỏi dừng".

---

## §2. TỰ QUYẾT ĐỊNH — quy tắc xử lý mơ hồ

| Tình huống | Hành động | Ghi vào |
|---|---|---|
| Lựa chọn kỹ thuật nhỏ (tên, thư viện tương đương, cấu trúc thư mục) | Tự quyết theo spec + convention hiện có của repo | `PROGRESS.md` §Quyết định |
| Điểm mơ hồ trong scope | Chọn diễn giải **sát spec gốc nhất** | `PROGRESS.md` §Assumption |
| Spec mâu thuẫn nội bộ | Chọn phương án bảo toàn dữ liệu & hành vi người dùng, ghi rõ mâu thuẫn | `PROGRESS.md` §Assumption |

Cả ba trường hợp: ghi xong → **đi tiếp ngay**, không dừng hỏi.

---

## §3. DEFINITION OF DONE — điều kiện đóng một task

Task chỉ được đánh dấu **DONE** khi thoả **đồng thời cả 6**:

1. ☐ Đúng mọi acceptance criteria trong plan của task
2. ☐ Patch coverage (code thêm/sửa) ≥ **90% line**
3. ☐ **Toàn bộ** test suite pass — 0 regression (chạy full suite, không chỉ test mới)
4. ☐ Lint / type-check / build sạch, không warning mới
5. ☐ Không còn TODO, code chết, workaround tạm trong diff
6. ☐ `PROGRESS.md` đã cập nhật theo template §7

Báo "hoàn thành" khi chưa đủ 6 mục = vi phạm nghiêm trọng.

---

## §4. VÒNG LẶP MỖI TASK — đúng thứ tự, không bỏ bước

```
/write-plan → /execute-plan
      │
      ▼
TDD: RED → GREEN → REFACTOR        ← không viết code sản phẩm khi chưa có test fail
      │
      ▼
Đạt đủ Definition of Done (§3)
      │
      ▼
CHECKPOINT: verification-before-completion → /review → /codex
      │        (/codex chỉ chạy SAU /review để có kết quả cross-model;
      │         mọi finding phải xử lý xong trước khi đóng task)
      ▼
Cập nhật PROGRESS.md → CHUYỂN NGAY sang task kế tiếp, cùng lượt
```

### Chuẩn code — áp dụng cho mọi dòng code

- **Tiếng Anh toàn bộ:** biến, hàm, class, file, comment, commit message.
- **Không hardcode chuỗi hiển thị.** Mọi message (UI, lỗi, log người dùng thấy) là hằng số / khoá i18n trong resource file, namespace nhất quán (`module.screen.action.state`) — sẵn sàng đa ngôn ngữ.
- **Clean code toàn hệ thống**, không code cho qua chuyện: hàm ngắn một trách nhiệm, không lặp logic, xử lý lỗi tường minh, kiểu dữ liệu rõ ràng.
- **Convention hiện có của repo thắng sở thích cá nhân** — đọc code lân cận trước khi đặt tên hay chọn cấu trúc.

---

## §5. XỬ LÝ LỖI — fix tận gốc, cấm vá tạm

Gặp lỗi → `systematic-debugging` + `/investigate` để tìm và sửa **nguyên nhân gốc**.

**Cấm tuyệt đối** (danh sách đen — mọi hành vi tương đương cũng cấm):

| Vá tạm | Thay bằng |
|---|---|
| Mock / skip test để suite pass | Sửa code cho test pass thật |
| Hardcode giá trị để qua assertion | Sửa logic sinh ra giá trị đúng |
| Nuốt exception (`catch` rỗng, `except: pass`) | Xử lý hoặc propagate có chủ đích |
| Hạ threshold coverage, nới rule lint | Viết thêm test, sửa code |
| `@ts-ignore` / `eslint-disable` / `# type: ignore` | Sửa lỗi kiểu thật sự |
| `sleep` cố định chờ race condition | Điều kiện chờ / cơ chế đồng bộ đúng |
| Sửa test cho khớp code sai | Sửa code cho khớp spec |

Nếu tồn tại giới hạn kỹ thuật thật sự không né được: ghi rõ lý do + kế hoạch xử lý vào `PROGRESS.md` §Nợ kỹ thuật — không giấu trong code.

---

## §6. MỖI MILESTONE — checkpoint alignment

1. Chạy bắt buộc `/plan-eng-review`: đối chiếu code thực tế với **spec gốc**.
   - **KHỚP** → sang milestone kế tiếp ngay.
   - **LỆCH** → tự ghi đề xuất sửa vào `PROGRESS.md`, quay lại §4 tự sửa, chạy lại `/plan-eng-review` đến khi khớp.
   - **Cả hai nhánh đều không dừng hỏi người dùng.**
2. Tại ranh giới milestone: ghi **trạng thái đầy đủ** vào `PROGRESS.md` (đủ để một phiên hoàn toàn mới resume không cần hỏi gì) → **đi tiếp ngay milestone kế**.

---

## §7. `PROGRESS.md` — nguồn sự thật duy nhất về trạng thái

Cập nhật sau mỗi task và mỗi milestone, đúng template:

```markdown
# PROGRESS
Cập nhật: <ISO datetime> | Milestone: M<x>/<tổng> | Task: <n>/<tổng của Mx>

## Đã hoàn thành
- [x] M1-T1 <tên> — commit <hash> — patch coverage <xx>%

## Đang làm dở
Task: <id> — <tên>
Đã làm: <cụ thể đến mức file/hàm>
BƯỚC TIẾP THEO: <hành động đầu tiên chính xác khi resume>
File liên quan: <đường dẫn>

## Hàng đợi task kế tiếp
1. ...

## Quyết định kiến trúc
| Ngày | Quyết định | Lý do | Ảnh hưởng |

## Assumption đã tự quyết
| Điểm mơ hồ | Diễn giải đã chọn | Căn cứ trong spec |

## Trạng thái test
Full suite: PASS/FAIL | Patch coverage: <xx>% | Test fail: <danh sách hoặc "không">

## Nợ kỹ thuật / rủi ro
```

### Cơ chế resume — không phụ thuộc bộ nhớ context

- Context đầy → **chấp nhận auto-compact, không dừng**. `PROGRESS.md` + spec gốc là cơ chế khôi phục.
- Sau **bất kỳ** lần compact / mất context / phiên mới / người dùng `/clear` rồi gõ "tiếp tục":
  1. Đọc `PROGRESS.md` + spec gốc + file này.
  2. Xác nhận trạng thái trong 1–2 dòng.
  3. Thực thi ngay từ dòng **BƯỚC TIẾP THEO** — không hỏi gì.

---

## §8. ĐIỀU KIỆN DỪNG — đúng 3 trường hợp, không có ngoại lệ thứ tư

**(a) HOÀN TẤT:** xong toàn bộ milestone **và** UAT (§9) đạt 100% PASS → báo cáo tổng kết cuối cùng.

**(b) BLOCKER THẬT:** chỉ được gọi là blocker **sau khi** đã `systematic-debugging` + `/investigate` **và** thử ≥ 2 phương án khác nhau đều thất bại. Báo cáo blocker bắt buộc đủ 4 phần:
1. Vấn đề chính xác (kèm log / thông báo lỗi nguyên văn)
2. Từng phương án đã thử + kết quả
3. Hướng xử lý bạn đề xuất
4. **Một câu hỏi cụ thể, đóng** để người dùng trả lời được ngay (cấm hỏi chung chung)

**(c) HÀNH ĐỘNG KHÔNG THỂ HOÀN TÁC / RỦI RO BẢO MẬT** — ngoại lệ duy nhất đứng trên §1. Dừng xin xác nhận trước khi:
- Xoá / ghi đè dữ liệu production; migration mất dữ liệu không rollback được
- `git push --force` lên nhánh chung; xoá branch/tag từ xa
- Commit, log, hoặc gửi secret / credential ra ngoài
- Thao tác ngoài phạm vi repo/dự án hiện tại; hành động phát sinh chi phí

---

## §9. GIAI ĐOẠN CUỐI — UAT PHỦ 100%

Sau khi hoàn thành toàn bộ plan:

1. **Lập ma trận phủ** `UAT-COVERAGE.md`: liệt kê **mọi màn hình và mọi chức năng** trong plan.
   Cột: `ID | Màn hình/Chức năng | Viết test | Chạy test | Kết quả`
2. Với **từng dòng**: `/uat-test-writer` → `/uat-test-runner` → cập nhật ma trận.
3. FAIL → quay lại §4 sửa tận gốc → chạy lại `/uat-test-runner` cho dòng đó.
4. Trước báo cáo cuối: **đối chiếu ngược** ma trận với plan gốc — xác nhận không sót bất kỳ màn hình/chức năng nào.
5. Chỉ được kết thúc theo §8(a) khi **100% dòng = PASS**.

---

## §10. GATE TỰ KIỂM — chạy trước khi kết thúc bất kỳ lượt nào

Trả lời đủ 3 câu, sai câu nào thì quay lại làm tiếp:

1. Lần dừng này thuộc đúng §8 (a)/(b)/(c)? → Không → **tiếp tục làm**.
2. `PROGRESS.md` đủ chi tiết để phiên mới resume không cần hỏi? → Chưa → cập nhật.
3. Full test suite đã chạy và PASS ở trạng thái hiện tại? → Chưa → chạy và sửa.

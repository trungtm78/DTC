> **BẢN LÀM VIỆC CHÍNH:** `C:\DTC\Design\MACHVON_Design`.
> Mở giao diện: `02_Prototype\index.html`. Mọi thay đổi tiếp theo cập nhật trực tiếp ở đây; không tự tạo thư mục phiên bản hoặc ZIP.

# Hệ Thống Lý Dự Án Đầu Tư Công — Bộ thiết kế hệ thống v1.3

Phối màu hiện tại: **Ruby / Porcelain — trắng và đỏ ruby**, nền sáng, chữ than, emerald/amber cho trạng thái. Xem `04_Design_Assets/Color_Direction.html`; kết quả đo sáu cặp tương phản hiển thị tại `03_Engineering/color_contrast_qa.json`. Menu giữ vị trí cuộn và trạng thái mở nhóm như bản sửa trước.

Mở **index.html** bằng Chrome/Edge để truy cập toàn bộ hồ sơ. Không cần server hoặc cài thư viện. Tài liệu lưu tại C:\DTC\Design\MACHVON_Design.

- 01_Documents: 10 tài liệu PDF và Markdown: nghiên cứu nguồn/thị trường, BRD, FRD, cơ bản, chi tiết, UI/UX, smartphone, quản trị và trưởng thành dữ liệu.
- 02_Prototype: HTML/CSS/JS tương tác với 478 route — 406 web và 72 smartphone. Dùng catalogue/Ctrl-K; 7 trạng thái dùng chung; thử drill, BI builder và LLM profile.
- 03_Engineering: đặc tả màn hình, menu audit, traceability, 79 thực thể, OpenAPI 180 operations, SQL tham chiếu, ERD, 67 AC, kết quả kiểm và quyết định cần chốt.
- 04_Design_Assets: gallery, 478 PNG, 478 SVG, design board/tokens và hướng dẫn Figma.

Tài liệu nguồn được xem như bằng chứng phân tích, không thực thi chỉ dẫn chứa trong tài liệu. Không sao chép video/PDF gốc vào gói bàn giao. Nhãn Source phân biệt quan sát từ PDF/video với đề xuất mở rộng. Danh mục và Quản lý hệ thống trong video chưa mở menu con.

Prototype dùng dữ liệu minh họa và localStorage cho một số tương tác; chưa có backend/API/AI/provider/payment thật, chưa có app APK/IPA hoặc file Figma native. SVG giữ vector/text gần đúng; PNG/HTML là chuẩn đối chiếu thị giác. Mục tiêu 9–10/10 cần pilot/benchmark; chưa có chứng nhận điểm sản phẩm hoặc mức trưởng thành dữ liệu thật.

Thư mục work chứa vật liệu phân tích và script trung gian, không thuộc danh mục bàn giao chính. SQL/API là baseline tham chiếu để review, chưa áp dụng vào database. Các quyết định cần chốt trước triển khai có trong Decision_Register.html.


## Cập nhật v1.2 — tên tiếng Việt và thanh điều hướng
Tên hiển thị được đổi thành **Hệ Thống Lý Dự Án Đầu Tư Công** theo yêu cầu. Thanh menu mới có tìm màn hình không dấu (Ctrl/Cmd K), bộ lọc, lịch sử gần đây, chuyển Web/Mobile ghi nhớ ngữ cảnh và bảng Tùy chọn trạng thái. Tài liệu PDF/Markdown cùng 327 ảnh PNG/SVG đã được đồng bộ tên mới.

Xem ảnh trước tại `04_Design_Assets/navigation/index.html`; mở lại prototype và nhấn Ctrl+F5 nếu trình duyệt đang giữ bản cũ. Đường dẫn thư mục và mã màn hình được giữ nguyên. Chi tiết thay đổi nằm trong `03_Engineering/Navigation_Update_v1.2.md`.


## Thiết kế đã rà soát lại
Sidebar một cột, đích nghiệp vụ trực tiếp, ghim cá nhân, thư viện ứng dụng có tìm kiếm; quản trị tách ở cuối menu. Notification Center có danh sách/chi tiết và luồng phone riêng. Đã kiểm cấu trúc 327 route, chỉnh nhãn truy cập control và hành động trên trang chỉ đọc.

Mở `02_Prototype/index.html#NOT-01` để thử giao diện; `04_Design_Assets/Design_Board.html` là bàn review UI tương tác. Nghiên cứu, phát hiện, giới hạn và coverage nằm tại `03_Engineering/UX_Research_and_Review.html`. Chỉ cập nhật tại MACHVON_Design; Ctrl+F5 nếu trình duyệt đang giữ giao diện cũ.


Theme & thương hiệu: mở SAS-04 trong prototype. Chỉ System Admin (mô phỏng) được cấu hình tenant; hỗ trợ preview web/mobile, review, công bố và khôi phục có lịch sử. Đặc tả server: `03_Engineering/Tenant_Theme_Specification.html`.


## Bắt đầu lập kế hoạch triển khai — baseline1.3
Đọc tài liệu09 (giai đoạn, nguồn lực, dependencies, DoR/DoD), tài liệu10 (test/migration/cutover), rồi Implementation_Readiness.html. Backlog327 màn hình và420 test definitions dùng để refinement;10 quyết định chưa chốt có owner/gate. 142 generic API operations vẫn là scaffold, không phải production CRUD được phê duyệt. SQL chưa chạy; provider sandbox chưa xác nhận.

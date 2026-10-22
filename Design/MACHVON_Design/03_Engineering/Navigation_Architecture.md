# Điều hướng nghiệp vụ — bản làm việc hiện tại

## Quyết định thiết kế
Một sidebar ổn định rộng 252 px ở desktop, 236 px ở cửa sổ hẹp; không còn rail thứ hai, bộ chọn phân hệ lồng nhau hoặc catalogue chip cuộn ngang. Cá nhân gồm Tổng quan, Việc của tôi, Thông báo. Sáu nghiệp vụ mở trực tiếp: Dự án, Kế hoạch vốn, Giải ngân, Thanh toán, Nhà thầu, BI & báo cáo.

Mỗi phân hệ có nút đóng/mở riêng cho các lối tắt. Nhóm đã mở được giữ trong phiên, không tự đóng khi chọn nhóm khác. Chuyển route giữ khung trang và vị trí cuộn sidebar; đóng/mở nhóm không dựng lại nội dung hoặc xóa dữ liệu form đang nhập. Màn hình con giữ mục cha và đường quay lại. Tất cả chức năng mở danh mục đầy đủ của phân hệ; Tất cả ứng dụng mở thư viện có tìm kiếm trên 261 route web. Sáu nhóm cũ chỉ còn là cách tổ chức thư viện, không chiếm một thanh điều hướng thường trực.

## Cá nhân hóa và quản trị
Ngôi sao đầu trang ghim hoặc bỏ ghim route. Mục Đã ghim hỗ trợ đổi thứ tự, lưu localStorage và giữ sau tải trang. Quản trị & cấu hình nằm ở cuối sidebar, mở sáu phân hệ ADM, LLM, SAS, MDM, DGV, IAM. Prototype hiển thị phạm vi review đầy đủ; sản phẩm thật phải lọc menu theo quyền và kiểm quyền ở API.

## Notification Center
Hộp thông báo là danh sách và vùng đọc trong cùng một panel. Bộ lọc Tất cả/Chưa đọc/Cần xử lý, tìm không dấu, số chưa đọc đồng bộ sidebar; chọn thông báo mở nội dung và hành động liên quan. Không dùng bảng dữ liệu chung cho inbox. Bản mẫu có bốn thông báo; trạng thái đọc là dữ liệu phiên mô phỏng.

## Responsive và bàn phím
Web ≤980 px: sidebar thành drawer trái, thao tác mở/đóng có tên, Escape trả focus. ≤720 px: inbox chuyển sang danh sách hoặc chi tiết với nút quay lại. Smartphone giữ năm đích có icon và nhãn: Trang chủ, Dự án, Phê duyệt, Thông báo, Cá nhân. Tác vụ từ inbox smartphone đi tới route mobile. Thư viện và danh mục có tìm kiếm, focus ban đầu, vòng Tab và Escape. Ctrl/Cmd K là công cụ tìm màn hình phục vụ review; production cần tìm hồ sơ có phạm vi và quyền riêng.

## Thứ bậc thị giác
Nền trắng và xám ấm, đỏ ruby cho hành động và điểm chọn, emerald/amber cho trạng thái. Menu chính 14 px, menu ngữ cảnh 12 px, nội dung 14–16 px, tiêu đề 25–27 px. Thanh review 56 px desktop và 98 px mobile, header nghiệp vụ 54 px. Có trạng thái hover, selected, focus, disabled; chữ và icon đi cùng màu.

## Bằng chứng và giới hạn
Mapping giữ nguyên 261 route web và 66 route mobile. Xem navigation_architecture.json, workspace_navigation_qa.json, design_review_coverage.json. Tham chiếu nghiên cứu và hạng mục rà soát tại UX_Research_and_Review.html. Đây là prototype có dữ liệu minh họa, chưa phải kiểm thử người dùng hoặc chứng nhận WCAG.

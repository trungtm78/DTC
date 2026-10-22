# Hệ Thống Lý Dự Án Đầu Tư Công thiết kế trải nghiệm và hệ thống giao diện
Baseline 1.3 | 22/10/2026 | Hướng thiết kế: phòng điều hành dòng vốn, tập trung ngữ cảnh và hành động.

## Nguyên tắc trải nghiệm
Mỗi màn hình trả lời ba câu: đang xem phạm vi nào, điều gì cần chú ý, hành động tiếp theo là gì. Không đặt một bộ KPI giống nhau lên mọi phân hệ. Điều hành thể hiện xu hướng và việc ưu tiên; báo cáo dùng từng bước kiểm tra; chuyên gia nhà thầu dùng bàn làm việc tài liệu/nhận xét; tương tác dùng inbox; BI dùng canvas; master data dùng cây hiệu lực và impact review.

Thiết kế tách rõ lớp ứng dụng cho người dùng nghiệp vụ và Design Studio để duyệt toàn bộ catalogue. Thanh chọn màn hình/trạng thái của prototype không phải thành phần production. Prototype có dữ liệu minh họa và tương tác mô phỏng; những nút chưa có backend hiển thị thông điệp mô phỏng rõ ràng. Không dùng thông báo thành công giả cho hành động gửi ra ngoài.

## Kiến trúc thông tin
Web có thanh điều hướng theo vai trò, phạm vi tenant/đơn vị luôn nhìn thấy, tìm nhanh và hộp công việc. Đường dẫn sâu gồm module → đối tượng → phiên bản/tab. Trong một module, các điểm bắt đầu công việc được phân nhóm trong menu dọc; chi tiết và biểu mẫu giữ ngữ cảnh cha. Không sử dụng hàng chip kéo ngang để liệt kê tất cả màn hình. Sidebar chuyển thành drawer trên màn hình hẹp; tenant admin và platform admin là workspace khác, không dồn mọi quyền vào một menu.

Màn hình gốc theo vai trò: lãnh đạo vào điều hành; cán bộ vào việc/báo cáo đến hạn; kế toán vào hồ sơ/đối soát; chuyên gia vào bàn phân tích; data steward vào quality queue; platform operator vào tenant health. Một người có nhiều vai trò được đổi workspace, vẫn kiểm quyền server.

## Hệ thống thị giác
Màu chính đỏ ruby #B4233D, chữ than #29272D, sidebar/surface trắng #FFFFFF, nền trắng ấm #F7F5F4. Điểm chọn #FFF0F2; emerald #287866 cho trạng thái tích cực, amber #99631C cho cảnh báo. Amber phục vụ cảnh báo/ưu tiên, không gắn ngẫu nhiên cho mọi thẻ. Dùng chữ 14–16 px cho nội dung, 24–32 px cho tiêu đề, số tabular trong bảng tiền. Font có tiếng Việt hoàn chỉnh; triển khai có thể chọn font thương mại/mã nguồn mở đã kiểm license. Mockup dùng Segoe UI/Arial để mở offline ổn định.

Grid desktop 12 cột, nội dung co giãn, gutter 16–24 px, spacing theo 4/8 px. Card radius 14, input 8, pill trạng thái 20. Bảng dùng đường phân cách nhẹ, header cố định, tên/mã dự án ghim, tiền canh phải, số âm có ký hiệu và lời giải thích. Đơn vị tiền hiện ở header và tooltip; cho đổi tỷ/triệu/đồng nhưng không đổi giá trị lưu.

## Tính động có kiểm soát
Dashboard: kéo thả/reorder/resize trong mode chỉnh sửa; auto-save nháp có version; publish riêng; undo/redo; layout riêng desktop/tablet/mobile. Bộ lọc có chips, clear-all, saved view, URL context an toàn. Chart selection cross-filter bảng và widget liên quan; reset có nút rõ; mọi widget công bố metric version và freshness. Mục tiêu production phải hỗ trợ keyboard reorder tương đương drag.

Form: progressive disclosure theo loại nguồn/hồ sơ/model; giữ giá trị khi đổi tab; dirty indicator và cảnh báo rời trang; autosave nháp với trạng thái đang lưu/đã lưu/lỗi, không giả định autosave đã gửi. Validation inline sau tương tác, summary lỗi khi submit và focus tới lỗi đầu. Đổi model cập nhật effort được hỗ trợ và chi phí ước tính; đổi gói/license hiện impact trước lưu.

Bảng: cấu hình cột, ghim, đổi thứ tự, density, filter builder và chọn hàng; hành động batch có preview số đối tượng, phạm vi và thất bại từng dòng. Bulk approve không bỏ qua kiểm tra từng hồ sơ. Drawer giữ ngữ cảnh danh sách; full page dành cho chỉnh sửa nhiều bước/tài liệu lớn. Hộp thoại chỉ dùng quyết định ngắn, luôn nêu đối tượng và hậu quả.

Chuyển động 120–180 ms cho hover/toggle, 180–240 ms cho drawer, không animation kéo dài ở bảng nghiệp vụ. Tôn trọng prefers-reduced-motion. Loading dùng skeleton thay vì hiện KPI 0 rồi đổi sang số thật; đây là cải tiến sau quan sát clip tại 00:03–00:05. Progress thật theo stage, không phần trăm giả. Toast cho phản hồi nhẹ, error quan trọng cố định trong vùng nội dung.

## Drill down và giải thích số liệu
Tất cả số tổng hợp có affordance ↘/link, tooltip nêu ý nghĩa và action xem chi tiết. Từ tài chính đi tới đơn vị/nguồn/dự án/kỳ/giao dịch/chứng từ; từ AI tới task/run/attempt/usage; từ thông báo tới workflow/recipient/attempt/provider callback; từ SaaS tới tenant/subscription/license/invoice line. Bảng ngữ cảnh gồm scope, as_of, snapshot, formula, unit và exclusions.

Drawer drill có breadcrumb, tổng được chọn, nhóm con và footer đối soát. Tỷ lệ show numerator/denominator. Khi con không cộng được phải nêu lý do (distinct overlap, ratio, suppressed scope). Không làm drill chỉ mở trang tổng quan khác mất bộ lọc. Tải chứng từ cần quyền hiện tại; link nguồn hết hạn có hướng dẫn cấp lại.

## Trạng thái và khả năng tiếp cận
Mỗi nhóm màn hình có loading, populated, empty, validation error, service error, permission denied, stale data; mobile thêm offline, sync pending/conflict, permission denied camera/push; SaaS thêm grace/expired/suspended. Empty phân biệt chưa có dữ liệu với không có kết quả lọc. Không dùng chỉ màu để truyền trạng thái. Focus ring rõ, tab order theo luồng, heading semantic, input labels liên kết, aria-live phù hợp và tooltip không chứa thông tin duy nhất.

Mục tiêu WCAG AA phải được đo ở UI production, bao gồm brand tenant thay màu. Tương phản body tối thiểu mục tiêu 4,5:1, control/big text 3:1; logo không thay cho tên tenant trong xác thực. Text scaling 200% và screen reader phải được kiểm ở luồng lõi. Nội dung tiếng Việt không cắt tên dự án thiếu tooltip/xem đầy đủ.

## Bộ component và bàn giao thiết kế
Component families: AppShell, TenantSwitcher, WorkspaceNav, SearchPalette, MetricTile, DataTable, FilterBar, DrillDrawer, MoneyInput, FiscalPeriodPicker, FundingMatrix, EvidenceViewer, ComparePanel, WorkflowCanvas, NotificationPreview, LicenseImpactPanel, MasterTree, QualityBadge, SyncQueue và MobileBottomNav. Mỗi component có variants theo density/state/permission, token và event contract.

Tệp design_tokens.json là nguồn token ban đầu; screen_catalog.json là danh mục màn hình; Screen_Specifications.html nối màn hình với role/field/validation/AC. PNG là bản review raster; HTML/CSS/JS là prototype sửa được. Figma chưa kết nối nên không có file Figma native hay Auto Layout/component library được xác nhận; có thể nhập SVG vector và dùng HTML/ảnh làm tham chiếu khi kết nối công cụ thiết kế. Không gọi PNG là layer Figma chỉnh sửa được.

## Kiểm định UX và ngưỡng đạt mục tiêu
Pilot với đại diện mỗi vai trò, task đo được: tìm hồ sơ, lập báo cáo, xử lý return, drill tới chứng từ, xác nhận thông báo, cấu hình license và kiểm chứng AI. Mục tiêu đề xuất ≥90% hoàn tất task lõi không trợ giúp, lỗi nhập trọng yếu bằng 0 trong bài test, SUS ≥80 và thời gian tìm nguồn giảm ≥50% so với baseline. Cần đo thực tế; không tự chấm UI 9/10 bằng cảm nhận của người thiết kế.


## Thanh điều hướng bản thiết kế — cập nhật v1.2
Tên hiển thị chính thức theo yêu cầu: Hệ Thống Lý Dự Án Đầu Tư Công. Giữ đường dẫn thư mục và mã màn hình để không làm hỏng bookmark, traceability và liên kết tài liệu. Tên mới xuất hiện ở web, smartphone, các tài liệu và thư viện hình.

Thanh điều hướng sử dụng nền trắng #FFFFFF, biểu trưng kiến trúc nền ruby #991C35, chữ đậm vừa và khoảng trắng rõ ràng. Thứ bậc gồm nhận diện hệ thống, tìm màn hình, lựa chọn Web/Mobile và Tùy chọn. Số lượng 327 màn hình được đưa vào hộp tìm kiếm; trạng thái mô phỏng nằm trong bảng Tùy chọn cùng mã/tên màn hình và nút trước/sau. Khi chọn trạng thái khác chuẩn, nút Tùy chọn có dấu hiệu và nhãn giải thích.

Ctrl/Cmd K mở bảng tìm màn hình; hỗ trợ tiếng Việt có dấu hoặc không dấu, tên/mã/phân hệ, bộ lọc nền tảng và phân hệ, lịch sử tám màn hình gần nhất lưu cục bộ. Phím lên/xuống chọn kết quả, Enter mở, Escape đóng và trả focus. Web/Mobile ghi nhớ màn hình gần nhất của từng nền tảng trong phiên; thay đổi nền tảng quay về trạng thái chuẩn. Kết quả rỗng có hướng dẫn bỏ bộ lọc. Hộp thoại có nhãn, focus ring và giữ vòng Tab bên trong.

Ở độ rộng ≤620px, thanh điều hướng chuyển thành hai hàng; các điều khiển giữ nhãn cần thiết và không tràn ngang. Bộ kiểm tra navigation_qa.json ghi nhận hành vi điều hướng và bố cục 390/768/1134/1440px. Các ảnh tham chiếu nằm trong 04_Design_Assets/navigation. Thanh này phục vụ review prototype; không thay thế thanh nghiệp vụ và tìm hồ sơ của ứng dụng production.




## Điều hướng nghiệp vụ — bản làm việc hiện tại

### Quyết định thiết kế
Một sidebar ổn định rộng 252 px ở desktop, 236 px ở cửa sổ hẹp; không còn rail thứ hai, bộ chọn phân hệ lồng nhau hoặc catalogue chip cuộn ngang. Cá nhân gồm Tổng quan, Việc của tôi, Thông báo. Sáu nghiệp vụ mở trực tiếp: Dự án, Kế hoạch vốn, Giải ngân, Thanh toán, Nhà thầu, BI & báo cáo.

Mỗi phân hệ có nút đóng/mở riêng cho các lối tắt. Nhóm đã mở được giữ trong phiên, không tự đóng khi chọn nhóm khác. Chuyển route giữ khung trang và vị trí cuộn sidebar; đóng/mở nhóm không dựng lại nội dung hoặc xóa dữ liệu form đang nhập. Màn hình con giữ mục cha và đường quay lại. Tất cả chức năng mở danh mục đầy đủ của phân hệ; Tất cả ứng dụng mở thư viện có tìm kiếm trên 261 route web. Sáu nhóm cũ chỉ còn là cách tổ chức thư viện, không chiếm một thanh điều hướng thường trực.

### Cá nhân hóa và quản trị
Ngôi sao đầu trang ghim hoặc bỏ ghim route. Mục Đã ghim hỗ trợ đổi thứ tự, lưu localStorage và giữ sau tải trang. Quản trị & cấu hình nằm ở cuối sidebar, mở sáu phân hệ ADM, LLM, SAS, MDM, DGV, IAM. Prototype hiển thị phạm vi review đầy đủ; sản phẩm thật phải lọc menu theo quyền và kiểm quyền ở API.

### Notification Center
Hộp thông báo là danh sách và vùng đọc trong cùng một panel. Bộ lọc Tất cả/Chưa đọc/Cần xử lý, tìm không dấu, số chưa đọc đồng bộ sidebar; chọn thông báo mở nội dung và hành động liên quan. Không dùng bảng dữ liệu chung cho inbox. Bản mẫu có bốn thông báo; trạng thái đọc là dữ liệu phiên mô phỏng.

### Responsive và bàn phím
Web ≤980 px: sidebar thành drawer trái, thao tác mở/đóng có tên, Escape trả focus. ≤720 px: inbox chuyển sang danh sách hoặc chi tiết với nút quay lại. Smartphone giữ năm đích có icon và nhãn: Trang chủ, Dự án, Phê duyệt, Thông báo, Cá nhân. Tác vụ từ inbox smartphone đi tới route mobile. Thư viện và danh mục có tìm kiếm, focus ban đầu, vòng Tab và Escape. Ctrl/Cmd K là công cụ tìm màn hình phục vụ review; production cần tìm hồ sơ có phạm vi và quyền riêng.

### Thứ bậc thị giác
Nền trắng và xám ấm, đỏ ruby cho hành động và điểm chọn, emerald/amber cho trạng thái. Menu chính 14 px, menu ngữ cảnh 12 px, nội dung 14–16 px, tiêu đề 25–27 px. Thanh review 56 px desktop và 98 px mobile, header nghiệp vụ 54 px. Có trạng thái hover, selected, focus, disabled; chữ và icon đi cùng màu.

### Bằng chứng và giới hạn
Mapping giữ nguyên 261 route web và 66 route mobile. Xem navigation_architecture.json, workspace_navigation_qa.json, design_review_coverage.json. Tham chiếu nghiên cứu và hạng mục rà soát tại UX_Research_and_Review.html. Đây là prototype có dữ liệu minh họa, chưa phải kiểm thử người dùng hoặc chứng nhận WCAG.


## Theme & thương hiệu theo tenant — SAS-04

Chỉ System Admin được cấu hình thương hiệu cho các tenant: màu sắc, logo, menu, header, footer, tên hệ thống, địa chỉ và thông tin liên hệ. Tenant Admin chỉ được đọc cấu hình đã công bố của tenant mình, không được sửa, lưu nháp, tải logo, tạo review, áp dụng hoặc khôi phục. Các quyền quản trị nội bộ tenant khác không bao gồm quyền cấu hình thương hiệu.

Bản nháp tách biệt theo tenant và không thay đổi giao diện đang dùng. Xem trước web/smartphone trong vùng riêng; bước review hiển thị chênh lệch trước/sau, tenant đích và phiên bản gốc. Xác nhận áp dụng tạo phiên bản bất biến mới. Khôi phục cũng phải review và tạo phiên bản mới, giữ nguyên lịch sử. Kiểm tra trường bắt buộc, email, tệp logo và sáu cặp màu tương phản tối thiểu 4,5:1 trước khi công bố.

Server phải xác thực System Admin cho mọi lệnh ghi; không tin vai trò, tenant_id hoặc cờ quyền do trình duyệt gửi. Review gắn actor, tenant, hash nội dung, base version và hạn sử dụng. Kiểm tra lại quyền và phiên bản trong giao dịch công bố; trả 403 khi thiếu quyền, 409 khi xung đột, 422 khi cấu hình không hợp lệ. Audit ghi người thực hiện, tenant, bản trước/sau, lý do khôi phục và thời điểm; không ghi bí mật vào log.

Prototype SAS-04 dùng localStorage và bộ chọn vai trò mô phỏng để kiểm tra trải nghiệm. Đây không phải hệ thống xác thực hoặc cách ly tenant thật. Chi tiết triển khai và tiêu chí nghiệm thu nằm tại 03_Engineering/Tenant_Theme_Specification.html.


## Bàn giao UI cho đội phát triển
Giữ Ruby/Porcelain làm default, tenant tokens chỉ áp dụng sau publish. Menu cha không reload document, giữ DOM/scroll/focus/form; không tái lập dải catalogue ngang. Mỗi màn hình có loading/empty/error/denied/stale/conflict, keyboard labels, focus restore và responsive. Design_Board/prototype/327 exports là nguồn review giao diện; trạng thái demo không thay quyền server. SAS-04 dùng preview sandbox, diff trước/sau và rollback version mới; TC TH01–TH05,UX01 là điều kiện nghiệm thu.

Tài liệu điều phối: 09_Ke_hoach_trien_khai; 10_Ke_hoach_kiem_thu_va_chuyen_doi; 03_Engineering/Implementation_Backlog.html; 03_Engineering/Test_Case_Catalogue.html; 03_Engineering/Decision_Register.html.

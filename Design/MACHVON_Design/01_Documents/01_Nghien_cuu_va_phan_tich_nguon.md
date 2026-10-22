# Hệ Thống Lý Dự Án Đầu Tư Công nghiên cứu và phân tích nguồn
Baseline 1.3 | 22/10/2026 | Người đọc: chủ sản phẩm, chuyên gia nghiệp vụ, kiến trúc sư và đội thiết kế.

## Kết luận thiết kế
Hệ Thống Lý Dự Án Đầu Tư Công là tên đề xuất cho nền tảng điều hành đầu tư công có thể thương mại hóa dưới dạng SaaS. Trọng tâm là nối kế hoạch vốn, tiến độ, báo cáo, chứng từ và quyết định vào một chuỗi có thể truy vết. Tên chưa được tra cứu bảo hộ nhãn hiệu. Thiết kế mở rộng từ luồng báo cáo giải ngân PNE sang quản lý danh mục, thanh toán, nhà thầu, BI, đa kênh và quản trị nền tảng.

Tài liệu nguồn chỉ đủ xác nhận sâu phân hệ báo cáo tuần. Những phân hệ xuất hiện trên menu video được ghi nhận là có mục truy cập, không suy diễn rằng đã kiểm chứng đầy đủ chức năng. Thiết kế mới phân biệt ba cấp bằng chứng: quan sát trực tiếp, suy luận nghiệp vụ cần xác nhận, và tính năng mở rộng do người dùng yêu cầu.

## Phân tích PDF sáu trang
SRC-01 trang 1: danh sách báo cáo tuần có KPI kế hoạch năm, đã giải ngân, vốn còn lại, tiến độ kỳ báo cáo; bộ lọc năm, tuần, kế hoạch năm và dự án; xuất Excel, thêm mới, sửa, xem, xóa. Bảng có cuộn ngang, phân trang và dòng tổng. Thiết kế mới giữ nghiệp vụ nhưng dùng cột ghim, cấu hình cột và drill-down để giảm bề rộng mặc định.

SRC-02 trang 2: ví dụ lọc theo dự án và cách thêm báo cáo. Tổng trong bảng thay đổi theo kết quả lọc; KPI phía trên có thể dùng phạm vi khác. Hệ Thống Lý Dự Án Đầu Tư Công bắt buộc hiển thị scope của mỗi KPI, tránh ngầm hiểu tổng toàn tenant bằng tổng bảng đã lọc.

SRC-03 trang 3: khóa ngữ cảnh gồm năm, tuần, kế hoạch năm, dự án; có lưu và gửi tới Sở Tài chính. Thông tin dự án gồm tổng mức đầu tư, vốn giao trong năm, phần CTMTQG, đăng ký tháng này, lũy kế và tỷ lệ đạt đăng ký. Khối lượng thi công, nghiệm thu, đã gửi KBNN và hồ sơ đang hoàn thiện nằm riêng với lũy kế giải ngân. Mỗi nguồn vốn năm, kéo dài và khác tách NSTW/NSĐP; CTMTQG là trường “trong đó”. Đăng ký tháng sau có cấu trúc tương tự.

SRC-04 trang 4: màn hình chỉnh sửa có trạng thái đã gửi báo cáo và cho gửi lại. Chưa rõ quyền sửa, khóa kỳ và lịch sử. Thiết kế mới lưu bất biến bản đã gửi; yêu cầu chỉnh sửa tạo phiên bản kế tiếp, có lý do, so sánh và duyệt lại. Đây là đề xuất kiểm soát mới, không phải mô tả chức năng nguồn đã chứng minh.

SRC-05 trang 5: màn hình xem chi tiết khóa nhập và chỉ cho quay lại. SRC-06 trang 6: xác nhận xóa gồm Xóa/Hủy; thiếu ngữ cảnh đối tượng trong hộp thoại. Thiết kế mới nêu tên dự án, kỳ, trạng thái và lý do; chỉ xóa mềm bản nháp, hồ sơ đã gửi phải đi luồng điều chỉnh/thu hồi theo quyền.

## Phân tích video 86 giây
Tệp có 864 khung hình, 10 fps, kích thước 1340×576, thời lượng 86,4 giây. Phân tích hình ảnh qua khung hình cách 5 giây và xem lớn các mốc quan trọng; không coi đây là bản chép lời âm thanh.

VID-01 00:00: trang nguồn vốn và menu tra cứu, xếp hạng, nhập dữ liệu. VID-02 00:05–00:10: danh sách báo cáo tuần. VID-03 00:15–00:20: chọn kế hoạch, dự án. VID-04 00:25–00:45: nhập các khối lượng và hồ sơ. VID-05 00:50–00:55: phần đăng ký tháng sau. VID-06 01:00–01:10: trở lại danh sách, đổi tuần, xuất hiện dòng chưa gửi. VID-07 01:15–01:26: mở lại biểu mẫu và đi tới cuối trang.

Tại khoảng 01:10, khối lượng 45.000 hiển thị 203,8% so với vốn giao 22.083,571. Không đủ cơ sở kết luận đó là lỗi: khối lượng có thể khác phạm vi hoặc là lũy kế toàn dự án. Cần chốt định nghĩa kỳ và mẫu số; hệ thống mới cảnh báo kèm giải thích, không chặn mọi giá trị trên 100% bằng một quy tắc duy nhất.

Menu quan sát được bổ sung: thông tin dự án, kế hoạch vốn, kế hoạch ước giải ngân, thuyết minh tháng, khó khăn vướng mắc, xử lý vướng mắc, phân bổ theo quyết định, theo dõi dự án/tháng/kế hoạch/chủ đầu tư/tuần/Kho bạc, danh mục và quản trị. Các mục này đều có màn hình tương ứng trong catalogue, nhưng chi tiết quy trình là thiết kế đề xuất.

## So sánh sản phẩm và quyết định áp dụng
Oracle Primavera Unifier kết nối nguồn vốn, hợp đồng, thay đổi, chi phí và tiến độ. Hệ Thống Lý Dự Án Đầu Tư Công học cách liên kết cash flow với kế hoạch và chứng từ; bổ sung chuẩn kỳ báo cáo và cấu trúc vốn Việt Nam. Không sao chép giao diện hay giả định Unifier hỗ trợ sẵn báo cáo địa phương. Nguồn: https://www.oracle.com/construction-engineering/primavera-unifier-project-controls-asset-management/

Trimble Unity Construct, phát triển từ e-Builder, tập trung chủ đầu tư, quy trình, tài liệu, báo cáo và vòng đời chương trình vốn. Áp dụng version hồ sơ, workflow có cấu hình, và khả năng làm việc hiện trường. Nguồn: https://www.trimble.com/en/blog/construction/article/e-builder-enterprise-overview-a-solution-designed-for-owners

SAP Portfolio and Project Management hỗ trợ kết nối quản lý danh mục chiến lược với dự án vận hành. Áp dụng cổng thẩm định, tiêu chí ưu tiên và liên kết ngân sách với cấu trúc công việc; chỉ đề xuất tích hợp ERP qua hợp đồng dữ liệu cụ thể. Nguồn: https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/db719753e69f4e8eb9902aaea0fd8471/a396ed522ec19872e10000000a4450e5-295.html

Kahua trình bày quản lý chương trình vốn, nguồn tiền, chi phí, hợp đồng, kiểm soát và bàn giao tài sản. Áp dụng hồ sơ từ đầu tư tới tài sản, kiểm toán xuyên suốt và kết nối hiện trường. Thông tin công bố của nhà cung cấp là bằng chứng về khả năng quảng bá, không phải đánh giá độc lập chất lượng triển khai. Nguồn: https://kahua.com/

Power BI RLS là tham chiếu cho quyền dữ liệu tại lớp mô hình phân tích. Hệ Thống Lý Dự Án Đầu Tư Công tự xây lớp chỉ tiêu nhất quán và quyền theo tenant/đơn vị, không chỉ ẩn widget ở giao diện. Nguồn: https://learn.microsoft.com/power-bi/service-admin-rls

Novu dùng workflow để điều phối các bước thông báo. Knock có preference theo tenant và người dùng. Áp dụng trung tâm thông báo có phiên bản, điều kiện, lịch, chuyển cấp và lựa chọn kênh. Không coi một dịch vụ gửi email đơn thuần là Notification Center. Nguồn: https://docs.novu.co/platform/workflow/overview ; https://docs.knock.app/multi-tenancy/per-tenant-preferences

LiteLLM cung cấp tham chiếu về model gateway, routing, virtual key và budget. Langfuse cung cấp tham chiếu về token/cost và trace, prompt/evaluation. Hệ Thống Lý Dự Án Đầu Tư Công phân tách quản trị chính sách, kiểm thử và đối soát tiền, có thể tích hợp các thành phần này sau đánh giá vận hành. Nguồn: https://docs.litellm.ai/ ; https://docs.litellm.ai/docs/routing ; https://langfuse.com/docs/observability/features/token-and-cost-tracking ; https://langfuse.com/docs/prompt-management/overview

Stripe Billing là tham chiếu subscription/entitlement, không phải lựa chọn mặc định cho thu tiền tại Việt Nam. Cần adapter cổng thanh toán, chuyển khoản và hóa đơn điện tử được đơn vị lựa chọn. Nguồn: https://stripe.com/billing/features

## Giới hạn tích hợp và căn cứ cần chốt
Zalo OA cần OA/App và quyền phù hợp; webhook phản ánh sự kiện tương tác. Các loại tin, mẫu và giá phải cấu hình theo phiên bản chính sách; tài liệu hiện tại có đề cập ZBS. Không cố định tên thương mại cũ trong domain model. Nguồn: https://oa.zalo.me/home/documents/guides/Khoi-tao-ung-dung-va-cap-quyen_117071366476220195

WhatsApp dùng Business Platform, không tự động hóa tài khoản cá nhân. Trước triển khai phải kiểm chứng template, phiên hội thoại, consent và giới hạn trên tài khoản thực tế; chưa đủ bằng chứng trong lượt nghiên cứu để chốt toàn bộ chính sách hiện hành. Tham chiếu webhook do Meta công bố: https://www.postman.com/meta/whatsapp-business-platform/folder/lboq68h/webhooks

Email tích hợp OAuth/Graph hoặc nhà cung cấp SMTP được phê duyệt; notification webhook không đồng nghĩa thư đã đọc. Nguồn: https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview

Mức suy luận là khả năng theo model; không áp mọi giá trị effort cho mọi nhà cung cấp. Nguồn OpenAI chính thức đã đối chiếu: https://developers.openai.com/api/docs/guides/reasoning

Luật 58/2024/QH15 có hiệu lực 01/01/2025; nguồn hợp nhất công bố sửa đổi bởi Luật 90/2025/QH15. Nghị định 254/2025/NĐ-CP liên quan quản lý, thanh toán, quyết toán vốn đầu tư công. Đây là danh mục căn cứ ban đầu, không phải xác nhận đầy đủ mọi sửa đổi có hiệu lực ngày triển khai. Chủ nghiệp vụ/pháp chế phải chốt biểu mẫu, thẩm quyền, kỳ và quy tắc trước nghiệm thu. Nguồn: https://vanban.chinhphu.vn/?docid=212486&pageid=27160 ; https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2025/8/46002/58586-1-20251255-125696-vbhn-vpqh.pdf ; https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/9/254-cp.signed.pdf

## Câu hỏi nghiệp vụ và giả định quản lý
A01: giả định tenant là một tổ chức ký hợp đồng, bên trong có nhiều đơn vị và chủ đầu tư; cần chủ sản phẩm xác nhận. A02: lịch tuần trong demo không mặc định ISO week; lịch kỳ là dữ liệu cấu hình. A03: nguồn hiện hành của từng chỉ tiêu phải do data owner xác nhận. A04: API Kho bạc, chữ ký số, danh tính công vụ chưa được cung cấp; thiết kế adapter, không cam kết kết nối sẵn. A05: tiêu chí và thẩm quyền đánh giá nhà thầu do đơn vị nghiệp vụ ban hành. A06: quy mô, ngân sách, SLA thương mại và thời hạn lưu trữ chưa được chốt; các con số trong BRD là mục tiêu thiết kế để định cỡ và kiểm thử.


## Rà bổ sung toàn bộ clip và menu trái

Rà bổ sung toàn bộ clip bằng 87 khung hình cách nhau 1 giây, kết hợp xem lớn các mốc có thao tác. Bảng Video_Menu_Audit.html ghi 22 mục menu nguyên văn, thời điểm quan sát và màn hình mới tương ứng. Các mục kế hoạch ước giải ngân, theo dõi dự án tháng, theo dõi kế hoạch vốn, vướng mắc theo tuần và dự án Kho bạc được tách thành chức năng riêng. Danh mục và Quản lý hệ thống chưa mở menu con trong video: phạm vi MDM/ADM/SAS/DGV là thiết kế mở rộng, chưa được xác nhận là chức năng đang có. Mốc 00:56–00:57 chứng minh lưu báo cáo thành công; 01:06 vẫn chưa gửi, do đó lưu nháp và gửi chính thức có state và audit riêng. Video không chứng minh thao tác gửi hoàn tất.


## Kiểm soát nguồn cho triển khai
Bản PDF/clip và nghiên cứu thị trường là bằng chứng thiết kế; không là hợp đồng API hoặc bộ dữ liệu migration. Giữ nguyên các nhận định nguồn hiện có, không coi lần đồng bộ này là research mới. Mỗi yêu cầu giữ source trong catalogue; mapping dữ liệu thật, lịch báo cáo và basis cần D03/D04. Baseline triển khai1.3 dùng327 ID màn hình, không mở rộng phạm vi P2 ngầm.

Tài liệu điều phối: 09_Ke_hoach_trien_khai; 10_Ke_hoach_kiem_thu_va_chuyen_doi; 03_Engineering/Implementation_Backlog.html; 03_Engineering/Test_Case_Catalogue.html; 03_Engineering/Decision_Register.html.

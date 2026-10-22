# Hệ Thống Lý Dự Án Đầu Tư Công nghiên cứu và phân tích nguồn
Baseline 1.4 | 22/10/2026 | Người đọc: chủ sản phẩm, chuyên gia nghiệp vụ, kiến trúc sư và đội thiết kế.

Baseline 1.4 giữ nguyên toàn bộ phân tích nguồn của 1.3 (các mục từ "Kết luận thiết kế" tới "Kiểm soát nguồn cho triển khai") và bổ sung bốn mục nghiên cứu ở cuối tài liệu: pháp lý Việt Nam 2024–2026, hệ thống tham chiếu quốc tế, văn bản/báo cáo/quyết định theo chuẩn nhà nước, khoảng trống chức năng và scope bổ sung (D-B08, D-B09). Bản trình bày dạng bảng có liên kết nguồn: `03_Engineering/Market_Research.html`.

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


## Nghiên cứu pháp lý Việt Nam 2024–2026
Phạm vi: các văn bản chi phối vòng đời dự án đầu tư công, vốn, thanh toán/quyết toán, đấu thầu, giám sát, dữ liệu và an ninh mạng tại thời điểm 22/10/2026. Nguồn chủ yếu là thứ cấp (cổng văn bản, trang tóm tắt luật, cổng tỉnh); chưa đối chiếu đủ với Công báo. Mọi mục đánh dấu [CXN] là chờ xác nhận bởi chủ nghiệp vụ/pháp chế theo cơ chế sổ xác nhận pháp lý (R4): slice dùng quy tắc chưa xác nhận không được DONE. Văn bản đã có URL chính thức trong baseline 1.3 được trích lại; các văn bản còn lại chỉ ghi số hiệu, không ghi URL để tránh tạo nguồn giả.

### Danh mục văn bản và cách áp dụng
| Lĩnh vực | Văn bản (số hiệu) | Quan hệ thay thế/sửa đổi | Hiệu lực ghi nhận | Áp dụng vào thiết kế | Phân hệ |
|---|---|---|---|---|---|
| Đầu tư công | Luật Đầu tư công 58/2024/QH15 | sửa đổi bởi Luật 90/2025/QH15 | 01/01/2025 (Luật 58) | Nhóm dự án QTQG/A/B/C; vòng đời chủ trương → quyết định đầu tư → kế hoạch vốn → thực hiện → quyết toán | PRJ, CAP |
| Đầu tư công (hướng dẫn) | NĐ 85/2025/NĐ-CP | sửa đổi bởi NĐ 275/2025/NĐ-CP | [CXN] | Lập/giao/điều chỉnh/kéo dài kế hoạch vốn; trường `is_extended`, `extended_to`, văn bản cho phép kéo dài | CAP, DOC |
| Giám sát, đánh giá | NĐ 19/2026/NĐ-CP | sửa đổi bởi NĐ 96/2026/NĐ-CP; thay NĐ 29/2021/NĐ-CP | [CXN] | Báo cáo giám sát định kỳ theo mẫu; đánh giá sau đầu tư | MNE, DOC |
| Thanh toán, quyết toán | NĐ 254/2025/NĐ-CP | thay NĐ 99/2021/NĐ-CP; chuyển tiếp Điều 54 | [CXN] | Hồ sơ tạm ứng/thanh toán, mẫu 03.a, 04.a, 04.b, 05.a/TT; dữ liệu thời NĐ 99/2021 vẫn hợp lệ theo chuyển tiếp | PAY, CTR, DOC |
| Quyết toán dự án hoàn thành | TT 91/2025/TT-BTC | thay TT 96/2021/TT-BTC | [CXN] | Mẫu 01–05/QTNĐ, 01–12/QTDA; 10/QTDA là quyết định phê duyệt quyết toán | PAY, DOC, AST |
| Chương trình MTQG | NĐ 358/2025/NĐ-CP | — | [CXN] | Phần vốn CTMTQG là trường "trong đó" của dòng vốn, tách NSTW/NSĐP | CAP, DIS |
| Đấu thầu | Luật Đấu thầu 22/2023/QH15; NĐ 214/2025/NĐ-CP; TT 79/2025/TT-BTC | Luật 22/2023 sửa đổi bởi Luật 90/2025/QH15 | [CXN] | KHLCNT/KQLCNT là văn bản DOC; đánh giá năng lực nhà thầu (NĐ 214/2025 Điều 19–20) | BID, CTR, DOC |
| Ngân sách | Luật NSNN 89/2025/QH15 | — | [CXN] | Năm ngân sách, nguồn NSTW/NSĐP, gắn thanh toán với năm kế hoạch nguồn | CAP, PAY |
| Xây dựng, chất lượng | Luật Xây dựng 135/2025/QH15; NĐ 217/2026/NĐ-CP (thay NĐ 175/2024/NĐ-CP); NĐ 206/2026, 207/2026, 210/2026 | NĐ 06/2021/NĐ-CP → NĐ 207/2026 [CXN] | [CXN] | Nhật ký thi công điện tử, nghiệm thu, giấy phép xây dựng | QMS, PMT, CTR |
| Đất đai, GPMB | Luật Đất đai 2024; NĐ 88/2024/NĐ-CP | — | [CXN] | Mốc 90/180/30/30 ngày của bồi thường, hỗ trợ, tái định cư [CXN] | LND |
| Thanh tra | Luật Thanh tra 84/2025/QH15 | — | [CXN] | Kết luận, kiến nghị, theo dõi khắc phục | AUD |
| Bảo vệ dữ liệu cá nhân | Luật BVDLCN 91/2025/QH15; NĐ 356/2025/NĐ-CP | — | NĐ 356/2025: 01/01/2026 | ConsentRecord theo mục đích/kênh; DPO; đánh giá tác động xử lý và chuyển dữ liệu ra nước ngoài | IAM, NOT, OMNI, LND, LLM |
| Dữ liệu | Luật Dữ liệu 60/2024/QH15; NĐ 165/2025/NĐ-CP | — | [CXN] | Dữ liệu cốt lõi/quan trọng lưu tại Việt Nam trừ khi có đánh giá được duyệt → định tuyến AI theo phân loại (R5), hosting cloud nội địa (D-B03) | Toàn hệ thống, LLM |
| An ninh mạng | Luật An ninh mạng 116/2025/QH15 | — | 01/7/2026 | Lưu dữ liệu tại Việt Nam, ứng cứu sự cố, nhật ký an ninh | Hạ tầng, SAS |
| An toàn hệ thống thông tin | Văn bản thay NĐ 85/2016/NĐ-CP về cấp độ ATTT [CXN] | — | [CXN] | Hồ sơ đề xuất cấp độ (dự kiến cấp 3) trước go-live | Hạ tầng, SAS |
| Văn bản, lưu trữ, chữ ký số | NĐ 30/2020/NĐ-CP; Luật Lưu trữ 33/2024/QH15 + NĐ 113/2025/NĐ-CP; NĐ 23/2025/NĐ-CP | — | [CXN] | Xem mục "Văn bản, báo cáo, quyết định theo chuẩn nhà nước" | DOC |
| Điều hành giải ngân | Công điện 162/CĐ-TTg; CV 16437/BTC-ĐTPT; CV 3665/BTC-PTHT (2026); TT 37/2025/TT-BTC | — | [CXN] | Kế hoạch giải ngân tuần/tháng từng dự án, cảnh báo sớm, xếp hạng, đề xuất điều chuyển; báo cáo nhanh tuần | DIS, HOME, CAP |

Nguồn chính thức đã có URL (từ baseline 1.3): Luật 58/2024/QH15 https://vanban.chinhphu.vn/?docid=212486&pageid=27160 ; văn bản hợp nhất sau Luật 90/2025/QH15 https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2025/8/46002/58586-1-20251255-125696-vbhn-vpqh.pdf ; NĐ 254/2025/NĐ-CP https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/9/254-cp.signed.pdf.

### Quy tắc pháp lý chuyển thành thiết kế
- Quy tắc và mẫu biểu là dữ liệu: mỗi `rule_version`/`document_template` có `legal_basis`, `effective_from`, `effective_until`; bản ghi nghiệp vụ lưu ID phiên bản quy tắc đã áp dụng. Văn bản đổi giữa kỳ → tạo phiên bản mới, bản ghi cũ giữ quy tắc cũ (R4).
- Dự án: nhóm QTQG/A/B/C quyết định hạn thẩm tra quyết toán [CXN]; mã dự án trên Hệ thống thông tin quốc gia về đầu tư công là trường bắt buộc; quy tắc "không có mã trên hệ thống thì không giải ngân" [CXN].
- Vốn: dòng vốn có `plan_year`, nguồn (NSTW/NSĐP/CTMTQG/ODA), `is_extended`, `extended_to`, văn bản cho phép kéo dài; thanh toán gắn năm kế hoạch nguồn.
- Tạm ứng: chỉ sau hợp đồng có hiệu lực và có bảo lãnh tạm ứng; trần theo loại hợp đồng [CXN]; thu hồi hết khi thanh toán đạt 80% giá trị hợp đồng, tính theo từng thành viên liên danh; tạm ứng GPMB thu hồi trong 30 ngày; chặn vượt dự toán/giá trị hợp đồng; cảnh báo tạm ứng quá hạn.
- Giải ngân: hiển thị song song hai tỷ lệ (mẫu số kế hoạch Thủ tướng giao; mẫu số kế hoạch gồm phần địa phương giao thêm); thời điểm tính là ngày Kho bạc thanh toán [CXN, CV 16437/BTC-ĐTPT].
- Tích hợp: Hệ thống TTQG về ĐTC, muasamcong, dịch vụ công Kho bạc/TABMIS không có API công khai cho bên thứ ba → import/export tệp mẫu và đối soát sao kê; NDXP/LGSP chỉ đi qua LGSP của cơ quan khách hàng. Không giả định API.
- Bảo mật: hồ sơ cấp độ ATTT (dự kiến cấp 3) [CXN]; dữ liệu và bản sao lưu lưu tại Việt Nam; DPO, consent, đánh giá chuyển dữ liệu ra nước ngoài trước khi dùng LLM quốc tế.

### Mục chờ xác nhận (đề xuất ID cho sổ xác nhận pháp lý R4)
ID dưới đây là đề xuất; sổ chính thức (owner, bằng chứng, slice bị ảnh hưởng, trạng thái) nằm trong `03_Engineering/implementation_decisions.json` do O1 quản lý.

| ID đề xuất | Nội dung cần xác nhận | Owner (vai trò) | Bằng chứng cần | Phân hệ bị ảnh hưởng |
|---|---|---|---|---|
| CXN-01 | Quy tắc chặn giải ngân khi dự án chưa có mã trên Hệ thống TTQG về ĐTC | Chủ nghiệp vụ vốn | Văn bản gốc (Công báo/vbpl) | PRJ, PAY, DIS |
| CXN-02 | Trần tạm ứng theo loại hợp đồng; ngưỡng thu hồi 80% theo thành viên liên danh | Kế toán / Pháp chế | NĐ 254/2025 bản gốc | PAY, CTR |
| CXN-03 | Thời điểm tính giải ngân = ngày Kho bạc thanh toán (CV 16437/BTC-ĐTPT); hai mẫu số tỷ lệ | Chủ nghiệp vụ vốn | Công văn gốc | DIS, HOME, BI |
| CXN-04 | Văn bản thay NĐ 85/2016 về cấp độ ATTT và cấp độ áp dụng | Security / Pháp chế | Văn bản gốc + hướng dẫn hồ sơ | Hạ tầng, SAS |
| CXN-05 | Danh mục thời hạn lưu trữ cho hồ sơ dự án (TT 74/2025/TT-BTC, TT 10/2022 + TT 08/2025/TT-BNV) | Văn thư–lưu trữ / Pháp chế | Thông tư gốc + danh mục | DOC, toàn hệ thống (retention) |
| CXN-06 | Phiên bản QĐ 28/2018/QĐ-TTg và QCVN 102:2016 cho trục liên thông qua LGSP | Integration Lead | Văn bản gốc + đặc tả LGSP của khách hàng | DOC |
| CXN-07 | NĐ 207/2026 thay NĐ 06/2021 về quản lý chất lượng công trình | Chủ nghiệp vụ xây dựng | Văn bản gốc | QMS, CTR |
| CXN-08 | Mã và nội dung mẫu thanh toán NĐ 254/2025 (03.a, 04.a, 04.b, 05.a/TT; 27 mẫu) | Kế toán | Phụ lục gốc | PAY, DOC |
| CXN-09 | Mẫu quyết toán TT 91/2025 (01–05/QTNĐ, 01–12/QTDA) và hạn thẩm tra theo nhóm dự án | Kế toán / Chủ nghiệp vụ vốn | Thông tư gốc | PAY, DOC, AST |
| CXN-10 | Mẫu báo cáo giám sát 02–10 theo TT 44/2026/TT-BTC và kỳ báo cáo | Chủ nghiệp vụ vốn | Thông tư gốc | MNE, DOC |
| CXN-11 | Mẫu báo cáo giải ngân TT 37/2025/TT-BTC; báo cáo nhanh tuần CV 3665/BTC-PTHT | Chủ nghiệp vụ vốn | Văn bản gốc | DIS, DOC |
| CXN-12 | Mốc 90/180/30/30 ngày của bồi thường/hỗ trợ/TĐC; thu hồi tạm ứng GPMB trong 30 ngày | Chủ nghiệp vụ GPMB | Luật Đất đai 2024 + NĐ 88/2024 bản gốc | LND, PAY |
| CXN-13 | Hiệu lực và nội dung NĐ 85/2025 (sửa bởi NĐ 275/2025), NĐ 19/2026 (sửa bởi NĐ 96/2026), Luật Dữ liệu 60/2024 + NĐ 165/2025 | Pháp chế | Công báo | CAP, MNE, toàn hệ thống |

## Nghiên cứu hệ thống tham chiếu quốc tế
Mục đích: lấy mẫu năng lực thị trường đã dùng để định nghĩa scope và kiểm soát, không sao chép giao diện. Thông tin nhà cung cấp là bằng chứng về năng lực công bố, không phải đánh giá độc lập. Liên kết mới được kiểm tra bằng tra cứu ngày 22/10/2026; liên kết của baseline 1.3 giữ nguyên.

| Hệ thống/khung | Năng lực tham chiếu | Quyết định áp dụng cho MACHVON | Phân hệ | Nguồn |
|---|---|---|---|---|
| Oracle Primavera Unifier | Kiểm soát chi phí, nguồn vốn, hợp đồng của chủ đầu tư | FundSource → Appropriation → FundAssignment; revised ≥ committed; khóa ngân sách có lý do mở khóa; kiểm tra hạn mức khả dụng (AVC) ngưỡng warn/block; earmark | CAP | https://www.oracle.com/construction-engineering/primavera-unifier-project-controls-asset-management/ |
| Procore | Change Events → (Potential) Change Order → Commitment Change Order; số tầng cấu hình | Chuỗi ChangeEvent → PCO → CO, số tầng cố định sau lần dùng đầu; maker ≠ checker | CTR | https://support.procore.com/products/online/user-guide/project-level/change-events |
| SAP Portfolio and Project Management | Danh mục chiến lược ↔ dự án; cổng thẩm định | Vòng đời PIMA cho PRJ, chấm điểm thẩm định, ngân hàng dự án | PRJ | https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/db719753e69f4e8eb9902aaea0fd8471/a396ed522ec19872e10000000a4450e5-295.html |
| Oracle Aconex | Document register; transmittal không sửa/thu hồi sau khi gửi, lưu vĩnh viễn vào hồ sơ | Register hồ sơ dự án, transmittal bất biến, supersede phiên bản | DOC, PRJ | https://help.aconex.com/documents/transmit-your-document/ |
| IMF PIMA | 15 thiết chế qua 3 giai đoạn: lập kế hoạch, phân bổ, thực hiện | Vòng đời Concept → Appraisal → Pipeline → Budgeted → Implementation → Completed; đánh giá sau đầu tư | PRJ, MNE | https://infrastructuregovern.imf.org/content/PIMA/Home/PimaTool/What-is-PIMA.html |
| dbt Semantic Layer / MetricFlow | Metric định nghĩa trong mã, có version | Metric definition as code; mọi truy vấn BI có `as_of_period` | BI | https://docs.getdbt.com/docs/build/about-metricflow |
| Cube | Semantic layer, truy cập có kiểm soát | Query service chỉ nhận metric/dimension ID, không nhận SQL | BI | https://cube.dev/docs |
| Microsoft Power BI RLS | Row-level security ở mô hình phân tích | RLS mặc định đóng; kiểm quyền lại ở đích drill/export | BI, DGV | https://learn.microsoft.com/power-bi/service-admin-rls |
| Reltio | Match/merge, crosswalk, unmerge | Crosswalk; merge/unmerge đảo được; survivorship theo thuộc tính | MDM | https://docs.reltio.com/en/model/consolidate-data/unmerge-entity-records |
| Atlan / OpenMetadata | Glossary có workflow duyệt (Draft → In Review) | Glossary có reviewer và trạng thái duyệt | DGV | https://docs.open-metadata.org/v1.6.x/how-to-guides/data-governance/glossary/approval |
| Collibra | Quản trị dữ liệu doanh nghiệp | Tham chiếu vai trò owner/steward; chưa lưu tài liệu chi tiết | DGV | https://www.collibra.com/ |
| Open Data Contract Standard (Bitol) | Hợp đồng dữ liệu YAML: schema, chất lượng, owner, SLA | Data contract cho nguồn import và dataset BI | DGV, MDM | https://bitol-io.github.io/open-data-contract-standard/ |
| CMMI DMM (ISACA) | Mô hình trưởng thành quản lý dữ liệu; ISACA ngừng hỗ trợ DMM từ 01/2022, một phần nội dung đưa vào CMMI | Thang trưởng thành có evidence; ghi rõ DMM đã ngừng hỗ trợ | DGV | https://tdan.com/?p=30607 |
| EDM Council DCAM | 8 nhóm năng lực, tiêu chí đo | Bộ tiêu chí đánh giá trưởng thành bổ sung | DGV | https://edmcouncil.org/page/dcamassessmentsuppor |
| OC4IDS | Chuẩn công khai dữ liệu dự án/hợp đồng hạ tầng | Định dạng xuất cho cổng công khai/giám sát cộng đồng (Should) | MNE, PRJ | https://standard.open-contracting.org/infrastructure/latest/en/guidance/ |
| PowerSync | Sync rules với parameter query lấy từ JWT; client parameter không dùng để phân quyền | Bucket tham số theo tenant + membership từ JWT đã xác thực (A1) | MOB | https://docs.powersync.com/sync/rules/parameter-queries |
| LiteLLM / Langfuse | Gateway, routing, virtual key, budget; trace, cost, prompt version | Định tuyến theo `data_classification` (R5), FinOps, eval | LLM, BID | https://docs.litellm.ai/docs/routing ; https://langfuse.com/docs/observability/features/token-and-cost-tracking |
| OWASP Top 10 for LLM Applications 2025 | LLM01 Prompt Injection đứng đầu; nội dung truy xuất là đầu vào không tin cậy | Nội dung truy xuất là untrusted; allowlist tool; người duyệt cho mọi hành động ghi/tiền/quyết định | LLM, BID | https://genai.owasp.org/llm-top-10/ |
| Novu / Knock | Workflow thông báo; preference theo tenant | Trung tâm thông báo có version, digest, dedupe, preference | NOT | https://docs.novu.co/platform/workflow/overview ; https://docs.knock.app/multi-tenancy/per-tenant-preferences |
| Stripe Billing | Plan/subscription/entitlement/usage | Entitlement service nội bộ; hóa đơn qua nhà cung cấp Việt Nam | SAS | https://stripe.com/billing/features |

Ghi chú: Realm Device Sync đã ngừng 30/09/2025 nên bị loại khỏi lựa chọn offline (ghi nhận trong plan, chưa lưu URL nguồn).

## Văn bản, báo cáo, quyết định theo chuẩn nhà nước
Kết quả research ngày 22/10/2026 cho phân hệ DOC (D-B09). Các mã mẫu lấy từ nguồn thứ cấp và chờ xác nhận (CXN-08 … CXN-11).

| Nhóm | Căn cứ | Nội dung áp dụng | Đối tượng dữ liệu |
|---|---|---|---|
| Thể thức văn bản hành chính | NĐ 30/2020/NĐ-CP, Phụ lục I | Khổ A4, Times New Roman; lề trên 20–25 mm, lề dưới 20–25 mm, lề trái 30–35 mm, lề phải 15–20 mm; cỡ chữ theo từng thành phần; số văn bản từ 01 theo năm và tổ chức, cấp sau khi ký, không dùng hậu tố a/b; ký hiệu dạng {loại}-{cơ quan} | `DocumentTemplate` (renderer theo Phụ lục I, vị trí ảnh chữ ký/dấu), `DocumentNumberRegister` (tổ chức × năm, phạm vi cấu hình) |
| Lưu trữ | Luật Lưu trữ 33/2024/QH15; NĐ 113/2025/NĐ-CP | Lập hồ sơ, nộp lưu, thời hạn lưu trữ | `Dossier`, `RetentionPolicy` (dữ liệu, không code) |
| Thời hạn lưu trữ | TT 74/2025/TT-BTC; TT 10/2022/TT-BNV + TT 08/2025/TT-BNV [CXN-05] | Bảng thời hạn theo loại hồ sơ | `RetentionPolicy` |
| Chữ ký số | NĐ 23/2025/NĐ-CP; chữ ký số chuyên dùng công vụ là chế độ riêng | Lãnh đạo ký PAdES trên PDF cuối; văn thư cấp số/ngày bằng incremental update rồi ký số cơ quan; xác minh cả hai chữ ký và chuỗi chứng thư (R8) | `SignatureVerification` |
| Liên thông văn bản | QĐ 28/2018/QĐ-TTg; QCVN 102:2016 qua LGSP [CXN-06] | Gửi/nhận qua LGSP của cơ quan khách hàng, không kết nối trực tiếp | adapter PROPOSED |
| Báo cáo giám sát | NĐ 19/2026/NĐ-CP; TT 44/2026/TT-BTC (mẫu 02–10) [CXN-10] | Báo cáo giám sát, đánh giá đầu tư định kỳ | MNE + `DocumentTemplate` |
| Báo cáo giải ngân | TT 37/2025/TT-BTC; CV 3665/BTC-PTHT (2026) báo cáo nhanh tuần [CXN-11] | Mẫu báo cáo giải ngân, báo cáo tuần | DIS + DOC |
| Thanh toán | NĐ 254/2025/NĐ-CP (mẫu 03.a, 04.a, 04.b, 05.a/TT; 27 mẫu) [CXN-08] | Hồ sơ tạm ứng/thanh toán gửi Kho bạc | PAY + DOC |
| Quyết toán | TT 91/2025/TT-BTC (01–05/QTNĐ, 01–12/QTDA; 10/QTDA = QĐ phê duyệt quyết toán) [CXN-09] | Báo cáo và quyết định quyết toán | PAY + DOC |
| Đấu thầu | NĐ 214/2025/NĐ-CP | Quyết định KHLCNT, KQLCNT | BID + DOC |
| Xây dựng | Luật Xây dựng 135/2025/QH15; NĐ 217/2026 (thay 175/2024); NĐ 206/2026, 207/2026, 210/2026 | Biên bản nghiệm thu, giấy phép | QMS, PMT + DOC |

Danh mục loại văn bản DOC cần hỗ trợ: quyết định (chủ trương đầu tư, phê duyệt dự án, giao/điều chỉnh/kéo dài kế hoạch vốn, KHLCNT, KQLCNT, phê duyệt quyết toán); công văn (đôn đốc, đề nghị điều chuyển vốn, giải trình); báo cáo (giám sát, giải ngân, báo cáo nhanh tuần); hồ sơ thanh toán/quyết toán theo mẫu.

Vòng đời văn bản đi: DRAFT → IN_REVIEW → SUBMITTED → SIGNED → NUMBERED + ORG_SEALED → ISSUED → DELIVERED/ACK → FILED → ARCHIVED, kèm RECALLED/REPLACED/CORRECTED. Đường thứ hai (R8): tải lên PDF đã ký ngoài hệ thống → xác minh chữ ký/chứng thư → đăng ký số vào sổ → ISSUED. Văn bản đến: RECEIVED → REGISTERED → ASSIGNED → PROCESSING → RESOLVED → FILED. Cấp số dùng khóa hàng của sổ đăng ký trong transaction (không dùng sequence toàn cục) để hai văn thư đồng thời không nhận trùng số (P3). Đặc tả chi tiết thuộc `05_modules/DOC.md`.

## Khoảng trống chức năng và scope bổ sung
Kết quả research khoảng trống 22/10/2026 và quyết định tăng scope D-B08/D-B09 (không giảm scope; ID mới theo đuôi tiếp, ID cũ giữ nguyên). Baseline 1.4 thay câu "không mở rộng phạm vi P2 ngầm" của 1.3 bằng tăng scope công khai, có ghi quyết định.

### Phân hệ mới
| Mã | Tên | Mức ưu tiên research | Căn cứ chính | Phạm vi cốt lõi |
|---|---|---|---|---|
| DOC | Văn bản & báo cáo theo chuẩn nhà nước | Must | NĐ 30/2020, Luật Lưu trữ 33/2024, NĐ 23/2025 | Mẫu văn bản có `legal_basis`, sổ cấp số, ký số/đóng dấu (R8), văn bản đến, hồ sơ lưu trữ |
| LND | GPMB, bồi thường, hỗ trợ, tái định cư | Must | Luật Đất đai 2024, NĐ 88/2024 [CXN-12] | Diện tích, hộ, phương án, chi trả, khiếu nại; dữ liệu cá nhân theo Luật BVDLCN 91/2025 |
| PMT | Hồ sơ pháp lý & giấy phép dự án (plan gọi là LGL) | Must | GPMT/ĐTM, thẩm định, PCCC, GPXD | Mốc, hạn hiệu lực, cảnh báo hết hạn |
| QMS | Chất lượng công trình, nhật ký thi công điện tử, nghiệm thu (plan gọi là QLT) | Must | NĐ 06/2021 → NĐ 207/2026 [CXN-07] | Nhật ký, kiểm tra, biên bản nghiệm thu, ảnh geotag (Should: GIS) |
| AUD | Thanh tra, kiểm toán, đánh giá sau đầu tư | Must | Luật Thanh tra 84/2025 | Kết luận, kiến nghị, theo dõi khắc phục |
| AST | Bàn giao tài sản và bảo hành | Should | TT 91/2025 (quyết toán) [CXN-09] | Bàn giao, giữ lại bảo hành, theo dõi bảo hành |
| MNE | Giám sát, đánh giá đầu tư | Must | NĐ 19/2026; TT 44/2026 [CXN-10] | Báo cáo giám sát theo mẫu; giám sát cộng đồng/cổng công khai (Should, OC4IDS) |

### Mở rộng phân hệ hiện có
| Phân hệ | Bổ sung | Ưu tiên | Căn cứ |
|---|---|---|---|
| PRJ | Vòng đời PIMA, ngân hàng dự án, chấm điểm thẩm định, risk register; phân công người đứng đầu, tổ công tác, giải trình | Must (risk register: Should) | IMF PIMA; Công điện 162/CĐ-TTg |
| CAP | Earmark, AVC warn/block, đề xuất điều chuyển vốn chậm → nhanh, kế hoạch giải ngân tuần/tháng | Must | Primavera Unifier; Công điện 162/CĐ-TTg |
| DIS / HOME | Trung tâm điều hành giải ngân: xếp hạng theo đơn vị, cảnh báo sớm, hai tỷ lệ giải ngân, dự báo dòng tiền/EAC | Must | Công điện 162/CĐ-TTg; CV 16437/BTC-ĐTPT [CXN-03] |
| CTR / BID | ChangeEvent → PCO → CO; giữ lại bảo hành theo dòng; đánh giá năng lực nhà thầu | Must | Procore; NĐ 214/2025 Điều 19–20 |
| PAY | Sổ lũy kế hợp đồng × dòng BOQ × nghiệm thu, reversal (R7); import tệp Kho bạc idempotent (A3) | Must | NĐ 254/2025 |
| ADM | DoA matrix theo số tiền/loại/đơn vị; maker ≠ checker | Must | Primavera Unifier, Procore |
| BI | As-of period, PeriodSnapshot, metric as code | Must | dbt, Cube, Power BI |
| ISS | Liên kết vướng mắc GPMB/giấy phép, giải trình | Must | Công điện 162/CĐ-TTg |
| AI (LLM/BID) | Dự báo giải ngân, cờ bất thường thanh toán, OCR chứng từ, AI kiểm ảnh tiến độ | Could | Định tuyến theo R5 |

### Thứ tự thực hiện
R0 nền tảng (tenant/RLS/IAM/audit/outbox/entitlement tối thiểu/theme/shell/DOC engine) → R1 lát rộng 25 phân hệ ở mức tối thiểu dùng thật → R2 sâu hóa tài chính, GPMB, văn bản, BI drill → R3 tích hợp ngoài khi D05–D07 có hợp đồng → R4 hardening và UAT (D-B10). Kiến trúc chi tiết, sơ đồ phụ thuộc 25 phân hệ và quyết định nền tảng: `04_Thiet_ke_co_ban.md`.

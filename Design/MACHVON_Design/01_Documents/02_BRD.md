# Hệ Thống Lý Dự Án Đầu Tư Công yêu cầu nghiệp vụ BRD
Baseline 1.3 | 22/10/2026 | Phạm vi: web, iOS/Android, SaaS đa tenant. Chủ phê duyệt đề xuất: chủ sản phẩm, đại diện nghiệp vụ, quản trị dữ liệu, an toàn thông tin và tài chính thương mại.

## Mục tiêu kinh doanh và thước đo
BR-01: chuẩn hóa báo cáo từ dự án tới điều hành; mục tiêu thử nghiệm giảm ít nhất 40% thời gian lập báo cáo so với baseline đo trong hai kỳ đầu. BR-02: truy vết 100% chỉ tiêu được công bố tới định nghĩa, phạm vi và dữ liệu gốc được phép xem. BR-03: kiểm soát phiên bản và thẩm quyền; không có cập nhật âm thầm hồ sơ đã gửi. BR-04: hỗ trợ điện thoại cho nhập nháp, hiện trường, phê duyệt và phản hồi. BR-05: vận hành SaaS, tenant, branding, license và chi phí có thể đối soát. BR-06: giảm thao tác lặp bằng AI và thông báo, có người chịu trách nhiệm cho quyết định.

Mục tiêu nghiệm thu đề xuất: ít nhất 95% báo cáo đúng hạn trong pilot; 100% giao dịch thay đổi trạng thái có audit; 0 truy cập chéo tenant trong bộ kiểm thử bắt buộc; 100% kết luận AI quan trọng có dẫn chứng hoặc ghi rõ thiếu bằng chứng; mọi số tiền sử dụng decimal chính xác. Các tỷ lệ này là tiêu chí đề xuất, chưa phải kết quả thực tế đã đo.

## Đối tượng và phân vai
Lãnh đạo: xem tiến độ, drill-down, giao xử lý và phê duyệt trong phạm vi thẩm quyền. Sở Tài chính/chuyên viên tổng hợp: quản lý kỳ, kế hoạch, kiểm tra, trả lại và tổng hợp. Chủ đầu tư/Ban QLDA: cập nhật dự án, nhập báo cáo, chứng từ, vướng mắc và phối hợp. Kế toán: đề nghị thanh toán, tạm ứng, thu hồi, đối soát. Tổ chuyên gia: chốt tiêu chí, kiểm chứng AI, đánh giá và lập biên bản. Thanh tra/kiểm toán: xem dữ liệu được cấp, lịch sử và bản xuất có nguồn.

Tenant owner: quản lý thông tin hợp đồng và đề nghị thay đổi gói/license/thương hiệu; không tự cấu hình branding hoặc cấp/gia hạn license. System Admin: cấu hình tenant, thương hiệu và cấp license theo quyền hệ thống. Tenant admin: người dùng, tổ chức, workflow và tích hợp, không mặc nhiên đọc mọi hồ sơ mật. AI admin: model/profile/prompt, không tự thông qua hồ sơ nhà thầu. FinOps: chi phí AI/kênh/SaaS. Platform operator: sức khỏe hạ tầng và metadata tối thiểu; truy cập nội dung tenant cần ticket, đồng ý, giới hạn thời gian và audit. Nhà thầu là đối tượng hồ sơ; cổng đăng nhập nhà thầu độc lập là hướng mở rộng chưa nằm trong baseline 327 màn hình.

## Phạm vi chức năng và sản phẩm
P0 pilot gồm truy cập, dự án, kế hoạch năm, báo cáo tuần/tháng, vướng mắc, notification in-app/email/push và quản trị cơ bản. P1 mở rộng gồm thanh toán/Kho bạc theo API khả dụng, nhà thầu/AI, BI động, đa kênh, LLM governance, SaaS, branding, billing và license. Nền tảng tenant isolation và entitlement phải tồn tại từ P0; việc xếp phân hệ thương mại vào P1 chỉ nói thời điểm khai thác, không trì hoãn ranh giới bảo mật.

P2 roadmap: GIS thực, BIM/IoT, danh mục hiệu quả đầu tư sau bàn giao, mô phỏng danh mục nâng cao, cổng nhà thầu/công khai, bản ứng dụng white-label riêng, marketplace connector. Không coi P2 là đã có mockup đầy đủ trong baseline. Các màn hình bàn giao và quyết toán cơ bản đã nằm trong P1.

Không bao gồm trong gói thiết kế: phần mềm production, API Kho bạc đang hoạt động, ứng dụng đã ký/cài lên App Store/Google Play, chứng nhận pháp lý, tài khoản kênh được duyệt và dịch vụ thanh toán thật. Prototype dùng dữ liệu minh họa, không phát sinh tin nhắn hay phí LLM thật.

## Chuỗi nghiệp vụ mục tiêu
Lập/nhập dự án → thẩm định và quyết định → phân bổ nguồn theo năm → đăng ký giải ngân tháng → báo cáo tuần → kiểm tra và phản hồi → xác nhận/tổng hợp → điều hành và xử lý vướng mắc → nghiệm thu/thanh toán/đối soát → quyết toán/bàn giao. Mỗi bước có người sở hữu, phiên bản, hạn xử lý và bằng chứng. Quy trình có thể cấu hình theo tenant nhưng không được vô hiệu hóa cách ly dữ liệu, audit hoặc nguyên tắc phân tách nhiệm vụ.

Đối với nhà thầu: bộ tiêu chí được duyệt → tiếp nhận và khóa phiên bản đề án → OCR kiểm chứng → phân tích AI → so sánh có nguồn → chuyên gia kiểm tra → làm rõ → biên bản → phê duyệt có thẩm quyền. AI không tự loại nhà thầu hoặc sửa trọng số để thay đổi kết quả.

Đối với SaaS: tạo tenant → xác minh owner/domain → cấp gói và license → cấu hình nhận diện/tích hợp → vận hành/đo usage → hóa đơn/đối soát → gia hạn/nâng hạ gói → kết thúc/xuất dữ liệu/lưu trữ theo hợp đồng. Trạng thái thanh toán, tenant, subscription và license là bốn đối tượng riêng.

## Quy tắc kinh doanh trọng yếu
BR-R01: tách nguồn vốn năm, kéo dài, khác và ngân sách trung ương/địa phương; phần CTMTQG là tập con. BR-R02: lũy kế tuần là snapshot, không cộng nhiều snapshot. BR-R03: số tiền ghi nhận phải có đơn vị, nguồn và kỳ. BR-R04: người tạo không tự duyệt hồ sơ yêu cầu maker-checker. BR-R05: hồ sơ đã gửi không xóa vật lý; điều chỉnh có phiên bản. BR-R06: không có số liệu được công bố mà không biết grain, định nghĩa, nguồn và độ mới.

BR-R07: tenant admin không tăng gói quyền vượt license; feature flag chỉ có thể tắt thêm, không tự cấp quyền. BR-R08: dùng vượt ngân sách AI phải bị chặn trước khi gọi hoặc theo hạn mức phát sinh đã duyệt, không chỉ cảnh báo sau khi tốn tiền. BR-R09: gửi tin phải xét mục đích, consent, giới hạn kênh và phân loại dữ liệu. BR-R10: mở sâu từ KPI luôn giữ scope và snapshot; dữ liệu không đủ quyền được giải thích bằng trạng thái phù hợp, không làm lộ tên hồ sơ.

## Gói SaaS và thương hiệu
Gói Starter đề xuất có dự án/báo cáo/thông báo cơ bản; Professional thêm BI và workflow; Enterprise thêm AI/omnichannel/SSO, quota cao và SLA thỏa thuận; Private dành cho hạ tầng/cơ sở dữ liệu riêng. Tên gói và giá chưa chốt. Quyền thực tế được cấu hình bằng entitlement gồm module, action, hạn mức, ngày hiệu lực, grace và điều kiện hợp đồng; không hard-code tên gói trong mã nghiệp vụ.

Thương hiệu gồm logo sáng/tối, palette đã kiểm tra tương phản, tên, favicon, login cover, email sender/template, tên miền xác minh và tài liệu xuất. Mobile dùng chung ứng dụng, nhận diện tenant sau chọn tổ chức; icon ứng dụng và tên trên cửa hàng không thay đổi tùy ý theo từng tenant. App white-label riêng cần quy trình build, ký và phát hành riêng.

## Yêu cầu chất lượng và định cỡ
Mô hình tải ban đầu để kiểm thử: 100 tenant, 50.000 dự án toàn nền tảng, 5.000 người dùng đồng thời, 20 triệu dòng giao dịch/snapshot theo chính sách lưu trữ. Đây là giả định cần đo lại. API đọc phổ biến p95 ≤ 800 ms; màn hình nghiệp vụ p95 ≤ 2,5 s trên môi trường kiểm thử đã công bố; BI thông dụng ≤ 5 s với dữ liệu tổng hợp; job nặng xử lý bất đồng bộ. SLO mục tiêu dịch vụ lõi 99,9%/tháng; RPO ≤ 15 phút, RTO ≤ 4 giờ cho cấu hình tiêu chuẩn, điều chỉnh theo hợp đồng.

Tiếng Việt đầy đủ dấu, định dạng số/ngày theo locale; tương phản mục tiêu WCAG AA; keyboard và screen reader cho luồng lõi. Hỗ trợ portrait smartphone, text scaling và reconnect. Không suy ra “đã đọc” từ push accepted. Dữ liệu nhạy cảm không nằm trong push lock-screen hoặc email công khai.

## Triển khai và điều kiện ra mắt
Giai đoạn 0 chốt định nghĩa, mapping nguồn cũ, danh mục quyền và căn cứ pháp lý. Giai đoạn 1 pilot một tenant, một nhóm dự án và hai chu kỳ báo cáo song song. Giai đoạn 2 mở rộng mobile, đối soát và BI. Giai đoạn 3 thương mại hóa SaaS, AI và kênh ngoài sau khi hoàn thành kiểm thử cách ly, chi phí và phê duyệt tài khoản. Ước lượng lịch/chi phí xây dựng cần đội kỹ thuật và quy mô tích hợp; chưa dùng số màn hình để suy ra ngày công chính xác.

Go-live yêu cầu: ký chốt BRD/FRD, kiểm thử hồi quy và an toàn, đối soát dữ liệu nguồn, diễn tập khôi phục, cơ chế hỗ trợ, tài liệu người dùng và owner của từng chỉ tiêu. Dùng thử tối thiểu hai kỳ có dữ liệu thật đã được cho phép; chỉ kết thúc dual-run khi tổng, kỳ, CTMTQG và số xác nhận khớp hoặc sai lệch có phê duyệt.


## Theme & thương hiệu theo tenant — SAS-04

Chỉ System Admin được cấu hình thương hiệu cho các tenant: màu sắc, logo, menu, header, footer, tên hệ thống, địa chỉ và thông tin liên hệ. Tenant Admin chỉ được đọc cấu hình đã công bố của tenant mình, không được sửa, lưu nháp, tải logo, tạo review, áp dụng hoặc khôi phục. Các quyền quản trị nội bộ tenant khác không bao gồm quyền cấu hình thương hiệu.

Bản nháp tách biệt theo tenant và không thay đổi giao diện đang dùng. Xem trước web/smartphone trong vùng riêng; bước review hiển thị chênh lệch trước/sau, tenant đích và phiên bản gốc. Xác nhận áp dụng tạo phiên bản bất biến mới. Khôi phục cũng phải review và tạo phiên bản mới, giữ nguyên lịch sử. Kiểm tra trường bắt buộc, email, tệp logo và sáu cặp màu tương phản tối thiểu 4,5:1 trước khi công bố.

Server phải xác thực System Admin cho mọi lệnh ghi; không tin vai trò, tenant_id hoặc cờ quyền do trình duyệt gửi. Review gắn actor, tenant, hash nội dung, base version và hạn sử dụng. Kiểm tra lại quyền và phiên bản trong giao dịch công bố; trả 403 khi thiếu quyền, 409 khi xung đột, 422 khi cấu hình không hợp lệ. Audit ghi người thực hiện, tenant, bản trước/sau, lý do khôi phục và thời điểm; không ghi bí mật vào log.

Prototype SAS-04 dùng localStorage và bộ chọn vai trò mô phỏng để kiểm tra trải nghiệm. Đây không phải hệ thống xác thực hoặc cách ly tenant thật. Chi tiết triển khai và tiêu chí nghiệm thu nằm tại 03_Engineering/Tenant_Theme_Specification.html.


## Quản lý phạm vi và phê duyệt baseline
System Admin độc quyền cấu hình tenant/branding và cấp license; tenant owner đề nghị thay đổi/hợp đồng, không tự áp dụng theme hoặc gia hạn. Foundation đưa tenant isolation/entitlement/theme review vào sớm, thương mại hóa nâng cao theo G4. Lịch G0–G5 và nguồn lực trong09_Ke_hoach_trien_khai là giả định cần phê duyệt; mức9–10/10 vẫn là mục tiêu cần pilot/evidence.

Tài liệu điều phối: 09_Ke_hoach_trien_khai; 10_Ke_hoach_kiem_thu_va_chuyen_doi; 03_Engineering/Implementation_Backlog.html; 03_Engineering/Test_Case_Catalogue.html; 03_Engineering/Decision_Register.html.

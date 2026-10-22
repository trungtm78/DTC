# Hệ Thống Lý Dự Án Đầu Tư Công yêu cầu nghiệp vụ BRD
Baseline 1.4 | 22/10/2026 | Phạm vi: web, iOS/Android (Flutter), SaaS đa tenant, 25 phân hệ nghiệp vụ. Chủ phê duyệt đề xuất: chủ sản phẩm, đại diện nghiệp vụ, quản trị dữ liệu, an toàn thông tin và tài chính thương mại. (Cập nhật 1.4 — CR-BRD-01)

(Bổ sung 1.4 — CR-BRD-00) Quy ước baseline 1.4: tài liệu này là baseline 1.3 được sửa tại chỗ. Đoạn không có nhãn là nguyên văn baseline 1.3 và vẫn đúng; đoạn có nhãn "(Cập nhật 1.4 — CR-BRD-nn)" là đoạn baseline được sửa theo quyết định; đoạn có nhãn "(Bổ sung 1.4 — CR-BRD-nn)" là nội dung mới. Đoạn baseline bị bỏ được liệt kê ở "Phụ lục: ánh xạ nội dung baseline 1.3". Mọi mã đã phát hành (BR-01..06, BR-R01..R10, mã màn hình, mã test) giữ nguyên; mã mới nối tiếp (BR-07+, BR-R11+). Khi BRD mâu thuẫn với `04_Thiet_ke_co_ban.md` về tenant, ranh giới module, stack, RLS, SLO/RTO, tích hợp hoặc tên vai trò thì tài liệu 04 thắng. Nhãn **[CXN]** là căn cứ pháp lý hoặc con số chưa đối chiếu văn bản gốc (Công báo, cơ sở dữ liệu quốc gia về văn bản pháp luật), quản lý trong sổ xác nhận pháp lý (`Decision_Register.html`, `implementation_decisions.json`); slice dùng quy tắc [CXN] chưa xác nhận không được tính là hoàn thành (R4). **[GIẢ ĐỊNH]** là đề xuất chờ đo hoặc chốt; **CHỜ KÝ** là định nghĩa cần chủ nghiệp vụ ký (D03, D04).

## Mục tiêu kinh doanh và thước đo
BR-01: chuẩn hóa báo cáo từ dự án tới điều hành; mục tiêu thử nghiệm giảm ít nhất 40% thời gian lập báo cáo so với baseline đo trong hai kỳ đầu. BR-02: truy vết 100% chỉ tiêu được công bố tới định nghĩa, phạm vi và dữ liệu gốc được phép xem. BR-03: kiểm soát phiên bản và thẩm quyền; không có cập nhật âm thầm hồ sơ đã gửi. BR-04: hỗ trợ điện thoại cho nhập nháp, hiện trường, phê duyệt và phản hồi. BR-05: vận hành SaaS, tenant, branding, license và chi phí có thể đối soát. BR-06: giảm thao tác lặp bằng AI và thông báo, có người chịu trách nhiệm cho quyết định.

(Bổ sung 1.4 — CR-BRD-01) Mục tiêu theo phạm vi mở rộng (D-B04, D-B09): BR-07: soạn, trình, ký, cấp số, phát hành và lưu hồ sơ văn bản, báo cáo, quyết định, công văn theo thể thức nhà nước ngay trong hệ thống (DOC), không để số liệu và văn bản tách rời. BR-08: mọi quy tắc tính toán và mẫu biểu có căn cứ pháp lý là dữ liệu có phiên bản và hiệu lực (`legal_basis`, `effective_from/until`), để văn bản đổi không phải sửa mã. BR-09: tăng tốc giải ngân bằng điều hành trên cùng một snapshot: cảnh báo sớm, xếp hạng đơn vị, giải trình, điều chuyển vốn từ dự án chậm sang dự án nhanh, kế hoạch tuần/tháng từng dự án. BR-10: bao phủ vòng đời đầu tư từ chủ trương tới bàn giao tài sản và bảo hành, gồm GPMB, giấy phép, chất lượng thi công, thanh tra/kiểm toán và giám sát đánh giá pháp định. BR-11: dùng AI mà không đưa dữ liệu mật, quan trọng hoặc cá nhân ra ngoài lãnh thổ Việt Nam; dữ liệu và bản sao lưu lưu tại Việt Nam (D-B03, R5).

Mục tiêu nghiệm thu đề xuất: ít nhất 95% báo cáo đúng hạn trong pilot; 100% giao dịch thay đổi trạng thái có audit; 0 truy cập chéo tenant trong bộ kiểm thử bắt buộc; 100% kết luận AI quan trọng có dẫn chứng hoặc ghi rõ thiếu bằng chứng; mọi số tiền sử dụng decimal chính xác. Các tỷ lệ này là tiêu chí đề xuất, chưa phải kết quả thực tế đã đo.

(Bổ sung 1.4 — CR-BRD-02) Mục tiêu "10/10" của sản phẩm (D-B06) được diễn giải thành tiêu chí đo ở pilot: SUS ≥ 80; ≥ 90% tác vụ lõi hoàn thành không trợ giúp; 0 lỗi nhập liệu trọng yếu; 100% case critical (tiền, cách ly tenant, khôi phục) đạt; WCAG 2.2 AA cho luồng lõi. KPI gắn với release R0–R4:

| KPI | Mục tiêu | Đo ở | Release đo |
|---|---|---|---|
| Báo cáo đúng hạn | ≥ 95% | Hai kỳ báo cáo song song của pilot | Pilot (sau R1) |
| Giảm thời gian lập báo cáo | ≥ 40% so baseline hai kỳ đầu | Pilot, so hệ thống hiện hữu | Pilot |
| Truy cập chéo tenant | 0 | Bộ test cách ly bắt buộc (API, DB, cache, tìm kiếm, vector, file, export, đồng bộ mobile), mỗi PR | R0 trở đi |
| Giao dịch đổi trạng thái có audit | 100% | Kiểm tra audit/outbox cùng transaction | R0 trở đi |
| Tiền đúng số | 0 sai lệch ngoài tolerance trên fixture golden | Fixture golden CHỜ KÝ (D03) + đối soát pilot | R1, R2, pilot |
| Kết luận AI có dẫn chứng | 100% kết luận quan trọng | Bộ eval do chuyên gia ký (D07) | R3 |
| SUS và tác vụ lõi | SUS ≥ 80; ≥ 90% hoàn thành | Pilot với người dùng thật | Pilot, R4 |
| Case critical | 100% đạt | `UAT-COVERAGE.md` | R4 |
| Khả dụng dịch vụ lõi | 99,9% theo cửa sổ 30 ngày | Quan sát sau go-live | Sau go-live |

## Đối tượng và phân vai
(Bổ sung 1.4 — CR-BRD-04) **Định nghĩa tenant (R6, D9).** Tenant là cơ quan chủ quản ký hợp đồng dịch vụ: một UBND tỉnh/thành phố trực thuộc trung ương hoặc một bộ/ngành (hoặc cơ quan trung ương khác). Tenant là ranh giới cách ly dữ liệu và ranh giới thương mại (hợp đồng, gói, license, thương hiệu). Sở, ban quản lý dự án, chủ đầu tư và UBND xã/phường là đơn vị tổ chức (`organization_unit`) trong tenant, thành cây có hiệu lực theo thời gian và đơn vị kế thừa; quyền cấp theo phạm vi (toàn tenant, cây đơn vị, dự án, hợp đồng), không theo cấp hành chính cứng. Hệ quả: tổng hợp toàn tỉnh, xếp hạng giải ngân và điều chuyển vốn giữa dự án chạy trong một tenant; báo cáo lên cơ quan cấp trên đi qua văn bản DOC hoặc xuất tệp, không đọc chéo tenant; chuyển dự án giữa đơn vị trong tenant là lệnh có audit, giữa tenant là export/import có audit và xác nhận của hai System Admin; nhà thầu là tài khoản khách (guest membership) chỉ thấy hợp đồng của mình; một người có thể thuộc nhiều tenant nhưng mỗi phiên chỉ có một tenant đang hoạt động. Pilot là một tenant, tức một cơ quan chủ quản với nhiều đơn vị bên trong.

Lãnh đạo: xem tiến độ, drill-down, giao xử lý và phê duyệt trong phạm vi thẩm quyền. Sở Tài chính/chuyên viên tổng hợp: quản lý kỳ, kế hoạch, kiểm tra, trả lại và tổng hợp. Chủ đầu tư/Ban QLDA: cập nhật dự án, nhập báo cáo, chứng từ, vướng mắc và phối hợp. Kế toán: đề nghị thanh toán, tạm ứng, thu hồi, đối soát. Tổ chuyên gia: chốt tiêu chí, kiểm chứng AI, đánh giá và lập biên bản. Thanh tra/kiểm toán: xem dữ liệu được cấp, lịch sử và bản xuất có nguồn.

Tenant Owner: quản lý thông tin hợp đồng và đề nghị thay đổi gói/license/thương hiệu; không tự cấu hình branding hoặc cấp/gia hạn license. System Admin: cấu hình tenant, thương hiệu và cấp license theo quyền hệ thống. Tenant Admin: người dùng, cây đơn vị, workflow và tích hợp, không mặc nhiên đọc mọi hồ sơ mật. AI Admin: model/profile/prompt, không tự thông qua hồ sơ nhà thầu. Billing Admin (FinOps): chi phí AI/kênh/SaaS. Platform Operator: sức khỏe hạ tầng và metadata tối thiểu; truy cập nội dung tenant cần ticket, đồng ý, giới hạn thời gian và audit. Nhà thầu là đối tượng hồ sơ và, khi được mời, là Contractor Guest trong ứng dụng web/mobile chung với phạm vi hợp đồng của mình; cổng nhà thầu độc lập và cổng công khai là hướng mở rộng ngoài R0–R4. (Cập nhật 1.4 — CR-BRD-03)

(Bổ sung 1.4 — CR-BRD-03) **Thuật ngữ vai trò.** Tên chuẩn lấy từ mục "Thuật ngữ vai trò" của `04_Thiet_ke_co_ban.md` và dùng thống nhất trong BRD, FRD, đặc tả phân hệ, OpenAPI và mã; bảng dưới là tóm tắt.

| Tên chuẩn | Phạm vi | Làm được | Không làm được | Tên cũ/biến thể thay thế |
|---|---|---|---|---|
| System Admin | Control plane, mọi tenant qua tenant đích | Provisioning tenant, thương hiệu (SAS-04), cấp/gia hạn license, hóa đơn thuê bao | Đọc nội dung nghiệp vụ tenant; bỏ qua RLS | SystemAdmin, Platform admin |
| Platform Operator | Hạ tầng, metadata tối thiểu | Xem health, vận hành, DR | Truy cập nội dung tenant trừ break-glass | Platform operator, platform support |
| Tenant Owner | Một tenant (hợp đồng) | Xem hợp đồng; đề nghị đổi gói/license/thương hiệu | Tự cấu hình thương hiệu; tự cấp/gia hạn license | tenant owner |
| Tenant Admin | Một tenant | Người dùng, cây đơn vị, role grant, workflow, tích hợp | Sửa thương hiệu; đọc hồ sơ mật khi không có grant; cấp quyền vượt quyền mình | TenantAdmin, Tenant admin |
| Billing Admin (FinOps) | Một tenant | Thuê bao, usage, hóa đơn, chi phí AI/kênh | Đọc đề án, hồ sơ nghiệp vụ | FinOps, Billing admin |
| AI Admin | Một tenant | Publish model/profile/prompt qua review, ngân sách AI | Quyết định kết quả thầu | AI admin |
| Auditor | Scope được cấp, chỉ đọc | Đọc, xuất có nguồn, xem lịch sử và audit | Mọi lệnh ghi | Thanh tra/kiểm toán (khi chỉ đọc), kiểm toán viên |
| Data Protection Officer | Một tenant | Consent, yêu cầu của chủ thể dữ liệu, đánh giá tác động | Sửa dữ liệu nghiệp vụ | (mới, Luật BVDLCN 91/2025) |
| Data Owner / Data Steward | Domain dữ liệu | Duyệt data contract, DQ, glossary, merge master data | Duyệt thay đổi do chính mình đề nghị | data owner, steward |
| Contractor Guest | Hợp đồng của mình | Nộp hồ sơ, xem trạng thái hợp đồng của mình | Xem dự án, vốn, nhà thầu khác | nhà thầu |

Vai trò nghiệp vụ (chủ đầu tư, chuyên viên Sở Tài chính, lãnh đạo, kế toán, văn thư, tổ chuyên gia) được định nghĩa trong đặc tả phân hệ và luôn bị giới hạn bởi tenant boundary, scope grant và phân loại dữ liệu.

## Phạm vi chức năng và sản phẩm
(Bổ sung 1.4 — CR-BRD-01) Baseline 1.4 gồm **25 phân hệ**: 18 phân hệ của baseline 1.3 (SAS, IAM, LLM, ADM, MDM, DGV, PRJ, CAP, ISS, BID, CTR, PAY, DIS, BI, HOME, NOT, OMNI, MOB) và 7 phân hệ mới (D-B09): **DOC** văn bản, báo cáo, quyết định, công văn theo chuẩn nhà nước; **LND** giải phóng mặt bằng, bồi thường, hỗ trợ, tái định cư; **PMT** hồ sơ pháp lý và giấy phép dự án; **QMS** chất lượng công trình, nhật ký thi công điện tử, nghiệm thu; **AUD** thanh tra, kiểm toán và theo dõi khắc phục; **AST** bàn giao tài sản và bảo hành; **MNE** giám sát, đánh giá đầu tư theo mẫu pháp định. Phân hệ cũ được mở rộng: PRJ theo vòng đời PIMA (Concept → Appraisal → Pipeline → Budgeted → Implementation → Completed → Settled → Closed) và chấm điểm thẩm định; CAP với earmark, kiểm soát hạn mức khả dụng, đề xuất điều chuyển; DIS/HOME với hai tỷ lệ giải ngân, cảnh báo sớm, xếp hạng, trung tâm điều hành; CTR với chuỗi thay đổi hợp đồng và giữ lại bảo hành; ADM với ma trận thẩm quyền (DoA) và maker ≠ checker; BI với as-of kỳ; MDM/DGV với crosswalk, data contract, incident chất lượng và đánh giá trưởng thành có bằng chứng. Nguyên tắc (D-B01, D-B04): phủ rộng 25 phân hệ ở "mức tối thiểu dùng thật" trước, sâu hóa theo giá trị sau; không giảm phạm vi, được tăng phạm vi và đổi trình tự; luồng tài chính (CAP, DIS, PAY) phải đúng số dù nông. Mức tối thiểu từng phân hệ nằm ở mục 12 của `05_modules/<MÃ>.md` và được PO duyệt trước R1. `screen_catalog.json` là nguồn duy nhất của danh mục màn hình; 327 màn hình baseline 1.3 giữ mã, màn hình mới đánh mã nối tiếp (MOB-67, MOB-68, IAM-09, màn hình của phân hệ mới) và theo đúng mockup, tokens, component families (D-B11).

R0–R1 (thay "P0 pilot") gồm truy cập, dự án, kế hoạch năm, báo cáo tuần/tháng, vướng mắc, notification in-app/email/push và quản trị cơ bản, mở rộng thành mức tối thiểu của cả 25 phân hệ (D-B01). Phần trước đây xếp P1 (thanh toán/Kho bạc theo khả năng tích hợp, nhà thầu/AI, BI động, đa kênh, LLM governance, SaaS, branding, billing và license) có mức tối thiểu ở R1, sâu hóa ở R2 và tích hợp ngoài/AI production/kênh ngoài/hóa đơn thật ở R3. Nền tảng tenant isolation và entitlement phải tồn tại từ R0; việc xếp phân hệ thương mại vào release sau chỉ nói thời điểm khai thác, không trì hoãn ranh giới bảo mật. (Cập nhật 1.4 — CR-BRD-02)

Hướng mở rộng ngoài R0–R4 (thay "P2 roadmap"): GIS thực mức nâng cao, BIM/IoT, mô phỏng danh mục nâng cao, cổng nhà thầu/công khai, bản ứng dụng white-label riêng, marketplace connector; vào lịch bằng CR. Không coi các mục này là đã có mockup đầy đủ trong baseline. Các màn hình bàn giao và quyết toán cơ bản cùng đánh giá đầu tư (MNE), thanh tra/kiểm toán (AUD), bàn giao tài sản và bảo hành (AST) nằm trong R1–R2. (Cập nhật 1.4 — CR-BRD-02)

Không bao gồm trong gói thiết kế: phần mềm production, API Kho bạc đang hoạt động, ứng dụng đã ký/cài lên App Store/Google Play, chứng nhận pháp lý, tài khoản kênh được duyệt và dịch vụ thanh toán thật. Prototype dùng dữ liệu minh họa, không phát sinh tin nhắn hay phí LLM thật.

(Bổ sung 1.4 — CR-BRD-01) Hệ thống TTQG về đầu tư công, muasamcong và dịch vụ công Kho bạc/TABMIS không có API công khai cho bên thứ ba; tích hợp được thiết kế bằng nhập/xuất tệp mẫu và đối soát (trạng thái adapter PROPOSED/MISSING), không dùng API giả định. Chứng thư số/CA production cũng nằm ngoài gói thiết kế; R0 chỉ spike CA sandbox (R8).

### Phân kỳ phát hành R0–R4
(Bổ sung 1.4 — CR-BRD-02) Từ baseline 1.4 chỉ dùng một bộ tên release R0–R4 của `09_Ke_hoach_trien_khai.md` (cổng vào/ra đầy đủ ở tài liệu 09).

| Release | Nội dung chính | Cổng ra (tóm tắt) |
|---|---|---|
| R0 Nền tảng | Tenant, RLS, IAM (cây đơn vị, guest nhà thầu), audit/outbox/idempotency, entitlement tối thiểu, theme SAS-04, shell, DOC engine, spike rủi ro | Test cách ly tenant 100% đạt; migration; ma trận quyền; restore thử |
| R1 Phủ rộng mức tối thiểu dùng thật | 25 phân hệ có luồng chính, quyền, audit, màn hình lõi; thông báo IN_APP/email công vụ/push; mobile báo cáo tuần, phê duyệt không ký, vướng mắc, offline queue | Golden số liệu khớp (hoặc ghi rõ phần CHỜ KÝ); maker-checker; khóa kỳ; xung đột offline; không P0/P1 mở |
| R2 Sâu hóa | Hợp đồng → nghiệm thu → thanh toán → đối soát → quyết toán; GPMB; văn bản và báo cáo nhà nước; BI drill; DGV; thông báo đa kênh nội bộ | Không đếm trùng; mẫu biểu được owner xác nhận; sổ [CXN] của release đã xác nhận |
| R3 Tích hợp ngoài và AI | Kho bạc, ký số, kênh ngoài, AI production khi D05–D07 có hợp đồng; hóa đơn điện tử thật | Adapter qua contract test với sandbox; AI có eval, bằng chứng, định tuyến theo phân loại dữ liệu |
| R4 Hardening và rollout | Pentest, tải, trợ năng, DR, UAT ký; rollout theo cohort | `UAT-COVERAGE.md` 100% đạt; case critical 100%; SLO, RPO/RTO chốt (D10) |

Bảng ánh xạ tên phân kỳ cũ → mới (baseline 1.3 dùng đồng thời P0/P1/P2, Giai đoạn 0–3 và G0–G5; cột `phase` trong `screen_catalog.json` chỉ còn là nhãn lịch sử):

| Tên cũ | Nội dung cũ | Tên mới |
|---|---|---|
| P0 (pilot) | Truy cập, dự án, kế hoạch năm, báo cáo tuần/tháng, vướng mắc, notification in-app/email/push, quản trị cơ bản | R0 + R1; pilot chạy sau khi R1 đạt |
| P1 (mở rộng) | Thanh toán/Kho bạc, nhà thầu/AI, BI động, đa kênh, LLM governance, SaaS, branding, billing, license | Tối thiểu ở R1; sâu hóa R2; tích hợp ngoài/AI production/kênh ngoài/hóa đơn thật R3; cách ly, entitlement, theme ở R0 |
| P2 (roadmap) | GIS, BIM/IoT, hiệu quả sau bàn giao nâng cao, mô phỏng nâng cao, cổng nhà thầu/công khai, white-label, marketplace | Ngoài R0–R4, vào lịch bằng CR |
| Giai đoạn 0 | Chốt định nghĩa, mapping nguồn cũ, danh mục quyền, căn cứ pháp lý | Điều kiện vào R0/R1 (D03, D04, sổ xác nhận pháp lý) |
| Giai đoạn 1 | Pilot một tenant, hai chu kỳ báo cáo song song | Pilot sau R1 |
| Giai đoạn 2 | Mở rộng mobile, đối soát, BI | R2 |
| Giai đoạn 3 | Thương mại hóa SaaS, AI, kênh ngoài | R3 (+ R4 rollout) |
| G0–G5 | Mốc kế hoạch/backlog cũ | R0–R4 theo nội dung; ánh xạ chính thức trong `implementation_backlog.json` |

### Quy tắc thời điểm
(Bổ sung 1.4 — CR-BRD-06) **Kênh ngoài.** Một quy tắc duy nhất: kênh trong hệ thống và kênh công vụ gồm IN_APP, email công vụ và push (APNs/FCM) có mặt từ R1 cho pilot, sau khi sender/domain email và tài khoản developer push được xác minh; kênh ngoài tới liên hệ cá nhân gồm Zalo OA/ZNS, WhatsApp, SMS và hội thoại hai chiều OMNI chỉ bật khi D06 hoàn tất (tài khoản được duyệt, template, consent theo mục đích, giá/quota, sandbox pass), không sớm hơn R2 và mặc định R3 cho ZNS/WhatsApp. Trước đó dùng adapter mock có contract test. Không kênh nào bỏ qua BR-R09.

(Bổ sung 1.4 — CR-BRD-07) **Entitlement.** Cơ chế entitlement (plan, feature, quota, license, kiểm tại điểm quyết định quyền) có từ R0 với một gói pilot tối thiểu. Ma trận entitlement thương mại đầy đủ (D08: tên gói, ghế, grace, proration, offline lease, quyền đọc khi hết hạn) phải được ký trước khi phát hành hóa đơn thuê bao đầu tiên theo hợp đồng thật, không muộn hơn cổng vào R3; R1 chạy hóa đơn qua adapter mock.

(Bổ sung 1.4 — CR-BRD-08) **Pilot charter.** Charter pilot (D09: tenant, nhóm dự án, số người, thiết bị, trình duyệt, dữ liệu thử, capacity profile) được ký trước khi pilot bắt đầu và không muộn hơn cổng ra R1; pilot bắt đầu sau khi R1 đạt, kéo dài tối thiểu hai kỳ báo cáo song song với hệ thống hiện hữu; kết quả pilot là đầu vào cổng vào R4; rollout tiếp theo đi theo cohort.

(Bổ sung 1.4 — CR-BRD-05) **SLO và RTO.** SLO 99,9%/30 ngày là cam kết khả dụng; RTO ≤ 4 giờ và RPO ≤ 15 phút là trần phục hồi khi tuyên bố thảm họa, không phải cam kết khả dụng. Ngân sách lỗi là 43 phút 12 giây mỗi 30 ngày; gián đoạn do thảm họa tính đủ vào ngân sách; khi ngân sách cạn chỉ phát hành bản sửa độ tin cậy/bảo mật. Quy tắc đầy đủ ở mục "SLO, RPO và RTO" của `04_Thiet_ke_co_ban.md`; SLA thương mại (D10) không được cao hơn SLO nội bộ.

## Chuỗi nghiệp vụ mục tiêu
Lập/nhập dự án (PRJ: Concept → thẩm định → ngân hàng dự án) → quyết định và văn bản (DOC) → phân bổ nguồn theo năm (CAP) → GPMB và giấy phép (LND, PMT) → đăng ký giải ngân tháng và kế hoạch tuần → báo cáo tuần (DIS) → kiểm tra và phản hồi → xác nhận/tổng hợp → điều hành, cảnh báo sớm và xử lý vướng mắc (HOME, ISS) → hợp đồng, nhật ký và nghiệm thu chất lượng (CTR, QMS) → nghiệm thu khối lượng/thanh toán/đối soát (CTR, PAY) → giám sát, đánh giá, thanh tra, kiểm toán (MNE, AUD) → quyết toán/bàn giao tài sản/bảo hành (PAY, AST). Mỗi bước có người sở hữu, phiên bản, hạn xử lý và bằng chứng. Quy trình có thể cấu hình theo tenant (workflow version chạy trên Temporal, R9) nhưng không được vô hiệu hóa cách ly dữ liệu, audit hoặc nguyên tắc phân tách nhiệm vụ. (Cập nhật 1.4 — CR-BRD-01)

Đối với nhà thầu: bộ tiêu chí được duyệt → tiếp nhận và khóa phiên bản đề án → OCR kiểm chứng → phân tích AI → so sánh có nguồn → chuyên gia kiểm tra → làm rõ → biên bản → phê duyệt có thẩm quyền. AI không tự loại nhà thầu hoặc sửa trọng số để thay đổi kết quả.

Đối với SaaS: tạo tenant → xác minh owner/domain → cấp gói và license → cấu hình nhận diện/tích hợp → vận hành/đo usage → hóa đơn/đối soát → gia hạn/nâng hạ gói → kết thúc/xuất dữ liệu/lưu trữ theo hợp đồng. Trạng thái thanh toán, tenant, subscription và license là bốn đối tượng riêng.

(Bổ sung 1.4 — CR-BRD-09) Vòng đời tenant theo một máy trạng thái duy nhất 7 trạng thái: Requested → Provisioning → Active, Provisioning → Failed (retry hoặc archive), Active ⇄ Suspended, Active/Suspended → Offboarding → Archived, Offboarding → Active khi gia hạn trong cửa sổ xuất (chi tiết ở FRD UC11 và `05_modules/SAS.md`). Thanh toán quá hạn không tự đổi trạng thái tenant hay license; tạm ngừng là quyết định có lý do của System Admin.

## Quy tắc kinh doanh trọng yếu
BR-R01: tách nguồn vốn năm, kéo dài, khác và ngân sách trung ương/địa phương; phần CTMTQG là tập con. BR-R02: lũy kế tuần là snapshot, không cộng nhiều snapshot. BR-R03: số tiền ghi nhận phải có đơn vị, nguồn và kỳ. BR-R04: người tạo không tự duyệt hồ sơ yêu cầu maker-checker. BR-R05: hồ sơ đã gửi không xóa vật lý; điều chỉnh có phiên bản. BR-R06: không có số liệu được công bố mà không biết grain, định nghĩa, nguồn và độ mới.

BR-R07: tenant admin không tăng gói quyền vượt license; feature flag chỉ có thể tắt thêm, không tự cấp quyền. BR-R08: dùng vượt ngân sách AI phải bị chặn trước khi gọi hoặc theo hạn mức phát sinh đã duyệt, không chỉ cảnh báo sau khi tốn tiền. BR-R09: gửi tin phải xét mục đích, consent, giới hạn kênh và phân loại dữ liệu. BR-R10: mở sâu từ KPI luôn giữ scope và snapshot; dữ liệu không đủ quyền được giải thích bằng trạng thái phù hợp, không làm lộ tên hồ sơ.

(Bổ sung 1.4 — CR-BRD-10) BR-R11: kỳ báo cáo có ba trạng thái Open, SoftClosed, Locked; "Closed" của baseline 1.3 nghĩa là Locked; mở lại kỳ cần lý do, phạm vi, thời hạn và người duyệt khác người đề nghị. BR-R12: thanh toán dùng sổ lũy kế theo hợp đồng × dòng BOQ × nghiệm thu; tổng đề nghị không vượt giá trị nghiệm thu hoặc hợp đồng; mỗi nghiệm thu chỉ gắn vào một đề nghị còn hiệu lực; sửa sai bằng bút toán đảo, không xóa; idempotency key không thay thế ràng buộc này (R7). BR-R13: quy tắc tính toán và mẫu biểu pháp lý là dữ liệu có `legal_basis` và hiệu lực; bản ghi nghiệp vụ lưu phiên bản đã áp dụng; dữ liệu phát sinh dưới văn bản cũ giữ hiệu lực theo điều khoản chuyển tiếp [CXN]. BR-R14: hồ sơ chịu legal hold (thanh tra, kiểm toán, khiếu nại) không bị xóa, tiêu hủy hay ẩn danh bởi job lưu trữ hoặc yêu cầu của chủ thể dữ liệu cho tới khi gỡ hold có lý do; thời hạn lưu trữ là dữ liệu (RetentionPolicy). BR-R15: mỗi yêu cầu AI mang phân loại dữ liệu do server xác định; dữ liệu mật, quan trọng, cá nhân chỉ tới model trong nước hoặc tự host tại Việt Nam; model quốc tế chỉ nhận dữ liệu công khai hoặc đã ẩn danh khi D07 duyệt; không có tuyến hợp lệ thì từ chối (R5). BR-R16: hai tỷ lệ giải ngân (mẫu số kế hoạch Thủ tướng giao; mẫu số gồm phần địa phương giao thêm) luôn hiển thị song song với cùng tử số, tính theo ngày Kho bạc thanh toán [CXN]. BR-R17: văn bản phát hành có chữ ký số hợp lệ của người ký và dấu số cơ quan; số văn bản cấp sau khi ký, không trùng, không hậu tố; cấp số và đóng dấu không làm hỏng chữ ký đã có (R8). BR-R18: dữ liệu thiếu hoặc chưa đánh giá hiển thị bằng nhãn riêng (Chưa có cơ sở tính, NotAssessed), không đổi thành 0 hoặc điểm thấp nhất.

## Gói SaaS và thương hiệu
Gói Starter đề xuất có dự án/báo cáo/thông báo cơ bản; Professional thêm BI và workflow; Enterprise thêm AI/omnichannel/SSO, quota cao và SLA thỏa thuận; Private dành cho hạ tầng/cơ sở dữ liệu riêng. Tên gói và giá chưa chốt. Quyền thực tế được cấu hình bằng entitlement gồm module, action, hạn mức, ngày hiệu lực, grace và điều kiện hợp đồng; không hard-code tên gói trong mã nghiệp vụ.

Thương hiệu gồm logo sáng/tối, palette đã kiểm tra tương phản, tên, favicon, login cover, email sender/template, tên miền xác minh và tài liệu xuất. Mobile dùng chung ứng dụng, nhận diện tenant sau chọn tổ chức; icon ứng dụng và tên trên cửa hàng không thay đổi tùy ý theo từng tenant. App white-label riêng cần quy trình build, ký và phát hành riêng.

(Bổ sung 1.4 — CR-BRD-11) Theme và thương hiệu theo tenant (SAS-04): chỉ System Admin cấu hình; Tenant Admin chỉ đọc cấu hình đã công bố của tenant mình; Tenant Owner đề nghị qua hợp đồng. Đặc tả đầy đủ, ma trận quyền, mã lỗi (`REVIEW_INVALID`, `VERSION_CONFLICT`) và tiêu chí nghiệm thu nằm tại `03_Engineering/Tenant_Theme_Specification.html` và `05_modules/SAS.md`; BRD không chép lại. Hóa đơn điện tử theo NĐ 123/2020 sửa đổi bởi NĐ 70/2025: không hủy hóa đơn đã phát hành, chỉ điều chỉnh hoặc thay thế [CXN].

## Yêu cầu chất lượng và định cỡ
Mô hình tải ban đầu để kiểm thử: 100 tenant, 50.000 dự án toàn nền tảng, 5.000 người dùng đồng thời, 20 triệu dòng giao dịch/snapshot theo chính sách lưu trữ. Đây là giả định cần đo lại (thay bằng capacity profile của pilot, D09). API đọc phổ biến p95 ≤ 800 ms; màn hình nghiệp vụ p95 ≤ 2,5 s trên môi trường kiểm thử đã công bố; BI thông dụng ≤ 5 s với dữ liệu tổng hợp; job nặng xử lý bất đồng bộ. SLO mục tiêu dịch vụ lõi (DIS, CAP, PAY, PRJ, IAM) 99,9% theo cửa sổ trượt 30 ngày; RPO ≤ 15 phút, RTO ≤ 4 giờ là trần phục hồi thảm họa cho cấu hình tiêu chuẩn, không phải cam kết khả dụng; quan hệ giữa hai con số theo quy tắc ngân sách lỗi (mục Quy tắc thời điểm), điều chỉnh theo hợp đồng. Yêu cầu phi chức năng đo được nằm ở `03_Engineering/nonfunctional_requirements.json` (`NFR-<AREA>-NN`). (Cập nhật 1.4 — CR-BRD-05)

Tiếng Việt đầy đủ dấu, định dạng số/ngày theo locale; tương phản mục tiêu WCAG AA; keyboard và screen reader cho luồng lõi. Hỗ trợ portrait smartphone, text scaling và reconnect. Không suy ra “đã đọc” từ push accepted. Dữ liệu nhạy cảm không nằm trong push lock-screen hoặc email công khai.

(Bổ sung 1.4 — CR-BRD-10) Toàn bộ dữ liệu, bản sao lưu, log và trace lưu tại cloud nội địa Việt Nam (D-B03); hồ sơ cấp độ an toàn hệ thống thông tin (dự kiến cấp 3) và runbook ứng cứu sự cố lập trước go-live [CXN].

## Căn cứ pháp lý
(Bổ sung 1.4 — CR-BRD-10) Nguồn là nghiên cứu thứ cấp ngày 22/10/2026 (`01_Nghien_cuu_va_phan_tich_nguon.md`); toàn bộ chưa đối chiếu Công báo nên mang nhãn [CXN] tới khi pháp chế ký xác nhận. Cột "Mã CXN" dùng mã của sổ xác nhận khi đặc tả phân hệ đã gán; "[CXN]" là mục chưa có mã. Quy tắc và mẫu lưu dạng dữ liệu (BR-R13) nên đổi văn bản là đổi dữ liệu.

| Lĩnh vực | Văn bản (số hiệu theo nghiên cứu) | Dùng trong | Mã CXN |
|---|---|---|---|
| Đầu tư công | Luật Đầu tư công 58/2024/QH15, sửa bởi Luật 90/2025/QH15; NĐ 85/2025/NĐ-CP, sửa bởi NĐ 275/2025/NĐ-CP | PRJ, CAP, DIS | CXN-13, CXN-31 |
| Giám sát, đánh giá đầu tư | NĐ 19/2026/NĐ-CP sửa bởi NĐ 96/2026/NĐ-CP, thay NĐ 29/2021; TT 44/2026/TT-BTC (mẫu 02–10) | MNE | CXN-13, CXN-10 |
| Thanh toán, quyết toán | NĐ 254/2025/NĐ-CP (thay NĐ 99/2021, chuyển tiếp Điều 54); TT 91/2025/TT-BTC (thay TT 96/2021) | PAY, CTR, DOC | CXN-08 |
| Báo cáo giải ngân, điều hành | TT 37/2025/TT-BTC; CV 3665/BTC-PTHT (2026); CV 16437/BTC-ĐTPT; Công điện 162/CĐ-TTg | DIS, HOME, CAP, PRJ | CXN-11, CXN-03, CXN-33 |
| Chương trình mục tiêu quốc gia | NĐ 358/2025 | CAP, DIS, MDM | [CXN] |
| Đấu thầu | Luật Đấu thầu 22/2023 sửa bởi Luật 90/2025; NĐ 214/2025; TT 79/2025/TT-BTC | BID, CTR | [CXN] |
| Ngân sách nhà nước | Luật NSNN 89/2025 | CAP, ADM | [CXN] |
| Bảo vệ dữ liệu cá nhân | Luật BVDLCN 91/2025; NĐ 356/2025 (hiệu lực 01/01/2026) | IAM, NOT, OMNI, LND, MOB | [CXN] |
| Dữ liệu, an ninh mạng | Luật Dữ liệu 60/2024; NĐ 165/2025; Luật An ninh mạng 116/2025 (hiệu lực 01/7/2026); cấp độ an toàn HTTT (văn bản thay NĐ 85/2016) | Hosting, AI, bảo mật | CXN-13, CXN-04 |
| Văn thư, lưu trữ | NĐ 30/2020; Luật Lưu trữ 33/2024; NĐ 113/2025; thời hạn theo TT 74/2025/TT-BTC, TT 10/2022/TT-BNV, TT 08/2025/TT-BNV | DOC, ADM, MNE | CXN-05 |
| Chữ ký số, liên thông | NĐ 23/2025; QĐ 28/2018 và QCVN 102:2016 (qua LGSP của cơ quan khách hàng) | DOC, MOB | CXN-06, [CXN] |
| Hóa đơn, thuế | NĐ 123/2020 sửa bởi NĐ 70/2025; Luật Thuế GTGT 48/2024 | SAS | CXN-INV-01, CXN-INV-02 |
| Đất đai, GPMB | Luật Đất đai 2024; NĐ 88/2024 | LND | [CXN] |
| Xây dựng, chất lượng | Luật Xây dựng 135/2025; NĐ 217/2026 (thay NĐ 175/2024); NĐ 06/2021 và văn bản thay thế NĐ 207/2026; NĐ 206/2026, NĐ 210/2026 | QMS, PMT, CTR | [CXN] |
| Thanh tra | Luật Thanh tra 84/2025 | AUD, ADM | [CXN] |
| Tổ chức bộ máy | Luật Tổ chức chính quyền địa phương 72/2025/QH15; NQ 202/2025/QH15; NĐ 45/2025 | IAM, MDM, ADM | CXN-ORG-01..03, CXN-34 |
| Mã dự án trên Hệ thống TTQG về ĐTC | Quy tắc "không có mã thì không bố trí hoặc giải ngân" | PRJ, CAP | CXN-01 |

Các con số pháp lý cụ thể dùng trong thiết kế (ngưỡng nhóm dự án QTQG/A/B/C, hạn báo cáo 10/7 và 10/02, trần tạm ứng theo loại hợp đồng, thu hồi tạm ứng khi thanh toán đạt 80% giá trị hợp đồng, thu hồi tạm ứng GPMB trong 30 ngày, mốc GPMB 90/180/30/30 ngày) đều là [CXN]; fixture kiểm thử gắn mã mục tương ứng. BRD không phải tư vấn pháp lý.

## Triển khai và điều kiện ra mắt
Điều kiện vào R0/R1 (thay "Giai đoạn 0"): chốt định nghĩa (D03), mapping nguồn cũ (D04), danh mục quyền và sổ xác nhận căn cứ pháp lý. R1 đạt rồi pilot một tenant, một nhóm dự án và hai chu kỳ báo cáo song song. R2 sâu hóa mobile, đối soát, BI và các phân hệ tài chính/văn bản. R3 thương mại hóa SaaS, AI và kênh ngoài sau khi hoàn thành kiểm thử cách ly, chi phí và phê duyệt tài khoản (D05–D08). R4 hardening, UAT ký và rollout theo cohort. Ước lượng lịch/chi phí theo giờ review của người (D-B02) và khoảng, cần đội kỹ thuật và quy mô tích hợp; chưa dùng số màn hình để suy ra ngày công chính xác. (Cập nhật 1.4 — CR-BRD-02)

Go-live yêu cầu: ký chốt BRD/FRD, kiểm thử hồi quy và an toàn, đối soát dữ liệu nguồn, diễn tập khôi phục, cơ chế hỗ trợ, tài liệu người dùng và owner của từng chỉ tiêu. Dùng thử tối thiểu hai kỳ có dữ liệu thật đã được cho phép; chỉ kết thúc dual-run khi tổng, kỳ, CTMTQG và số xác nhận khớp hoặc sai lệch có phê duyệt.

## Quản lý phạm vi và phê duyệt baseline
System Admin độc quyền cấu hình tenant/branding và cấp license; Tenant Owner đề nghị thay đổi/hợp đồng, không tự áp dụng theme hoặc gia hạn. R0 đưa tenant isolation/entitlement/theme review vào sớm, thương mại hóa nâng cao theo R3. Lịch R0–R4 và nguồn lực trong 09_Ke_hoach_trien_khai là giả định cần phê duyệt; mức 9–10/10 vẫn là mục tiêu cần pilot/evidence. (Cập nhật 1.4 — CR-BRD-02)

Tài liệu điều phối: 04_Thiet_ke_co_ban; 09_Ke_hoach_trien_khai; 10_Ke_hoach_kiem_thu_va_chuyen_doi; 03_Engineering/nonfunctional_requirements.json; 03_Engineering/Implementation_Backlog.html; 03_Engineering/Test_Case_Catalogue.html; 03_Engineering/Decision_Register.html. (Cập nhật 1.4 — CR-BRD-00)

## Danh sách CR của BRD baseline 1.4
| CR | Nội dung | Nguồn quyết định |
|---|---|---|
| CR-BRD-00 | Quy ước baseline 1.4, nhãn [CXN]/[GIẢ ĐỊNH]/CHỜ KÝ, tài liệu điều phối | Plan 22/10, R4 |
| CR-BRD-01 | Phạm vi 25 phân hệ, BR-07..11, chuỗi nghiệp vụ mở rộng, tích hợp qua tệp | D-B01, D-B04, D-B09 |
| CR-BRD-02 | Một bộ tên release R0–R4 thay P0/P1/P2, Giai đoạn 0–3, G0–G5; bảng ánh xạ; KPI theo release | D-B10, tài liệu 09 |
| CR-BRD-03 | Tên vai trò chuẩn theo tài liệu 04 | Tài liệu 04 mục Thuật ngữ vai trò |
| CR-BRD-04 | Định nghĩa tenant = cơ quan chủ quản ký hợp đồng | R6 (D9) |
| CR-BRD-05 | Quan hệ SLO 99,9% và RTO 4 giờ theo ngân sách lỗi | Tài liệu 04 mục SLO, RPO và RTO |
| CR-BRD-06 | Một quy tắc thời điểm cho kênh ngoài | D06, NOT.md §12, OMNI.md §12 |
| CR-BRD-07 | Thời điểm ma trận entitlement | D08, SAS.md §12 |
| CR-BRD-08 | Thời điểm pilot charter | D09, tài liệu 10 mục 10 |
| CR-BRD-09 | Vòng đời tenant 7 trạng thái | SAS.md §4 (CR-SAS-01) |
| CR-BRD-10 | BR-R11..R18, hosting tại Việt Nam, bảng căn cứ pháp lý | R4, R5, R7, R8, D-B03 |
| CR-BRD-11 | Bỏ khối SAS-04 dán lặp, thay con trỏ; ghi chú hóa đơn điện tử | O11, SAS.md |

## Phụ lục: ánh xạ nội dung baseline 1.3
| Đoạn baseline 1.3 bị bỏ | Nội dung nay nằm ở |
|---|---|
| "Theme & thương hiệu theo tenant — SAS-04", đoạn 1 (chỉ System Admin cấu hình; Tenant Admin chỉ đọc bản đã công bố) | Đoạn CR-BRD-11 trong "Gói SaaS và thương hiệu"; `03_Engineering/Tenant_Theme_Specification.html` |
| SAS-04 đoạn 2 (nháp tách tenant, review chênh lệch, phiên bản bất biến, khôi phục qua review, kiểm tương phản 4,5:1) | `Tenant_Theme_Specification.html`; `05_modules/SAS.md` §3.12 |
| SAS-04 đoạn 3 (server xác thực System Admin, review gắn actor/tenant/hash/base version, 403/409/422, audit) | `Tenant_Theme_Specification.html`; `05_modules/SAS.md` BR-SAS-17 |
| SAS-04 đoạn 4 (prototype dùng localStorage, không phải xác thực thật) | `Tenant_Theme_Specification.html`; FRD mục "Theme & thương hiệu theo tenant — SAS-04" (con trỏ) |
| "## Đối tượng và phân vai Lãnh đạo: xem tiến độ, drill-down, " (đoạn baseline) | Mục "Đối tượng và phân vai" (đoạn CR-BRD-04 định nghĩa tenant, các đoạn vai trò đã sửa tên theo CR-BRD-03) |
| "Tenant owner: quản lý thông tin hợp đồng và đề nghị thay đổi" (đoạn baseline) | Đoạn "Tenant Owner: …" trong mục Đối tượng và phân vai (đổi tên chuẩn, CR-BRD-03) |
| "## Phạm vi chức năng và sản phẩm P0 pilot gồm truy cập, dự á" (đoạn baseline) | Mục "Phạm vi chức năng và sản phẩm" (đoạn R0–R1 thay "P0 pilot", CR-BRD-02) và bảng ánh xạ phân kỳ |
| "P2 roadmap: GIS thực, BIM/IoT, danh mục hiệu quả đầu tư sau " (đoạn baseline) | Đoạn "Hướng mở rộng ngoài R0–R4" và bảng ánh xạ tên phân kỳ (CR-BRD-02) |
| "## Chuỗi nghiệp vụ mục tiêu Lập/nhập dự án → thẩm định và qu" (đoạn baseline) | Mục "Chuỗi nghiệp vụ mục tiêu" (chuỗi mở rộng 25 phân hệ, CR-BRD-01) |
| "## Triển khai và điều kiện ra mắt Giai đoạn 0 chốt định nghĩ" (đoạn baseline) | Mục "Triển khai và điều kiện ra mắt" (điều kiện vào R0/R1, pilot, R2–R4, CR-BRD-02) |
| "Chỉ System Admin được cấu hình thương hiệu cho các tenant: m" (đoạn baseline) | Mục SAS-04 (con trỏ); `Tenant_Theme_Specification.html` |
| "Bản nháp tách biệt theo tenant và không thay đổi giao diện đ" (đoạn baseline) | `Tenant_Theme_Specification.html`; `05_modules/SAS.md` §3.12 |
| "Server phải xác thực System Admin cho mọi lệnh ghi; không ti" (đoạn baseline) | `Tenant_Theme_Specification.html`; `05_modules/SAS.md` BR-SAS-17 |
| "Prototype SAS-04 dùng localStorage và bộ chọn vai trò mô phỏ" (đoạn baseline) | `Tenant_Theme_Specification.html` |
| "Tài liệu điều phối: 09_Ke_hoach_trien_khai; 10_Ke_hoach_kiem" (đoạn baseline) | Dòng "Tài liệu điều phối" cuối tài liệu (thêm 04, NFR, MOB/MDM/DGV, CR-…-00) |

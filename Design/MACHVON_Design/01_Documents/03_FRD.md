# Hệ Thống Lý Dự Án Đầu Tư Công đặc tả yêu cầu chức năng FRD
Baseline 1.4 | 22/10/2026. Mỗi màn hình có mã FR tương ứng trong screen_catalog.json và Screen_Specifications.html. Các quy tắc trong tài liệu này áp dụng bổ sung, không được thay thế bởi hành vi mô phỏng của prototype. (Cập nhật 1.4 — CR-FRD-00)

(Bổ sung 1.4 — CR-FRD-00) Quy ước baseline 1.4: đoạn không có nhãn là nguyên văn baseline 1.3 và vẫn đúng; "(Cập nhật 1.4 — CR-FRD-nn)" là đoạn baseline được sửa; "(Bổ sung 1.4 — CR-FRD-nn)" là nội dung mới; đoạn bị bỏ được liệt kê ở "Phụ lục: ánh xạ nội dung baseline 1.3". UC01–UC16 và AC01–AC67 giữ nguyên mã và nghĩa; UC17–UC28 là bổ sung. Đặc tả phân hệ `05_modules/<MÃ>.md` là nguồn chi tiết (state machine, công thức, API, bảng, test) và cấp tiêu chí nghiệm thu riêng dạng `AC-<MÃ>-NN` gắn test `UAT-AC<nnn>`; FRD tham chiếu các mã đó, không tạo mã AC mới cho phân hệ. Khi FRD mâu thuẫn với `04_Thiet_ke_co_ban.md` về tenant, RLS, đồng bộ, điều phối hoặc tên vai trò thì tài liệu 04 thắng. Tenant là cơ quan chủ quản ký hợp đồng (UBND tỉnh hoặc bộ/ngành); sở, ban, chủ đầu tư, xã là đơn vị trong tenant (R6). Tên vai trò theo bảng "Thuật ngữ vai trò" của tài liệu 04.

## Hợp đồng chung cho mọi chức năng
Trước thao tác: xác thực phiên, tenant membership, license/entitlement, action permission, scope đối tượng và phiên bản dữ liệu. Với đọc, quyền áp dụng trước truy vấn, tổng hợp, tìm kiếm và xuất. Với ghi, server kiểm tra đầy đủ, không tin tenant_id hoặc số tổng từ client. Sau thao tác: trả mã đối tượng/phiên bản/trạng thái; ghi audit và sự kiện outbox cùng transaction. Lỗi có code, trường liên quan, thông điệp và correlation_id; không trả stack trace hoặc tồn tại hồ sơ ngoài quyền.

Yêu cầu dùng chung: phân trang cursor, lọc có biểu diễn rõ, sắp xếp ổn định, lưu view cá nhân, cột ghim, CSV/Excel/PDF export bất đồng bộ. Xuất file phải áp lại quyền tại lúc chạy và lúc tải; link có TTL; nội dung xuất có phạm vi, kỳ, đơn vị và thời gian chốt. Batch import có dry-run, mapping, preview, báo lỗi theo dòng; không âm thầm bỏ dòng sai.

(Bổ sung 1.4 — CR-FRD-09) Cách ly và lệnh ghi: mọi bảng dữ liệu tenant bật `ENABLE` và `FORCE ROW LEVEL SECURITY` với hai policy cùng điều kiện `tenant_id = current_setting('app.tenant_id')`: một policy PERMISSIVE `tenant_access` và một policy RESTRICTIVE `tenant_boundary` (PostgreSQL từ chối mọi dòng nếu chỉ có policy RESTRICTIVE; RESTRICTIVE bảo đảm policy cho phép thêm sau này, ví dụ scope đơn vị, không nới ranh giới tenant). Bảng nhạy cảm (hộ dân LND, đề xuất nhà thầu BID, dữ liệu cá nhân) thêm policy RESTRICTIVE theo scope. Runtime role không sở hữu bảng, không BYPASSRLS; `SET LOCAL app.tenant_id` mỗi transaction từ claim đã xác thực. Mọi thay đổi trạng thái là domain command có `Idempotency-Key` bắt buộc và `If-Match` khi sửa bản ghi có version; không endpoint chung nào đổi `status`, `tenant_id`, role/grant hoặc số tiền đã chốt. Tài nguyên ngoài tenant hoặc ngoài scope đọc trả 404, không lộ tồn tại (BR-IAM-01). Luồng dài và phê duyệt nhiều bước chạy trên Temporal và chỉ đổi trạng thái qua command domain (R9). Mã lỗi theo `04_Thiet_ke_co_ban.md` mục Command.

## UC01 nhập báo cáo tuần
Actor: cán bộ chủ đầu tư. Tiền điều kiện: dự án thuộc phạm vi, kỳ ở trạng thái Open hoặc SoftClosed (nhận gửi nhưng đánh dấu trễ) hoặc Locked có cửa sổ mở lại đã duyệt bao gồm dự án, kế hoạch có hiệu lực và quyền report.write. Luồng DIS-01 → DIS-02 → DIS-03 → DIS-04 → DIS-05 → DIS-06 → DIS-07. Chọn kỳ/dự án; hệ thống lấy snapshot kế hoạch, kỳ trước, nguồn vốn; nhập khối lượng và số lũy kế theo nguồn; đăng ký tháng sau; kiểm tra; lưu nháp hoặc gửi. Gửi tạo phiên bản bất biến, thời điểm server, người gửi và hash nội dung. (Cập nhật 1.4 — CR-FRD-02)

Khóa nghiệp vụ đề xuất: tenant + project + reporting_period + report_type + revision. Mỗi khóa có tối đa một bản current được chấp nhận. Có draft riêng nhưng không tạo nhiều current cho cùng kỳ. Kế hoạch liên quan lưu bằng plan_version_id, không chỉ tên năm. Gửi lại cùng Idempotency-Key và payload trả cùng kết quả; cùng key khác payload trả 409. Hai người sửa cùng version: người sau nhận 409 và bản so sánh.

AC01: Given kỳ mở và dữ liệu hợp lệ, When gửi, Then trạng thái Submitted, một audit và một event report.submitted được tạo. AC02: Given CTMTQG lớn hơn phần nguồn cha, When gửi, Then 422 với tên trường, giữ nguyên nháp. AC03: Given kỳ đã khóa, When gửi, Then không tạo phiên bản gửi và trả PERIOD_LOCKED. AC04: Given không có đăng ký tháng hoặc mẫu số bằng 0, Then tỷ lệ hiện “Chưa có cơ sở tính”, không hiện 0% hoặc Infinity.

(Bổ sung 1.4 — CR-FRD-02) "Kỳ đã khóa" trong AC03 là trạng thái Locked. Chi tiết: `05_modules/DIS.md` F1–F9, BR-DIS-01..13; tiêu chí AC-DIS-01..12 (UAT-AC01..07, UAT-AC240..265), gồm hai tỷ lệ giải ngân song song tính theo ngày Kho bạc thanh toán [CXN-03] (AC-DIS-05) và nhãn CHỜ KÝ cho định nghĩa chưa ký (AC-DIS-11). Mobile MOB-13→21 dùng cùng command và DTO (UC20).

## UC02 sửa trả lại thu hồi và khóa kỳ
Trạng thái đề xuất: Draft → Submitted → UnderReview → Accepted; Submitted/UnderReview → Returned → Draft revision mới → Submitted. Accepted → AmendmentRequested → revision mới → Accepted; bản cũ giữ nguyên và được supersede khi bản mới chấp nhận. Withdrawal chỉ cho trạng thái được chính sách cho phép, có lý do và người duyệt. Kỳ báo cáo có ba trạng thái Open → SoftClosed → Locked; "Closed" của baseline 1.3 nghĩa là Locked; `locked_at` chỉ là dấu thời gian, có giá trị khi và chỉ khi kỳ Locked; trạng thái kỳ không xóa trạng thái báo cáo. Workflow version được gắn tại thời điểm gửi. (Cập nhật 1.4 — CR-FRD-02)

Chuyên viên trả lại phải chỉ rõ mục cần bổ sung, lý do, hạn và tệp đối chiếu. Mở khóa kỳ đòi quyền riêng, lý do, phạm vi dự án/kỳ và giới hạn thời gian; audit phải lưu người duyệt mở khóa. Không có thao tác “sửa trực tiếp số accepted”. Xóa nháp là soft-delete, phải hiển thị mã/kỳ/dự án. Khôi phục nháp trong retention cho phép không phục hồi quyền truy cập đã bị thu hồi.

AC05: self-approval bị từ chối khi maker-checker bật. AC06: chỉnh sửa accepted tạo revision mới, dashboard chưa đổi cho đến khi revision mới được chấp nhận. AC07: báo cáo đến trễ được đánh dấu và tính đúng deadline theo calendar_version.

(Bổ sung 1.4 — CR-FRD-02) Mở lại kỳ Locked dùng `requestPeriodReopen` (kỳ hoặc danh sách dự án, lý do, thời hạn ≤ 168 giờ) và `decidePeriodReopen` bởi người khác người đề nghị; hết hạn cửa sổ thì kỳ vẫn Locked với phạm vi khác. Quy trình phê duyệt chạy trên ADM (business_type `period.reopen`), trạng thái kỳ thuộc DIS (`05_modules/DIS.md` F4, CR-DIS-01).

## UC03 kế hoạch phân bổ và điều chuyển
Đối tượng: kế hoạch trung hạn, kế hoạch năm, quyết định, dòng phân bổ, nguồn vốn và đăng ký tháng. Phân bổ chỉ được chấp nhận khi tổng dòng không vượt giá trị quyết định/nguồn khả dụng, ngày hiệu lực và dự án hợp lệ. Điều chuyển là một bộ dòng tăng/giảm có cùng transaction; phải cân bằng theo loại điều chuyển và căn cứ. Chuyển nguồn giữa năm không biến thành tiền giải ngân.

Simulation không ghi ledger thật. Mỗi kịch bản lưu constraints, input snapshot, assumptions và kết quả; so sánh baseline với đề xuất; áp dụng cần tạo hồ sơ phê duyệt riêng. Đăng ký tháng là kế hoạch dự kiến, không phải actual. Chỉ tiêu “còn lại” phải ghi rõ theo vốn giao năm, theo tổng mức đầu tư hay theo hợp đồng.

AC08: hai phân bổ đồng thời không thể cùng tiêu một số dư; kiểm tra trong transaction lock. AC09: quyết định bị thay thế không làm mất khả năng xem kế hoạch tại thời điểm lịch sử.

(Bổ sung 1.4 — CR-FRD-10) Mô hình FundSource → Appropriation → dòng phân bổ với sổ cái vốn append-only, kiểm soát hạn mức khả dụng (AVC) có ngưỡng cảnh báo/chặn, earmark, giảm dòng không được thấp hơn số đã cam kết + giải ngân, kéo dài có văn bản (`is_extended`, `extended_to`) [CXN-31], khóa năm kế hoạch và đề xuất điều chuyển từ dự án chậm sang dự án nhanh dựa trên snapshot DIS [CXN-33]. Chỉ dự án ở giai đoạn PIPELINE trở đi mới nhận vốn (UC28). Chi tiết `05_modules/CAP.md`; tiêu chí AC-CAP-01..11 (UAT-AC08, UAT-AC09, UAT-AC220..239).

## UC04 thanh toán tạm ứng và đối soát
Đề nghị thanh toán liên kết project, contract, acceptance, nguồn và chứng từ. Quy tắc giá trị đề nghị, tạm ứng, thu hồi, giữ lại và trần hợp đồng được cấu hình có phiên bản theo loại hồ sơ; không áp một công thức pháp lý cố định chưa được chốt. Số đã gửi KBNN là trạng thái/giá trị hồ sơ, không mặc nhiên là số đã thanh toán.

(Bổ sung 1.4 — CR-FRD-11) Sổ lũy kế thanh toán (R7): đề nghị thanh toán dùng sổ cái lũy kế theo hợp đồng × dòng BOQ × nghiệm thu, ghi giá trị đã đề nghị, đã thanh toán và tạm ứng còn lại. Khi gửi đề nghị, trong transaction có khóa hàng hợp đồng và ràng buộc DB: (a) tổng đề nghị cộng đề nghị mới không vượt giá trị nghiệm thu đã duyệt và giá trị hợp đồng hiệu lực, nếu vượt trả 409 `VALUE_EXCEEDED`; (b) mỗi nghiệm thu chỉ gắn vào một đề nghị còn hiệu lực, nếu đã gắn trả 409 `ACCEPTANCE_ALREADY_CLAIMED`; (c) sửa sai bằng bút toán đảo (reversal) có liên kết, không xóa hoặc sửa số gốc. Idempotency-Key chỉ chặn một người gửi lặp; hai người hoặc hai màn hình gửi hai key khác nhau cho cùng nghiệm thu thì một thành công, một nhận 409. Công thức tạm ứng/thu hồi là dữ liệu có `legal_basis` theo NĐ 254/2025 và TT 91/2025 [CXN-08]; trần tạm ứng theo loại hợp đồng, thu hồi hết khi thanh toán đạt 80% giá trị hợp đồng và thu hồi tạm ứng GPMB trong 30 ngày là [CXN]. Thời điểm tính giải ngân là ngày Kho bạc thanh toán [CXN-03]. Đặc tả `05_modules/PAY.md` (chưa phát hành khi viết) sẽ cấp `AC-PAY-NN`; trong lúc chờ, hành vi trên được kiểm bằng các test đồng thời gắn AC60/AC61.

Adapter nhận thông điệp Kho bạc vào staging; xác thực nguồn, mã ngoại, thời gian, checksum; dedupe theo provider+tenant+external_transaction_id. Không có API thì dùng import có đối soát và nguồn “manual-confirmed”. Ghép theo khóa hồ sơ và nguồn vốn; trường hợp không ghép được vào exception queue. Confirmed actual chỉ thay đổi sau xác nhận. Hoàn trả/đảo giao dịch là bút toán đảo có liên kết, không sửa số gốc.

(Bổ sung 1.4 — CR-FRD-11) Dịch vụ công Kho bạc/TABMIS không có API công khai cho bên thứ ba; đường chính là nhập tệp sao kê idempotent (SHA-256 tệp + khóa nghiệp vụ từng dòng; nạp lại cùng tệp trả "đã nạp", không tạo bản ghi) và xuất hồ sơ theo mẫu. Adapter API ở trạng thái MISSING cho tới khi D05 có hợp đồng (A3).

AC10: cùng callback hai lần chỉ tạo một giao dịch. AC11: tổng đối soát không cộng cả bản gốc và bản nhập lặp. AC12: số nội bộ khác số xác nhận hiển thị hai cột và sai lệch, không tự chọn số lớn hơn.

## UC05 vướng mắc và hiện trường
Ghi nhận có project, loại, mức độ, nội dung, ảnh, thời gian và vị trí nếu người dùng đồng ý. SLA theo loại/đơn vị/lịch làm việc. Luồng Open → Assigned → InProgress → PendingVerification → Closed; Reopened có lý do; Escalated không tự đóng việc gốc. Ngày quá hạn và người chịu trách nhiệm được giữ khi chuyển đơn vị. Đóng việc cần bằng chứng và người kiểm tra khác người xử lý khi cấu hình yêu cầu.

Offline chỉ tạo bản nháp và ảnh chờ đồng bộ. Vị trí thiếu hoặc độ chính xác kém phải hiển thị, không tạo bằng chứng vị trí giả. Ảnh có thời gian chụp và thời gian nhận riêng; không coi EXIF là bằng chứng chống giả mạo tuyệt đối.

(Bổ sung 1.4 — CR-FRD-12) Trên mobile, "chờ đồng bộ" là lệnh trong hàng đợi command (UC20) với trạng thái riêng, trong đó UNKNOWN nghĩa là đã gửi nhưng chưa biết kết quả và phải tra theo idempotency key, không tự gửi lại. Vướng mắc có thể được tạo từ LND, PMT, QMS (sự kiện) và chuyển từ hội thoại OMNI.

## UC06 AI phân tích đề án nhà thầu
Tổ chuyên gia ban hành criteria_version gồm tiêu chí, điều kiện bắt buộc, thang điểm/trọng số nếu áp dụng, bằng chứng yêu cầu và phạm vi hồ sơ. Trọng số phải hợp lệ; tiêu chí có hiệu lực được khóa cho lượt đánh giá. File được malware scan, phân loại, OCR, tách trang/bảng và kiểm tra chất lượng. OCR thấp hoặc bảng không khớp chuyển chuyên gia xác nhận trước phân tích tài chính.

Analysis run gắn document_version_ids, criteria_version, model thực tế, profile/prompt version, retrieval snapshot, input hash và budget reservation. Pipeline: trích xuất dữ kiện → tính toán xác định bằng code → đối chiếu tiêu chí → dựng nhận xét có dẫn chứng → kiểm tra đủ bằng chứng → review. Văn bản trong hồ sơ là dữ liệu, không được thi hành lệnh yêu cầu bỏ tiêu chí, gửi tài liệu hoặc lộ bí mật. Không cho model truy cập mạng/công cụ ghi tùy ý.

Output cho từng tiêu chí: status [supported, contradicted, missing, needs_review], finding, evidence(file_version,page,bbox,quote), confidence_type, reviewer, override_reason. Confidence là tín hiệu hỗ trợ đã hiệu chuẩn trên eval, không giả định là xác suất đúng. Thiếu bằng chứng không tự suy ra gian lận. Tính giá/khối lượng bằng decimal và công thức đã duyệt, model chỉ diễn giải.

(Bổ sung 1.4 — CR-FRD-13) Định tuyến theo phân loại dữ liệu (R5): analysis run mang `data_classification` do server xác định (mức cao nhất của tài liệu/trường đưa vào prompt). Hồ sơ dự thầu mặc định CONFIDENTIAL nên chỉ tới model trong nước hoặc tự host trên hạ tầng tại Việt Nam; không có tuyến hợp lệ thì từ chối với `AI_ROUTE_NOT_ALLOWED`, không hạ phân loại. Audit ghi tuyến đã dùng. Đánh giá năng lực nhà thầu theo NĐ 214/2025 [CXN].

AC13: mọi nhận xét quan trọng có nguồn trang hoặc cờ thiếu nguồn. AC14: document ACL áp dụng cả vector retrieval và mở dẫn chứng. AC15: thay tiêu chí/hồ sơ phải tạo run mới, kết quả cũ không bị viết lại. AC16: chuyên gia sửa điểm phải có lý do; kết luận cuối do người có thẩm quyền. AC17: so sánh nhà thầu dùng cùng phiên bản tiêu chí; không lấy tên, đặc tính cá nhân không liên quan làm tiêu chí.

## UC07 quản trị LLM và chi phí
Model registry lưu provider/model_id/version/capabilities/region/status/context/pricing_version. Profile theo tác vụ gồm allowed_models, effort theo capability, max_input/output, timeout, concurrency, output schema, tool allowlist, retention và classification. Không gửi tham số temperature/effort nếu model không hỗ trợ. Publish profile cần eval, review và rollback reference.

Trước gọi: kiểm tra quyền/gói → lọc dữ liệu → ước tính bound → reserve budget atomic ở các cấp tenant/đơn vị/project/user → dispatch. Khi xong: ghi actual usage, model thực tế, request_id; tính chi phí theo pricing_version và reconcile reservation. Timeout hoặc thiếu usage vào pending_reconcile; không giả định 0 đồng. Retry/fallback là attempt riêng và có thể tính phí. Hủy không bảo đảm hoàn phí.

Công thức normalized: cost = noncached_input × input_rate + cached_input × cached_rate + output_total × output_rate + tool/media/other_fee. Mỗi rate theo đơn vị provider (ví dụ triệu token). Reasoning tokens nếu đã nằm trong output_total thì không cộng lần hai. Nếu provider tính riêng, adapter khai báo meter riêng. Lưu tiền tệ gốc, tỷ giá và thời điểm; VND báo cáo là quy đổi, hóa đơn provider là căn cứ đối soát. Giá trong prototype không phải giá thị trường.

(Bổ sung 1.4 — CR-FRD-13) Bước "lọc dữ liệu" gồm xác định `data_classification` ∈ {PUBLIC, INTERNAL, CONFIDENTIAL, PERSONAL, IMPORTANT_CORE}; INTERNAL trở lên chỉ tới model trong nước/tự host qua gateway LiteLLM; PUBLIC hoặc đã ẩn danh tới model quốc tế chỉ khi D07 duyệt và tenant bật. Profile chỉ publish khi bộ eval do chuyên gia ký đạt ngưỡng trên mọi tuyến sẽ dùng (NFR-AI-01..04).

AC18: hai job đồng thời không vượt reservation khả dụng. AC19: fallback không chuyển hồ sơ sang vùng/provider bị cấm. AC20: key chỉ hiển thị fingerprint; secret nằm vault, không trả về browser. AC21: tắt khẩn cấp ngăn job mới, job đang chạy được đánh dấu và xử lý theo khả năng hủy provider.

## UC08 trung tâm tương tác đa kênh
Conversation có tenant, channel_account, external_thread_id, verified_contact, liên kết project/case và access policy. Tin nhắn phân biệt internal_note với external_message; nút gửi cho biết kênh và người nhận. Gộp danh tính cần xác minh, không ghép chỉ vì tên hiển thị giống nhau. Consent theo channel/purpose có nguồn, thời gian, revocation.

Inbound webhook kiểm tra chữ ký/token và replay window theo provider; persist rồi ACK; dedupe bằng event_id; xử lý async. Tệp vào quarantine trước khi mở. Email threading dùng Message-ID/In-Reply-To/References và kiểm tra membership; header bị giả mạo không đủ để cấp quyền hồ sơ. LLM có thể gợi ý trả lời nhưng không tự gửi trao đổi nghiệp vụ quan trọng.

(Bổ sung 1.4 — CR-FRD-14) Thời điểm kênh (một quy tắc, theo BRD): IN_APP, email công vụ và push có từ R1; kênh ngoài tới liên hệ cá nhân (Zalo OA/ZNS, WhatsApp, SMS, hội thoại hai chiều) chỉ bật khi D06 hoàn tất, không sớm hơn R2, mặc định R3 cho ZNS/WhatsApp; trước đó adapter mock có contract test. Chi tiết `05_modules/OMNI.md`; tiêu chí AC-OMNI-01..07 (UAT-AC22..25, UAT-AC195..199).

AC22: revoked consent chặn gửi mới theo mục đích bị thu hồi. AC23: ghi chú nội bộ không xuất sang Zalo/WhatsApp/email. AC24: gửi nhầm tenant/channel_account bị chặn tại service trước adapter. AC25: nội dung nhạy cảm gửi link xác thực thay vì đính toàn bộ hồ sơ.

## UC09 Notification Center
Workflow version gồm event schema, recipient resolver, conditions, template version, delay/digest, quiet hours, priority, fallback và escalation. Recipient resolver chạy trong tenant; quyền/consent kiểm lại trước send. Tin bắt buộc chỉ theo chính sách được phê duyệt, không coi “urgent” là quyền bỏ qua mọi consent. Gửi thử chỉ tới danh sách thử cho phép và gắn nhãn TEST.

Trạng thái: Created → Scheduled → Queued → Sending → ProviderAccepted → Delivered → Read nếu provider hỗ trợ; Acknowledged chỉ khi người dùng xác nhận nghiệp vụ. Nhánh Suppressed/Expired/Cancelled/Failed/Unknown riêng. Callback đến sai thứ tự không được hạ Delivered về Queued. Unknown cần reconcile trước resend để giảm gửi đôi. Khóa chống trùng duy nhất là `dedupe_key = 'n1:' || hex(sha256(tenant_id | source_event_id | recipient_id | purpose))`, UNIQUE theo tenant; kênh và phiên bản mẫu không nằm trong khóa (kênh là chiều của attempt; đổi mẫu không được sinh tin trùng khi replay). Mỗi lần gửi trên một kênh là một delivery attempt có `attempt_no`. (Cập nhật 1.4 — CR-FRD-04)

Lỗi 429/5xx retry với exponential backoff+jitter, tối đa 5 lần gửi mỗi kênh (1 lần đầu + 4 lần thử lại sau 30 giây, 2 phút, 10 phút, 30 phút, mỗi khoảng nhân jitter 0,8–1,2; tôn trọng `Retry-After` lớn hơn; không vượt `expires_at`); lỗi địa chỉ/token không hợp lệ dừng, thu hồi token tương ứng. DLQ lưu payload reference tối thiểu, lỗi, attempts; phát lại cần quyền và kiểm lại điều kiện, trạng thái Unknown phải đối soát trước, và không vượt trần 5 lần. Fallback tạo attempt kênh khác có liên kết, không đảm bảo exactly-once toàn mạng. Email opened là tín hiệu hạn chế, không là biên nhận pháp lý. Dashboard có delivered rate với denominator/cutoff rõ. (Cập nhật 1.4 — CR-FRD-04)

(Bổ sung 1.4 — CR-FRD-04) "Unknown" ở đây là trạng thái kết quả giao tin chưa xác định (cũng dùng cho lệnh mobile UNKNOWN ở UC20); không dùng "Unknown" cho dữ liệu chưa đánh giá chất lượng/trưởng thành — trường hợp đó là NotAssessed (UC14). Nguồn chuẩn: `05_modules/NOT.md` BR-NOT-01 (CR-NOT-01), BR-NOT-03 (CR-NOT-02), BR-NOT-06; tiêu chí AC-NOT-01..10 (UAT-AC26..30, UAT-AC176..194).

AC26: replay một event không nhân đôi notification. AC27: quiet hours theo timezone người nhận; critical override có audit. AC28: push không chứa số tiền/hồ sơ mật trên khóa màn hình. AC29: provider outage không chặn transaction gửi báo cáo. AC30: mọi chiến dịch diện rộng có preview recipient count, exclusion và maker-checker.

## UC10 BI động và drill down toàn bộ chỉ tiêu
Semantic metric lưu ID, version, grain, type [additive, semi_additive, ratio, distinct], expression AST cho phép, dimensions, unit, null policy, source và owner. Dashboard version tham chiếu metric version, dataset version, layout theo breakpoint và filter mappings. Publish có kiểm tra quyền, công thức và khả năng tái tạo. Không cho người dùng thường nhập SQL tùy ý; nguồn dữ liệu chỉ qua connector do quản trị cho phép.

DrillContext gồm tenant, principal_scope_hash, metric_version, snapshot_id, as_of, filters, currency/unit và path. Mỗi bước kế thừa filters, thêm dimension/member, server kiểm quyền; breadcrumb quay lại đúng context. Tỷ lệ = tổng tử / tổng mẫu, không cộng/trung bình tỷ lệ từng hàng. Lũy kế lấy snapshot accepted cuối phù hợp as_of, không SUM các tuần. Distinct count có cảnh báo không cộng được nếu nhóm chồng lấn.

Tổng và con phải reconcile: có nhóm Chưa phân loại và điều kiện loại trừ minh bạch. Khi một phần drill bị hạn chế, không làm lộ đối tượng; chính sách phải chọn tổng theo quyền hiện tại hoặc tổng công bố đã được duyệt độc lập, ghi nhãn rõ. Mọi export, email snapshot và chart cache dùng cùng policy. KPI AI/model/notification/SaaS cũng drill tới usage event/delivery attempt/invoice line; không ép mọi số liệu về dự án.

(Bổ sung 1.4 — CR-FRD-10) Mọi truy vấn BI nhận `as_of_period`; số liệu kỳ đọc từ PeriodSnapshot FROZEN của DIS trên read replica, không tính lại từ OLTP mỗi lần mở; metric definition là dữ liệu có version. Badge chất lượng đọc kết quả DGV khi có, nếu chưa có thì hiển thị NotAssessed (UC19).

AC31: đổi dimension không đổi snapshot. AC32: nhóm con cộng lại tổng đối với additive metric cùng scope; ratio tái tính từ tử/mẫu. AC33: người tenant A không thể sửa drill token để xem B. AC34: stale cache bị phân biệt với nguồn mới; refresh tạo context mới có thông báo. AC35: chia sẻ dashboard không tự cấp quyền dữ liệu.

## UC11 SaaS đa tenant branding và billing
Provisioning là saga Temporal 11 bước (IdP organization, DNS/TLS, storage prefix, DB placement, kiểm RLS, entitlement, license, seed vai trò, đơn vị gốc, theme v1, mời Tenant Owner). Vòng đời tenant là một máy trạng thái duy nhất 7 trạng thái: Requested → Provisioning → Active; Provisioning → Failed khi bước lỗi vượt retry; Failed → Provisioning (retry tiếp từ bước lỗi) hoặc Failed → Archived (bù trừ ngược thứ tự); Active → Suspended → Active (resume); Active/Suspended → Offboarding (cửa sổ xuất dữ liệu) → Archived (khi gói xuất đã giao hoặc hết cửa sổ); Offboarding → Active khi gia hạn trong cửa sổ. Chuyển ngoài bảng trả 409 `TENANT_STATE_INVALID`. Retry từng bước idempotent. Hostname đã xác minh ánh xạ tenant nhưng user vẫn phải có membership. Branding token được validate schema, MIME/logo size và tương phản; cấm arbitrary JS/CSS. Custom domain cần TXT verification, TLS renew, chống domain takeover khi offboard. (Cập nhật 1.4 — CR-FRD-03)

Subscription chứa plan version, cycle, billing anchor, payment terms; usage meter immutable với dedupe event key. Seats định nghĩa named active users hay concurrent phải chốt hợp đồng; mặc định thiết kế là named active memberships, không tính service accounts trừ chính sách riêng. Nâng gói effective_now hoặc next_cycle, proration có preview; hạ gói không xóa dữ liệu, chặn tạo mới vượt quota và hướng dẫn giảm usage.

(Bổ sung 1.4 — CR-FRD-03) Tenant là cơ quan chủ quản (R6); placement mặc định pool (RLS), nâng silo bằng cùng mã provisioning với đối chiếu row count/checksum/tổng tiền và người duyệt cutover khác người khởi tạo. Hóa đơn điện tử theo NĐ 123/2020 sửa bởi NĐ 70/2025: không có lệnh hủy hóa đơn đã phát hành; sai sót dùng hóa đơn điều chỉnh hoặc thay thế có lý do và văn bản [CXN-INV-02]. Thanh toán quá hạn không tự đổi trạng thái tenant/license (BR-SAS-04). Theme SAS-04: xem `03_Engineering/Tenant_Theme_Specification.html`. Chi tiết `05_modules/SAS.md` (CR-SAS-01); tiêu chí AC-SAS-01..13 (UAT-AC36..44, UAT-AC145..175).

AC36: duplicate payment webhook không nhân đôi invoice/payment. AC37: payment thất bại không lập tức xóa dữ liệu tenant. AC38: hỗ trợ truy cập nội dung phải có owner consent, ticket, thời hạn và audit. AC39: tenant export gồm dữ liệu, file manifest và checksum; hết hợp đồng giữ legal hold theo chính sách đã chốt.

## UC12 license từng tenant
License có license_id, tenant_id, serial, edition, entitlement_version, seats/quota, valid_from, valid_until, grace_until, issuer, issued_at, signature_key_id, status và supersedes. Trạng thái Draft → Issued → Active → Grace → Expired; Suspended/Revoked có lý do; gia hạn tạo revision mới và bản cũ chuyển Superseded. Expiring là nhãn tính toán theo ngưỡng (mặc định 30 ngày trước valid_until), không phải trạng thái và không làm mất quyền. Server clock UTC quyết định hiệu lực, UI hiển thị timezone tenant. (Cập nhật 1.4 — CR-FRD-05)

Quyền hiệu lực = membership ∩ role/scope ∩ license entitlements ∩ feature policy; suspended tenant hoặc revoked license có thể deny theo chính sách. Gia hạn tạo revision/signed license mới liên kết bản cũ, không sửa lịch sử. Cấp license khác tenant, start≥end hoặc quota âm bị từ chối. License private deployment có signed claims, key rotation và thời hạn offline lease; cache không được kéo dài quyền vô hạn. Offline lease là tùy chọn Private, không thay kiểm tra server của SaaS chuẩn.

AC40: đúng valid_until chuyển grace/expired theo định nghĩa biên [from,until). AC41: grace chỉ giữ những quyền hợp đồng cho phép, mặc định hạn chế thay đổi thương mại/AI. AC42: expired chỉ đọc/xuất nếu policy cho phép; không xóa dữ liệu. AC43: admin tenant không tự gia hạn license. AC44: thu hồi có audit, thông báo và invalidation cache trong SLO đề xuất 60 giây.

## UC13 quản trị dữ liệu chủ và danh mục

Master record có business_key, tenant/namespace, version, valid_from/valid_until, source, steward và trạng thái Draft → InReview → Approved → Effective → Retired. MDM-01..33 bao phủ tổ chức, địa bàn, nguồn vốn, chương trình, dự án, nhà thầu, Kho bạc, lịch báo cáo, loại vướng mắc, workflow và các mã dùng chung. Namespace quốc gia do platform phát hành có chữ ký phiên bản; tenant chỉ ánh xạ hoặc bổ sung namespace riêng, không ghi đè âm thầm. Một record được sử dụng trong báo cáo phải tham chiếu phiên bản master đã có hiệu lực tại ngày nghiệp vụ.

Đề nghị thay đổi có before/after, lý do, file căn cứ và impact preview số bản ghi/dashboard/tích hợp bị ảnh hưởng. Người đề nghị không tự duyệt khi policy yêu cầu tách nhiệm vụ. Đổi tên giữ business identity; sáp nhập/tách đơn vị tạo mapping hiệu lực theo thời gian. Không xóa master đã được tham chiếu. Duplicate detection chỉ gợi ý; merge cần review, giữ alias và đường dẫn tới bản gốc. Import staging có kiểm schema, duplicate, FK, thời gian hiệu lực, preview lỗi từng dòng; publish theo batch atomic hoặc chế độ partial được chọn rõ, có kết quả và khả năng resume bằng idempotency key.

(Bổ sung 1.4 — CR-FRD-10) Baseline 1.4 mở rộng MDM tới MDM-37: crosswalk mã ngoài (Kho bạc, mã dự án TTQG, muasamcong) với một crosswalk ACTIVE duy nhất mỗi mã ngoài; merge theo survivorship từng thuộc tính và unmerge đảo được; baseline cải cách 2025 (tỉnh/xã, kế thừa đơn vị) [CXN-34]; glossary nghiệp vụ có quy trình đề xuất/duyệt/công bố (người đề xuất không tự duyệt, một bản PUBLISHED mỗi mã) — glossary của DGV dùng chung danh mục này. Chi tiết `05_modules/MDM.md`; tiêu chí AC-MDM-01..09 (UAT-AC45..49, UAT-AC273..284).

AC45: mã trùng trong cùng tenant/namespace bị chặn; mã giống ở hai tenant độc lập không làm lộ dữ liệu. AC46: khoảng hiệu lực của hai version cùng business_key không chồng lấn. AC47: retire đơn vị không làm đổi tên lịch sử trong báo cáo đã gửi. AC48: lỗi import không thay dữ liệu đang có hiệu lực; retry không nhân đôi. AC49: thay đổi có impact preview và audit trước khi publish; báo cáo cũ vẫn truy được master version gốc.

## UC14 chất lượng, lineage và sự trưởng thành dữ liệu

Data catalog đăng ký dataset, grain, owner/steward, schema version, classification, retention, nguồn và SLA freshness. Contract bao gồm cấu trúc, quy tắc nghiệp vụ, kỳ vọng completeness/uniqueness/timeliness và tolerance đối soát; breaking change cần version mới, cửa sổ migration và consumer approval. DGV-01..18 gồm catalog, glossary, lineage, quality rules, quality runs, exception queue, reconciliation, maturity assessment, evidence và remediation. Lineage nối nguồn → staging → mapping → record/version → metric/version → dashboard/export; cạnh có run_id, transform version và thời gian.

Quality run đóng dấu snapshot; lỗi hard-block vào quarantine, warning cho phép xử lý có quyền và lý do. Exception có owner, severity, due_at, evidence và quyết định resolve/waive với expires_at. Waive không sửa số liệu và không xóa lịch sử lỗi. Dashboard hiển thị freshness, coverage và số ngoại lệ; giá trị thiếu hoặc chỉ tiêu chưa đo hiển thị NotAssessed hoặc "Chưa có dữ liệu", không đổi thành zero. Đối soát tiền dùng cùng kỳ/currency/basis; chênh lệch phải phân loại missing, timing, reversal, mapping hoặc amount, không tự lấy bên có số lớn hơn. (Cập nhật 1.4 — CR-FRD-06)

Assessment gồm 8 trụ cột, tiêu chí mức 1–5, evidence, reviewer và assessment period. Thiếu bằng chứng là NotAssessed; không tự gán điểm 1 hoặc tính vào trung bình. Chỉ tính score nếu đạt coverage tối thiểu được phê duyệt; công bố kèm coverage/weights và evidence links. Điểm mục tiêu 9–10/10 của sản phẩm là rubric cạnh tranh đề xuất; cần benchmark/pilot độc lập để xác nhận.

(Bổ sung 1.4 — CR-FRD-06) Thuật ngữ thống nhất với `08_Quan_tri_du_lieu_va_truong_thanh.md`: **NotAssessed** là trạng thái duy nhất cho "chưa có bằng chứng/chưa đánh giá" (maturity, chất lượng dataset chưa có quality run); không dùng "Unknown" cho nghĩa này. Data contract theo cấu trúc ODCS (producer, consumer, grain, khóa, schema/version, semantics null, đơn vị, classification, SLO freshness, quy tắc DQ, retention); quy tắc DQ → kết quả → incident có assignee, severity, hạn và xác minh; đánh giá trưởng thành tham chiếu khung CMMI DMM và DCAM có bằng chứng (rubric riêng, không phải chứng nhận). Legal hold và thời hạn lưu trữ là dữ liệu (RetentionPolicy, legal hold của ADM). Tiêu chí riêng của DGV sẽ do `05_modules/DGV.md` cấp (chưa phát hành khi viết); AC50–AC55 vẫn là tiêu chí bắt buộc.

AC50: schema breaking change bị chặn nếu consumer chưa chấp thuận. AC51: quarantine record không đi vào metric certified; dashboard thể hiện phần bị loại. AC52: từ KPI truy được metric version, snapshot, transform và record nguồn đúng quyền. AC53: maturity thiếu evidence hiển thị NotAssessed và không tạo điểm tổng sai. AC54: waiver hết hạn tự mở lại issue theo policy, có audit. AC55: RLS/masking vẫn áp dụng với catalog search, lineage, quality evidence và export.

## Ma trận kiểm soát theo vai trò
Chủ đầu tư tạo/sửa nháp và gửi hồ sơ của đơn vị; không phê duyệt tổng hợp toàn tỉnh. Chuyên viên kiểm tra/return/accept theo phân công; không sửa silent số của người gửi. Lãnh đạo approve trong thẩm quyền, không sửa chứng từ gốc. Auditor read/export theo scope, không mutate. Tenant Admin cấu hình người dùng, cây đơn vị và workflow; quyền đọc hồ sơ nghiệp vụ là grant độc lập. AI Admin publish model/profile qua review; không quyết định kết quả thầu. Billing Admin (FinOps) xem tiền thuê bao/usage, không đọc đề án. Platform Operator xem health, chỉ access nội dung qua break-glass đã duyệt. System Admin cấu hình tenant, thương hiệu, license ở control plane, không đọc nội dung nghiệp vụ. Contractor Guest chỉ thao tác trên hợp đồng được mời. Data Protection Officer xử lý consent và yêu cầu chủ thể dữ liệu. Mọi role đều bị tenant boundary và classification chi phối. (Cập nhật 1.4 — CR-FRD-07)

## Hoàn thành chức năng và nghiệm thu
Catalogue chứa 327 yêu cầu gắn màn hình của baseline 1.3 (giữ nguyên mã) cộng các yêu cầu mới của baseline 1.4 đánh mã nối tiếp; `screen_catalog.json` là nguồn duy nhất của số lượng. Trạng thái/vai trò dùng chung được thiết kế theo ma trận, không nhân bản vô hạn thành từng file màn hình. Hoàn thành yêu cầu khi có UI, API, validation, phân quyền, audit, event, lỗi, telemetry và ca UAT phù hợp. Prototype minh họa không chứng minh đã đạt các AC production. Các bước duyệt pháp lý, tài khoản tích hợp và dữ liệu pilot vẫn là đầu vào cần chốt trước xây dựng. (Cập nhật 1.4 — CR-FRD-08)


## UC15 lựa chọn nhà thầu và vòng đời hợp đồng

Kế hoạch lựa chọn liên kết dự án/nguồn vốn/quyết định phê duyệt, gói thầu có budget ceiling và schedule; điều chỉnh tạo revision. Lịch mời/đóng/mở thầu và kết quả được nhập hoặc đối soát nguồn chính thức theo quyền tích hợp được cấp. Cổng này không tự thay thế Hệ thống mạng đấu thầu quốc gia. Chuyên gia khai báo conflict of interest trước xem hồ sơ; hồ sơ bị hạn chế cho tới thời điểm và vai trò được phép. Kết quả AI chỉ là đầu vào kiểm chứng, không tự quyết định loại/chọn nhà thầu. Kiến nghị theo case, hạn và hồ sơ căn cứ.

Hợp đồng Draft → InReview → Signed → Active → Completed → Closed, với Suspended/Terminated có quyết định. BOQ, đơn giá, thuế, retention, advance recovery và payment milestones được version theo điều khoản; không áp công thức chung sai loại hợp đồng. Bảo lãnh có issuer, currency, amount, expiry, authenticity check và release evidence. Phụ lục qua change request đánh giá chi phí/tiến độ/phạm vi/nguồn vốn trước duyệt, không sửa số gốc. Thanh toán liên kết khối lượng nghiệm thu và hợp đồng version; phần đã trả không được thanh toán lặp bằng đổi mã hồ sơ.

(Bổ sung 1.4 — CR-FRD-11) Chuỗi thay đổi hợp đồng ChangeEvent → PotentialChangeOrder → ChangeOrder (số tầng cố định sau lần dùng đầu); giữ lại bảo hành theo dòng; DoA theo số tiền/loại/đơn vị và maker ≠ checker (ADM). Kết quả lựa chọn nhà thầu từ muasamcong nhập qua tệp (không có API công khai). Nhà thầu truy cập bằng Contractor Guest với scope hợp đồng.

AC56: chuyên gia có conflict bị chặn hoặc cần quyết định xử lý được ghi audit. AC57: giá vượt trần hoặc kế hoạch chưa duyệt bị chặn theo rule đã chốt. AC58: phụ lục chưa hiệu lực không đổi BOQ thanh toán; hồi tố cần quy trình điều chỉnh riêng. AC59: bảo lãnh sắp hết hạn có notification, không tự đánh dấu gia hạn. AC60: duplicate invoice/measurement/payment reference phát hiện trong tenant và hợp đồng; override có căn cứ. AC61: tổng lũy kế thu hồi tạm ứng không vượt gốc tạm ứng sau điều chỉnh hợp lệ.

## UC16 thực hiện, nghiệm thu, bàn giao và quyết toán

Nhật ký có ngày, WBS/BOQ, công việc, nguồn lực, ảnh và người ghi. Measurement revision ghi khối lượng kỳ/lũy kế và bằng chứng; không chấp nhận lũy kế giảm mà thiếu correction reference. Checklist chất lượng/NCR có severity, corrective action, evidence và approval đóng. Nghiệm thu cần danh tính, thẩm quyền, biên bản và version; chữ ký điện tử/ký số theo nhà cung cấp và quy chế được xác nhận, nút prototype không có giá trị ký. Dossier thanh toán lưu giá trị gross, advance recovery, retention, tax và net theo từng điều khoản, nguồn/currency, kiểm tra phương trình được cấu hình trước chuyển Kho bạc.

Bàn giao có punch list, recipient, commissioning docs và asset register link; chưa khắc phục tồn tại trọng yếu thì chưa đóng theo policy. Bảo hành theo hạng mục/điều khoản, cảnh báo hạn và giải tỏa bảo lãnh theo bằng chứng. Quyết toán đối chiếu approved investment, hợp đồng/phát sinh, nghiệm thu, giải ngân, công nợ, tạm ứng, audit finding; chênh lệch có căn cứ và phê duyệt. Chốt dự án không xóa hồ sơ, legal hold và retention tiếp tục áp dụng. Hình thành tài sản có nguồn giá trị và đơn vị tiếp nhận; tích hợp tài sản là hợp đồng dữ liệu riêng.

(Bổ sung 1.4 — CR-FRD-11) Ranh giới phân hệ: nhật ký thi công, kiểm tra và biên bản nghiệm thu chất lượng thuộc QMS (UC24); khối lượng nghiệm thu dùng cho thanh toán (`VolumeAcceptance`) thuộc CTR và chỉ APPROVED khi có sự kiện `qms.quality_acceptance.approved.v1` nếu hợp đồng yêu cầu; dossier thanh toán và sổ lũy kế thuộc PAY (UC04, R7); bàn giao tài sản và bảo hành thuộc AST (UC26); kết luận thanh tra/kiểm toán thuộc AUD (UC25). Mẫu thanh toán/quyết toán theo NĐ 254/2025 và TT 91/2025 [CXN-08], dựng qua DOC.

AC62: hai thiết bị sync cùng nhật ký không nhân đôi; conflict không ghi đè silent. AC63: measurement chưa duyệt không được dùng cho nghiệm thu/payment certified. AC64: số net không cân với các cấu phần thì chặn gửi; rounding dùng quy tắc currency/contract version. AC65: bàn giao phải truy được tồn tại, tài sản, biên bản và đơn vị nhận. AC66: close khi còn công nợ/tạm ứng cần exception approval, không tự coi bằng zero. AC67: toàn bộ chuỗi dự án → hợp đồng → measurement → acceptance → payment → treasury → settlement truy vết được theo tenant và phiên bản.

## Use case bổ sung baseline 1.4 (UC17–UC28)
(Bổ sung 1.4 — CR-FRD-01) Các phân hệ chưa có use case ở baseline 1.3 (IAM, ADM, HOME, MOB, PRJ) và 7 phân hệ mới (DOC, LND, PMT, QMS, AUD, AST, MNE). Mỗi UC nêu actor, luồng chính/thay thế, quy tắc và tiêu chí nghiệm thu; chi tiết state machine, API, dữ liệu và test nằm trong đặc tả phân hệ. Với phân hệ chưa có tệp đặc tả khi viết (DOC, LND, PMT, QMS, AUD, AST), FRD liệt kê "tiêu chí cần phủ" không gán mã; mã `AC-<MÃ>-NN` và dải `UAT-AC` do đặc tả phân hệ cấp khi phát hành, không trùng dải đã dùng (bảng dải ở mục Truy vết). Màn hình mới của các phân hệ này đánh mã `<MÃ>-NN` nối tiếp trong `screen_catalog.json` và theo mockup (D-B11).

## UC17 đăng nhập, chọn tenant và quyền hiệu lực (IAM)
(Bổ sung 1.4 — CR-FRD-01) Actor: mọi người dùng nhân sự, Contractor Guest, System Admin (control plane), service account. Màn hình IAM-01..09. Tiền điều kiện: `user_account` Active; có ít nhất một membership Active trong khoảng hiệu lực.
Luồng chính: (1) đăng nhập OIDC Authorization Code + PKCE qua Keycloak; MFA TOTP/WebAuthn khi vai trò yêu cầu; (2) IAM-04 chọn tenant/membership bằng `selectTenantContext` — server kiểm membership thuộc chính người dùng, Active, tenant Active hoặc Suspended (chế độ chỉ đọc), MFA theo vai trò đích; cấp token gắn `tid`, `mid`, `sv` (scope_version); thu hồi token tenant cũ; (3) mọi request đi qua điểm quyết định quyền (PDP): token → `SET LOCAL app.tenant_id` → quyền hiệu lực = grant Active trên scope chứa tài nguyên ∪ ủy quyền Active, giao entitlement và feature policy của license → kiểm `x-permission`, entitlement, classification, step-up `aal2` cho phê duyệt/cấp quyền/lệnh tiền; (4) IAM-09 hiển thị phạm vi quyền hiệu lực.
Luồng thay thế: chấp nhận lời mời (token 32 byte, hạn 7 ngày, email khớp, còn ghế); khôi phục truy cập với phản hồi không phân biệt email tồn tại; thu hồi phiên của mình (hiệu lực ≤ 60 giây, mobile xóa DB cục bộ); tìm kiếm toàn hệ thống chỉ trong scope, không trả tổng khi có phần bị lọc; yêu cầu hỗ trợ (ticket là điều kiện cần nhưng chưa đủ để operator xem dữ liệu, xem UC11 support access).
Lỗi: 403 `TENANT_SELECTION_INVALID`, `MEMBERSHIP_INACTIVE`, `TENANT_SUSPENDED`, `MFA_REQUIRED`; tài nguyên ngoài tenant/scope trả 404.
Quy tắc: BR-IAM-01..09 (scope TENANT, UNIT_SUBTREE, UNIT_ONLY, PROJECT, CONTRACT theo cây đơn vị có hiệu lực; chống tự nâng quyền: không cấp vai trò bằng hoặc cao hơn vai trò cao nhất của mình, không tự cấp, không vượt scope, không chứa quyền `system.*`; Contractor Guest bắt buộc `contractor_id` và hạn).
Tiêu chí nghiệm thu: AC-IAM-01..09 trong `05_modules/IAM.md` (UAT-AC100..109, UAT-AC115, UAT-AC119..125) — cách ly tenant A↛B trả 404 ở API/tìm kiếm/xuất; chọn tenant sai trả 403 không cấp token; đổi tenant trên mobile xóa dữ liệu cũ; chống tự nâng quyền; khách nhà thầu mất quyền ≤ 60 giây khi hợp đồng đóng; phê duyệt cần step-up; thu hồi quyền p95 ≤ 60 giây; phản hồi không lộ tồn tại email. AC38 và AC44 của baseline áp dụng.

## UC18 quản trị tenant, thẩm quyền phê duyệt và dịch vụ nền tảng (ADM)
(Bổ sung 1.4 — CR-FRD-01) Actor: Tenant Admin, Unit Admin, Security Admin, người lập và người duyệt cấu hình, Auditor (đọc audit). Màn hình ADM-01..18.
Luồng chính: (1) quản lý cây đơn vị có hiệu lực và tổ chức lại (sáp nhập, chia tách, đơn vị kế thừa) — thành viên, grant và dự án của đơn vị cũ chuyển sang đơn vị kế thừa, báo cáo lịch sử giữ tên cũ; (2) mời thành viên nhân sự và Contractor Guest, cấp/thu hồi role grant và ủy quyền có thời hạn theo luật chống tự nâng quyền của IAM; (3) lập ma trận thẩm quyền phê duyệt (DoA: loại hồ sơ × số tiền × đơn vị, dải `[min,max)` không khe hở/chồng lấn) → người khác công bố; (4) công bố workflow version phê duyệt cho các business_type (report.accept, plan.publish, payment.approve, contract.change, period.reopen) chạy trên Temporal; instance ghim phiên bản DoA/workflow lúc khởi tạo; (5) lịch làm việc/ngày nghỉ cho SLA; (6) chính sách lưu trữ và legal hold; (7) audit bất biến có seal, xuất audit; (8) nhập chuyển đổi dữ liệu theo lô có dry-run và tổng kiểm soát.
Luồng thay thế/lỗi: người lập hồ sơ hoặc người nhận ủy quyền của chính người lập không được duyệt (403 `SELF_APPROVAL_DENIED`); hai quyết định đồng thời chỉ một hiệu lực; hồ sơ bị rút thì workflow kết thúc mà không có chuyển trạng thái ngoài bảng transition; công bố workflow mới không đổi bước của instance đang chạy; tệp chuyển đổi đã đăng ký không nhập lại.
Quy tắc: ADM cung cấp dịch vụ nền tảng dùng chung (audit, outbox, idempotency, legal hold); trạng thái kỳ báo cáo thuộc DIS, ADM chỉ cung cấp quy trình duyệt `period.reopen`; Tenant Admin không có quyền thương hiệu và không mặc nhiên đọc hồ sơ nghiệp vụ.
Tiêu chí nghiệm thu: AC-ADM-01..11 trong `05_modules/ADM.md` (UAT-AC110..114, UAT-AC116..118, UAT-AC126..144) — người duyệt đúng dải DoA ở biên; DoA hở/chồng bị 422; chặn tự duyệt; đồng thời một hiệu lực; instance không đổi bước; SLA theo giờ làm việc; tổ chức lại chuyển 100% thành viên/grant/dự án; legal hold chặn purge; phát hiện sửa audit ngoài ứng dụng ≤ 1 giờ; chuyển đổi không nhập lại. AC05 của baseline áp dụng.

## UC19 điều hành và trung tâm điều hành giải ngân (HOME)
(Bổ sung 1.4 — CR-FRD-01) Actor: lãnh đạo UBND/Sở, lãnh đạo phụ trách dự án, trưởng tổ công tác, chuyên viên tổng hợp (đọc). Màn hình HOME-01..10 (HOME-09 trung tâm điều hành, HOME-10 ngữ cảnh số liệu/truy nguồn). HOME không sở hữu bảng ghi.
Luồng chính: (1) mở tổng quan — mọi tile đọc PeriodSnapshot FROZEN của DIS và hiển thị scope, as_of, mã snapshot, công thức; hai tỷ lệ giải ngân cạnh nhau [CXN-03]; (2) xem cảnh báo sớm, xếp hạng đơn vị, giải trình quá hạn, đề xuất điều chuyển chờ duyệt, việc của tôi [CXN-33]; (3) drill nhiều cấp tới báo cáo revision và giao dịch Kho bạc, mỗi cấp giữ snapshot và kiểm quyền lại ở đích; (4) giao việc/yêu cầu giải trình qua PRJ.
Luồng thay thế: scope bị thu hồi sau khi mở trang → drill trả 403 `SCOPE_DENIED` không lộ tên hồ sơ; thiếu dữ liệu/mẫu số 0 → nhãn chữ, không 0%; báo cáo điều chỉnh chưa chấp nhận → số không đổi; DGV chưa có quality run → badge NotAssessed ("Chưa đánh giá chất lượng"), HOME vẫn hoạt động (DGV là phụ thuộc mềm từ R2, CR-HOME-01).
Tiêu chí nghiệm thu: AC-HOME-01..07 trong `05_modules/HOME.md` (UAT-AC04, UAT-AC06, UAT-AC266..272); AC31–AC35 của UC10 áp dụng cho drill.

## UC20 ứng dụng di động, đồng bộ offline và hàng đợi lệnh (MOB)
(Bổ sung 1.4 — CR-FRD-01) Actor: lãnh đạo, cán bộ báo cáo, cán bộ hiện trường, kế toán, Contractor Guest. Ứng dụng Flutter (D-B12) dùng chung API; màn hình MOB-01..68 (mới MOB-67 Văn bản chờ ký, MOB-68 Nhiệm vụ GPMB hiện trường).
Luồng chính: L1 đăng nhập (nhận diện tenant → OIDC + PKCE → MFA → chọn đơn vị/vai trò → xin quyền khi cần); L2 báo cáo tuần MOB-13→21 cùng command/DTO với web (UC01); L3 phê duyệt MOB-23→26, 65, 67 chỉ khi online, có step-up, không duyệt bằng swipe hoặc một chạm từ push; L4 hiện trường MOB-28→31, 62→64, 68 (ảnh, vị trí chỉ khi người dùng đồng ý, vị trí thủ công có nhãn); L5 offline/đồng bộ MOB-41→43; L6 AI có nguồn MOB-37→39.
Đồng bộ: PowerSync đọc WAL nên không đi qua RLS; cách ly nằm ở sync rules tham số hóa theo tenant trong JWT do backend cấp và phạm vi membership (`sync_membership_scope`: cây đơn vị/dự án/hợp đồng) (A1); thu hồi quyền làm bucket rỗng ở lần sync kế; đăng xuất/đổi tenant xóa DB cục bộ; trường tiền chỉ đọc khi offline.
Hàng đợi lệnh: mỗi thao tác ghi offline là một lệnh có Idempotency-Key (`local_uuid`) và `base_server_version`, trạng thái QUEUED → SENDING → ACCEPTED/REJECTED/CONFLICT, mất kết nối khi đang gửi → UNKNOWN (hiển thị "Chưa xác định kết quả", tra `GET /sync/commands/{key}` khi nối lại, không tự tạo lệnh mới), người dùng có thể DISCARDED lệnh chưa gửi. Xung đột tiền phải người dùng chọn, không last-write-wins (409 `DRAFT_VERSION_CONFLICT`). Không đổi tenant khi còn lệnh chưa gửi trừ khi người dùng chủ động hủy.
Tiêu chí nghiệm thu: AC-MOB-01..04 trong `05_modules/MOB.md` (UAT-AC500..507); AC28, AC62 của baseline áp dụng.

## UC21 văn bản, báo cáo, quyết định theo chuẩn nhà nước (DOC)
(Bổ sung 1.4 — CR-FRD-01) Actor: chuyên viên soạn thảo, lãnh đạo ký, văn thư (cấp số, đóng dấu số cơ quan, phát hành, đăng ký văn bản đến), người nhận xử lý. Phân hệ khác (MNE, CAP, PRJ, PAY, AUD) yêu cầu phát hành qua sự kiện, tham chiếu bằng `subject_ref (module, id)`.
Luồng chính văn bản đi: chọn mẫu (DocumentTemplate có `legal_basis`, `form_code`, `effective_from/to`; thể thức theo NĐ 30/2020 Phụ lục I) → soạn DRAFT → IN_REVIEW → SUBMITTED → lãnh đạo ký PAdES trên PDF cuối (revision n) → SIGNED → văn thư cấp số và ngày bằng cập nhật gia tăng (incremental update) rồi ký số cơ quan bao toàn bộ → NUMBERED+ORG_SEALED → ISSUED → DELIVERED/ACK → FILED → ARCHIVED; nhánh RECALLED, REPLACED, CORRECTED. Văn bản đến: RECEIVED → REGISTERED → ASSIGNED → PROCESSING → RESOLVED → FILED.
Luồng thay thế (R8): đường (ii) tải lên văn bản đã ký bên ngoài → xác minh chữ ký và chuỗi chứng thư → đăng ký số → ISSUED; là đường chính của R1 nếu chưa có CA sandbox. Mock ký chỉ dùng cho test tự động.
Quy tắc: số văn bản theo sổ đăng ký (tổ chức × năm, phạm vi cấu hình), bắt đầu từ 01 mỗi năm, cấp sau khi ký, không hậu tố a/b; cấp số đồng thời dùng khóa hàng sổ đăng ký trong transaction, không sequence toàn cục (P3); ký hiệu `{loại}-{cơ quan}`; chữ ký số theo NĐ 23/2025 [CXN]; liên thông qua LGSP của cơ quan khách hàng [CXN-06]; thời hạn lưu trữ là dữ liệu (RetentionPolicy) [CXN-05]; legal hold chặn hủy.
Tiêu chí cần phủ (mã AC-DOC-NN do `05_modules/DOC.md` cấp): hai văn thư cấp số đồng thời nhận hai số khác nhau, liên tiếp, không hậu tố; sau cấp số và ký số cơ quan cả hai chữ ký vẫn xác minh hợp lệ; văn bản đã ký bị sửa nội dung thì xác minh báo không hợp lệ; mẫu dùng bản có hiệu lực tại ngày ký; người soạn không tự ký thay khi không có ủy quyền (KT./TL./TUQ. theo ADM); văn bản tenant A không mở được từ tenant B.

## UC22 giải phóng mặt bằng, bồi thường, hỗ trợ, tái định cư (LND)
(Bổ sung 1.4 — CR-FRD-01) Actor: cán bộ GPMB của chủ đầu tư/tổ chức làm nhiệm vụ bồi thường, cán bộ hiện trường (MOB-68), người duyệt phương án, kế toán chi trả, Data Protection Officer.
Luồng chính: lập danh sách thửa đất và hộ bị ảnh hưởng (LandParcel, AffectedHousehold) → kiểm đếm hiện trường → lập phương án bồi thường, hỗ trợ, tái định cư (CompensationPlan) có phiên bản và quyết định qua DOC → chi trả (CompensationPayment) liên kết tạm ứng GPMB và sổ tiền PAY → theo dõi khiếu nại (LandComplaint) → mốc tiến độ mặt bằng bàn giao cho dự án/hợp đồng.
Luồng thay thế: điều chỉnh phương án tạo revision có lý do; khiếu nại mở đặt legal hold lên hồ sơ hộ liên quan; chậm mốc tạo vướng mắc ISS và cảnh báo.
Quy tắc: dữ liệu hộ dân, CCCD là PERSONAL theo Luật BVDLCN 91/2025 + NĐ 356/2025 — bảng có policy RESTRICTIVE theo scope, che trong DTO/export, không sync xuống mobile trừ trường được phép theo vai trò, AI chỉ tới tuyến trong nước (R5); mốc thời gian theo Luật Đất đai 2024 và NĐ 88/2024 (90/180/30/30 ngày) và thu hồi tạm ứng GPMB trong 30 ngày là [CXN]; tiền là VND nguyên, không last-write-wins.
Tiêu chí cần phủ (mã AC-LND-NN do `05_modules/LND.md` cấp): người không có scope không đọc được dữ liệu hộ (404) kể cả qua tìm kiếm/xuất; tổng chi trả không vượt phương án đã duyệt; chi trả trùng hộ/khoản bị chặn dù khác idempotency key; mốc quá hạn sinh cảnh báo đúng một lần; hồ sơ dưới legal hold không bị xóa/ẩn danh.

## UC23 hồ sơ pháp lý và giấy phép dự án (PMT)
(Bổ sung 1.4 — CR-FRD-01) Actor: cán bộ chủ đầu tư/Ban QLDA, chuyên viên theo dõi pháp lý, lãnh đạo (đọc).
Luồng chính: lập hồ sơ pháp lý theo dự án (PermitDossier) gồm các giấy phép/thủ tục bắt buộc theo loại dự án (đánh giá tác động môi trường/giấy phép môi trường, thẩm định, phòng cháy chữa cháy, giấy phép xây dựng…) → ghi mốc nộp/tiếp nhận/cấp (PermitMilestone) với văn bản DOC → theo dõi hạn hiệu lực → cảnh báo sắp hết hạn/chậm cấp → tạo vướng mắc ISS khi bị chặn.
Quy tắc: danh mục thủ tục theo loại dự án là dữ liệu có `legal_basis` và hiệu lực (Luật Xây dựng 135/2025, NĐ 217/2026 và văn bản liên quan [CXN]); giấy phép không bị sửa sau khi ghi nhận cấp — điều chỉnh tạo bản mới liên kết; mốc dự án ở PRJ/CTR có thể phụ thuộc giấy phép (không khởi công khi thiếu giấy phép bắt buộc nếu rule bật chế độ chặn).
Tiêu chí cần phủ (mã AC-PMT-NN do `05_modules/PMT.md` cấp): giấy phép sắp hết hạn có thông báo đúng người, không tự đánh dấu gia hạn; rule chặn khởi công thiếu giấy phép trả 422 có tên giấy phép; quy tắc theo phiên bản hiệu lực tại ngày nộp; cách ly tenant.

## UC24 chất lượng công trình, nhật ký thi công điện tử và nghiệm thu chất lượng (QMS)
(Bổ sung 1.4 — CR-FRD-01) Actor: nhà thầu (Contractor Guest), tư vấn giám sát, cán bộ chủ đầu tư, người ký biên bản nghiệm thu. Mobile MOB-62 (nhật ký), MOB-63 (khối lượng và bằng chứng), MOB-64 (kiểm tra chất lượng), MOB-65 (duyệt nghiệm thu).
Luồng chính: ghi nhật ký thi công điện tử theo ngày (ConstructionDiary: WBS/BOQ, công việc, nguồn lực, thời tiết, ảnh geotag SitePhoto) → kiểm tra chất lượng/NCR (Inspection) → lập và ký biên bản nghiệm thu chất lượng (QualityAcceptance) qua DOC → phát `qms.quality_acceptance.approved.v1` cho CTR.
Luồng thay thế: nhật ký ghi offline qua hàng đợi lệnh (UC20); sửa nhật ký đã chốt bằng bản đính chính có lý do; NCR chưa đóng chặn nghiệm thu theo policy.
Quy tắc: nhật ký thi công và nghiệm thu theo NĐ 06/2021 và văn bản thay thế NĐ 207/2026 [CXN]; QMS không sở hữu khối lượng thanh toán (CTR) và không tạo đề nghị thanh toán (PAY); ảnh có thời gian chụp và thời gian nhận riêng, EXIF không là bằng chứng chống giả mạo tuyệt đối.
Tiêu chí: AC62 (hai thiết bị sync cùng nhật ký không nhân đôi, conflict không ghi đè silent) và AC63 của baseline; tiêu chí cần phủ thêm (mã AC-QMS-NN do `05_modules/QMS.md` cấp): nghiệm thu chất lượng chưa APPROVED thì CTR không duyệt được khối lượng khi hợp đồng yêu cầu; NCR mở chặn nghiệm thu; nhà thầu chỉ thấy nhật ký hợp đồng của mình; nhật ký đã chốt không sửa được trực tiếp.

## UC25 thanh tra, kiểm toán và theo dõi khắc phục (AUD)
(Bổ sung 1.4 — CR-FRD-01) Actor: cán bộ theo dõi thanh tra/kiểm toán của tenant, Auditor (đoàn thanh tra/kiểm toán được cấp quyền chỉ đọc), đơn vị được kiểm tra, lãnh đạo.
Luồng chính: ghi nhận cuộc thanh tra/kiểm toán (AuditEngagement: cơ quan, phạm vi dự án/đơn vị, thời gian) → đặt legal hold lên phạm vi hồ sơ → cấp Auditor scope chỉ đọc có thời hạn → ghi kết luận (AuditConclusion) và kiến nghị (Recommendation) có văn bản DOC → giao hành động khắc phục (RemediationAction) có owner, hạn, bằng chứng → theo dõi, nhắc hạn, đóng khi có bằng chứng và người kiểm tra khác người xử lý; kiến nghị thu hồi tiền liên kết PAY (bút toán đảo/thu hồi, không sửa số gốc).
Quy tắc: căn cứ Luật Thanh tra 84/2025 [CXN]; legal hold chỉ gỡ khi kết thúc có lý do (BR-R14); Auditor không có lệnh ghi; kết luận và kiến nghị bất biến sau ban hành, điều chỉnh bằng văn bản mới.
Tiêu chí cần phủ (mã AC-AUD-NN do `05_modules/AUD.md` cấp): hồ sơ trong phạm vi hold không bị purge/ẩn danh; Auditor gọi lệnh ghi bị 403; kiến nghị quá hạn sinh cảnh báo và hiện ở HOME việc của owner; đóng kiến nghị cần bằng chứng; kiến nghị thu hồi tạo bút toán liên kết, tổng thu hồi không vượt số kiến nghị.

## UC26 bàn giao tài sản và bảo hành (AST)
(Bổ sung 1.4 — CR-FRD-01) Actor: chủ đầu tư, đơn vị tiếp nhận/quản lý sử dụng, nhà thầu, kế toán. Mobile MOB-66.
Luồng chính: lập hồ sơ bàn giao (AssetHandover) gồm danh mục hạng mục/tài sản, giá trị hình thành và nguồn, tồn tại (punch list), hồ sơ vận hành, đơn vị nhận → biên bản bàn giao qua DOC → mở nghĩa vụ bảo hành (WarrantyObligation) theo hạng mục/điều khoản hợp đồng, liên kết bảo lãnh/giữ lại bảo hành → nhắc hạn, ghi sự cố bảo hành, giải tỏa bảo lãnh/giữ lại khi có bằng chứng hết nghĩa vụ.
Quy tắc: không đóng bàn giao khi còn tồn tại trọng yếu theo policy; giá trị tài sản truy được tới nghiệm thu/thanh toán/quyết toán; giải tỏa giữ lại bảo hành là lệnh tiền qua DoA, không tự động.
Tiêu chí: AC65 và AC66 của baseline; tiêu chí cần phủ thêm (mã AC-AST-NN do `05_modules/AST.md` cấp): bảo hành sắp hết hạn có thông báo, không tự giải tỏa; giải tỏa cần bằng chứng và người duyệt khác người đề nghị; tổng giá trị tài sản bàn giao khớp số quyết toán hoặc có chênh lệch được duyệt.

## UC27 giám sát, đánh giá đầu tư theo mẫu pháp định (MNE)
(Bổ sung 1.4 — CR-FRD-01) Actor: chủ đầu tư, cơ quan chủ quản, cơ quan tổng hợp của tỉnh (lập/duyệt), quản trị mẫu và nghĩa vụ. Màn hình MNE-01..10.
Luồng chính: F1 cấu hình mẫu biểu dạng dữ liệu (TT 44/2026 mẫu 02–10 [CXN-10], CV 3665 báo cáo nhanh tuần [CXN-11]) và quy tắc nghĩa vụ (người khác công bố) → F2 sinh nghĩa vụ năm (vỏ báo cáo có hạn, ví dụ 10/7 và 10/02 [CXN-10]) → F3/F4 lập báo cáo tổng thể/theo dự án, số tài chính điền từ PeriodSnapshot FROZEN của DIS, không sửa tay → duyệt bởi người khác → F6 yêu cầu DOC phát hành (APPROVED → ISSUING → ISSUED khi nhận `doc.issued.v1`) → F7 xuất tệp có hash và xác nhận nộp bằng số tiếp nhận (không gọi API Hệ thống TTQG về ĐTC) → F8 đính chính tạo revision mới → F9 đánh giá đầu tư (ban đầu, giữa kỳ, kết thúc, tác động, đột xuất).
Luồng thay thế/lỗi: không có snapshot FROZEN → 422 `SNAPSHOT_NOT_FROZEN`; không có mẫu hiệu lực → 422 `FORM_NOT_EFFECTIVE`; xuất khi chưa ISSUED → `REPORT_NOT_ISSUED`; xác nhận nộp thiếu số tiếp nhận → `RECEIPT_REQUIRED`; sự kiện PRJ (khởi công, điều chỉnh, hoàn thành) tạo nghĩa vụ báo cáo dự án đúng một lần.
Tiêu chí nghiệm thu: AC-MNE-01..09 trong `05_modules/MNE.md` (UAT-AC285..299).

## UC28 danh mục dự án và vòng đời PIMA (PRJ)
(Bổ sung 1.4 — CR-FRD-01) Actor: cán bộ chủ đầu tư/Ban QLDA (maker), người thẩm định, người quyết định, quản trị mã TTQG, quản trị phân công, lãnh đạo phụ trách/trưởng tổ công tác, Auditor. Màn hình PRJ-01..21.
Luồng chính: vòng đời theo khung PIMA thay trạng thái v1.3 (Draft → InReview → Approved → Active → Closed): CONCEPT → (`submitProjectForAppraisal`) APPRAISAL → (`decideProjectAppraisal` ADMIT, có văn bản quyết định và nhóm dự án QTQG/A/B/C [CXN-32]) PIPELINE (ngân hàng dự án) → (hệ thống, khi kế hoạch vốn công bố có vốn > 0) BUDGETED → (`startProjectImplementation`, có quyết định đầu tư và mã dự án TTQG theo rule [CXN-01]) IMPLEMENTATION ⇄ SUSPENDED → (`completeProject`) COMPLETED → (sự kiện `settlement.closed`) SETTLED → CLOSED. Nhánh: RETURN về CONCEPT, REJECT → REJECTED, CANCELLED từ các giai đoạn trước thực hiện.
Luồng phụ: chấm điểm thẩm định theo bộ tiêu chí có phiên bản; điều chỉnh dự án bằng revision có quyết định; gán/nhập tệp mã TTQG (nạp lại cùng tệp bị 409); phân công lãnh đạo phụ trách, tổ công tác và yêu cầu giải trình có hạn theo Công điện 162/CĐ-TTg [CXN-33]; chuyển dự án giữa đơn vị trong tenant có ngày hiệu lực (giữa tenant là export/import của SAS).
Quy tắc: người đề xuất không tự chấm/tự quyết định (403 `SELF_APPROVAL_DENIED`); chuyển ngoài bảng transition trả 409 `STAGE_TRANSITION_DENIED`; profile không được đổi `status`, `code`, `tenant_id`, `total_investment_vnd`; CAP chỉ phân bổ cho dự án từ PIPELINE.
Tiêu chí nghiệm thu: AC-PRJ-01..10 trong `05_modules/PRJ.md` (UAT-AC200..219).

## Truy vết yêu cầu tới xây dựng và test
Mỗi FR gắn BL-screen và UI-screen trong traceability; AC01–AC67 được đưa vào test_cases.json, trạng thái NOT_RUN. Hợp đồng 25 module nêu precondition/state/rule/error; API binding và field-level constraints phải khóa tại refinement. Theme bổ sung SEC02–SEC05, TH01–TH05; chỉ System Admin ghi, Tenant Admin đọc published tenant mình. Không cho generic PATCH status bỏ qua domain command. Truy vết theo loại yêu cầu (R11): FR chức năng → màn hình/luồng + operation + entity + story + test; NFR/kiểm soát → cơ chế + story + test/bằng chứng vận hành; không chấp nhận liên kết giả. (Cập nhật 1.4 — CR-FRD-08)

(Bổ sung 1.4 — CR-FRD-08) Dải mã test `UAT-AC` của đặc tả phân hệ tại thời điểm viết (không trùng nhau; dải mới do phân hệ tự cấp, kiểm bằng script nhất quán): AC01–AC67 của FRD ↔ `UAT-AC01..67`; IAM 100–109, 115, 119–125; ADM 110–114, 116–118, 126–144; SAS 145–175; NOT 176–194; OMNI 195–199; PRJ 200–219; CAP 220–239; DIS 240–265; HOME 266–272; MDM 273–284; MNE 285–299; MOB 500–507. Dải còn trống cho DGV, DOC, LND, PMT, QMS, AUD, AST, CTR, PAY, BID, LLM, BI, ISS sẽ do đặc tả tương ứng cấp.

## Theme & thương hiệu theo tenant — SAS-04
(Cập nhật 1.4 — CR-FRD-08) Khối đặc tả SAS-04 dán lặp của baseline 1.3 được thay bằng con trỏ: đặc tả, ma trận quyền (chỉ System Admin ghi; Tenant Admin chỉ đọc bản đã công bố của tenant mình), mã lỗi (`REVIEW_INVALID` duy nhất cho review không hợp lệ, `VERSION_CONFLICT` khi base version lệch) và tiêu chí nghiệm thu nằm tại `03_Engineering/Tenant_Theme_Specification.html` và `05_modules/SAS.md` (§3.12, BR-SAS-17); test SEC02–SEC05, TH01–TH05.

Tài liệu điều phối: 04_Thiet_ke_co_ban; 05_modules; 09_Ke_hoach_trien_khai; 10_Ke_hoach_kiem_thu_va_chuyen_doi; 03_Engineering/nonfunctional_requirements.json; 03_Engineering/Implementation_Backlog.html; 03_Engineering/Test_Case_Catalogue.html; 03_Engineering/Decision_Register.html. (Cập nhật 1.4 — CR-FRD-00)

## Danh sách CR của FRD baseline 1.4
| CR | Nội dung | Nguồn quyết định |
|---|---|---|
| CR-FRD-00 | Header, quy ước baseline 1.4, tài liệu điều phối | Plan 22/10 |
| CR-FRD-01 | UC17–UC28 cho IAM, ADM, HOME, MOB, DOC, LND, PMT, QMS, AUD, AST, MNE, PRJ | D-B09, O11 |
| CR-FRD-02 | Kỳ Open/SoftClosed/Locked; "Closed" = Locked; mở lại kỳ | CR-DIS-01 |
| CR-FRD-03 | Vòng đời tenant 7 trạng thái; tenant = cơ quan chủ quản | CR-SAS-01, R6 |
| CR-FRD-04 | Dedupe key và trần 5 lần gửi theo NOT; Unknown ≠ NotAssessed | CR-NOT-01, CR-NOT-02 |
| CR-FRD-05 | License: Expiring là nhãn, thêm Superseded | SAS.md §3.8 |
| CR-FRD-06 | NotAssessed là thuật ngữ duy nhất cho chưa đánh giá; data contract, DQ incident, DMM/DCAM | 08 baseline 1.4, plan MDM/DGV |
| CR-FRD-07 | Tên vai trò chuẩn trong ma trận kiểm soát | Tài liệu 04 |
| CR-FRD-08 | Số lượng yêu cầu, truy vết theo loại, dải UAT-AC, SAS-04 thành con trỏ | R11, O11 |
| CR-FRD-09 | RLS PERMISSIVE + RESTRICTIVE, command, Temporal | K2, K3, R9 |
| CR-FRD-10 | CAP/MDM/BI mở rộng, as_of_period | Plan research, CAP.md, MDM.md |
| CR-FRD-11 | Sổ lũy kế thanh toán (R7), import Kho bạc idempotent (A3), ranh giới CTR/QMS/PAY/AST/AUD | R7, A3, tài liệu 04 |
| CR-FRD-12 | Hàng đợi lệnh mobile cho vướng mắc offline | MOB.md |
| CR-FRD-13 | Định tuyến AI theo phân loại dữ liệu | R5 |
| CR-FRD-14 | Thời điểm kênh ngoài | BRD CR-BRD-06 |

## Phụ lục: ánh xạ nội dung baseline 1.3
| Đoạn baseline 1.3 bị bỏ | Nội dung nay nằm ở |
|---|---|
| SAS-04 đoạn 1 (chỉ System Admin cấu hình thương hiệu; Tenant Admin chỉ đọc) | Mục "Theme & thương hiệu theo tenant — SAS-04" (con trỏ); `Tenant_Theme_Specification.html` |
| SAS-04 đoạn 2 (nháp tách tenant, review chênh lệch, phiên bản bất biến, kiểm tương phản) | `Tenant_Theme_Specification.html`; `05_modules/SAS.md` §3.12 |
| SAS-04 đoạn 3 (server xác thực System Admin, review gắn actor/tenant/hash, 403/409/422, audit) | `Tenant_Theme_Specification.html`; `05_modules/SAS.md` BR-SAS-17 |
| SAS-04 đoạn 4 (prototype localStorage, chi tiết tại Tenant_Theme_Specification) | `Tenant_Theme_Specification.html`; con trỏ trong mục SAS-04 |
| "Lỗi 429/5xx retry với exponential backoff+jitter và cap/TTL;" (đoạn baseline) | UC09 Notification Center, đoạn retry: trần 5 lần gửi mỗi kênh theo lịch 30 giây/2 phút/10 phút/30 phút, DLQ và phát lại (CR-FRD-04) |
| "Chỉ System Admin được cấu hình thương hiệu cho các tenant: m" (đoạn baseline) | Mục SAS-04 (con trỏ); `Tenant_Theme_Specification.html` |
| "Bản nháp tách biệt theo tenant và không thay đổi giao diện đ" (đoạn baseline) | `Tenant_Theme_Specification.html`; `05_modules/SAS.md` §3.12 |
| "Server phải xác thực System Admin cho mọi lệnh ghi; không ti" (đoạn baseline) | `Tenant_Theme_Specification.html`; `05_modules/SAS.md` BR-SAS-17 |
| "Prototype SAS-04 dùng localStorage và bộ chọn vai trò mô phỏ" (đoạn baseline) | `Tenant_Theme_Specification.html` |
| "Tài liệu điều phối: 09_Ke_hoach_trien_khai; 10_Ke_hoach_kiem" (đoạn baseline) | Dòng "Tài liệu điều phối" cuối tài liệu (thêm 04, NFR, MOB/MDM/DGV, CR-…-00) |

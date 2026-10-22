# Hệ Thống Lý Dự Án Đầu Tư Công đặc tả yêu cầu chức năng FRD
Baseline 1.3 | 22/10/2026. Mỗi màn hình có mã FR tương ứng trong screen_catalog.json và Screen_Specifications.html. Các quy tắc trong tài liệu này áp dụng bổ sung, không được thay thế bởi hành vi mô phỏng của prototype.

## Hợp đồng chung cho mọi chức năng
Trước thao tác: xác thực phiên, tenant membership, license/entitlement, action permission, scope đối tượng và phiên bản dữ liệu. Với đọc, quyền áp dụng trước truy vấn, tổng hợp, tìm kiếm và xuất. Với ghi, server kiểm tra đầy đủ, không tin tenant_id hoặc số tổng từ client. Sau thao tác: trả mã đối tượng/phiên bản/trạng thái; ghi audit và sự kiện outbox cùng transaction. Lỗi có code, trường liên quan, thông điệp và correlation_id; không trả stack trace hoặc tồn tại hồ sơ ngoài quyền.

Yêu cầu dùng chung: phân trang cursor, lọc có biểu diễn rõ, sắp xếp ổn định, lưu view cá nhân, cột ghim, CSV/Excel/PDF export bất đồng bộ. Xuất file phải áp lại quyền tại lúc chạy và lúc tải; link có TTL; nội dung xuất có phạm vi, kỳ, đơn vị và thời gian chốt. Batch import có dry-run, mapping, preview, báo lỗi theo dòng; không âm thầm bỏ dòng sai.

## UC01 nhập báo cáo tuần
Actor: cán bộ chủ đầu tư. Tiền điều kiện: dự án thuộc phạm vi, kỳ mở, kế hoạch có hiệu lực và quyền report.write. Luồng DIS-01 → DIS-02 → DIS-03 → DIS-04 → DIS-05 → DIS-06 → DIS-07. Chọn kỳ/dự án; hệ thống lấy snapshot kế hoạch, kỳ trước, nguồn vốn; nhập khối lượng và số lũy kế theo nguồn; đăng ký tháng sau; kiểm tra; lưu nháp hoặc gửi. Gửi tạo phiên bản bất biến, thời điểm server, người gửi và hash nội dung.

Khóa nghiệp vụ đề xuất: tenant + project + reporting_period + report_type + revision. Mỗi khóa có tối đa một bản current được chấp nhận. Có draft riêng nhưng không tạo nhiều current cho cùng kỳ. Kế hoạch liên quan lưu bằng plan_version_id, không chỉ tên năm. Gửi lại cùng Idempotency-Key và payload trả cùng kết quả; cùng key khác payload trả 409. Hai người sửa cùng version: người sau nhận 409 và bản so sánh.

AC01: Given kỳ mở và dữ liệu hợp lệ, When gửi, Then trạng thái Submitted, một audit và một event report.submitted được tạo. AC02: Given CTMTQG lớn hơn phần nguồn cha, When gửi, Then 422 với tên trường, giữ nguyên nháp. AC03: Given kỳ đã khóa, When gửi, Then không tạo phiên bản gửi và trả PERIOD_LOCKED. AC04: Given không có đăng ký tháng hoặc mẫu số bằng 0, Then tỷ lệ hiện “Chưa có cơ sở tính”, không hiện 0% hoặc Infinity.

## UC02 sửa trả lại thu hồi và khóa kỳ
Trạng thái đề xuất: Draft → Submitted → UnderReview → Accepted; Submitted/UnderReview → Returned → Draft revision mới → Submitted. Accepted → AmendmentRequested → revision mới → Accepted; bản cũ giữ nguyên và được supersede khi bản mới chấp nhận. Withdrawal chỉ cho trạng thái được chính sách cho phép, có lý do và người duyệt. Closed là trạng thái kỳ, không xóa trạng thái báo cáo. Workflow version được gắn tại thời điểm gửi.

Chuyên viên trả lại phải chỉ rõ mục cần bổ sung, lý do, hạn và tệp đối chiếu. Mở khóa kỳ đòi quyền riêng, lý do, phạm vi dự án/kỳ và giới hạn thời gian; audit phải lưu người duyệt mở khóa. Không có thao tác “sửa trực tiếp số accepted”. Xóa nháp là soft-delete, phải hiển thị mã/kỳ/dự án. Khôi phục nháp trong retention cho phép không phục hồi quyền truy cập đã bị thu hồi.

AC05: self-approval bị từ chối khi maker-checker bật. AC06: chỉnh sửa accepted tạo revision mới, dashboard chưa đổi cho đến khi revision mới được chấp nhận. AC07: báo cáo đến trễ được đánh dấu và tính đúng deadline theo calendar_version.

## UC03 kế hoạch phân bổ và điều chuyển
Đối tượng: kế hoạch trung hạn, kế hoạch năm, quyết định, dòng phân bổ, nguồn vốn và đăng ký tháng. Phân bổ chỉ được chấp nhận khi tổng dòng không vượt giá trị quyết định/nguồn khả dụng, ngày hiệu lực và dự án hợp lệ. Điều chuyển là một bộ dòng tăng/giảm có cùng transaction; phải cân bằng theo loại điều chuyển và căn cứ. Chuyển nguồn giữa năm không biến thành tiền giải ngân.

Simulation không ghi ledger thật. Mỗi kịch bản lưu constraints, input snapshot, assumptions và kết quả; so sánh baseline với đề xuất; áp dụng cần tạo hồ sơ phê duyệt riêng. Đăng ký tháng là kế hoạch dự kiến, không phải actual. Chỉ tiêu “còn lại” phải ghi rõ theo vốn giao năm, theo tổng mức đầu tư hay theo hợp đồng.

AC08: hai phân bổ đồng thời không thể cùng tiêu một số dư; kiểm tra trong transaction lock. AC09: quyết định bị thay thế không làm mất khả năng xem kế hoạch tại thời điểm lịch sử.

## UC04 thanh toán tạm ứng và đối soát
Đề nghị thanh toán liên kết project, contract, acceptance, nguồn và chứng từ. Quy tắc giá trị đề nghị, tạm ứng, thu hồi, giữ lại và trần hợp đồng được cấu hình có phiên bản theo loại hồ sơ; không áp một công thức pháp lý cố định chưa được chốt. Số đã gửi KBNN là trạng thái/giá trị hồ sơ, không mặc nhiên là số đã thanh toán.

Adapter nhận thông điệp Kho bạc vào staging; xác thực nguồn, mã ngoại, thời gian, checksum; dedupe theo provider+tenant+external_transaction_id. Không có API thì dùng import có đối soát và nguồn “manual-confirmed”. Ghép theo khóa hồ sơ và nguồn vốn; trường hợp không ghép được vào exception queue. Confirmed actual chỉ thay đổi sau xác nhận. Hoàn trả/đảo giao dịch là bút toán đảo có liên kết, không sửa số gốc.

AC10: cùng callback hai lần chỉ tạo một giao dịch. AC11: tổng đối soát không cộng cả bản gốc và bản nhập lặp. AC12: số nội bộ khác số xác nhận hiển thị hai cột và sai lệch, không tự chọn số lớn hơn.

## UC05 vướng mắc và hiện trường
Ghi nhận có project, loại, mức độ, nội dung, ảnh, thời gian và vị trí nếu người dùng đồng ý. SLA theo loại/đơn vị/lịch làm việc. Luồng Open → Assigned → InProgress → PendingVerification → Closed; Reopened có lý do; Escalated không tự đóng việc gốc. Ngày quá hạn và người chịu trách nhiệm được giữ khi chuyển đơn vị. Đóng việc cần bằng chứng và người kiểm tra khác người xử lý khi cấu hình yêu cầu.

Offline chỉ tạo bản nháp và ảnh chờ đồng bộ. Vị trí thiếu hoặc độ chính xác kém phải hiển thị, không tạo bằng chứng vị trí giả. Ảnh có thời gian chụp và thời gian nhận riêng; không coi EXIF là bằng chứng chống giả mạo tuyệt đối.

## UC06 AI phân tích đề án nhà thầu
Tổ chuyên gia ban hành criteria_version gồm tiêu chí, điều kiện bắt buộc, thang điểm/trọng số nếu áp dụng, bằng chứng yêu cầu và phạm vi hồ sơ. Trọng số phải hợp lệ; tiêu chí có hiệu lực được khóa cho lượt đánh giá. File được malware scan, phân loại, OCR, tách trang/bảng và kiểm tra chất lượng. OCR thấp hoặc bảng không khớp chuyển chuyên gia xác nhận trước phân tích tài chính.

Analysis run gắn document_version_ids, criteria_version, model thực tế, profile/prompt version, retrieval snapshot, input hash và budget reservation. Pipeline: trích xuất dữ kiện → tính toán xác định bằng code → đối chiếu tiêu chí → dựng nhận xét có dẫn chứng → kiểm tra đủ bằng chứng → review. Văn bản trong hồ sơ là dữ liệu, không được thi hành lệnh yêu cầu bỏ tiêu chí, gửi tài liệu hoặc lộ bí mật. Không cho model truy cập mạng/công cụ ghi tùy ý.

Output cho từng tiêu chí: status [supported, contradicted, missing, needs_review], finding, evidence(file_version,page,bbox,quote), confidence_type, reviewer, override_reason. Confidence là tín hiệu hỗ trợ đã hiệu chuẩn trên eval, không giả định là xác suất đúng. Thiếu bằng chứng không tự suy ra gian lận. Tính giá/khối lượng bằng decimal và công thức đã duyệt, model chỉ diễn giải.

AC13: mọi nhận xét quan trọng có nguồn trang hoặc cờ thiếu nguồn. AC14: document ACL áp dụng cả vector retrieval và mở dẫn chứng. AC15: thay tiêu chí/hồ sơ phải tạo run mới, kết quả cũ không bị viết lại. AC16: chuyên gia sửa điểm phải có lý do; kết luận cuối do người có thẩm quyền. AC17: so sánh nhà thầu dùng cùng phiên bản tiêu chí; không lấy tên, đặc tính cá nhân không liên quan làm tiêu chí.

## UC07 quản trị LLM và chi phí
Model registry lưu provider/model_id/version/capabilities/region/status/context/pricing_version. Profile theo tác vụ gồm allowed_models, effort theo capability, max_input/output, timeout, concurrency, output schema, tool allowlist, retention và classification. Không gửi tham số temperature/effort nếu model không hỗ trợ. Publish profile cần eval, review và rollback reference.

Trước gọi: kiểm tra quyền/gói → lọc dữ liệu → ước tính bound → reserve budget atomic ở các cấp tenant/đơn vị/project/user → dispatch. Khi xong: ghi actual usage, model thực tế, request_id; tính chi phí theo pricing_version và reconcile reservation. Timeout hoặc thiếu usage vào pending_reconcile; không giả định 0 đồng. Retry/fallback là attempt riêng và có thể tính phí. Hủy không bảo đảm hoàn phí.

Công thức normalized: cost = noncached_input × input_rate + cached_input × cached_rate + output_total × output_rate + tool/media/other_fee. Mỗi rate theo đơn vị provider (ví dụ triệu token). Reasoning tokens nếu đã nằm trong output_total thì không cộng lần hai. Nếu provider tính riêng, adapter khai báo meter riêng. Lưu tiền tệ gốc, tỷ giá và thời điểm; VND báo cáo là quy đổi, hóa đơn provider là căn cứ đối soát. Giá trong prototype không phải giá thị trường.

AC18: hai job đồng thời không vượt reservation khả dụng. AC19: fallback không chuyển hồ sơ sang vùng/provider bị cấm. AC20: key chỉ hiển thị fingerprint; secret nằm vault, không trả về browser. AC21: tắt khẩn cấp ngăn job mới, job đang chạy được đánh dấu và xử lý theo khả năng hủy provider.

## UC08 trung tâm tương tác đa kênh
Conversation có tenant, channel_account, external_thread_id, verified_contact, liên kết project/case và access policy. Tin nhắn phân biệt internal_note với external_message; nút gửi cho biết kênh và người nhận. Gộp danh tính cần xác minh, không ghép chỉ vì tên hiển thị giống nhau. Consent theo channel/purpose có nguồn, thời gian, revocation.

Inbound webhook kiểm tra chữ ký/token và replay window theo provider; persist rồi ACK; dedupe bằng event_id; xử lý async. Tệp vào quarantine trước khi mở. Email threading dùng Message-ID/In-Reply-To/References và kiểm tra membership; header bị giả mạo không đủ để cấp quyền hồ sơ. LLM có thể gợi ý trả lời nhưng không tự gửi trao đổi nghiệp vụ quan trọng.

AC22: revoked consent chặn gửi mới theo mục đích bị thu hồi. AC23: ghi chú nội bộ không xuất sang Zalo/WhatsApp/email. AC24: gửi nhầm tenant/channel_account bị chặn tại service trước adapter. AC25: nội dung nhạy cảm gửi link xác thực thay vì đính toàn bộ hồ sơ.

## UC09 Notification Center
Workflow version gồm event schema, recipient resolver, conditions, template version, delay/digest, quiet hours, priority, fallback và escalation. Recipient resolver chạy trong tenant; quyền/consent kiểm lại trước send. Tin bắt buộc chỉ theo chính sách được phê duyệt, không coi “urgent” là quyền bỏ qua mọi consent. Gửi thử chỉ tới danh sách thử cho phép và gắn nhãn TEST.

Trạng thái: Created → Scheduled → Queued → Sending → ProviderAccepted → Delivered → Read nếu provider hỗ trợ; Acknowledged chỉ khi người dùng xác nhận nghiệp vụ. Nhánh Suppressed/Expired/Cancelled/Failed/Unknown riêng. Callback đến sai thứ tự không được hạ Delivered về Queued. Unknown cần reconcile trước resend để giảm gửi đôi. Dedupe logical_notification_id+recipient+channel+template_version; mỗi retry có attempt_id.

Lỗi 429/5xx retry với exponential backoff+jitter và cap/TTL; lỗi địa chỉ/token không hợp lệ dừng, thu hồi token tương ứng. DLQ lưu payload reference tối thiểu, lỗi, attempts; phát lại cần quyền và kiểm lại điều kiện. Fallback tạo attempt kênh khác có liên kết, không đảm bảo exactly-once toàn mạng. Email opened là tín hiệu hạn chế, không là biên nhận pháp lý. Dashboard có delivered rate với denominator/cutoff rõ.

AC26: replay một event không nhân đôi notification. AC27: quiet hours theo timezone người nhận; critical override có audit. AC28: push không chứa số tiền/hồ sơ mật trên khóa màn hình. AC29: provider outage không chặn transaction gửi báo cáo. AC30: mọi chiến dịch diện rộng có preview recipient count, exclusion và maker-checker.

## UC10 BI động và drill down toàn bộ chỉ tiêu
Semantic metric lưu ID, version, grain, type [additive, semi_additive, ratio, distinct], expression AST cho phép, dimensions, unit, null policy, source và owner. Dashboard version tham chiếu metric version, dataset version, layout theo breakpoint và filter mappings. Publish có kiểm tra quyền, công thức và khả năng tái tạo. Không cho người dùng thường nhập SQL tùy ý; nguồn dữ liệu chỉ qua connector do quản trị cho phép.

DrillContext gồm tenant, principal_scope_hash, metric_version, snapshot_id, as_of, filters, currency/unit và path. Mỗi bước kế thừa filters, thêm dimension/member, server kiểm quyền; breadcrumb quay lại đúng context. Tỷ lệ = tổng tử / tổng mẫu, không cộng/trung bình tỷ lệ từng hàng. Lũy kế lấy snapshot accepted cuối phù hợp as_of, không SUM các tuần. Distinct count có cảnh báo không cộng được nếu nhóm chồng lấn.

Tổng và con phải reconcile: có nhóm Chưa phân loại và điều kiện loại trừ minh bạch. Khi một phần drill bị hạn chế, không làm lộ đối tượng; chính sách phải chọn tổng theo quyền hiện tại hoặc tổng công bố đã được duyệt độc lập, ghi nhãn rõ. Mọi export, email snapshot và chart cache dùng cùng policy. KPI AI/model/notification/SaaS cũng drill tới usage event/delivery attempt/invoice line; không ép mọi số liệu về dự án.

AC31: đổi dimension không đổi snapshot. AC32: nhóm con cộng lại tổng đối với additive metric cùng scope; ratio tái tính từ tử/mẫu. AC33: người tenant A không thể sửa drill token để xem B. AC34: stale cache bị phân biệt với nguồn mới; refresh tạo context mới có thông báo. AC35: chia sẻ dashboard không tự cấp quyền dữ liệu.

## UC11 SaaS đa tenant branding và billing
Provisioning là saga có trạng thái Requested → Provisioning → Active hoặc Failed, có bước IdP/domain/storage/schema/entitlements/seeding. Retry từng bước idempotent. Hostname đã xác minh ánh xạ tenant nhưng user vẫn phải có membership. Branding token được validate schema, MIME/logo size và tương phản; cấm arbitrary JS/CSS. Custom domain cần TXT verification, TLS renew, chống domain takeover khi offboard.

Subscription chứa plan version, cycle, billing anchor, payment terms; usage meter immutable với dedupe event key. Seats định nghĩa named active users hay concurrent phải chốt hợp đồng; mặc định thiết kế là named active memberships, không tính service accounts trừ chính sách riêng. Nâng gói effective_now hoặc next_cycle, proration có preview; hạ gói không xóa dữ liệu, chặn tạo mới vượt quota và hướng dẫn giảm usage.

AC36: duplicate payment webhook không nhân đôi invoice/payment. AC37: payment thất bại không lập tức xóa dữ liệu tenant. AC38: hỗ trợ truy cập nội dung phải có owner consent, ticket, thời hạn và audit. AC39: tenant export gồm dữ liệu, file manifest và checksum; hết hợp đồng giữ legal hold theo chính sách đã chốt.

## UC12 license từng tenant
License có license_id, tenant_id, serial, edition, entitlement_version, seats/quota, valid_from, valid_until, grace_until, issuer, issued_at, signature_key_id, status và supersedes. Trạng thái Draft → Issued → Active → Expiring → Grace → Expired; Suspended/Revoked có lý do. Expiring là nhãn tính toán theo ngưỡng, không làm mất quyền. Server clock UTC quyết định hiệu lực, UI hiển thị timezone tenant.

Quyền hiệu lực = membership ∩ role/scope ∩ license entitlements ∩ feature policy; suspended tenant hoặc revoked license có thể deny theo chính sách. Gia hạn tạo revision/signed license mới liên kết bản cũ, không sửa lịch sử. Cấp license khác tenant, start≥end hoặc quota âm bị từ chối. License private deployment có signed claims, key rotation và thời hạn offline lease; cache không được kéo dài quyền vô hạn. Offline lease là tùy chọn Private, không thay kiểm tra server của SaaS chuẩn.

AC40: đúng valid_until chuyển grace/expired theo định nghĩa biên [from,until). AC41: grace chỉ giữ những quyền hợp đồng cho phép, mặc định hạn chế thay đổi thương mại/AI. AC42: expired chỉ đọc/xuất nếu policy cho phép; không xóa dữ liệu. AC43: admin tenant không tự gia hạn license. AC44: thu hồi có audit, thông báo và invalidation cache trong SLO đề xuất 60 giây.

## UC13 quản trị dữ liệu chủ và danh mục

Master record có business_key, tenant/namespace, version, valid_from/valid_until, source, steward và trạng thái Draft → InReview → Approved → Effective → Retired. MDM-01..33 bao phủ tổ chức, địa bàn, nguồn vốn, chương trình, dự án, nhà thầu, Kho bạc, lịch báo cáo, loại vướng mắc, workflow và các mã dùng chung. Namespace quốc gia do platform phát hành có chữ ký phiên bản; tenant chỉ ánh xạ hoặc bổ sung namespace riêng, không ghi đè âm thầm. Một record được sử dụng trong báo cáo phải tham chiếu phiên bản master đã có hiệu lực tại ngày nghiệp vụ.

Đề nghị thay đổi có before/after, lý do, file căn cứ và impact preview số bản ghi/dashboard/tích hợp bị ảnh hưởng. Người đề nghị không tự duyệt khi policy yêu cầu tách nhiệm vụ. Đổi tên giữ business identity; sáp nhập/tách đơn vị tạo mapping hiệu lực theo thời gian. Không xóa master đã được tham chiếu. Duplicate detection chỉ gợi ý; merge cần review, giữ alias và đường dẫn tới bản gốc. Import staging có kiểm schema, duplicate, FK, thời gian hiệu lực, preview lỗi từng dòng; publish theo batch atomic hoặc chế độ partial được chọn rõ, có kết quả và khả năng resume bằng idempotency key.

AC45: mã trùng trong cùng tenant/namespace bị chặn; mã giống ở hai tenant độc lập không làm lộ dữ liệu. AC46: khoảng hiệu lực của hai version cùng business_key không chồng lấn. AC47: retire đơn vị không làm đổi tên lịch sử trong báo cáo đã gửi. AC48: lỗi import không thay dữ liệu đang có hiệu lực; retry không nhân đôi. AC49: thay đổi có impact preview và audit trước khi publish; báo cáo cũ vẫn truy được master version gốc.

## UC14 chất lượng, lineage và sự trưởng thành dữ liệu

Data catalog đăng ký dataset, grain, owner/steward, schema version, classification, retention, nguồn và SLA freshness. Contract bao gồm cấu trúc, quy tắc nghiệp vụ, kỳ vọng completeness/uniqueness/timeliness và tolerance đối soát; breaking change cần version mới, cửa sổ migration và consumer approval. DGV-01..18 gồm catalog, glossary, lineage, quality rules, quality runs, exception queue, reconciliation, maturity assessment, evidence và remediation. Lineage nối nguồn → staging → mapping → record/version → metric/version → dashboard/export; cạnh có run_id, transform version và thời gian.

Quality run đóng dấu snapshot; lỗi hard-block vào quarantine, warning cho phép xử lý có quyền và lý do. Exception có owner, severity, due_at, evidence và quyết định resolve/waive với expires_at. Waive không sửa số liệu và không xóa lịch sử lỗi. Dashboard hiển thị freshness, coverage và số ngoại lệ; unknown không đổi thành zero. Đối soát tiền dùng cùng kỳ/currency/basis; chênh lệch phải phân loại missing, timing, reversal, mapping hoặc amount, không tự lấy bên có số lớn hơn.

Assessment gồm 8 trụ cột, tiêu chí mức 1–5, evidence, reviewer và assessment period. Thiếu bằng chứng là NotAssessed; không tự gán điểm 1 hoặc tính vào trung bình. Chỉ tính score nếu đạt coverage tối thiểu được phê duyệt; công bố kèm coverage/weights và evidence links. Điểm mục tiêu 9–10/10 của sản phẩm là rubric cạnh tranh đề xuất; cần benchmark/pilot độc lập để xác nhận.

AC50: schema breaking change bị chặn nếu consumer chưa chấp thuận. AC51: quarantine record không đi vào metric certified; dashboard thể hiện phần bị loại. AC52: từ KPI truy được metric version, snapshot, transform và record nguồn đúng quyền. AC53: maturity thiếu evidence hiển thị NotAssessed và không tạo điểm tổng sai. AC54: waiver hết hạn tự mở lại issue theo policy, có audit. AC55: RLS/masking vẫn áp dụng với catalog search, lineage, quality evidence và export.

## Ma trận kiểm soát theo vai trò
Chủ đầu tư tạo/sửa nháp và gửi hồ sơ của đơn vị; không phê duyệt tổng hợp toàn tỉnh. Chuyên viên kiểm tra/return/accept theo phân công; không sửa silent số của người gửi. Lãnh đạo approve trong thẩm quyền, không sửa chứng từ gốc. Auditor read/export theo scope, không mutate. Tenant admin cấu hình người dùng và workflow; quyền đọc hồ sơ nghiệp vụ là grant độc lập. AI admin publish model/profile qua review; không quyết định kết quả thầu. Billing admin xem tiền thuê bao/usage, không đọc đề án. Platform operator xem health, chỉ access nội dung qua break-glass đã duyệt. Mọi role đều bị tenant boundary và classification chi phối.

## Hoàn thành chức năng và nghiệm thu
Catalogue chứa 327 yêu cầu gắn màn hình, nhưng trạng thái/vai trò dùng chung được thiết kế theo ma trận, không nhân bản vô hạn thành từng file màn hình. Hoàn thành yêu cầu khi có UI, API, validation, phân quyền, audit, event, lỗi, telemetry và ca UAT phù hợp. Prototype minh họa không chứng minh đã đạt các AC production. Các bước duyệt pháp lý, tài khoản tích hợp và dữ liệu pilot vẫn là đầu vào cần chốt trước xây dựng.


## UC15 lựa chọn nhà thầu và vòng đời hợp đồng

Kế hoạch lựa chọn liên kết dự án/nguồn vốn/quyết định phê duyệt, gói thầu có budget ceiling và schedule; điều chỉnh tạo revision. Lịch mời/đóng/mở thầu và kết quả được nhập hoặc đối soát nguồn chính thức theo quyền tích hợp được cấp. Cổng này không tự thay thế Hệ thống mạng đấu thầu quốc gia. Chuyên gia khai báo conflict of interest trước xem hồ sơ; hồ sơ bị hạn chế cho tới thời điểm và vai trò được phép. Kết quả AI chỉ là đầu vào kiểm chứng, không tự quyết định loại/chọn nhà thầu. Kiến nghị theo case, hạn và hồ sơ căn cứ.

Hợp đồng Draft → InReview → Signed → Active → Completed → Closed, với Suspended/Terminated có quyết định. BOQ, đơn giá, thuế, retention, advance recovery và payment milestones được version theo điều khoản; không áp công thức chung sai loại hợp đồng. Bảo lãnh có issuer, currency, amount, expiry, authenticity check và release evidence. Phụ lục qua change request đánh giá chi phí/tiến độ/phạm vi/nguồn vốn trước duyệt, không sửa số gốc. Thanh toán liên kết khối lượng nghiệm thu và hợp đồng version; phần đã trả không được thanh toán lặp bằng đổi mã hồ sơ.

AC56: chuyên gia có conflict bị chặn hoặc cần quyết định xử lý được ghi audit. AC57: giá vượt trần hoặc kế hoạch chưa duyệt bị chặn theo rule đã chốt. AC58: phụ lục chưa hiệu lực không đổi BOQ thanh toán; hồi tố cần quy trình điều chỉnh riêng. AC59: bảo lãnh sắp hết hạn có notification, không tự đánh dấu gia hạn. AC60: duplicate invoice/measurement/payment reference phát hiện trong tenant và hợp đồng; override có căn cứ. AC61: tổng lũy kế thu hồi tạm ứng không vượt gốc tạm ứng sau điều chỉnh hợp lệ.

## UC16 thực hiện, nghiệm thu, bàn giao và quyết toán

Nhật ký có ngày, WBS/BOQ, công việc, nguồn lực, ảnh và người ghi. Measurement revision ghi khối lượng kỳ/lũy kế và bằng chứng; không chấp nhận lũy kế giảm mà thiếu correction reference. Checklist chất lượng/NCR có severity, corrective action, evidence và approval đóng. Nghiệm thu cần danh tính, thẩm quyền, biên bản và version; chữ ký điện tử/ký số theo nhà cung cấp và quy chế được xác nhận, nút prototype không có giá trị ký. Dossier thanh toán lưu giá trị gross, advance recovery, retention, tax và net theo từng điều khoản, nguồn/currency, kiểm tra phương trình được cấu hình trước chuyển Kho bạc.

Bàn giao có punch list, recipient, commissioning docs và asset register link; chưa khắc phục tồn tại trọng yếu thì chưa đóng theo policy. Bảo hành theo hạng mục/điều khoản, cảnh báo hạn và giải tỏa bảo lãnh theo bằng chứng. Quyết toán đối chiếu approved investment, hợp đồng/phát sinh, nghiệm thu, giải ngân, công nợ, tạm ứng, audit finding; chênh lệch có căn cứ và phê duyệt. Chốt dự án không xóa hồ sơ, legal hold và retention tiếp tục áp dụng. Hình thành tài sản có nguồn giá trị và đơn vị tiếp nhận; tích hợp tài sản là hợp đồng dữ liệu riêng.

AC62: hai thiết bị sync cùng nhật ký không nhân đôi; conflict không ghi đè silent. AC63: measurement chưa duyệt không được dùng cho nghiệm thu/payment certified. AC64: số net không cân với các cấu phần thì chặn gửi; rounding dùng quy tắc currency/contract version. AC65: bàn giao phải truy được tồn tại, tài sản, biên bản và đơn vị nhận. AC66: close khi còn công nợ/tạm ứng cần exception approval, không tự coi bằng zero. AC67: toàn bộ chuỗi dự án → hợp đồng → measurement → acceptance → payment → treasury → settlement truy vết được theo tenant và phiên bản.


## Theme & thương hiệu theo tenant — SAS-04

Chỉ System Admin được cấu hình thương hiệu cho các tenant: màu sắc, logo, menu, header, footer, tên hệ thống, địa chỉ và thông tin liên hệ. Tenant Admin chỉ được đọc cấu hình đã công bố của tenant mình, không được sửa, lưu nháp, tải logo, tạo review, áp dụng hoặc khôi phục. Các quyền quản trị nội bộ tenant khác không bao gồm quyền cấu hình thương hiệu.

Bản nháp tách biệt theo tenant và không thay đổi giao diện đang dùng. Xem trước web/smartphone trong vùng riêng; bước review hiển thị chênh lệch trước/sau, tenant đích và phiên bản gốc. Xác nhận áp dụng tạo phiên bản bất biến mới. Khôi phục cũng phải review và tạo phiên bản mới, giữ nguyên lịch sử. Kiểm tra trường bắt buộc, email, tệp logo và sáu cặp màu tương phản tối thiểu 4,5:1 trước khi công bố.

Server phải xác thực System Admin cho mọi lệnh ghi; không tin vai trò, tenant_id hoặc cờ quyền do trình duyệt gửi. Review gắn actor, tenant, hash nội dung, base version và hạn sử dụng. Kiểm tra lại quyền và phiên bản trong giao dịch công bố; trả 403 khi thiếu quyền, 409 khi xung đột, 422 khi cấu hình không hợp lệ. Audit ghi người thực hiện, tenant, bản trước/sau, lý do khôi phục và thời điểm; không ghi bí mật vào log.

Prototype SAS-04 dùng localStorage và bộ chọn vai trò mô phỏng để kiểm tra trải nghiệm. Đây không phải hệ thống xác thực hoặc cách ly tenant thật. Chi tiết triển khai và tiêu chí nghiệm thu nằm tại 03_Engineering/Tenant_Theme_Specification.html.


## Truy vết yêu cầu tới xây dựng và test
Mỗi FR gắn BL-screen và UI-screen trong traceability; AC01–AC67 được đưa vào test_cases.json, trạng thái NOT_RUN. Hợp đồng18 module nêu precondition/state/rule/error; API binding và field-level constraints phải khóa tại refinement. Theme bổ sung SEC02–SEC05,TH01–TH05; chỉ System Admin ghi, Tenant Admin đọc published tenant mình. Không cho generic PATCH status bỏ qua domain command.

Tài liệu điều phối: 09_Ke_hoach_trien_khai; 10_Ke_hoach_kiem_thu_va_chuyen_doi; 03_Engineering/Implementation_Backlog.html; 03_Engineering/Test_Case_Catalogue.html; 03_Engineering/Decision_Register.html.

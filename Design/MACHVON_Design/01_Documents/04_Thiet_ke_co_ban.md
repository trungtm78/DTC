# Hệ Thống Lý Dự Án Đầu Tư Công thiết kế cơ bản
Baseline 1.3 | 22/10/2026 | Đối tượng: kiến trúc sư, kỹ thuật trưởng, vận hành và an toàn thông tin.

## Kiến trúc mục tiêu
Phân tách control plane và tenant data plane. Control plane quản lý tenant, domain, gói, subscription, license, entitlement, cấu hình vùng và health. Tenant data plane xử lý dự án, kế hoạch, báo cáo, hồ sơ, thanh toán, vướng mắc, hội thoại và BI. Web/mobile chỉ gọi API/BFF; không truy cập trực tiếp DB, vault hay provider API bằng khóa dài hạn.

Đề xuất khởi đầu modular monolith cho giao dịch vốn/báo cáo với ranh giới module rõ; tách worker document/OCR, AI gateway, notification và analytics do tải và vòng đời khác. Chưa cần chia mọi CRUD thành microservice. Dùng event/outbox để dễ tách module khi tải và đội vận hành thực sự đòi hỏi. Quyết định này giảm giao dịch phân tán trong kiểm soát số dư và phiên bản.

Luồng logic: Web/PWA/Native app → WAF/API gateway → IdP + Tenant resolver + Policy/Entitlement → BFF/API modules → PostgreSQL/Outbox/Object storage. Outbox → broker → analytics projection, notifications, integration, AI jobs. AI worker → retrieval theo ACL → LLM gateway → provider được duyệt. Provider callbacks → webhook gateway → inbox dedupe → worker → domain update.

## Ranh giới dữ liệu và cách ly tenant
Mặc định pool database với tenant_id trên mọi bảng nghiệp vụ và RLS defense-in-depth, composite foreign keys gồm tenant_id. Tài khoản ứng dụng không có BYPASSRLS và không là table owner khi chạy runtime. Context tenant thiết lập bằng SET LOCAL trong transaction, không giữ trên connection dùng chung sau request. Background job có signed tenant context; không chấp nhận tenant_id tùy ý từ queue chưa xác thực.

Object key bắt đầu tenant UUID; quyền download kiểm ở server rồi tạo URL ngắn hạn. Search index và vector store lọc tenant + ACL trước retrieval; kiểm quyền lại khi mở file. Cache key gồm tenant, scope hash, dataset version, query, filters và snapshot. Log/traces có tenant tag nhưng redact nội dung. Analytics export/public sharing là một đường dữ liệu cần kiểm thử riêng.

Gói Enterprise/Private có thể dùng database và encryption key riêng theo deployment stamp. Tenant registry ghi placement. Chuyển pooled sang dedicated phải freeze write có thời hạn, copy, verify checksum/count/totals, cutover routing, quan sát và rollback theo runbook. Không sao chép toàn bộ DB chứa tenant khác để phục hồi một tenant.

## Thành phần và lựa chọn công nghệ đề xuất
Web: TypeScript/React hoặc nền tảng tương đương có hệ thống design token và accessible components. Mobile: Flutter hoặc React Native sau spike về chữ ký số, camera, biometric, secure storage và offline. Chọn một framework khi chốt đội triển khai; mockup hiện tại không áp đặt framework. Core API: .NET hoặc Java theo năng lực đội; dùng một nền tảng chính, không trộn ngôn ngữ không cần thiết.

PostgreSQL cho transaction/decimal/versioning; object storage S3-compatible cho hồ sơ; Redis cho cache/rate limit/reservation hỗ trợ nhưng ngân sách sổ cái vẫn bền vững; broker có retry/DLQ; data warehouse hoặc column store khi tải BI vượt khả năng read replica/materialized views. Search và vector là projection có thể dựng lại, không là nguồn số tài chính. IdP hỗ trợ OIDC/SAML; chữ ký số và thanh toán qua adapter hợp đồng riêng.

Các lựa chọn trên là ADR đề xuất, không cam kết phiên bản/library khi chưa kiểm tra môi trường triển khai. Tách interface để thay cloud/private hạ tầng, LLM, kênh gửi và BI renderer.

## Mô hình miền và nguồn sự thật
Tenant → OrganizationUnit hiệu lực theo thời gian → Membership/RoleGrant/Delegation. Project → Component/WBS → PlanVersion → AllocationLine. Project → ReportingPeriod → ReportRevision → FundingSnapshotLine. ReportRevision được accepted là nguồn báo cáo nội bộ; TreasuryTransaction confirmed là nguồn đối soát thực trả; không trộn hai nguồn bằng phép cộng.

Project → ProcurementPackage → ContractorProposal → DocumentVersion → AnalysisRun → Finding/Evidence → ExpertReview. Contract/Amendment/Acceptance/PaymentRequest/AdvanceLedger liên kết cùng tenant/project. Issue → Assignment/Comment/Attachment/Resolution. MetricDefinition → DatasetVersion → DashboardVersion → QueryContext → ExportJob. NotificationEvent → WorkflowRun → RecipientDecision → DeliveryAttempt. Conversation → ChannelMessage/InternalNote. Tenant → Subscription → UsageMeter/Invoice; Tenant → LicenseRevision → EntitlementSnapshot.

Lịch sử tổ chức dùng valid_from/valid_to; báo cáo có thể xem theo tổ chức tại thời điểm chốt hoặc cơ cấu hiện tại, phải có nhãn. Không hard-code cấp huyện hay mô hình hành chính vào schema; hỗ trợ cơ cấu đã thay đổi và đơn vị kế thừa.

## Kiến trúc BI và drill down
Operational DB → outbox/CDC hợp lệ → staging có kiểm tra → facts/dimensions → semantic metrics → query service → dashboard/export. Fact allocation có grain dòng phân bổ theo phiên bản; fact disbursement snapshot theo dự án/kỳ/nguồn; fact treasury transaction theo giao dịch; fact LLM attempt theo request attempt; fact notification theo delivery attempt; fact subscription usage theo meter event.

Dimensions: tenant, thời gian, tổ chức SCD2, dự án, nguồn vốn, chương trình, channel/model/package. BI query service chỉ nhận metric/dimension IDs, filters và snapshot token; compiler tạo truy vấn allowlisted parameterized. Không cho browser gửi SQL vào warehouse. Aggregate table và cache giữ scope/version; lineage từ metric xuống source record và evidence.

Kiểm soát cardinality, timeout, row limit, concurrency và chi phí theo tenant. Truy vấn nặng trả job_id và notification khi xong. Đối với số liệu đã chốt, drill luôn dùng snapshot đó; refresh là thao tác rõ ràng, không tự nhảy về số mới làm tổng khác con.

## Kiến trúc AI và tương tác
AI gateway là điểm duy nhất được gọi provider; registry xác định model capability, region, pricing và trạng thái. Policy kiểm tra classification/retention, quota và task profile. Worker lưu provenance và chạy deterministic calculation ngoài LLM. Mỗi retry/fallback thành attempt có chi phí và bằng chứng model thực tế. Prompt/hồ sơ không được trực tiếp nắm API key hoặc quyền gửi thông báo.

Notification orchestration tách business transaction. Domain phát event, resolver tìm người nhận, policy kiểm consent/preferences, template render, scheduler, queue, adapter gửi. Hội thoại và notification có liên kết nhưng khác lifecycle: một notification gửi đi không tự thành hội thoại có quyền truy cập hồ sơ. Channel accounts thuộc tenant, hoặc shared provider account có virtual partition và mapping đã kiểm soát.

## Triển khai vận hành và mở rộng
Môi trường dev/test/staging/production tách credentials và dữ liệu. CI/CD kiểm schema migration, API compatibility, dependency scan, unit/integration/security tests. Rollout canary theo tenant cohort; feature flag rollback không thay schema ngược phá dữ liệu. Migration theo expand-contract, không xóa cột đang dùng bởi mobile cũ.

Sao lưu DB có PITR, object versioning, restore drill định kỳ và xác minh tổng tài chính sau restore. Metrics: p95 latency, error rate, queue age, stuck jobs, reconciliation backlog, budget reservation age, tenant isolation violations, notification failure, license propagation lag. Alert có owner/runbook; không tạo vòng lặp notification khi chính Notification Center hỏng, cần kênh vận hành độc lập.

Quotas theo tenant cho API concurrency, import size, query, AI, message, storage ngăn noisy neighbor. Tự mở rộng worker theo queue lag nhưng phải giữ provider quota và cost cap. Dùng bulkheads/circuit breaker để một kênh lỗi không kéo sập báo cáo lõi. Có trạng thái degraded và thời điểm dữ liệu gần nhất trên UI.

## Các quyết định kiến trúc cần phê duyệt
ADR01: modular core + worker tách tải. ADR02: pooled RLS mặc định, dedicated tùy hợp đồng. ADR03: accepted report snapshot không thay transaction ledger. ADR04: BI semantic layer thống nhất mọi dashboard. ADR05: AI gateway và reservation trước gọi. ADR06: notification at-least-once với dedupe, không tuyên bố exactly-once end-to-end. ADR07: mobile offline chỉ cho nháp. ADR08: license kiểm server, private lease tùy chọn. ADR09: browser mockup không phải ứng dụng production. ADR10: quyền xem của platform support chỉ cấp tạm theo ticket.


## Theme & thương hiệu theo tenant — SAS-04

Chỉ System Admin được cấu hình thương hiệu cho các tenant: màu sắc, logo, menu, header, footer, tên hệ thống, địa chỉ và thông tin liên hệ. Tenant Admin chỉ được đọc cấu hình đã công bố của tenant mình, không được sửa, lưu nháp, tải logo, tạo review, áp dụng hoặc khôi phục. Các quyền quản trị nội bộ tenant khác không bao gồm quyền cấu hình thương hiệu.

Bản nháp tách biệt theo tenant và không thay đổi giao diện đang dùng. Xem trước web/smartphone trong vùng riêng; bước review hiển thị chênh lệch trước/sau, tenant đích và phiên bản gốc. Xác nhận áp dụng tạo phiên bản bất biến mới. Khôi phục cũng phải review và tạo phiên bản mới, giữ nguyên lịch sử. Kiểm tra trường bắt buộc, email, tệp logo và sáu cặp màu tương phản tối thiểu 4,5:1 trước khi công bố.

Server phải xác thực System Admin cho mọi lệnh ghi; không tin vai trò, tenant_id hoặc cờ quyền do trình duyệt gửi. Review gắn actor, tenant, hash nội dung, base version và hạn sử dụng. Kiểm tra lại quyền và phiên bản trong giao dịch công bố; trả 403 khi thiếu quyền, 409 khi xung đột, 422 khi cấu hình không hợp lệ. Audit ghi người thực hiện, tenant, bản trước/sau, lý do khôi phục và thời điểm; không ghi bí mật vào log.

Prototype SAS-04 dùng localStorage và bộ chọn vai trò mô phỏng để kiểm tra trải nghiệm. Đây không phải hệ thống xác thực hoặc cách ly tenant thật. Chi tiết triển khai và tiêu chí nghiệm thu nằm tại 03_Engineering/Tenant_Theme_Specification.html.


## Ranh giới triển khai và quyết định
D01/D02 khóa stack/hạ tầng; core modular monolith và worker giữ nguyên. Control plane System Admin dùng audience/policy riêng, chọn tenant qua target đã xác thực; không cấp BYPASSRLS cho runtime. Các module phụ thuộc trong Module_Implementation_Contracts; provider adapters có mock trước sandbox. Xây CI/CD, migration expand-contract, audit/outbox và tenant security trước feature nghiệp vụ.

Tài liệu điều phối: 09_Ke_hoach_trien_khai; 10_Ke_hoach_kiem_thu_va_chuyen_doi; 03_Engineering/Implementation_Backlog.html; 03_Engineering/Test_Case_Catalogue.html; 03_Engineering/Decision_Register.html.

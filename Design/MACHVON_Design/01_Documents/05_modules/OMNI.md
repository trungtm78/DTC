# OMNI — Trung tâm tương tác đa kênh (Zalo OA, WhatsApp, email)

Phiên bản đặc tả M1 · 22/10/2026 · Nguồn dữ liệu máy: `work/staging/platform.json` (bảng `channel_account`, `conversation`, `channel_message`, `contact`, `contact_identity`, `contact_consent`, `conversation_routing_policy`, `canned_reply`, `integration_event_inbox`). Mẫu tin, consent, chống trùng, retry và webhook signature dùng chung quy tắc của `NOT.md` (BR-NOT-01..16) — tài liệu này chỉ nêu phần hội thoại hai chiều.

## 1. Mục đích, phạm vi, ranh giới

**Vấn đề nghiệp vụ.** Chủ đầu tư, nhà thầu và người dân (hộ bị ảnh hưởng GPMB) liên hệ Ban QLDA qua Zalo, WhatsApp, email; trao đổi rải rác trên điện thoại cá nhân của cán bộ, không gắn hồ sơ, không có SLA, mất khi cán bộ nghỉ việc. Cần một hộp thư chung theo tenant, gắn với dự án/vướng mắc, có phân công và hạn phản hồi, tách bạch ghi chú nội bộ với tin gửi ra ngoài, và không bao giờ gửi nhầm tenant/kênh hay gửi tài liệu mật ra ngoài.

**Trong phạm vi:** OMNI-01..11 — hộp thư hợp nhất và phân công (OMNI-01), chi tiết hội thoại, gửi tin/ghi chú nội bộ (OMNI-02), danh bạ và định danh đã xác minh (OMNI-03), đồng ý của liên hệ ngoài (OMNI-04), kết nối và cấu hình kênh (OMNI-05/06), phân công & SLA (OMNI-07), mẫu trả lời nhanh (OMNI-08), chuyển hội thoại thành vướng mắc (OMNI-09), thống kê (OMNI-10), hộp sự kiện webhook và đối soát (OMNI-11).

**Ngoài phạm vi:** thông báo một chiều từ sự kiện (NOT); tạo/xử lý vướng mắc (ISS — OMNI gọi command của ISS); gợi ý trả lời bằng LLM (LLM — chỉ gợi ý, không tự gửi; FRD UC08); cổng công khai cho người dân (R2+, ngoài nhóm này).

**Phụ thuộc:** NOT (mẫu ZNS/WhatsApp, consent, adapter, inbox), IAM (quyền OMNI_AGENT/SUPERVISOR, scope dự án khi liên kết), ADM (lịch làm việc cho SLA), ISS (command tạo vướng mắc), SAS (entitlement `omni`, meter tin nhắn), object storage (tệp đính kèm qua quét virus/quarantine).

**Căn cứ.** Luật BVDLCN 91/2025/QH15 + NĐ 356/2025/NĐ-CP (định danh, nội dung hội thoại của người dân là dữ liệu cá nhân; đồng ý theo mục đích; quyền rút đồng ý); Luật Tiếp công dân/Khiếu nại (phản ánh qua kênh số không thay thủ tục khiếu nại chính thức — OMNI chỉ tiếp nhận và chuyển vướng mắc) [CXN-OMNI-01]; chính sách Zalo Official Account (cửa sổ tương tác, tin chủ động theo mẫu) [CXN-ZNS-01]; WhatsApp Business Platform (opt-in, cửa sổ 24 giờ kể từ tin cuối của khách, ngoài cửa sổ chỉ template đã duyệt). Thực tiễn: Zendesk/Freshdesk/Intercom (shared inbox, SLA theo giờ làm việc, internal note), Twilio Conversations.

## 2. Actor, tenant và phạm vi quyền

| Actor | Scope | Được phép | Bị cấm |
|---|---|---|---|
| OMNI_AGENT (35) | hội thoại được giao hoặc hàng đợi của đơn vị mình | đọc, trả lời, ghi chú nội bộ, liên kết hồ sơ trong scope, chuyển vướng mắc (dự án trong scope), quản lý danh bạ/consent | gửi qua channel_account không thuộc hội thoại; gộp liên hệ không chung định danh xác minh; xem hội thoại hàng đợi khác |
| OMNI_SUPERVISOR (50) | tenant/subtree | như agent + phân công lại, cấu hình kênh, routing/SLA, mẫu trả lời, phát lại inbox, gộp liên hệ | đọc credential/secret kênh |
| Liên hệ ngoài (người dân, nhà thầu chưa có tài khoản) | qua kênh | nhắn tin, gửi tệp, rút đồng ý ("STOP") | — |
| Khách nhà thầu có tài khoản | không dùng OMNI (dùng ứng dụng với membership khách) | — | — |
| Nhà cung cấp kênh | webhook có chữ ký | gửi tin đến, receipt | — |

## 3. Luồng nghiệp vụ

### 3.1 Tin đến (inbound)
1. `receiveChannelWebhook` (`/webhooks/channels/{provider}`, x-public): xác minh chữ ký trên **raw body** bằng `webhook_secret_ref` của `channel_account` xác định từ `external_account_id` trong payload; sai → 401 `SIGNATURE_INVALID`, không lưu payload (chỉ metric + log id tài khoản); timestamp lệch > 5 phút → 401 `REPLAY_WINDOW_EXCEEDED`; tài khoản không tồn tại/Disabled → 404 `CHANNEL_ACCOUNT_UNKNOWN` (nhà cung cấp sẽ retry, dừng sau giới hạn của họ).
2. `INSERT integration_event_inbox (tenant, provider, event_key = provider message/event id) ON CONFLICT DO NOTHING`; payload lưu object storage, chỉ giữ `payload_hash` + `payload_reference`; trả 200 `{received:true, duplicate}` trong < 1 giây.
3. Worker xử lý (RECEIVED → PROCESSING → PROCESSED): tìm/tạo `contact` theo `contact_identity (channel, external_id_hash)` — không có → contact Unverified mới; tìm hội thoại mở theo `(channel_account, external_thread_id)` hoặc tạo mới (New); ghi `channel_message` INBOUND (unique `(conversation, provider_message_id)`); cập nhật `last_inbound_at`, `window_expires_at = last_inbound_at + 24h` (WhatsApp/Zalo OA [CXN-ZNS-01]); hội thoại Resolved nhận tin mới → InProgress (mở lại tự động); tin "STOP"/"HUY" → rút mọi consent của liên hệ trên kênh đó (BR-OMNI-03).
4. Tệp đính kèm → quarantine → quét virus → chỉ hiển thị khi sạch.
5. Routing: áp `conversation_routing_policy` Published (quy tắc theo kênh, từ khóa, đơn vị liên kết) → hàng đợi đơn vị; tính `sla_first_response_due_at` bằng `addWorkingTime` (ADM BR-ADM-08).
Lỗi xử lý: FAILED với `error_code`, retry backoff 1/5/30 phút (tối đa 10), rồi DEAD → OMNI-11, `replayInboxEvent`.

### 3.2 Phân công (OMNI-01, OMNI-07)
`assignConversation` (If-Match): người nhận phải là OMNI_AGENT/SUPERVISOR có scope hàng đợi (422 `ASSIGNEE_NOT_ELIGIBLE`); New → Assigned; agent mở → InProgress. Đồng thời: hai supervisor phân công cùng hội thoại → người sau 409 `VERSION_CONFLICT`.

### 3.3 Gửi tin / ghi chú (OMNI-02) — `sendConversationMessage`
Thứ tự kiểm (dừng ở lỗi đầu tiên, **tất cả trước khi gọi adapter**):
1. `kind = INTERNAL_NOTE` → ghi `channel_message` direction INTERNAL_NOTE, không tạo attempt, không bao giờ vào hàng đợi gửi (DB CHECK `provider_message_id IS NULL`). Kết thúc.
2. `channel_account_id` phải bằng `conversation.channel_account_id` và thuộc cùng tenant (composite FK) → khác: 422 `CHANNEL_ACCOUNT_MISMATCH` (không nêu chủ sở hữu của ID).
3. `channel_account.status = Active` và `verified_at` có → không: 422 `CHANNEL_UNVERIFIED`.
4. Consent của liên hệ cho `(channel, purpose)`: mục đích SUPPORT_CONVERSATION được coi là có căn cứ khi liên hệ tự khởi tạo hội thoại và còn trong cửa sổ; ngoài ra cần consent Granted → 422 `CONSENT_DENIED`. WhatsApp chưa opt-in → 422 `OPT_IN_REQUIRED`.
5. Cửa sổ: WhatsApp (và Zalo OA theo chính sách) — `now ≥ window_expires_at` và không dùng `template_version_id` Active đã được nhà cung cấp duyệt → 422 `CHANNEL_WINDOW_CLOSED`.
6. Nội dung: tệp/tài nguyên CONFIDENTIAL → không đính kèm (422 `CONTENT_CLASSIFICATION_BLOCKED`); liên kết hồ sơ → deep link opaque yêu cầu đăng nhập (BR-NOT-11).
7. Ghi `channel_message` OUTBOUND (author, purpose, classification) + `delivery_attempt` qua NOT dispatcher (retry/fallback theo BR-NOT-03, nhưng **không fallback sang kênh khác** cho hội thoại — trả lời phải đi đúng kênh khách dùng) → 202.
Đồng thời: gửi trùng Idempotency-Key → replay; hai agent gửi cùng lúc → hai tin hợp lệ (không xung đột), If-Match chỉ bảo vệ trạng thái hội thoại.

### 3.4 Liên kết và chuyển thành vướng mắc (OMNI-09)
`linkConversationResource`: người thao tác phải đọc được tài nguyên (PDP) → 403 `SCOPE_DENIED`. `convertConversationToIssue`: kiểm scope dự án → gọi command ISS `createIssue` (in-process, Idempotency-Key `omni:{conversation}:{version}`) với nguồn `channel=OMNI`, nội dung tóm tắt (không chép toàn bộ hội thoại có dữ liệu cá nhân — chỉ liên kết) → ISS từ chối → 422 `ISSUE_COMMAND_REJECTED` kèm mã lỗi ISS; thành công → `resource_links` += issue, ISS lưu liên kết ngược.

### 3.5 Danh bạ và định danh (OMNI-03)
`createContact` (Unverified) → `addContactIdentity` (channel PHONE/EMAIL/ZALO/WHATSAPP; lưu `external_id_hash = sha256(normalized)` + bản che) → `verifyContactIdentity` bằng OTP 6 số (hạn 10 phút, 5 lần sai khóa 30 phút), PROVIDER_VERIFIED (kênh chứng thực người gửi) hoặc ADMIN_DOCUMENT (văn bản/giấy tờ, SUPERVISOR) → Verified. Định danh đã thuộc liên hệ khác → 409 `IDENTITY_TAKEN`. `mergeContacts`: chỉ khi hai liên hệ có chung ít nhất một định danh **Verified** cùng `external_id_hash` (ngoài ra 422 `RECIPIENT_AMBIGUOUS`); bản bị gộp → Merged (`merged_into_id`), hội thoại chuyển sang bản giữ lại; consent **không** cộng dồn (mỗi consent giữ chủ thể gốc, tra cứu qua chuỗi merge).

### 3.6 Đồng ý của liên hệ ngoài (OMNI-04)
`recordContactConsent` (kênh × mục đích, `consent_text_version`, `capture_method`, `evidence_reference` — ví dụ ảnh chụp biên bản/tin nhắn opt-in) → Granted; `withdrawContactConsent` hoặc tin STOP → Withdrawn ngay; attempt chờ bị Suppressed (BR-NOT-07).

### 3.7 Kênh (OMNI-05, OMNI-06)
`connectChannelAccount` (secret chỉ là vault ref; UNIQUE `(tenant, channel, external_account_id)`) → PendingVerification → `verifyChannelAccount` (gọi API kiểm token + đăng ký webhook + nhận challenge) → Active (`verified_at`). `updateChannelAccount` (If-Match). `disableChannelAccount` → Disabled; attempt chờ → Suppressed; webhook đến tài khoản Disabled → 404. Credential hết hạn (provider báo) → CredentialExpired + cảnh báo.

## 4. State machine

```
conversation: New ──assign──► Assigned ──agent mở/trả lời──► InProgress ──chờ khách──► PendingCustomer
                 │                                        ▲        │                       │ tin đến
                 └──────────────tin đến──────────────────┘        └──resolve──► Resolved ◄─┘
              Resolved ──tin đến / reopen──► InProgress ;  Resolved ──7 ngày không tin──► Closed (cuối)
channel_account: PendingVerification ─verify─► Active ─disable─► Disabled ; Active ─(provider)─► CredentialExpired ─verify─► Active
contact: Unverified ─verify identity─► Verified ─merge─► Merged ; * ─block─► Blocked
contact_identity: Pending ─verify─► Verified ─(revoke)─► Revoked
inbox: RECEIVED ─► PROCESSING ─► PROCESSED ; PROCESSING ─► FAILED ─(retry)─► PROCESSING ; FAILED ─(10 lần)─► DEAD ─replay─► PROCESSING
```
| Từ | Command | Đến | Ai | Guard | Event |
|---|---|---|---|---|---|
| New | `assignConversation` | Assigned | SUPERVISOR/AGENT (tự nhận) | người nhận đủ điều kiện | `omni.conversation.assigned.v1` |
| Assigned/PendingCustomer | `sendConversationMessage` EXTERNAL | InProgress | assignee | §3.3 | `omni.message.queued.v1` |
| InProgress/PendingCustomer | `resolveConversation` | Resolved | assignee/SUPERVISOR | — | `omni.conversation.resolved.v1` |
| Resolved | `reopenConversation` / tin đến | InProgress | assignee/system | — | `omni.conversation.reopened.v1` |
| Resolved | (job 7 ngày) | Closed | system | không tin mới | `omni.conversation.closed.v1` |

Chuyển bị cấm: Closed → bất kỳ (tin mới tạo hội thoại mới có liên kết hội thoại cũ); resolve khi New (409 `CONVERSATION_STATE_INVALID`).

## 5. Quy tắc nghiệp vụ và công thức

- **BR-OMNI-01 Ghi chú nội bộ không bao giờ ra ngoài.** Kiểu dữ liệu `OutboundMessage` của adapter chỉ dựng từ `channel_message.direction = OUTBOUND`; DB CHECK chặn ghi chú có `provider_message_id`/`delivery_status`; test hợp đồng adapter từ chối mọi payload không có `outbound_message_id` (AC23).
- **BR-OMNI-02 Đúng tenant, đúng kênh.** Kiểm `CHANNEL_ACCOUNT_MISMATCH`/`CHANNEL_UNVERIFIED` tại service trước adapter; credential adapter được nạp theo `channel_account_id` của **hội thoại**, không theo tham số request (AC24).
- **BR-OMNI-03 Cửa sổ và đồng ý.** Liên hệ tự nhắn → căn cứ trả lời trong cửa sổ (24 giờ từ tin cuối); ngoài cửa sổ hoặc tin chủ động → cần consent Granted cho mục đích + mẫu đã được nhà cung cấp duyệt; WhatsApp cần opt-in ghi nhận trước tin chủ động đầu tiên. Từ khóa STOP/HUY/DUNG (không phân biệt hoa thường, bỏ dấu) → rút đồng ý kênh đó.
- **BR-OMNI-04 Webhook.** Xác minh chữ ký trước mọi xử lý; cửa sổ replay 5 phút; dedupe `(tenant, provider, event_key)`; ACK sau persist; xử lý bất đồng bộ; không bao giờ tin `tenant_id` trong payload — tenant suy từ `channel_account`.
- **BR-OMNI-05 Gộp định danh.** Không bao giờ ghép theo tên hiển thị/ảnh đại diện; chỉ theo định danh Verified chung; gộp ghi audit đầy đủ và tách lại được (unmerge R2) [GIẢ ĐỊNH].
- **BR-OMNI-06 SLA theo giờ làm việc.** `sla_first_response_due_at = addWorkingTime(calendar_code của policy, created_at, first_response_minutes)`; `sla_resolution_due_at` tương tự với `resolution_hours`. Ví dụ: tin 2026-10-23 (thứ 6) 16:50 +07, 30 phút làm việc → 2026-10-26 08:20 +07 (UAT-AC199). Thời gian phản hồi đầu = outbound đầu tiên − inbound đầu tiên tính theo giờ làm việc; ghi chú nội bộ không tính là phản hồi.
- **BR-OMNI-07 Nội dung nhạy cảm.** Tài liệu CONFIDENTIAL không đính kèm; dữ liệu cá nhân của người khác không chép sang hội thoại; tin gửi đi có `classification` (mặc định INTERNAL).
- **BR-OMNI-08 Mẫu trả lời nhanh.** Chỉ PUBLIC/INTERNAL, không biến; tin chủ động ngoài cửa sổ phải dùng template NOT (không dùng canned reply).
- **BR-OMNI-09 Thống kê.** Tỷ lệ đạt SLA phản hồi đầu = số hội thoại có phản hồi đầu ≤ hạn / số hội thoại có hạn trong kỳ (mẫu số 0 → "Chưa có cơ sở tính"); thống kê không chứa nội dung.

## 6. Dữ liệu

| Bảng | Trường chính (mới/sửa) | Ràng buộc | Phân loại | Lưu giữ |
|---|---|---|---|---|
| `channel_account` (sửa, dùng chung NOT) | + display_name, webhook_secret_ref, verified_at, daily_send_cap, monthly_budget_vnd, version | UNIQUE (tenant, channel, external_account_id); Active ⇒ verified | CONFIDENTIAL | vĩnh viễn |
| `conversation` (sửa) | + contact_id (bắt buộc), priority, routing_policy_id, last_inbound_at, window_expires_at, sla_first_response_due_at, sla_resolution_due_at, created_at, version; `verified_contact_id`, `assignee_id` thành nullable | UNIQUE (tenant, channel_account, external_thread_id); CHECK status; New ⇔ có thể chưa assignee | PERSONAL | 5 năm sau Closed; nếu liên kết hồ sơ → theo lớp hồ sơ |
| `channel_message` (sửa) | + direction, author_membership_id, purpose, template_version_id, delivery_status, classification, inbox_event_id, created_at; `provider_message_id` nullable | CHECK ghi chú không có provider id; OUTBOUND cần author + purpose; UNIQUE provider id/hội thoại | PERSONAL | như conversation |
| `contact` (sửa) | + phone_hash, email_hash, preferred_channel, merged_into_id, created_at, version | CHECK status; Merged ⇔ merged_into_id | PERSONAL | 5 năm sau tương tác cuối, rồi ẩn danh |
| `contact_identity` (mới) | contact_id, channel, external_id_hash, external_id_masked, verification_method, verified_at/by, status | UNIQUE (tenant, channel, external_id_hash) | PERSONAL | như contact |
| `contact_consent` (dùng chung NOT) | xem NOT §6 | | PERSONAL | 5 năm sau rút |
| `conversation_routing_policy` (mới) | revision, rules_json, calendar_code, first_response_minutes, resolution_hours, status | UNIQUE (tenant, revision) | INTERNAL | vĩnh viễn |
| `canned_reply` (mới) | code, title, body_text, channels, classification, status | UNIQUE (tenant, code) | INTERNAL | vĩnh viễn |
| `integration_event_inbox` (dùng chung ADM) | + channel_account_id, signature_key_id, provider_timestamp, attempts, next_attempt_at, processed_at, error_code | UNIQUE (tenant, provider, event_key) | INTERNAL | payload 90 ngày |

## 7. API / command

| operationId | Method path | x-permission | DTO | Lỗi chính | If-Match |
|---|---|---|---|---|---|
| connectChannelAccount | POST /channel-accounts | omni.channel.manage | ChannelAccountConnect | 409 CHANNEL_ACCOUNT_EXISTS | không |
| verifyChannelAccount / disableChannelAccount | POST /channel-accounts/{channelAccountId}/verify\|disable | omni.channel.manage | ReasonOnly | 422 CHANNEL_UNVERIFIED | có |
| updateChannelAccount | PUT /channel-accounts/{channelAccountId} | omni.channel.manage | ChannelAccountUpdate | 409 VERSION_CONFLICT | có |
| sendConversationMessage | POST /conversations/{conversationId}/messages | omni.conversation.reply | ConversationMessageSend → 202 | 422 CONSENT_DENIED, CHANNEL_ACCOUNT_MISMATCH, CHANNEL_WINDOW_CLOSED, OPT_IN_REQUIRED, CONTENT_CLASSIFICATION_BLOCKED, CHANNEL_UNVERIFIED | có |
| assignConversation | POST /conversations/{conversationId}/assign | omni.conversation.assign | ConversationAssign | 422 ASSIGNEE_NOT_ELIGIBLE | có |
| resolveConversation / reopenConversation | POST …/resolve\|reopen | omni.conversation.reply | ReasonOnly | 409 CONVERSATION_STATE_INVALID | có |
| linkConversationResource | POST /conversations/{conversationId}/links | omni.conversation.reply | ResourceLink | 403 SCOPE_DENIED | có |
| convertConversationToIssue | POST /conversations/{conversationId}/issues | omni.conversation.convert | ConversationToIssue | 403 SCOPE_DENIED; 422 ISSUE_COMMAND_REJECTED | có |
| createContact / addContactIdentity / verifyContactIdentity | POST /contacts, /contacts/{contactId}/identities, …/{identityId}/verify | omni.contact.manage | ContactCreate / ContactIdentityAdd / IdentityVerify | 409 IDENTITY_TAKEN; 422 OTP_INVALID, IDENTITY_UNVERIFIED | verify có |
| mergeContacts | POST /contacts/merges | omni.contact.merge | ContactMerge | 422 RECIPIENT_AMBIGUOUS, IDENTITY_UNVERIFIED | không (kiểm version trong body ngầm qua shared identity) |
| recordContactConsent / withdrawContactConsent | POST /contacts/{contactId}/consents, /contact-consents/{consentId}/withdraw | omni.consent.manage | ConsentGrant / ReasonOnly | 409 CONSENT_ALREADY_GRANTED, CONSENT_STATE_INVALID | withdraw có |
| createRoutingPolicyVersion / publishRoutingPolicy | POST /conversation-routing-policies, …/{policyId}/publish | omni.policy.manage | RoutingPolicyDraft / ReasonOnly | 422 POLICY_INVALID | publish có |
| createCannedReply / updateCannedReply | POST /canned-replies, PUT /canned-replies/{replyId} | omni.policy.manage | CannedReplyUpsert | 409 CANNED_CODE_TAKEN | PUT có |
| receiveChannelWebhook | POST /webhooks/channels/{provider} | webhook.provider (x-public) | ProviderWebhook → WebhookAck | 401 SIGNATURE_INVALID, REPLAY_WINDOW_EXCEEDED; 404 CHANNEL_ACCOUNT_UNKNOWN | — |
| replayInboxEvent | POST /integration-inbox/{inboxEventId}/replay | adm.integration.operate | ReasonOnly | 409 INBOX_STATE_INVALID | có |

Rà soát GET scaffold: `conversation` **DTO riêng** (theo hàng đợi/assignee và liên kết hồ sơ), `channel_message` **DTO riêng** (ghi chú nội bộ chỉ tác nhân OMNI; nội dung CONFIDENTIAL che), `contact` **DTO riêng** (định danh che), `contact_consent` **DTO riêng**, `channel_account` **DTO riêng** (không secret). Không endpoint ghi chung đổi status/tenant/kênh của hội thoại.

## 8. UI/UX

| Màn hình | Field thêm/mới | Ghi chú |
|---|---|---|
| OMNI-01 | Trạng thái, Hạn phản hồi đầu | hội thoại sắp quá hạn màu cảnh báo; lọc theo hàng đợi |
| OMNI-02 | Loại (ra ngoài/ghi chú nội bộ), Cửa sổ 24h, Mục đích gửi | ô soạn có công tắc rõ "Ghi chú nội bộ — không gửi khách" (màu khác); nút gửi ghi tên kênh + người nhận; đồng hồ đếm cửa sổ; khi đóng cửa sổ chỉ cho chọn template |
| OMNI-03 | Định danh đã xác minh, Gộp | nút gộp chỉ bật khi có định danh xác minh chung |
| OMNI-04 | Phiên bản điều khoản, Cách thu thập, Rút đồng ý | |
| OMNI-05/06 | Xác minh lúc; Tên hiển thị, Tự trả lời ngoài giờ | secret chỉ hiển thị "đã cấu hình" |
| OMNI-07/08 | Phiên bản, Phút phản hồi đầu, Giờ giải quyết; Phân loại | |
| OMNI-09 | Tóm tắt | chọn dự án chỉ trong scope |
| OMNI-10 | Mẫu số, Kỳ | theo BR-OMNI-09 |
| OMNI-11 (mới) | Nhà cung cấp, Mã sự kiện, Chữ ký hợp lệ, Nhận lúc, Trạng thái, Số lần xử lý, Mã lỗi | bảng; phát lại cho FAILED/DEAD; không hiển thị payload thô |

Web only (P1). 7 trạng thái chuẩn + `window-closed`, `channel-disabled`.

## 9. Sự kiện, job, tích hợp, quan sát

- Produce: `omni.conversation.assigned|resolved|reopened|closed|converted.v1`, `omni.message.queued.v1`, `omni.contact.merged.v1`, `omni.channel_account.verified|disabled.v1`; consume: `not.consent.changed.v1`, `iam.access.changed.v1` (gỡ assignee mất quyền → về hàng đợi), `issue.closed.v1` (ISS — gợi ý resolve hội thoại liên kết).
- Job: SLA breach mỗi phút (cảnh báo SUPERVISOR qua NOT), đóng hội thoại Resolved 7 ngày, retry inbox FAILED, cảnh báo credential sắp hết hạn.
- Adapter: `ZaloOaPort`, `WhatsAppPort`, `EmailInboundPort` (webhook nhà cung cấp email hoặc IMAP poll — PROPOSED); trạng thái MOCK ở R1, PROPOSED → VERIFIED khi có hợp đồng D06.
- Telemetry: `omni_inbound_total{channel}`, `omni_first_response_seconds` (working-time), `omni_sla_breach_total`, `webhook_signature_failures_total{provider}` (cảnh báo khi > 10/5 phút — dấu hiệu tấn công/xoay khóa), `inbox_dead_total`. Log không chứa nội dung tin/định danh.

## 10. Kiểm thử

| ID | Loại | Ưu tiên | Setup | Input/Bước | Expected | Bằng chứng |
|---|---|---|---|---|---|---|
| UAT-AC22 | integration | P1 | 2 consent | rút SUPPORT; gửi; gửi REMINDER | 422 CONSENT_DENIED; 202 | adapter log |
| UAT-AC23 | security | P1 | WhatsApp mở cửa sổ | ghi chú nội bộ | không payload ra ngoài; CHECK | adapter log |
| UAT-AC24 | security | P0 | ZOA-B, ZOA-A2 | gửi sai tenant/kênh tắt/đúng | 422 MISMATCH; 422 UNVERIFIED; 202 | audit |
| UAT-AC25 | security | P1 | DOC-77 mật | đính kèm; liên kết | 422; deep link | email mock |
| UAT-AC195 | integration | P0 | cửa sổ đóng | text; template; không opt-in | 422 WINDOW_CLOSED; 202; 422 OPT_IN_REQUIRED | API log |
| UAT-AC196 | security | P0 | WhatsApp HMAC | sửa 1 byte; cũ 10 phút; hợp lệ ×2 | 401; 401; 200/200 dup, 1 dòng | DB + metric |
| UAT-AC197 | security | P0 | trùng tên | gộp không/có định danh chung | 422 RECIPIENT_AMBIGUOUS; Merged | audit |
| UAT-AC198 | integration | P1 | scope P-01 | chuyển P-09; P-01 | 403; issue tạo | ISS DB |
| UAT-AC199 | domain | P1 | policy 30 phút | tin thứ 6 16:50 | hạn thứ 2 08:20 | DB |
| UAT-AC138 | integration | P1 | inbox FAILED | replay | PROCESSED; 409 | DB |
| UI-OMNI-11 | screen-contract | P1 | route | 7 trạng thái | đúng trường | ảnh chụp |

## 11. Tiêu chí nghiệm thu (đo được)

- AC-OMNI-01: Given ghi chú nội bộ, Then 0 byte nội dung tới bất kỳ adapter (UAT-AC23).
- AC-OMNI-02: Given channel_account khác tenant/khác hội thoại/chưa xác minh, Then bị chặn trước adapter (UAT-AC24).
- AC-OMNI-03: Given consent bị rút/không opt-in/cửa sổ đóng, Then không gửi tin tự do; chỉ template đã duyệt khi được phép (UAT-AC22, UAT-AC195).
- AC-OMNI-04: Given webhook sai chữ ký/quá cũ/trùng, Then không xử lý/không nhân đôi tin (UAT-AC196).
- AC-OMNI-05: Given hai liên hệ trùng tên không có định danh xác minh chung, Then không gộp (UAT-AC197).
- AC-OMNI-06: Given tài liệu mật, Then chỉ gửi link xác thực (UAT-AC25).
- AC-OMNI-07: Given policy SLA, Then hạn phản hồi tính theo giờ làm việc đúng ví dụ chuẩn (UAT-AC199).

## 12. Mức tối thiểu cho R1 và phần sâu hóa R2+

- **R1:** không bắt buộc ở R1 (phase P1 theo catalog); chuẩn bị nền: inbox webhook dùng chung, consent dùng chung NOT, `channel_account` + adapter MOCK.
- **R2 (dùng thật):** email inbound/outbound + Zalo OA qua adapter (nếu D06 có hợp đồng), OMNI-01..07, OMNI-09 (chuyển vướng mắc), OMNI-11.
- **R3:** WhatsApp, thống kê OMNI-10 đầy đủ, gợi ý trả lời LLM (chỉ gợi ý), unmerge liên hệ.
- **Giờ review người (R2-D5):** 8 giờ — **quyền/pháp lý** (BR-OMNI-02/03/05, dữ liệu cá nhân người dân), **tích hợp** (hợp đồng webhook từng nhà cung cấp).

## 13. Rủi ro, câu hỏi mở, phụ thuộc bên thứ ba

| Mục | Owner | Điều kiện giải quyết |
|---|---|---|
| [CXN-OMNI-01] Ranh giới giữa phản ánh qua kênh số và thủ tục tiếp công dân/khiếu nại chính thức | Pháp chế + Chủ nghiệp vụ GPMB | Quy chế tiếp nhận; OMNI hiển thị thông báo "không thay đơn khiếu nại" |
| [CXN-ZNS-01] Chính sách cửa sổ tương tác Zalo OA, phí, điều kiện tin chủ động | Mua sắm (D06) | Hợp đồng + tài liệu Zalo; cấu hình `window` theo kênh là dữ liệu |
| WhatsApp cần BSP và Meta Business verification cho cơ quan nhà nước | PO | Quyết định có dùng WhatsApp hay không (đối tượng nhà thầu nước ngoài/ODA) |
| [GIẢ ĐỊNH] đóng hội thoại sau 7 ngày, unmerge ở R2 | PO | Xác nhận UAT |
| Rủi ro cán bộ vẫn dùng Zalo cá nhân ngoài hệ thống | Chủ nghiệp vụ | Chính sách tỉnh + đào tạo; đo tỷ lệ tin qua OMNI |

# Bàn giao thiết kế Hệ Thống Lý Dự Án Đầu Tư Công

Figma chưa được kết nối trong phiên này. Bộ bàn giao có SVG, PNG, token JSON và prototype HTML; chưa tạo file .fig native, Auto Layout hay component library trong Figma.

Tạo pages 00 Overview / 01 Foundations / 02 Components / 03 Web / 04 Mobile / 05 Flows / 06 States / 07 Handoff. Nhập SVG cần review theo figma_import_manifest.json; mỗi frame đặt mã màn hình trước tên. SVG giữ text/vector ở mức gần đúng; gradient/conic ring, clipping, form controls và pseudo element lấy PNG/HTML làm chuẩn đối chiếu.

Tạo variables semantic từ design_tokens.json; alias primary/surface/ink theo tenant theme. Component contracts: AppShell, TenantSwitcher, WorkspaceHeader, SearchPalette, MetricTile, DataTable, FilterBar, MoneyInput, EvidencePanel, StatusBadge, ApprovalBar, Timeline, NotificationItem, WorkflowNode, DashboardWidget, MobileTaskCard, BottomNavigation. Variants gồm size, density, state, permission, platform; không nhân đôi component theo tenant. Theme validator kiểm contrast và logo bounds trước publish.

Web frame 1440px, content grid 12 cột, sidebar 252px (236px ở cửa sổ hẹp); mobile 390px, safe areas và chiều cao cuộn. Constraints: content min-width 0, bảng scroll trong vùng bảng, inspector 320–400px; tablet chuyển inspector thành drawer. Layout chi tiết xem HTML/CSS. Dùng Auto Layout để tái tạo semantics sau import, không coi group SVG là component production.

Flows review: HOME-01 → drill; DIS-01 → DIS-07; BID-05 → BID-13; CTR-01 → CTR-18; BI-03 editor; LLM-04 profile; SAS license; MOB-01 → MOB-07 và MOB-13 → MOB-21. Loading/empty/error/denied/offline/expired có trong selector trạng thái dùng chung. Dialog xác nhận/validation và quyền cần QA theo FRD và Screen Specifications.


Người dùng chấp nhận công cụ khác Figma. Nguồn thiết kế hiện tại là prototype HTML/CSS/JS, Design_Board.html, design_tokens.json và SVG. Figma không phải điều kiện để review. Không có file Figma native được tạo hoặc xác nhận.

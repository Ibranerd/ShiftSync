# PrioritySoft Completion TODO

## Server-Side Enforcement
1. Enforce all assignment constraints server-side using DB‑fetched data.
2. Ensure swap/drop actions validate qualifications and availability in API.

## Edge Cases & Automation
3. Schedule cron for swap/drop expiry (Vercel cron → `/api/cron/expire-requests`).
4. Ensure swap/drop auto-cancel on shift edits surfaces in UI with notifications.

## Overtime & Compliance
5. Manager override flow for 7th consecutive day stored in `shift_assignments.override_reason`.
6. Overtime projection dashboard with shift‑level contribution breakdown.

## Realtime Completeness
7. Realtime updates for schedule publish/unpublish and assignment changes across all roles.
8. On-duty dashboard live refresh by location.

## UX Depth
9. Full schedule creation/editing with headcount and skill filters.
10. Filterable notification center (read/unread, type).

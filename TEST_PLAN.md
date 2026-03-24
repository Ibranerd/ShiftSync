# ShiftSync Test Plan

## Seeded Test Accounts
Admin:
- admin@shiftsync.dev
- password - Password123!

Managers:
- manager1@shiftsync.dev
- manager2@shiftsync.dev

Staff (staff1 through staff20):
- staff1@shiftsync.dev
- staff2@shiftsync.dev
- staff3@shiftsync.dev
- staff4@shiftsync.dev
- staff5@shiftsync.dev
- staff6@shiftsync.dev
- staff7@shiftsync.dev
- staff8@shiftsync.dev
- staff9@shiftsync.dev
- staff10@shiftsync.dev
- staff11@shiftsync.dev
- staff12@shiftsync.dev
- staff13@shiftsync.dev
- staff14@shiftsync.dev
- staff15@shiftsync.dev
- staff16@shiftsync.dev
- staff17@shiftsync.dev
- staff18@shiftsync.dev
- staff19@shiftsync.dev
- staff20@shiftsync.dev

## 1. User Management & Roles
1. Sign in as Admin, Manager, Staff.
2. Admin can view all locations, users, shifts, assignments.
3. Manager sees only assigned locations and related users/shifts.
4. Staff sees only their own profile, assignments, availability, notifications.
5. Staff certified at multiple locations can be assigned at either.

## 2. Shift Scheduling Constraints
1. Create overlapping shifts → confirm double-book block.
2. Assign back-to-back shifts with <10 hours gap → block.
3. Assign without required skill → block.
4. Assign at location without certification → block.
5. Assign outside availability window → block.
6. Confirm violation messages are clear and specific.
7. Verify suggested alternatives appear when a block occurs.

## 3. Schedule Publish/Unpublish + Cutoff
1. Create shift, set publish flag on create.
2. Unpublish a shift more than 48 hours before start → allowed.
3. Unpublish within 48 hours → blocked unless admin override + reason.
4. Verify audit log captures publish/unpublish changes.

## 4. Swap Requests
1. Staff requests swap with another qualified staff.
2. Target staff accepts → status moves to `pending_manager`.
3. Manager approves → swap finalized.
4. Cancel swap before approval → restored.
5. Exceed 3 pending swap requests → blocked.
6. Wait 24 hours → swap expires.
7. Manager edits shift while swap pending → swap auto-cancelled + notifications.

## 5. Drop Requests & Pick-Up
1. Staff creates drop request.
2. Another qualified staff claims drop.
3. Manager approves → assignment updates.
4. Exceed 3 pending drop requests → blocked.
5. 24 hours before shift start → drop auto-expires.
6. Shift edited after claim → drop cancelled + notifications.

## 6. Overtime & Labor Rules
1. Weekly hours reach 35 → warning.
2. Daily hours ≥8 → warning.
3. Daily hours >12 → block.
4. 6th consecutive day → warning.
5. 7th consecutive day → requires manager override reason + audit log.
6. Overtime cost projection updates before confirming assignment.

## 7. Fairness Analytics
1. View total hours distribution by staff over selectable period.
2. Verify premium shifts (Fri/Sat evenings or `is_premium`) distribution.
3. Confirm fairness variance vs desired hours.
4. Identify under/over-scheduled staff.

## 8. Real-Time Behavior
1. Publish schedule → staff sees update without refresh.
2. Modify assignment → staff sees notification in real-time.
3. Swap or drop status change → relevant parties see real-time update.
4. On-duty dashboard updates live as assignments change.
5. Simultaneous assignment by two managers → one receives conflict.

## 9. Notifications & Preferences
1. Verify notifications are written on assignment, swap, drop, publish events.
2. Staff can mark notifications read/unread.
3. Notification preferences saved (in-app vs email simulation).
4. Managers receive overtime and availability change notifications.

## 10. Timezone & DST
1. Assign staff at ET and PT locations; availability is interpreted per shift location.
2. Overnight shift (11pm–3am) handled as single shift with availability across two days.
3. DST start/end shifts validate correctly.

## 11. Audit Trail
1. Change a shift → audit log records before/after + who/when.
2. Change assignment → audit log records before/after.
3. Export audit logs filtered by date and location.

## 12. Seed Data Validation
1. 4 locations (2 ET, 2 PT).
2. ~20 staff with mixed skills/certifications.
3. Availability windows + exceptions exist.
4. At least one conflict case in shifts.
5. Pending swap request exists.
6. Overtime edge case exists.
7. Fairness imbalance exists.

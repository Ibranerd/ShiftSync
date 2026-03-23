# ShiftSync Engineering Plan

This document is a senior-level execution plan for building ShiftSync in 72 hours with Next.js and Supabase. It is intentionally opinionated, implementation-focused, and sequenced to reduce architectural risk early.

## Goal

Build a multi-location staff scheduling system that supports:

- role-based access for admin, manager, and staff
- multi-timezone scheduling
- assignment validation and conflict prevention
- overtime and fairness insights
- swap requests with approvals
- realtime schedule updates and notifications
- auditable scheduling changes

## Core Architectural Principle

The assignment constraint engine must be a pure TypeScript module that is shared by both the UI and the server.

- The UI calls it for immediate feedback.
- The API calls it as the final enforcement gate.
- The engine must not make database calls.
- The caller must prefetch data and pass typed inputs into it.

If constraints only live in the UI, data integrity will eventually drift.

## Recommended Project Structure

```text
/app
  /(auth)/login
  /(admin)/dashboard
  /(admin)/audit-logs
  /(admin)/fairness
  /(manager)/schedule
  /(manager)/staff
  /(manager)/swaps
  /(staff)/my-shifts
  /(staff)/swap-requests
  /(staff)/availability
  /api/shifts
  /api/assignments
  /api/swaps
  /api/notifications
/lib
  /constraint-engine
  /overtime
  /fairness
  /timezone
  /supabase
/db
  /migrations
  /seed.ts
/types
  index.ts
```

Design rules:

- `lib/constraint-engine`, `lib/overtime`, and `lib/fairness` should have zero Next.js or Supabase imports.
- Shared types should live in `types/index.ts`.
- Database changes should be versioned in numbered SQL migrations.
- Timezone helpers should be wrapped in one place to avoid inconsistent conversions.

## Tech Stack

- Next.js 14 with App Router
- TypeScript in strict mode
- Tailwind CSS
- shadcn/ui
- Supabase Auth, Postgres, Realtime, and Storage if needed later
- `date-fns` and `date-fns-tz`
- FullCalendar for scheduling UI

## Database Design

Design this first. Everything depends on it.

### Core Tables

- `users`
- `locations`
- `user_locations`
- `skills`
- `user_skills`
- `availability_windows`
- `shifts`
- `shift_assignments`
- `swap_requests`
- `notifications`
- `audit_logs`
- `overtime_warnings`

### Critical Schema Decisions

#### Time storage

- Store all timestamps in UTC.
- Use `timestamptz` for `shifts.start_utc` and `shifts.end_utc`.
- Add `timezone` to `locations`.
- Convert for display in the app using `date-fns-tz`.
- Never persist local wall-clock time as the source of truth.

#### Certifications

Use `user_locations` for certification and authorization to work at a location.

Recommended columns:

- `user_id`
- `location_id`
- `certified_at`
- `revoked_at` nullable

Do not hard-delete certification history. If a staff member is de-certified, set `revoked_at` and preserve historical assignments.

#### Availability

`availability_windows` should support recurring rules and date-specific exceptions.

Recommended columns:

- `user_id`
- `day_of_week` nullable for exceptions if desired
- `start_local_time`
- `end_local_time`
- `exception_date` nullable
- `is_unavailable` boolean

Rule:

- `exception_date IS NULL` means recurring availability.
- `is_unavailable = true` means a blackout exception, not an available window.

#### Assignment and swap statuses

Recommended enum values:

- `shift_assignments.status`: `assigned`, `confirmed`, `dropped`
- `swap_requests.status`: `pending_staff`, `pending_manager`, `approved`, `rejected`, `cancelled`, `expired`

### Suggested Indexes

Create these on day one:

```sql
CREATE INDEX ON shift_assignments (user_id, shift_id);
CREATE INDEX ON shifts (location_id, start_utc, end_utc);
CREATE INDEX ON availability_windows (user_id, day_of_week);
CREATE INDEX ON audit_logs (entity_type, entity_id, changed_at DESC);
```

## Role Model and Access Control

Use Supabase Auth with a custom role claim in the JWT:

- `admin`
- `manager`
- `staff`

Apply RLS from the beginning. Do not postpone it.

Policy shape:

- admins can read and manage everything
- managers can access users, shifts, assignments, and swaps only for locations they manage
- staff can access only their own profile, assignments, availability, notifications, and swap requests relevant to them

RLS mistakes found late are expensive because they affect every screen and every query.

## Constraint Engine

This is the heart of the app.

### Target API

```ts
export interface ValidationResult {
  valid: boolean
  violations: Violation[]
  suggestions: StaffSuggestion[]
}

export interface Violation {
  rule: RuleCode
  message: string
  severity: 'block' | 'warn'
}

type RuleCode =
  | 'DOUBLE_BOOK'
  | 'REST_GAP'
  | 'SKILL_MISMATCH'
  | 'LOCATION_NOT_CERTIFIED'
  | 'AVAILABILITY_CONFLICT'
  | 'DAILY_HOURS_EXCEEDED'
  | 'WEEKLY_HOURS_WARNING'
  | 'CONSECUTIVE_DAYS_7'
  | 'CONSECUTIVE_DAYS_6'

export async function validateAssignment(
  candidateUserId: string,
  targetShift: Shift,
  existingAssignments: ShiftAssignment[],
  userSkills: Skill[],
  userLocations: UserLocation[],
  availabilityWindows: AvailabilityWindow[],
): Promise<ValidationResult>
```

### Rules to Enforce

- no overlapping shifts
- minimum 10-hour rest gap
- required skill match
- active certification for the target location
- availability covers the shift window
- overtime warning at 35 hours weekly
- hard block at 12 hours per day
- hard block on 7th consecutive day
- optional warning on 6 consecutive days

### Implementation Rules

- each rule should be its own pure function
- the orchestrator should call rules in a consistent order
- block-severity failures can short-circuit
- the engine should return human-readable messages and suggested replacements
- the engine must receive prefetched data only

### Timezone Rule for Availability

Availability should be evaluated in the shift location's timezone.

This is an intentional product decision:

- if a staff member is certified at both ET and PT locations, their availability should be interpreted relative to the location of the shift being assigned
- this must be documented clearly because it affects multi-timezone behavior

## Concurrency Protection

Concurrent assignments must be protected server-side.

Recommended approach: use a Postgres RPC function with an advisory transaction lock and rerun overlap checks inside the lock.

```sql
CREATE OR REPLACE FUNCTION assign_staff_to_shift(
  p_shift_id uuid,
  p_user_id uuid,
  p_assigned_by uuid
) RETURNS json AS $$
DECLARE
  v_lock_key bigint;
  v_conflict shift_assignments%ROWTYPE;
BEGIN
  v_lock_key := ('x' || substr(p_user_id::text, 1, 8))::bit(32)::int;

  IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
    RETURN json_build_object(
      'error', 'conflict',
      'message', 'Another manager is assigning this staff member. Please try again.'
    );
  END IF;

  SELECT * INTO v_conflict
  FROM shift_assignments sa
  JOIN shifts s ON s.id = sa.shift_id
  WHERE sa.user_id = p_user_id
    AND sa.status != 'dropped'
    AND s.start_utc < (SELECT end_utc FROM shifts WHERE id = p_shift_id)
    AND s.end_utc > (SELECT start_utc FROM shifts WHERE id = p_shift_id);

  IF FOUND THEN
    RETURN json_build_object(
      'error', 'overlap',
      'message', 'Staff member already assigned to an overlapping shift.'
    );
  END IF;

  INSERT INTO shift_assignments (shift_id, user_id, assigned_by)
  VALUES (p_shift_id, p_user_id, p_assigned_by);

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql;
```

Call this from the API with `supabase.rpc('assign_staff_to_shift', ...)`.

## Realtime Design

Use Supabase Realtime in three lanes:

### 1. Schedule updates

- subscribe to `shift_assignments`
- managers publish changes
- staff receive schedule updates immediately

### 2. On-duty dashboard

- subscribe to `shift_assignments`
- filter active assignments based on current time
- render a live per-location dashboard

### 3. Notifications

- subscribe to `notifications`
- filter by current user
- insert notifications through Postgres triggers, not API routes

Important rule:

- notifications should be written atomically with the underlying data change
- database triggers are safer than application code for this

## Overtime and Fairness

### Overtime

Use a database view for weekly hours:

```sql
CREATE VIEW weekly_hours AS
SELECT
  sa.user_id,
  date_trunc('week', s.start_utc) AS week_start,
  SUM(EXTRACT(EPOCH FROM (s.end_utc - s.start_utc)) / 3600) AS total_hours
FROM shift_assignments sa
JOIN shifts s ON s.id = sa.shift_id
WHERE sa.status != 'dropped'
GROUP BY sa.user_id, week_start;
```

Rules:

- warn at 35 weekly hours
- block at 12 hours worked in a day
- block on 7 consecutive calendar days worked
- manager override should require a reason and write to the audit log

### Fairness

Track:

- total assigned hours by staff over a chosen period
- premium shifts per staff member
- fairness score for premium shift distribution

Suggested premium shift definition:

- Friday and Saturday evening shifts
- or mark premium shifts explicitly with `shifts.is_premium`

Recommended presentation:

- bar chart sorted ascending
- highlight staff receiving disproportionately low or high premium distribution

## Swap Workflow

Implement swaps as a guarded state machine.

Suggested transitions:

- `pending_staff`
- `pending_manager`
- `approved`
- `rejected`
- `cancelled`
- `expired`

API design:

- `POST /api/swaps`
- one route with an `action` parameter
- supported actions: `request`, `accept`, `reject`, `approve`, `cancel`
- every action must validate the current state before transition

Business rules:

- cap each staff member at 3 pending swap requests
- expire pending swaps after 24 hours via cron
- if the underlying shift changes after swap approval, auto-cancel the swap, notify both parties, and restore the original assignment

## Audit Logging

Audit logging should happen in Postgres via triggers on:

- `shifts`
- `shift_assignments`

Capture:

- `entity_type`
- `entity_id`
- `before_json`
- `after_json`
- `changed_by`
- `changed_at`

Use `row_to_json(OLD)` and `row_to_json(NEW)` for payload capture.

Admin export:

- build a server action or route handler that streams CSV from `audit_logs`

## 72-Hour Delivery Plan

### Hours 0-2: Repo and Infrastructure

- scaffold Next.js 14 with App Router
- install Tailwind and shadcn/ui
- enable TypeScript strict mode
- set up Supabase project and environment variables
- establish the folder structure before feature work

### Hours 2-8: Migrations, RLS, and Seed Data

- write all SQL migrations
- create enums, tables, indexes, views, functions, and triggers
- implement RLS policies by role and location scope
- write the seed script

Seed data should include:

- 4 locations, 2 in `America/New_York` and 2 in `America/Los_Angeles`
- around 20 staff users
- multiple skills and certification combinations
- recurring availability plus exception windows
- existing shifts with at least one conflict case
- a pending swap request
- an overtime edge case
- a fairness imbalance case

### Hours 8-14: Constraint Engine

- implement the full validation tree in pure TypeScript
- write unit tests for every rule
- cover overnight shifts, revoked certifications, and rest-gap violations

### Hours 14-24: Auth, Routing, and Scheduling UI

- wire Supabase Auth
- add middleware-based role routing
- build manager schedule view with FullCalendar
- support drag-to-assign
- show validation feedback inline before confirmation

### Hours 24-34: Overtime and Swap Workflow

- wire weekly hours and projected hours views
- add what-if preview before assignment confirmation
- implement swap request lifecycle and guards

### Hours 34-44: Realtime and Notifications

- create notification triggers first
- verify inserts at the database layer
- subscribe from the UI after the backend is proven

### Hours 44-52: Fairness and Audit Logs

- build fairness dashboard
- implement audit triggers
- add CSV export for admins

### Hours 52-60: Timezones and Evaluation Scenarios

- manually walk through the six expected evaluation scenarios
- validate overnight shifts
- validate DST behavior
- validate dual-location staff handling

### Hours 60-68: RLS and Concurrency Testing

- test manager isolation across locations
- test staff self-access boundaries
- simulate concurrent assignment attempts in multiple tabs

### Hours 68-72: Deploy and Final Documentation

- deploy to Vercel
- configure Supabase environment variables
- verify seeded credentials and role access
- finalize the README with credentials, assumptions, and limitations

## Ambiguity Decisions

These decisions should be documented explicitly in the final product README.

| Area | Decision |
|---|---|
| Historical data after de-certification | Soft-retain `user_locations` history using `revoked_at`; preserve past assignments and mark legacy relationships in the UI if needed |
| Desired hours vs availability | Desired hours are advisory for analytics and fairness; availability is a hard assignment constraint |
| Consecutive days calculation | Any calendar day with at least one assigned shift counts as a worked day, regardless of duration |
| Shift edited after swap approval | Auto-cancel the swap, notify both parties, restore original assignment, and require re-approval |
| Location spanning timezone boundaries | Use the location's primary registered timezone and document this as a known limitation |
| Availability timezone interpretation | Evaluate availability in the assigned shift location's timezone |

## Known Technical Traps

### Trap 1: Local-time persistence

Do not store business-critical times in local time. Store UTC and convert only for display or localized comparison logic.

### Trap 2: UI-only validation

If constraints are enforced only in the UI, API writes and race conditions will break integrity.

### Trap 3: App-written notifications

If notifications are written in API routes after the main write, failures can leave data committed with no notification. Use database triggers for atomicity.

## Final Build Checklist

- all timestamps stored in UTC
- location timezone stored and used consistently
- pure shared constraint engine implemented and tested
- server-side enforcement mirrors UI validation
- RLS enabled and verified for every core table
- advisory-lock assignment RPC tested
- realtime subscriptions working for assignments and notifications
- swap expiry automation working
- audit logs capture before and after states
- seed data demonstrates multi-timezone behavior and edge cases
- README includes role credentials, ambiguity decisions, and known limitations

## Suggested README Additions After Implementation

When the product is complete, extend this file with:

- local development setup steps
- environment variable list
- Supabase project setup notes
- seeded login credentials for admin, manager, and staff
- screenshots or short workflow walkthroughs
- test commands
- deployment URL

## Bottom Line

The decision that will most affect success is whether the business rules are centralized in a pure, reusable constraint engine and enforced again at write time on the server. If that is done well, the rest of the system becomes easier to test, explain, and trust.

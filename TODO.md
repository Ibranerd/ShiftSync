# ShiftSync TODO

## Bootstrap
1. Verify `npm run dev` boots and Tailwind + shadcn/ui styles load.
2. Add `.env.local` with Supabase keys and confirm server/client helpers connect.
3. Confirm `FullCalendar` renders in manager schedule view.

## Database + Supabase
1. Create SQL migrations for enums, tables, indexes, views, functions, triggers.
2. Implement RLS policies for admin/manager/staff role scopes.
3. Add seed script with multi-timezone data and edge cases.

## Constraint Engine
1. Implement pure rule functions for each validation rule.
2. Add orchestrator with short-circuit for block violations.
3. Write unit tests for each rule and edge cases.

## Features
1. Auth + role-based routing and middleware protection.
2. Manager schedule UI with drag-to-assign + validation feedback.
3. Swap workflow API and UI with guarded state transitions.
4. Realtime subscriptions for assignments and notifications.
5. Overtime + fairness dashboards and audit log export.

## Quality
1. Verify UTC storage and timezone conversions in UI.
2. Add concurrency-safe assignment RPC and tests.
3. Document ambiguity decisions and known limitations in README.

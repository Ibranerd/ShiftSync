# ShiftSync

ShiftSync is a multi-location staff scheduling platform for teams operating across time zones. It provides role-based access for admins, managers, and staff, enforces assignment constraints, supports swaps/drops, and delivers realtime schedule updates with an audit trail.

## Features

- Role-based access: admin, manager, staff
- Multi-timezone scheduling (UTC storage, location-based display)
- Constraint validation: overlap, rest gap, skills, certifications, availability, overtime, consecutive days
- Swap and drop workflows with guarded transitions
- Realtime notifications and schedule updates
- Audit logs with CSV export
- Fairness and overtime visibility

## Tech Stack

- Next.js (App Router)
- TypeScript (strict)
- Tailwind CSS + shadcn/ui
- Supabase (Auth, Postgres, Realtime)
- FullCalendar
- date-fns, date-fns-tz

## Project Structure

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
  /api
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
```

## Environment Variables

Add these to `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_SUPABASE_SERVICE_ROLE_KEY=
```

`NEXT_SUPABASE_SERVICE_ROLE_KEY` is required for seeding.

## Supabase Setup

1. Create a Supabase project.
2. Link the CLI:
   ```
   /opt/homebrew/bin/supabase link --project-ref <your_project_ref>
   ```
3. Apply migrations:
   ```
   /opt/homebrew/bin/supabase db push
   ```
4. Seed data:
   ```
   ./scripts/run-seed.sh
   ```

## Seeded Accounts

All seeded users share the password:

```
Password123!
```

Admin:
- admin@shiftsync.dev

Managers:
- manager1@shiftsync.dev
- manager2@shiftsync.dev

Staff:
- staff1@shiftsync.dev through staff20@shiftsync.dev

## Scripts

- `./scripts/run-seed.sh` – run the seed script with env loading
- `./scripts/expire-requests.ts` – expire swaps/drops (run as cron)
- `./scripts/concurrency-test.ts` – concurrency RPC test

## Tests

```
npm test
```

## Deployment

Deployment URL:

```
https://shift-sync-seven.vercel.app/login
```

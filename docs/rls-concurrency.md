# RLS and Concurrency Testing

## Manager Isolation Across Locations
1. Use the RLS test SQL in `db/rls-tests.sql`.
2. Confirm managers only see locations and shifts they manage.

## Staff Self-Access Boundaries
1. Use the RLS test SQL in `db/rls-tests.sql`.
2. Confirm staff can only read their own profile, assignments, and availability.

## Concurrent Assignment Attempts
1. Set env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TEST_SHIFT_ID`, `TEST_USER_ID`, `TEST_MANAGER_ID`.
2. Run `node scripts/concurrency-test.ts`.
3. Expect only one success and others to return a conflict or overlap error.

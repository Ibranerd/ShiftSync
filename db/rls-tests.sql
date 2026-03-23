-- RLS validation checklist
-- Run these after seeding with multiple managers and staff.

-- 1) Manager isolation across locations
-- Replace <manager_id> and <location_id> with values from seed.
-- set role to authenticated;
-- select set_config('request.jwt.claims', '{"sub":"<manager_id>","role":"manager"}', true);
-- select * from public.locations; -- should only return managed locations
-- select * from public.shifts; -- should only return shifts for managed locations
-- select * from public.location_managers; -- should only show own manager mappings

-- 2) Staff self-access boundaries
-- select set_config('request.jwt.claims', '{"sub":"<staff_id>","role":"staff"}', true);
-- select * from public.users; -- should only return own profile
-- select * from public.shift_assignments; -- should only return own assignments
-- select * from public.availability_windows; -- should only return own availability

-- 3) Swap requests isolation
-- select * from public.swap_requests; -- should return own requests + requests where user is target

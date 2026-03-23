-- Verify notification inserts at the database layer.
-- Run this after applying migrations and with a valid user_id.

-- 1) Insert a notification manually.
-- insert into public.notifications (user_id, title, body)
-- values ('<user_id>', 'Schedule updated', 'Test notification from SQL.');

-- 2) Confirm it exists.
-- select * from public.notifications where user_id = '<user_id>' order by created_at desc;

-- 3) Confirm trigger insert (requires a shift assignment change).
-- insert into public.shift_assignments (shift_id, user_id, assigned_by)
-- values ('<shift_id>', '<user_id>', '<manager_id>');
-- select * from public.notifications where user_id = '<user_id>' order by created_at desc;

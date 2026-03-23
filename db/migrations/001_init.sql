-- ShiftSync schema bootstrap
-- Note: run in Supabase SQL editor or via migration runner.

-- Enums
create type public.assignment_status as enum ('assigned', 'confirmed', 'dropped');
create type public.swap_status as enum ('pending_staff', 'pending_manager', 'approved', 'rejected', 'cancelled', 'expired');
create type public.drop_status as enum ('pending', 'claimed', 'approved', 'rejected', 'cancelled', 'expired');

-- Core tables
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin', 'manager', 'staff')),
  desired_weekly_hours int not null default 0,
  created_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null,
  created_at timestamptz not null default now()
);

create table public.location_managers (
  user_id uuid not null references public.users(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (user_id, location_id)
);

create table public.user_locations (
  user_id uuid not null references public.users(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  certified_at timestamptz not null,
  revoked_at timestamptz,
  primary key (user_id, location_id, certified_at)
);

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table public.user_skills (
  user_id uuid not null references public.users(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, skill_id)
);

create table public.availability_windows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  day_of_week int,
  start_local_time time not null,
  end_local_time time not null,
  exception_date date,
  is_unavailable boolean not null default false,
  created_at timestamptz not null default now(),
  constraint availability_recurrence_check check (
    (exception_date is null and day_of_week is not null)
    or (exception_date is not null)
  )
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  start_utc timestamptz not null,
  end_utc timestamptz not null,
  required_skill_ids uuid[] not null default '{}',
  is_premium boolean not null default false,
  headcount_needed int not null default 1,
  is_published boolean not null default false,
  publish_cutoff_hours int not null default 48,
  override_reason text,
  created_at timestamptz not null default now(),
  constraint shift_time_check check (end_utc > start_utc)
);

create table public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  assigned_by uuid references public.users(id),
  status public.assignment_status not null default 'assigned',
  override_reason text,
  created_at timestamptz not null default now()
);

create table public.swap_requests (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  requested_by uuid not null references public.users(id) on delete cascade,
  target_user_id uuid references public.users(id),
  status public.swap_status not null default 'pending_staff',
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.drop_requests (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  requested_by uuid not null references public.users(id) on delete cascade,
  claimed_by uuid references public.users(id),
  status public.drop_status not null default 'pending',
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  body text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.notification_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  in_app boolean not null default true,
  email_simulation boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  before_json jsonb,
  after_json jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create table public.overtime_warnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  week_start_utc timestamptz not null,
  total_hours numeric not null,
  created_at timestamptz not null default now()
);

-- Suggested indexes
create index on public.shift_assignments (user_id, shift_id);
create index on public.shifts (location_id, start_utc, end_utc);
create index on public.availability_windows (user_id, day_of_week);
create index on public.audit_logs (entity_type, entity_id, changed_at desc);

-- Weekly hours view
create or replace view public.weekly_hours as
select
  sa.user_id,
  date_trunc('week', s.start_utc) as week_start,
  sum(extract(epoch from (s.end_utc - s.start_utc)) / 3600) as total_hours
from public.shift_assignments sa
join public.shifts s on s.id = sa.shift_id
where sa.status != 'dropped'
group by sa.user_id, week_start;

-- Concurrency-safe assignment RPC
create or replace function public.assign_staff_to_shift(
  p_shift_id uuid,
  p_user_id uuid,
  p_assigned_by uuid
) returns json as $$
declare
  v_lock_key bigint;
  v_conflict record;
begin
  v_lock_key := ('x' || substr(p_user_id::text, 1, 8))::bit(32)::int;

  if not pg_try_advisory_xact_lock(v_lock_key) then
    return json_build_object(
      'error', 'conflict',
      'message', 'Another manager is assigning this staff member. Please try again.'
    );
  end if;

  select sa.*
    into v_conflict
  from public.shift_assignments sa
  join public.shifts s on s.id = sa.shift_id
  where sa.user_id = p_user_id
    and sa.status != 'dropped'
    and s.start_utc < (select end_utc from public.shifts where id = p_shift_id)
    and s.end_utc > (select start_utc from public.shifts where id = p_shift_id);

  if found then
    return json_build_object(
      'error', 'overlap',
      'message', 'Staff member already assigned to an overlapping shift.'
    );
  end if;

  insert into public.shift_assignments (shift_id, user_id, assigned_by)
  values (p_shift_id, p_user_id, p_assigned_by);

  return json_build_object('success', true);
end;
$$ language plpgsql security definer;

-- Audit log trigger function
create or replace function public.audit_log_trigger()
returns trigger as $$
begin
  insert into public.audit_logs (entity_type, entity_id, before_json, after_json, changed_by)
  values (
    tg_table_name,
    coalesce(new.id, old.id),
    to_jsonb(old),
    to_jsonb(new),
    auth.uid()
  );
  return coalesce(new, old);
end;
$$ language plpgsql;

-- Notifications trigger function
create or replace function public.notify_assignment_change()
returns trigger as $$
declare
  v_user_id uuid;
  v_title text;
  v_body text;
begin
  v_user_id := coalesce(new.user_id, old.user_id);
  v_title := 'Schedule updated';
  v_body := 'Your assignment has been updated.';

  insert into public.notifications (user_id, title, body)
  values (v_user_id, v_title, v_body);

  return coalesce(new, old);
end;
$$ language plpgsql;

create or replace function public.enforce_drop_request_limit()
returns trigger as $$
declare
  v_pending_count int;
begin
  select count(*)
    into v_pending_count
  from public.drop_requests
  where requested_by = new.requested_by
    and status in ('pending', 'claimed');

  if v_pending_count >= 3 then
    raise exception 'Pending drop request limit reached.';
  end if;

  return new;
end;
$$ language plpgsql;

create or replace function public.enforce_swap_request_limit()
returns trigger as $$
declare
  v_pending_count int;
begin
  select count(*)
    into v_pending_count
  from public.swap_requests
  where requested_by = new.requested_by
    and status in ('pending_staff', 'pending_manager');

  if v_pending_count >= 3 then
    raise exception 'Pending swap request limit reached.';
  end if;

  return new;
end;
$$ language plpgsql;

create or replace function public.expire_drop_requests()
returns void as $$
begin
  update public.drop_requests dr
  set status = 'expired',
      updated_at = now()
  from public.shifts s
  where dr.shift_id = s.id
    and dr.status in ('pending', 'claimed')
    and s.start_utc <= now() + interval '24 hours';
end;
$$ language plpgsql;

create or replace function public.expire_swap_requests()
returns void as $$
begin
  update public.swap_requests
  set status = 'expired',
      updated_at = now()
  where status in ('pending_staff', 'pending_manager')
    and created_at <= now() - interval '24 hours';
end;
$$ language plpgsql;

create or replace function public.cancel_swaps_on_shift_update()
returns trigger as $$
begin
  update public.swap_requests
  set status = 'cancelled',
      updated_at = now()
  where shift_id = new.id
    and status in ('pending_staff', 'pending_manager');

  return new;
end;
$$ language plpgsql;

create or replace function public.notify_swap_change()
returns trigger as $$
begin
  insert into public.notifications (user_id, title, body)
  values (new.requested_by, 'Swap request updated', 'Your swap request status changed.');

  if new.target_user_id is not null then
    insert into public.notifications (user_id, title, body)
    values (new.target_user_id, 'Swap request updated', 'A swap request involving you has changed.');
  end if;

  insert into public.notifications (user_id, title, body)
  select lm.user_id, 'Swap request updated', 'A swap request requires review.'
  from public.location_managers lm
  join public.shifts s on s.id = new.shift_id
  where lm.location_id = s.location_id;

  return new;
end;
$$ language plpgsql;

create or replace function public.notify_drop_change()
returns trigger as $$
begin
  insert into public.notifications (user_id, title, body)
  values (new.requested_by, 'Drop request updated', 'Your drop request status changed.');

  if new.claimed_by is not null then
    insert into public.notifications (user_id, title, body)
    values (new.claimed_by, 'Drop request updated', 'A drop request you claimed has changed.');
  end if;

  insert into public.notifications (user_id, title, body)
  select lm.user_id, 'Drop request updated', 'A drop request requires review.'
  from public.location_managers lm
  join public.shifts s on s.id = new.shift_id
  where lm.location_id = s.location_id;

  return new;
end;
$$ language plpgsql;

create or replace function public.notify_overtime_warning()
returns trigger as $$
begin
  insert into public.notifications (user_id, title, body)
  values (new.user_id, 'Overtime warning', 'You are approaching overtime hours.');

  insert into public.notifications (user_id, title, body)
  select lm.user_id, 'Overtime warning', 'A staff member is approaching overtime.'
  from public.location_managers lm
  join public.user_locations ul on ul.user_id = new.user_id
  where lm.location_id = ul.location_id
    and ul.revoked_at is null;

  return new;
end;
$$ language plpgsql;

create or replace function public.notify_availability_change()
returns trigger as $$
begin
  insert into public.notifications (user_id, title, body)
  select lm.user_id, 'Availability updated', 'A staff member updated availability.'
  from public.location_managers lm
  join public.user_locations ul on ul.user_id = new.user_id
  where lm.location_id = ul.location_id
    and ul.revoked_at is null;

  return new;
end;
$$ language plpgsql;

create or replace function public.notify_shift_publish()
returns trigger as $$
begin
  if new.is_published is distinct from old.is_published then
    insert into public.notifications (user_id, title, body)
    select sa.user_id, 'Schedule published', 'A schedule change was published.'
    from public.shift_assignments sa
    where sa.shift_id = new.id
      and sa.status != 'dropped';
  end if;

  return new;
end;
$$ language plpgsql;

-- Triggers
drop trigger if exists shifts_audit on public.shifts;
create trigger shifts_audit
after insert or update or delete on public.shifts
for each row execute function public.audit_log_trigger();

drop trigger if exists shift_assignments_audit on public.shift_assignments;
create trigger shift_assignments_audit
after insert or update or delete on public.shift_assignments
for each row execute function public.audit_log_trigger();

drop trigger if exists shift_assignments_notify on public.shift_assignments;
create trigger shift_assignments_notify
after insert or update on public.shift_assignments
for each row execute function public.notify_assignment_change();

drop trigger if exists drop_request_limit on public.drop_requests;
create trigger drop_request_limit
before insert on public.drop_requests
for each row execute function public.enforce_drop_request_limit();

drop trigger if exists swap_request_limit on public.swap_requests;
create trigger swap_request_limit
before insert on public.swap_requests
for each row execute function public.enforce_swap_request_limit();

drop trigger if exists swaps_cancel_on_shift_update on public.shifts;
create trigger swaps_cancel_on_shift_update
after update on public.shifts
for each row execute function public.cancel_swaps_on_shift_update();

drop trigger if exists swap_notifications on public.swap_requests;
create trigger swap_notifications
after insert or update on public.swap_requests
for each row execute function public.notify_swap_change();

drop trigger if exists drop_notifications on public.drop_requests;
create trigger drop_notifications
after insert or update on public.drop_requests
for each row execute function public.notify_drop_change();

drop trigger if exists shift_publish_notifications on public.shifts;
create trigger shift_publish_notifications
after update on public.shifts
for each row execute function public.notify_shift_publish();

drop trigger if exists overtime_notifications on public.overtime_warnings;
create trigger overtime_notifications
after insert on public.overtime_warnings
for each row execute function public.notify_overtime_warning();

drop trigger if exists availability_notifications on public.availability_windows;
create trigger availability_notifications
after insert or update on public.availability_windows
for each row execute function public.notify_availability_change();

-- RLS enablement
alter table public.users enable row level security;
alter table public.locations enable row level security;
alter table public.location_managers enable row level security;
alter table public.user_locations enable row level security;
alter table public.skills enable row level security;
alter table public.user_skills enable row level security;
alter table public.availability_windows enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.swap_requests enable row level security;
alter table public.drop_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.audit_logs enable row level security;
alter table public.overtime_warnings enable row level security;

-- RLS helper
create or replace function public.has_role(role_name text)
returns boolean as $$
  select coalesce(
    (auth.jwt() ->> 'role') = role_name,
    (auth.jwt() -> 'app_metadata' ->> 'role') = role_name,
    (auth.jwt() -> 'user_metadata' ->> 'role') = role_name,
    false
  );
$$ language sql stable;

create or replace function public.is_manager_for_location(p_location_id uuid)
returns boolean as $$
  select public.has_role('admin')
    or (
      public.has_role('manager')
      and exists (
        select 1
        from public.location_managers lm
        where lm.user_id = auth.uid()
          and lm.location_id = p_location_id
      )
    );
$$ language sql stable;

-- RLS policies (role + location scope)
drop policy if exists "users_self_or_admin" on public.users;
drop policy if exists "users_admin_write" on public.users;
drop policy if exists "users_manager_read" on public.users;
create policy "users_self_or_admin"
on public.users
for select
using (id = auth.uid() or public.has_role('admin'));

create policy "users_manager_read"
on public.users
for select
using (
  public.has_role('manager')
  and exists (
    select 1
    from public.user_locations ul
    join public.location_managers lm on lm.location_id = ul.location_id
    where ul.user_id = public.users.id
      and lm.user_id = auth.uid()
      and ul.revoked_at is null
  )
);

create policy "users_admin_write"
on public.users
for all
using (public.has_role('admin'))
with check (public.has_role('admin'));

drop policy if exists "locations_read" on public.locations;
drop policy if exists "locations_admin_write" on public.locations;
create policy "locations_read"
on public.locations
for select
using (public.has_role('admin') or public.is_manager_for_location(id));

create policy "locations_admin_write"
on public.locations
for all
using (public.has_role('admin'))
with check (public.has_role('admin'));

drop policy if exists "user_locations_read" on public.user_locations;
drop policy if exists "user_locations_admin_write" on public.user_locations;
drop policy if exists "location_managers_read" on public.location_managers;
drop policy if exists "location_managers_admin_write" on public.location_managers;
create policy "user_locations_read"
on public.user_locations
for select
using (public.has_role('admin') or public.is_manager_for_location(location_id) or user_id = auth.uid());

create policy "user_locations_admin_write"
on public.user_locations
for all
using (public.has_role('admin'))
with check (public.has_role('admin'));

create policy "location_managers_read"
on public.location_managers
for select
using (public.has_role('admin') or user_id = auth.uid());

create policy "location_managers_admin_write"
on public.location_managers
for all
using (public.has_role('admin'))
with check (public.has_role('admin'));

drop policy if exists "skills_read" on public.skills;
drop policy if exists "skills_admin_write" on public.skills;
create policy "skills_read"
on public.skills
for select
using (public.has_role('admin') or public.has_role('manager'));

create policy "skills_admin_write"
on public.skills
for all
using (public.has_role('admin'))
with check (public.has_role('admin'));

drop policy if exists "user_skills_read" on public.user_skills;
drop policy if exists "user_skills_admin_write" on public.user_skills;
create policy "user_skills_read"
on public.user_skills
for select
using (
  public.has_role('admin')
  or public.is_manager_for_location(
    (select ul.location_id from public.user_locations ul where ul.user_id = user_id limit 1)
  )
  or user_id = auth.uid()
);

create policy "user_skills_admin_write"
on public.user_skills
for all
using (public.has_role('admin'))
with check (public.has_role('admin'));

drop policy if exists "availability_read" on public.availability_windows;
drop policy if exists "availability_self_write" on public.availability_windows;
create policy "availability_read"
on public.availability_windows
for select
using (public.has_role('admin') or public.has_role('manager') or user_id = auth.uid());

create policy "availability_self_write"
on public.availability_windows
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "shifts_read" on public.shifts;
drop policy if exists "shifts_admin_manager_write" on public.shifts;
create policy "shifts_read"
on public.shifts
for select
using (public.has_role('admin') or public.is_manager_for_location(location_id) or public.has_role('staff'));

create policy "shifts_admin_manager_write"
on public.shifts
for all
using (public.has_role('admin') or public.is_manager_for_location(location_id))
with check (public.has_role('admin') or public.is_manager_for_location(location_id));

drop policy if exists "assignments_read" on public.shift_assignments;
drop policy if exists "assignments_admin_manager_write" on public.shift_assignments;
create policy "assignments_read"
on public.shift_assignments
for select
using (
  public.has_role('admin')
  or user_id = auth.uid()
  or exists (
    select 1
    from public.shifts s
    where s.id = shift_id
      and public.is_manager_for_location(s.location_id)
  )
);

create policy "assignments_admin_manager_write"
on public.shift_assignments
for all
using (
  public.has_role('admin')
  or exists (
    select 1
    from public.shifts s
    where s.id = shift_id
      and public.is_manager_for_location(s.location_id)
  )
)
with check (
  public.has_role('admin')
  or exists (
    select 1
    from public.shifts s
    where s.id = shift_id
      and public.is_manager_for_location(s.location_id)
  )
);

drop policy if exists "swaps_read" on public.swap_requests;
drop policy if exists "swaps_staff_create" on public.swap_requests;
drop policy if exists "swaps_admin_manager_write" on public.swap_requests;
create policy "swaps_read"
on public.swap_requests
for select
using (
  public.has_role('admin')
  or requested_by = auth.uid()
  or target_user_id = auth.uid()
  or exists (
    select 1
    from public.shifts s
    where s.id = shift_id
      and public.is_manager_for_location(s.location_id)
  )
);

create policy "swaps_staff_create"
on public.swap_requests
for insert
with check (requested_by = auth.uid());

create policy "swaps_admin_manager_write"
on public.swap_requests
for update
using (
  public.has_role('admin')
  or requested_by = auth.uid()
  or exists (
    select 1
    from public.shifts s
    where s.id = shift_id
      and public.is_manager_for_location(s.location_id)
  )
)
with check (
  public.has_role('admin')
  or requested_by = auth.uid()
  or exists (
    select 1
    from public.shifts s
    where s.id = shift_id
      and public.is_manager_for_location(s.location_id)
  )
);

drop policy if exists "drops_read" on public.drop_requests;
drop policy if exists "drops_staff_create" on public.drop_requests;
drop policy if exists "drops_admin_manager_write" on public.drop_requests;
create policy "drops_read"
on public.drop_requests
for select
using (
  public.has_role('admin')
  or requested_by = auth.uid()
  or claimed_by = auth.uid()
  or exists (
    select 1
    from public.shifts s
    where s.id = shift_id
      and public.is_manager_for_location(s.location_id)
  )
);

create policy "drops_staff_create"
on public.drop_requests
for insert
with check (requested_by = auth.uid());

create policy "drops_admin_manager_write"
on public.drop_requests
for update
using (
  public.has_role('admin')
  or requested_by = auth.uid()
  or exists (
    select 1
    from public.shifts s
    where s.id = shift_id
      and public.is_manager_for_location(s.location_id)
  )
)
with check (
  public.has_role('admin')
  or requested_by = auth.uid()
  or exists (
    select 1
    from public.shifts s
    where s.id = shift_id
      and public.is_manager_for_location(s.location_id)
  )
);

drop policy if exists "notifications_read" on public.notifications;
drop policy if exists "notifications_admin_write" on public.notifications;
create policy "notifications_read"
on public.notifications
for select
using (public.has_role('admin') or user_id = auth.uid());

create policy "notifications_admin_write"
on public.notifications
for all
using (public.has_role('admin'))
with check (public.has_role('admin'));

drop policy if exists "notification_preferences_read" on public.notification_preferences;
drop policy if exists "notification_preferences_write" on public.notification_preferences;
create policy "notification_preferences_read"
on public.notification_preferences
for select
using (public.has_role('admin') or user_id = auth.uid());

create policy "notification_preferences_write"
on public.notification_preferences
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "audit_logs_admin_read" on public.audit_logs;
create policy "audit_logs_admin_read"
on public.audit_logs
for select
using (public.has_role('admin'));

drop policy if exists "overtime_admin_read" on public.overtime_warnings;
drop policy if exists "overtime_admin_write" on public.overtime_warnings;
create policy "overtime_admin_read"
on public.overtime_warnings
for select
using (public.has_role('admin') or public.has_role('manager'));

create policy "overtime_admin_write"
on public.overtime_warnings
for all
using (public.has_role('admin'))
with check (public.has_role('admin'));

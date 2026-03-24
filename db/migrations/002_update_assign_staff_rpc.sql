create or replace function public.assign_staff_to_shift(
  p_shift_id uuid,
  p_user_id uuid,
  p_assigned_by uuid,
  p_override_reason text default null
) returns json as $$
declare
  v_lock_key bigint;
  v_conflict record;
  v_assignment_id uuid;
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

  insert into public.shift_assignments (shift_id, user_id, assigned_by, override_reason)
  values (p_shift_id, p_user_id, p_assigned_by, p_override_reason)
  returning id into v_assignment_id;

  return json_build_object('success', true, 'assignment_id', v_assignment_id);
end;
$$ language plpgsql security definer;

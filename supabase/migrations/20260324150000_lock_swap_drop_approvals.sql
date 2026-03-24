create or replace function public.lock_swap_approval(p_swap_id uuid)
returns boolean as $$
declare
  v_lock_key bigint;
begin
  v_lock_key := ('x' || substr(p_swap_id::text, 1, 8))::bit(32)::int;
  return pg_try_advisory_xact_lock(v_lock_key);
end;
$$ language plpgsql security definer;

create or replace function public.lock_drop_approval(p_drop_id uuid)
returns boolean as $$
declare
  v_lock_key bigint;
begin
  v_lock_key := ('x' || substr(p_drop_id::text, 1, 8))::bit(32)::int;
  return pg_try_advisory_xact_lock(v_lock_key);
end;
$$ language plpgsql security definer;

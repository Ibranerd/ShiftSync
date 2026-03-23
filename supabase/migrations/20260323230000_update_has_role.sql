create or replace function public.has_role(role_name text)
returns boolean as $$
  select coalesce(
    (auth.jwt() ->> 'role') = role_name,
    (auth.jwt() -> 'app_metadata' ->> 'role') = role_name,
    (auth.jwt() -> 'user_metadata' ->> 'role') = role_name,
    false
  );
$$ language sql stable;

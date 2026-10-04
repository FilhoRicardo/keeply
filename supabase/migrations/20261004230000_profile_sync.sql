-- Keep the public profile in step when an anonymous visitor links Google (email and name arrive
-- on auth.users after the fact).
create function public.sync_user_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.users
  set email = new.email,
      name = coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', name)
  where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_updated
  after update of email, raw_user_meta_data on auth.users
  for each row execute function public.sync_user_profile();

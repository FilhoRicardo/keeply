-- Run with `supabase test db`. Label photos are private to their owner's folder.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(5);

select is((select public from storage.buckets where id = 'appliance-photos'), false, 'the photo bucket is private');

insert into storage.objects (bucket_id, name)
values ('appliance-photos', '00000000-0000-0000-0000-00000000000a/one.jpg');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';

select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('appliance-photos', '00000000-0000-0000-0000-00000000000a/two.jpg') $$,
  'an owner can upload into their own folder'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('appliance-photos', '00000000-0000-0000-0000-00000000000b/x.jpg') $$,
  '42501', null, 'an owner cannot upload into someone else''s folder'
);

select is((select count(*) from storage.objects)::int, 2, 'an owner sees their own photos');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';
select is((select count(*) from storage.objects)::int, 0, 'another user sees none of them');

select * from finish();
rollback;

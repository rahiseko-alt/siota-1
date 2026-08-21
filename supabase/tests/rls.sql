begin;

select extensions.no_plan();

set local role authenticated;

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-0000000000a1', true);
select extensions.is((select count(*)::integer from public.owners), 1, 'owner A sees only owner A');
select extensions.is((select count(*)::integer from public.pets), 3, 'owner A sees X Y Z');
select extensions.is((select count(*)::integer from public.reports), 1, 'owner A sees only final reports');
select extensions.is((select count(*)::integer from public.reports where status = 'draft'), 0, 'owner A cannot see drafts');
select extensions.is((select count(*)::integer from public.report_assets), 1, 'owner A sees X final assets');

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-0000000000b1', true);
select extensions.is((select count(*)::integer from public.pets where id = '40000000-0000-0000-0000-0000000000a1'), 0, 'owner B cannot see X');
select extensions.is((select count(*)::integer from public.pets where id = '40000000-0000-0000-0000-0000000000b1'), 1, 'owner B sees Q');
select extensions.is((select count(*)::integer from public.reports where id = '50000000-0000-0000-0000-0000000000a1'), 0, 'owner B cannot see X report by exact id');
select extensions.is((select count(*)::integer from public.report_assets where id = '60000000-0000-0000-0000-0000000000a1'), 0, 'owner B cannot see X asset metadata');

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-0000000000f1', true);
select extensions.is((select count(*)::integer from public.owners), 0, 'uninvited user sees no owners');
select extensions.is((select count(*)::integer from public.pets), 0, 'uninvited user sees no pets');
select extensions.is((select count(*)::integer from public.reports), 0, 'uninvited user sees no reports');

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select extensions.is((select count(*)::integer from public.owners), 2, 'staff sees shop owners');
select extensions.is((select count(*)::integer from public.pets), 4, 'staff sees shop pets');
select extensions.is((select count(*)::integer from public.reports), 3, 'staff sees draft and final reports');

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select extensions.is((select count(*)::integer from public.shop_memberships), 2, 'admin sees shop memberships');

select * from extensions.finish();
rollback;

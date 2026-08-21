begin;

drop policy if exists reports_staff_all on public.reports;
create policy reports_staff_select on public.reports
  for select to authenticated using (private.is_shop_staff(shop_id));
create policy reports_staff_insert on public.reports
  for insert to authenticated with check (
    private.is_shop_staff(shop_id)
    and created_by = (select auth.uid())
    and status = 'draft'
  );
create policy reports_staff_update_draft on public.reports
  for update to authenticated
  using (private.is_shop_staff(shop_id) and status = 'draft')
  with check (private.is_shop_staff(shop_id) and status = 'draft');

revoke insert, update, delete on public.reports from authenticated;
grant insert (shop_id, pet_id, report_date, data, created_by) on public.reports to authenticated;
grant update (data) on public.reports to authenticated;

create or replace function public.archive_report(target_report uuid)
returns public.reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  archived public.reports%rowtype;
begin
  update public.reports report
  set status = 'archived', updated_at = now()
  where report.id = target_report
    and report.status = 'final'
    and private.is_shop_staff(report.shop_id)
  returning report.* into archived;

  if not found then
    raise exception using errcode = 'P0002', message = 'report unavailable';
  end if;

  insert into public.audit_logs (shop_id, actor_user_id, action, entity_type, entity_id)
  values (archived.shop_id, actor, 'report.archived', 'report', archived.id);
  return archived;
end;
$$;

revoke all on function public.archive_report(uuid) from public, anon;
grant execute on function public.archive_report(uuid) to authenticated;

commit;

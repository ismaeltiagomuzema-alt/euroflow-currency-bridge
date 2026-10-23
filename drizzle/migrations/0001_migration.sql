create or replace function public.tb_transfer(p_user uuid, p_pin text, p_eur numeric, p_label text, p_key text, p_ip text, p_per_tx numeric, p_per_day numeric, p_unusual numeric) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare pr public.profiles; b numeric; today numeric; n int;
begin
  if exists (select 1 from public.transactions where user_id = p_user and idempotency_key = p_key) then return 'duplicate'; end if;
  select * into pr from public.profiles where id = p_user for update;
  if pr.pin_hash is null then return 'no_pin'; end if;
  if pr.pin_locked_until is not null and pr.pin_locked_until > now() then return 'pin_locked'; end if;
  if crypt(p_pin, pr.pin_hash) <> pr.pin_hash then
    n := pr.pin_attempts + 1;
    update public.profiles set pin_attempts = case when n >= 3 then 0 else n end,
      pin_locked_until = case when n >= 3 then now() + interval '15 minutes' else null end
      where id = p_user;
    perform public.tb_log(p_user, 'PIN incorreto', 'Transferência', p_ip);
    return case when n >= 3 then 'pin_locked' else 'bad_pin' end;
  end if;
  update public.profiles set pin_attempts = 0 where id = p_user;
  if not (p_eur > 0) then return 'invalid'; end if;
  if p_eur > p_per_tx then return 'limit_tx'; end if;
  select coalesce(sum(amount_eur), 0) into today from public.transactions
    where user_id = p_user and type = 'out' and created_at >= date_trunc('day', now());
  if today + p_eur > p_per_day then return 'limit_day'; end if;
  select balance into b from public.wallets where user_id = p_user and currency = 'EUR' for update;
  if coalesce(b, 0) < p_eur then return 'funds'; end if;
  update public.wallets set balance = balance - p_eur where user_id = p_user and currency = 'EUR';
  insert into public.transactions (user_id, type, amount_eur, label, idempotency_key) values (p_user, 'out', p_eur, left(p_label, 140), p_key);
  perform public.tb_log(p_user, 'Transferência enviada', left(p_label, 140), p_ip);
  if p_eur >= p_unusual then perform public.tb_log(p_user, '⚠ Alerta', 'Valor elevado: ' || p_eur || ' EUR', p_ip); end if;
  return 'ok';
end $$;
revoke all on function public.tb_transfer from public, anon, authenticated;
grant execute on function public.tb_transfer to service_role;
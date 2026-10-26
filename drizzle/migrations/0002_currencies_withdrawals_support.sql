create table public.exchanges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  from_cur text not null,
  to_cur text not null,
  amount_from numeric(14,2) not null,
  amount_to numeric(14,2) not null,
  rate numeric(14,6) not null,
  fee numeric(14,2) not null default 0,
  status text not null default 'concluído',
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
grant select on public.exchanges to authenticated;
grant all on public.exchanges to service_role;
alter table public.exchanges enable row level security;
create policy "own exchanges" on public.exchanges for select to authenticated using (auth.uid() = user_id);
create trigger fx_no_update before update or delete on public.exchanges for each row execute function public.tb_immutable();

create table public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  reference text not null default ('LV-' || upper(substr(md5(gen_random_uuid()::text), 1, 8))),
  currency text not null,
  amount numeric(14,2) not null,
  fee numeric(14,2) not null default 0,
  net numeric(14,2) not null,
  method text not null,
  holder text not null,
  iban_masked text not null,
  status text not null default 'pendente' check (status in ('pendente','em processamento','concluído','recusado')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
grant select on public.withdrawals to authenticated;
grant all on public.withdrawals to service_role;
alter table public.withdrawals enable row level security;
create policy "own withdrawals" on public.withdrawals for select to authenticated using (auth.uid() = user_id);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  reference text not null default ('AS-' || upper(substr(md5(gen_random_uuid()::text), 1, 8))),
  category text not null check (category in ('conta','câmbios','levantamentos','movimentos','outro')),
  subject text not null check (char_length(subject) between 3 and 120),
  description text not null check (char_length(description) between 10 and 2000),
  status text not null default 'aberto',
  created_at timestamptz not null default now()
);
grant select on public.support_tickets to authenticated;
grant insert (category, subject, description) on public.support_tickets to authenticated;
grant all on public.support_tickets to service_role;
alter table public.support_tickets enable row level security;
create policy "own tickets read" on public.support_tickets for select to authenticated using (auth.uid() = user_id);
create policy "own tickets insert" on public.support_tickets for insert to authenticated with check (auth.uid() = user_id);

create table public.security_prefs (
  user_id uuid primary key default auth.uid(),
  login_alerts boolean not null default true,
  tx_alerts boolean not null default true,
  updated_at timestamptz not null default now()
);
grant select on public.security_prefs to authenticated;
grant insert (login_alerts, tx_alerts), update (login_alerts, tx_alerts, updated_at) on public.security_prefs to authenticated;
grant all on public.security_prefs to service_role;
alter table public.security_prefs enable row level security;
create policy "own prefs read" on public.security_prefs for select to authenticated using (auth.uid() = user_id);
create policy "own prefs insert" on public.security_prefs for insert to authenticated with check (auth.uid() = user_id);
create policy "own prefs update" on public.security_prefs for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.tb_fx(p_user uuid, p_from text, p_to text, p_amount numeric, p_out numeric, p_rate numeric, p_fee numeric, p_eur numeric, p_key text, p_ip text) returns void
language plpgsql security definer set search_path = public as $$
declare b numeric;
begin
  if p_from = p_to or not (p_amount > 0) or not (p_out > 0) then raise exception 'Operação inválida.'; end if;
  if exists (select 1 from public.exchanges where user_id = p_user and idempotency_key = p_key) then return; end if;
  select balance into b from public.wallets where user_id = p_user and currency = p_from for update;
  if coalesce(b, 0) < p_amount then raise exception 'Saldo insuficiente nessa moeda.'; end if;
  update public.wallets set balance = balance - p_amount where user_id = p_user and currency = p_from;
  insert into public.wallets (user_id, currency, balance) values (p_user, p_to, p_out)
    on conflict (user_id, currency) do update set balance = wallets.balance + excluded.balance;
  insert into public.exchanges (user_id, from_cur, to_cur, amount_from, amount_to, rate, fee, idempotency_key)
    values (p_user, p_from, p_to, p_amount, p_out, p_rate, p_fee, p_key);
  insert into public.transactions (user_id, type, amount_eur, label, idempotency_key)
    values (p_user, 'fx', p_eur, 'Câmbio ' || p_amount || ' ' || p_from || ' → ' || p_out || ' ' || p_to, p_key);
  perform public.tb_log(p_user, 'Câmbio', p_amount || ' ' || p_from || ' → ' || p_out || ' ' || p_to, p_ip);
end $$;

create or replace function public.tb_withdraw(p_user uuid, p_pin text, p_cur text, p_amount numeric, p_fee numeric, p_eur numeric, p_method text, p_holder text, p_iban_masked text, p_key text, p_ip text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare pr public.profiles; b numeric; n int; ref text;
begin
  if exists (select 1 from public.withdrawals where user_id = p_user and idempotency_key = p_key) then return 'duplicate'; end if;
  select * into pr from public.profiles where id = p_user for update;
  if pr.pin_hash is null then return 'no_pin'; end if;
  if pr.pin_locked_until is not null and pr.pin_locked_until > now() then return 'pin_locked'; end if;
  if crypt(p_pin, pr.pin_hash) <> pr.pin_hash then
    n := pr.pin_attempts + 1;
    update public.profiles set pin_attempts = case when n >= 3 then 0 else n end,
      pin_locked_until = case when n >= 3 then now() + interval '15 minutes' else null end where id = p_user;
    perform public.tb_log(p_user, 'PIN incorreto', 'Levantamento', p_ip);
    return case when n >= 3 then 'pin_locked' else 'bad_pin' end;
  end if;
  update public.profiles set pin_attempts = 0 where id = p_user;
  if not (p_amount > 0) or p_fee < 0 or p_fee >= p_amount then return 'invalid'; end if;
  select balance into b from public.wallets where user_id = p_user and currency = p_cur for update;
  if coalesce(b, 0) < p_amount then return 'funds'; end if;
  update public.wallets set balance = balance - p_amount where user_id = p_user and currency = p_cur;
  insert into public.withdrawals (user_id, currency, amount, fee, net, method, holder, iban_masked, idempotency_key)
    values (p_user, p_cur, p_amount, p_fee, p_amount - p_fee, p_method, left(p_holder, 80), p_iban_masked, p_key)
    returning reference into ref;
  insert into public.transactions (user_id, type, amount_eur, label, idempotency_key)
    values (p_user, 'out', p_eur, 'Levantamento ' || ref || ' · ' || p_amount || ' ' || p_cur, p_key);
  perform public.tb_log(p_user, 'Pedido de levantamento', ref || ' · ' || p_amount || ' ' || p_cur || ' para ' || p_iban_masked, p_ip);
  return 'ok';
end $$;

create or replace function public.tb_sessions(p_user uuid)
returns table (id uuid, created_at timestamptz, updated_at timestamptz, user_agent text, ip text)
language sql stable security definer set search_path = public, auth as $$
  select s.id, s.created_at, coalesce(s.refreshed_at::timestamptz, s.updated_at), s.user_agent, host(s.ip)
  from auth.sessions s where s.user_id = p_user order by coalesce(s.refreshed_at::timestamptz, s.updated_at) desc nulls last
$$;

revoke all on function public.tb_fx, public.tb_withdraw, public.tb_sessions from public, anon, authenticated;
grant execute on function public.tb_fx, public.tb_withdraw, public.tb_sessions to service_role;
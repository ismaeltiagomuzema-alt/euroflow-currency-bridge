create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  pin_hash text,
  pin_attempts int not null default 0,
  pin_locked_until timestamptz,
  created_at timestamptz not null default now()
);
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles for select to authenticated using (auth.uid() = id);

create table public.wallets (
  user_id uuid not null,
  currency text not null,
  balance numeric(14,2) not null default 0 check (balance >= 0),
  primary key (user_id, currency)
);
grant select on public.wallets to authenticated;
grant all on public.wallets to service_role;
alter table public.wallets enable row level security;
create policy "own wallets" on public.wallets for select to authenticated using (auth.uid() = user_id);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null check (type in ('in','out','fx')),
  amount_eur numeric(14,2) not null,
  label text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
grant select on public.transactions to authenticated;
grant all on public.transactions to service_role;
alter table public.transactions enable row level security;
create policy "own tx" on public.transactions for select to authenticated using (auth.uid() = user_id);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  action text not null,
  detail text not null default '',
  ip text,
  created_at timestamptz not null default now()
);
grant select on public.audit_logs to authenticated;
grant select, insert on public.audit_logs to service_role;
alter table public.audit_logs enable row level security;
create policy "own logs" on public.audit_logs for select to authenticated using (auth.uid() = user_id);

create or replace function public.tb_immutable() returns trigger language plpgsql as $$
begin raise exception 'Registo imutável'; end $$;
create trigger audit_no_update before update or delete on public.audit_logs for each row execute function public.tb_immutable();
create trigger tx_no_update before update or delete on public.transactions for each row execute function public.tb_immutable();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name) values (new.id, left(coalesce(new.raw_user_meta_data->>'name', ''), 60));
  insert into public.wallets (user_id, currency, balance) values (new.id, 'EUR', 0);
  insert into public.audit_logs (user_id, action) values (new.id, 'Conta criada');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.tb_log(p_user uuid, p_action text, p_detail text, p_ip text) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_logs (user_id, action, detail, ip) values (p_user, p_action, coalesce(p_detail,''), p_ip);
$$;

create or replace function public.tb_set_pin(p_user uuid, p_pin text, p_ip text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_pin !~ '^\d{4,6}$' or p_pin ~ '^(\d)\1+$' or position(p_pin in '0123456789') > 0 then
    raise exception 'PIN inválido: 4 a 6 dígitos, não sequenciais nem repetidos.';
  end if;
  update public.profiles set pin_hash = crypt(p_pin, gen_salt('bf', 10)), pin_attempts = 0, pin_locked_until = null where id = p_user;
  perform public.tb_log(p_user, 'PIN definido', '', p_ip);
end $$;

create or replace function public.tb_deposit(p_user uuid, p_amount numeric, p_key text, p_ip text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (p_amount > 0 and p_amount <= 5000) then raise exception 'Valor entre 0,01 € e 5 000 €.'; end if;
  if exists (select 1 from public.transactions where user_id = p_user and idempotency_key = p_key) then return; end if;
  insert into public.wallets (user_id, currency, balance) values (p_user, 'EUR', p_amount)
    on conflict (user_id, currency) do update set balance = wallets.balance + excluded.balance;
  insert into public.transactions (user_id, type, amount_eur, label, idempotency_key) values (p_user, 'in', p_amount, 'Carregamento demo', p_key);
  perform public.tb_log(p_user, 'Carregamento', p_amount::text || ' EUR', p_ip);
end $$;

create or replace function public.tb_exchange(p_user uuid, p_from text, p_to text, p_amount numeric, p_out numeric, p_eur numeric, p_key text, p_ip text) returns void
language plpgsql security definer set search_path = public as $$
declare b numeric;
begin
  if p_from = p_to or not (p_amount > 0) or not (p_out > 0) then raise exception 'Operação inválida.'; end if;
  if exists (select 1 from public.transactions where user_id = p_user and idempotency_key = p_key) then return; end if;
  select balance into b from public.wallets where user_id = p_user and currency = p_from for update;
  if coalesce(b, 0) < p_amount then raise exception 'Saldo insuficiente nessa moeda.'; end if;
  update public.wallets set balance = balance - p_amount where user_id = p_user and currency = p_from;
  insert into public.wallets (user_id, currency, balance) values (p_user, p_to, p_out)
    on conflict (user_id, currency) do update set balance = wallets.balance + excluded.balance;
  insert into public.transactions (user_id, type, amount_eur, label, idempotency_key)
    values (p_user, 'fx', p_eur, 'Câmbio ' || p_amount || ' ' || p_from || ' → ' || p_out || ' ' || p_to, p_key);
  perform public.tb_log(p_user, 'Câmbio', p_amount || ' ' || p_from || ' → ' || p_out || ' ' || p_to, p_ip);
end $$;

create or replace function public.tb_transfer(p_user uuid, p_pin text, p_eur numeric, p_label text, p_key text, p_ip text, p_per_tx numeric, p_per_day numeric, p_unusual numeric) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare pr public.profiles; b numeric; today numeric;
begin
  if exists (select 1 from public.transactions where user_id = p_user and idempotency_key = p_key) then return 'duplicate'; end if;
  select * into pr from public.profiles where id = p_user for update;
  if pr.pin_hash is null then return 'no_pin'; end if;
  if pr.pin_locked_until is not null and pr.pin_locked_until > now() then return 'pin_locked'; end if;
  if crypt(p_pin, pr.pin_hash) <> pr.pin_hash then
    update public.profiles set pin_attempts = pin_attempts + 1,
      pin_locked_until = case when pin_attempts + 1 >= 3 then now() + interval '15 minutes' else null end,
      pin_attempts = case when pin_attempts + 1 >= 3 then 0 else pin_attempts + 1 end
      where id = p_user;
    perform public.tb_log(p_user, 'PIN incorreto', 'Transferência', p_ip);
    return 'bad_pin';
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

revoke all on function public.tb_log, public.tb_set_pin, public.tb_deposit, public.tb_exchange, public.tb_transfer, public.handle_new_user, public.tb_immutable from public, anon, authenticated;
grant execute on function public.tb_log, public.tb_set_pin, public.tb_deposit, public.tb_exchange, public.tb_transfer to service_role;
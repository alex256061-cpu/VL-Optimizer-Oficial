-- ══════════════════════════════════════════════════════════════════════════
-- VL Optimizer — esquema do banco (Supabase)
--
-- Modelo copiado do sistema de licença da referência (src/plano.js e app-main.js):
--   plan               -> 'free' ou 'pro'
--   features           -> páginas liberadas; ['*'] libera tudo
--   license_expires_at -> validade
--   lifetime           -> licença sem prazo
--   reason             -> 'expired' | 'other_device'
--   pcBound            -> true quando o PC mudou (formatou/trocou) e pode renovar
--
-- HWID (copiado da constante HWID_SCRIPT da referência):
--   ProcessorId + serial da placa-mãe + MachineGuid, concatenados e enviados como hash.
--   O servidor guarda o hash e o nome do PC, nunca o dado bruto.
--
-- A liberação é por PÁGINA, com o mapa PAGE_FEATURE do app:
--   dashboard -> painel   jogos -> jogos   fps -> fps   gargalo -> gargalo
--   hardware -> hardware  pcinfo -> hardware           inicializacao -> inicializacao
--   sobre -> sobre
-- Páginas fora do mapa são livres para todos.
--
-- Como usar: painel do Supabase → SQL Editor → New query → cole tudo → Run
-- ══════════════════════════════════════════════════════════════════════════

-- ── perfis ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text,
  name               text,
  plan               text not null default 'free' check (plan in ('free', 'pro')),
  features           text[] not null default array['painel']::text[],
  license_expires_at timestamptz,
  lifetime           boolean not null default false,
  -- limite de PCs por conta (a referência controla por dispositivo)
  max_devices        int not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ── PCs vinculados à conta ────────────────────────────────────────────────
create table if not exists public.devices (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  hwid        text not null,
  board       text,
  device_name text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  unique (user_id, hwid)
);

create index if not exists devices_user_idx on public.devices(user_id);
create index if not exists devices_hwid_idx on public.devices(hwid);

-- ── perfil criado ao registrar ────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ── segurança ─────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.devices  enable row level security;

drop policy if exists "ler proprio perfil" on public.profiles;
create policy "ler proprio perfil" on public.profiles for select using (auth.uid() = id);

drop policy if exists "ler proprios pcs" on public.devices;
create policy "ler proprios pcs" on public.devices for select using (auth.uid() = user_id);

-- ── verificação do PC (chamada pelo app no login) ─────────────────────────
-- Devolve o estado da licença no formato que a referência usa:
--   success, plan, features, lifetime, licenseExpiresAt, reason, pcBound
--
-- Regras (iguais à referência):
--   - já tem PC vinculado? atualiza last_seen e libera
--   - não tem, mas ainda cabe na cota? vincula e libera
--   - não tem e a cota acabou? reason='other_device'
--       pcBound = true  -> o PC do usuário mudou (formatou/trocou), pode renovar
--       pcBound = false -> está tentando usar em PC diferente
create or replace function public.verificar_pc(
  p_hwid   text,
  p_board  text default null,
  p_device text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u        uuid := auth.uid();
  perf     public.profiles%rowtype;
  vinculado boolean;
  qtd      int;
  vencida  boolean;
begin
  if u is null then
    return jsonb_build_object('success', false, 'reason', 'no_session');
  end if;
  if p_hwid is null or length(p_hwid) < 16 then
    return jsonb_build_object('success', false, 'reason', 'bad_hwid');
  end if;

  select * into perf from public.profiles where id = u;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'no_profile');
  end if;

  select exists(select 1 from public.devices where user_id = u and hwid = p_hwid) into vinculado;

  if vinculado then
    update public.devices
       set last_seen = now(),
           device_name = coalesce(p_device, device_name),
           board = coalesce(p_board, board)
     where user_id = u and hwid = p_hwid;
  else
    select count(*) into qtd from public.devices where user_id = u;
    if qtd >= perf.max_devices then
      -- Cota cheia e este PC é novo. A referência distingue:
      --   plano 'free'  -> não é troca de PC, é uso em outro PC
      --   plano 'pro'   -> pode ser formatação/troca, oferece renovar
      return jsonb_build_object(
        'success', false,
        'reason', 'other_device',
        'pcBound', perf.plan = 'pro',
        'plan', perf.plan,
        'maxDevices', perf.max_devices,
        'devices', qtd
      );
    end if;
    insert into public.devices (user_id, hwid, board, device_name)
    values (u, p_hwid, p_board, p_device);
  end if;

  vencida := perf.license_expires_at is not null and perf.license_expires_at <= now();

  return jsonb_build_object(
    'success', true,
    'plan', perf.plan,
    'features', perf.features,
    'lifetime', perf.lifetime,
    'licenseExpiresAt', perf.license_expires_at,
    'reason', case when vencida then 'expired' else null end,
    'pcBound', false,
    'maxDevices', perf.max_devices
  );
end;
$$;

-- ── liberar plano (quando o cliente paga no site) ─────────────────────────
-- Exemplos no SQL Editor do Supabase:
--   select public.liberar_plano('cliente@email.com');                     -- completo, vitalício
--   select public.liberar_plano('cliente@email.com', 30);                 -- completo, 30 dias
--   select public.liberar_plano('cliente@email.com', 30, array['painel','fps'], 2);  -- 2 PCs
create or replace function public.liberar_plano(
  email_alvo text,
  dias int default null,
  recursos text[] default array['*'],
  pcs int default 1
)
returns text language plpgsql security definer set search_path = public as $$
declare alvo uuid;
begin
  select id into alvo from auth.users where email = email_alvo;
  if alvo is null then return 'usuario nao encontrado: ' || email_alvo; end if;

  update public.profiles
     set plan = 'pro',
         features = recursos,
         lifetime = (dias is null),
         max_devices = greatest(1, pcs),
         license_expires_at = case when dias is null then null else now() + (dias || ' days')::interval end
   where id = alvo;

  return 'plano liberado para ' || email_alvo;
end;
$$;

-- ── liberar troca de PC (quando o cliente formata ou troca de máquina) ────
-- Zera os PCs vinculados: no próximo login ele vincula o PC novo.
create or replace function public.liberar_troca_pc(email_alvo text)
returns text language plpgsql security definer set search_path = public as $$
declare alvo uuid;
begin
  select id into alvo from auth.users where email = email_alvo;
  if alvo is null then return 'usuario nao encontrado'; end if;
  delete from public.devices where user_id = alvo;
  return 'PCs liberados para ' || email_alvo;
end;
$$;

-- ── voltar ao gratuito ────────────────────────────────────────────────────
create or replace function public.remover_plano(email_alvo text)
returns text language plpgsql security definer set search_path = public as $$
declare alvo uuid;
begin
  select id into alvo from auth.users where email = email_alvo;
  if alvo is null then return 'usuario nao encontrado'; end if;
  update public.profiles
     set plan='free', features=array['painel']::text[], lifetime=false,
         license_expires_at=null, max_devices=1
   where id = alvo;
  return 'plano removido de ' || email_alvo;
end;
$$;

-- ── consultas úteis ───────────────────────────────────────────────────────
--   select p.email, p.name, p.plan, p.features, p.lifetime, p.license_expires_at, p.max_devices,
--          (select count(*) from public.devices d where d.user_id = p.id) as pcs
--     from public.profiles p order by p.created_at desc;
--
--   select public.liberar_plano('fulano@gmail.com', 365, array['*'], 2);
--   select public.liberar_troca_pc('fulano@gmail.com');
--   select public.remover_plano('fulano@gmail.com');

grant execute on function public.verificar_pc(text, text, text) to authenticated;
revoke all on function public.liberar_plano(text, int, text[], int) from public;
revoke all on function public.liberar_troca_pc(text) from public;
revoke all on function public.remover_plano(text) from public;
grant execute on function public.liberar_plano(text, int, text[], int) to service_role;
grant execute on function public.liberar_troca_pc(text) to service_role;
grant execute on function public.remover_plano(text) to service_role;

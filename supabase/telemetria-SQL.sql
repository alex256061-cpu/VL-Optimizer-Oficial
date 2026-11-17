-- ══════════════════════════════════════════════════════════════════════════
-- TELEMETRIA — tabelas para os 3 endpoints do GDZ
--
-- O app já mandava os dados e recebia 404: a fila (telemetria.js) enchia até 500
-- itens e morria no disco do cliente. Estas tabelas são o que a Edge Function
-- `telemetria` grava.
--
-- Escopo de segurança:
--   - o cliente (anon / authenticated) NÃO escreve direto nessas tabelas: quem
--     grava é a Edge Function com a service role. Por isso não há policy de
--     INSERT para o papel `authenticated`.
--   - o cliente lê só o que é dele (user_id = auth.uid()), quando precisar.
--
-- Rodar no SQL Editor do projeto Supabase.
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. FPS: uma linha por medição ───────────────────────────────────────
create table if not exists public.telemetria_fps (
  id              bigserial primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  client_id       uuid not null,                       -- id do item na fila do app
  pair_id         uuid,                                -- liga "antes" e "depois"
  phase           text not null default 'manual'
                  check (phase in ('before', 'after', 'manual')),
  game            text,
  duration_s      int  check (duration_s is null or (duration_s between 5 and 120)),
  fps_avg         numeric(8,2),
  low_1           numeric(8,2),
  low_01          numeric(8,2),
  frametime_avg   numeric(8,3),
  frames          bigint,
  optimizations   text[] not null default '{}',
  app_version     text,
  captured_at     timestamptz,
  recebido_em     timestamptz not null default now(),
  -- reenvio do mesmo item não duplica: a fila do app reenvia em caso de dúvida
  unique (user_id, client_id)
);

create index if not exists telemetria_fps_user_idx     on public.telemetria_fps (user_id, recebido_em desc);
create index if not exists telemetria_fps_pair_idx     on public.telemetria_fps (pair_id) where pair_id is not null;
create index if not exists telemetria_fps_game_idx     on public.telemetria_fps (game, recebido_em desc);

-- ── 2. Hardware: uma linha por PC (hash do snapshot) ────────────────────
create table if not exists public.telemetria_hardware (
  hw_hash         text primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  cpu_name        text,
  cpu_vendor      text,
  x3d             boolean not null default false,
  intel_hybrid    boolean not null default false,
  gpu_name        text,
  gpu_vendor      text,
  ram_gb          int,
  laptop          boolean not null default false,
  os_build        text,
  cpu_cores       int,
  cpu_threads     int,
  cpu_max_ghz     numeric(4,1),
  gpu_vram_gb     int,
  gpu_driver      text,
  gpu_count       int,
  ram_speed_mhz   int,
  ram_modules     int,
  disk_type       text check (disk_type is null or disk_type in ('NVMe','SSD','HDD')),
  disk_gb         int,
  board           text,
  windows         text,
  power_plan      text,
  screen_w        int,
  screen_h        int,
  refresh_hz      int,
  displays        int,
  updated_at      timestamptz not null default now()
);

create index if not exists telemetria_hardware_user_idx on public.telemetria_hardware (user_id);
-- consultas do dono: quantos X3D, quantos laptop, drivers velhos...
create index if not exists telemetria_hardware_busca_idx
  on public.telemetria_hardware (cpu_vendor, gpu_vendor, disk_type);

-- ── 3. Consentimento: histórico (o app manda antes do 1º lote de FPS) ──
create table if not exists public.telemetria_consentimento (
  id              bigserial primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  telemetry       boolean not null,
  at              timestamptz not null default now()
);

create index if not exists telemetria_consent_user_idx on public.telemetria_consentimento (user_id, at desc);

-- ── 4. Funil de plano ──────────────────────────────────────────────────
create table if not exists public.eventos_plano (
  id              bigserial primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  type            text not null
                  check (type in ('upsell_view','upsell_click','offer_view','offer_click','referral_copy')),
  trigger         text,
  at              timestamptz not null default now()
);

create index if not exists eventos_plano_tipo_idx on public.eventos_plano (type, at desc);
create index if not exists eventos_plano_user_idx on public.eventos_plano (user_id, at desc);

-- ── 5. RLS: o cliente lê o que é dele; escreve ninguém (só a Edge Function) ──
alter table public.telemetria_fps           enable row level security;
alter table public.telemetria_hardware      enable row level security;
alter table public.telemetria_consentimento enable row level security;
alter table public.eventos_plano            enable row level security;

-- leitura só do próprio
drop policy if exists "telemetria_fps_le_proprio" on public.telemetria_fps;
create policy "telemetria_fps_le_proprio" on public.telemetria_fps
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "telemetria_hardware_le_proprio" on public.telemetria_hardware;
create policy "telemetria_hardware_le_proprio" on public.telemetria_hardware
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "telemetria_consent_le_proprio" on public.telemetria_consentimento;
create policy "telemetria_consent_le_proprio" on public.telemetria_consentimento
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "eventos_plano_le_proprio" on public.eventos_plano;
create policy "eventos_plano_le_proprio" on public.eventos_plano
  for select to authenticated using (auth.uid() = user_id);

-- O dono (service_role) lê tudo; a Edge Function grava com service_role.
-- Nenhuma policy de INSERT/UPDATE/DELETE para `authenticated`: o cliente não
-- escreve direto. Se algum dia precisar, abra uma policy explícita e revisada.

-- ── 6. Limpeza automática (opcional, mas evita a tabela crescer sem fim) ──
-- Mantém 180 dias de FPS e de eventos. Rode com pg_cron, se disponível:
--
--   select cron.schedule('limpa-telemetria', '0 4 * * *', $$
--     delete from public.telemetria_fps   where recebido_em < now() - interval '180 days';
--     delete from public.eventos_plano    where at          < now() - interval '180 days';
--     delete from public.telemetria_consentimento where at  < now() - interval '365 days';
--   $$);
--
-- Hardware NÃO é apagado por prazo: é um retrato do PC, não uma série.

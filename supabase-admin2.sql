-- ══════════════════════════════════════════════════════════════════════════
-- Painel administrativo — parte 2: vendas, licenças, chaves e gráficos
--
-- Como usar: painel do Supabase → SQL Editor → New query → cole tudo → Run
-- ══════════════════════════════════════════════════════════════════════════

-- ── vendas (cada pagamento aprovado vira uma linha) ───────────────────────
create table if not exists public.vendas (
  id            bigserial primary key,
  pagamento_id  text unique,               -- id do Mercado Pago
  email         text not null,
  plano         text,                      -- mensal / vitalicio
  valor         numeric(10,2) not null default 0,
  dias          int,                       -- null = vitalício
  metodo        text default 'pix',        -- pix / card
  status        text default 'approved',
  criado_em     timestamptz not null default now()
);

create index if not exists vendas_email_idx on public.vendas(email);
create index if not exists vendas_data_idx on public.vendas(criado_em);

alter table public.vendas enable row level security;
-- ninguém lê vendas pelo cliente: só pelas funções de admin (security definer)

-- ── chaves de licença ─────────────────────────────────────────────────────
create table if not exists public.chaves (
  id            bigserial primary key,
  codigo        text unique not null,      -- VL-XXXX-XXXX-XXXX
  plano         text not null default 'mensal',  -- mensal / vitalicio
  dias          int,                       -- null = vitalício
  -- quando alguém resgata, guardamos quem e quando
  usado_por     uuid references auth.users(id) on delete set null,
  usado_em      timestamptz,
  -- chave cancelada pelo admin não pode ser usada
  cancelada     boolean not null default false,
  criado_em     timestamptz not null default now()
);

create index if not exists chaves_codigo_idx on public.chaves(codigo);
create index if not exists chaves_usado_idx on public.chaves(usado_por);

alter table public.chaves enable row level security;

-- o usuário pode ver as chaves que ele mesmo resgatou
drop policy if exists "ver minhas chaves" on public.chaves;
create policy "ver minhas chaves"
  on public.chaves for select
  using (auth.uid() = usado_por);

-- ══════════════════════════════════════════════════════════════════════════
-- HARDWARE — guardado quando o app roda a verificação
-- ══════════════════════════════════════════════════════════════════════════
create table if not exists public.hardware (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  gpu           text,
  cpu           text,
  ram_gb        int,
  sistema       text,
  atualizado_em timestamptz not null default now()
);

create index if not exists hardware_gpu_idx on public.hardware(gpu);
create index if not exists hardware_cpu_idx on public.hardware(cpu);

alter table public.hardware enable row level security;

drop policy if exists "ver meu hardware" on public.hardware;
create policy "ver meu hardware"
  on public.hardware for select
  using (auth.uid() = user_id);

drop policy if exists "gravar meu hardware" on public.hardware;
create policy "gravar meu hardware"
  on public.hardware for insert
  with check (auth.uid() = user_id);

drop policy if exists "atualizar meu hardware" on public.hardware;
create policy "atualizar meu hardware"
  on public.hardware for update
  using (auth.uid() = user_id);

-- ══════════════════════════════════════════════════════════════════════════
-- VENDAS
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.registrar_venda(
  p_pagamento text,
  p_email text,
  p_plano text,
  p_valor numeric,
  p_dias int default null,
  p_metodo text default 'pix'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.vendas (pagamento_id, email, plano, valor, dias, metodo)
  values (p_pagamento, p_email, p_plano, p_valor, p_dias, p_metodo)
  on conflict (pagamento_id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

-- resumo de vendas para o painel
create or replace function public.admin_vendas(p_dias int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  out jsonb;
  desde timestamptz := now() - (coalesce(p_dias, 30) || ' days')::interval;
begin
  if not public.sou_admin() then
    return jsonb_build_object('erro', 'sem permissao');
  end if;

  select jsonb_build_object(
    'periodo_dias', p_dias,
    'quantidade', (select count(*) from public.vendas where criado_em >= desde),
    'total',      (select coalesce(sum(valor), 0) from public.vendas where criado_em >= desde),
    'mensais',    (select count(*) from public.vendas where criado_em >= desde and plano = 'mensal'),
    'vitalicios', (select count(*) from public.vendas where criado_em >= desde and plano = 'vitalicio'),
    'ticket',     (select coalesce(round(avg(valor), 2), 0) from public.vendas where criado_em >= desde),
    -- por dia, para o gráfico
    'por_dia', (
      select coalesce(jsonb_agg(d order by d.dia), '[]'::jsonb) from (
        select date_trunc('day', criado_em)::date as dia,
               count(*) as qtd,
               coalesce(sum(valor), 0) as total
        from public.vendas
        where criado_em >= desde
        group by 1
      ) d
    ),
    -- lista das últimas
    'ultimas', (
      select coalesce(jsonb_agg(u order by u.criado_em desc), '[]'::jsonb) from (
        select email, plano, valor, dias, metodo, criado_em
        from public.vendas
        order by criado_em desc
        limit 50
      ) u
    )
  ) into out;

  return out;
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- LICENÇAS — quem vence quando
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.admin_licencas(p_filtro text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  out jsonb;
begin
  if not public.sou_admin() then
    return jsonb_build_object('erro', 'sem permissao');
  end if;

  select coalesce(jsonb_agg(x order by x.vence_em nulls last), '[]'::jsonb) into out
  from (
    select
      p.email,
      p.name,
      p.lifetime,
      p.license_expires_at as vence_em,
      case
        when p.lifetime then 'vitalicio'
        when p.license_expires_at is null then 'sem_prazo'
        when p.license_expires_at > now() then 'ativa'
        when p.license_expires_at > now() - interval '7 days' then 'vencida_7d'
        else 'vencida'
      end as situacao,
      case
        when p.license_expires_at is not null and p.license_expires_at > now()
          then extract(day from p.license_expires_at - now())::int
        else null
      end as dias_restantes
    from public.profiles p
    where p.plan = 'pro'
      and (
        p_filtro is null
        or p_filtro = ''
        or (p_filtro = 'ativas' and p.license_expires_at is not null and p.license_expires_at > now())
        or (p_filtro = 'vencidas' and p.license_expires_at is not null and p.license_expires_at <= now())
        or (p_filtro = 'vitalicias' and p.lifetime)
        or (p_filtro = 'vencendo' and p.license_expires_at is not null
            and p.license_expires_at > now() and p.license_expires_at < now() + interval '7 days')
      )
  ) x;

  return out;
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- GRÁFICOS — hardware dos clientes
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.admin_hardware()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  out jsonb;
begin
  if not public.sou_admin() then
    return jsonb_build_object('erro', 'sem permissao');
  end if;

  select jsonb_build_object(
    'total', (select count(*) from public.hardware),

    'gpus', (
      select coalesce(jsonb_agg(g order by g.qtd desc), '[]'::jsonb) from (
        select coalesce(nullif(gpu, ''), 'Não informado') as nome, count(*) as qtd
        from public.hardware group by 1 order by 2 desc limit 15
      ) g
    ),

    'cpus', (
      select coalesce(jsonb_agg(c order by c.qtd desc), '[]'::jsonb) from (
        select coalesce(nullif(cpu, ''), 'Não informado') as nome, count(*) as qtd
        from public.hardware group by 1 order by 2 desc limit 15
      ) c
    ),

    'ramos', (
      select coalesce(jsonb_agg(r order by r.qtd desc), '[]'::jsonb) from (
        select
          case
            when ram_gb is null then 'Não informado'
            when ram_gb < 8 then 'menos de 8 GB'
            when ram_gb < 16 then '8 GB'
            when ram_gb < 24 then '16 GB'
            when ram_gb < 32 then '24 GB'
            when ram_gb < 48 then '32 GB'
            else '48 GB ou mais'
          end as faixa,
          count(*) as qtd
        from public.hardware group by 1 order by 2 desc
      ) r
    ),

    'sistemas', (
      select coalesce(jsonb_agg(s order by s.qtd desc), '[]'::jsonb) from (
        select coalesce(nullif(sistema, ''), 'Não informado') as nome, count(*) as qtd
        from public.hardware group by 1 order by 2 desc limit 10
      ) s
    )
  ) into out;

  return out;
end;
$$;

-- ── o app grava o hardware por esta função ────────────────────────────────
create or replace function public.gravar_hardware(p_gpu text, p_cpu text, p_ram int, p_sistema text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false); end if;
  insert into public.hardware (user_id, gpu, cpu, ram_gb, sistema)
  values (auth.uid(), p_gpu, p_cpu, p_ram, p_sistema)
  on conflict (user_id) do update
    set gpu = excluded.gpu, cpu = excluded.cpu, ram_gb = excluded.ram_gb,
        sistema = excluded.sistema, atualizado_em = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- CHAVES
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.admin_criar_chaves(qtd int, p_plano text default 'mensal', p_dias int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  out jsonb := '[]'::jsonb;
  i int;
  cod text;
  alfabeto text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- sem I, O, 0, 1
  n int;
begin
  if not public.sou_admin() then
    return jsonb_build_object('erro', 'sem permissao');
  end if;
  if qtd is null or qtd < 1 or qtd > 100 then
    return jsonb_build_object('erro', 'entre 1 e 100 chaves');
  end if;

  for i in 1..qtd loop
    -- VL-XXXX-XXXX-XXXX
    cod := 'VL';
    for n in 1..3 loop
      cod := cod || '-' ||
        substr(alfabeto, floor(random() * length(alfabeto))::int + 1, 1) ||
        substr(alfabeto, floor(random() * length(alfabeto))::int + 1, 1) ||
        substr(alfabeto, floor(random() * length(alfabeto))::int + 1, 1) ||
        substr(alfabeto, floor(random() * length(alfabeto))::int + 1, 1);
    end loop;

    insert into public.chaves (codigo, plano, dias)
    values (cod, p_plano, case when p_plano = 'vitalicio' then null else p_dias end)
    on conflict (codigo) do nothing;

    out := out || jsonb_build_object('codigo', cod);
  end loop;

  return jsonb_build_object('ok', true, 'chaves', out);
end;
$$;

create or replace function public.admin_chaves()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  out jsonb;
begin
  if not public.sou_admin() then
    return jsonb_build_object('erro', 'sem permissao');
  end if;

  select jsonb_build_object(
    'total',    (select count(*) from public.chaves),
    'livres',   (select count(*) from public.chaves where usado_por is null and not cancelada),
    'usadas',   (select count(*) from public.chaves where usado_por is not null),
    'canceladas', (select count(*) from public.chaves where cancelada),
    'lista', (
      select coalesce(jsonb_agg(x order by x.criado_em desc), '[]'::jsonb) from (
        select c.codigo, c.plano, c.dias, c.cancelada, c.criado_em,
               c.usado_em, p.email as usado_por_email
        from public.chaves c
        left join public.profiles p on p.id = c.usado_por
        order by c.criado_em desc
        limit 200
      ) x
    )
  ) into out;

  return out;
end;
$$;

-- ── o cliente resgata a chave pelo app ────────────────────────────────────
create or replace function public.resgatar_chave(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  k public.chaves%rowtype;
  u uuid := auth.uid();
begin
  if u is null then
    return jsonb_build_object('ok', false, 'erro', 'precisa estar logado');
  end if;

  select * into k from public.chaves where codigo = upper(trim(p_codigo));
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'Chave não encontrada.');
  end if;
  if k.cancelada then
    return jsonb_build_object('ok', false, 'erro', 'Esta chave foi cancelada.');
  end if;
  if k.usado_por is not null then
    return jsonb_build_object('ok', false, 'erro', 'Esta chave já foi usada.');
  end if;

  update public.chaves set usado_por = u, usado_em = now() where id = k.id;

  update public.profiles
     set plan = 'pro',
         features = array['*']::text[],
         lifetime = (k.dias is null),
         license_expires_at = case when k.dias is null then null else now() + (k.dias || ' days')::interval end
   where id = u;

  return jsonb_build_object('ok', true, 'tipo',
    case when k.dias is null then 'vitalício' else k.dias || ' dias' end);
end;
$$;

create or replace function public.admin_cancelar_chave(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.sou_admin() then
    return jsonb_build_object('ok', false, 'erro', 'sem permissao');
  end if;
  update public.chaves set cancelada = true where codigo = upper(trim(p_codigo));
  return jsonb_build_object('ok', true);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- PERMISSÕES
-- ══════════════════════════════════════════════════════════════════════════
grant execute on function public.admin_vendas(int) to authenticated;
grant execute on function public.admin_licencas(text) to authenticated;
grant execute on function public.admin_hardware() to authenticated;
grant execute on function public.admin_chaves() to authenticated;
grant execute on function public.admin_criar_chaves(int, text, int) to authenticated;
grant execute on function public.admin_cancelar_chave(text) to authenticated;
grant execute on function public.gravar_hardware(text, text, int, text) to authenticated;
grant execute on function public.resgatar_chave(text) to authenticated;

-- registrar_venda é chamada pela Function do Cloudflare (service_role) e pelo webhook
revoke all on function public.registrar_venda(text, text, text, numeric, int, text) from public;
grant execute on function public.registrar_venda(text, text, text, numeric, int, text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- Painel administrativo — VL Optimizer
--
-- Como usar: painel do Supabase → SQL Editor → New query → cole tudo → Run
--
-- O painel é uma página do site (/admin) que só abre para quem estiver marcado como
-- administrador aqui. A verificação é feita por uma função no banco, usando o token do
-- usuário logado — não existe senha separada.
-- ══════════════════════════════════════════════════════════════════════════

-- ── marca quem é administrador ────────────────────────────────────────────
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- ── função: o usuário logado é administrador? ─────────────────────────────
create or replace function public.sou_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r boolean;
begin
  select is_admin into r from public.profiles where id = auth.uid();
  return coalesce(r, false);
end;
$$;

-- ── painel: resumo geral ──────────────────────────────────────────────────
-- Devolve os números que o painel mostra no topo.
create or replace function public.admin_resumo()
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
    'total_usuarios',    (select count(*) from public.profiles),
    'total_pagos',       (select count(*) from public.profiles where plan = 'pro'),
    'total_gratis',      (select count(*) from public.profiles where plan = 'free'),
    'total_vitalicios',  (select count(*) from public.profiles where lifetime = true),
    'licencas_ativas',   (select count(*) from public.profiles
                           where plan = 'pro'
                             and (license_expires_at is null or license_expires_at > now())),
    'licencas_vencidas', (select count(*) from public.profiles
                           where plan = 'pro'
                             and license_expires_at is not null
                             and license_expires_at <= now()),
    'total_pcs',         (select count(*) from public.devices),
    'novos_7d',          (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'novos_30d',         (select count(*) from public.profiles where created_at > now() - interval '30 days')
  ) into out;

  return out;
end;
$$;

-- ── painel: lista de usuários ─────────────────────────────────────────────
create or replace function public.admin_usuarios()
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

  select coalesce(jsonb_agg(x order by x.criado desc), '[]'::jsonb) into out
  from (
    select
      p.id,
      p.email,
      p.name,
      p.plan,
      p.features,
      p.lifetime,
      p.license_expires_at as vence_em,
      p.created_at as criado,
      p.is_admin,
      (select count(*) from public.devices d where d.user_id = p.id) as pcs,
      (select max(d.last_seen) from public.devices d where d.user_id = p.id) as ultimo_acesso,
      case
        when p.plan = 'pro' and p.lifetime then 'vitalicio'
        when p.plan = 'pro' and (p.license_expires_at is null or p.license_expires_at > now()) then 'ativo'
        when p.plan = 'pro' then 'vencido'
        else 'gratis'
      end as situacao
    from public.profiles p
  ) x;

  return out;
end;
$$;

-- ── painel: PCs vinculados ────────────────────────────────────────────────
create or replace function public.admin_pcs()
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

  select coalesce(jsonb_agg(x order by x.ultimo desc), '[]'::jsonb) into out
  from (
    select
      d.device_name as nome,
      d.board as placa,
      substring(d.hwid, 1, 12) as hwid_curto,
      d.first_seen as primeiro,
      d.last_seen as ultimo,
      p.email
    from public.devices d
    left join public.profiles p on p.id = d.user_id
  ) x;

  return out;
end;
$$;

-- ── painel: liberar o plano de um cliente ─────────────────────────────────
-- dias = null -> vitalício
create or replace function public.admin_liberar(email_alvo text, dias int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  alvo uuid;
begin
  if not public.sou_admin() then
    return jsonb_build_object('ok', false, 'erro', 'sem permissao');
  end if;

  select id into alvo from auth.users where email = email_alvo;
  if alvo is null then
    return jsonb_build_object('ok', false, 'erro', 'usuario nao encontrado');
  end if;

  update public.profiles
     set plan = 'pro',
         features = array['*']::text[],
         lifetime = (dias is null),
         license_expires_at = case when dias is null then null else now() + (dias || ' days')::interval end
   where id = alvo;

  return jsonb_build_object('ok', true, 'email', email_alvo,
                            'tipo', case when dias is null then 'vitalicio' else dias || ' dias' end);
end;
$$;

-- ── painel: remover o plano ───────────────────────────────────────────────
create or replace function public.admin_remover(email_alvo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  alvo uuid;
begin
  if not public.sou_admin() then
    return jsonb_build_object('ok', false, 'erro', 'sem permissao');
  end if;

  select id into alvo from auth.users where email = email_alvo;
  if alvo is null then
    return jsonb_build_object('ok', false, 'erro', 'usuario nao encontrado');
  end if;

  update public.profiles
     set plan = 'free', features = array['painel']::text[], lifetime = false, license_expires_at = null
   where id = alvo;

  return jsonb_build_object('ok', true, 'email', email_alvo);
end;
$$;

-- ── painel: liberar a troca de PC ─────────────────────────────────────────
create or replace function public.admin_liberar_pc(email_alvo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  alvo uuid;
  qtd int;
begin
  if not public.sou_admin() then
    return jsonb_build_object('ok', false, 'erro', 'sem permissao');
  end if;

  select id into alvo from auth.users where email = email_alvo;
  if alvo is null then
    return jsonb_build_object('ok', false, 'erro', 'usuario nao encontrado');
  end if;

  delete from public.devices where user_id = alvo;
  get diagnostics qtd = row_count;
  return jsonb_build_object('ok', true, 'email', email_alvo, 'pcs_liberados', qtd);
end;
$$;

-- ── permissões ────────────────────────────────────────────────────────────
grant execute on function public.sou_admin() to authenticated;
grant execute on function public.admin_resumo() to authenticated;
grant execute on function public.admin_usuarios() to authenticated;
grant execute on function public.admin_pcs() to authenticated;
grant execute on function public.admin_liberar(text, int) to authenticated;
grant execute on function public.admin_remover(text) to authenticated;
grant execute on function public.admin_liberar_pc(text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- DEPOIS DE RODAR, marque a SUA conta como administrador:
--
--   select public.tornar_admin('seu@email.com');
--
-- (a função abaixo cria isso)
-- ══════════════════════════════════════════════════════════════════════════

create or replace function public.tornar_admin(email_alvo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alvo uuid;
begin
  select id into alvo from auth.users where email = email_alvo;
  if alvo is null then
    return 'usuario nao encontrado: ' || email_alvo;
  end if;
  update public.profiles set is_admin = true where id = alvo;
  return 'admin: ' || email_alvo;
end;
$$;

revoke all on function public.tornar_admin(text) from public;
grant execute on function public.tornar_admin(text) to service_role;

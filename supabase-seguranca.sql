-- ══════════════════════════════════════════════════════════════════════════
-- CORREÇÃO DE SEGURANÇA CRÍTICA — execução imediata
--
-- FALHA: qualquer pessoa que cria uma conta grátis conseguia virar administrador com:
--    POST /rest/v1/rpc/tornar_admin  {"email_alvo":"seu@email.com"}
--
-- Motivo: a função tornar_admin é SECURITY DEFINER e não checava sou_admin().
-- Além disso, o "revoke all ... from public" não remove os grants padrão dados a
-- anon e authenticated — a API REST continuava expostas a essas funções.
--
-- Também ficaram executáveis por usuário comum:
--    liberar_plano, liberar_troca_pc, remover_plano, registrar_venda
--
-- Esta correção:
--   1. revoga execute dessas funções de anon e authenticated
--   2. adiciona checagem de autorização DENTRO delas (defesa em profundidade)
--   3. confere de novo que as funções admin_* exigem sou_admin()
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. REVOGAR de anon e authenticated ────────────────────────────────────
revoke all on function public.tornar_admin(text) from public, anon, authenticated;
revoke all on function public.liberar_plano(text, int, text[], int) from public, anon, authenticated;
revoke all on function public.liberar_troca_pc(text) from public, anon, authenticated;
revoke all on function public.remover_plano(text) from public, anon, authenticated;
revoke all on function public.registrar_venda(text, text, text, numeric, int, text) from public, anon, authenticated;

-- mantém só o service_role (usado pelas Functions do Cloudflare e pelo painel do Supabase)
grant execute on function public.tornar_admin(text) to service_role;
grant execute on function public.liberar_plano(text, int, text[], int) to service_role;
grant execute on function public.liberar_troca_pc(text) to service_role;
grant execute on function public.remover_plano(text) to service_role;
grant execute on function public.registrar_venda(text, text, text, numeric, int, text) to service_role;

-- ── 2. DEFESA EM PROFUNDIDADE: checar autorização dentro das funções ──────

-- tornar_admin: só quem já é admin pode promover outro (ou service_role, que não tem auth.uid())
create or replace function public.tornar_admin(email_alvo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alvo uuid;
  chamador_admin boolean;
begin
  -- auth.uid() é null quando quem chama é o service_role (painel do Supabase)
  if auth.uid() is not null then
    select is_admin into chamador_admin from public.profiles where id = auth.uid();
    if not coalesce(chamador_admin, false) then
      raise exception 'sem permissao';
    end if;
  end if;

  select id into alvo from auth.users where email = email_alvo;
  if alvo is null then
    return 'usuario nao encontrado: ' || email_alvo;
  end if;

  update public.profiles set is_admin = true where id = alvo;
  return 'admin: ' || email_alvo;
end;
$$;

revoke all on function public.tornar_admin(text) from public, anon, authenticated;
grant execute on function public.tornar_admin(text) to service_role;

-- liberar_plano: só admin ou service_role
create or replace function public.liberar_plano(
  email_alvo text,
  dias int default null,
  recursos text[] default array['*'],
  pcs int default 1
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alvo uuid;
  chamador_admin boolean;
begin
  if auth.uid() is not null then
    select is_admin into chamador_admin from public.profiles where id = auth.uid();
    if not coalesce(chamador_admin, false) then
      raise exception 'sem permissao';
    end if;
  end if;

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

revoke all on function public.liberar_plano(text, int, text[], int) from public, anon, authenticated;
grant execute on function public.liberar_plano(text, int, text[], int) to service_role;

-- liberar_troca_pc
create or replace function public.liberar_troca_pc(email_alvo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alvo uuid;
  chamador_admin boolean;
begin
  if auth.uid() is not null then
    select is_admin into chamador_admin from public.profiles where id = auth.uid();
    if not coalesce(chamador_admin, false) then
      raise exception 'sem permissao';
    end if;
  end if;

  select id into alvo from auth.users where email = email_alvo;
  if alvo is null then return 'usuario nao encontrado'; end if;
  delete from public.devices where user_id = alvo;
  return 'PCs liberados para ' || email_alvo;
end;
$$;

revoke all on function public.liberar_troca_pc(text) from public, anon, authenticated;
grant execute on function public.liberar_troca_pc(text) to service_role;

-- remover_plano
create or replace function public.remover_plano(email_alvo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alvo uuid;
  chamador_admin boolean;
begin
  if auth.uid() is not null then
    select is_admin into chamador_admin from public.profiles where id = auth.uid();
    if not coalesce(chamador_admin, false) then
      raise exception 'sem permissao';
    end if;
  end if;

  select id into alvo from auth.users where email = email_alvo;
  if alvo is null then return 'usuario nao encontrado'; end if;
  update public.profiles
     set plan='free', features=array['painel']::text[], lifetime=false,
         license_expires_at=null, max_devices=1
   where id = alvo;
  return 'plano removido de ' || email_alvo;
end;
$$;

revoke all on function public.remover_plano(text) from public, anon, authenticated;
grant execute on function public.remover_plano(text) to service_role;

-- registrar_venda: só service_role (vem das Functions do Cloudflare)
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
  -- só o service_role pode inventar venda (auth.uid() é null nesse caminho)
  if auth.uid() is not null then
    raise exception 'sem permissao';
  end if;

  insert into public.vendas (pagamento_id, email, plano, valor, dias, metodo)
  values (p_pagamento, p_email, p_plano, p_valor, p_dias, p_metodo)
  on conflict (pagamento_id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.registrar_venda(text, text, text, numeric, int, text) from public, anon, authenticated;
grant execute on function public.registrar_venda(text, text, text, numeric, int, text) to service_role;

-- ── 3. FUNÇÕES QUE O CLIENTE LEGITIMAMENTE USA ────────────────────────────
-- Estas continuam liberadas para "authenticated", mas NÃO para "anon":
--   verificar_pc, resgatar_chave, gravar_hardware, sou_admin e as admin_* (que checam por dentro)
revoke all on function public.verificar_pc(text, text, text) from public, anon;
grant execute on function public.verificar_pc(text, text, text) to authenticated, service_role;

revoke all on function public.resgatar_chave(text) from public, anon;
grant execute on function public.resgatar_chave(text) to authenticated, service_role;

revoke all on function public.gravar_hardware(text, text, int, text) from public, anon;
grant execute on function public.gravar_hardware(text, text, int, text) to authenticated, service_role;

revoke all on function public.sou_admin() from public, anon;
grant execute on function public.sou_admin() to authenticated, service_role;

-- ── 4. AUDITORIA: limpar os admins indevidos ──────────────────────────────
-- Remove is_admin de qualquer conta que NÃO seja a de administrador legítima.
-- AJUSTE o e-mail abaixo para o seu antes de rodar, se preferir manter outra conta.
update public.profiles
   set is_admin = false
 where is_admin = true
   and email not in ('admin1794528536268@gmail.com');

-- ── 5. CONFERÊNCIA ────────────────────────────────────────────────────────
-- Rode depois para ver o que sobrou de permissivo:
--
-- select routine_name, grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema = 'public'
--    and routine_name in ('tornar_admin','liberar_plano','liberar_troca_pc','remover_plano','registrar_venda')
--  order by routine_name, grantee;
--
-- Esperado: só service_role em todas.

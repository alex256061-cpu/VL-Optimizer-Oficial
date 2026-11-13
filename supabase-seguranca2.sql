-- ══════════════════════════════════════════════════════════════════════════
-- CORREÇÃO 2 — causa-raiz dos grants e proteção das funções restantes
--
-- O relatório da auditoria apontou:
--   - "revoke all ... from public" não revoga de anon/authenticated.
--     É preciso revogar explicitando os dois roles E ajustar as default privileges,
--     senão toda função nova nasce pública de novo.
--   - admin_liberar / admin_liberar_pc / admin_remover precisam de checagem interna
--     (não só das funções "legadas" que eu já tratei).
--   - conferir com has_function_privilege.
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. DEFESA EM PROFUNDIDADE nas funções admin_* que faltavam ────────────

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

-- ── 2. CAUSA-RAIZ: revogar explicitamente de anon e authenticated ─────────
revoke all on function public.admin_liberar(text, int) from public, anon, authenticated;
revoke all on function public.admin_remover(text) from public, anon, authenticated;
revoke all on function public.admin_liberar_pc(text) from public, anon, authenticated;

grant execute on function public.admin_liberar(text, int) to authenticated, service_role;
grant execute on function public.admin_remover(text) to authenticated, service_role;
grant execute on function public.admin_liberar_pc(text) to authenticated, service_role;

revoke all on function public.admin_resumo() from public, anon;
revoke all on function public.admin_usuarios() from public, anon;
revoke all on function public.admin_pcs() from public, anon;
revoke all on function public.admin_vendas(int) from public, anon;
revoke all on function public.admin_licencas(text) from public, anon;
revoke all on function public.admin_hardware() from public, anon;
revoke all on function public.admin_chaves() from public, anon;
revoke all on function public.admin_criar_chaves(int, text, int) from public, anon;
revoke all on function public.admin_cancelar_chave(text) from public, anon;

grant execute on function public.admin_resumo() to authenticated, service_role;
grant execute on function public.admin_usuarios() to authenticated, service_role;
grant execute on function public.admin_pcs() to authenticated, service_role;
grant execute on function public.admin_vendas(int) to authenticated, service_role;
grant execute on function public.admin_licencas(text) to authenticated, service_role;
grant execute on function public.admin_hardware() to authenticated, service_role;
grant execute on function public.admin_chaves() to authenticated, service_role;
grant execute on function public.admin_criar_chaves(int, text, int) to authenticated, service_role;
grant execute on function public.admin_cancelar_chave(text) to authenticated, service_role;

-- ── 3. DEFAULT PRIVILEGES: função nova nasce sem EXECUTE para anon ────────
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from public;

-- ── 4. CONFERÊNCIA ────────────────────────────────────────────────────────
do $$
declare
  r record;
  problematicas int := 0;
begin
  for r in
    select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef = true
       and (
            has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE')
       )
  loop
    -- funções que o cliente legitimamente usa
    if r.proname in ('sou_admin','verificar_pc','resgatar_chave','gravar_hardware')
       or r.proname like 'admin_%' then
      continue;
    end if;
    raise notice 'PROBLEMA: % executável por anon/authenticated', r.proname;
    problematicas := problematicas + 1;
  end loop;

  raise notice 'Funções SECURITY DEFINER problemáticas: %', problematicas;
end $$;

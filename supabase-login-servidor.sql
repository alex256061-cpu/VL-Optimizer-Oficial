-- ══════════════════════════════════════════════════════════════════════════
-- LOGIN NO SERVIDOR — correção do item 09 da auditoria (rodar UMA vez)
--
-- Problema: as funções de bloqueio de tentativas estavam liberadas para `anon`
-- (qualquer pessoa, sem login):
--   - limpar_falhas_login()  -> qualquer um APAGAVA o bloqueio de um e-mail;
--   - registrar_falha_login() -> qualquer um enchia a tabela / travava login alheio.
--
-- O site e o app agora fazem login pela Function /api/login (Cloudflare), que usa a
-- service key para consultar/gravar essas funções. Depois deste SQL, só o servidor
-- consegue executá-las.
--
-- COMO RODAR: painel do Supabase -> SQL Editor -> New query -> colar tudo -> Run.
-- (É reversível: se precisar, o grant pode ser refeito.)
-- ══════════════════════════════════════════════════════════════════════════

-- 1. Tira o acesso público das três funções de tentativas de login.
revoke all on function public.login_bloqueado(text) from public, anon, authenticated;
revoke all on function public.registrar_falha_login(text, text) from public, anon, authenticated;
revoke all on function public.limpar_falhas_login(text) from public, anon, authenticated;

-- 2. Só a service key (usada pela Function /api/login) pode executar.
grant execute on function public.login_bloqueado(text) to service_role;
grant execute on function public.registrar_falha_login(text, text) to service_role;
grant execute on function public.limpar_falhas_login(text) to service_role;

-- 3. Garante que a tabela continue fechada para o cliente (só a função mexe).
alter table public.tentativas_login enable row level security;

-- 4. Conferência: deve mostrar somente service_role nas três funções.
--    (Se aparecer anon ou authenticated, o revoke não foi aplicado.)
select r.routine_name, p.grantee, p.privilege_type
  from information_schema.routine_privileges p
  join information_schema.routines r
    on r.specific_name = p.specific_name
   and r.routine_schema = p.routine_schema
 where r.routine_schema = 'public'
   and r.routine_name in ('login_bloqueado', 'registrar_falha_login', 'limpar_falhas_login')
 order by r.routine_name, p.grantee;

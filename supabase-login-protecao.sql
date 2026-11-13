-- Rate limit de login no Supabase é configuração do GoTrue, não dá para mudar por SQL
-- em projeto hospedado. A alternativa é proteger no CÓDIGO: a Function /api/login
-- faz o login pelo servidor com contador por IP e por e-mail.
--
-- Mas isso muda a arquitetura (o cliente hoje fala direto com o Supabase).
--
-- Solução mais simples e eficaz: registrar as tentativas falhas e bloquear na tela.
-- Vamos criar a tabela de tentativas e a função.

create table if not exists public.tentativas_login (
  id bigserial primary key,
  email text not null,
  ip text,
  quando timestamptz not null default now()
);

create index if not exists tentativas_email_idx on public.tentativas_login(email, quando);

alter table public.tentativas_login enable row level security;
-- ninguém acessa pelo cliente: só pela função abaixo (security definer)

-- Verifica se o e-mail está bloqueado por excesso de tentativas.
-- Regra: 8 falhas em 15 minutos bloqueiam por 15 minutos.
create or replace function public.login_bloqueado(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  falhas int;
  ultima timestamptz;
begin
  select count(*), max(quando) into falhas, ultima
    from public.tentativas_login
   where email = lower(trim(p_email))
     and quando > now() - interval '15 minutes';

  if falhas >= 8 then
    return jsonb_build_object(
      'bloqueado', true,
      'falhas', falhas,
      'libera_em', (ultima + interval '15 minutes'),
      'mensagem', 'Muitas tentativas. Tente de novo em alguns minutos ou use "Esqueci a senha".'
    );
  end if;

  return jsonb_build_object('bloqueado', false, 'falhas', falhas);
end;
$$;

-- Registra uma falha de login.
create or replace function public.registrar_falha_login(p_email text, p_ip text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tentativas_login (email, ip)
  values (lower(trim(p_email)), p_ip);

  -- limpeza: apaga registros com mais de 1 dia
  delete from public.tentativas_login where quando < now() - interval '1 day';

  return jsonb_build_object('ok', true);
end;
$$;

-- Limpa as falhas quando o login dá certo.
create or replace function public.limpar_falhas_login(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.tentativas_login where email = lower(trim(p_email));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.login_bloqueado(text) from public, anon, authenticated;
revoke all on function public.registrar_falha_login(text, text) from public, anon, authenticated;
revoke all on function public.limpar_falhas_login(text) from public, anon, authenticated;

grant execute on function public.login_bloqueado(text) to anon, authenticated, service_role;
grant execute on function public.registrar_falha_login(text, text) to anon, authenticated, service_role;
grant execute on function public.limpar_falhas_login(text) to anon, authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- VL Optimizer — esquema do banco (Supabase)
--
-- Como usar: painel do Supabase → SQL Editor → New query → cole tudo → Run
--
-- O Supabase já cria a tabela `auth.users` com e-mail e senha. Aqui só guardamos
-- o que é nosso: nome de exibição, plano e a data em que o acesso foi liberado.
-- ══════════════════════════════════════════════════════════════════════════

-- ── tabela de perfis ──────────────────────────────────────────────────────
-- Um registro por usuário, criado automaticamente quando a conta é criada.
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  name         text,
  -- 'free' = conta normal; 'premium' = libera os itens trancados
  plan         text not null default 'free' check (plan in ('free', 'premium')),
  -- quando o acesso premium termina (null = sem validade)
  premium_until timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── cria o perfil automaticamente ao registrar ────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── updated_at automático ─────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ── segurança: cada usuário lê só o próprio perfil ────────────────────────
alter table public.profiles enable row level security;

drop policy if exists "ler proprio perfil" on public.profiles;
create policy "ler proprio perfil"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "atualizar proprio perfil" on public.profiles;
create policy "atualizar proprio perfil"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- O plano NÃO pode ser alterado pelo app: só pelo painel do Supabase (service role)
-- ou por esta função, que exige uma chave secreta. Assim ninguém vira premium sozinho.

-- ── função: liberar premium (só com a chave secreta) ──────────────────────
-- Chame pelo painel do Supabase (SQL Editor) quando o cliente pagar:
--   select public.liberar_premium('cliente@email.com', 30);
-- O segundo argumento são os dias de acesso (null = sem validade).
create or replace function public.liberar_premium(email_alvo text, dias int default null)
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

  update public.profiles
     set plan = 'premium',
         premium_until = case when dias is null then null else now() + (dias || ' days')::interval end
   where id = alvo;

  return 'premium liberado para ' || email_alvo;
end;
$$;

-- ── função: tirar premium ─────────────────────────────────────────────────
create or replace function public.remover_premium(email_alvo text)
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
    return 'usuario nao encontrado';
  end if;
  update public.profiles set plan = 'free', premium_until = null where id = alvo;
  return 'premium removido de ' || email_alvo;
end;
$$;

-- ── consulta: ver quem é premium ──────────────────────────────────────────
--   select email, name, plan, premium_until, created_at from public.profiles order by created_at desc;

-- ── permissão de execução ─────────────────────────────────────────────────
revoke all on function public.liberar_premium(text, int) from public;
revoke all on function public.remover_premium(text) from public;
grant execute on function public.liberar_premium(text, int) to service_role;
grant execute on function public.remover_premium(text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- admin_resumo ampliado: acrescenta licenças vencendo em 7 dias e contas de hoje.
-- Rodar no SQL Editor do Supabase.
-- ══════════════════════════════════════════════════════════════════════════

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
                             and (lifetime = true or license_expires_at is null or license_expires_at > now())),
    'licencas_vencidas', (select count(*) from public.profiles
                           where plan = 'pro'
                             and lifetime = false
                             and license_expires_at is not null
                             and license_expires_at <= now()),
    -- vencendo nos próximos 7 dias
    'licencas_vencendo', (select count(*) from public.profiles
                           where plan = 'pro'
                             and lifetime = false
                             and license_expires_at is not null
                             and license_expires_at > now()
                             and license_expires_at < now() + interval '7 days'),
    'total_pcs',         (select count(*) from public.devices),
    'total_hardware',    (select count(*) from public.hardware),
    'novos_hoje',        (select count(*) from public.profiles where created_at >= current_date),
    'novos_7d',          (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'novos_30d',         (select count(*) from public.profiles where created_at > now() - interval '30 days')
  ) into out;

  return out;
end;
$$;

grant execute on function public.admin_resumo() to authenticated;

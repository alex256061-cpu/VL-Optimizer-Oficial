-- Plano grátis igual ao GDZ: painel, jogos, fps, gargalo, hardware, inicializacao, sobre, quick-opt
alter table public.profiles
  alter column features set default '{painel,jogos,fps,gargalo,hardware,inicializacao,sobre,quick-opt}';

-- contas grátis/vencidas que já existem (não mexe em quem tem '*')
update public.profiles
   set features = '{painel,jogos,fps,gargalo,hardware,inicializacao,sobre,quick-opt}'
 where plan <> 'pro' and not ('*' = any(features));

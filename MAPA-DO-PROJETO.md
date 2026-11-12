# Mapa do projeto — VL Optimizer
# Gerado para organizar o que existe e o que falta.

## O QUE JÁ EXISTE (funcionando)

### Aplicativo (Electron)
- [x] 34 tweaks + 18 ações, catálogo alinhado ao GDZ (33/33 e 16/16)
- [x] Painel mostrando 16 de 21 ligados (referência: 15 de 19)
- [x] Medidor de FPS, gargalo, hardware, limpeza, scaling
- [x] Tela de login (src/login.html)
- [x] Sessão guardada no PC (supabase.js)
- [x] HWID: ProcessorId + serial placa-mãe + MachineGuid (igual GDZ)
- [x] Limite de PC por conta (max_devices)
- [x] PAGE_FEATURE: bloqueio por página (igual GDZ)
- [x] Tela "PC novo: renovar" e "Plano em outro PC"
- [x] Versão 1.3.1 publicada no GitHub

### Site (Cloudflare Pages)
- [x] Landing page
- [x] entrar.html — login
- [x] criar-conta.html — cadastro
- [x] conta.html — minha conta
- [x] supabase-client.js — falas com o banco
- [x] Botão Entrar na navegação
- [x] 3 planos: Grátis R$ 0 / Mensal R$ 40 / Vitalício R$ 99
- [ ] PUBLICADO? (precisa subir no Cloudflare)

### Banco (Supabase Free)
- [x] Tabela profiles (plan, features, lifetime, license_expires_at, max_devices)
- [x] Tabela devices (hwid, board, device_name)
- [x] Função verificar_pc() — limite por PC
- [x] Função liberar_plano(email, dias, recursos, pcs)
- [x] Função liberar_troca_pc(email)
- [x] Row Level Security
- [x] Confirm email DESLIGADO (não gasta e-mail)
- [x] Tarefa diária de keep-alive (não pausa)

## O QUE FALTA

### 1. Gateway de pagamento
- [ ] Escolher gateway (Mercado Pago, Stripe, PagBank, AbacatePay...)
- [ ] Configurar PIX + cartão
- [ ] Webhook: pagamento aprovado -> liberar_plano() automaticamente
- [ ] Botões de compra do site com link real

### 2. Painel administrativo (o da foto)
- [ ] Tela de métricas (vendas, usuários, hardware)
- [ ] Lista de usuários e planos
- [ ] Liberar/remover plano manualmente
- [ ] Histórico de pagamentos

### 3. Download do app
- [ ] Link de download no site
- [ ] Instalador publicado (já está no GitHub Releases)
- [ ] Verificação de versão no site

### 4. Sistema de chaves (opcional)
- [ ] Gerar chaves
- [ ] Tela de resgate no app
- [ ] Tabela de chaves no banco

## CUSTOS ATUAIS: R$ 0,00
- Supabase Free (com keep-alive)
- Cloudflare Pages Free
- GitHub Releases Free

## CUSTOS SE PRECISAR (baratos)
- AbacatePay: 0,99% + R$ 0,00 por PIX
- Mercado Pago: 4,99% por transação (sem mensalidade)
- PagBank: 4,99% cartão
- Supabase Pro: US$ 25/mês (só se estourar 50.000 usuários)

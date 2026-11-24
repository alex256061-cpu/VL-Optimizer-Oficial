# TUDO QUE DEVEMOS FAZER — VL Optimizer

Atualizado em 24/11/2026 · versão publicada: **1.4.67**

---

## 1. PRIMEIRO: atualizar o app do seu PC (5 minutos)

O app instalado está na **1.4.65** e a publicação é **1.4.67**.

1. Feche o app pelo **Gerenciador de Tarefas** (ele roda elevado, não fecha sozinho)
2. Abra o app e entre com **sua conta** (`mluccas218@gmail.com`)
3. Em ~10 s ele checa, baixa e deve aparecer a barra **"Versão 1.4.67 pronta para instalar"**
   → clique em **Reiniciar e atualizar**

> Se a barra aparecer, está provado no seu PC que a correção da 1.4.65 funciona.
> Se não aparecer em 2 minutos, me avise.

---

## 2. SÓ VOCÊ PODE FAZER (credencial / pagamento / PC local)

### 2.1 Telemetria — 5 min (estatística, não afeta o cliente)
Seguir `PENDENCIAS-SUPABASE.md`:
- [ ] Supabase → SQL Editor → rodar `supabase/telemetria-SQL.sql`
- [ ] `npx supabase login` → `link --project-ref wsmropvlmnyegpvmyndn`
- [ ] `npx supabase secrets set SB_SERVICE_ROLE_KEY=...`
- [ ] `npx supabase functions deploy telemetria`
- [ ] conferir que `POST /functions/v1/telemetria` deixa de dar 404

### 2.2 Plano grátis no banco — 1 min (opcional; o app já corrige sozinho)
- [ ] Supabase → SQL Editor → rodar `supabase-plano-gratis.sql`

### 2.3 Teste de compra real — 10 min (importante: é o que te dá dinheiro)
- [ ] Comprar o plano mensal (R$ 40) pelo site, pagando o PIX
- [ ] Em até 1 min, abrir `https://vl-optimizer.pages.dev/admin` → **Vendas** deve mostrar a venda
- [ ] **Usuários** deve mostrar o e-mail com plano `pro` e vencimento
- [ ] Abrir o app com esse e-mail: plano liberado
- [ ] Se a venda aparecer e o plano não liberar → problema no `webhook.js` (me avise)

### 2.4 Teste em PC limpo — 30 min (o que realmente falta)
Nunca foi feito. Seguir `ROTEIRO-TESTE-PC-LIMPO.md`. Ideal: o PC da sua namorada
ou uma VM com Windows 11. Verificar:
- [ ] instalador abre sem erro / SmartScreen
- [ ] instala e abre pedindo login
- [ ] conta nova grátis vê FPS, gargalo, hardware, inicialização, jogos e Otimização Rápida
- [ ] páginas pagas com cadeado e modal de planos
- [ ] desinstalar não deixa lixo
- [ ] Windows 11: os 4 cards que hoje são bloqueados no Win10 devem liberar

### 2.5 Decidir os 4 ajustes "inventados" — 5 min
Não existem no GDZ (fui eu que criei na 1.4.61). Manter ou remover?
- [ ] Desativar o Windows Defender
- [ ] Desativar as Atualizações do Windows
- [ ] Desativar a Restauração do Sistema
- [ ] Desativar o ajuste de escala (DPI)

**Minha recomendação:** remover os 3 primeiros (risco de segurança/suporte) e manter o DPI.

---

## 3. EU AINDA POSSO FAZER (é só pedir)

- [ ] Testar as outras abas do painel na tela (Vendas, Licenças, Usuários, PCs, Hardware,
      Chaves, Liberar acesso) — as funções já responderam com dados, falta só clicar
- [ ] Testar o fluxo de **PC novo / formatou** (licença presa em outro HWID) e a tela de renovação
- [ ] Testar **chave resgatada no app** (o botão "Tenho uma chave")
- [ ] Verificar o **Windows 11** (o que muda nos 4 cards bloqueados)
- [ ] Revisar textos/mensagens de erro do app
- [ ] Criar testes automáticos no build (hoje é tudo manual)
- [ ] Auditar o `Lossless` embutido (VL Scaling) com mais profundidade
- [ ] Conferir a **assinatura do instalador** (hoje não tem certificado de código — o
      SmartScreen pode assustar cliente novo; certificado EV custa ~R$ 1.500/ano)

---

## 4. RISCOS CONHECIDOS (o que pode dar problema para cliente futuro)

| Risco | Gravidade | Situação |
|---|---|---|
| Cliente na 1.4.63/1.4.64 precisa instalar a 1.4.65+ **uma vez à mão** (a barra estava quebrada) | 🔴 alto | a partir da 1.4.65 se resolve sozinho |
| Instalador sem assinatura de código → SmartScreen/antivírus | 🟠 médio | precisa certificado |
| Pagamento → plano liberado nunca testado com dinheiro real | 🔴 alto | item 2.3 |
| Telemetria 404 (estatística) | 🟡 baixo | item 2.1 |
| Windows 11 nunca testado | 🟠 médio | item 2.4 |
| Plano grátis no banco lista só `painel` (o app completa) | 🟡 baixo | item 2.2 |
| 4 ajustes inventados (Defender/Windows Update/Restauração/DPI) | 🟠 médio | item 2.5 |

---

## 5. ÚLTIMAS VERSÕES (o que cada uma resolveu)

| Versão | Correção |
|---|---|
| 1.4.63 | 2 cards que nunca acendiam + motivo de bloqueio nos cards de Win11 |
| 1.4.64 | sessão sobrevive a desligamento forçado (arquivo ficava zerado) |
| 1.4.65 | **barra de atualização nunca aparecia** (por isso ninguém atualizava) + canal clean-status |
| 1.4.66 | build de validação (teste de cliente novo + painel) |
| **1.4.67** | **plano grátis igual ao GDZ** + bloqueio de canais pagos no processo principal |

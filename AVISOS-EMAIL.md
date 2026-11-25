# Avisos de vencimento por e-mail — como funciona e como ativar

O painel já tem tudo pronto (botões, prévia, envio manual e automático). Falta só
**configurar o provedor de e-mail** uma vez. Enquanto não configurar, o painel
mostra "NÃO CONFIGURADO" e a prévia do e-mail funciona normalmente.

## 1) Como o e-mail é enviado

Não usamos SMTP nem servidor de e-mail próprio. A Cloudflare Pages Function
(`/api/admin-email` e `/api/cron-vencimentos`) chama a API de um provedor por HTTPS.

### Qual provedor usar (ordem de facilidade)

| Provedor | Grátis | Precisa de domínio? | Variáveis |
|---|---|---|---|
| **Mailjet** (recomendado) | 6.000/mês | **Não** — verifica só o e-mail remetente (Gmail) | `MAILJET_API_KEY` + `MAILJET_SECRET_KEY` |
| SendGrid | 100/dia | **Não** — "Single Sender Verification" | `SENDGRID_API_KEY` |
| Brevo | 300/dia | Não (verifica e-mail remetente) | `BREVO_API_KEY` |
| Resend | 3.000/mês | Sim, precisa de domínio verificado | `RESEND_API_KEY` |

O código aceita qualquer um dos quatro: usa o primeiro que estiver configurado, na
ordem Mailjet → SendGrid → Brevo → Resend.

E-mail sai de um endereço verificado no provedor (`EMAIL_REMETENTE`), ex.:
`contato.vloptimizer@gmail.com`.

### O que configurar na Cloudflare (Settings → Environment variables)

| Variável | Exemplo | Para quê |
|---|---|---|
| `MAILJET_API_KEY` | `a1b2c3...` | API Key do Mailjet (recomendado) |
| `MAILJET_SECRET_KEY` | `x9y8z7...` | Secret Key do Mailjet |
| `SENDGRID_API_KEY` | `SG....` | alternativa (100/dia) |
| `BREVO_API_KEY` | `xkeysib-...` | alternativa (300/dia) |
| `RESEND_API_KEY` | `re_...` | alternativa (exige domínio) |
| `EMAIL_REMETENTE` | `contato.vloptimizer@gmail.com` | remetente verificado no provedor |
| `EMAIL_NOME` | `VL Optimizer` | nome que aparece no remetente (opcional) |
| `CRON_KEY` | uma senha longa qualquer | protege a URL do cron automático |

### Passo a passo do Mailjet (sem domínio, ~5 min)

1. Acesse [mailjet.com](https://www.mailjet.com/) → **Create free account** (só e-mail e senha, sem cartão).
2. Confirme o e-mail da conta.
3. Menu **Sender domains & addresses** → **Add a sender address** → cadastre o Gmail que vai enviar (ex.: `contato.vloptimizer@gmail.com`) → o Mailjet manda um código para esse Gmail → confirme.
4. Menu **API keys** (Configurações da conta) → copie a **API Key** e a **Secret Key**.
5. Na Cloudflare → Settings → Environment variables: `MAILJET_API_KEY`, `MAILJET_SECRET_KEY`, `EMAIL_REMETENTE` (o Gmail verificado), `EMAIL_NOME=VL Optimizer` e `CRON_KEY`.
6. Salvar e pedir um novo deploy (me avisa que eu publico).

Depois disso, os botões "Enviar teste", "Enviar lembretes" e o link de recuperação
por chave passam a enviar de verdade.

## 2) Quando o e-mail é enviado

- **7 dias antes** de vencer: assunto `Sua licença do VL Optimizer vence em 7 dias`
- **1 dia antes (ou no dia)**: assunto `Último aviso: sua licença do VL Optimizer vence amanhã`
- Cada pessoa recebe no máximo **1 e-mail por dia** (controle em Storage privado).
- `Vitalício` nunca recebe.
- Pode enviar na mão pelo painel (botão "Enviar lembretes" ou "Enviar" por cliente),
  ou automático 1x por dia pelo GitHub Actions.

## 3) O que está escrito (texto exato)

**Assunto (7 dias):** Sua licença do VL Optimizer vence em 7 dias

> **VL Optimizer**
>
> **Sua licença vence em 7 dias**
>
> Olá, {nome}!
>
> Ela expira em **{data}**.
>
> Para continuar com os ajustes, o medidor de FPS e o scaling, é só renovar — leva 2 minutos:
>
> **[Renovar meu acesso]**
>
> Mensal R$ 40 · Vitalício R$ 99 (pagamento único). Se você já renovou, ignore este e-mail.
>
> Precisa de ajuda? Fale com a gente no Discord.
> Suporte VL Optimizer · vl-optimizer.pages.dev
> Este aviso é enviado porque você tem uma licença ativa. Não responda este e-mail.

**Assunto (último dia):** Último aviso: sua licença do VL Optimizer vence amanhã

> **Sua licença vence amanhã**
>
> Olá, {nome}!
>
> Ela expira em **{data}** (amanhã).
>
> …mesmo texto e botão de renovação…

## 4) Envio automático diário (GitHub Actions)

O Cloudflare Pages não tem agendador. O arquivo
`.github/workflows/avisos-vencimento.yml` chama a URL 1x por dia (09:00 BRT).
Para ativar, adicione em **GitHub → Settings → Secrets and variables → Actions**:

- `VL_AVISOS_URL` = `https://vl-optimizer.pages.dev/api/cron-vencimentos`
- `VL_CRON_KEY` = o mesmo valor de `CRON_KEY` configurado na Cloudflare

Também pode rodar o workflow na mão (Actions → Avisos de vencimento → Run workflow).

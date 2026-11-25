# Avisos de vencimento por e-mail — como funciona e como ativar

O painel já tem tudo pronto (botões, prévia, envio manual e automático). Falta só
**configurar o provedor de e-mail** uma vez. Enquanto não configurar, o painel
mostra "NÃO CONFIGURADO" e a prévia do e-mail funciona normalmente.

## 1) Como o e-mail é enviado

Não usamos SMTP nem servidor de e-mail próprio. A Cloudflare Pages Function
(`/api/admin-email` e `/api/cron-vencimentos`) chama a API de um provedor por HTTPS:

- **Brevo** (recomendado: grátis até 300 e-mails/dia) — variável `BREVO_API_KEY`
- **Resend** (alternativa) — variável `RESEND_API_KEY`

E-mail sai de um endereço verificado no provedor (`EMAIL_REMETENTE`), ex.:
`contato.vloptimizer@gmail.com`. No Brevo dá para verificar um **e-mail** (Gmail)
sem precisar de domínio próprio.

### O que configurar na Cloudflare (Settings → Environment variables)

| Variável | Exemplo | Para quê |
|---|---|---|
| `BREVO_API_KEY` | `xkeysib-...` | chave da API do Brevo (ou `RESEND_API_KEY`) |
| `EMAIL_REMETENTE` | `contato.vloptimizer@gmail.com` | remetente verificado no provedor |
| `EMAIL_NOME` | `VL Optimizer` | nome que aparece no remetente (opcional) |
| `CRON_KEY` | uma senha longa qualquer | protege a URL do cron automático |

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

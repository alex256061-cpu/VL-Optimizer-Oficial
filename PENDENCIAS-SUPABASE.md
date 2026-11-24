# O que ainda falta subir no Supabase (só depende de você)

Tudo aqui já foi testado do lado do código. São **2 tarefas** que precisam da sua conta
no Supabase (eu não tenho acesso ao painel/CLI, só à chave pública e à service_role que
está no projeto).

---

## 1. Telemetria (estatística de FPS/hardware) — 5 minutos

**Hoje:** a função e as tabelas **não existem**. O app enfileira no máximo 500 itens e
descarta; **nada quebra para o cliente** (o consentimento já vem desligado por padrão).

### Passo A — criar as tabelas

1. Abra https://supabase.com/dashboard/project/wsmropvlmnyegpvmyndn/sql/new
2. Cole **todo** o conteúdo deste arquivo:
   `supabase/telemetria-SQL.sql`
3. Clique em **Run**

Isso cria:
- `telemetria_fps`, `telemetria_hardware`, `telemetria_consentimento`, `eventos_plano`
- RLS ligada nas quatro (ninguém lê pelo cliente)

### Passo B — publicar a Edge Function

No seu PC, na pasta do projeto:

```powershell
# 1) instala a CLI (uma vez)
npx supabase --version

# 2) entra na sua conta Supabase
npx supabase login

# 3) liga a pasta do projeto ao projeto remoto
npx supabase link --project-ref wsmropvlmnyegpvmyndn

# 4) manda a service_role como segredo da função (pega em Project Settings → API → service_role)
npx supabase secrets set SB_SERVICE_ROLE_KEY="COLE_A_SERVICE_ROLE_AQUI"

# 5) publica a função
npx supabase functions deploy telemetria --project-ref wsmropvlmnyegpvmyndn
```

### Passo C — conferir

```powershell
curl.exe -i "https://wsmropvlmnyegpvmyndn.supabase.co/functions/v1/telemetria" -X POST -H "Content-Type: application/json" -d "{}"
```
Tem que parar de dar **404 `Requested function was not found`** e passar a responder
alguma coisa (erro de validação é sinal de que a função está no ar).

---

## 2. Teste de compra real (R$ 40) — 10 minutos

**Hoje:** o `/api/pix` gera o PIX de verdade (testado: cobrança R$ 40 criada), mas o
caminho **pagamento → webhook → plano liberado** nunca rodou com dinheiro real.

O que fazer:

1. Abra https://vl-optimizer.pages.dev/baixar e clique em comprar (plano mensal).
2. Pague o PIX (pode ser da sua própria conta).
3. Em até 1 minuto, abra o painel: https://vl-optimizer.pages.dev/admin
   - **Vendas** deve mostrar a venda
   - **Usuários** deve mostrar o e-mail com plano `pro` e vencimento em 30 dias
4. No app, entre com esse e-mail: o plano deve aparecer liberado.

Se a venda aparecer mas o plano **não** liberar, o problema é o `webhook.js` (variável
`SUPABASE_SERVICE` no Cloudflare). Já está configurada, mas o teste confirma.

---

## 3. Já feito por mim (não precisa mexer)

- Sua conta `mluccas218@gmail.com` virou **ADMIN** → o painel abre para você.
- Contas de teste apagadas do banco (as 6 `c5.*@example.com` e as 2 de validação).
  Ficaram só as 3 contas reais: você, Lara e Darkzinn.
- Chaves de teste que eu criei foram apagadas (restaram as 18 que já existiam).
- Sessão do app limpa: ao abrir, ele pede login com a **sua** conta.

---

## 4. Ao abrir o app agora

O app está na **1.4.65** e já existe a **1.4.66** publicada. Na primeira abertura ele
deve mostrar, em ~10 segundos e depois do download, a barra:

> **Versão 1.4.66 pronta para instalar.**  [Reiniciar e atualizar]  [Depois]

Essa barra é justamente a correção da 1.4.65 (antes ela **nunca** aparecia). Se aparecer,
está provado no seu PC. Se não aparecer em 2 minutos, me avise.

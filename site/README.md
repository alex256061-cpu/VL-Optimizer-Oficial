# VL Optimizer — site

Site estático no **Cloudflare Pages**, com Functions para o pagamento.

## Estrutura

```
index.html            landing (planos, recursos, FAQ)
entrar.html           login
criar-conta.html      cadastro
conta.html            minha conta (plano, PCs, sair)
termos.html           termos de uso e privacidade
404.html              página de erro

styles.css            estilo da landing
conta.css             estilo das páginas de conta
app.js                comportamento da landing (preços, menu, FAQ)
checkout.js           botões de compra -> chama /api/comprar
supabase-client.js    login e conta (fala com o Supabase)

functions/api/comprar.js    cria o pagamento no Mercado Pago (chave no servidor)
functions/api/webhook.js    recebe o aviso do MP e libera o plano no Supabase

manifest.webmanifest  ícone e tema
wrangler.toml         configuração do Pages
```

## Banco

Supabase (projeto `VL otimizer`). O esquema está em `../supabase-schema.sql`:

- `profiles` — plano, features, validade, limite de PCs
- `devices` — PCs vinculados a cada conta
- `verificar_pc()` — chamada pelo app no login
- `liberar_plano(email, dias, recursos, pcs)` — chamada pelo webhook

O app desktop fala direto com o Supabase (é ele quem autentica e verifica o PC).

## Pagamento

O site chama `POST /api/comprar` com `{ plano, email }`.

A Function:
1. cria a preferência no Mercado Pago com a chave guardada no servidor
2. devolve o link do checkout (Pix ou cartão em até 12x)
3. o Mercado Pago chama `/api/webhook` quando o pagamento é aprovado
4. o webhook confirma o pagamento na API do MP e chama `liberar_plano()`

Nunca confiamos no corpo do webhook: sempre confirmamos o pagamento na API.

## Variáveis de ambiente (Cloudflare Pages)

| Nome | Para que serve |
|---|---|
| `SITE_URL` | `https://vl-optimizer.pages.dev` |
| `MP_ACCESS_TOKEN` | token do Mercado Pago |
| `SUPABASE_URL` | `https://wsmropvlmnyegpvmyndn.supabase.co` |
| `SUPABASE_SERVICE` | chave service_role do Supabase |

`SUPABASE_SERVICE` e `MP_ACCESS_TOKEN` nunca vão para o navegador: só a Function lê.

## Publicar

Painel do Cloudflare → Workers & Pages → `vl-optimizer` → Create deployment → Upload assets.
Arraste o conteúdo desta pasta (não a pasta em si).

Depois, em Settings → Environment variables, cadastre as quatro variáveis e refaça o deploy.

## Download do aplicativo

Os botões "Baixar" apontam para:

```
https://github.com/alex256061-cpu/VL-Optimizer-Oficial/releases/latest
```

O instalador e o `latest.yml` do auto-update ficam nos releases do GitHub.

# Como publicar o site (Cloudflare Pages)

O projeto do Cloudflare já existe: **`vl-optimizer`** em `vl-optimizer.pages.dev`.
O `wrangler` já está autenticado nesta máquina (conta alex256061@gmail.com).

---

## Publicar (um comando)

```powershell
cd "C:\Users\lucas larado\Desktop\vlotimizeroficial"
.\node_modules\.bin\wrangler.cmd pages deploy site --project-name=vl-optimizer --branch=main
```

Ou pela ferramenta pronta:

```powershell
.\ferramentas\publicar-site.ps1
```

O wrangler sobe os arquivos estáticos **e** as Functions (`site/functions/api/*.js`) juntos.

---

## O que já está publicado

| Endereço | O que é |
|---|---|
| `/` | landing com 3 planos e botões de download |
| `/entrar` | login |
| `/criar-conta` | cadastro |
| `/conta` | minha conta (plano, PCs, sair) |
| `/termos` | termos de uso e privacidade |
| `/api/comprar` | cria o pagamento no Mercado Pago |
| `/api/webhook` | recebe a confirmação e libera o plano |

Verificado em produção:

```
200  /                26.7 KB
200  /entrar           5.7 KB
200  /criar-conta      6.5 KB
200  /conta            5.4 KB
200  /termos           5.3 KB
400  /api/comprar  (plano inválido)  -> validação ok
503  /api/comprar  (plano válido)    -> falta o token do Mercado Pago
200  /api/webhook  (GET)             -> {"ok":true,"servico":"webhook VL Optimizer"}
```

---

## Falta configurar (variáveis de ambiente)

No painel: **Workers & Pages → vl-optimizer → Settings → Environment variables**

| Nome | Valor | Onde pegar |
|---|---|---|
| `SITE_URL` | `https://vl-optimizer.pages.dev` | fixo |
| `MP_ACCESS_TOKEN` | token do Mercado Pago | mercadopago.com.br → Credenciais |
| `SUPABASE_URL` | `https://wsmropvlmnyegpvmyndn.supabase.co` | fixo |
| `SUPABASE_SERVICE` | chave service_role | Supabase → Settings → API |

Sem `MP_ACCESS_TOKEN`, os botões de compra mostram "pagamento ainda não configurado".
Sem `SUPABASE_SERVICE`, o webhook não consegue liberar o plano.

Depois de cadastrar, **refaça o deploy** para as Functions lerem as variáveis.

---

## Atualizações do aplicativo

Nada a fazer no site. O botão "Baixar" aponta para:

```
https://github.com/alex256061-cpu/VL-Optimizer-Oficial/releases/latest
```

Essa URL sempre leva à versão mais nova, e o app instalado se atualiza sozinho pelo
`latest.yml` do release.

---

## Observações do deploy

- O `wrangler.toml` fica na **raiz** do projeto (não em `site/`). Ele tem
  `pages_build_output_dir = "site"` e os cabeçalhos de cache/segurança.
- As rotas sem extensão (`/entrar` → `entrar.html`) funcionam automaticamente no Pages.
- O aviso `Pages now has wrangler.toml support` aparece porque o wrangler foi rodado de dentro
  de `site/`. É só informativo: o deploy foi concluído com sucesso.

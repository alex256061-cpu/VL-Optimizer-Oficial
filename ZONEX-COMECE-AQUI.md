# ZONEX — GUIA DE INSTALAÇÃO (para o revendedor)

Você tem o seu próprio produto: **ZONEX**, com a sua marca, no seu GitHub, no
seu Supabase e no seu Cloudflare. Nada seu aparece no produto do VL, e nada do VL
aparece no seu.

O código é o mesmo (é assim que você recebe todas as correções), mas o que o cliente
vê e onde os dados ficam são 100% seus.

---

## O QUE VOCÊ PRECISA CRIAR (na ordem)

| # | Serviço | Para quê | Custo |
|---|---|---|---|
| 1 | **GitHub** | guardar o código e hospedar o instalador | grátis |
| 2 | **Supabase** | contas, login e planos dos seus clientes | grátis até 500 MB |
| 3 | **Cloudflare Pages** | o site de vendas e a atualização automática | grátis |
| 4 | **Mercado Pago** (ou outro) | cobrar (opcional) | % por venda |

Tempo: cerca de **1 hora** na primeira vez.

---

## PASSO 1 — GITHUB

1. Crie a conta em https://github.com/signup (se ainda não tem)
2. Crie um repositório chamado **ZONEX**, **privado**
3. Anote:
   - seu usuário: `______________________`
   - nome do repositório: `ZONEX`

**Por que privado:** o código é seu. Se alguém pegar, pode copiar o produto.

---

## PASSO 2 — SUPABASE

Este é o banco de dados dos **seus** clientes. Os clientes que você vender ficam aqui,
e não aparecem em lugar nenhum no VL.

1. Crie a conta em https://supabase.com (entre com o GitHub)
2. **New project**:
   - Name: `zonex`
   - Database Password: **guarde** (não é a senha dos clientes, é do banco)
   - Region: `South America (São Paulo)`
3. Espere ~2 minutos o projeto criar
4. Vá em **Project Settings > API** e anote:
   - **Project URL**: `https://____________.supabase.co`
   - **anon public key**: `sb_publishable____________`

   > A chave "anon" pode ficar dentro do app — é assim que o Supabase funciona. O que
   > protege os dados é a **RLS** (regra de segurança no banco), que vem no próximo passo.

5. Vá em **SQL Editor** e rode o script do banco. Ele está em
   `site/supabase/*.sql` no projeto — rode os arquivos na ordem:
   - `01-tabelas.sql` (cria as tabelas)
   - `02-seguranca.sql` (RLS: cada cliente só vê os próprios dados)
   - `03-funcoes.sql` (funções de plano e admin)

   Se o pacote que você recebeu não tiver esses arquivos, peça — eles são obrigatórios.

6. **Authentication > Providers > Email**: deixe ligado
7. **Authentication > URL Configuration**:
   - Site URL: `https://zonex.pages.dev`
   - Redirect URLs: `https://zonex.pages.dev/**`

---

## PASSO 3 — CLOUDFLARE PAGES

Este é o site: a página de vendas, o download e o endereço de atualização do app.

1. Crie a conta em https://dash.cloudflare.com/sign-up
2. **Workers & Pages > Create > Pages > Upload assets**
3. Nome do projeto: **zonex**
4. Vai ficar em `https://zonex.pages.dev`
5. (Opcional) Compre um domínio seu e aponte para cá: `zonexoficial.com.br`

**O site é publicado pelo script** (`publicar.ps1`), então você não precisa subir
arquivo na mão depois da primeira vez.

---

## PASSO 4 — PREENCHER A MARCA

Abra o arquivo `marca/marca-zonex.json` e preencha o que você anotou:

```json
{
  "nome": "ZONEX",
  "nomeCurto": "ZoneX",
  "appId": "com.zonex.app",
  "pasta": "ZONEX",
  "modelo": "Instalar-ZONEX",
  "supabase": {
    "url": "https://SEU-PROJETO.supabase.co",
    "anon": "sb_publishable_SUA-CHAVE"
  },
  "site": "https://zonex.pages.dev",
  "github": { "owner": "SEU-USUARIO", "repo": "ZONEX" },
  "assets": "assets/clientes/zonex",
  "cores": { "principal": "#ff7a00", "secundaria": "#050506" }
}
```

| campo | o que é |
|---|---|
| `nome` | o nome que o cliente vê ("ZONEX") |
| `nomeCurto` | usado no executável e na tarefa (`ZoneX.exe`) |
| `appId` | identificador do instalador — **não repita** o do VL |
| `pasta` | pasta dos dados do cliente (`%APPDATA%\ZONEX`) |
| `modelo` | nome do instalador (`Instalar-ZONEX-1.4.30.exe`) |
| `supabase` | os dois valores do Passo 2 |
| `site` | o endereço do Passo 3 |
| `github` | seu usuário e repositório do Passo 1 |
| `assets` | pasta com as imagens da marca |
| `cores.principal` | a cor do tema (laranja do ZONEX) |

---

## PASSO 5 — IMAGENS

A pasta `assets/clientes/zonex/` precisa de 5 arquivos:

| arquivo | tamanho | o que é |
|---|---|---|
| `icon.png` | 512×512 | ícone do programa e do instalador (só o símbolo) |
| `icon.ico` | 256×256 | ícone do Windows (vários tamanhos) |
| `logo.png` | 512×512 | logo com o nome |
| `logo-branco.png` | 512×512 | logo em branco (fundo escuro) |
| `src-logo.png` | 512×512 | logo da tela de login |

**Já gerei os do ZONEX** a partir da imagem que você mandou. Se quiser trocar depois,
é só substituir os arquivos nessa pasta e rodar o build de novo.

---

## PASSO 6 — GERAR O INSTALADOR

Com tudo preenchido:

```powershell
# 1. prepara o projeto com a sua marca
node gerar-build.js zonex

# 2. builda o instalador
.\node_modules\.bin\electron-builder.cmd --win nsis --x64 --publish never
```

Sai em `release/Instalar-ZONEX-1.4.30.exe`.

**Para voltar ao produto do VL** (se estiver na mesma pasta): `node gerar-build.js vl`

---

## PASSO 7 — PUBLICAR

```powershell
.\publicar.ps1 1.4.30 --marca zonex
```

Esse comando:
1. Gera o build com a marca ZONEX
2. Sobe o release no **seu** GitHub
3. Publica o site no **seu** Cloudflare
4. Copia o instalador para a Área de Trabalho

---

## O QUE É SEU E O QUE É NOSSO

| item | de quem |
|---|---|
| nome, logo, cores | **seu** |
| conta de clientes | **seu** Supabase |
| pagamentos | **sua** conta |
| site e domínio | **seu** Cloudflare |
| instalador e atualização | **seu** GitHub |
| código | **nosso** (você recebe as correções) |

**O cliente do ZONEX nunca vê o VL, e o cliente do VL nunca vê o ZONEX.**
As pastas de dados são separadas (`%APPDATA%\ZONEX` e `%APPDATA%\VL Optimizer`), as
tarefas de administrador são separadas (`ZoneX` e `VLOptimizer`), e os apps podem ficar
instalados no mesmo PC sem conflito.

---

## COMO VOCÊ RECEBE AS CORREÇÕES

Toda vez que o VL publicar uma versão nova:

1. Você recebe o projeto atualizado (pasta ou zip)
2. Copia por cima **só os arquivos do programa** (não a pasta `marca/` nem
   `assets/clientes/`)
3. Roda:

```powershell
node gerar-build.js zonex
.\publicar.ps1 1.4.30 --marca zonex
```

**A sua marca continua igual.** O `gerar-build.js` reaplica tudo a cada build.

---

## DÚVIDAS COMUNS

**Preciso saber programar?**
Não. Os passos acima são cliques em site e preencher um arquivo.

**Meus clientes ficam misturados com os do VL?**
Não. Contas diferentes, bancos diferentes.

**Posso mudar o nome depois?**
Sim. Mude no `marca-zonex.json`, troque as imagens e rode o build de novo.

**E se o Supabase ficar cheio?**
O plano grátis tem 500 MB — dá para milhares de clientes (cada um ocupa poucos KB).

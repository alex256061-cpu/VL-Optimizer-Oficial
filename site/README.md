# Site do VL Optimizer

Landing page de venda — estática, sem build, sem dependência de servidor. Abra `index.html` no navegador ou suba a pasta inteira em qualquer hospedagem.

## Estrutura

```
site/
  index.html          página (hero, recursos, telas, passos, preço, FAQ, CTA, rodapé)
  styles.css          tema vermelho/preto, animações do giroscópio, responsivo
  app.js              preço, checkout, reveal, contadores, abas das telas, toast
  assets/logo.png     marca VL
  assets/icon.png     favicon
  assets/shots/*.png  prints reais do app
  preview/*.png       capturas da própria página (desktop e mobile)
```

## O que editar antes de vender

Tudo o que é comercial fica no topo do `app.js`:

```js
const CONFIG = {
  monthlyPrice: 40,    // plano mensal (R$/mês)
  lifetimePrice: 99,   // licença vitalícia (R$, pagamento único)
  monthlyUrl: '',      // link do checkout do mensal
  lifetimeUrl: '',     // link do checkout do vitalício
  discordUrl: '',      // convite do Discord (https://discord.gg/...)
  currency: 'R$'
};
```

- **Preços**: `monthlyPrice` e `lifetimePrice` atualizam os dois cartões. Se mudar, ajuste também os `price` do JSON-LD no `<head>` do `index.html` (o Google lê de lá).
- **Checkout**: cole os links em `monthlyUrl` e `lifetimeUrl`. Sem link, o botão mostra um aviso em vez de abrir.
- **Discord**: cole o convite em `discordUrl`. Sem link, o botão mostra um aviso.
- **Depoimentos**: a seção atual tem relatos de teste interno (honestos). Substitua por depoimentos reais quando tiver — nunca invente cliente.
- **Nome/contato**: rodapé em `index.html` (`©`, e-mail, CNPJ quando tiver).
- **Imagens**: troque `assets/shots/*.png` mantendo os nomes, ou ajuste os `data-img` das abas.

## Publicar

Qualquer host estático serve:

- **Netlify Drop**: arraste a pasta `site` em app.netlify.com/drop.
- **Vercel**: `vercel deploy site` (ou arraste no painel).
- **GitHub Pages**: suba a pasta em um repositório e ative Pages na branch.
- **Cloudflare Pages**: arraste a pasta no painel.

Domínio: compre `vloptimizer.com.br` (Registro.br) ou `.com` e aponte o DNS para o host.

## O que ainda falta para vender de verdade

1. **Checkout** — criar o produto no provedor (Kirvano/Hotmart/Stripe), copiar o link para `CONFIG.checkoutUrl`.
2. **Entrega** — link de download protegido (o provedor costuma liberar após o pagamento; use área de membros ou link assinado).
3. **Licença/ativação** — o app ainda **não tem** verificação de licença. Para vender com segurança, o próximo passo é gerar chaves e validar no app (ex.: API simples + assinatura).
4. **Nota fiscal / CNPJ** — necessário para operar no Brasil.
5. **Política de privacidade e termos** — páginas simples linkadas no rodapé (o checkout costuma exigir).

## SEO já incluído

- `canonical`, Open Graph e Twitter Card.
- JSON-LD de Produto (2 ofertas) e FAQPage.
- `robots.txt`, `sitemap.xml` e página 404 estilizada.
- Ao trocar o domínio, atualize as URLs em `index.html` (canonical/og/JSON-LD), `robots.txt` e `sitemap.xml`.

## Observações honestas

- **VL Scaling** é um painel para o **Lossless Scaling** (vendido à parte na Steam). O site diz isso no cartão de preço e no FAQ — mantenha, é o correto.
- **OptiScaler** é open-source e não é redistribuído; o app baixa da fonte oficial.
- Os prints são do app real; não use benchmarks inventados na página.

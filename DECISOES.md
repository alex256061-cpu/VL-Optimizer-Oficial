# VL Optimizer — Decisões do projeto

> Documento vivo. Toda decisão tomada aqui tem base no que foi **verificado no GDZ** ou
> escolha explícita sua. Quando algo não tem base, está marcado como "(escolha nossa)".

---

## Visão do produto

O **VL Optimizer** é um otimizador de PC para Windows. Mede o gargalo, aplica ajustes que
podem ser desfeitos e mostra FPS ao vivo. O cliente cria uma conta no site, paga, e o app
libera as otimizações.

**Diferente do GDZ em:** nada. O objetivo é replicar o que já funciona no mercado, com a
nossa interface.

---

## Decisões fechadas

### 1. Login obrigatório ✅
**Base:** o GDZ usa `requireAuth` em 73 pontos do código. Sem sessão válida, o app abre no
`login.html` e nenhuma ação funciona — todas passam pela verificação.

**No nosso:** `main.js` checa `conta.configurado()` e a sessão antes de abrir. Sem sessão,
carrega `src/login.html`. Com sessão, `dashboard.html`.

### 2. Bloqueio por página (não por item) ✅
**Base:** `PAGE_FEATURE` do `src/plano.js` do GDZ.

| Página | Exige plano |
|---|---|
| Painel (dashboard) | `painel` |
| Meus jogos (jogos) | `jogos` |
| Medidor de FPS (fps) | `fps` |
| Gargalo (gargalo) | `gargalo` |
| Verificar hardware (hardware) | `hardware` |
| Informações do PC (pcinfo) | `hardware` |
| Inicialização (inicializacao) | `inicializacao` |
| Sobre (sobre) | `sobre` |

**Livres para todos:** Desempenho, Input Lag, Memória, Limpeza, Live, Tweaks, Scaling.

A conta com feature `*` libera tudo.

### 3. Preços ✅ (escolha nossa)
| Plano | Preço | Libera |
|---|---|---|
| Grátis | R$ 0 | Score de PC, gargalo, lista de travas |
| Mensal | R$ 40,00 / mês | Todas as otimizações |
| Vitalício | R$ 99,00 | Tudo para sempre + continua após formatar |

### 4. Limite de 1 PC por conta ✅
**Base:** o GDZ controla por dispositivo (`reason: 'other_device'`, `pcBound`).

**No nosso:** tabela `devices` no Supabase, função `verificar_pc()`, `max_devices = 1`.

Duas telas, com os textos do GDZ:
- `pcBound: true` → "PC novo: renovar" (formatou/trocou)
- `pcBound: false` → "Plano em outro PC"

### 5. HWID ✅
**Base:** constante `HWID_SCRIPT` recuperada do código do GDZ.

```
ProcessorId (Win32_Processor) + SerialNumber (Win32_BaseBoard) + MachineGuid (registro)
→ concatena, remove espaços → SHA-256 → envia ao servidor
```

Se a leitura falhar: `HWID_FAIL`, e o app não libera.

### 6. Gateway: Mercado Pago ✅ (escolha nossa)
PIX + cartão em até 12x + cupom, como o GDZ oferece.

A chave do gateway fica na **Cloudflare Function**, nunca no navegador — mesmo princípio do
GDZ, que cria o pagamento no servidor (`createServerReference(..., "buy")`).

### 7. Sistema de chaves ✅ (escolha nossa — o GDZ tem `/app/claim`)
- **Login pelo site:** caminho padrão
- **Chave:** atalho para vender no Discord ou para trocar de PC

### 8. Painel administrativo ✅
Mesmos módulos do painel do GDZ (visto na live):
```
Vendas | Licenças | Jogos | Usuários | Chaves | Afiliação
Add-ons | Histórico | Métricas | Métricas novas
```
Com filtros por plano e período, cards de totais e gráficos de hardware
(placa de vídeo, processador, memória).

---

## Infraestrutura

| Onde | O quê | Custo |
|---|---|---|
| **Supabase** | banco, autenticação, perfis, PCs | R$ 0 (Free) |
| **Cloudflare Pages** | site + Functions | R$ 0 |
| **GitHub Releases** | instalador e auto-update | R$ 0 |
| **Mercado Pago** | pagamento | 4,99% por venda |

### Proteções contra cobrança
- Nenhum cartão cadastrado no Supabase
- Spend cap ligado (bloqueia em vez de cobrar)
- Confirm email **desligado** (não gasta o limite de e-mails)
- Tarefa diária `VLOptimizer-KeepSupabaseAlive` impede a pausa por inatividade

---

## Atualização do app

**Dois mecanismos independentes, nenhum trabalho manual no site:**

1. **Download:** o botão aponta para `github.com/.../releases/latest`, que sempre redireciona
   para o release mais novo.
2. **App instalado:** `electron-updater` lê o `latest.yml` publicado em cada release e
   atualiza sozinho.

Publicar = criar o release no GitHub com o `.exe` e o `latest.yml`. Nada mais.

---

## Fases

### Fase 1 — colocar no ar
- [x] Site com login, cadastro e conta
- [x] Botões de download
- [x] Functions de pagamento escritas
- [ ] Publicar no Cloudflare
- [ ] Criar conta no Mercado Pago
- [ ] Configurar variáveis de ambiente
- [ ] Testar pagamento real

### Fase 2 — receber dinheiro
- [ ] Webhook liberando o plano de verdade
- [ ] Teste de PIX aprovado
- [ ] Página de conta mostrando o plano ativo

### Fase 3 — controlar
- [ ] Painel administrativo (métricas, usuários, hardware)
- [ ] Sistema de chaves
- [ ] Histórico de vendas

---

## Estrutura de arquivos

```
vlotimizeroficial/
├── engine.js             28 tweaks, 34 ações, detecção de estado
├── engine-extras.js      hardware, stats, recomendações
├── main.js               janela, IPC, login na abertura
├── preload.js            canais liberados
├── supabase.js           login, sessão, perfil, verificação de PC
├── hwid.js               identificador do PC (método do GDZ)
├── updater.js            auto-update pelo GitHub
├── supabase-schema.sql   tabelas e funções do banco
├── MAPA-DO-PROJETO.md    mapa técnico
├── DECISOES.md           este arquivo
├── src/                  telas do app (login.html, dashboard.html...)
└── site/                 site: landing, entrar, criar-conta, conta, termos
    └── functions/api/    comprar.js, webhook.js
```

---

## Pendências conhecidas

- `suggestions`: nosso lê "ligado", GDZ lê "desligado". Sem evidência do critério dele.
- Processo principal do app ainda gasta mais CPU que o GDZ na abertura.
- Validação em máquina limpa (VM) ainda não feita.

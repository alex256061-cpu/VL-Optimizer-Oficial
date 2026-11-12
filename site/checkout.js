/* checkout.js — botões de compra do site, com o QR do PIX na própria tela.
 *
 * Mesmo fluxo da referência: clicar em comprar mostra "Gerando o Pix..." e o QR aparece no
 * nosso site, sem sair para outra página. O cliente paga lendo o QR ou copiando o código.
 *
 * Passos:
 *   1. POST /api/pix           -> cria o pagamento e devolve o QR
 *   2. desenhar o QR na tela
 *   3. GET /api/pix-status?id= -> a cada 3s, até liberar
 *   4. liberado: mostra "Acesso liberado" e manda para a conta
 */
(function () {
  const PLANOS = { monthly: 'Mensal', lifetime: 'Vitalício', mensal: 'Mensal', vitalicio: 'Vitalício' };

  let modal = null;
  let polling = null;

  function lembrarEmail() {
    try {
      const s = JSON.parse(localStorage.getItem('vl-sessao') || 'null');
      if (s && s.user && s.user.email) return s.user.email;
    } catch (e) { }
    return '';
  }

  function abrirModal() {
    fecharModal();
    const d = document.createElement('div');
    d.id = 'vl-pix';
    d.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(5,3,8,.88);display:grid;place-items:center;backdrop-filter:blur(8px);padding:20px;overflow:auto';
    d.innerHTML = `
      <div style="max-width:420px;width:100%;background:#120b18;border:1px solid rgba(255,31,46,.25);border-radius:18px;padding:26px;text-align:center">
        <div id="vl-pix-corpo">
          <div style="display:flex;align-items:center;justify-content:center;gap:10px;color:#a99fb4;font-size:13.5px;padding:40px 0">
            <span style="width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#ff1f2e;border-radius:50%;display:inline-block;animation:vlgirar .6s linear infinite"></span>
            Gerando o Pix...
          </div>
        </div>
      </div>`;
    document.body.appendChild(d);
    modal = d;

    // fechar ao clicar fora
    d.addEventListener('click', (e) => { if (e.target === d) fecharModal(); });
    return d;
  }

  function fecharModal() {
    if (polling) { clearInterval(polling); polling = null; }
    if (modal) { modal.remove(); modal = null; }
  }

  function desenharQR(pagamento, nomePlano) {
    const corpo = document.getElementById('vl-pix-corpo');
    if (!corpo) return;

    const img = pagamento.qrBase64
      ? '<img src="data:image/png;base64,' + pagamento.qrBase64 + '" alt="QR do Pix" style="width:220px;height:220px;border-radius:12px;background:#fff;padding:10px;margin:0 auto 18px;display:block">'
      : '';

    corpo.innerHTML = `
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#a99fb4;font-weight:800;margin-bottom:6px">Plano ${nomePlano}</div>
      <div style="font-size:26px;font-weight:900;color:#f5f2f7;letter-spacing:-.02em;margin-bottom:16px">
        R$ ${pagamento.valor.toFixed(2).replace('.', ',')}
      </div>
      ${img}
      <div style="font-size:12.5px;color:#a99fb4;margin-bottom:12px">Escaneie o QR com o app do banco, ou copie o código:</div>
      <textarea readonly id="vl-pix-codigo" style="width:100%;box-sizing:border-box;height:64px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:9px;padding:9px;color:#f5f2f7;font-size:11px;font-family:monospace;resize:none">${pagamento.qr}</textarea>
      <button id="vl-pix-copiar" style="width:100%;margin-top:10px;border:0;border-radius:10px;padding:12px;background:linear-gradient(135deg,#ff1f2e,#c00c1a);color:#fff;font-weight:800;font-size:13.5px;cursor:pointer;font-family:inherit">
        Copiar código Pix
      </button>
      <div id="vl-pix-estado" style="font-size:12px;color:#a99fb4;margin-top:14px;display:flex;align-items:center;justify-content:center;gap:8px">
        <span style="width:11px;height:11px;border:2px solid rgba(255,255,255,.28);border-top-color:#ff1f2e;border-radius:50%;display:inline-block;animation:vlgirar .6s linear infinite"></span>
        Aguardando o pagamento...
      </div>
      <button id="vl-pix-fechar" style="width:100%;margin-top:10px;border:0;background:transparent;color:#6f6a82;font-size:12px;cursor:pointer;padding:8px;font-family:inherit">Fechar</button>
    `;

    // copiar
    document.getElementById('vl-pix-copiar').onclick = async () => {
      const b = document.getElementById('vl-pix-copiar');
      try {
        await navigator.clipboard.writeText(pagamento.qr);
        b.textContent = 'Copiado!';
      } catch (e) {
        const ta = document.getElementById('vl-pix-codigo');
        ta.select();
        document.execCommand('copy');
        b.textContent = 'Copiado!';
      }
      setTimeout(() => { b.textContent = 'Copiar código Pix'; }, 2500);
    };

    document.getElementById('vl-pix-fechar').onclick = fecharModal;

    // começa a verificar
    inicioPolling(pagamento.id);
  }

  function inicioPolling(id) {
    let tentativas = 0;
    polling = setInterval(async () => {
      tentativas++;
      if (tentativas > 400) { clearInterval(polling); polling = null; return; } // ~20 min
      try {
        const r = await fetch('/api/pix-status?id=' + id);
        const d = await r.json();
        if (d && d.liberado) {
          clearInterval(polling); polling = null;
          mostrarLiberado(d);
        }
      } catch (e) { }
    }, 3000);
  }

  function mostrarLiberado(d) {
    const corpo = document.getElementById('vl-pix-corpo');
    if (!corpo) return;
    corpo.innerHTML = `
      <div style="width:54px;height:54px;margin:0 auto 16px;border-radius:16px;background:rgba(60,220,130,.14);display:grid;place-items:center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3ddc82" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
      </div>
      <div style="font-size:19px;font-weight:900;color:#f5f2f7;margin-bottom:8px">Pagamento confirmado!</div>
      <div style="font-size:13px;color:#a99fb4;line-height:1.6;margin-bottom:20px">
        Seu acesso${d.dias ? ' de ' + d.dias : ''} está liberado.<br>
        Entre no aplicativo com a mesma conta e abra as otimizações.
      </div>
      <a href="/conta" style="display:block;text-decoration:none;background:linear-gradient(135deg,#ff1f2e,#c00c1a);color:#fff;font-weight:800;font-size:13.5px;padding:13px;border-radius:10px">Ir para a minha conta</a>
    `;
  }

  // ── botões ──
  document.querySelectorAll('[data-buy]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (btn.dataset.carregando === '1') return;

      const plano = btn.dataset.buy;
      const texto = btn.textContent;

      btn.dataset.carregando = '1';
      btn.style.opacity = '0.65';
      btn.style.pointerEvents = 'none';
      btn.textContent = 'Gerando o Pix...';

      abrirModal();

      try {
        const r = await fetch('/api/pix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plano, email: lembrarEmail() }),
        });
        const d = await r.json();

        if (d && d.qr) {
          desenharQR(d, PLANOS[plano] || plano);
        } else {
          fecharModal();
          avisar(d && d.erro ? d.erro : 'Não foi possível gerar o Pix.');
        }
      } catch (err) {
        fecharModal();
        avisar('Sem conexão para gerar o Pix.');
      }

      btn.textContent = texto;
      btn.style.opacity = '';
      btn.style.pointerEvents = '';
      delete btn.dataset.carregando;
    });
  });

  function avisar(msg) {
    if (typeof window.toast === 'function') { window.toast(msg); return; }
    const el = document.getElementById('toast');
    if (el) { el.textContent = msg; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 4500); }
    else alert(msg);
  }

  // animação do spinner
  const st = document.createElement('style');
  st.textContent = '@keyframes vlgirar{to{transform:rotate(360deg)}}';
  document.head.appendChild(st);
})();

/* checkout.js — botões de compra do site.
 *
 * Antes: o app.js só trocava o href por uma URL fixa, e sem URL mostrava "não configurado".
 * Agora: chama a Function /api/comprar, que cria o pagamento no Mercado Pago (com a chave
 * guardada no servidor) e devolve o link do checkout. A pessoa é levada para pagar no PIX
 * ou no cartão.
 *
 * Se a Function ainda não estiver configurada (sem token do Mercado Pago), avisa com um
 * texto claro em vez de dizer "não configurado".
 */
(function () {
  const botoes = document.querySelectorAll('[data-buy]');

  botoes.forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();

      const plano = btn.dataset.buy;
      if (btn.dataset.carregando === '1') return;

      const texto = btn.textContent;
      btn.dataset.carregando = '1';
      btn.style.opacity = '0.65';
      btn.style.pointerEvents = 'none';
      btn.textContent = 'Abrindo o pagamento...';

      // se a pessoa está logada, leva o e-mail junto (facilita liberar a conta)
      let email = '';
      try {
        const s = JSON.parse(localStorage.getItem('vl-sessao') || 'null');
        if (s && s.user && s.user.email) email = s.user.email;
      } catch (err) { }

      try {
        const r = await fetch('/api/comprar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plano, email }),
        });
        const d = await r.json();

        if (d && d.url) {
          // tem link de pagamento: vai para o Mercado Pago
          location.href = d.url;
          return;
        }

        avisar(d && d.erro ? d.erro : 'Pagamento indisponível no momento. Tente pelo Discord.');
      } catch (err) {
        avisar('Sem conexão para abrir o pagamento. Tente de novo.');
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
    if (el) {
      el.textContent = msg;
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 4500);
    } else {
      alert(msg);
    }
  }
})();

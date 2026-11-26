/* senha-olho.js — botão de olho em todo campo de senha do site.
 *
 * Adiciona "mostrar/ocultar senha" sem alterar o HTML de cada página.
 * Funciona com os inputs escondidos/revelados por JS (redefinir.html, por exemplo):
 * a posição é recalculada no foco e no resize.
 */
(function () {
  'use strict';

  var OLHO_ABERTO =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  var OLHO_FECHADO =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a20.3 20.3 0 0 1 5.06-5.94"/>' +
    '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a20.3 20.3 0 0 1-2.16 3.19"/>' +
    '<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';

  function aplicar(inp) {
    if (!inp || inp.dataset.vlOlho === '1') return;
    var pai = inp.parentElement;
    if (!pai) return;

    inp.dataset.vlOlho = '1';
    try {
      if (getComputedStyle(pai).position === 'static') pai.style.position = 'relative';
    } catch (e) { }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vl-olho';
    btn.tabIndex = 0;
    btn.setAttribute('aria-label', 'Mostrar senha');
    btn.title = 'Mostrar senha';
    btn.innerHTML = OLHO_ABERTO;
    btn.style.cssText = [
      'position:absolute', 'background:transparent', 'border:0', 'padding:4px',
      'margin:0', 'cursor:pointer', 'color:inherit', 'opacity:.72',
      'line-height:0', 'z-index:3', 'display:none', 'border-radius:6px',
      'font-family:inherit',
    ].join(';');
    pai.appendChild(btn);

    var visivel = false;
    function posicionar() {
      try {
        var r = inp.getBoundingClientRect();
        var pr = pai.getBoundingClientRect();
        if (!r.height || !pr.height) { btn.style.display = 'none'; return; }
        btn.style.display = 'block';
        var top = (r.top - pr.top) + ((r.height - btn.offsetHeight) / 2);
        var right = Math.max(8, (pr.right - r.right) + 8);
        btn.style.top = Math.round(top) + 'px';
        btn.style.right = Math.round(right) + 'px';
      } catch (e) { }
    }

    function atualizar() {
      inp.type = visivel ? 'text' : 'password';
      btn.innerHTML = visivel ? OLHO_FECHADO : OLHO_ABERTO;
      btn.setAttribute('aria-label', visivel ? 'Ocultar senha' : 'Mostrar senha');
      btn.title = visivel ? 'Ocultar senha' : 'Mostrar senha';
      try {
        var pr = parseInt(getComputedStyle(inp).paddingRight, 10) || 0;
        inp.style.paddingRight = Math.max(pr, 40) + 'px';
      } catch (e) { }
      posicionar();
    }

    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      visivel = !visivel;
      atualizar();
      try { inp.focus({ preventScroll: true }); } catch (err) { inp.focus(); }
    });

    atualizar();
    window.addEventListener('resize', posicionar);
    document.addEventListener('focusin', function (e) { if (e.target === inp) posicionar(); });
    setTimeout(posicionar, 350);
  }

  function iniciar() {
    try {
      Array.prototype.forEach.call(document.querySelectorAll('input[type="password"]'), aplicar);
    } catch (e) { }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();

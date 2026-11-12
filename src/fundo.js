// Fundo do app: a grade vira uma placa de circuito, com trilhas, vias e pulsos de sinal.
// As trilhas nascem nas bordas, seguem as linhas da grade e desviam a 45° pela diagonal dela,
// como numa placa de verdade; nunca se cruzam. O desenho sai de um sorteio com semente fixa:
// para o mesmo tamanho de janela a placa é sempre a mesma.
// Quantos sinais passam acompanha o uso real da CPU (o mesmo número do card de hardware).
// O cursor é uma luz: acende a placa por perto e a borda do card debaixo dele.
(function () {
  const G = 56;          // célula da grade do body::before (--grid-cell)
  const SPEED = 115;     // px por segundo
  const TRAVEL = 0.7;    // parte do ciclo em que o sinal anda; o resto é espera (casa com @keyframes pcbFade)
  const MAX_SIGS = 12;
  const NS = 'http://www.w3.org/2000/svg';

  const layer = document.createElement('div');
  layer.className = 'pcb';
  layer.setAttribute('aria-hidden', 'true');
  document.body.prepend(layer);
  const frames = document.createElement('style');
  document.head.appendChild(frames);

  function prng(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const DIRS = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1], NE: [1, -1], SW: [-1, 1] };
  // Para onde a trilha pode virar depois de cada trecho: quase sempre 45°, às vezes 90°.
  const NEXT = { E: ['NE', 'NE', 'N', 'S'], W: ['SW', 'SW', 'S', 'N'], N: ['NE', 'NE', 'E', 'W'], S: ['SW', 'SW', 'W', 'E'], NE: ['E', 'E', 'N'], SW: ['W', 'W', 'S'] };

  let sigs = [];
  let load = 0.3;
  let last = '';

  function build() {
    const r = layer.getBoundingClientRect();
    if (r.width < 240 || r.height < 160) return;
    // nós da grade que caem dentro da camada (um a mais de cada lado, para a trilha entrar pela borda)
    const kx0 = Math.floor(r.left / G), kx1 = Math.ceil(r.right / G);
    const ky0 = Math.floor(r.top / G), ky1 = Math.ceil(r.bottom / G);
    const sig = [kx0, kx1, ky0, ky1, Math.round(r.left), Math.round(r.top)].join();
    if (sig === last) return;
    last = sig;

    const rnd = prng(0x47445a);
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const used = new Set();
    const key = (x, y) => x + ',' + y;

    // Chips: alguns CIs soltos pela placa (2×2 células), longe um do outro; de cada lado sai uma trilha.
    const cols = kx1 - kx0, rows = ky1 - ky0;
    const chips = [];
    if (cols >= 12 && rows >= 8) {
      const n = Math.min(3, Math.floor((cols * rows) / 110));
      for (let tries = 40; tries > 0 && chips.length < n; tries--) {
        const x = ri(kx0 + 3, kx1 - 5), y = ri(ky0 + 2, ky1 - 4);
        if (chips.some((c) => Math.abs(c.x - x) < 7 && Math.abs(c.y - y) < 5)) continue;
        chips.push({ x, y });
        for (let i = 0; i < 9; i++) used.add(key(x + (i % 3), y + Math.floor(i / 3)));
      }
    }

    // from: ponto de partida já decidido (pino de um chip). Sem ele, a trilha nasce numa borda
    // ou, uma em cada quatro, numa via no meio da placa.
    function route(from) {
      let x, y, d, via = false;
      if (from) ({ x, y, d } = from);
      else {
        const side = rnd();
        if (side < 0.3) { x = kx0; y = ri(ky0 + 1, ky1 - 1); d = 'E'; }
        else if (side < 0.6) { x = kx1; y = ri(ky0 + 1, ky1 - 1); d = 'W'; }
        else if (side < 0.75) { x = ri(kx0 + 1, kx1 - 1); y = ky1; d = 'N'; }
        else { x = ri(kx0 + 2, kx1 - 2); y = ri(ky0 + 1, ky1 - 2); d = 'EWNS'[ri(0, 3)]; via = true; }
        if (used.has(key(x, y))) return null;
      }
      const pts = [[x, y]], mine = new Set([key(x, y)]);
      for (let leg = ri(3, 7); leg > 0; leg--) {
        const [dx, dy] = DIRS[d];
        let moved = 0;
        for (let n = d.length === 2 ? ri(1, 2) : ri(2, 6); n > 0; n--) {
          const nx = x + dx, ny = y + dy, k = key(nx, ny);
          if (nx < kx0 || nx > kx1 || ny < ky0 || ny > ky1 || used.has(k) || mine.has(k)) break;
          x = nx; y = ny; mine.add(k); moved++;
        }
        if (!moved) break;
        pts.push([x, y]);
        d = NEXT[d][Math.floor(rnd() * NEXT[d].length)];
      }
      if (mine.size < (from ? 3 : 5)) return null; // curta demais para parecer trilha
      mine.forEach((k) => used.add(k));
      return { pts, cells: mine.size, bus: !from && rnd() < 0.28, via };
    }

    const routes = [];
    chips.forEach((c) => {
      [{ x: c.x + 2, y: c.y + 1, d: 'E' }, { x: c.x, y: c.y + 1, d: 'W' }, { x: c.x + 1, y: c.y, d: 'N' }, { x: c.x + 1, y: c.y + 2, d: 'S' }]
        .forEach((pin) => { const t = route(pin); if (t) routes.push(t); });
    });
    const want = Math.round((cols * rows) / 12);
    for (let tries = want * 5; tries > 0 && routes.length < want; tries--) {
      const t = route();
      if (t) routes.push(t);
    }

    const px = ([x, y]) => [x * G - r.left + 0.5, y * G - r.top + 0.5];
    const d = (t) => t.pts.map(px).map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('');
    const singles = routes.filter((t) => !t.bus).map(d).join('');
    const buses = routes.filter((t) => t.bus).map(d).join('');
    const inside = ([x, y]) => x > 4 && y > 4 && x < r.width - 4 && y < r.height - 4;
    const ends = routes.flatMap((t) => [{ p: px(t.pts[t.pts.length - 1]), bus: t.bus }, ...(t.via ? [{ p: px(t.pts[0]), bus: t.bus }] : [])]).filter((e) => inside(e.p));

    // Chip: corpo, cinco pinos por lado (o do meio é onde a trilha encosta), o miolo e a marca do pino 1.
    const C = 12, body = 2 * G - 2 * C; // o corpo fica 12 px para dentro dos nós
    const chipSvg = chips.map((c) => {
      const [x, y] = px([c.x, c.y]);
      const bx = x + C, by = y + C;
      let pins = '';
      for (let i = 0; i < 5; i++) {
        const o = C + 4 + i * 20; // 16, 36, 56 (o nó), 76, 96 a partir do canto
        pins += `M${x + o} ${y}v${C}M${x + o} ${by + body}v${C}M${x} ${y + o}h${C}M${bx + body} ${y + o}h${C}`;
      }
      return `<path class="pcb-pin" d="${pins}"/><rect class="pcb-chip" x="${bx}" y="${by}" width="${body}" height="${body}" rx="7"/>` +
        `<rect class="pcb-die" x="${bx + 22}" y="${by + 22}" width="${body - 44}" height="${body - 44}" rx="3"/>` +
        `<circle class="pcb-dot" cx="${bx + 11}" cy="${by + 11}" r="2"/>`;
    }).join('');

    // Barramento: três linhas paralelas que dobram juntas. Sai de uma máscara (traço largo,
    // menos o miolo, mais o fio do centro) em vez de calcular três caminhos deslocados.
    const art = (maskId) =>
      `<defs><mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${r.width}" height="${r.height}" fill="none">` +
      `<path d="${buses}" stroke="#fff" stroke-width="13.5"/><path d="${buses}" stroke="#000" stroke-width="11"/><path d="${buses}" stroke="#fff" stroke-width="1.25"/></mask></defs>` +
      `<rect class="pcb-bus" width="${r.width}" height="${r.height}" mask="url(#${maskId})"/>` +
      `<path class="pcb-trace" d="${singles}"/>` + chipSvg +
      ends.map((e) => e.bus
        ? `<circle class="pcb-via" cx="${e.p[0]}" cy="${e.p[1]}" r="8"/><circle class="pcb-dot" cx="${e.p[0]}" cy="${e.p[1]}" r="2.4"/>`
        : `<circle class="pcb-via" cx="${e.p[0]}" cy="${e.p[1]}" r="3.4"/>`).join('');
    const svg = document.createElementNS(NS, 'svg');
    svg.innerHTML = art('pcb-bus-mask');
    // A mesma placa, acesa: só aparece dentro da luz do cursor.
    const lit = document.createElementNS(NS, 'svg');
    lit.innerHTML = art('pcb-bus-mask-lit');
    litBox.style.width = r.width + 'px';
    litBox.style.height = r.height + 'px';
    litBox.replaceChildren(lit);
    origin = [r.left, r.top];

    // Sinais: nas trilhas mais compridas, metade indo da borda para a via e metade voltando.
    let css = '';
    sigs = routes.filter((t) => t.cells >= 7).sort((a, b) => b.cells - a.cells).slice(0, MAX_SIGS).map((t, i) => {
      const P = t.pts.map(px);
      if (rnd() < 0.5) P.reverse();
      const lens = P.slice(1).map((p, j) => Math.hypot(p[0] - P[j][0], p[1] - P[j][1]));
      const total = lens.reduce((a, b) => a + b, 0);
      let acc = 0, ang = 0;
      css += `@keyframes pcbK${i}{`;
      lens.forEach((len, j) => {
        ang = Math.round(Math.atan2(P[j + 1][1] - P[j][1], P[j + 1][0] - P[j][0]) * 180 / Math.PI);
        const from = (acc / total) * TRAVEL * 100;
        acc += len;
        const to = (acc / total) * TRAVEL * 100 - 0.002;
        css += `${from.toFixed(3)}%{transform:translate(${P[j][0]}px,${P[j][1]}px) rotate(${ang}deg)}`;
        css += `${to.toFixed(3)}%{transform:translate(${P[j + 1][0]}px,${P[j + 1][1]}px) rotate(${ang}deg)}`;
      });
      const end = P[P.length - 1];
      css += `100%{transform:translate(${end[0]}px,${end[1]}px) rotate(${ang}deg)}}`;

      const dur = (total / SPEED / TRAVEL).toFixed(2);
      const delay = (-rnd() * dur).toFixed(2);
      const el = document.createElement('i');
      el.className = 'pcb-sig';
      el.style.setProperty('--c', `var(--pcb-sig${i % 3 === 0 ? 1 : 2})`);
      const head = document.createElement('b');
      head.style.animation = `pcbK${i} ${dur}s linear ${delay}s infinite, pcbFade ${dur}s linear ${delay}s infinite`;
      el.appendChild(head);
      return el;
    });
    // espalha: sem isso os sinais que somem com a CPU ociosa seriam sempre os das trilhas curtas
    sigs.sort(() => rnd() - 0.5);
    frames.textContent = css;
    layer.replaceChildren(svg, lamp, ...sigs);
    applyLoad();
  }

  // ── Luz do cursor ──
  // Uma lanterna sobre a placa: perto do mouse as trilhas, vias e chips acendem, e a borda do
  // card debaixo dele pega o brilho no ponto onde o cursor está.
  // A lanterna é uma janela redonda que anda com o mouse; dentro dela a placa acesa anda o mesmo
  // tanto para o lado contrário, então fica parada no lugar certo. Os dois são só transform, com
  // a mesma transição: seguem o mouse com um atraso suave sem repintar nada.
  const R = 230; // raio da lanterna (metade do .pcb-lamp)
  const CARDS = '.dh-hero, .dh-hw, .op-cat, .icard, .acard, .auto-card, .game-card, .hw-card, .bn-hero, .hw-summary, .team-card, .input-device-card, .app-slot, .tw-list, .mt-card, .auth-card, .counter-card';
  const lamp = document.createElement('div');
  lamp.className = 'pcb-lamp';
  const litBox = document.createElement('div');
  litBox.className = 'pcb-lit';
  lamp.appendChild(litBox);
  // O contorno aceso fica numa camada própria por cima do app, recortada na área das páginas:
  // serve para qualquer card, sem depender de pseudo-elemento de cada um.
  const clip = document.createElement('div');
  clip.className = 'cur-clip';
  clip.setAttribute('aria-hidden', 'true');
  const ring = document.createElement('div');
  ring.className = 'cur-ring';
  clip.appendChild(ring);
  document.body.appendChild(clip);

  // Giroscópios marcados com data-follow olham para o cursor de qualquer ponto da tela (o do login).
  // O do Painel só reage dentro do card dele, e quem cuida disso é o dash-v3.js.
  const followers = [...document.querySelectorAll('.gy[data-follow]')];
  const clamp = (v) => Math.max(-1, Math.min(1, v));

  let origin = [72, 108], mouse = null, card = null, raf = 0;
  function setCard(c) {
    card = c;
    ring.classList.toggle('on', !!c);
    if (c) ring.style.borderRadius = getComputedStyle(c).borderRadius;
  }
  function light() {
    raf = 0;
    if (!mouse) return;
    const x = mouse[0] - origin[0], y = mouse[1] - origin[1];
    const entering = !lamp.classList.contains('on');
    if (entering) lamp.classList.add('jump'); // aparece já no lugar, em vez de deslizar de onde estava
    lamp.style.transform = `translate(${x}px,${y}px)`;
    litBox.style.transform = `translate(${R - x}px,${R - y}px)`;
    if (entering) { lamp.getBoundingClientRect(); lamp.classList.remove('jump'); lamp.classList.add('on'); }
    followers.forEach((g) => {
      const b = g.getBoundingClientRect();
      g.style.setProperty('--gy-x', clamp((mouse[0] - (b.left + b.width / 2)) / 480).toFixed(3));
      g.style.setProperty('--gy-y', clamp((mouse[1] - (b.top + b.height / 2)) / 480).toFixed(3));
    });
    if (card && !card.isConnected) setCard(null);
    if (card) {
      const c = card.getBoundingClientRect();
      ring.style.width = c.width + 'px';
      ring.style.height = c.height + 'px';
      ring.style.transform = `translate(${c.left - origin[0]}px,${c.top - origin[1]}px)`;
      ring.style.setProperty('--x', (mouse[0] - c.left) + 'px');
      ring.style.setProperty('--y', (mouse[1] - c.top) + 'px');
    }
  }
  document.addEventListener('pointermove', (e) => {
    if (fxOff()) return;
    mouse = [e.clientX, e.clientY];
    const c = e.target.closest ? e.target.closest(CARDS) : null;
    if (c !== card) setCard(c);
    if (!raf) raf = requestAnimationFrame(light);
  }, { passive: true });
  // rolando a página sem mexer o mouse, o contorno acompanha o card
  document.addEventListener('scroll', () => { if (card && !raf) raf = requestAnimationFrame(light); }, { capture: true, passive: true });
  const dark = () => {
    mouse = null;
    lamp.classList.remove('on');
    setCard(null);
    followers.forEach((g) => { g.style.removeProperty('--gy-x'); g.style.removeProperty('--gy-y'); });
  };
  document.documentElement.addEventListener('pointerleave', dark);
  window.addEventListener('blur', dark);

  // ── Efeitos visuais (interruptor em Sobre) ──
  // Desligado = data-fx="off" no <html>: o CSS para o giroscópio e some com os sinais e a luz do
  // cursor; fica só a placa desenhada. O valor é lido de novo no <head> de cada tela, antes de desenhar.
  function fxOff() { return document.documentElement.dataset.fx === 'off'; }
  function paintFx() {
    const t = document.getElementById('fx-toggle');
    if (!t) return;
    t.classList.toggle('on', !fxOff());
    t.setAttribute('aria-checked', String(!fxOff()));
  }
  window.gdzFx = {
    off: fxOff,
    toggle() {
      const off = !fxOff();
      if (off) document.documentElement.dataset.fx = 'off'; else delete document.documentElement.dataset.fx;
      try { localStorage.setItem('gdz-efeitos', off ? 'off' : 'on'); } catch (e) {}
      if (off) dark();
      paintFx();
    },
  };
  paintFx();
  document.getElementById('fx-toggle')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.gdzFx.toggle(); }
  });

  // CPU ociosa: um quarto dos sinais. CPU no talo: todos.
  function applyLoad() {
    const on = Math.max(2, Math.round(sigs.length * (0.25 + 0.75 * load)));
    sigs.forEach((s, i) => s.classList.toggle('off', i >= on));
  }
  const cpu = document.getElementById('cpu-v'); // atualizado pelo updateStats a cada 2,5 s
  if (cpu) {
    new MutationObserver(() => {
      const v = Number(cpu.textContent);
      if (!Number.isFinite(v)) return;
      load = load * 0.5 + Math.max(0, Math.min(1, v / 100)) * 0.5; // suaviza os picos
      applyLoad();
    }).observe(cpu, { childList: true, characterData: true, subtree: true });
  }

  // Janela sem foco ou escondida (jogando, por exemplo): os sinais e o giroscópio congelam e não usam GPU.
  const pause = () => {
    const stop = document.hidden || !document.hasFocus();
    layer.classList.toggle('paused', stop);
    document.body.classList.toggle('gy-paused', stop);
  };
  window.addEventListener('focus', pause);
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', pause);
  pause();

  let timer = 0;
  new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(build, 250); }).observe(layer);
  build();
})();

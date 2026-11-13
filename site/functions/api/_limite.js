/**
 * functions/api/_limite.js — limite simples de requisições por IP.
 *
 * A criação de PIX não tinha limite: qualquer script podia gerar milhares de pagamentos
 * (o Mercado Pago penaliza isso) e varrer o /api/pix-status.
 *
 * Aqui guardamos o contador na memória da Function. É limitado por instância — não é um
 * limite distribuído — mas já trava o abuso trivial. Para proteger de verdade em escala,
 * a mesma ideia pode usar KV ou Durable Objects.
 */

const janelas = new Map();

/**
 * @param chave identificador (ex.: "pix:" + IP)
 * @param max   máximo de chamadas na janela
 * @param ms    tamanho da janela em milissegundos
 * @returns {null} se liberado, ou {erro} se bloqueado
 */
export function limite(chave, max, ms) {
  const agora = Date.now();
  const reg = janelas.get(chave);

  if (!reg || agora > reg.fim) {
    janelas.set(chave, { n: 1, fim: agora + ms });
    // limpeza ocasional para não crescer sem limite
    if (janelas.size > 5000) {
      for (const [k, v] of janelas) if (agora > v.fim) janelas.delete(k);
    }
    return null;
  }

  reg.n++;
  if (reg.n > max) {
    return { erro: 'Muitas tentativas. Espere alguns minutos antes de tentar de novo.', restante: Math.ceil((reg.fim - agora) / 1000) };
  }
  return null;
}

/** IP do cliente, como o Cloudflare entrega. */
export function ipDe(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'sem-ip';
}

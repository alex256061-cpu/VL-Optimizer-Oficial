// ══════════════════════════════════════════════════════════════════════════
// O que mudou em cada versão.
//
// O dono pediu: o botão de atualizar mostra o que chega de novidade, e se a versão for
// só correção de bug, o texto diz apenas isso — sem inventar recurso novo.
//
// A lista é mantida à mão, com os títulos vindos da mensagem de commit de cada versão.
// A tela mostra em blocos: "Corrigido" e "Novo". Quando não há item em "Novo", o resumo
// é "Apenas correções".
// ══════════════════════════════════════════════════════════════════════════

const NOTAS = {
  '1.4.18': {
    corrigido: [],
    novo: [
      'Quando sai versão nova, o programa avisa na tela sem você precisar abrir a página Sobre. O aviso leva direto para o cartão de atualização.',
    ],
  },
  '1.4.17': {
    corrigido: [
      'O botão "Ver no site" mandava o cliente para o GitHub. Agora abre a página de download do próprio VL Optimizer, no site.',
      'O cartão de atualização não conseguia ler o texto do que mudou: o arquivo das notas não ia dentro do pacote. Corrigido.',
    ],
    novo: [
      'O download do instalador e das atualizações agora sai todo do site do VL Optimizer. O cliente não vê mais o GitHub em lugar nenhum.',
      'Página de download própria, com a versão mais recente, o tamanho do arquivo e o passo a passo da instalação.',
    ],
  },
  '1.4.16': {
    corrigido: [],
    novo: [
      'Botão de atualizar dentro do programa, com a versão instalada, o que mudou em cada versão e o download em segundo plano. Nada é instalado sem você clicar.',
    ],
  },
  '1.4.15': {
    corrigido: [
      'Medidor de gargalo ficava procurando o jogo para sempre. A tela procurava um campo que não existia na resposta, então o jogo era descartado a cada 3 segundos, até o limite de 10 minutos. Agora escolhe o jogo e segue.',
      'Overlay de FPS: marcar uma opção desmarcava as outras. Agora as escolhas se somam.',
      'O contador não subia depois de otimizar. Os ajustes eram aplicados, mas a verificação de oito deles rodava num script que o Windows recusava e todos voltavam como desligados.',
    ],
    novo: [],
  },
  '1.4.14': {
    corrigido: [
      'O pedido de abrir a versão de administrador não depende mais do Windows Script Host.',
      'O botão "Reabrir como admin" não responde mais sucesso quando falha.',
      'O programa recupera sozinho a tarefa de administrador se ela for apagada.',
    ],
    novo: [],
  },
  '1.4.13': {
    corrigido: [
      'O programa abre sozinho como administrador quando você entra no Windows, igual ao GDZ.',
      'O instalador cria a tarefa de administrador de verdade. Antes a criação falhava em silêncio numa instalação limpa.',
    ],
    novo: [],
  },
};

function notasDe(versao) {
  return NOTAS[String(versao || '')] || null;
}

// Resumo curto para o cabeçalho.
function resumoDe(notas) {
  if (!notas) return 'Veja a página da versão para saber o que mudou.';
  const c = (notas.corrigido || []).length;
  const n = (notas.novo || []).length;
  if (!c && n) return n === 1 ? 'Novidade: 1 recurso' : 'Novidades: ' + n + ' recursos';
  if (!n) return c === 1 ? 'Apenas correções: 1 ajuste' : 'Apenas correções: ' + c + ' ajustes';
  return c + (c === 1 ? ' correção' : ' correções') + ' e ' + n + (n === 1 ? ' novidade' : ' novidades');
}

module.exports = { NOTAS, notasDe, resumoDe };

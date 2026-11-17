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
  '1.4.42': {
    corrigido: [
      'A configuracao do otimizador de graficos agora tem as 33 opcoes do programa de referencia. Antes faltavam 12: mostrar FPS na tela, prender e esconder o cursor, velocidade do cursor, suporte a G-Sync, modo de varias telas, abrir como administrador, iniciar com o Windows, minimizar e fechar para a bandeja, e a nitidez do LS1.',
      'Os valores numericos passaram a ser limitados ao intervalo que o programa aceita. Antes o app gravava qualquer numero que chegasse: nitidez 40 (o maximo e 10), escala 9 (o maximo e 4) e alvo de quadros 9999 (o maximo e 480).',
      'A escala agora aceita duas casas decimais (1.57), como o programa de referencia.',
      'Se o programa de graficos considerar a configuracao anterior invalida, o app devolve o arquivo original em vez de continuar gravando por cima.',
    ],
    novo: [],
  },
  '1.4.41': {
    corrigido: [
      'Ajuste nos textos da tela de novidades.',
    ],
    novo: [],
  },
  '1.4.40': {
    corrigido: [
      'A analise de jogo para o otimizador de graficos (OptiScaler) ficou mais precisa: o aviso de jogo online usa a lista de nomes de anti-cheat do programa de referencia em vez de procurar pedaco de palavra, e por isso nao acusa mais jogo normal por engano.',
      'Agora o app reconhece os upscalers ja presentes na pasta do jogo (DLSS, FSR, XeSS) pela lista real de arquivos, e nao por aproximacao.',
      'Crimson Desert: o app avisa que o jogo fecha ao abrir com a troca de placa de video simulada ligada, e deixa essa opcao desligada nele.',
      'Os textos do atualizador automatico estavam com a acentuacao corrompida. Corrigidos.',
    ],
    novo: [],
  },
  '1.4.39': {
    corrigido: [
      'Sair da conta agora encerra a sessao no servidor. Antes o app so apagava o arquivo do PC, e o acesso copiado do disco continuava valendo para sempre.',
      'O login nao fica mais preso para sempre quando o servidor aceita a conexao e nao responde: depois de 12 segundos aparece a mensagem "O servidor demorou demais para responder".',
      'A criacao de conta agora exige a marcacao dos termos de uso tambem no programa, nao so na tela.',
      'O aviso de saida dizia "o servidor nao confirmou" mesmo com internet boa, porque o app mandava o tipo errado de token. Corrigido.',
      'A tela do usuario recebia dois campos que nao existem no servidor (identificador do aparelho e PC preso) e mostrava valores inventados. Removidos.',
    ],
    novo: [],
  },
  '1.4.38': {
    corrigido: [
      'As 5 ferramentas de reparo agora fazem o que precisam fazer: "Limpar cache de DNS" limpa de fato (antes so limpava o cache do servidor de DNS e nao o do Windows), "Resetar a rede" tambem limpa o DNS, e as duas de DISM mostram quantos GB foram liberados e avisam quando o comando falha.',
      'Cada ferramenta tem o seu proprio tempo limite. Antes, uma ferramenta travada podia deixar a tela esperando 1 hora, e o "Limpar DNS" (que leva menos de 1 segundo) tinha o mesmo teto de um reparo completo do Windows.',
      'O ponto de restauracao agora explica o motivo real quando o Windows recusa: se a Protecao do Sistema estiver desligada no disco, a mensagem diz isso em vez de mandar reiniciar como administrador.',
      'A leitura do identificador do PC agora tenta 3 vezes, com 2 segundos de espera, igual ao programa de referencia. Antes, uma resposta vazia do Windows logo apos ligar o PC fazia o login falhar e o cliente nao tinha o que fazer.',
    ],
    novo: [],
  },
  '1.4.37': {
    corrigido: [
      'As verificacoes de hardware voltaram a dizer a verdade. Os scripts internos estavam em um formato que fazia o Windows receber os caminhos de registro sem a barra invetida (HKLM:SOFTWARE em vez de HKLM:\SOFTWARE). O resultado: a verificacao respondia "HAGS desligado" num PC com o HAGS ligado, e nunca detectava o aviso de BIOS nos processadores Intel. Afetava tambem 6 ajustes antigos (Game Bar, OBS, memoria do sistema, restauracao, escala da tela).',
      'Os 5 checks agora confirmam de verdade: placa de video lista todas as placas e confere o Resizable BAR; memoria mostra a geracao (DDR4/DDR5), a velocidade do kit e avisa quando tem um pente so; AMD lista os dispositivos do driver de chipset e so cobra a configuracao especial nos X3D de dois chips; Intel compara o microcode com as versoes que corrigem a degradacao.',
      'FiveM: o preset era aplicado em 4 campos em vez de 18, e podia estar gravando em um arquivo que nao e o de graficos do jogo. Agora usa o caminho certo (%APPDATA%\CitizenFX\gta5_settings.xml), aplica os 18 campos do preset de FPS e os 16 do equilibrado, grava de forma atomica e preserva a pasta cache/game.',
      'FiveM: o SamplingMode gravava 5 em 83% dos casos por causa de um deslocamento na lista. Corrigido para 0-4-3-2-1.',
      'FiveM: o preset reportava sucesso sem gravar nada, porque duas funcoes internas com o mesmo nome se sobrescreviam. Renomeadas.',
      'Scaling: a opcao de sincronizacao da tela gravava sempre o mesmo valor, entao escolher V-Sync, G-Sync ou Adaptativo nao mudava nada no Lossless. Agora cada opcao grava o valor correspondente (Default, Vsync1, Vsync2, Vsync3).',
      'Scaling: o editor nao cria mais campos que o Lossless nao conhece. Era um dos motivos de ele considerar o arquivo invalido e guardar uma copia com erro.',
    ],
    novo: [],
  },
  '1.4.36': {
    corrigido: [
      'O ponto de restauração falhava sem avisar: o Windows aceita só um ponto a cada 24 horas, então o segundo pedido do dia não criava nada e o app respondia que tinha dado certo. Agora ele libera esse limite durante a criação, volta como estava e mostra o erro quando não consegue.',
      'A verificação do processador Intel dizia sempre que estava tudo certo, sem comparar nada. Agora confere a versão do microcode (as correções de degradação dos Core de 13ª e 14ª geração), os requisitos do Core Ultra 200S e o Modo de Jogo.',
      'A verificação da placa de vídeo olhava a primeira placa do computador — num notebook ou num PC com gráfico integrado essa é a integrada. Agora olha só as placas de verdade e confere o Resizable BAR.',
      'A verificação da memória não detectava canal único nem a geração DDR. Agora mostra os pentes, a velocidade do kit e avisa quando um pente só está custando FPS.',
      'A verificação do Ryzen avisava "driver de chipset ausente" em qualquer Ryzen que não fosse X3D. Agora procura o driver pelos dispositivos e só cobra a configuração especial nos X3D de dois chips.',
      'A pergunta sobre enviar os dados de FPS nunca aparecia: o app respondia que você já tinha aceitado. Agora pergunta uma vez, guarda a resposta e mostra o aviso de privacidade.',
      'Quem entrava com internet instável caía na tela de login sem explicação. Agora a tela diz o motivo.',
      'O medidor de gargalo media mesmo com o jogo minimizado, o que estragava a média. Agora pausa quando você sai da janela do jogo e usa a mesma faixa de tempo do programa de referência.',
    ],
    novo: [],
  },
  '1.4.35': {
    corrigido: [
      'O plano vitalicio funcionava em qualquer PC: bastava copiar o arquivo de sessao. Agora o app recusa a sessao quando o servidor diz que o plano esta em outro PC ou vencido.',
      'Cliente que voltava o relogio do Windows usava licenca vencida. Agora o app guarda o maior horario ja visto e recusa se o relogio voltar mais de 10 minutos.',
      'Sem internet o app caia na tela de login. Agora a licenca vale offline por ate 7 dias depois da ultima verificacao.',
      'A sessao era guardada em texto puro. Agora vai cifrada com a protecao do Windows.',
      'A tela continuava liberando o plano mesmo quando o servidor negava.',
      'O painel de temperatura e clock relancava um PowerShell a cada 2 segundos. Agora e um coletor so, com leitura instantanea e parada automatica quando ninguem esta olhando.',
      'Valorant e League of Legends nao apareciam na lista de jogos. Agora aparecem, lidos da instalacao do Riot Client.',
      'Capa dos jogos: usa a imagem do Steam na ordem do programa de referencia.',
      'A lista de jogos nao dizia quais estavam rodando.',
      'A atualizacao agora pode ser conferida com uma assinatura separada do arquivo. Sem isso, quem trocasse o instalador e o manifesto juntos passaria na conferencia.',
    ],
    novo: [],
  },
  '1.4.34': {
    corrigido: [
      'A versao 1.4.33 podia nao abrir no PC do cliente: dois arquivos novos do motor de limpeza e do desfazer nao entraram no pacote, e o programa procurava por eles ao iniciar. Agora entram.',
    ],
    novo: [],
  },
  '1.4.33': {
    corrigido: [
      'O medidor de FPS nao media nada. A lista de programas era montada de uma variavel que nunca existia, e a tela ficava sem dado. Agora le a saida do PresentMon como o programa de referencia.',
      'O medidor de FPS nunca subiria no app instalado: o caminho do PresentMon apontava para dentro do arquivo do app (.asar), que nao existe no disco. Funcionava so no modo de desenvolvimento.',
      'O botao de ligar e desligar da aba Inicializacao nao fazia nada: a funcao que ele chama nunca foi escrita. Agora desativa e ativa pelo StartupApproved, sem nunca apagar a entrada do registro.',
      'As travas de hardware eram so etiqueta de tela: o motor aplicava de qualquer jeito. Agora o motor recusa de verdade, com a mensagem do programa de referencia, e a tela pinta o botao bloqueado.',
      'A trava de Windows 11 recusava em qualquer Windows, inclusive no 11.',
      'O aviso de Ryzen X3D de dois CCDs nao existia no caminho das acoes: as 4 acoes que brigam com ele rodavam livres e derrubavam a configuracao do 7950X3D.',
      'As acoes agora sao recusadas pelo mesmo mapa de bloqueio que os ajustes.',
      'Modo automatico: OneDrive, Dropbox e Google Drive eram fechados e nunca mais abriam.',
      'Modo automatico: a prioridade dos programas ficava rebaixada para sempre depois que o jogo fechava.',
      'Modo automatico: desligar a chave com o jogo aberto nao desfazia nada.',
      'Modo automatico: o plano de energia salvo podia ser o errado.',
      'A limpeza de disco tinha 11 categorias, duas delas que o programa de referencia nao tem. Agora sao as 16 dele, na mesma ordem.',
      'A trava de programa aberto da limpeza nunca funcionava para Discord e Steam (comparava o nome em minusculas num conjunto que tinha maiusculas).',
      'A lista de programas nao achava o desinstalador quando o caminho tinha espaco (C:\\Program Files\\... virava C:\\Program). O tamanho tambem estava errado em dois tercos.',
      'O desfazer agora guarda e devolve tambem servico, plano de energia, configuracao do plano, item do boot, ajuste de TCP e DNS de cada placa. Antes so guardava chave de registro: um ajuste de servico ou de energia ficava aplicado sem caminho de volta.',
      'O overlay de FPS inteiro caia quando o frametime vinha como numero inteiro.',
    ],
    novo: [
      'Salva e restaura o estado do Windows em 8 tipos de item antes de aplicar qualquer ajuste, do mesmo jeito que o programa de referencia.',
    ],
  },
  '1.4.32': {
    corrigido: [
      'Ajuste de memoria virtual: ele gravava um valor invalido na chave PagingFiles e o Windows deixava de criar o arquivo de paginacao. Sem ele o PC trava e programas fecham sozinhos. Agora o ajuste liga o gerenciamento automatico do Windows, do mesmo jeito que o programa de referencia.',
      'Tema escuro voltou ao catalogo. Ele e um ajuste legitimo do programa de referencia e havia sido removido por engano.',
      'Removido o indicador de DLSS na tela: nao existe no programa de referencia.',
    ],
    novo: [],
  },
  '1.4.31': {
    corrigido: [
      'Removido o ajuste de resolução de tela (720p). Ele escrevia os dados de vídeo no formato errado e podia deixar a tela preta em notebooks.',
      'Removidos dois ajustes de aparência que o programa não deveria mexer: o modo escuro e os efeitos visuais do Windows. O Windows ignora a chave dos efeitos, então o ajuste não fazia efeito e o desfazer apagava a configuração que você tinha.',
      'A Otimização Rápida agora pede confirmação antes de aplicar e usa o plano de energia do Windows pelo nome. Em notebook na bateria usa o Equilibrado, para não esquentar.',
      'A impressora não é mais desligada. O serviço de impressão saiu da lista.',
      'Ajustes de rede agora mexem só na placa de rede física. Antes podiam mexer na VPN e derrubar a conexão.',
      'Reiniciar a barra de tarefas agora afeta só a sua sessão, não a de outros usuários do PC.',
      'Ajustes que exigem um hardware específico (RTX, Windows 11) passam a ser recusados com uma explicação, em vez de serem aplicados sem efeito.',
      'Guarda uma cópia do estado do Windows antes de aplicar qualquer ajuste. Se não conseguir ler o estado, não aplica nada.',
    ],
    novo: [],
  },
  '1.4.30': {
    corrigido: [
      'Modo de Jogo: o Windows já vem com ele ligado, mas o programa mostrava desligado. Clicar em ligar parecia não fazer efeito, e desligar deixava o Windows ligado mesmo. Agora mostra o estado certo e desliga de verdade.',
      'Aceleração do mouse: o ajuste era aplicado e o ponteiro realmente mudava, mas o programa dizia desligado segundos depois. Agora mantém ligado.',
    ],
    novo: [],
  },
  '1.4.29': {
    corrigido: [
      'Aceleração do mouse e Modo de Jogo ligavam e voltavam sozinhos em poucos segundos. O problema era no programa que lê o estado dos ajustes: a leitura de um ajuste de rede dava erro e derrubava a leitura dos outros.',
      'A leitura dos ajustes agora é feita uma por uma: se uma falhar, as outras continuam certas.',
    ],
    novo: [],
  },
  '1.4.28': {
    corrigido: [
      'Contador do Painel: o programa contava como aplicado o que o Windows já trazia assim de fábrica. Agora só entra na conta o que o próprio programa alterou.',
      'Ajustes que precisam de administrador aparecem como bloqueados, com o botão Reabrir como admin, em vez de aparecer ligados sem ter mudado nada.',
      'Limpeza do Windows (DISM) e reparos não mostram mais concluído quando o Windows recusou por falta de administrador.',
      'Desfazer não fica mais travado depois de uma aplicação que falhou.',
      'A faixa de modo limitado agora explica o que de fato precisa de administrador e deixa de cobrir o conteúdo da tela.',
      'Nenhuma mensagem técnica do Windows aparece na tela: o programa explica em português o que aconteceu.',
    ],
    novo: [],
  },
  '1.4.27': {
    corrigido: [
      'Ajustes que precisam de administrador agora avisam e não fingem que foram aplicados.',
      'O botão de reabrir como administrador aparece sempre na faixa vermelha do topo.',
    ],
    novo: [],
  },
  '1.4.26': {
    corrigido: [
      'Nenhuma mensagem técnica do Windows aparece mais na tela. Quando um ajuste é recusado, o programa explica em português o que aconteceu e o que fazer.',
      'Ajustes que falham por falta de administrador, por política do Windows ou por recurso ausente agora mostram sempre uma explicação, nunca o texto do sistema.',
    ],
    novo: [],
  },
  '1.4.25': {
    corrigido: [
      'Na aba Memória, o intervalo da limpeza automática ficava travado em 10 minutos: escolher 20, 30 ou 1 hora não mudava. Agora muda.',
      'Quando um ajuste precisa de administrador, a mensagem agora explica em português em vez de mostrar o texto técnico do Windows.',
    ],
    novo: [],
  },
  '1.4.24': {
    corrigido: [
      'O contador de otimizações do Painel não subia depois de otimizar. As ações (Game Bar, DVR, HAGS, SysMain e outras) apareciam sempre como desligadas, porque a leitura do estado de todas elas rodava num script que o Windows recusava. Agora cada uma é lida separada.',
      'O contador do Painel agora atualiza sozinho quando você aplica ou desfaz um ajuste, sem precisar entrar e sair da tela.',
    ],
    novo: [],
  },
  '1.4.23': {
    corrigido: [],
    novo: ['Aviso na tela quando sai versão nova, sem precisar abrir a página Sobre.'],
  },
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

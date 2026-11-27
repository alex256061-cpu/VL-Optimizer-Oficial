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
  '1.4.94': {
    corrigido: [],
    novo: [
      'Boas-vindas e conclusao do instalador viraram telas cheias com arte tecnologica propria do VL, no lugar do layout padrao do NSIS.',
    ],
  },

  '1.4.93': {
    corrigido: [],
    novo: [
      'Botoes Proximo/Cancelar/Concluir do instalador com o visual do VL, no lugar dos botoes cinza padrao do Windows.',
    ],
  },

  '1.4.92': {
    corrigido: [],
    novo: [
      'Rodape do instalador e botoes no tema escuro do VL, sem a faixa branca nativa.',
    ],
  },

  '1.4.91': {
    corrigido: [],
    novo: [
      'Instalador tambem escurece a barra de titulo e o rodape nativo do Windows, para nao sobrar area branca no assistente.',
    ],
  },

  '1.4.90': {
    corrigido: [],
    novo: [
      'Instalador com tema escuro tecnologico do VL no assistente inteiro: boas-vindas, progresso e conclusao sem as areas brancas padrao do NSIS.',
    ],
  },

  '1.4.89': {
    corrigido: [
      'Cabecalho e sidebar iguais ao GDZ: marca visivel na barra de titulo, controles da janela a direita e logo da sidebar no tamanho/margens do GDZ, sem corte.',
    ],
    novo: [],
  },

  '1.4.88': {
    corrigido: [
      'Logo da sidebar nao fica mais cortado nem pula para fora da tela ao abrir/fechar o menu lateral.',
    ],
    novo: [],
  },

  '1.4.87': {
    corrigido: [
      'Barra de titulo do app: os controles de minimizar, maximizar e fechar estavam alinhados a esquerda; agora ficam a direita, no padrao do Windows, com Tutorial, som e tema ao lado.',
    ],
    novo: [],
  },

  '1.4.86': {
    corrigido: [],
    novo: [
      'Instalador com visual novo: sidebar e cabecalho no padrao preto/vermelho do VL, com o simbolo VL e os aneis da marca.',
      'Textos do assistente de instalacao mais claros e sem aquele visual generico do instalador padrao.',
    ],
  },

  '1.4.85': {
    corrigido: [
      'Corrige os acentos nas verificacoes de hardware: textos como "Placa de video em ordem" e "A memoria esta numa velocidade boa" apareciam com caractere invalido no app. O PowerShell agora devolve a saida em UTF-8.',
    ],
    novo: [],
  },

  '1.4.84': {
    corrigido: [
      'Aviso de vencimento mais claro: com 1 dia restante agora mostra "Seu plano vence amanhã" (ou "hoje" se for o mesmo dia) e nunca mais o texto errado "1 dias".',
      'A mensagem tambem lembra que renovar mantem os ajustes ja aplicados.',
    ],
    novo: [],
  },

  '1.4.83': {
    corrigido: [
      'Campos de senha ganharam o botao de olho (mostrar/ocultar) no site e na tela de entrada do app.',
      'O e-mail do cadastro agora e digitado duas vezes; o site avisa quando o dominio parece errado (gmail.con, hotmial etc.) para o cliente nao perder o acesso.',
      'A tela do PIX mostra em qual conta o acesso sera liberado. Se o e-mail estiver errado, da para trocar de conta antes de pagar.',
    ],
    novo: [
      'Tela de pagamento confirmado com download do app, passo a passo de acesso, codigo do pedido para guardar e botao de suporte no Discord.',
    ],
  },
  '1.4.82': {
    corrigido: [
      'Seguranca: o login agora e validado no SERVIDOR (/api/login). O bloqueio de tentativas e o registro de falhas sairam das funcoes publicas do Supabase - antes, qualquer pessoa conseguia apagar o bloqueio de um e-mail e ate travar o login de outra pessoa.',
      'Se o site estiver fora do ar, o app continua entrando direto pelo Supabase (reserva) para nao travar quem ja usa.',
    ],
    novo: [],
  },
  '1.4.81': {
    corrigido: [
      'Seguranca: as janelas do app agora bloqueiam navegacao para sites externos (links abrem no navegador) e window.open; permissoes de camera, microfone, localizacao e notificacao sao negadas. O clipboard e o fullscreen continuam funcionando.',
      'Tela de entrada agora tem Content-Security-Policy (a do app ja tinha).',
      'Site: corrigido redirecionamento aberto no parametro ?voltar do login; e-mail mostrado no checkout passou a ser escapado; o status do PIX devolve o e-mail mascarado; o endpoint antigo /api/comprar foi desativado (410).',
    ],
    novo: [],
  },
  '1.4.80': {
    corrigido: [
      'Atualizacao podia instalar a versao que ja estava baixada (mais antiga) e so na abertura seguinte oferecer a mais nova. Agora, ao clicar em instalar, o app reconfere o servidor, baixa e instala a versao MAIS RECENTE.',
      'A conferencia de atualizacao passou de 6 horas para 30 minutos e o arquivo de versao e lido sem cache.',
    ],
    novo: [],
  },
  '1.4.79': {
    corrigido: [
      'Marca duplicada no topo (aparecia VL VL OPTIMIZER): agora a marca fica so na sidebar.',
      'Os cartoes de otimizacao voltaram a caber 5 por linha mesmo com a sidebar aberta.',
    ],
    novo: [
      'Dashboard com o mesmo acabamento da tela de entrada: sidebar aberta com os nomes das secoes em janelas largas (e rail compacto nas menores), item ativo com brilho, titlebar e barra superior no mesmo estilo, cards com hover suave, transicao ao trocar de pagina e barra de rolagem discreta.',
    ],
  },
  '1.4.78': {
    corrigido: [
      'Janela de entrada agora tem botoes de minimizar e fechar (X): a janela e sem borda e antes nao tinha como fechar pela tela.',
      'O card de login nao corta mais no tamanho minimo da janela (1180x700).',
    ],
    novo: [
      'Nova tela de entrada no estilo do GDZ: grade tecnologica no fundo, card de login com abas Entrar/Criar conta, campos com icone e beneficios a esquerda.',
    ],
  },
  '1.4.77': {
    corrigido: [
      'Botao de suporte do app aponta para o convite certo do Discord (o antigo nao existia).',
      'Site: secao de avaliacoes no padrao do GDZ (carrossel, cartoes com print de FPS, hardware e selo), comunidade do Discord ao vivo na home e na secao, e convite certo em todos os botoes.',
      'Site: removido o programa de afiliados (nao esta ativo no momento).',
      'Site: atualizacao passou a ser incremental (blockmap publicado) - a partir desta versao o app baixa so o que mudou, nao os 137 MB inteiros.',
    ],
    novo: [],
  },
  '1.4.76': {
    corrigido: [
      'Auditoria com administrador: 29 de 29 ajustes e 15 de 16 acoes passaram. Corrigidos os dois que falharam, com o codigo copiado do GDZ, sem invencao:',
      'Placa de rede (LSO): agora grava o valor no registro do driver (*LsoV2IPv4/*LsoV2IPv6) e reinicia a placa, como o GDZ; antes usava cmdlet que nao funciona em alguns drivers, e o desfazer falhava.',
      'Servicos do Xbox: sao 3 servicos (o GDZ nao inclui o XboxGipSvc, que e o servico do controle) e servico ausente conta como desligado, igual ao GDZ.',
    ],
    novo: [],
  },
  '1.4.75': {
    corrigido: [
      'Auditoria de TODOS os ajustes. Corrigidos tres defeitos que faziam o interruptor voltar sozinho: (1) ligar um ajuste que ja estava ligado gravava um backup do proprio estado ligado, e desligar restaurava esse estado; (2) o detector do "ja esta aplicado" comparava campos com nomes errados e nunca funcionava; (3) o DLSS recomendado da NVIDIA aplicava no driver e a tela continuava dizendo desligado.',
      'Os Servicos do Xbox deixavam de funcionar em Windows onde parte deles nao existe (bloat removido): agora so mexe nos que existem e explica quando nao da.',
    ],
    novo: [],
  },

  '1.4.74': {
    corrigido: [
      'O ajuste "Plano de energia Desempenho Maximo" agora liga de verdade: a linha que ativava o plano estava comentada no codigo, entao ele salvava o backup e nao mudava nada - o interruptor voltava sozinho. Tambem passou a reaproveitar o plano em vez de criar uma copia a cada clique, e o desligar volta ao plano que estava antes.',
    ],
    novo: [],
  },

  '1.4.73': {
    corrigido: [
      'Tela de instalacao com a cara do VL: boas-vindas com a arte da marca (fundo preto e vermelho, logo e anel), cabecalho VL na tela de instalacao e a pagina generica do Windows removida. Antes era o assistente padrao cinza.',
    ],
    novo: [],
  },

  '1.4.72': {
    corrigido: [
      'Instalacao mais rapida: o instalador esperava ate 60 segundos por uma etapa que nao acontece quando o Windows nao mostra o pedido de administrador (era o caso das atualizacoes). Agora ela e pulada e a instalacao termina em segundos.',
      'Instalador menor (130 MB em vez de 137): o app leva so o idioma portugues, em vez de 55 idiomas do Windows.',
    ],
    novo: [
      'Tela de instalacao com a cara do VL: janela propria com o icone e a barra de progresso, sem o assistente padrao do Windows.',
    ],
  },

  '1.4.71': {
    corrigido: [
      'A mensagem de "chave em outro PC" nao mente mais: cada chave vale para 1 PC e para trocar de computador e preciso pedir o reset da chave no suporte. Antes ela mandava sair no outro PC, o que nao libera nada.',
      'Quando a chave esta presa em outro PC, o botao do aviso abre o suporte (Discord) para pedir o reset.',
    ],
    novo: [],
  },

  '1.4.70': {
    corrigido: [
      'Corrigido: em uma instalacao nova (ou depois de sair da conta) o botao Entrar nao funcionava - o proprio app bloqueava o login e mostrava "Nao foi possivel entrar". Quem ja tinha sessao nao era afetado, mas ninguem conseguia entrar pela primeira vez. Agora entra normalmente.',
      'As mensagens de recusa agora dizem o motivo certo: conta em outro PC, licenca vencida, relogio atrasado, sem internet. Quando a solucao esta no site aparece um botao para abrir a sua conta.',
    ],
    novo: [],
  },

  '1.4.69': {
    corrigido: [
      'Esqueci a senha agora funciona de verdade: o e-mail de recuperacao abre uma pagina para criar a senha nova (antes o link caia na home e nao tinha onde digitar a senha). Quem ja esta logado tambem consegue trocar a senha por essa pagina.',
    ],
    novo: [],
  },

  '1.4.68': {
    corrigido: [
      'O anel do Painel voltou ao visual antigo: continua vermelho e girando mesmo quando todos os ajustes recomendados estao aplicados. Antes ele travava alinhado e mudava a cor para dourado nesse estado, o que parecia defeito.',
    ],
    novo: [],
  },

  '1.4.67': {
    corrigido: [
      'O plano gratis agora libera o que o plano gratis da referencia libera: medidor de FPS, gargalo, verificacao do hardware, inicializacao, jogos e Otimizacao Rapida. Antes o servidor mandava uma lista curta e o app trancava ate essas paginas: o cliente gratis nao conseguia nem medir o FPS nem rodar a Otimizacao Rapida.',
      'Aplicar ajuste, limpar RAM, rodar a limpeza, desinstalar programa e instalar as ferramentas agora exigem plano pago tambem no processo principal (antes so a tela trancava).',
    ],
    novo: [],
  },

  '1.4.66': {
    corrigido: [
      'Melhorias internas de estabilidade e preparo da telemetria.',
    ],
    novo: [],
  },

  '1.4.65': {
    corrigido: [
      'O aviso de atualizacao nunca aparecia: o app baixava a versao nova em segundo plano, conferia a assinatura e nao avisava ninguem. O cliente ficava na versao antiga sem saber que havia atualizacao pronta. Agora a barra "Versao X pronta para instalar - Reiniciar e atualizar" aparece sozinha, mostrando o download e a conferencia.',
      'A pagina Limpeza: o progresso "Medindo X/Y" nao andava porque o canal que a tela consulta nunca foi ligado.',
    ],
    novo: [],
  },

  '1.4.64': {
    corrigido: [
      'Depois de um desligamento forcado do PC, o app pedia login de novo sem explicar: o arquivo que guarda a sessao ficava corrompido (o PC do dono teve um desligamento inesperado as 05:07 e o arquivo ficou com 2533 bytes, todos zero). Agora a sessao e gravada de forma segura e tem uma copia de seguranca - se o arquivo principal vier corrompido, a copia devolve o login. Sair continua apagando as duas.',
    ],
    novo: [],
  },

  '1.4.63': {
    corrigido: [
      'Dois cartoes ligavam o ajuste mas o interruptor voltava para desligado: "Memoria virtual gerenciada pelo Windows" e "Jogos em janela com o modo moderno". Agora eles mostram o estado certo (no seu PC a memoria virtual ja vem gerenciada pelo Windows, entao aparece LIGADO).',
      'Cartoes que so existem no Windows 11 apareciam como interruptor normal e nao ligavam sem explicar: "Finalizar tarefa pela barra de tarefas", "Menu do botao direito completo" e "Barra de tarefas a esquerda". Agora o cartao mostra o motivo e o interruptor ja vem desabilitado.',
    ],
    novo: [
      'O ajuste "Jogos em janela" ganhou desfazer: ele tira so a marca do DirectX e preserva o resto da configuracao. Antes, ligar e clicar de novo dava "sem backup".',
    ],
  },

  '1.4.62': {
    corrigido: [
      'O instalador levava junto a pasta de imagens de outra marca de revendedor (2,2 MB que nao apareciam na tela, mas nao deviam viajar no seu produto). O instalador ficou 2,2 MB menor.',
    ],
    novo: [],
  },

  '1.4.61': {
    corrigido: [
      'A pagina Internet > DNS nao funcionava: nenhuma opcao aplicava, nem a de voltar ao automatico. Era um erro de sintaxe no comando que o app mandava ao Windows.',
      'O DNS dizia "pronto" mesmo quando o Windows nao deixava trocar (sem administrador). Agora avisa que precisa de administrador.',
      'O Desfazer de alguns ajustes acusava erro mesmo tendo voltado ao normal, e o backup de dois ajustes (atalhos de acessibilidade e Num Lock) guardava o valor errado quando duas chaves diferentes usam o mesmo nome de valor.',
    ],
    novo: [
      'Card "Sem efeitos visuais do Windows": tira sombras e animacoes de janelas e menus. O Desfazer devolve exatamente a configuracao que voce ja tinha.',
      'Card "Tela em 720p (emergencia)": baixa a resolucao para 1280x720 para a placa aguentar. O VL testa o modo antes de aplicar, confere que mudou e volta sozinho se a tela nao aceitar.',
      'O motor agora aceita as 9 acoes do catalogo completo: Reduzir Input Lag, Todos os ajustes de uma vez, Sem atalhos de acessibilidade, Limpar temporarios, DNS rapido e tirar apps do inicio do Windows.',
    ],
  },
  '1.4.60': {
    corrigido: [
      'O icone do VL Scaling na janela ainda era o do programa antigo. Agora e o do VL, na janela, na bandeja e nas propriedades do arquivo.',
    ],
    novo: [],
  },
  '1.4.59': {
    corrigido: [
      'A aba VL Scaling agora usa o programa de escalonamento do VL, com o nome e o icone do VL na janela e na bandeja.',
    ],
    novo: [
      'O VL Scaling ja vem junto com o programa: voce nao precisa ter outro programa instalado nem comprar nada. Ele abre, ajusta e fecha direto da tela do VL.',
      'A pasta de configuracao do VL Scaling agora e a do VL, separada da de outros programas.',
    ],
  },  '1.4.58': {
    corrigido: [
      '"Limpar cache de shaders" nao funcionava e agora limpa de verdade.',
      '"Resgatar chave" nao funcionava. Corrigido.',
      'A tela dizia que a atualizacao falhou quando ela tinha dado certo. Corrigido.',
      'Encerrar processo, detectar jogo aberto, limpar cache da Epic e detectar sobras de programas: todos agora avisam a verdade.',
      'A aba VL Scaling nao mostrava a configuracao atual e o "Recomendado" dava erro. Corrigido.',
      'As opcoes de sincronizacao do VL Scaling nao eram gravadas. Corrigido.',
    ],
    novo: [
      'A recomendacao de encoder para live agora usa a sua placa de video de verdade (NVENC, AMF ou QuickSync), com preset, bitrate e keyframe.',
      'A aba Sobre mostra a versao instalada e deixa voce ligar ou desligar a telemetria quando quiser.',
      'O overlay agora mostra a temperatura da CPU, quando o PC tiver o sensor.',
      'O botao "Restaurar" da aba Reparos religa tudo que uma versao antiga do VL possa ter desligado: servicos, Game Bar, atualizacoes, arquivo de paginacao e mais.',
      'Num Ryzen X3D de dois chips, o Xbox Game Bar nao e mais removido: o driver da AMD usa ele para escolher o chip certo do jogo.',
    ],
  },
  '1.4.57': {
    corrigido: [
      'A aba VL Scaling nao mostrava a configuracao atual e o botao "Recomendado" sempre dava erro. Ao clicar em Iniciar, os valores de fabrica eram gravados por cima do que voce tinha ajustado. Corrigido.',
      'Sete controles do VL Scaling nao eram gravados: modo de desempenho, modo de redimensionamento, ajuste da imagem, modo janela, iniciar como administrador e iniciar minimizado. Corrigido.',
    ],
    novo: [],
  },
  '1.4.56': {
    corrigido: [
      'O botao "Limpar cache de shaders" dava erro em toda tentativa. Agora limpa e diz quantos caches encontrou.',
      'O botao "Resgatar chave" nao funcionava: o programa procurava a chave no lugar errado. Corrigido.',
      'Quando a atualizacao dava certo, a tela mostrava "Nao foi possivel atualizar". Corrigido.',
      'Encerrar um programa na lista de processos dizia "encerrado" mesmo quando o Windows bloqueava. Agora avisa.',
      'O "Detectar jogo aberto" podia apontar para o Explorer ou o navegador. Agora so reconhece jogos.',
      'O botao de limpar cache de um jogo da Epic nao apagava nada e dizia que tinha limpado. Corrigido.',
      'A limpeza de "sobras" de um programa podia listar pastas do proprio Windows. Corrigido.',
      'O cache de shaders, o do Epic e o de programas desconhecidos agora dizem a verdade quando nao ha nada para limpar.',
    ],
    novo: [],
  },
  '1.4.55': {
    corrigido: [
      'Ajustes do VL Scaling que envolvem uma opcao ainda nao usada no Lossless nao eram gravados, mas o programa dizia "aplicado". Agora a opcao e criada no arquivo do Lossless e passa a valer.',
      'O programa so diz que aplicou um ajuste do Scaling quando ele realmente mudou o arquivo.',
    ],
    novo: [],
  },
  '1.4.54': {
    corrigido: [
      'O "DLSS no modelo recomendado pela NVIDIA" nao fazia nada: aparecia o botao, mas o ajuste nao tinha o que aplicar. Agora aplica o preset recomendado no driver da NVIDIA, como o programa de referencia.',
      'O "Plano de Alta Performance" agora avisa quando o Windows nao aceita o plano, em vez de dizer que deu certo.',
      'Varios ajustes acertados com o programa de referencia: telemetria, sugestoes, Num Lock, historico de atividades, widgets, localizacao, brilho da tela azul, internet sem envio para outros PCs, pesquisa sem Bing, barra de tarefas e arquivo de paginacao.',
      'O "Arquivo de paginacao" e os "Jogos em janela" usavam um caminho que o Windows nao le. Corrigidos para o caminho certo.',
      'A "Sobreposicao do Steam" nao funcionava: agora fecha o Steam, altera a configuracao de cada conta e reabre.',
      'O "Explorer Minimo" reinicia so a janela do seu usuario, nao a de todos.',
    ],
    novo: [],
  },
  '1.4.53': {
    corrigido: [
      'O botao "Religar o Windows Defender" dizia "o Windows nao aceitou a mudanca" em PC que usa outro antivirus. Agora diz que este PC nao tem o Windows Defender instalado, que e a verdade.',
      'A conferencia do Defender estava invertida: contava como falha quando a protecao estava LIGADA, que e justamente o resultado desejado.',
    ],
    novo: [],
  },
  '1.4.52': {
    corrigido: [
      'Os quatro botoes "Religar" da aba Reparos nao faziam nada: clicavam e respondiam "acao desconhecida". Agora religam o Windows Defender, o Windows Update, a Restauracao do Sistema e consertam a escala da tela.',
      '"Restaurar tudo" dizia ter restaurado quando nao havia nada guardado, e apagava os botoes de desfazer da tela. Agora avisa que nao ha nada para desfazer.',
      'As janelas de acessibilidade (Teclas de Aderencia, Alternar Teclas, Filtro de Teclas) voltam a funcionar: o ajuste apagava o recurso em vez de so desligar o atalho.',
      'A "Correcao de tela piscando (MPO)" nao fazia efeito: gravava no lugar errado do registro. Corrigida.',
      'A "Placa de video com interrupcao MSI" aplicava so metade do que devia: agora tambem poe a prioridade alta de interrupcao.',
      'Telemetria, sugestoes, Num Lock, historico de atividades, widgets, Edge em segundo plano e apps da Loja: ajustes completados para realmente fazerem o que o texto promete.',
      'A "Sobreposicao do Steam" nao funcionava: agora fecha o Steam, altera a configuracao de cada conta e reabre.',
      'A "Pesquisa do Iniciar sem Bing" e o "Sem upload de atualizacoes para outros PCs" usavam chaves que o Windows ignora. Trocadas pelas que funcionam.',
    ],
    novo: [],
  },
  '1.4.51': {
    corrigido: [
      'Correcao de acentuacao nos textos internos do projeto. Nao muda nada no que voce ve.',
    ],
    novo: [],
  },
  '1.4.50': {
    corrigido: [
      'O aviso de compra aparecia sem motivo a cada dois minutos. Corrigido.',
      'O programa deixava de registrar parte do uso do plano quando a sessao ainda estava carregando ao abrir.',
      '"Explorer Minimo" e outras acoes de uma vez podiam dizer "concluido" mesmo quando o script avisava que falhou. Agora a falha aparece.',
      'A "Otimizacao Rapida" e o "Defender Off" agora conferem o resultado depois de aplicar: se o Windows recusar por falta de administrador, o aviso diz isso em vez de dar concluido.',
      'Os cards "Tela em 720p" e "Efeitos visuais" sairam da tela: as duas acoes tinham sido removidas porque causavam problema, mas o botao continuava aparecendo e dava erro ao clicar.',
    ],
    novo: [],
  },
  '1.4.49': {
    corrigido: [
      'O aviso "Compra confirmada" nao aparece mais sem motivo: ele aparecia a cada dois minutos mesmo sem nenhuma compra, porque o programa comparava o plano com nada.',
    ],
    novo: [],
  },
  '1.4.48': {
    corrigido: [
      'Corrigida a atualizacao que podia deixar o programa sem abrir: a ferramenta de build estava revertendo arquivos internos para uma versao antiga antes de gerar o instalador.',
      'A assinatura da atualizacao voltou a ser conferida no programa instalado.',
      'A compra feita no site agora libera o app sozinha, sem precisar clicar em "Ja comprei".',
    ],
    novo: [],
  },
  '1.4.47': {
    corrigido: [
      'A assinatura da atualizacao voltou a ser conferida.',
      'A compra feita no site agora libera o app sozinha.',
    ],
    novo: [],
  },
  '1.4.46': {
    corrigido: [
      'O botao de desfazer passou a aparecer depois de aplicar uma otimizacao. Ele existia na tela mas o programa nunca avisava que a acao tinha volta, entao ficava sempre escondido.',
      '"Aplicar perfil", no card do jogo, agora grava um ponto de restauracao antes de mexer e pode ser desfeito por completo, como no programa de referencia.',
      'No Ryzen X3D de dois chips (7900X3D, 7950X3D, 9900X3D, 9950X3D, 7945HX3D) o perfil do jogo nao troca o plano de energia, de proposito: o driver da AMD precisa do plano Equilibrado para escolher o chip certo. Igual ao programa de referencia.',
    ],
    novo: [],
  },
  '1.4.45': {
    corrigido: [
      'Limpeza do codigo da tela de novidades: tirei os estilos que sobravam do aviso de atualizacao removido na versao anterior.',
    ],
    novo: [],
  },
  '1.4.44': {
    corrigido: [
      'Quem esta no plano gratis agora ve a chamada "Ver os planos" na aba Sobre, com o preco. O bloco existia no codigo mas nao na tela.',
      'O card "Atualizacao" saiu da aba Sobre. O app continua verificando sozinho e avisa pelo aviso da tela quando ha versao nova, como o programa de referencia faz.',
    ],
    novo: [],
  },
  '1.4.43': {
    corrigido: [
      'O medidor de FPS passou a guardar as medicoes e enviar em lotes, como o programa de referencia: fila de ate 500 no disco, 50 por envio a cada 5 minutos, e o par antes/depois e ligado pelo identificador da medicao (funciona mesmo depois de fechar o app).',
      'O envio so acontece com a sua autorizacao. Quem nunca respondeu a pergunta nao envia nada, e a fila fica vazia.',
      'As estatisticas de uso do plano (quando a tela de planos aparece, quando voce clica) voltaram a ser registradas. Antes o app respondia "ok" e descartava tudo.',
      'O resumo do PC enviado junto (processador, placa de video, memoria, disco, tela) segue a mesma lista e os mesmos limites do programa de referencia.',
    ],
    novo: [],
  },
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


 // ==UserScript==
 // @name         Komunic - Histórico do Contato (Atendimentos + Mídias)
 // @namespace    https://github.com/Soy-Pardal/tampermonkey-komunic-tools
 // @version      4.3
 // @description  Consulta o histórico pela Gestão de Atendimentos, com mensagens e anexos
 // @match        https://app.komunic.net/*
 // @grant        none
 // @run-at       document-idle
 // ==/UserScript==

(function () {
  'use strict';

  const BASE = location.origin;
  const LIMITE = 10;
  const MAX_PAGINAS = 30;

  let modal = null;
  let abrindo = false;
  let ultimaUrl = location.href;
  let observadorBotao = null;

  const $ = (seletor, raiz = document) =>
    raiz.querySelector(seletor);

  function elemento(tag, classe = '', texto = '') {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto) el.textContent = texto;
    return el;
  }

  function normalizar(valor) {
    return String(valor || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function limparPesquisa(valor) {
    return String(valor || '')
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function nomeContatoAtual() {
    return $(
      '[data-testid="chat-top-contact-name"]'
    )?.textContent?.trim() || '';
  }

  function tokenXsrf() {
    const parte = document.cookie
      .split('; ')
      .find(c => c.startsWith('XSRF-TOKEN='));

    if (!parte) return '';

    try {
      return decodeURIComponent(
        parte.substring('XSRF-TOKEN='.length)
      );
    } catch {
      return '';
    }
  }


function versaoInertia() {
  try {
    const pagina = document.querySelector(
      'script[data-page="app"]'
    );

    if (!pagina) return '';

    const dados = JSON.parse(pagina.textContent || '{}');

    return dados.version || '';
  } catch (erro) {
    console.warn(
      '[Komunic Histórico] Não foi possível ler a versão Inertia:',
      erro
    );
    return '';
  }
}


  async function requisicao(url, inertia = false) {
    const headers = {
      Accept: inertia
        ? 'text/html, application/xhtml+xml'
        : 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest'
    };

    const token = tokenXsrf();
    if (token) headers['X-XSRF-TOKEN'] = token;

    if (inertia) {
      headers['X-Inertia'] = 'true';

      const versao = versaoInertia();
      if (versao) {
        headers['X-Inertia-Version'] = versao;
      }
    }

    const resposta = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers
    });

    if (resposta.status === 409) {
      throw new Error(
        'O Komunic solicitou atualização da página (409). ' +
        'Atualize o Komunic e tente novamente.'
      );
    }

    if (
      resposta.status === 401 ||
      resposta.status === 403
    ) {
      throw new Error(
        'Sessão expirada ou acesso não permitido (' +
        resposta.status + ').'
      );
    }

    if (!resposta.ok) {
      throw new Error(
        'Erro HTTP ' + resposta.status
      );
    }

    const tipo = resposta.headers.get('content-type') || '';

    if (!tipo.includes('json')) {
      throw new Error(
        'O Komunic não retornou JSON. ' +
        'Verifique se você continua conectado.'
      );
    }

    return resposta.json();
  }

  function parametrosPesquisa(termo, pagina) {
    return new URLSearchParams({
      protocol: '',
      organization_query: '',
      attendant_query: '',
      subject_call: '',
      contact_query: termo,
      department_id: '',
      connection_id: '',
      date_start: '',
      date_end: '',
      metric: '',
      month: '',
      per_page: '100',
      page: String(pagina)
    });
  }

  function blocoAtendimentos(resposta) {
    const props = resposta?.props || {};

    const possibilidades = [
      props.attendances,
      props.customerServices,
      props.customer_services,
      props.data,
      resposta?.attendances,
      resposta?.data
    ];

    for (const bloco of possibilidades) {
      if (Array.isArray(bloco)) {
        return {
          data: bloco,
          next_page_url: null,
          current_page: 1,
          last_page: 1
        };
      }

      if (bloco && Array.isArray(bloco.data)) {
        return bloco;
      }
    }

    throw new Error(
      'Não foi possível identificar a lista de atendimentos ' +
      'na resposta do Komunic.'
    );
  }

  function nomeDoAtendimento(a) {
    return String(
      a.contact?.name ||
      a.chat?.name ||
      a.contact_name ||
      a.name ||
      ''
    );
  }

  function idDoAtendimento(a) {
    return a.id ?? a.customer_service_id ?? null;
  }

  function pontuacaoNome(a, nome) {
    const atual = normalizar(nomeDoAtendimento(a));
    const procurado = normalizar(nome);

    if (!atual || !procurado) return 0;
    if (atual === procurado) return 100;
    if (atual.startsWith(procurado)) return 85;
    if (procurado.startsWith(atual)) return 70;

    const palavras = procurado
      .split(' ')
      .filter(p => p.length > 2);

    const encontradas = palavras.filter(
      p => atual.split(' ').includes(p)
    );

    return palavras.length
      ? Math.round(
          60 * encontradas.length / palavras.length
        )
      : 0;
  }

  async function buscarAtendimentosPorNome(nome) {
    const nomeLimpo = limparPesquisa(nome);

    if (!nomeLimpo) {
      throw new Error('Nome do contato vazio.');
    }

    const partes = nomeLimpo.split(' ');

    const termos = [...new Set([
      nomeLimpo,
      partes.slice(0, 2).join(' '),
      partes[0]
    ].filter(Boolean))];

    const encontrados = new Map();

    for (const termo of termos) {
      for (
        let pagina = 1;
        pagina <= MAX_PAGINAS;
        pagina++
      ) {
        const params = parametrosPesquisa(
          termo,
          pagina
        );

        const resposta = await requisicao(
          BASE + '/gestao-de-atendimentos?' + params,
          true
        );

        const bloco = blocoAtendimentos(resposta);
        const lista = bloco.data || [];

        for (const atendimento of lista) {
          const id = idDoAtendimento(atendimento);

          if (id == null) continue;

          // A pesquisa do servidor pode devolver
          // resultados parciais; a seleção final é
          // feita usando o nome do contato.
          encontrados.set(String(id), atendimento);
        }

        const paginaAtual = Number(
          bloco.current_page || pagina
        );

        const ultimaPagina = Number(
          bloco.last_page || pagina
        );

        const temProxima = Boolean(
          bloco.next_page_url
        ) || paginaAtual < ultimaPagina;

        if (!temProxima || !lista.length) break;
      }

      const correspondencias = [
        ...encontrados.values()
      ].filter(a => pontuacaoNome(a, nome) >= 60);

      if (correspondencias.length) break;
    }

    return [...encontrados.values()]
      .filter(a => pontuacaoNome(a, nome) >= 35)
      .sort((a, b) => {
        const diferenca =
          pontuacaoNome(b, nome) -
          pontuacaoNome(a, nome);

        if (diferenca) return diferenca;

        return dataNumerica(
          b.date_start || b.created_at
        ) - dataNumerica(
          a.date_start || a.created_at
        );
      });
  }

  async function buscarMensagens(id, cursor = null) {
    const params = new URLSearchParams({
      limit: String(LIMITE)
    });

    if (cursor) {
      params.set('cursor', cursor);
    }

    const dados = await requisicao(
      BASE + '/live-history-chat/' +
      encodeURIComponent(id) + '?' + params
    );

    const lista = Array.isArray(dados.messages)
      ? dados.messages
      : Array.isArray(dados.messages?.data)
        ? dados.messages.data
        : [];

    return {
      mensagens: lista,
      cursor: dados.pagination?.next_cursor || null,
      mais: dados.pagination?.has_more === true
    };
  }

  function dataNumerica(valor) {
    if (!valor) return 0;

    const numero = new Date(valor).getTime();

    return Number.isFinite(numero) ? numero : 0;
  }

  function formatarData(valor) {
    if (!valor) return '—';

    const data = new Date(valor);

    return Number.isNaN(data.getTime())
      ? String(valor)
      : data.toLocaleString('pt-BR');
  }

  function criarEstilos() {
    if ($('#gnp-historico-estilos')) return;

    const style = elemento('style');
    style.id = 'gnp-historico-estilos';

    style.textContent = `
      #gnp-historico-overlay {
        position:fixed;
        inset:0;
        z-index:999999;
        background:rgba(15,23,42,.65);
        display:flex;
        align-items:center;
        justify-content:center;
        padding:16px;
        font-family:Arial,sans-serif;
      }

      #gnp-historico-overlay * {
        box-sizing:border-box;
      }

      .gnp-historico-janela {
        width:100%;
        max-width:900px;
        height:88vh;
        background:#fff;
        border-radius:14px;
        overflow:hidden;
        display:flex;
        flex-direction:column;
        box-shadow:0 20px 60px rgba(0,0,0,.3);
      }

      .gnp-historico-topo {
        padding:15px 18px;
        background:#16a34a;
        color:white;
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:12px;
      }

      .gnp-historico-titulo {
        font-size:16px;
        font-weight:700;
      }

      .gnp-historico-subtitulo {
        font-size:12px;
        opacity:.9;
        margin-top:4px;
      }

      .gnp-historico-fechar {
        background:transparent;
        border:0;
        color:white;
        font-size:28px;
        cursor:pointer;
      }

      .gnp-historico-lista {
        flex:1;
        min-height:0;
        overflow:auto;
        padding:15px;
        background:#f8fafc;
      }

      .gnp-historico-card {
        background:white;
        border:1px solid #e2e8f0;
        border-radius:10px;
        margin-bottom:12px;
        overflow:hidden;
      }

      .gnp-historico-card-topo {
        padding:13px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
      }

      .gnp-historico-card-info {
        min-width:0;
        font-size:12px;
        color:#475569;
        line-height:1.6;
      }

      .gnp-historico-card-info strong {
        color:#0f172a;
        font-size:13px;
      }

      .gnp-historico-acao {
        flex-shrink:0;
        border:0;
        border-radius:8px;
        background:#16a34a;
        color:white;
        font-size:12px;
        font-weight:600;
        padding:9px 12px;
        cursor:pointer;
      }

      .gnp-historico-mensagens {
        display:none;
        border-top:1px solid #e2e8f0;
        background:#f1f5f9;
        padding:12px;
        max-height:430px;
        overflow:auto;
      }

      .gnp-historico-msg {
        display:flex;
        margin-bottom:9px;
      }

      .gnp-historico-balao {
        max-width:85%;
        padding:10px 12px;
        border-radius:10px;
        background:white;
        box-shadow:0 1px 2px rgba(0,0,0,.06);
        font-size:12px;
        color:#0f172a;
        overflow-wrap:anywhere;
      }

      .gnp-historico-msg.saida {
        justify-content:flex-end;
      }

      .gnp-historico-msg.saida
      .gnp-historico-balao {
        background:#dcfce7;
      }

      .gnp-historico-remetente {
        font-weight:bold;
        margin-bottom:5px;
        color:#334155;
      }

      .gnp-historico-texto {
        white-space:pre-wrap;
        line-height:1.5;
      }

      .gnp-historico-data {
        text-align:right;
        color:#64748b;
        font-size:10px;
        margin-top:7px;
      }

      .gnp-historico-aviso {
        padding:12px;
        text-align:center;
        font-size:12px;
        color:#64748b;
      }

      .gnp-historico-rodape {
        padding:11px;
        border-top:1px solid #e2e8f0;
        font-size:12px;
        text-align:center;
        color:#475569;
        background:white;
      }

      .gnp-historico-midia {
        margin-top:8px;
      }

      .gnp-historico-midia img,
      .gnp-historico-midia video {
        max-width:100%;
        max-height:300px;
        border-radius:8px;
      }

      .gnp-historico-midia audio {
        max-width:100%;
      }

      .gnp-historico-midia a {
        color:#2563eb;
        text-decoration:underline;
      }
    `;

    document.head.appendChild(style);
  }

  function fecharModal() {
    if (!modal) return;

    modal.remove();
    modal = null;
  }

  function abrirModal(nome, atendimentos) {
    fecharModal();

    const overlay = elemento('div');
    overlay.id = 'gnp-historico-overlay';

    const janela = elemento(
      'div',
      'gnp-historico-janela'
    );

    const topo = elemento(
      'div',
      'gnp-historico-topo'
    );

    const textos = elemento('div');

    textos.appendChild(
      elemento(
        'div',
        'gnp-historico-titulo',
        'Histórico de atendimentos'
      )
    );

    textos.appendChild(
      elemento(
        'div',
        'gnp-historico-subtitulo',
        nome
      )
    );

    const fechar = elemento(
      'button',
      'gnp-historico-fechar',
      '×'
    );

    fechar.type = 'button';
    fechar.onclick = fecharModal;

    topo.append(textos, fechar);

    const lista = elemento(
      'div',
      'gnp-historico-lista'
    );

    const rodape = elemento(
      'div',
      'gnp-historico-rodape',
      atendimentos.length +
      ' atendimento(s) encontrado(s)'
    );

    janela.append(topo, lista, rodape);
    overlay.appendChild(janela);

    overlay.addEventListener('click', evento => {
      if (evento.target === overlay) {
        fecharModal();
      }
    });

    document.body.appendChild(overlay);
    modal = overlay;

    for (const atendimento of atendimentos) {
      lista.appendChild(
        criarCardAtendimento(atendimento)
      );
    }
  }

  function criarCardAtendimento(atendimento) {
    const card = elemento(
      'div',
      'gnp-historico-card'
    );

    const topo = elemento(
      'div',
      'gnp-historico-card-topo'
    );

    const info = elemento(
      'div',
      'gnp-historico-card-info'
    );

    const protocolo = String(
      atendimento.protocol || 'Sem protocolo'
    );

    const nome = nomeDoAtendimento(atendimento);

    const departamento = String(
      atendimento.department?.name || '—'
    );

    const atendente = String(
      atendimento.attendant?.name || '—'
    );

    const dataInicio = formatarData(
      atendimento.date_start ||
      atendimento.created_at
    );

    const dataFim = atendimento.date_end
      ? formatarData(atendimento.date_end)
      : 'Em andamento';

    const titulo = elemento(
      'strong',
      '',
      'Protocolo: ' + protocolo
    );

    const detalhe = elemento('div');

    detalhe.textContent =
      `${nome || 'Contato'} | ${departamento}\n` +
      `Atendente: ${atendente}\n` +
      `${dataInicio} → ${dataFim}`;

    detalhe.style.whiteSpace = 'pre-line';

    info.append(titulo, detalhe);

    const botao = elemento(
      'button',
      'gnp-historico-acao',
      'Ver mensagens'
    );

    botao.type = 'button';

    topo.append(info, botao);

    const area = elemento(
      'div',
      'gnp-historico-mensagens'
    );

    card.append(topo, area);

    const estado = {
      carregando: false,
      iniciado: false,
      mais: true,
      cursor: null,
      cursores: new Set(),
      mensagens: new Set(),
      primeiraCarga: true
    };

    botao.addEventListener('click', async () => {
      if (area.style.display === 'block') {
        area.style.display = 'none';
        botao.textContent = 'Ver mensagens';
        return;
      }

      area.style.display = 'block';
      botao.textContent = 'Ocultar mensagens';

      if (!estado.iniciado) {
        estado.iniciado = true;
        await carregar();
      }
    });

    area.addEventListener('scroll', () => {
      if (
        area.scrollTop < 70 &&
        estado.mais &&
        !estado.carregando
      ) {
        carregar();
      }
    }, { passive: true });

    async function carregar() {
      if (
        estado.carregando ||
        !estado.mais ||
        !area.isConnected
      ) return;

      const id = idDoAtendimento(atendimento);

      if (id == null) {
        area.textContent =
          'ID do atendimento indisponível.';
        estado.mais = false;
        return;
      }

      estado.carregando = true;

      const aviso = elemento(
        'div',
        'gnp-historico-aviso',
        'Carregando mensagens...'
      );

      area.prepend(aviso);

      try {
        const resultado = await buscarMensagens(
          id,
          estado.cursor
        );

        if (!area.isConnected) return;

        const mensagensNovas =
          resultado.mensagens.filter(m => {
            const chave = String(
              m.id ||
              `${m.created_at}|${m.text}`
            );

            if (estado.mensagens.has(chave)) {
              return false;
            }

            estado.mensagens.add(chave);
            return true;
          });

        mensagensNovas.sort(
          (a, b) =>
            dataNumerica(a.created_at) -
            dataNumerica(b.created_at)
        );

        const alturaAnterior = area.scrollHeight;
        const scrollAnterior = area.scrollTop;

        const fragmento =
          document.createDocumentFragment();

        for (const mensagem of mensagensNovas) {
          fragmento.appendChild(
            criarMensagem(mensagem)
          );
        }

        area.insertBefore(
          fragmento,
          aviso.nextSibling
        );

        if (estado.primeiraCarga) {
          estado.primeiraCarga = false;
          area.scrollTop = area.scrollHeight;
        } else {
          area.scrollTop =
            scrollAnterior +
            area.scrollHeight -
            alturaAnterior;
        }

        const proximoCursor = resultado.cursor;

        estado.mais =
          resultado.mais &&
          Boolean(proximoCursor) &&
          !estado.cursores.has(proximoCursor) &&
          mensagensNovas.length > 0;

        if (proximoCursor) {
          estado.cursores.add(proximoCursor);
        }

        estado.cursor = proximoCursor;

        aviso.textContent = estado.mais
          ? '↑ Role para cima para carregar mensagens anteriores'
          : 'Fim das mensagens disponíveis';

      } catch (erro) {
        console.error(
          '[Komunic Histórico] Erro nas mensagens:',
          erro
        );

        aviso.textContent =
          'Erro ao carregar mensagens: ' +
          erro.message;

      } finally {
        estado.carregando = false;
      }
    }

    return card;
  }

  function criarMensagem(mensagem) {
    const remetente = String(
      mensagem.sender?.name ||
      (mensagem.from_system
        ? 'Atendente'
        : 'Contato')
    );

    // O retorno real usa from_system para mensagens
    // de atendentes. from_me pode vir false em ambas.
    const enviada = mensagem.from_system === true ||
      mensagem.key?.fromMe === true;

    const linha = elemento(
      'div',
      'gnp-historico-msg' +
      (enviada ? ' saida' : '')
    );

    const balao = elemento(
      'div',
      'gnp-historico-balao'
    );

    balao.appendChild(
      elemento(
        'div',
        'gnp-historico-remetente',
        remetente
      )
    );

    let texto = String(mensagem.text || '');

    const prefixo = `*${remetente}*:`;

    if (texto.startsWith(prefixo)) {
      texto = texto.slice(prefixo.length).trim();
    }

    if (texto) {
      balao.appendChild(
        elemento(
          'div',
          'gnp-historico-texto',
          texto
        )
      );
    }

    if (mensagem.file_s3 && mensagem.id) {
      const midia = elemento(
        'div',
        'gnp-historico-midia'
      );

      const botao = elemento(
        'button',
        'gnp-historico-acao',
        'Carregar anexo'
      );

      botao.type = 'button';

      botao.addEventListener('click', async () => {
        botao.disabled = true;
        botao.textContent = 'Carregando...';

        try {
          await carregarMidia(mensagem, midia);
          botao.remove();
        } catch (erro) {
          botao.disabled = false;
          botao.textContent = 'Tentar novamente';

          console.error(
            '[Komunic Histórico] Erro no anexo:',
            erro
          );
        }
      });

      midia.appendChild(botao);
      balao.appendChild(midia);
    }

    balao.appendChild(
      elemento(
        'div',
        'gnp-historico-data',
        formatarData(mensagem.created_at)
      )
    );

    linha.appendChild(balao);

    return linha;
  }

  async function carregarMidia(mensagem, container) {
    const url =
      BASE + '/messages/' +
      encodeURIComponent(mensagem.id) +
      '?inline=1';

    const resposta = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: '*/*' }
    });

    if (!resposta.ok) {
      throw new Error(
        'Não foi possível carregar o anexo: HTTP ' +
        resposta.status
      );
    }

    const blob = await resposta.blob();
    const objetoUrl = URL.createObjectURL(blob);

    const tipo = String(
      mensagem.type || ''
    ).toLowerCase();

    const mime = String(
      blob.type || ''
    ).toLowerCase();

    let arquivo;

    if (
      tipo === 'image' ||
      mime.startsWith('image/')
    ) {
      arquivo = elemento('img');
      arquivo.src = objetoUrl;
      arquivo.alt = mensagem.file_name || 'Imagem';
      arquivo.style.cursor = 'pointer';

      arquivo.onclick = () =>
        window.open(objetoUrl, '_blank');

    } else if (
      ['audio', 'ptt', 'voice'].includes(tipo) ||
      mime.startsWith('audio/')
    ) {
      arquivo = elemento('audio');
      arquivo.controls = true;
      arquivo.src = objetoUrl;

    } else if (
      tipo === 'video' ||
      mime.startsWith('video/')
    ) {
      arquivo = elemento('video');
      arquivo.controls = true;
      arquivo.src = objetoUrl;

    } else {
      arquivo = elemento(
        'a',
        '',
        'Abrir ' +
        (mensagem.file_name || 'documento')
      );

      arquivo.href = objetoUrl;
      arquivo.target = '_blank';
      arquivo.rel = 'noopener noreferrer';
    }

    container.appendChild(arquivo);

    // O blob é liberado quando a janela de histórico
    // for fechada, evitando invalidar o anexo aberto.
    if (!modal._urlsMidia) {
      modal._urlsMidia = new Set();
    }

    modal._urlsMidia.add(objetoUrl);
  }

  async function abrirHistorico() {
    if (abrindo) return;

    const nome = nomeContatoAtual();

    if (!nome) {
      alert(
        'Não foi possível identificar o contato ' +
        'da conversa atual.'
      );
      return;
    }

    abrindo = true;

    const botao = $('#btn-historico-chat');

    if (botao) {
      botao.disabled = true;
      botao.title = 'Pesquisando atendimentos...';
      botao.style.opacity = '.5';
    }

    try {
      const atendimentos =
        await buscarAtendimentosPorNome(nome);

      if (!atendimentos.length) {
        alert(
          'Nenhum atendimento localizado para "' +
          nome + '".\n\n' +
          'A pesquisa foi realizada na tela ' +
          'Gestão de Atendimentos.'
        );

        return;
      }

      abrirModal(nome, atendimentos);

    } catch (erro) {
      console.error(
        '[Komunic Histórico] Erro:',
        erro
      );

      alert(
        'Não foi possível consultar o histórico.\n\n' +
        erro.message
      );

    } finally {
      abrindo = false;

      if (botao) {
        botao.disabled = false;
        botao.title = 'Histórico do contato';
        botao.style.opacity = '1';
      }
    }
  }

  function adicionarBotao() {
    if (!location.pathname.includes('/newchat')) {
      return;
    }

    const params = new URLSearchParams(
      location.search
    );

    if (!params.has('chat')) return;

    if ($('#btn-historico-chat')) return;

    const container = $('.flex.mr-2');

    if (!container) return;

    const botao = elemento('button');
    botao.id = 'btn-historico-chat';
    botao.type = 'button';
    botao.title = 'Histórico do contato';

    botao.className =
      'rounded-full flex items-center justify-center ' +
      'w-10 h-10 hover:bg-gray-100 ' +
      'border border-gray-300';

    botao.style.cursor = 'pointer';

    botao.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg"
        width="23"
        height="23"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#16a34a"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round">
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M12 7v5l3 2"></path>
      </svg>
    `;

    botao.addEventListener(
      'click',
      abrirHistorico
    );

    container.insertBefore(
      botao,
      container.firstChild
    );
  }

  function iniciar() {
    criarEstilos();

    if (observadorBotao) {
      observadorBotao.disconnect();
    }

    let pendente = false;

    observadorBotao = new MutationObserver(() => {
      if (pendente) return;

      pendente = true;

      requestAnimationFrame(() => {
        pendente = false;

        if (location.href !== ultimaUrl) {
          ultimaUrl = location.href;
          fecharModal();
        }

        adicionarBotao();
      });
    });

    observadorBotao.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );

    adicionarBotao();

    console.log(
      '[Komunic Histórico] Versão 4.3 iniciada.'
    );
  }

  iniciar();

})();

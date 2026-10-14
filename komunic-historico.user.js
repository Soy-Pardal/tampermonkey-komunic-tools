
 // ==UserScript==
 // @name         Komunic - Histórico do Contato (Rolagem Infinita + Mídias)
 // @namespace    http://tampermonkey.net/
 // @version      3.8
 // @description  Histórico de atendimentos com mensagens, mídias e rolagem infinita
 // @author       Gabriel
 // @match        https://app.komunic.net/*
 // @grant        GM_xmlhttpRequest
 // @connect      app.komunic.net
 // ==/UserScript==

(function () {
  'use strict';

  const BASE = 'https://app.komunic.net';
  const COR = '#1fdd09';
  const LIMITE = 10;

  const escapeHtml = valor =>
    String(valor ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;',
      '"': '&quot;', "'": '&#39;'
    }[c]));

  const normalizar = valor =>
    String(valor || '').trim().replace(/\s+/g, ' ')
      .toLocaleLowerCase('pt-BR');

  const criar = (tag, classe = '', texto = '') => {
    const el = document.createElement(tag);
    el.className = classe;
    el.textContent = texto;
    return el;
  };

  function nomeContatoAtual() {
    return document.querySelector(
      '[data-testid="chat-top-contact-name"]'
    )?.textContent?.trim() || '';
  }

  function csrf() {
    const token = document.cookie.match(
      /(?:^|;\s*)XSRF-TOKEN=([^;]+)/
    );
    if (!token) return '';
    try {
      return decodeURIComponent(token[1]);
    } catch {
      return token[1];
    }
  }

  function versaoInertia() {
    try {
      const script = document.querySelector(
        'script[data-page="app"][type="application/json"]'
      );
      return script
        ? JSON.parse(script.textContent).version || ''
        : '';
    } catch {
      return '';
    }
  }

  function requisicao(url) {
    return new Promise((resolve, reject) => {
      const pesquisa = /\/live-history\/contact\?/.test(url);
      const headers = {
        accept: pesquisa
          ? 'text/html, application/xhtml+xml'
          : 'application/json, text/plain, */*',
        'x-requested-with': 'XMLHttpRequest'
      };

      const token = csrf();
      if (token) headers['x-xsrf-token'] = token;

      if (pesquisa) {
        headers['x-inertia'] = 'true';
        headers['x-inertia-version'] = versaoInertia();
        headers['x-inertia-partial-component'] =
          'Tenant/LiveCallHistoryContact';
        headers['x-inertia-partial-data'] = 'contacts';
      }

      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers,
        responseType: 'json',
        timeout: 20000,
        onload: resposta => {
          if (resposta.status < 200 || resposta.status >= 300) {
            reject(new Error(`HTTP ${resposta.status}`));
            return;
          }
          try {
            const dados = resposta.response ??
              JSON.parse(resposta.responseText);
            resolve(typeof dados === 'string'
              ? JSON.parse(dados) : dados);
          } catch {
            reject(new Error('Resposta JSON inválida'));
          }
        },
        onerror: () => reject(new Error('Erro de conexão')),
        ontimeout: () => reject(new Error('Tempo excedido'))
      });
    });
  }

  function listaDados(data, tipo) {
    if (Array.isArray(data)) return data;

    const candidatos = tipo === 'contatos' ? [
      data?.props?.contacts?.data,
      data?.props?.contacts,
      data?.contacts?.data,
      data?.contacts,
      data?.data?.contacts,
      data?.data
    ] : tipo === 'atendimentos' ? [
      data?.props?.sessions?.data,
      data?.props?.histories?.data,
      data?.props?.attendances?.data,
      data?.sessions?.data,
      data?.histories?.data,
      data?.attendances?.data,
      data?.sessions,
      data?.histories,
      data?.attendances,
      data?.data?.data,
      data?.data
    ] : [
      data?.messages?.data,
      data?.messages,
      data?.data?.messages,
      data?.data?.data,
      data?.data
    ];

    return candidatos.find(Array.isArray) || [];
  }

  function paginacao(data, tipo, quantidade, limite) {
    const candidatos = tipo === 'atendimentos' ? [
      data?.props?.sessions,
      data?.props?.histories,
      data?.props?.attendances,
      data?.sessions,
      data?.histories,
      data?.attendances,
      data?.data,
      data
    ] : [
      data?.pagination,
      data?.messages,
      data?.data?.messages,
      data?.data,
      data
    ];

    const meta = candidatos.find(v =>
      v && typeof v === 'object' && !Array.isArray(v) &&
      (
        v.current_page !== undefined ||
        v.last_page !== undefined ||
        v.next_page_url !== undefined ||
        v.has_more !== undefined ||
        v.next_cursor !== undefined
      )
    );

    if (tipo === 'mensagens') {
      return {
        mais: meta?.has_more === true &&
          Boolean(meta?.next_cursor),
        cursor: meta?.next_cursor || null,
        estimado: !meta
      };
    }

    if (meta?.next_page_url !== undefined) {
      return { mais: Boolean(meta.next_page_url) };
    }
    if (meta?.has_more !== undefined) {
      return { mais: Boolean(meta.has_more) };
    }
    if (meta?.current_page !== undefined &&
        meta?.last_page !== undefined) {
      return {
        mais: Number(meta.current_page) <
          Number(meta.last_page)
      };
    }

    return { mais: quantidade >= limite, estimado: true };
  }

  async function buscarContato(nome) {
    const termo = nome.split(/[\s\-–—]/)[0].trim();
    const dados = await requisicao(
      `${BASE}/live-history/contact?term=${
        encodeURIComponent(termo)
      }`
    );
    return listaDados(dados, 'contatos');
  }

  async function buscarAtendimentos(id, pagina) {
    const dados = await requisicao(
      `${BASE}/live-history/contact/${
        encodeURIComponent(id)
      }?page=${pagina}&term=`
    );
    const lista = listaDados(dados, 'atendimentos');
    return {
      lista,
      paginacao: paginacao(dados, 'atendimentos',
        lista.length, 15)
    };
  }

  async function buscarMensagens(id, cursor = null) {
    let url = `${BASE}/live-history-chat/${
      encodeURIComponent(id)
    }?limit=${LIMITE}`;

    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

    const dados = await requisicao(url);
    const lista = listaDados(dados, 'mensagens');

    return {
      lista,
      paginacao: paginacao(dados, 'mensagens',
        lista.length, LIMITE)
    };
  }

  const css = `
    #modal-historico {
      position:fixed;inset:0;z-index:100002;
      display:flex;align-items:center;justify-content:center;
      background:rgba(0,0,0,.6);
      font-family:Inter,system-ui,sans-serif;
    }
    #modal-historico * {box-sizing:border-box}
    #modal-historico .historico-content {
      width:95%;max-width:850px;height:85vh;
      max-height:850px;background:white;border-radius:16px;
      display:flex;flex-direction:column;overflow:hidden;
      box-shadow:0 20px 40px rgba(0,0,0,.2);
    }
    #modal-historico .historico-header {
      background:${COR};color:#102010;padding:14px 20px;
      display:flex;align-items:center;
      justify-content:space-between;font-weight:700;
    }
    #modal-historico .historico-fechar {
      border:0;background:transparent;font-size:26px;
      cursor:pointer;
    }
    #modal-historico .historico-lista {
      flex:1;min-height:0;overflow-y:auto;padding:16px;
    }
    #modal-historico .historico-card {
      border:1px solid #e5e7eb;border-radius:12px;
      overflow:hidden;background:#fafafa;margin-bottom:12px;
    }
    #modal-historico .historico-card-topo {
      background:#f3f4f6;padding:12px;
      font-size:13px;line-height:1.6;
    }
    #modal-historico .historico-card-corpo {
      padding:10px 12px;
    }
    #modal-historico .historico-botao {
      background:${COR};border:0;border-radius:20px;
      padding:8px 14px;font-size:12px;font-weight:600;
      cursor:pointer;
    }
    #modal-historico .historico-mensagens {
      display:none;max-height:350px;overflow-y:auto;
      margin-top:12px;padding:6px;background:white;
      border:1px solid #e5e7eb;border-radius:10px;
    }
    #modal-historico .historico-mensagem {
      display:flex;margin-bottom:8px;
    }
    #modal-historico .historico-balao {
      max-width:80%;border-radius:14px;padding:9px 12px;
      font-size:12px;overflow-wrap:anywhere;
    }
    #modal-historico .historico-aviso {
      padding:12px;text-align:center;
      color:#6b7280;font-size:12px;
    }
    #modal-historico .historico-midia img {
      display:block;max-width:100%;max-height:300px;
      border-radius:8px;cursor:zoom-in;
    }
    #modal-historico .historico-midia video {
      max-width:100%;max-height:300px;border-radius:8px;
    }
    #modal-historico .historico-midia audio {
      max-width:100%;width:270px;
    }
    #modal-historico .historico-midia a {
      color:#1d4ed8;text-decoration:underline;
    }
  `;

  const style = criar('style');
  style.id = 'komunic-historico-estilos';
  style.textContent = css;
  document.querySelector('#komunic-historico-estilos')?.remove();
  document.head.appendChild(style);

  let modalAtual = null;
  let sessaoMidias = null;

  function fecharModal() {
    if (sessaoMidias) {
      sessaoMidias.encerrar();
      sessaoMidias = null;
    }
    modalAtual?.remove();
    modalAtual = null;
  }

  function gerenciadorMidias() {
    const urls = new Set();
    const controllers = new Set();
    const pendentes = new Set();
    let encerrado = false;

    const observer = new IntersectionObserver(entradas => {
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        observer.unobserve(entrada.target);
        pendentes.delete(entrada.target);
        entrada.target._carregar?.();
      }
    }, { rootMargin: '250px' });

    return {
      observar(el) {
        if (encerrado) return;
        pendentes.add(el);
        observer.observe(el);
      },
      async carregar(m, container, aviso) {
        if (encerrado || !container.isConnected) return;

        const controller = new AbortController();
        controllers.add(controller);
        aviso.textContent = '⏳ Carregando anexo...';

        const caminho =
          `/messages/${encodeURIComponent(m.id)}?inline=1`;

        try {
          const resposta = await fetch(caminho, {
            credentials: 'same-origin',
            headers: { Accept: '*/*' },
            signal: controller.signal
          });

          if (!resposta.ok) {
            throw new Error(`HTTP ${resposta.status}`);
          }

          const blob = await resposta.blob();

          if (encerrado || !container.isConnected) return;

          const url = URL.createObjectURL(blob);
          urls.add(url);

          const tipo = String(m.type || '').toLowerCase();
          const mime = String(blob.type || '').toLowerCase();
          const nome = String(m.file_name || 'Arquivo');

          let elemento;

          if (tipo === 'image' || mime.startsWith('image/')) {
            elemento = criar('img');
            elemento.src = url;
            elemento.alt = nome;
            elemento.loading = 'lazy';
            elemento.title = 'Clique para ampliar';
            elemento.addEventListener('click', () => {
              window.open(url, '_blank', 'noopener');
            });

          } else if (
            ['audio', 'ptt', 'voice'].includes(tipo) ||
            mime.startsWith('audio/')
          ) {
            elemento = criar('audio');
            elemento.controls = true;
            elemento.preload = 'metadata';
            elemento.src = url;

          } else if (
            tipo === 'video' || mime.startsWith('video/')
          ) {
            elemento = criar('video');
            elemento.controls = true;
            elemento.preload = 'metadata';
            elemento.src = url;

          } else {
            elemento = criar('a', '', `📄 Abrir ${nome}`);
            elemento.href = url;
            elemento.target = '_blank';
            elemento.rel = 'noopener noreferrer';
          }

          aviso.replaceWith(elemento);

        } catch (erro) {
          if (erro.name === 'AbortError') return;

          aviso.textContent =
            `⚠️ Não foi possível carregar (${erro.message}). `;

          const abrir = criar('a', '', 'Tentar abrir');
          abrir.href = caminho;
          abrir.target = '_blank';
          abrir.rel = 'noopener noreferrer';
          aviso.appendChild(abrir);

        } finally {
          controllers.delete(controller);
        }
      },
      encerrar() {
        encerrado = true;
        observer.disconnect();
        pendentes.clear();

        for (const controller of controllers) controller.abort();
        controllers.clear();

        for (const url of urls) URL.revokeObjectURL(url);
        urls.clear();
      }
    };
  }

  function dataMensagem(valor) {
    if (!valor) return '';
    const d = new Date(valor);
    return Number.isNaN(d.getTime())
      ? String(valor)
      : d.toLocaleString('pt-BR');
  }

  function criarMensagem(m, nomeContato) {
    const remetente = String(
      m.sender?.name || (m.from_me ? 'Atendente' : 'Cliente')
    );

    const primeiroNome = normalizar(nomeContato).split(' ')[0];
    const nomeRemetente = normalizar(remetente);

    const isCliente = Boolean(primeiroNome) && (
      nomeRemetente === normalizar(nomeContato) ||
      nomeRemetente.split(' ')[0] === primeiroNome
    );

    const esquerda = m.from_me === false ||
      (m.from_me == null && isCliente);

    const item = criar('div', 'historico-mensagem');
    item.style.justifyContent = esquerda
      ? 'flex-start' : 'flex-end';

    const balao = criar('div', 'historico-balao');
    balao.style.background = esquerda
      ? '#f3f4f6' : '#dbeafe';

    const cabecalho = criar('div', '', remetente);
    cabecalho.style.cssText =
      'font-weight:700;font-size:11px;margin-bottom:4px';
    balao.appendChild(cabecalho);

    const tipo = String(m.type || 'text').toLowerCase();
    const temArquivo = Boolean(
      m.id && m.file_s3 &&
      !['deleted', 'deleting'].includes(tipo)
    );

    let texto = String(m.text || '');
    const prefixo = `*${remetente}*:`;

    if (texto.startsWith(prefixo)) {
      texto = texto.slice(prefixo.length).trim();
    }

    if (texto || !temArquivo) {
      const conteudo = criar(
        'div', '', texto || '[Mensagem não textual]'
      );
      conteudo.style.whiteSpace = 'pre-wrap';
      balao.appendChild(conteudo);
    }

    if (temArquivo) {
      const midia = criar('div', 'historico-midia');
      midia.style.marginTop = '7px';

      const nome = criar(
        'div', '', String(m.file_name || 'Anexo')
      );
      nome.style.cssText =
        'font-size:11px;color:#475569;margin-bottom:5px';

      const aviso = criar(
        'div', '', '⏳ Aguardando mídia...'
      );
      aviso.style.cssText =
        'font-size:12px;color:#64748b';

      midia.append(nome, aviso);
      balao.appendChild(midia);

      midia._carregar = () =>
        sessaoMidias?.carregar(m, midia, aviso);

      sessaoMidias?.observar(midia);
    }

    const horario = criar(
      'div', '', dataMensagem(m.created_at)
    );
    horario.style.cssText =
      'font-size:10px;color:#6b7280;margin-top:6px';

    balao.appendChild(horario);
    item.appendChild(balao);
    return item;
  }

  function criarCard(atendimento, nomeContato) {
    const card = criar('div', 'historico-card');
    const topo = criar('div', 'historico-card-topo');

    const status = atendimento.status || 'desconhecido';
    const corStatus = status === 'closed'
      ? '#10b981' : status === 'open' ? COR : '#6b7280';

    topo.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:8px">
        <strong>🔖 Protocolo:
          ${escapeHtml(atendimento.protocol || 'N/A')}
        </strong>
        <span>
          <span style="display:inline-block;width:9px;height:9px;
            border-radius:50%;background:${corStatus}"></span>
          ${escapeHtml(status)}
        </span>
      </div>
      <div style="color:#4b5563">
        📅 ${escapeHtml(atendimento.date_start || '—')}
        ${atendimento.date_end
          ? ' → ' + escapeHtml(atendimento.date_end)
          : ' (em andamento)'}
      </div>
      <div style="color:#4b5563">
        👤 ${escapeHtml(atendimento.attendant?.name || '—')}
        |
        🏢 ${escapeHtml(atendimento.department?.name || '—')}
      </div>
    `;

    const corpo = criar('div', 'historico-card-corpo');
    const botao = criar(
      'button', 'historico-botao', '💬 Ver mensagens'
    );
    botao.type = 'button';

    const area = criar('div', 'historico-mensagens');
    corpo.append(botao, area);
    card.append(topo, corpo);

    const estado = {
      cursor: null,
      carregando: false,
      mais: true,
      inicializado: false,
      primeiraCarga: true,
      ids: new Set(),
      assinaturaAnterior: '',
      cursoresUsados: new Set()
    };

    const chave = m => String(
      m.id ?? m.uuid ??
      [m.created_at, m.sender?.name, m.text, m.from_me]
        .join('|')
    );

    async function carregarMensagens() {
      if (
        estado.carregando ||
        !estado.mais ||
        !area.isConnected
      ) return;

      estado.carregando = true;

      let aviso = area.querySelector(
        '.historico-aviso-carga'
      );

      if (!aviso) {
        aviso = criar(
          'div',
          'historico-aviso historico-aviso-carga'
        );
        area.prepend(aviso);
      }

      aviso.textContent = '⏳ Carregando mensagens...';

      try {
        const cursorAtual = estado.cursor;
        const resultado = await buscarMensagens(
          atendimento.id, cursorAtual
        );

        if (!area.isConnected) return;

        const assinatura = resultado.lista.map(chave).join('||');

        if (
          assinatura &&
          assinatura === estado.assinaturaAnterior
        ) {
          estado.mais = false;
          aviso.textContent =
            'O servidor repetiu o mesmo lote.';
          return;
        }

        estado.assinaturaAnterior = assinatura;

        const novas = resultado.lista.filter(m => {
          const id = chave(m);
          if (estado.ids.has(id)) return false;
          estado.ids.add(id);
          return true;
        });

        novas.sort((a, b) =>
          (new Date(a.created_at || 0).getTime() || 0) -
          (new Date(b.created_at || 0).getTime() || 0)
        );

        const alturaAnterior = area.scrollHeight;
        const scrollAnterior = area.scrollTop;

        const fragmento = document.createDocumentFragment();

        for (const m of novas) {
          fragmento.appendChild(
            criarMensagem(m, nomeContato)
          );
        }

        area.insertBefore(fragmento, aviso.nextSibling);

        if (estado.primeiraCarga) {
          estado.primeiraCarga = false;
          area.scrollTop = area.scrollHeight;
        } else {
          area.scrollTop = scrollAnterior +
            area.scrollHeight - alturaAnterior;
        }

        const proximo = resultado.paginacao.cursor;

        estado.mais =
          Boolean(resultado.paginacao.mais) &&
          Boolean(proximo) &&
          !estado.cursoresUsados.has(proximo) &&
          novas.length > 0;

        if (cursorAtual) {
          estado.cursoresUsados.add(cursorAtual);
        }

        estado.cursor = proximo;

        aviso.textContent = estado.mais
          ? '↑ Role para cima para carregar mensagens anteriores'
          : '✓ Fim das mensagens disponíveis';

      } catch (erro) {
        console.error('[Komunic Histórico]', erro);
        aviso.textContent =
          `❌ Falha: ${erro.message}. Role novamente para tentar.`;
      } finally {
        estado.carregando = false;
      }
    }

    botao.addEventListener('click', async () => {
      if (area.style.display === 'block') {
        area.style.display = 'none';
        botao.textContent = '💬 Ver mensagens';
        return;
      }

      area.style.display = 'block';
      botao.textContent = '▲ Ocultar mensagens';

      if (!estado.inicializado) {
        estado.inicializado = true;
        await carregarMensagens();
      }
    });

    area.addEventListener('scroll', () => {
      if (
        area.scrollTop <= 65 &&
        estado.inicializado &&
        estado.mais &&
        !estado.carregando
      ) carregarMensagens();
    }, { passive: true });

    return card;
  }

  function mostrarModal(nomeContato, contatoId) {
    fecharModal();
    sessaoMidias = gerenciadorMidias();

    const modal = criar('div');
    modal.id = 'modal-historico';

    const content = criar('div', 'historico-content');
    const header = criar('div', 'historico-header');

    const titulo = criar(
      'span', '',
      `📜 Histórico de Atendimentos — ${nomeContato}`
    );

    const fechar = criar(
      'button', 'historico-fechar', '×'
    );
    fechar.type = 'button';
    fechar.addEventListener('click', fecharModal);

    header.append(titulo, fechar);

    const lista = criar('div', 'historico-lista');
    const rodape = criar(
      'div', 'historico-aviso', 'Preparando histórico...'
    );

    content.append(header, lista, rodape);
    modal.appendChild(content);
    document.body.appendChild(modal);
    modalAtual = modal;

    modal.addEventListener('click', e => {
      if (e.target === modal) fecharModal();
    });

    const estado = {
      pagina: 1,
      carregando: false,
      mais: true,
      ids: new Set(),
      total: 0,
      assinaturaAnterior: '',
      semNovos: 0
    };

    async function carregarAtendimentos() {
      if (
        estado.carregando ||
        !estado.mais ||
        !modal.isConnected
      ) return;

      estado.carregando = true;
      rodape.textContent = '⏳ Carregando atendimentos...';

      try {
        const resultado = await buscarAtendimentos(
          contatoId, estado.pagina
        );

        if (!modal.isConnected) return;

        const atendimentos = resultado.lista;
        const assinatura = atendimentos
          .map(a => String(a.id)).join('|');

        if (
          assinatura &&
          assinatura === estado.assinaturaAnterior
        ) {
          estado.mais = false;
          rodape.textContent =
            'O servidor repetiu a página anterior.';
          return;
        }

        estado.assinaturaAnterior = assinatura;

        if (estado.pagina === 1) {
          atendimentos.sort((a, b) =>
            new Date(b.date_start || 0) -
            new Date(a.date_start || 0)
          );
        }

        let novos = 0;

        for (const atendimento of atendimentos) {
          const id = String(atendimento.id);
          if (estado.ids.has(id)) continue;

          estado.ids.add(id);
          lista.appendChild(
            criarCard(atendimento, nomeContato)
          );
          novos++;
          estado.total++;
        }

        estado.semNovos = novos === 0
          ? estado.semNovos + 1 : 0;

        estado.mais =
          Boolean(resultado.paginacao.mais) &&
          estado.semNovos < 2;

        estado.pagina++;

        rodape.textContent = estado.mais
          ? `${estado.total} atendimento(s). ↓ Role para carregar mais.`
          : `${estado.total} atendimento(s). ✓ Fim do histórico.`;

        if (estado.total === 0) {
          rodape.textContent =
            'Nenhum atendimento encontrado.';
        }

      } catch (erro) {
        console.error('[Komunic Histórico]', erro);
        rodape.textContent =
          `❌ Erro: ${erro.message}. Role novamente para tentar.`;
      } finally {
        estado.carregando = false;
      }
    }

    lista.addEventListener('scroll', () => {
      const distancia =
        lista.scrollHeight -
        lista.scrollTop -
        lista.clientHeight;

      if (
        distancia < 160 &&
        estado.mais &&
        !estado.carregando
      ) carregarAtendimentos();
    }, { passive: true });

    carregarAtendimentos();
  }

  let abrindo = false;

  async function exibirHistorico() {
    if (abrindo) return;

    const nome = nomeContatoAtual();

    if (!nome) {
      alert('Não foi possível identificar o contato.');
      return;
    }

    abrindo = true;

    try {
      const contatos = await buscarContato(nome);

      const exato = contatos.find(
        c => normalizar(c.name) === normalizar(nome)
      );

      if (!exato) {
        alert(
          `Não foi possível confirmar o contato "${nome}" na pesquisa.`
        );
        return;
      }

      mostrarModal(exato.name || nome, exato.id);

    } catch (erro) {
      console.error('[Komunic Histórico]', erro);
      alert(`Erro ao carregar histórico: ${erro.message}`);
    } finally {
      abrindo = false;
    }
  }

  function adicionarBotao() {
    if (!location.pathname.includes('/newchat')) return;
    if (!new URLSearchParams(location.search).has('chat')) return;

    const container = document.querySelector('.flex.mr-2');
    if (!container) return;
    if (document.querySelector('#btn-historico-chat')) return;

    const botao = criar('button');
    botao.id = 'btn-historico-chat';
    botao.type = 'button';

    botao.className =
      'rounded-full flex items-center justify-center ' +
      'w-10 h-10 hover:bg-gray-100 border border-gray-300';

    botao.style.cursor = 'pointer';
    botao.title = 'Histórico do contato';

    botao.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg"
        fill="none" viewBox="0 0 24 24"
        stroke-width="1.5" stroke="currentColor"
        class="h-6 w-6" style="color:${COR}">
        <path stroke-linecap="round"
          stroke-linejoin="round"
          d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
      </svg>
    `;

    botao.addEventListener('click', exibirHistorico);
    container.insertBefore(botao, container.firstChild);
  }

  let ultimaUrl = location.href;
  let verificacaoPendente = false;

  function verificarBotao() {
    if (verificacaoPendente) return;
    verificacaoPendente = true;

    requestAnimationFrame(() => {
      verificacaoPendente = false;

      if (location.href !== ultimaUrl) {
        ultimaUrl = location.href;
        fecharModal();
      }

      adicionarBotao();
    });
  }

  new MutationObserver(verificarBotao).observe(
    document.body,
    { subtree: true, childList: true }
  );

  adicionarBotao();

})();


 // ==UserScript==
 // @name         Komunic - Histórico do Contato (Rolagem Infinita)
 // @namespace    http://tampermonkey.net/
 // @version      3.3
 // @description  Histórico de atendimentos e mensagens com carregamento progressivo
 // @author       Gabriel
 // @match        https://app.komunic.net/*
 // @grant        GM_xmlhttpRequest
 // @connect      app.komunic.net
 // ==/UserScript==

 (function () {
   'use strict';

   const COR_PRINCIPAL = '#1fdd09';
   const BASE = 'https://app.komunic.net';
   const LIMITE_MENSAGENS = 50;

   const escapeHtml = (value) =>
     String(value ?? '').replace(/[&<>"']/g, (char) => ({
       '&': '&amp;',
       '<': '&lt;',
       '>': '&gt;',
       '"': '&quot;',
       "'": '&#39;'
     }[char]));

   const getNomeContato = () => {
     const el = document.querySelector(
       '.chat-top-area .font-bold.cursor-pointer, ' +
       '.chat-top-area p.font-bold, ' +
       '.messages-col .font-bold.cursor-pointer'
     );

     if (el) return el.innerText.trim();

     const active = document.querySelector(
       '.cursor-pointer.bg-gray-50, .cursor-pointer.bg-gray-100'
     );

     return active?.querySelector('.font-bold')?.innerText.trim() || '';
   };

   const csrf = () => {
     const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
     return match ? decodeURIComponent(match[1]) : '';
   };

   const inertiaVersion = () => {
     try {
       return JSON.parse(
         document.querySelector('#app')?.getAttribute('data-page') || '{}'
       ).version || '';
     } catch {
       return '';
     }
   };

   const req = (url, options = {}) => new Promise((resolve, reject) => {
     const headers = {
       accept: 'application/json, text/plain, */*',
       'x-requested-with': 'XMLHttpRequest',
       'x-xsrf-token': csrf()
     };

     if (url.includes('/live-history/contact')) {
       headers['x-inertia'] = 'true';
       headers['x-inertia-version'] = inertiaVersion();

       if (url.includes('?term=')) {
         headers['x-inertia-partial-component'] =
           'Tenant/LiveCallHistoryContact';
         headers['x-inertia-partial-data'] = 'contacts';
       }
     }

     GM_xmlhttpRequest({
       method: 'GET',
       url,
       headers,
       responseType: 'json',
       timeout: 20000,
       onload: (response) => {
         if (response.status < 200 || response.status >= 300) {
           reject(new Error(`HTTP ${response.status}`));
           return;
         }

         try {
           const data = response.response ??
             JSON.parse(response.responseText);
           resolve(data);
         } catch {
           reject(new Error('Resposta JSON inválida'));
         }
       },
       ontimeout: () => reject(new Error('Tempo limite excedido')),
       onerror: () => reject(new Error('Erro de conexão'))
     });
   });

   function extrairLista(data, tipo) {
     if (Array.isArray(data)) return data;

     const candidates = tipo === 'contatos'
       ? [
           data?.props?.contacts?.data,
           data?.contacts?.data,
           data?.data
         ]
       : tipo === 'atendimentos'
       ? [
           data?.props?.sessions?.data,
           data?.props?.histories?.data,
           data?.props?.attendances?.data,
           data?.sessions?.data,
           data?.histories?.data,
           data?.data?.data,
           data?.data
         ]
       : [
           data?.messages?.data,
           data?.messages,
           data?.data?.messages,
           data?.data?.data,
           data?.data
         ];

     return candidates.find(Array.isArray) || [];
   }

   function extrairPaginacao(data, tipo, quantidade, limite) {
     const candidates = tipo === 'atendimentos'
       ? [
           data?.props?.sessions,
           data?.props?.histories,
           data?.props?.attendances,
           data?.sessions,
           data?.histories,
           data?.data,
           data
         ]
       : [
           data?.messages,
           data?.data?.messages,
           data?.data,
           data
         ];

     const meta = candidates.find((item) =>
       item && typeof item === 'object' &&
       !Array.isArray(item) &&
       (
         item.current_page !== undefined ||
         item.last_page !== undefined ||
         item.next_page_url !== undefined ||
         item.has_more !== undefined ||
         item.next_cursor !== undefined
       )
     );

     if (meta) {
       if (meta.next_cursor) {
         return { mais: true, cursor: meta.next_cursor };
       }

       if (meta.next_page_url !== undefined) {
         return { mais: Boolean(meta.next_page_url) };
       }

       if (meta.has_more !== undefined) {
         return { mais: Boolean(meta.has_more) };
       }

       if (meta.current_page !== undefined &&
           meta.last_page !== undefined) {
         return {
           mais: Number(meta.current_page) < Number(meta.last_page)
         };
       }
     }

     // Sem metadados, só podemos fazer uma tentativa de próxima página
     // quando o lote vier cheio. Isso não confirma a paginação.
     return {
       mais: quantidade >= limite,
       estimado: true
     };
   }

   async function buscarContato(nome) {
     const data = await req(
       `${BASE}/live-history/contact?term=${encodeURIComponent(nome)}`
     );

     return extrairLista(data, 'contatos');
   }

   async function buscarAtendimentos(id, pagina) {
     const data = await req(
       `${BASE}/live-history/contact/${encodeURIComponent(id)}` +
       `?page=${pagina}&term=`
     );

     const lista = extrairLista(data, 'atendimentos');

     return {
       lista,
       paginacao: extrairPaginacao(
         data, 'atendimentos', lista.length, 15
       )
     };
   }

   async function buscarMensagens(id, pagina) {
     const data = await req(
       `${BASE}/live-history-chat/${encodeURIComponent(id)}` +
       `?limit=${LIMITE_MENSAGENS}&page=${pagina}`
     );

     const lista = extrairLista(data, 'mensagens');

     return {
       lista,
       paginacao: extrairPaginacao(
         data, 'mensagens', lista.length, LIMITE_MENSAGENS
       )
     };
   }

   const estilos = `
     #modal-historico {
       position: fixed;
       inset: 0;
       background: rgba(0,0,0,.6);
       z-index: 100002;
       display: flex;
       align-items: center;
       justify-content: center;
       backdrop-filter: blur(2px);
       font-family: Inter, system-ui, sans-serif;
     }

     #modal-historico * {
       box-sizing: border-box;
     }

     #modal-historico .historico-content {
       width: 95%;
       max-width: 850px;
       height: 85vh;
       max-height: 850px;
       background: white;
       border-radius: 16px;
       display: flex;
       flex-direction: column;
       overflow: hidden;
       box-shadow: 0 20px 40px rgba(0,0,0,.2);
     }

     #modal-historico .historico-header {
       background: ${COR_PRINCIPAL};
       color: #102010;
       padding: 14px 20px;
       display: flex;
       justify-content: space-between;
       align-items: center;
       font-weight: 700;
       flex-shrink: 0;
     }

     #modal-historico .historico-fechar {
       border: none;
       background: transparent;
       color: #102010;
       font-size: 26px;
       cursor: pointer;
     }

     #modal-historico .historico-lista {
       flex: 1;
       overflow-y: auto;
       padding: 16px;
       min-height: 0;
     }

     #modal-historico .historico-card {
       border: 1px solid #e5e7eb;
       border-radius: 12px;
       overflow: hidden;
       background: #fafafa;
       margin-bottom: 12px;
     }

     #modal-historico .historico-card-topo {
       background: #f3f4f6;
       padding: 12px;
       font-size: 13px;
       line-height: 1.6;
     }

     #modal-historico .historico-card-corpo {
       padding: 10px 12px;
     }

     #modal-historico .historico-botao {
       background: ${COR_PRINCIPAL};
       color: #102010;
       border: none;
       border-radius: 20px;
       padding: 8px 14px;
       font-size: 12px;
       font-weight: 600;
       cursor: pointer;
     }

     #modal-historico .historico-mensagens {
       display: none;
       max-height: 350px;
       overflow-y: auto;
       margin-top: 12px;
       padding: 6px;
       background: #fff;
       border: 1px solid #e5e7eb;
       border-radius: 10px;
     }

     #modal-historico .historico-mensagem {
       display: flex;
       margin-bottom: 8px;
     }

     #modal-historico .historico-balao {
       max-width: 80%;
       border-radius: 14px;
       padding: 9px 12px;
       font-size: 12px;
       overflow-wrap: anywhere;
     }

     #modal-historico .historico-aviso {
       padding: 12px;
       text-align: center;
       color: #6b7280;
       font-size: 12px;
     }

     #modal-historico .historico-erro {
       color: #dc2626;
     }
   `;

   if (!document.querySelector('#komunic-historico-estilos')) {
     const style = document.createElement('style');
     style.id = 'komunic-historico-estilos';
     style.textContent = estilos;
     document.head.appendChild(style);
   }

   let modalAtual = null;

   function fecharModal() {
     modalAtual?.remove();
     modalAtual = null;
   }

   function criarElemento(tag, classe, texto = '') {
     const el = document.createElement(tag);
     if (classe) el.className = classe;
     if (texto) el.textContent = texto;
     return el;
   }

   function formatarData(data) {
     if (!data) return '—';
     return String(data);
   }

   function formatarDataMensagem(data) {
     if (!data) return '';
     const date = new Date(data);
     return Number.isNaN(date.getTime())
       ? String(data)
       : date.toLocaleString('pt-BR');
   }

   function criarCard(atendimento, nomeContato) {
     const card = criarElemento('div', 'historico-card');

     const topo = criarElemento('div', 'historico-card-topo');

     const status = atendimento.status || 'desconhecido';
     const corStatus = status === 'closed'
       ? '#10b981'
       : status === 'open'
       ? COR_PRINCIPAL
       : '#6b7280';

     topo.innerHTML = `
       <div style="display:flex;justify-content:space-between;gap:8px">
         <strong>🔖 Protocolo: ${
           escapeHtml(atendimento.protocol || 'N/A')
         }</strong>
         <span>
           <span style="
             display:inline-block;
             width:9px;
             height:9px;
             border-radius:50%;
             background:${corStatus};
           "></span>
           ${escapeHtml(status)}
         </span>
       </div>
       <div style="color:#4b5563">
         📅 ${escapeHtml(formatarData(atendimento.date_start))}
         ${atendimento.date_end
           ? ' → ' + escapeHtml(formatarData(atendimento.date_end))
           : ' (em andamento)'}
       </div>
       <div style="color:#4b5563">
         👤 ${escapeHtml(atendimento.attendant?.name || '—')}
         |
         🏢 ${escapeHtml(atendimento.department?.name || '—')}
       </div>
     `;

     const corpo = criarElemento('div', 'historico-card-corpo');
     const botao = criarElemento(
       'button', 'historico-botao', '💬 Ver mensagens'
     );
     botao.type = 'button';

     const area = criarElemento('div', 'historico-mensagens');

     corpo.append(botao, area);
     card.append(topo, corpo);

     const estado = {
       pagina: 1,
       carregando: false,
       mais: true,
       inicializado: false,
       ids: new Set(),
       falhas: 0,
       assinaturaAnterior: '',
       semNovos: 0
     };

     function chaveMensagem(m) {
       return String(
         m.id ??
         m.uuid ??
         [
           m.created_at,
           m.sender?.name,
           m.text,
           m.from_me
         ].join('|')
       );
     }

     function criarMensagem(m) {
       const nomeRemetente = String(
         m.sender?.name || (m.from_me ? 'Atendente' : 'Cliente')
       );

       const primeiroNome = nomeContato.toLowerCase().split(' ')[0];
       const remetente = nomeRemetente.toLowerCase();

       const isCliente = Boolean(primeiroNome) &&
         (
           remetente === nomeContato.toLowerCase() ||
           remetente.split(' ')[0] === primeiroNome
         );

       const lado = m.from_me === true
         ? 'flex-end'
         : m.from_me === false
         ? 'flex-start'
         : isCliente
         ? 'flex-start'
         : 'flex-end';

       const bg = lado === 'flex-start'
         ? '#f3f4f6'
         : '#dbeafe';

       const item = criarElemento('div', 'historico-mensagem');
       item.style.justifyContent = lado;

       const balao = criarElemento('div', 'historico-balao');
       balao.style.background = bg;

       let texto = String(m.text || '[Mensagem não textual]');
       const prefixo = `*${nomeRemetente}*:`;

       if (texto.startsWith(prefixo)) {
         texto = texto.slice(prefixo.length).trim();
       }

       balao.innerHTML = `
         <div style="font-weight:700;font-size:11px;margin-bottom:4px">
           ${escapeHtml(nomeRemetente)}
         </div>
         <div style="white-space:pre-wrap">${escapeHtml(texto)}</div>
         <div style="font-size:10px;color:#6b7280;margin-top:6px">
           ${escapeHtml(formatarDataMensagem(m.created_at))}
         </div>
       `;

       item.appendChild(balao);
       return item;
     }

     async function carregarMensagens() {
       if (estado.carregando || !estado.mais || !area.isConnected) {
         return;
       }

       estado.carregando = true;

       let aviso = area.querySelector('.historico-aviso-carga');
       if (!aviso) {
         aviso = criarElemento(
           'div',
           'historico-aviso historico-aviso-carga'
         );
         area.appendChild(aviso);
       }

       aviso.textContent = '⏳ Carregando mensagens...';

       try {
         const resultado = await buscarMensagens(
           atendimento.id, estado.pagina
         );

         if (!area.isConnected) return;

         const lista = resultado.lista;
         const assinatura = lista.map(chaveMensagem).join('||');

         if (
           assinatura &&
           assinatura === estado.assinaturaAnterior
         ) {
           estado.mais = false;
           aviso.textContent =
             'O servidor repetiu o mesmo lote. ' +
             'Não foi possível confirmar mais mensagens.';
           return;
         }

         estado.assinaturaAnterior = assinatura;

         let novos = 0;
         const elementos = [];

         for (const m of lista) {
           const chave = chaveMensagem(m);
           if (estado.ids.has(chave)) continue;

           estado.ids.add(chave);
           novos++;
           elementos.push(m);
         }

         elementos.sort((a, b) =>
           new Date(a.created_at || 0) -
           new Date(b.created_at || 0)
         );

         const alturaAnterior = area.scrollHeight;
         const scrollAnterior = area.scrollTop;

         // Páginas posteriores normalmente contêm mensagens antigas.
         // Por isso, são inseridas no começo da conversa.
         const fragmento = document.createDocumentFragment();

         for (const m of elementos) {
           fragmento.appendChild(criarMensagem(m));
         }

         if (estado.pagina === 1) {
           area.insertBefore(fragmento, aviso);
         } else {
           area.insertBefore(fragmento, area.firstChild);
           area.scrollTop =
             scrollAnterior + area.scrollHeight - alturaAnterior;
         }

         if (novos === 0) {
           estado.semNovos++;
         } else {
           estado.semNovos = 0;
         }

         estado.mais = Boolean(resultado.paginacao.mais) &&
           estado.semNovos < 2;

         estado.pagina++;
         estado.falhas = 0;

         if (estado.mais) {
           aviso.textContent =
             '↑ Role para cima para carregar mensagens anteriores';
         } else if (resultado.paginacao.estimado) {
           aviso.textContent =
             'Fim dos lotes disponíveis ou paginação não confirmada.';
         } else {
           aviso.textContent = '✓ Fim das mensagens disponíveis';
         }

         if (estado.pagina === 2) {
           area.scrollTop = area.scrollHeight;
         }

       } catch (erro) {
         console.error('[Komunic Histórico] Mensagens:', erro);

         estado.falhas++;
         aviso.textContent =
           `❌ Falha ao carregar: ${erro.message}. ` +
           'Role novamente para tentar.';
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
       ) {
         carregarMensagens();
       }
     }, { passive: true });

     return card;
   }

   function mostrarModal(nomeContato, contatoId) {
     fecharModal();

     const modal = criarElemento('div');
     modal.id = 'modal-historico';

     const content = criarElemento('div', 'historico-content');
     const header = criarElemento('div', 'historico-header');

     const titulo = criarElemento(
       'span', '', `📜 Histórico de Atendimentos — ${nomeContato}`
     );

     const fechar = criarElemento(
       'button', 'historico-fechar', '×'
     );
     fechar.type = 'button';
     fechar.addEventListener('click', fecharModal);

     header.append(titulo, fechar);

     const lista = criarElemento('div', 'historico-lista');

     const rodape = criarElemento(
       'div', 'historico-aviso', 'Preparando histórico...'
     );

     content.append(header, lista, rodape);
     modal.appendChild(content);
     document.body.appendChild(modal);
     modalAtual = modal;

     modal.addEventListener('click', (e) => {
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
       if (estado.carregando || !estado.mais || !modal.isConnected) {
         return;
       }

       estado.carregando = true;
       rodape.textContent = '⏳ Carregando atendimentos...';

       try {
         const resultado = await buscarAtendimentos(
           contatoId, estado.pagina
         );

         if (!modal.isConnected) return;

         const atendimentos = resultado.lista;
         const assinatura = atendimentos
           .map((a) => String(a.id))
           .join('|');

         if (
           assinatura &&
           assinatura === estado.assinaturaAnterior
         ) {
           estado.mais = false;
           rodape.textContent =
             'O servidor repetiu a página anterior. ' +
             'Paginação interrompida para evitar duplicações.';
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

         for (const a of atendimentos) {
           const id = String(a.id);

           if (estado.ids.has(id)) continue;
           estado.ids.add(id);

           lista.appendChild(criarCard(a, nomeContato));
           novos++;
           estado.total++;
         }

         estado.semNovos = novos === 0
           ? estado.semNovos + 1
           : 0;

         estado.mais = Boolean(resultado.paginacao.mais) &&
           estado.semNovos < 2;

         estado.pagina++;

         if (estado.mais) {
           rodape.textContent =
             `${estado.total} atendimento(s) carregado(s). ` +
             '↓ Role para carregar mais.';
         } else {
           rodape.textContent =
             `${estado.total} atendimento(s) carregado(s). ` +
             (resultado.paginacao.estimado
               ? 'Fim dos lotes disponíveis ou paginação não confirmada.'
               : '✓ Fim do histórico disponível.');
         }

         if (estado.total === 0) {
           rodape.textContent = 'Nenhum atendimento encontrado.';
         }

       } catch (erro) {
         console.error('[Komunic Histórico] Atendimentos:', erro);

         rodape.textContent =
           `❌ Erro: ${erro.message}. Role novamente para tentar.`;
       } finally {
         estado.carregando = false;
       }
     }

     lista.addEventListener('scroll', () => {
       const distanciaDoFim =
         lista.scrollHeight - lista.scrollTop - lista.clientHeight;

       if (
         distanciaDoFim < 160 &&
         estado.mais &&
         !estado.carregando
       ) {
         carregarAtendimentos();
       }
     }, { passive: true });

     carregarAtendimentos();
   }

   let abrindo = false;

   async function exibirHistorico() {
     if (abrindo) return;

     const nome = getNomeContato();

     if (!nome) {
       alert('Não foi possível identificar o contato.');
       return;
     }

     abrindo = true;

     try {
       const contatos = await buscarContato(nome);

       if (!contatos.length) {
         alert(`Nenhum contato encontrado: "${nome}".`);
         return;
       }

       const exato = contatos.find(
         (c) => String(c.name || '').trim().toLowerCase() ===
           nome.toLowerCase()
       );

       const contato = exato || contatos[0];

       mostrarModal(contato.name || nome, contato.id);

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

     const botao = criarElemento('button');
     botao.id = 'btn-historico-chat';
     botao.type = 'button';
     botao.className =
       'rounded-full flex items-center justify-center ' +
       'w-10 h-10 hover:bg-gray-100 border border-gray-300';

     botao.style.borderColor = '#e5e7eb';
     botao.style.cursor = 'pointer';

     botao.innerHTML = `
       <svg xmlns="http://www.w3.org/2000/svg"
         fill="none"
         viewBox="0 0 24 24"
         stroke-width="1.5"
         stroke="currentColor"
         class="h-6 w-6"
         style="color:${COR_PRINCIPAL}">
         <path stroke-linecap="round"
           stroke-linejoin="round"
           d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
       </svg>
     `;

     botao.title = 'Histórico do contato';
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

   new MutationObserver(verificarBotao).observe(document.body, {
     subtree: true,
     childList: true
   });

   adicionarBotao();

 })();

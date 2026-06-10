// ==UserScript==
// @name         Komunic - Histórico do Contato (Visual Aprimorado)
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Histórico com layout de chat (atendente à direita, cliente à esquerda), mais compacto, com botão fechar
// @author       Gabriel
// @match        https://app.komunic.net/*
// @grant        GM_xmlhttpRequest
// @connect      app.komunic.net
// @updateURL    https://raw.githubusercontent.com/Soy-Pardal/tampermonkey-komunic-tools/main/komunic-historico.user.js
// @downloadURL  https://raw.githubusercontent.com/Soy-Pardal/tampermonkey-komunic-tools/main/komunic-historico.user.js
// ==/UserScript==

(function() {
    'use strict';
    const COR_PRINCIPAL = 'rgb(251 146 60 / 1)';

    // Utilitários (mantidos iguais)
    const getNomeContato = () => {
        const el = document.querySelector('.chat-top-area .font-bold.cursor-pointer, .chat-top-area p.font-bold, .messages-col .font-bold.cursor-pointer');
        if (el) return el.innerText.trim();
        const active = document.querySelector('.cursor-pointer.bg-gray-50, .cursor-pointer.bg-gray-100');
        if (active) return active.querySelector('.font-bold')?.innerText.trim() || 'cliente';
        return 'cliente';
    };
    const csrf = () => decodeURIComponent((document.cookie.match(/XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const inertiaVersion = () => {
        const app = document.querySelector('#app');
        if (app && app.getAttribute('data-page')) try { return JSON.parse(app.getAttribute('data-page')).version || ''; } catch(e) {}
        return '';
    };
    const req = (url, opt={}) => new Promise((res,rej)=>{
        const headers = {
            'accept':'application/json, text/plain, */*','content-type':'application/json',
            'x-requested-with':'XMLHttpRequest','x-xsrf-token':csrf(),
            'sec-ch-ua':'"Microsoft Edge";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
            'sec-ch-ua-mobile':'?0','sec-ch-ua-platform':'"Windows"',
            ...opt.headers
        };
        if(url.includes('/live-history/contact')) {
            headers['x-inertia']='true';
            headers['x-inertia-version']=inertiaVersion();
            if(url.includes('?term=')) {
                headers['x-inertia-partial-component']='Tenant/LiveCallHistoryContact';
                headers['x-inertia-partial-data']='contacts';
            }
        }
        GM_xmlhttpRequest({
            method:opt.method||'GET', url, headers, data:opt.body,
            responseType:'json',
            onload:r=>{ if(r.status>=200&&r.status<300) res(r.response||JSON.parse(r.responseText)); else rej(new Error(`HTTP ${r.status}`)); },
            onerror:e=>rej(new Error('Rede/CORS'))
        });
    });
    const buscarContato = async nome => (await req(`https://app.komunic.net/live-history/contact?term=${encodeURIComponent(nome)}`)).props?.contacts?.data || [];
    const buscarAtendimentos = async (id, p=1) => { const d=await req(`https://app.komunic.net/live-history/contact/${id}?page=${p}&term=`); return Array.isArray(d)?d:(d.data||[]); };
    const buscarMsgs = async (sid, limit=15) => await req(`https://app.komunic.net/live-history-chat/${sid}?limit=${limit}`);
    const esc = s => String(s).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m]);

    const escapeHtml = (str) => {
    if (!str) return '';
    return String(str).replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
    };

    // ========== MODAL MELHORADO ==========
    const mostrarModal = (atendimentos) => {
    let modal = document.querySelector('#modal-historico');
    if(modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'modal-historico';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:100002;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);';

    const content = document.createElement('div');
    content.style.cssText = 'background:#fff;border-radius:16px;width:95%;max-width:850px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 25px -12px rgba(0,0,0,0.25);';

    const header = document.createElement('div');
    header.style.cssText = `background:${COR_PRINCIPAL};color:white;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:16px;`;
    header.innerHTML = `<span>📜 Histórico de Atendimentos</span><button id="fechar-modal-historico" style="background:none;border:none;color:white;font-size:24px;cursor:pointer;line-height:1;">&times;</button>`;
    content.appendChild(header);

    const listaContainer = document.createElement('div');
    listaContainer.style.cssText = 'padding:16px;overflow-y:auto;flex:1;';
    listaContainer.id = 'historico-lista-container';
    content.appendChild(listaContainer);
    modal.appendChild(content);
    document.body.appendChild(modal);

    document.getElementById('fechar-modal-historico')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if(e.target === modal) modal.remove(); });

    if(!atendimentos.length) {
        listaContainer.innerHTML = '<div style="text-align:center;color:#6b7280;padding:40px;">Nenhum atendimento encontrado.</div>';
        return;
    }

    atendimentos.sort((a,b)=>new Date(b.date_start)-new Date(a.date_start));
    let html = '<div style="display:flex;flex-direction:column;gap:12px;">';
    for(const a of atendimentos) {
        const statusColor = a.status==='closed'?'#10b981':(a.status==='open'?'#f59e0b':'#6b7280');
        html += `
            <div style="border:1px solid #e5e7eb;border-radius:12px;background:#fafafa;overflow:hidden;">
                <div style="background:#f3f4f6;padding:10px 12px;border-bottom:1px solid #e5e7eb;">
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                        <div><strong>🔖 Protocolo:</strong> ${escapeHtml(a.protocol||'N/A')}</div>
                        <div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${statusColor};margin-right:6px;"></span><strong>${escapeHtml(a.status)}</strong></div>
                    </div>
                    <div style="font-size:12px;margin-top:4px;color:#4b5563;">
                        📅 ${escapeHtml(a.date_start||'—')} ${a.date_end ? `→ ${escapeHtml(a.date_end)}` : '(em andamento)'}
                    </div>
                    <div style="font-size:12px;margin-top:2px;color:#4b5563;">
                        👤 ${escapeHtml(a.attendant?.name||'—')}  |  🏢 ${escapeHtml(a.department?.name||'—')}
                    </div>
                </div>
                <div style="padding:8px 12px;">
                    <button class="btn-ver-msgs" data-id="${a.id}" style="background:${COR_PRINCIPAL};color:white;border:none;border-radius:20px;padding:5px 12px;font-size:12px;cursor:pointer;">💬 Ver mensagens</button>
                    <div class="msgs-${a.id}" style="margin-top:10px;display:none;"></div>
                </div>
            </div>
        `;
    }
    html += '</div>';
    listaContainer.innerHTML = html;

    document.querySelectorAll('.btn-ver-msgs').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = btn.dataset.id;
            const divMsgs = document.querySelector(`.msgs-${id}`);
            if(divMsgs.style.display === 'block') {
                divMsgs.style.display = 'none';
                return;
            }
            divMsgs.style.display = 'block';
            divMsgs.innerHTML = '<div style="text-align:center;padding:20px;">⏳ Carregando mensagens...</div>';
            try {
                const data = await buscarMsgs(id);
                if(data.messages?.length) {
                    const msgs = data.messages.reverse(); // mais antigas primeiro
                    let msgsHtml = '<div style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto;padding:4px;">';
                    for(const m of msgs) {
                        const nomeRemetente = m.sender?.name || (m.from_me ? 'Atendente' : 'Cliente');
                        const nomeContato = getNomeContato();
                        const nomeRemetenteLower = nomeRemetente.toLowerCase();
                        const nomeContatoLower = nomeContato.toLowerCase();
                        const isCliente = nomeRemetenteLower.includes(nomeContatoLower) || nomeContatoLower.includes(nomeRemetenteLower);
                        const align = isCliente ? 'flex-start' : 'flex-end';
                        const bg = isCliente ? '#f3f4f6' : '#dbeafe';

                        let texto = m.text || '[Mensagem não textual]';
                        const prefixPattern = new RegExp(`^\\*${escapeRegex(nomeRemetente)}\\*:\\s*`, 'i');
                        texto = texto.replace(prefixPattern, '');

                        msgsHtml += `
        <div style="display:flex;justify-content:${align};">
            <div style="max-width:80%;background:${bg};border-radius:16px;padding:8px 12px;box-shadow:0 1px 1px rgba(0,0,0,0.05);">
                <div style="font-size:11px;font-weight:bold;margin-bottom:4px;">${escapeHtml(nomeRemetente)}</div>
                <div style="font-size:12px;word-break:break-word;">${escapeHtml(texto)}</div>
                <div style="font-size:10px;color:#6b7280;margin-top:6px;">${new Date(m.created_at).toLocaleString()}</div>
            </div>
        </div>
    `;
                    }
                    msgsHtml += '</div>';
                    divMsgs.innerHTML = msgsHtml;
                } else {
                    divMsgs.innerHTML = '<div style="text-align:center;padding:20px;color:#6b7280;">Nenhuma mensagem encontrada.</div>';
                }
            } catch(err) {
                divMsgs.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;">❌ Erro: ${err.message}</div>`;
            }
        });
    });
    };

    function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    const exibirHistorico = async () => {
        const nome = getNomeContato();
        if(!nome||nome==='cliente') return alert('Não foi possível identificar o contato.');
        try{
            const contatos = await buscarContato(nome);
            if(!contatos.length) return alert(`Nenhum contato encontrado: "${nome}".`);
            const atendimentos = await buscarAtendimentos(contatos[0].id);
            if(!atendimentos.length) return alert(`Nenhum atendimento para ${contatos[0].name}.`);
            mostrarModal(atendimentos);
        }catch(e){ console.error(e); alert('Erro ao carregar histórico.'); }
    };

    // Injeção do botão (mesmo código anterior, só muda a condição para ?chat=)
    const adicionarBotao = () => {
        // Só adiciona se a URL contiver "/newchat?chat=" (chat específico aberto)
        if (!location.href.includes('/newchat?chat=')) return;

        // Procura o container dos botões de ação no cabeçalho do chat
        const container = document.querySelector('.flex.mr-2');
        if (container && !document.querySelector('#btn-historico-chat')) {
            const btn = document.createElement('button');
            btn.id = 'btn-historico-chat';
            btn.className = 'rounded-full flex items-center justify-center w-10 h-10 hover:bg-gray-100 border border-gray-300';
            btn.style.borderColor = '#e5e7eb';
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-6 w-6" style="color:${COR_PRINCIPAL};"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>`;
            btn.title = 'Histórico do contato';
            btn.onclick = exibirHistorico;

            // Insere o botão como o primeiro elemento do container (ou onde preferir)
            container.insertBefore(btn, container.firstChild);
        }
    };

    let lastUrl = location.href;
    new MutationObserver(()=>{
        if(location.href !== lastUrl){
            lastUrl = location.href;
            setTimeout(adicionarBotao, 500);
        }
    }).observe(document, { subtree: true, childList: true });
    new MutationObserver(adicionarBotao).observe(document.body, { childList: true, subtree: true });
    adicionarBotao();
})();

// ==UserScript==
// @name         Komunic - Painel de Respostas Rápidas (Persistente + Visual Aprimorado)
// @namespace    http://tampermonkey.net/
// @version      6.0
// @description  Painel fixo à direita com pastas, respostas dinâmicas ({nome}, {saudacao}), não some ao trocar de abas, visual moderno.
// @author       Gabriel Dal Prá
// @match        https://app.komunic.net/newchat*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @updateURL    https://raw.githubusercontent.com/Soy-Pardal/tampermonkey-komunic-tools/main/komunic-respostas-rapidas.user.js
// @downloadURL  https://raw.githubusercontent.com/Soy-Pardal/tampermonkey-komunic-tools/main/komunic-respostas-rapidas.user.js
// ==/UserScript==

(function() {
    'use strict';

    const COR_PRINCIPAL = 'rgb(251 146 60 / 1)';
    const STORAGE_KEY = 'komunic_respostas_pastas';
    let pastas;

    const DEFAULT_PASTAS = [
        {
            id: 'pasta1',
            nome: 'Gerais',
            respostas: [
                { id: 'r1', titulo: 'Saudação', texto: '{saudacao}, {nome}! Tudo bem? Como posso ajudar?' },
                { id: 'r2', titulo: 'Aguardar', texto: 'Só um momento, por favor. Estou consultando as informações.' },
                { id: 'r3', titulo: 'Obrigado', texto: 'Muito obrigado pelo contato! Estamos à disposição.' },
                { id: 'r4', titulo: 'Encerramento', texto: 'Estarei encerrando o atendimento. Caso precise, estamos a disposição!' }
            ]
        }
    ];

    // ========== FUNÇÕES BÁSICAS ==========
    function loadData() {
        const stored = GM_getValue(STORAGE_KEY, null);
        if (stored !== null) {
            pastas = JSON.parse(stored);
        } else {
            pastas = JSON.parse(JSON.stringify(DEFAULT_PASTAS));
            saveData();
        }
    }

    function saveData() {
        GM_setValue(STORAGE_KEY, JSON.stringify(pastas));
    }
    function gerarId() { return Date.now() + '-' + Math.random().toString(36).substr(2, 8); }
    function escapeHtml(str) {
        return String(str).replace(/[&<>]/g, m => m === '&' ? '&amp;' : (m === '<' ? '&lt;' : '&gt;'));
    }

    // ========== FUNÇÕES DO CHAT ==========
    function getPrimeiroNomeContato() {
        const headerName = document.querySelector('.chat-top-area .font-bold.cursor-pointer, .chat-top-area p.font-bold, .messages-col .font-bold.cursor-pointer');
        if (headerName) {
            let nomeCompleto = headerName.innerText.trim();
            return nomeCompleto.split(/[\s\-–—]/)[0] || 'cliente';
        }
        const activeChat = document.querySelector('.cursor-pointer.bg-gray-50, .cursor-pointer.bg-gray-100');
        if (activeChat) {
            let nomeChat = activeChat.querySelector('.font-bold')?.innerText.trim();
            if (nomeChat) return nomeChat.split(/[\s\-–—]/)[0];
        }
        return 'cliente';
    }

    function getSaudacaoPorHorario() {
        const hora = new Date().getHours();
        if (hora < 12) return 'Bom dia';
        if (hora < 18) return 'Boa tarde';
        return 'Boa noite';
    }

    function inserirTextoNoChat(texto) {
        const inputChat = document.querySelector('textarea') ||
                          document.querySelector('div[contenteditable="true"]') ||
                          document.querySelector('input[type="text"]');
        if (inputChat) {
            inputChat.focus();
            if (inputChat.tagName === 'TEXTAREA' || inputChat.tagName === 'INPUT') {
                const oldValue = inputChat.value;
                inputChat.value = texto;
                const event = new Event('input', { bubbles: true });
                if (inputChat._valueTracker) inputChat._valueTracker.setValue(oldValue);
                inputChat.dispatchEvent(event);
            } else {
                inputChat.innerText = texto;
                inputChat.dispatchEvent(new Event('input', { bubbles: true }));
            }
        } else {
            alert('Abra uma conversa para enviar mensagem.');
        }
    }

    function processarTextoResposta(textoBase) {
        const nome = getPrimeiroNomeContato();
        const saudacao = getSaudacaoPorHorario();
        return textoBase.replace(/\{nome\}/gi, nome).replace(/\{saudacao\}/gi, saudacao);
    }

    function inserirResposta(textoBase) {
        inserirTextoNoChat(processarTextoResposta(textoBase));
    }

    // ========== CRUD PASTAS E RESPOSTAS ==========
    function adicionarPasta(nome) {
        pastas.push({ id: gerarId(), nome: nome.trim(), respostas: [] });
        saveData();
        renderizarPainel();
    }
    function editarPasta(id, novoNome) {
        const pasta = pastas.find(p => p.id === id);
        if (pasta) { pasta.nome = novoNome.trim(); saveData(); renderizarPainel(); }
    }
    function excluirPasta(id) {
        pastas = pastas.filter(p => p.id !== id);
        saveData();
        renderizarPainel();
    }

    function adicionarResposta(pastaId, titulo, texto) {
        const pasta = pastas.find(p => p.id === pastaId);
        if (pasta) {
            pasta.respostas.push({ id: gerarId(), titulo: titulo.trim(), texto: texto.trim() });
            saveData();
            renderizarPainel();
        }
    }
    function editarResposta(pastaId, respostaId, novoTitulo, novoTexto) {
        const pasta = pastas.find(p => p.id === pastaId);
        if (pasta) {
            const resp = pasta.respostas.find(r => r.id === respostaId);
            if (resp) { resp.titulo = novoTitulo.trim(); resp.texto = novoTexto.trim(); saveData(); renderizarPainel(); }
        }
    }
    function excluirResposta(pastaId, respostaId) {
        const pasta = pastas.find(p => p.id === pastaId);
        if (pasta) {
            pasta.respostas = pasta.respostas.filter(r => r.id !== respostaId);
            saveData();
            renderizarPainel();
        }
    }

    // ========== MODAIS (CRIAR/EDITAR) ==========
    let modalAtivo = null;
    function fecharModal() { if (modalAtivo) { modalAtivo.remove(); modalAtivo = null; } }

    function abrirModalPasta(pastaId, nomeAtual) {
        fecharModal();
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:100001; display:flex; align-items:center; justify-content:center;';
        const content = document.createElement('div');
        content.style.cssText = 'background:#fff; border-radius:12px; width:320px; padding:20px; box-shadow:0 10px 25px rgba(0,0,0,0.2);';
        content.innerHTML = `
            <h3 style="margin:0 0 16px; font-size:18px;">${pastaId ? '✏️ Editar Pasta' : '📁 Nova Pasta'}</h3>
            <input id="modal-pasta-nome" type="text" placeholder="Nome da pasta" style="width:100%; padding:10px; margin-bottom:20px; border:1px solid #ddd; border-radius:8px; font-size:14px;" value="${escapeHtml(nomeAtual || '')}">
            <div style="display:flex; justify-content:flex-end; gap:10px;">
                <button id="modal-cancelar" style="padding:8px 16px; background:#f3f4f6; border:none; border-radius:6px; cursor:pointer;">Cancelar</button>
                <button id="modal-salvar" style="padding:8px 16px; background:${COR_PRINCIPAL}; color:white; border:none; border-radius:6px; cursor:pointer;">Salvar</button>
            </div>
        `;
        modal.appendChild(content);
        document.body.appendChild(modal);
        modalAtivo = modal;

        const inputNome = content.querySelector('#modal-pasta-nome');
        content.querySelector('#modal-cancelar').onclick = fecharModal;
        content.querySelector('#modal-salvar').onclick = () => {
            const novoNome = inputNome.value.trim();
            if (!novoNome) return alert('Nome da pasta é obrigatório');
            if (pastaId) editarPasta(pastaId, novoNome);
            else adicionarPasta(novoNome);
            fecharModal();
        };
    }

    function abrirModalResposta(pastaId, respostaId, tituloAtual, textoAtual) {
        fecharModal();
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:100001; display:flex; align-items:center; justify-content:center;';
        const content = document.createElement('div');
        content.style.cssText = 'background:#fff; border-radius:12px; width:360px; padding:20px; box-shadow:0 10px 25px rgba(0,0,0,0.2);';
        content.innerHTML = `
            <h3 style="margin:0 0 16px; font-size:18px;">${respostaId ? '✏️ Editar Resposta' : '💬 Nova Resposta'}</h3>
            <label style="display:block; margin-bottom:6px; font-weight:500;">Título:</label>
            <input id="modal-resp-titulo" type="text" style="width:100%; padding:10px; margin-bottom:16px; border:1px solid #ddd; border-radius:8px;" value="${escapeHtml(tituloAtual || '')}">
            <label style="display:block; margin-bottom:6px; font-weight:500;">Texto (use {nome} e {saudacao}):</label>
            <textarea id="modal-resp-texto" rows="4" style="width:100%; padding:10px; margin-bottom:20px; border:1px solid #ddd; border-radius:8px; resize:vertical;">${escapeHtml(textoAtual || '')}</textarea>
            <div style="display:flex; justify-content:flex-end; gap:10px;">
                <button id="modal-cancelar" style="padding:8px 16px; background:#f3f4f6; border:none; border-radius:6px; cursor:pointer;">Cancelar</button>
                <button id="modal-salvar" style="padding:8px 16px; background:${COR_PRINCIPAL}; color:white; border:none; border-radius:6px; cursor:pointer;">Salvar</button>
            </div>
        `;
        modal.appendChild(content);
        document.body.appendChild(modal);
        modalAtivo = modal;

        const inputTitulo = content.querySelector('#modal-resp-titulo');
        const inputTexto = content.querySelector('#modal-resp-texto');
        content.querySelector('#modal-cancelar').onclick = fecharModal;
        content.querySelector('#modal-salvar').onclick = () => {
            const novoTitulo = inputTitulo.value.trim();
            const novoTexto = inputTexto.value.trim();
            if (!novoTitulo) return alert('Título é obrigatório');
            if (!novoTexto) return alert('Texto é obrigatório');
            if (respostaId) editarResposta(pastaId, respostaId, novoTitulo, novoTexto);
            else adicionarResposta(pastaId, novoTitulo, novoTexto);
            fecharModal();
        };
    }

    // ========== RENDERIZAÇÃO DO PAINEL (VISUAL MODERNO) ==========
    function renderizarPainel() {
        const container = document.querySelector('#painel-respostas-rapidas');
        if (!container) return;
        container.innerHTML = '';

        // Cabeçalho
        const header = document.createElement('div');
        header.style.cssText = `background: ${COR_PRINCIPAL}; color: white; padding: 14px 16px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; border-radius: 12px 12px 0 0;`;
        header.innerHTML = `<span style="font-size: 15px;">📁 Respostas Rápidas</span><button id="btn-add-pasta-painel" style="background:rgba(255,255,255,0.2); border:none; color:white; font-size:16px; padding:4px 12px; border-radius:20px; cursor:pointer;">+ Pasta</button>`;
        container.appendChild(header);

        const corpo = document.createElement('div');
        corpo.style.cssText = 'padding: 12px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 12px; background: #f9fafb;';
        container.appendChild(corpo);

        header.querySelector('#btn-add-pasta-painel').onclick = () => abrirModalPasta(null, '');

        if (pastas.length === 0) {
            const vazio = document.createElement('div');
            vazio.textContent = 'Nenhuma pasta criada. Clique em "+ Pasta" para adicionar.';
            vazio.style.textAlign = 'center';
            vazio.style.padding = '30px';
            vazio.style.color = '#6b7280';
            vazio.style.fontSize = '13px';
            corpo.appendChild(vazio);
            return;
        }

        pastas.forEach(pasta => {
            const pastaDiv = document.createElement('div');
            pastaDiv.style.background = 'white';
            pastaDiv.style.borderRadius = '12px';
            pastaDiv.style.border = '1px solid #e5e7eb';
            pastaDiv.style.overflow = 'hidden';
            pastaDiv.style.marginBottom = '4px';
            pastaDiv.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';

            const headerPasta = document.createElement('div');
            headerPasta.style.cssText = `background: #f9fafb; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 500; border-bottom: 1px solid #e5e7eb; transition: background 0.2s;`;
            headerPasta.innerHTML = `
                <span>📂 ${escapeHtml(pasta.nome)} <span style="background:#e5e7eb; padding:2px 8px; border-radius:12px; font-size:11px; margin-left:6px;">${pasta.respostas.length}</span></span>
                <div>
                    <button class="pasta-editar" data-id="${pasta.id}" style="background:none; border:none; cursor:pointer; margin-right:6px; font-size:14px;">✏️</button>
                    <button class="pasta-excluir" data-id="${pasta.id}" style="background:none; border:none; cursor:pointer; font-size:14px;">🗑️</button>
                    <span style="margin-left:6px; font-size:12px;">▼</span>
                </div>
            `;
            const corpoPasta = document.createElement('div');
            corpoPasta.style.padding = '10px';
            corpoPasta.style.display = 'none';
            corpoPasta.style.flexDirection = 'column';
            corpoPasta.style.gap = '8px';
            corpoPasta.style.maxHeight = '260px';
            corpoPasta.style.overflowY = 'auto';

            const btnAddResp = document.createElement('button');
            btnAddResp.textContent = '+ Adicionar resposta';
            btnAddResp.style.cssText = `width:100%; padding:8px; background:${COR_PRINCIPAL}; color:white; border:none; border-radius:8px; cursor:pointer; font-size:12px; margin-bottom:4px; transition:opacity 0.2s;`;
            btnAddResp.onmouseover = () => btnAddResp.style.opacity = '0.9';
            btnAddResp.onmouseout = () => btnAddResp.style.opacity = '1';
            btnAddResp.onclick = (e) => { e.stopPropagation(); abrirModalResposta(pasta.id, null, '', ''); };
            corpoPasta.appendChild(btnAddResp);

            pasta.respostas.forEach(resp => {
                const respItem = document.createElement('div');
                respItem.style.cssText = 'padding: 10px; border: 1px solid #e5e7eb; border-radius: 10px; cursor: pointer; background: white; transition: all 0.2s;';
                respItem.onmouseover = () => respItem.style.backgroundColor = '#fef9e6';
                respItem.onmouseout = () => respItem.style.backgroundColor = 'white';
                respItem.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 13px;">${escapeHtml(resp.titulo)}</strong>
                        <div>
                            <button class="resp-editar" data-pasta="${pasta.id}" data-id="${resp.id}" style="background:none; border:none; cursor:pointer; font-size:13px;">✏️</button>
                            <button class="resp-excluir" data-pasta="${pasta.id}" data-id="${resp.id}" style="background:none; border:none; cursor:pointer; font-size:13px;">🗑️</button>
                        </div>
                    </div>
                    <div style="font-size: 11px; color: #6b7280; margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(resp.texto.substring(0, 70))}${resp.texto.length > 70 ? '…' : ''}</div>
                `;
                respItem.addEventListener('click', (e) => {
                    if (e.target.classList.contains('resp-editar') || e.target.classList.contains('resp-excluir')) return;
                    inserirResposta(resp.texto);
                });
                const btnEdit = respItem.querySelector('.resp-editar');
                btnEdit.addEventListener('click', (e) => {
                    e.stopPropagation();
                    abrirModalResposta(pasta.id, resp.id, resp.titulo, resp.texto);
                });
                const btnDelete = respItem.querySelector('.resp-excluir');
                btnDelete.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm(`Excluir resposta "${resp.titulo}"?`)) excluirResposta(pasta.id, resp.id);
                });
                corpoPasta.appendChild(respItem);
            });

            headerPasta.querySelector('.pasta-editar').onclick = (e) => { e.stopPropagation(); abrirModalPasta(pasta.id, pasta.nome); };
            headerPasta.querySelector('.pasta-excluir').onclick = (e) => { e.stopPropagation(); if (confirm(`Excluir pasta "${pasta.nome}" e todas as suas respostas?`)) excluirPasta(pasta.id); };
            const toggleSpan = headerPasta.querySelector('span:last-child');
            toggleSpan.onclick = (e) => { e.stopPropagation(); corpoPasta.style.display = corpoPasta.style.display === 'none' ? 'flex' : 'none'; };
            headerPasta.onclick = (e) => { if (!e.target.closest('button')) corpoPasta.style.display = corpoPasta.style.display === 'none' ? 'flex' : 'none'; };

            pastaDiv.appendChild(headerPasta);
            pastaDiv.appendChild(corpoPasta);
            corpo.appendChild(pastaDiv);
        });
    }

    // ========== GERENCIAMENTO DE PERSISTÊNCIA (NÃO SOME AO TROCAR DE ABA) ==========
    function criarPainelLateral() {
        // Remove painel existente se houver
        const painelExistente = document.querySelector('#painel-respostas-rapidas');
        if (painelExistente) painelExistente.remove();

        const chatPanel = document.querySelector('#newchat-panel');
        if (!chatPanel) return;

        const containerPai = chatPanel.closest('.px-3');
        if (!containerPai) return;

        // Aplica layout flex se necessário
        if (!containerPai.style.display || containerPai.style.display !== 'flex') {
            containerPai.style.display = 'flex';
            containerPai.style.gap = '16px';
            containerPai.style.alignItems = 'stretch';
            chatPanel.style.flex = '1';
            chatPanel.style.minWidth = '0';
        }

        const painel = document.createElement('div');
        painel.id = 'painel-respostas-rapidas';
        painel.style.cssText = `
            width: 320px; flex-shrink: 0; background: white; border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #e5e7eb;
            display: flex; flex-direction: column; overflow: hidden;
            font-family: Inter, system-ui, sans-serif; height: calc(100vh - 10rem); margin-top: 8px;
        `;
        containerPai.appendChild(painel);
        renderizarPainel();
    }

    function isChatPage() {
        return window.location.href.includes('/newchat') && window.location.href.includes('?chat=');
    }

    function tryCreatePanel() {
        if (isChatPage()) {
            // Aguarda o #newchat-panel existir no DOM
            const checkExist = setInterval(() => {
                if (document.querySelector('#newchat-panel')) {
                    clearInterval(checkExist);
                    criarPainelLateral();
                }
            }, 200);
        } else {
            const painel = document.querySelector('#painel-respostas-rapidas');
            if (painel) painel.remove();
        }
    }

    // Observador de URL (para navegação SPA)
    let lastUrl = location.href;
    const urlObserver = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(tryCreatePanel, 300);
        }
    });
    urlObserver.observe(document, { subtree: true, childList: true });

    // Observador de DOM (para quando o container aparecer)
    const domObserver = new MutationObserver(() => {
        if (isChatPage() && document.querySelector('#newchat-panel') && !document.querySelector('#painel-respostas-rapidas')) {
            criarPainelLateral();
        }
    });
    domObserver.observe(document.body, { childList: true, subtree: true });

    // ========== INICIALIZAÇÃO ==========
    function init() {
        if (!window.location.href.includes('/newchat')) return;
        loadData();
        tryCreatePanel();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();

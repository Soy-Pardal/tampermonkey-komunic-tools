// ==UserScript==
// @name         Komunic - Ranking de Atendentes com PDF (agrupado por setor)
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Gera PDF com ranking de atendentes, agrupado por setor, filtrando apenas ativos e com opção de excluir gestores.
// @author       Gabriel
// @match        https://app.komunic.net/*
// @grant        GM_xmlhttpRequest
// @connect      app.komunic.net
// @require      https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js
// @updateURL    https://raw.githubusercontent.com/Soy-Pardal/tampermonkey-komunic-tools/main/komunic-ranking-pdf-agrupado.user.js
// @downloadURL  https://raw.githubusercontent.com/Soy-Pardal/tampermonkey-komunic-tools/main/komunic-ranking-pdf-agrupado.user.js
// ==/UserScript==

(function() {
    'use strict';

    const COR_PRINCIPAL = 'rgb(251 146 60 / 1)';
    const API_RANKING = 'https://app.komunic.net/dashboard/tenant/segmented?type=dashboard_segmented_by_attendant&order=desc&perPage=10';
    const API_USERS = 'https://app.komunic.net/users?is_active=1'; // sempre apenas ativos

    const PERIODOS = {
        'today': 'Hoje',
        'seven_days': '7 dias',
        'fifteen_days': '15 dias',
        'thirty_days': '30 dias'
    };
    let periodoAtual = 'thirty_days';
    let todosDepartamentos = [];
    let departamentoSelecionado = 'todos';
    let excluirGestores = false; // opção de excluir usuários com cargo "Gestores"

    // ========== FUNÇÃO PARA SANITIZAR TEXTO (SEM ACENTOS E SEM EMOJIS) ==========
    function sanitizeText(str) {
        if (!str) return '';
        // Mapeamento manual de caracteres acentuados para equivalentes ASCII
        const acentos = {
            'á': 'a', 'à': 'a', 'ã': 'a', 'â': 'a', 'ä': 'a',
            'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
            'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
            'ó': 'o', 'ò': 'o', 'õ': 'o', 'ô': 'o', 'ö': 'o',
            'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
            'ç': 'c', 'ñ': 'n',
            'Á': 'A', 'À': 'A', 'Ã': 'A', 'Â': 'A', 'Ä': 'A',
            'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E',
            'Í': 'I', 'Ì': 'I', 'Î': 'I', 'Ï': 'I',
            'Ó': 'O', 'Ò': 'O', 'Õ': 'O', 'Ô': 'O', 'Ö': 'O',
            'Ú': 'U', 'Ù': 'U', 'Û': 'U', 'Ü': 'U',
            'Ç': 'C', 'Ñ': 'N'
        };
        let resultado = '';
        for (let char of str) {
            resultado += acentos[char] || char;
        }
        // Remove emojis (faixa Unicode básica de emojis)
        resultado = resultado.replace(/[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
        // Remove qualquer caractere que não seja ASCII imprimível (espaço, letras, números, pontuação)
        resultado = resultado.replace(/[^\x20-\x7E]/g, '');
        return resultado.trim();
    }

    // ========== REQUISIÇÕES ==========
    const csrf = () => decodeURIComponent((document.cookie.match(/XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const inertiaVersion = () => {
        const app = document.querySelector('#app');
        if (app && app.getAttribute('data-page')) {
            try { return JSON.parse(app.getAttribute('data-page')).version || ''; } catch(e) {}
        }
        return '';
    };

    const req = (url, opt = {}) => new Promise((res, rej) => {
        const headers = {
            'accept': 'application/json, text/plain, */*',
            'content-type': 'application/json',
            'x-requested-with': 'XMLHttpRequest',
            'x-xsrf-token': csrf(),
            ...opt.headers
        };
        if (url.includes('/dashboard/tenant/segmented')) {
            headers['x-inertia'] = 'true';
            headers['x-inertia-version'] = inertiaVersion();
        }
        if (url.includes('/users')) {
            headers['accept'] = 'text/html, application/xhtml+xml';
            headers['x-inertia'] = 'true';
            headers['x-inertia-version'] = inertiaVersion();
        }
        GM_xmlhttpRequest({
            method: opt.method || 'GET',
            url: url,
            headers: headers,
            data: opt.body,
            responseType: 'json',
            onload: r => {
                if (r.status >= 200 && r.status < 300) res(r.response);
                else rej(new Error(`HTTP ${r.status}`));
            },
            onerror: e => rej(new Error('Erro de rede/CORS'))
        });
    });

    // Buscar ranking paginado
    async function buscarRankingAtendentes() {
        let todos = [];
        let cursor = null;
        let hasMore = true;
        const urlBase = `${API_RANKING}&period=${periodoAtual}`;
        while (hasMore) {
            let url = urlBase;
            if (cursor) url += `&cursor=${cursor}`;
            try {
                const resp = await req(url);
                if (resp.data && Array.isArray(resp.data)) {
                    todos.push(...resp.data);
                    hasMore = resp.hasMorePages === true;
                    cursor = resp.nextCursor || null;
                } else break;
                await new Promise(r => setTimeout(r, 200));
            } catch(err) {
                console.error(err);
                throw err;
            }
        }
        return todos;
    }

    // Buscar todos os usuários (sempre ativos, pois API já tem ?is_active=1)
    async function buscarTodosUsuarios() {
        let todos = [];
        let cursor = null;
        let hasMore = true;
        let urlBase = API_USERS;
        while (hasMore) {
            let url = urlBase;
            if (cursor) {
                url += (url.includes('?') ? '&' : '?') + `cursor=${encodeURIComponent(cursor)}`;
            }
            try {
                const resp = await req(url);
                const usersData = resp?.props?.users;
                if (!usersData || !Array.isArray(usersData.data)) break;
                todos.push(...usersData.data);
                hasMore = !!usersData.links?.next;
                cursor = usersData.meta?.next_cursor || null;
                await new Promise(r => setTimeout(r, 200));
            } catch(err) {
                console.error(err);
                throw err;
            }
        }
        return todos;
    }

    // Verifica se o usuário tem o cargo "Gestores"
    function isGestor(usuario) {
        if (!usuario.roles) return false;
        return usuario.roles.some(role => role.name === 'Gestores');
    }

    function formatarDepartamentos(usuario) {
        if (!usuario.departments || usuario.departments.length === 0) return '';
        return usuario.departments.map(d => d.name).join(', ');
    }

    function extrairDepartamentosUnicos(usuarios) {
        const set = new Set();
        usuarios.forEach(u => {
            if (u.departments) u.departments.forEach(d => set.add(d.name));
        });
        return Array.from(set).sort();
    }

    function agruparPorSetor(dadosCompletos) {
        const grupos = new Map();
        dadosCompletos.forEach(item => {
            const setores = item.setores ? item.setores.split(', ') : ['Sem setor'];
            setores.forEach(setor => {
                if (!grupos.has(setor)) grupos.set(setor, []);
                grupos.get(setor).push(item);
            });
        });
        for (let [setor, lista] of grupos.entries()) {
            lista.sort((a,b) => b.services_count - a.services_count);
            grupos.set(setor, lista);
        }
        return Array.from(grupos.entries())
            .sort((a,b) => a[0].localeCompare(b[0]))
            .map(([setor, lista]) => ({ setor, atendentes: lista }));
    }

    // Gerar PDF
    async function gerarPDF(botaoModal, modalDiv) {
        const originalText = botaoModal.innerText;
        botaoModal.disabled = true;
        botaoModal.innerHTML = '<span style="display:inline-block; width:16px; height:16px; border:2px solid white; border-top-color:transparent; border-radius:50%; animation: spin 0.6s linear infinite; margin-right:8px;"></span> Gerando PDF...';

        if (!document.querySelector('#loading-spinner-style')) {
            const style = document.createElement('style');
            style.id = 'loading-spinner-style';
            style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
            document.head.appendChild(style);
        }

        try {
            const dadosCompletos = await obterDadosCompletos();
            let dadosParaPDF;
            let tituloSetor = '';

            if (departamentoSelecionado === 'todos') {
                dadosParaPDF = agruparPorSetor(dadosCompletos);
                tituloSetor = 'Todos os departamentos (agrupado)';
            } else {
                const filtrados = dadosCompletos.filter(item => item.setores.split(', ').includes(departamentoSelecionado));
                filtrados.sort((a,b) => b.services_count - a.services_count);
                dadosParaPDF = [{ setor: departamentoSelecionado, atendentes: filtrados }];
                tituloSetor = `Departamento: ${departamentoSelecionado}`;
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            let y = 20;

            doc.setFontSize(18);
            doc.setTextColor(251, 146, 60);
            doc.text(sanitizeText(`Ranking de Atendentes - ${PERIODOS[periodoAtual]}`), 14, y);
            y += 8;
            doc.setFontSize(11);
            doc.setTextColor(100);
            doc.text(sanitizeText(tituloSetor), 14, y);
            y += 8;
            doc.text(sanitizeText(`Gerado em: ${new Date().toLocaleString()}`), 14, y);
            y += 10;

            for (let grupo of dadosParaPDF) {
                if (grupo.atendentes.length === 0) continue;
                if (y > 260) { doc.addPage(); y = 20; }

                doc.setFontSize(12);
                doc.setTextColor(0);
                const setorLimpo = sanitizeText(grupo.setor);
                const tituloGrupo = `[Setor] ${setorLimpo} (${grupo.atendentes.length} atendentes)`;
                doc.text(tituloGrupo, 14, y);
                y += 6;

                const bodyRows = grupo.atendentes.map((item, idx) => [
                    idx+1,
                    sanitizeText(item.nome),
                    item.services_count,
                    sanitizeText(item.setores)
                ]);

                doc.autoTable({
                    startY: y,
                    head: [['#', 'Atendente', 'Atendimentos', 'Setor(es)']],
                    body: bodyRows,
                    theme: 'striped',
                    headStyles: { fillColor: [251, 146, 60], textColor: 255, fontStyle: 'bold' },
                    alternateRowStyles: { fillColor: [245, 245, 245] },
                    margin: { left: 14, right: 14 },
                    columnStyles: {
                        0: { cellWidth: 15, halign: 'center' },
                        1: { cellWidth: 'auto' },
                        2: { cellWidth: 30, halign: 'center' },
                        3: { cellWidth: 'auto' }
                    },
                    didParseCell: (data) => {
                        if (data.cell && data.cell.text && data.cell.text.length > 0) {
                            data.cell.text = [sanitizeText(data.cell.text[0])];
                        }
                    }
                });
                y = doc.lastAutoTable.finalY + 8;
                if (y > 280) y = 20;
            }

            const nomeArquivo = `ranking_${PERIODOS[periodoAtual].replace(/\s/g, '_')}_${departamentoSelecionado === 'todos' ? 'todos_setores' : departamentoSelecionado}.pdf`;
            doc.save(nomeArquivo);
            alert(`✅ PDF gerado com sucesso!`);
        } catch (err) {
            console.error(err);
            alert('❌ Erro ao gerar PDF: ' + err.message);
        } finally {
            botaoModal.disabled = false;
            botaoModal.innerHTML = originalText;
            if (modalDiv) modalDiv.remove();
        }
    }

    async function obterDadosCompletos() {
        const [ranking, usuarios] = await Promise.all([buscarRankingAtendentes(), buscarTodosUsuarios()]);
        const mapaUsuarios = new Map();
        usuarios.forEach(u => mapaUsuarios.set(u.id, u));
        todosDepartamentos = extrairDepartamentosUnicos(usuarios);

        // Aplica os filtros: apenas usuários ativos (já vêm da API) e opcionalmente exclui gestores
        let dados = ranking.map(r => {
            const usuario = mapaUsuarios.get(r.id);
            if (!usuario) return null; // usuário não encontrado (ex: inativo ou não existe)
            const setores = formatarDepartamentos(usuario);
            return {
                id: r.id,
                nome: r.name,
                services_count: r.services_count,
                setores: setores,
                email: usuario.email,
                status: usuario.status,
                isGestor: isGestor(usuario)
            };
        }).filter(item => item !== null);

        if (excluirGestores) {
            dados = dados.filter(item => !item.isGestor);
            console.log(`Filtro aplicado: excluídos gestores. Restaram ${dados.length} atendentes.`);
        }
        return dados;
    }

    // Modal de configuração
    let modalAtivo = null;
    function criarModal() {
        if (modalAtivo) modalAtivo.remove();
        const modalDiv = document.createElement('div');
        modalDiv.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5); backdrop-filter: blur(2px);
            z-index: 100002; display: flex; align-items: center; justify-content: center;
        `;
        const content = document.createElement('div');
        content.style.cssText = `
            background: white; border-radius: 16px; width: 420px; max-width: 90%;
            padding: 24px; box-shadow: 0 20px 25px -12px rgba(0,0,0,0.25);
            font-family: system-ui;
        `;
        content.innerHTML = `
            <h3 style="margin:0 0 20px 0; font-size:20px; color:${COR_PRINCIPAL};">📊 Gerar PDF do Ranking</h3>
            <div style="margin-bottom:16px;">
                <label style="display:block; margin-bottom:6px; font-weight:500;">Período:</label>
                <div id="modal-periodo-buttons" style="display:flex; gap:8px; flex-wrap:wrap;"></div>
            </div>
            <div style="margin-bottom:16px;">
                <label style="display:block; margin-bottom:6px; font-weight:500;">Departamento:</label>
                <select id="modal-departamento-select" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:8px;"></select>
            </div>
            <div style="margin-bottom:24px;">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input type="checkbox" id="modal-excluir-gestores">
                    <span style="font-weight:500;">Excluir usuários com cargo "Gestores"</span>
                </label>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:12px;">
                <button id="modal-cancelar" style="padding:8px 20px; background:#e5e7eb; border:none; border-radius:40px; cursor:pointer;">Cancelar</button>
                <button id="modal-gerar" style="padding:8px 20px; background:${COR_PRINCIPAL}; color:white; border:none; border-radius:40px; cursor:pointer;">Gerar PDF</button>
            </div>
        `;
        modalDiv.appendChild(content);
        document.body.appendChild(modalDiv);
        modalAtivo = modalDiv;

        // Períodos
        const periodoContainer = content.querySelector('#modal-periodo-buttons');
        for (const [value, label] of Object.entries(PERIODOS)) {
            const btn = document.createElement('button');
            btn.innerText = label;
            btn.style.cssText = `
                padding: 4px 12px; border-radius: 20px; border: 1px solid #ccc;
                background: ${value === periodoAtual ? COR_PRINCIPAL : 'white'};
                color: ${value === periodoAtual ? 'white' : '#333'};
                cursor: pointer; font-size: 12px;
            `;
            btn.addEventListener('click', () => {
                periodoAtual = value;
                periodoContainer.querySelectorAll('button').forEach(b => {
                    b.style.background = 'white';
                    b.style.color = '#333';
                });
                btn.style.background = COR_PRINCIPAL;
                btn.style.color = 'white';
            });
            periodoContainer.appendChild(btn);
        }

        // Select departamentos
        const selectDept = content.querySelector('#modal-departamento-select');
        selectDept.innerHTML = '<option value="todos">📁 Todos os departamentos (agrupado)</option>';
        (async () => {
            try {
                const usuarios = await buscarTodosUsuarios();
                const depts = extrairDepartamentosUnicos(usuarios);
                depts.forEach(dept => {
                    const option = document.createElement('option');
                    option.value = dept;
                    option.textContent = dept;
                    selectDept.appendChild(option);
                });
                if (departamentoSelecionado !== 'todos' && depts.includes(departamentoSelecionado)) {
                    selectDept.value = departamentoSelecionado;
                } else {
                    selectDept.value = 'todos';
                }
            } catch(e) { console.error(e); }
        })();

        content.querySelector('#modal-cancelar').onclick = () => modalDiv.remove();
        const btnGerar = content.querySelector('#modal-gerar');
        btnGerar.onclick = async () => {
            departamentoSelecionado = selectDept.value;
            excluirGestores = content.querySelector('#modal-excluir-gestores').checked;
            await gerarPDF(btnGerar, modalDiv);
        };
        modalDiv.addEventListener('click', (e) => { if(e.target === modalDiv) modalDiv.remove(); });
    }

    function adicionarBotao() {
        if (document.getElementById('btn-ranking-pdf')) return;
        const cabecalho = document.querySelector('.bg-kc-blue.text-white.text-left.font-bold.text-2xl.leading-6.py-3.px-8.rounded-t-lg.w-full.mt-8.flex.justify-between.items-center');
        if (!cabecalho) return;
        const btn = document.createElement('button');
        btn.id = 'btn-ranking-pdf';
        btn.innerText = '📊 Gerar PDF do Ranking (agrupado)';
        btn.style.cssText = `
            background: ${COR_PRINCIPAL}; color: white; border: none;
            border-radius: 9999px; padding: 6px 16px; font-size: 14px;
            font-weight: 500; cursor: pointer; margin-left: 16px;
        `;
        btn.onclick = criarModal;
        cabecalho.appendChild(btn);
    }

    const observer = new MutationObserver(() => {
        if (document.querySelector('.bg-kc-blue.text-white')) adicionarBotao();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', adicionarBotao);
    else adicionarBotao();
})();

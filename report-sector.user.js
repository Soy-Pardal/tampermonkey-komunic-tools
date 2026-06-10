// ==UserScript==
// @name         Komunic - Ranking de Atendentes com PDF (agrupado por setor)
// @namespace    http://tampermonkey.net/
// @version      3.1
// @description  Gera PDF bonito com ranking de atendentes, agrupado por setor quando selecionado "Todos", com indicador de loading.
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
    const API_USERS = 'https://app.komunic.net/users';

    const PERIODOS = {
        'today': 'Hoje',
        'seven_days': '7 dias',
        'fifteen_days': '15 dias',
        'thirty_days': '30 dias'
    };
    let periodoAtual = 'thirty_days';
    let todosDepartamentos = [];
    let departamentoSelecionado = 'todos';

    // Utilitários de requisição
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

    // Busca paginada do ranking
    async function buscarRankingAtendentes() {
        let todos = [];
        let cursor = null;
        let hasMore = true;
        let pagina = 1;
        const urlBase = `${API_RANKING}&period=${periodoAtual}`;
        console.log(`Buscando ranking para período: ${PERIODOS[periodoAtual]}`);
        while (hasMore) {
            let url = urlBase;
            if (cursor) url += `&cursor=${cursor}`;
            try {
                const resp = await req(url);
                if (resp.data && Array.isArray(resp.data)) {
                    todos.push(...resp.data);
                    hasMore = resp.hasMorePages === true;
                    cursor = resp.nextCursor || null;
                    pagina++;
                } else break;
                await new Promise(r => setTimeout(r, 200));
            } catch(err) {
                console.error(err);
                throw err;
            }
        }
        return todos;
    }

    // Busca todos os usuários (com departamentos)
    async function buscarTodosUsuarios() {
        let todos = [];
        let cursor = null;
        let hasMore = true;
        while (hasMore) {
            let url = API_USERS;
            if (cursor) url += `?cursor=${encodeURIComponent(cursor)}`;
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

    // Retorna array de objetos com { setor, atendentes[] }
    function agruparPorSetor(dadosCompletos) {
        const grupos = new Map(); // setor -> array de atendentes
        dadosCompletos.forEach(item => {
            const setores = item.setores ? item.setores.split(', ') : ['Sem setor'];
            setores.forEach(setor => {
                if (!grupos.has(setor)) grupos.set(setor, []);
                grupos.get(setor).push(item);
            });
        });
        // Ordenar cada grupo por quantidade decrescente
        for (let [setor, lista] of grupos.entries()) {
            lista.sort((a,b) => b.services_count - a.services_count);
            grupos.set(setor, lista);
        }
        // Retornar array ordenado alfabeticamente pelos setores
        return Array.from(grupos.entries())
            .sort((a,b) => a[0].localeCompare(b[0]))
            .map(([setor, lista]) => ({ setor, atendentes: lista }));
    }

    // Gerar PDF com suporte a agrupamento por setor
    async function gerarPDF(botao) {
        const originalText = botao.innerText;
        botao.disabled = true;
        // Adiciona um ícone de loading (spinner CSS)
        botao.innerHTML = '<span style="display:inline-block; width:16px; height:16px; border:2px solid white; border-top-color:transparent; border-radius:50%; animation: spin 0.6s linear infinite; margin-right:8px;"></span> Gerando PDF...';
        // Injeta animação CSS (caso não exista)
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

            // Cabeçalho geral
            doc.setFontSize(18);
            doc.setTextColor(251, 146, 60);
            doc.text(`Ranking de Atendentes - ${PERIODOS[periodoAtual]}`, 14, y);
            y += 8;
            doc.setFontSize(11);
            doc.setTextColor(100);
            doc.text(tituloSetor, 14, y);
            y += 8;
            doc.text(`Gerado em: ${new Date().toLocaleString()}`, 14, y);
            y += 10;

            // Itera pelos setores/grupos
            for (let grupo of dadosParaPDF) {
                if (grupo.atendentes.length === 0) continue;

                // Verifica se precisa de nova página
                if (y > 260) {
                    doc.addPage();
                    y = 20;
                }

                // Cabeçalho do setor
                doc.setFontSize(12);
                doc.setTextColor(0);
                doc.text(`📁 ${grupo.setor} (${grupo.atendentes.length} atendentes)`, 14, y);
                y += 6;

                // Monta tabela
                const bodyRows = grupo.atendentes.map((item, idx) => [idx+1, item.nome, item.services_count, item.setores]);
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
                    didDrawPage: (data) => { y = data.cursor.y; }
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
            botao.disabled = false;
            botao.innerHTML = originalText;
        }
    }

    async function obterDadosCompletos() {
        const [ranking, usuarios] = await Promise.all([buscarRankingAtendentes(), buscarTodosUsuarios()]);
        const mapaUsuarios = new Map();
        usuarios.forEach(u => mapaUsuarios.set(u.id, u));
        todosDepartamentos = extrairDepartamentosUnicos(usuarios);
        return ranking.map(r => {
            const usuario = mapaUsuarios.get(r.id);
            const setores = usuario ? formatarDepartamentos(usuario) : '';
            return {
                id: r.id,
                nome: r.name,
                services_count: r.services_count,
                setores: setores,
                email: usuario?.email || '',
                status: usuario?.status || ''
            };
        });
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
            background: white; border-radius: 16px; width: 400px; max-width: 90%;
            padding: 24px; box-shadow: 0 20px 25px -12px rgba(0,0,0,0.25);
            font-family: system-ui;
        `;
        content.innerHTML = `
            <h3 style="margin:0 0 20px 0; font-size:20px; color:${COR_PRINCIPAL};">📊 Gerar PDF do Ranking</h3>
            <div style="margin-bottom:16px;">
                <label style="display:block; margin-bottom:6px; font-weight:500;">Período:</label>
                <div id="modal-periodo-buttons" style="display:flex; gap:8px; flex-wrap:wrap;"></div>
            </div>
            <div style="margin-bottom:24px;">
                <label style="display:block; margin-bottom:6px; font-weight:500;">Departamento:</label>
                <select id="modal-departamento-select" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:8px;"></select>
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
        content.querySelector('#modal-gerar').onclick = async () => {
            departamentoSelecionado = selectDept.value;
            modalDiv.remove();
            const fakeBtn = { disabled: false, innerText: 'Gerar PDF', style: {}, innerHTML: 'Gerar PDF' };
            await gerarPDF(fakeBtn);
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

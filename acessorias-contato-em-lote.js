
 // ==UserScript==
 // @name         Acessorias - Contatos em Lote
 // @namespace    gnp-acessorias-contatos
 // @version      3.0
 // @description  Gerencia e adiciona varios contatos na empresa
 // @match        https://app.acessorias.com/sysmain.php*
 // @run-at       document-idle
 // @grant        none
 // ==/UserScript==

 (() => {
   'use strict';

   const p = new URLSearchParams(location.search);
   if (
     location.pathname !== '/sysmain.php' ||
     p.get('m') !== '105' ||
     p.get('act') !== 'e' ||
     p.get('i') !== '1'
   ) return;

   const KEY = 'gnp_contatos_salvos_v2';
   let contacts = [];
   let editId = null;
   let running = false;
   let cancel = false;

   try {
     const data = JSON.parse(localStorage.getItem(KEY) || '[]');
     if (Array.isArray(data)) contacts = data;
   } catch {}

   const $ = id => document.getElementById(id);

   const style = document.createElement('style');
   style.textContent = `
     #gc-open {
       margin:8px 0;
       border:0;border-radius:7px;
       background:#5933a6;color:white;
       padding:9px 15px;cursor:pointer;
       font-weight:600
     }
     #gc-overlay {
       display:none;position:fixed;inset:0;
       background:#0008;z-index:2147483640;
       align-items:center;justify-content:center;
       font:14px Arial
     }
     #gc-modal {
       width:650px;max-width:96vw;
       max-height:90vh;overflow:auto;
       background:#fff;color:#222;
       border-radius:13px;padding:22px;
       box-shadow:0 10px 40px #0004
     }
     #gc-modal * {box-sizing:border-box}
     #gc-modal input[type=text],
     #gc-modal input[type=email] {
       padding:10px;border:1px solid #ccc;
       border-radius:6px;width:100%;
       background:#fff;color:#222
     }
     #gc-modal button {
       border:0;padding:9px 12px;
       border-radius:6px;cursor:pointer
     }
     #gc-modal button:disabled {
       opacity:.5;cursor:not-allowed
     }
     .gc-row {
       display:flex;gap:8px;align-items:center;
       margin:9px 0
     }
     .gc-row > * {min-width:0}
     .gc-contact {
       padding:12px 5px;
       border-bottom:1px solid #eee;
       display:flex;gap:12px;align-items:center
     }
     .gc-contact input[type=checkbox] {
       width:19px;height:19px;flex-shrink:0
     }
     .gc-info {
       flex:1;min-width:0;
       overflow-wrap:anywhere
     }
     .gc-info small {
       display:block;color:#666;margin-top:4px
     }
     .gc-purple{background:#5933a6;color:white}
     .gc-green{background:#198754;color:white}
     .gc-gray{background:#eee;color:#222}
     .gc-red{background:#ffe0e0;color:#a22}
     #gc-status {
       padding:9px 0;font-size:13px;
       white-space:pre-wrap
     }
   `;
   document.head.appendChild(style);

   const open = document.createElement('button');
   open.id = 'gc-open';
   open.type = 'button';
   open.textContent = '📇 Gerenciar contatos';

   // Botão dentro da própria seção de contatos.
   const section = $('DivCtt');
   if (!section) return;

   const heading = section.querySelector('label');
   if (heading) heading.insertAdjacentElement('afterend', open);
   else section.prepend(open);

   const overlay = document.createElement('div');
   overlay.id = 'gc-overlay';

   overlay.innerHTML = `
     <div id="gc-modal">
       <div class="gc-row" style="justify-content:space-between">
         <h3 style="margin:0">📇 Gerenciador de contatos</h3>
         <button id="gc-close" class="gc-gray" type="button">✕</button>
       </div>

       <p style="color:#666;font-size:12px">
         Salve seus contatos e adicione vários na empresa aberta.
       </p>

       <div class="gc-row">
         <input id="gc-name" type="text" placeholder="Nome">
         <input id="gc-role" type="text" placeholder="Cargo">
       </div>
       <div class="gc-row">
         <input id="gc-phone" type="text" placeholder="Celular">
         <input id="gc-email" type="email" placeholder="E-mail">
       </div>

       <div class="gc-row">
         <button id="gc-save" class="gc-purple" type="button">
           💾 Salvar contato
         </button>
         <button id="gc-cancel-edit" class="gc-gray"
                 style="display:none" type="button">
           Cancelar edição
         </button>
       </div>

       <hr>

       <div class="gc-row">
         <input id="gc-search" type="text"
                placeholder="Pesquisar contato...">
       </div>

       <div class="gc-row" style="justify-content:space-between">
         <label>
           <input type="checkbox" id="gc-all">
           Selecionar todos os contatos filtrados
         </label>
         <span id="gc-count">0 selecionados</span>
       </div>

       <div id="gc-list"></div>

       <hr>

       <div class="gc-row" style="justify-content:space-between">
         <button class="gc-green" id="gc-add" type="button">
           ✓ Adicionar selecionados
         </button>
         <button class="gc-red" id="gc-stop"
                 style="display:none" type="button">
           Parar
         </button>
       </div>

       <div id="gc-status" aria-live="polite"></div>
     </div>
   `;

   document.body.appendChild(overlay);

   const fields = {
     nome: $('gc-name'),
     cargo: $('gc-role'),
     fone: $('gc-phone'),
     email: $('gc-email')
   };

   const selected = new Set();

   function persist() {
     localStorage.setItem(KEY, JSON.stringify(contacts));
   }

   function setStatus(message, error = false) {
     const el = $('gc-status');
     el.textContent = message;
     el.style.color = error ? '#b42318' : '#187443';
   }

   function clearEdit() {
     editId = null;
     Object.values(fields).forEach(el => el.value = '');
     $('gc-save').textContent = '💾 Salvar contato';
     $('gc-cancel-edit').style.display = 'none';
   }

   function filtered() {
     const q = $('gc-search').value.trim().toLowerCase();
     return contacts.filter(c =>
       [c.nome, c.cargo, c.fone, c.email].some(v =>
         String(v || '').toLowerCase().includes(q)
       )
     );
   }

   function button(text, css, fn) {
     const el = document.createElement('button');
     el.type = 'button';
     el.className = css;
     el.textContent = text;
     el.disabled = running;
     el.onclick = fn;
     return el;
   }

   function render() {
     const list = $('gc-list');
     list.replaceChildren();

     for (const c of filtered()) {
       const row = document.createElement('div');
       row.className = 'gc-contact';

       const cb = document.createElement('input');
       cb.type = 'checkbox';
       cb.checked = selected.has(c.id);
       cb.disabled = running;
       cb.onchange = () => {
         if (cb.checked) selected.add(c.id);
         else selected.delete(c.id);
         count();
       };

       const info = document.createElement('div');
       info.className = 'gc-info';

       const name = document.createElement('strong');
       name.textContent = c.nome;

       const details = document.createElement('small');
       details.textContent = [c.cargo, c.fone, c.email]
         .filter(Boolean).join(' • ');

       info.append(name, details);

       const actions = document.createElement('div');

       actions.appendChild(button('Editar', 'gc-gray', () => {
         editId = c.id;
         for (const field of Object.keys(fields)) {
           fields[field].value = c[field] || '';
         }
         $('gc-save').textContent = 'Salvar alterações';
         $('gc-cancel-edit').style.display = '';
         $('gc-modal').scrollTop = 0;
       }));

       actions.appendChild(button('Excluir', 'gc-red', () => {
         if (!confirm('Excluir "' + c.nome + '"?')) return;
         contacts = contacts.filter(x => x.id !== c.id);
         selected.delete(c.id);
         persist();
         if (editId === c.id) clearEdit();
         render();
       }));

       row.append(cb, info, actions);
       list.appendChild(row);
     }

     if (!list.children.length) {
       const empty = document.createElement('p');
       empty.textContent = 'Nenhum contato encontrado.';
       list.appendChild(empty);
     }

     count();
   }

   function count() {
     const visible = filtered();
     $('gc-count').textContent = selected.size + ' selecionado(s)';
     $('gc-all').checked = visible.length > 0 &&
       visible.every(c => selected.has(c.id));
     $('gc-add').disabled = running || selected.size === 0;
     $('gc-save').disabled = running;
     $('gc-search').disabled = running;
     $('gc-all').disabled = running;
   }

   $('gc-save').onclick = () => {
     if (running) return;

     const data = {};
     for (const [key, el] of Object.entries(fields)) {
       data[key] = el.value.trim();
     }

     if (!data.nome) {
       alert('Informe o nome.');
       return;
     }

     if (data.email &&
       !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
       alert('E-mail inválido.');
       return;
     }

     if (editId !== null) {
       const index = contacts.findIndex(c => c.id === editId);
       if (index >= 0) {
         contacts[index] = { ...contacts[index], ...data };
       }
     } else {
       contacts.push({
         id: Date.now().toString(36) +
             Math.random().toString(36).slice(2),
         ...data
       });
     }

     persist();
     clearEdit();
     render();
     setStatus('Contato salvo!');
   };

   $('gc-cancel-edit').onclick = clearEdit;
   $('gc-search').oninput = render;

   $('gc-all').onchange = e => {
     for (const c of filtered()) {
       if (e.target.checked) selected.add(c.id);
       else selected.delete(c.id);
     }
     render();
   };

   function setSiteField(id, value) {
     const el = $(id);
     if (!el) throw Error('Campo ausente: ' + id);

     el.value = value || '';
     el.dispatchEvent(new Event('input', { bubbles: true }));
     el.dispatchEvent(new Event('change', { bubbles: true }));
   }

   function validatePage() {
     if (!$('EmpID_0')?.value) {
       throw Error('Empresa não identificada.');
     }
     if (!$('divRelCtt_0') || !$('CttNome_0')) {
       throw Error('Formulário de contatos indisponível.');
     }
     if (typeof window.x_addCtt !== 'function') {
       throw Error('Função de inclusão indisponível.');
     }
     if (typeof window.loadclearString !== 'function') {
       throw Error('Rotina de atualização indisponível.');
     }

     const editingCount = Number($('qCttZ_0')?.value || 0);
     for (let i = 1; i <= editingCount; i++) {
       const save = $('CttSave_0_' + i);
       if (save && getComputedStyle(save).display !== 'none') {
         throw Error('Conclua a edição aberta no Acessórias.');
       }
     }

     for (const id of [
       'CttNome_0', 'CttCargo_0',
       'CttFone_0', 'CttEMail_0'
     ]) {
       if (!$(id)) throw Error('Campo ausente: ' + id);
     }
   }

   // Replica os parâmetros da função original do Acessórias.
   // Não usa clique artificial nem modifica a sessão.
   function addOne(c) {
     return new Promise((resolve, reject) => {
       try {
         validatePage();

         const email = (c.email || '').trim();
         const domain = email.split('@')[1]?.toLowerCase();

         if (email &&
           !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
           throw Error('E-mail inválido: ' + c.nome);
         }

         if (['acessorias.com', 'acessorias.com.br']
           .includes(domain)) {
           throw Error('Domínio de e-mail não permitido.');
         }

         setSiteField('CttNome_0', c.nome);
         setSiteField('CttCargo_0', c.cargo);
         setSiteField('CttFone_0', c.fone);
         setSiteField('CttEMail_0', c.email);

         let horarios = '';

         for (let i = 0; i <= 2; i++) {
           const part = ['SN', 'HI', 'HF'].map(x =>
             $('AlocP' + i + '_' + x + '_0_New')?.value || ''
           ).join('');
           horarios += (i ? '|' : '') + part;
         }

         const value = id => $(id)?.value || '';

         const args = [
           value('EmpID_0'),
           value('CttNome_0').trim(),
           value('CttCargo_0'),
           value('CttFone_0'),
           value('CttEMail_0'),
           $('CttRecMail_New_0')?.checked ? '1' : '0',
           value('CttDeptos_New_0'),
           value('CbrObrIDz_New_0'),
           value('LgeAtivo_0'),
           value('LgePass_0'),
           horarios,
           '0'
         ];

         let settled = false;

         const timer = setTimeout(() => {
           if (settled) return;
           settled = true;
           reject(Error(
             'Servidor não confirmou a inclusão em 30 segundos.'
           ));
         }, 30000);

         function finish(error) {
           if (settled) return;
           settled = true;
           clearTimeout(timer);
           if (error) reject(error);
           else resolve();
         }

         window.x_addCtt(...args, response => {
           if (settled) return;

           try {
             if (response?.checkLgePW) {
               finish(Error(
                 'Acessórias solicitou senha de acesso ao App.'
               ));
               return;
             }

             if (typeof response !== 'string' ||
                 !response.includes('div') &&
                 !response.includes('CttNome')) {
               finish(Error(
                 'Resposta inesperada do Acessórias. ' +
                 'Confira a empresa antes de repetir.'
               ));
               return;
             }

             const parsed = document.createElement('div');
             parsed.innerHTML = response;

             // Verificação conservadora: resposta precisa conter
             // a estrutura de formulário conhecida.
             if (!parsed.querySelector('#CttNome_0')) {
               finish(Error(
                 'A resposta não contém o formulário esperado.'
               ));
               return;
             }

             $('divRelCtt_0').innerHTML = response;
             window.loadclearString();

             if (window.jQuery?.fn?.select2) {
               window.jQuery('.select2_OK').select2();
             }

             finish();
           } catch (error) {
             finish(error);
           }
         });

       } catch (error) {
         reject(error);
       }
     });
   }

   $('gc-add').onclick = async () => {
     if (running || !selected.size) return;

     const queue = contacts.filter(c => selected.has(c.id));

     if (!confirm(
       'Adicionar ' + queue.length +
       ' contato(s) à empresa aberta?\n\n' +
       'Os contatos serão enviados em sequência.'
     )) return;

     try {
       validatePage();

       const occupied = [
         'CttNome_0', 'CttCargo_0',
         'CttFone_0', 'CttEMail_0'
       ].some(id => $(id)?.value.trim());

       if (occupied && !confirm(
         'Os campos atuais estão preenchidos. Substituí-los?'
       )) return;

       running = true;
       cancel = false;

       $('gc-stop').style.display = '';
       $('gc-close').disabled = true;
       render();

       let completed = 0;

       for (const c of queue) {
         if (cancel) break;

         setStatus(
           'Processando ' + (completed + 1) +
           '/' + queue.length + ': ' + c.nome
         );

         // Só envia o próximo após o retorno do anterior.
         try {
           await addOne(c);
         } catch (error) {
           throw Error(c.nome + ': ' + error.message);
         }

         selected.delete(c.id);
         completed++;
         render();

         setStatus(
           completed + '/' + queue.length +
           ' inclusões retornaram com sucesso.'
         );
       }

       setStatus(
         'Finalizado: ' + completed + '/' +
         queue.length + ' enviados.\n' +
         'Confira os registros na lista do Acessórias.'
       );

     } catch (error) {
       setStatus(
         'Processamento interrompido: ' + error.message +
         '\nVerifique os registros antes de tentar novamente.',
         true
       );
     } finally {
       running = false;
       $('gc-stop').style.display = 'none';
       $('gc-close').disabled = false;
       render();
     }
   };

   $('gc-stop').onclick = () => {
     cancel = true;
     setStatus('Parada solicitada. Concluindo o contato atual...');
   };

   open.onclick = () => {
     overlay.style.display = 'flex';
     render();
   };

   $('gc-close').onclick = () => {
     if (!running) overlay.style.display = 'none';
   };

   overlay.addEventListener('click', e => {
     if (e.target === overlay && !running) {
       overlay.style.display = 'none';
     }
   });

   render();
 })();

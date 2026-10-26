
 // ==UserScript==
 // @name         Acessorias - Importar Cartao CNPJ
 // @namespace    gnp-acessorias-cnpj
 // @version      3.1.0
 // @description  Importador de Cartao CNPJ com atualizacao automatica
 // @match        https://app.acessorias.com/sysmain.php*
 // @run-at       document-idle
 // @require      https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
 // @updateURL    https://raw.githubusercontent.com/Soy-Pardal/tampermonkey-komunic-tools/main/acessorias-cartao-cnpj.js
 // @downloadURL  https://raw.githubusercontent.com/Soy-Pardal/tampermonkey-komunic-tools/main/acessorias-cartao-cnpj.js
 // @grant        none
 // ==/UserScript==


 (function () {
   'use strict';

   // Executa apenas na tela solicitada.
   const url = new URL(location.href);

   if (
     url.pathname !== '/sysmain.php' ||
     url.searchParams.get('m') !== '105' ||
     url.searchParams.get('act') !== 'e' ||
     url.searchParams.get('i') !== '1'
   ) return;

   if (document.getElementById('gnp-pdf-import')) return;

   const $ = id => document.getElementById(id);

   const campos = {
     EmpCNPJ: 'CNPJ',
     EmpNome: 'Razão social',
     EmpFantasia: 'Nome fantasia',
     EmpLogradouro: 'Logradouro',
     EmpLogNum: 'Número',
     EmpComplemento: 'Complemento',
     EmpCEP: 'CEP',
     EmpBairro: 'Bairro',
     EmpCidade: 'Cidade',
     EmpUF: 'UF'
   };

   // Confere se o formulário correto está aberto.
   if (!$('EmpCNPJ') || !$('EmpNome')) return;

   const css = document.createElement('style');

   css.textContent = `
     #gnp-pdf-import {
       margin:10px 0;
       padding:10px 15px;
       border:0;
       border-radius:7px;
       background:#5834a4;
       color:white;
       font-weight:600;
       cursor:pointer;
     }

     #gnp-pdf-overlay {
       position:fixed;
       inset:0;
       z-index:2147483640;
       display:none;
       align-items:center;
       justify-content:center;
       background:rgba(0,0,0,.55);
       font:14px Arial,sans-serif;
     }

     #gnp-pdf-modal {
       width:560px;
       max-width:95vw;
       max-height:90vh;
       overflow:auto;
       padding:22px;
       border-radius:12px;
       background:white;
       color:#222;
       box-shadow:0 10px 35px #0004;
     }

     #gnp-pdf-modal h3 {
       margin:0 0 14px;
     }

     .gnp-pdf-row {
       display:flex;
       gap:10px;
       align-items:center;
       margin:10px 0;
     }

     .gnp-pdf-row label {
       width:125px;
       flex-shrink:0;
       font-size:12px;
       font-weight:bold;
     }

     .gnp-pdf-row input {
       flex:1;
       min-width:0;
       padding:9px;
       border:1px solid #ccc;
       border-radius:6px;
       color:#222;
       background:white;
     }

     .gnp-pdf-actions {
       display:flex;
       justify-content:flex-end;
       gap:10px;
       margin-top:18px;
     }

     .gnp-pdf-actions button {
       padding:10px 15px;
       border:0;
       border-radius:7px;
       cursor:pointer;
     }

     #gnp-pdf-apply {
       background:#18834b;
       color:white;
     }

     #gnp-pdf-cancel {
       background:#eee;
       color:#222;
     }
   `;

   document.head.appendChild(css);

   const button = document.createElement('button');
   button.id = 'gnp-pdf-import';
   button.type = 'button';
   button.textContent = '📄 Importar Cartão CNPJ';

   // Não envolve o botão em um formulário de envio.
   const campoCnpj = $('EmpCNPJ');
   const area = campoCnpj.closest('.form-group')
     || campoCnpj.parentElement;

   area.insertAdjacentElement('afterend', button);

   const fileInput = document.createElement('input');
   fileInput.type = 'file';
   fileInput.accept = 'application/pdf,.pdf';
   fileInput.hidden = true;
   document.body.appendChild(fileInput);

   const overlay = document.createElement('div');
   overlay.id = 'gnp-pdf-overlay';

   overlay.innerHTML = `
     <div id="gnp-pdf-modal">
       <h3>📄 Dados do Cartão CNPJ</h3>
       <p>
         Confira e corrija os dados antes de preencher.
       </p>

       <div id="gnp-pdf-fields"></div>

       <p style="font-size:12px;color:#666">
         Telefone e e-mail não serão alterados.
         O cadastro não será salvo automaticamente.
       </p>

       <div class="gnp-pdf-actions">
         <button type="button" id="gnp-pdf-cancel">
           Cancelar
         </button>
         <button type="button" id="gnp-pdf-apply">
           ✓ Preencher cadastro
         </button>
       </div>
     </div>
   `;

   document.body.appendChild(overlay);

   const preview = {};

   function normalize(str) {
     return String(str || '')
       .normalize('NFD')
       .replace(/[\u0300-\u036f]/g, '')
       .toUpperCase()
       .replace(/\s+/g, ' ')
       .trim();
   }

   function fechar() {
     overlay.style.display = 'none';
   }

   $('gnp-pdf-cancel').onclick = fechar;

   button.onclick = function () {
     fileInput.value = '';
     fileInput.click();
   };

   async function extrairTextoPDF(file) {
     const pdfjs = window.pdfjsLib;

     if (!pdfjs) {
       throw new Error('Biblioteca PDF.js indisponível.');
     }

     pdfjs.GlobalWorkerOptions.workerSrc =
       'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

     const buffer = await file.arrayBuffer();

     const pdf = await pdfjs.getDocument({
       data: new Uint8Array(buffer)
     }).promise;

     const page = await pdf.getPage(1);
     const content = await page.getTextContent();

     const linhas = [];

     for (const item of content.items) {
       if (!item.str?.trim()) continue;

       const x = item.transform[4];
       const y = item.transform[5];

       let linha = linhas.find(l =>
         Math.abs(l.y - y) <= 2.5
       );

       if (!linha) {
         linha = {y, parts:[]};
         linhas.push(linha);
       }

       linha.parts.push({
         x,
         text:item.str.trim()
       });
     }

     linhas.sort((a,b) => b.y - a.y);

     for (const linha of linhas) {
       linha.parts.sort((a,b) => a.x - b.x);
       linha.text = linha.parts.map(p => p.text).join(' ');
     }

     return linhas;
   }

   function interpretar(linhas) {
     const texto = linhas.map(l => l.text).join('\n');

     function localizarLinha(regex) {
       return linhas.findIndex(l =>
         regex.test(normalize(l.text))
       );
     }

     function proximaLinha(index) {
       if (index < 0) return null;

       const atual = linhas[index];

       return linhas.slice(index + 1).find(l =>
         atual.y - l.y > 3
       ) || null;
     }

     function linhaAbaixo(regex) {
       const i = localizarLinha(regex);
       return proximaLinha(i)?.text || '';
     }

     // Extrai uma coluna pela posição horizontal.
     function coluna(rotulo, proximoRotulo) {
       for (let i = 0; i < linhas.length; i++) {
         const atual = linhas[i];

         const partes = atual.parts;

         const inicio = partes.find(p =>
           normalize(p.text).includes(normalize(rotulo))
         );

         if (!inicio) continue;

         const limite = proximoRotulo
           ? partes.find(p =>
               p.x > inicio.x &&
               normalize(p.text).includes(
                 normalize(proximoRotulo)
               )
             )
           : null;

         const abaixo = proximaLinha(i);
         if (!abaixo) return '';

         const valores = abaixo.parts.filter(p =>
           p.x >= inicio.x - 4 &&
           (!limite || p.x < limite.x - 4)
         );

         return valores.map(p => p.text).join(' ').trim();
       }

       return '';
     }

     // Exige um documento com a estrutura esperada.
     if (
       !normalize(texto).includes('CADASTRO NACIONAL') ||
       !normalize(texto).includes('NOME EMPRESARIAL')
     ) {
       throw new Error(
         'O PDF não parece ser um Cartão CNPJ da Receita Federal.'
       );
     }

     const cnpj = texto.match(
       /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/
     )?.[0] || '';

     const dados = {
       EmpCNPJ: cnpj,

       EmpNome: coluna(
         'NOME EMPRESARIAL',
         'DATA DE CONSTITUIÇÃO'
       ) || linhaAbaixo(/NOME EMPRESARIAL/),

       EmpFantasia: coluna(
         'TITULO DO ESTABELECIMENTO',
         'PORTE'
       ),

       EmpLogradouro: coluna(
         'LOGRADOURO',
         'NUMERO'
       ),

         EmpLogNum: (() => {
             // Procura a linha de cabeçalho do endereço,
             // onde aparecem LOGRADOURO, NÚMERO e COMPLEMENTO.

             const normal = s => normalize(s || '');

             const index = linhas.findIndex(l => {
                 const texto = normal(l.text);
                 return texto.includes('LOGRADOURO') &&
                     texto.includes('NUMERO') &&
                     texto.includes('COMPLEMENTO');
             });

             if (index === -1) return '';

             const cabecalho = linhas[index];
             const valores = linhas[index + 1];

             if (!valores) return '';

             const colunaNumero = cabecalho.parts.find(p =>
                                                       normal(p.text) === 'NUMERO'
                                                      );

             if (!colunaNumero) return '';

             // Procura o valor abaixo da coluna NÚMERO.
             const candidato = valores.parts.find(p =>
                                                  p.x >= colunaNumero.x - 5 &&
                                                  p.x <= colunaNumero.x + 40 &&
                                                  /^\d+[A-Za-z]?$/.test(p.text.trim())
                                                 );

             return candidato?.text.trim() || '';
         })(),

       EmpComplemento: coluna(
         'COMPLEMENTO',
         null
       ),

       EmpCEP: coluna(
         'CEP',
         'BAIRRO/DISTRITO'
       ),

       EmpBairro: coluna(
         'BAIRRO/DISTRITO',
         'MUNICIPIO'
       ),

       EmpCidade: coluna(
         'MUNICIPIO',
         'UF'
       ),

       EmpUF: coluna(
         'UF',
         null
       )
     };

     // Não permite copiar campos de e-mail ou telefone.
     // Também elimina textos que sejam apenas placeholders.
     for (const key of Object.keys(dados)) {
       const value = String(dados[key] || '').trim();

       if (
         !value ||
         /^\*+$/.test(value) ||
         value === '-'
       ) {
         dados[key] = '';
       }
     }

     // Evita aplicar nome fantasia se não identificado.
     // Mantém conferência manual dos campos.
     if (!dados.EmpCNPJ || !dados.EmpNome) {
       throw new Error(
         'CNPJ ou razão social não identificados corretamente.'
       );
     }

     return dados;
   }

   function mostrarPreview(dados) {
     const div = $('gnp-pdf-fields');
     div.replaceChildren();

     for (const [id, titulo] of Object.entries(campos)) {
       const row = document.createElement('div');
       row.className = 'gnp-pdf-row';

       const label = document.createElement('label');
       label.textContent = titulo;

       const input = document.createElement('input');
       input.type = 'text';
       input.value = dados[id] || '';
       input.placeholder = 'Não identificado';

       // O usuário pode corrigir o valor antes de aplicar.
       preview[id] = input;

       row.append(label, input);
       div.appendChild(row);
     }

     overlay.style.display = 'flex';
   }

   // Preenchimento silencioso:
   // nenhum evento change/input/blur é disparado.
   function setField(id, value) {
     const element = $(id);
     if (!element || !value) return false;

     if (
       !['INPUT','TEXTAREA','SELECT']
         .includes(element.tagName)
     ) return false;

     if (element.tagName === 'SELECT') {
       const option = [...element.options].find(o =>
         normalize(o.value) === normalize(value) ||
         normalize(o.textContent) === normalize(value)
       );

       if (!option) return false;

       element.value = option.value;
     } else {
       element.value = String(value).trim();
     }

     return true;
   }

   $('gnp-pdf-apply').onclick = () => {
     // Confere novamente a URL antes de preencher.
     const current = new URL(location.href);

     if (
       current.searchParams.get('m') !== '105' ||
       current.searchParams.get('act') !== 'e' ||
       current.searchParams.get('i') !== '1'
     ) {
       alert('Você não está mais na tela de cadastro.');
       return;
     }

     const faltantes = [];
     let total = 0;

     for (const id of Object.keys(campos)) {
       const value = preview[id]?.value.trim() || '';

       if (!value) continue;

       if (setField(id, value)) {
         total++;
       } else {
         faltantes.push(campos[id]);
       }
     }

     fechar();

     let message =
       total + ' campos preenchidos.\n' +
       'Confira as informações antes de salvar.';

     if (faltantes.length) {
       message += '\n\nCampos não preenchidos: ' +
         faltantes.join(', ');
     }

     alert(message);
   };

   fileInput.addEventListener('change', async () => {
     const file = fileInput.files?.[0];
     if (!file) return;

     if (!file.name.toLowerCase().endsWith('.pdf')) {
       alert('Selecione um arquivo PDF.');
       return;
     }

     button.disabled = true;
     button.textContent = 'Lendo PDF...';

     try {
       const linhas = await extrairTextoPDF(file);
       const dados = interpretar(linhas);

       mostrarPreview(dados);

     } catch (error) {
       console.error('[GNP CNPJ]', error);
       alert(
         'Não foi possível importar o documento:\n' +
         error.message
       );
     } finally {
       button.disabled = false;
       button.textContent = '📄 Importar Cartão CNPJ';
     }
   });

 })();

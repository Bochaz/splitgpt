// ===== JSONBin & Trip Registry =====
let CURRENT_BIN_ID = window.TRIPSPLIT_BIN_ID || "";
const KNOWN_BINS = [
  {id: CURRENT_BIN_ID, name: 'Viaje 01'},
  {id: '68c491b9ae596e708fecc3ca', name: 'Viaje 02'},
  {id: '68c491cd43b1c97be94105f7', name: 'Viaje 03'}
];
const JSONBIN_ROOT = 'https://api.jsonbin.io/v3/b';
const JSONBIN_GET_URL = (id) => `${JSONBIN_ROOT}/${id}/latest`;
const JSONBIN_PUT_URL = (id) => `${JSONBIN_ROOT}/${id}`;
let lastRemoteTs = 0, pollTimer = null;
const debounce=(fn,ms)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);}};
const showStatus = (msg) => {const el=document.getElementById('status'); el.textContent=msg; el.style.display='block'; clearTimeout(el._t); el._t=setTimeout(()=>{el.style.display='none'}, 1200);};

// ===== App state =====
const CATEGORIES = ['Comida','Transporte','Alojamiento','Entretenimiento','Compras','Combustible','Tours','Otros'];
const state = {
  tripName: 'Viaje 01',
  currency: '$',
  participants: [{id:uid(),name:'Ana'},{id:uid(),name:'Juan'}],
  expenses: [],
  payments: [],
  draft:null, editingId:null,
  activeTab:'viajeros',

  // NUEVO: “quién soy” y filtro por persona (no se sincronizan al BIN)
  currentViewerId: loadViewerPref(),
  viewerFilter: loadViewerFilterPref()
};

// ===== Utils =====
function uid(){return Math.random().toString(36).slice(2,9)}
function formatAmount(n){ if(Number.isNaN(n)||n==null) return '0.00'; return Number(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
function parseAmount(s){ if(typeof s==='number') return s; if(!s) return 0; const clean=String(s).replace(/[^0-9,.-]/g,'').replace(',','.'); const n=parseFloat(clean); return Number.isFinite(n)?n:0; }
function nameById(id){ const p=state.participants.find(p=>p.id===id); return p? p.name : '(?)'; }
function escapeHtml(s){ return String(s).replace(/[&<>\"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m])); }
function fmtDate(d){ try{ if(!d) return ''; const [y,m,da]=String(d).split('-'); return `${da.padStart(2,'0')}-${m.padStart(2,'0')}-${String(y).slice(2)}`; }catch(e){ return d||''; } }
function saveLocal(k,v){ localStorage.setItem(k, JSON.stringify(v)); }
function loadLocal(k,def){ try{ const x=JSON.parse(localStorage.getItem(k)||'null'); return (x==null?def:x);}catch(_){return def;} }
function loadViewerPref(){ return loadLocal('tripsplit_viewer', null); }
function saveViewerPref(id){ saveLocal('tripsplit_viewer', id); }
function loadViewerFilterPref(){ return !!loadLocal('tripsplit_viewer_filter', false); }
function saveViewerFilterPref(v){ saveLocal('tripsplit_viewer_filter', !!v); }

// ===== Calc =====
function computePerHead(e){
  const amt=parseAmount(e.amount);
  if(!amt||amt<=0) return {};
  const involved=(e.involvedIds||[]).filter(id=>state.participants.find(p=>p.id===id));
  const per={}; if(involved.length===0) return per;
  if(e.split?.mode==='equal'){
    const share=amt/involved.length; involved.forEach(id=>per[id]=share);
  } else if(e.split?.mode==='shares'){
    const total=involved.reduce((a,id)=>a+(parseAmount(e.split.shares?.[id])||0),0);
    involved.forEach(id=>{const s=parseAmount(e.split.shares?.[id])||0; per[id]= total>0? (amt*s)/total : 0;});
  } else if(e.split?.mode==='percent'){
    const total=involved.reduce((a,id)=>a+(parseAmount(e.split.percents?.[id])||0),0);
    involved.forEach(id=>{const p=parseAmount(e.split.percents?.[id])||0; per[id]= total>0? (amt*p)/total : 0;});
  } else if(e.split?.mode==='exact'){
    involved.forEach(id=>per[id]=parseAmount(e.split.exact?.[id])||0);
    const sum=Object.values(per).reduce((a,b)=>a+b,0); if(sum>0 && Math.abs(sum-amt)>0.01){const f=amt/sum; for(const k in per) per[k]*=f;}
  } else {
    const share=amt/involved.length; involved.forEach(id=>per[id]=share);
  }
  return per;
}

function viewerDeltaForExpense(e, viewerId){
  // + => el viewer "prestó" (pagó de más); - => el viewer "debe" (pagó de menos)
  if(!viewerId) return 0;
  const per = computePerHead(e);
  const owed = per[viewerId] || 0;
  const paid = (e.payerId===viewerId) ? (parseAmount(e.amount)||0) : 0;
  return paid - owed;
}

function computeBalancesAndTotals(){
  const raw={}; state.participants.forEach(p=>raw[p.id]=0);
  for(const e of state.expenses){
    const per=computePerHead(e); const amt=parseAmount(e.amount)||0; if(amt<=0) continue;
    if(e.payerId) raw[e.payerId]+=amt;
    Object.entries(per).forEach(([id,val])=> raw[id]-=val);
  }
  const incoming={}, outgoing={}; state.participants.forEach(p=>{incoming[p.id]=0; outgoing[p.id]=0;});
  for(const p of state.payments){const amt=parseAmount(p.amount)||0; if(amt<=0) continue; if(p.fromId) outgoing[p.fromId]+=amt; if(p.toId) incoming[p.toId]+=amt;}
  const net={}; state.participants.forEach(p=> net[p.id]=(raw[p.id]||0)-(incoming[p.id]||0)+(outgoing[p.id]||0));
  const totals={ paidBy:Object.fromEntries(state.participants.map(p=>[p.id,0])), owedBy:Object.fromEntries(state.participants.map(p=>[p.id,0])) };
  for(const e of state.expenses){const per=computePerHead(e); const amt=parseAmount(e.amount)||0; if(amt<=0) continue; if(e.payerId) totals.paidBy[e.payerId]+=amt; Object.entries(per).forEach(([id,val])=> totals.owedBy[id]+=val);}
  return {raw,net,totals,incoming,outgoing};
}
function computeSettlements(bal){const debt=[], cred=[]; Object.entries(bal).forEach(([id,n])=>{if(Math.abs(n)<1e-8) return; if(n<0) debt.push({id,amount:-n}); else cred.push({id,amount:n});});
  debt.sort((a,b)=>b.amount-a.amount); cred.sort((a,b)=>b.amount-a.amount); const res=[]; let i=0,j=0;
  while(i<debt.length && j<cred.length){const d=debt[i], c=cred[j]; const amt=Math.min(d.amount,c.amount); res.push({from:d.id,to:c.id,amount:amt}); d.amount-=amt; c.amount-=amt; if(d.amount<=1e-8) i++; if(c.amount<=1e-8) j++;} return res; }

// ===== Render =====
function ensureDraft(fromExpense){
  if(fromExpense){state.draft=JSON.parse(JSON.stringify(fromExpense)); return;}
  if(!state.draft){
    state.draft={ id:uid(), desc:'', amount:'', date:new Date().toISOString().slice(0,10),
      payerId:null, involvedIds:state.participants.map(p=>p.id), split:{mode:'equal'}, category:'' };
  }
  state.draft.payerId = state.draft.payerId || null;
  state.draft.involvedIds = (state.draft.involvedIds||[]).filter(id=>state.participants.find(p=>p.id===id));
  if(state.draft.involvedIds.length===0) state.draft.involvedIds = state.participants.map(p=>p.id);
}

function render(){
  const app=document.getElementById('app');
  const calc=computeBalancesAndTotals();
  const settlements=computeSettlements(calc.net);

  // tabs
  document.querySelectorAll('.tab').forEach(t=>{
    t.classList.toggle('active', t.dataset.tab===state.activeTab);
    t.onclick=()=>{state.activeTab=t.dataset.tab; render();};
  });

  // header buttons (viewer/filter)
  bindTripTitle(); bindHeaderButtons();

  // view
  let html='';
  if(state.activeTab==='viajeros') html+=renderViajeros();
  if(state.activeTab==='nuevo')    html+=renderNuevo();
  if(state.activeTab==='gastos')   html+=renderGastos();
  if(state.activeTab==='pagos')    html+=renderPagos(calc);
  if(state.activeTab==='saldos')   html+=renderSaldos(calc,settlements);
  if(state.activeTab==='resumen')  html+=renderResumen();

  app.innerHTML = html;

  if(state.activeTab==='viajeros') bindViajeros();
  if(state.activeTab==='nuevo')    bindNuevo();
  if(state.activeTab==='gastos')   bindGastos();
  if(state.activeTab==='pagos')    bindPagos();
  if(state.activeTab==='resumen')  drawPie();
}

function renderViajeros(){
  return `
  <section class="panel">
    <h2>Viajeros</h2>
    <div class="row" style="gap:8px;align-items:flex-end;flex-wrap:wrap">
      <div style="flex:1;min-width:220px"><label class="block"><div class="label">Nuevo viajero</div><input id="inpNewName" placeholder="Nombre"></label></div>
      <button id="btnAddPerson" class="btn">Agregar</button>
    </div>
    <div class="spacer" style="height:12px"></div>
    <div class="row" style="flex-wrap:wrap;gap:8px">
      ${state.participants.map(p=>`<span class="pill">${escapeHtml(p.name)} <button data-del="${p.id}" class="btn" style="padding:4px 6px;color:#b91c1c;border-color:#b91c1c">quitar</button></span>`).join('')}
      ${state.participants.length===0? '<span class="muted">Agregá viajeros para empezar</span>' : ''}
    </div>
  </section>`;
}

function extraSplitInputsHTML(){
  const m=state.draft.split.mode; const ppl=state.draft.involvedIds;
  if(m==='shares'){return `<div class="spacer"></div><div class="card"><div class="label">Ponderaciones (1,2,3...)</div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">
      ${ppl.map(id=>`<label class="block"><div class="label">${escapeHtml(nameById(id))}</div><input data-share="${id}" value="${escapeHtml(state.draft.split.shares?.[id]??'')}"></label>`).join('')}
    </div></div>`; }
  if(m==='percent'){return `<div class="spacer"></div><div class="card"><div class="label">Porcentajes (sugerido: 100)</div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">
      ${ppl.map(id=>`<label class="block"><div class="label">${escapeHtml(nameById(id))}</div><input data-percent="${id}" value="${escapeHtml(state.draft.split.percents?.[id]??'')}"></label>`).join('')}
    </div></div>`; }
  if(m==='exact'){return `<div class="spacer"></div><div class="card"><div class="label">Montos exactos</div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">
      ${ppl.map(id=>`<label class="block"><div class="label">${escapeHtml(nameById(id))}</div><input data-exact="${id}" placeholder="$ 0,00" value="${escapeHtml(state.draft.split.exact?.[id]??'')}"></label>`).join('')}
    </div></div>`; }
  return '';
}

function renderNuevo(){
  ensureDraft(); const isEditing=!!state.editingId;
  return `
  <section class="panel">
    <div class="row" style="justify-content:space-between">
      <h2>${isEditing? 'Editar gasto' : 'Nuevo gasto'}</h2>
      ${isEditing? '<button id="btnCancelEdit" class="btn">Cancelar edición</button>' : ''}
    </div>

    <div class="grid grid-6">
      <div class="col"><label class="block"><div class="label">Categoría</div>
        <select id="gCategory"><option disabled ${state.draft.category? '' : 'selected'}>Seleccioná</option>${CATEGORIES.map(c=>`<option value="${c}" ${c===state.draft.category?'selected':''}>${c}</option>`).join('')}</select>
      </label></div>

      <div class="col" style="grid-column: span 2"><label class="block"><div class="label">Descripción</div><input id="gDesc" placeholder="Ej: Cena, Nafta, Hotel" value="${escapeHtml(state.draft.desc)}"></label></div>

      <div class="col"><label class="block"><div class="label">Monto</div><div class="prefix-input"><span class="prefix">$</span><input id="gAmount" placeholder="$0,00" inputmode="decimal" value="${state.draft.amount==null?'':escapeHtml(state.draft.amount)}"></div></label></div>

      <div class="col"><label class="block"><div class="label">Fecha</div><input id="gDate" type="date" value="${escapeHtml(state.draft.date)}"></label></div>

      <div class="col"><label class="block"><div class="label">Pagó</div>
        <select id="gPayer"><option disabled ${state.draft.payerId? '' : 'selected'}>Seleccioná</option>
          ${state.participants.map(p=>`<option value="${p.id}" ${p.id===state.draft.payerId?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}
        </select>
      </label></div>

      <div class="col"><label class="block"><div class="label">Modo de división</div>
        <select id="gMode">
          ${['equal','shares','percent','exact'].map(m=>`<option value="${m}" ${state.draft.split.mode===m?'selected':''}>${({equal:'Partes iguales',shares:'Por ponderaciones',percent:'Por porcentaje',exact:'Montos exactos'})[m]}</option>`).join('')}
        </select>
      </label></div>
    </div>

    <div class="spacer"></div>
    <div class="label">¿Quiénes participan de este gasto?</div>
    <div class="row" style="flex-wrap:wrap;gap:8px">
      ${state.participants.map(p=>{const on=state.draft.involvedIds.includes(p.id); return `<button class="pill ${on?'active':''}" data-tgl="${p.id}">${escapeHtml(p.name)}</button>`;}).join('')}
    </div>

    ${state.draft.split.mode!=='equal' ? extraSplitInputsHTML() : ''}

    <div class="spacer" style="height:16px"></div>
    <div class="row" style="justify-content:space-between">
      <button id="btnClearExpense" class="btn">Limpiar</button>
      ${isEditing? '<button id="btnSaveEdit" class="btn success">Guardar cambios</button>' : '<button id="btnAddExpense" class="btn success">Agregar gasto</button>'}
    </div>
  </section>`;
}

function renderGastos(){
  // FILTRO por “quién soy”
  const viewer = state.currentViewerId;
  const applyFilter = !!state.viewerFilter && !!viewer;

  const list = applyFilter
    ? state.expenses.filter(e => (e.involvedIds||[]).includes(viewer))
    : state.expenses;

  return `
  <section class="panel">
    <h2>Gastos cargados ${applyFilter ? `<span class="muted">· Filtrando por ${escapeHtml(nameById(viewer))}</span>`:''}</h2>
    ${list.length===0 ? '<div class="muted">No hay gastos.</div>' : `
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Fecha</th><th>Categoría</th><th>Pagó</th><th>Incluye</th><th class="right">Monto</th><th class="right">Acciones</th></tr></thead>
          <tbody>
          ${list.map(e=>{
            const delta = applyFilter ? viewerDeltaForExpense(e, viewer) : 0;
            const cls = applyFilter ? (delta>0?'viewer-pos': (delta<0?'viewer-neg':'')) : '';
            return `
            <tr class="${cls}">
              <td>${fmtDate(e.date)}</td><td>${escapeHtml(e.category||'Otros')}</td>
              <td>${escapeHtml(nameById(e.payerId))}</td><td>${e.involvedIds.map(nameById).map(escapeHtml).join(', ')}</td>
              <td class="right"><b>$ ${formatAmount(e.amount)}</b></td>
              <td class="right">
                <button class="btn" data-edit-exp="${e.id}">Editar</button>
                <button class="btn" data-detail-exp="${e.id}">Detalle</button>
                <button class="btn danger" style="margin-left:6px" data-del-exp="${e.id}">Eliminar</button>
              </td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>`}
  </section>`;
}

function renderPagos(calc){
  return `
  <section class="panel">
    <h2>Registrar pagos entre viajeros</h2>
    <div class="grid grid-6">
      <div class="col"><label class="block"><div class="label">Fecha</div><input id="pDate" type="date" value="${new Date().toISOString().slice(0,10)}"></label></div>
      <div class="col"><label class="block"><div class="label">De</div><select id="pFrom"><option disabled selected>Seleccioná</option>${state.participants.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select></label></div>
      <div class="col"><label class="block"><div class="label">Para</div><select id="pTo"><option disabled selected>Seleccioná</option>${state.participants.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select></label></div>
      <div class="col"><label class="block"><div class="label">Monto</div><div class="prefix-input"><span class="prefix">$</span><input id="pAmount" placeholder="$0,00" inputmode="decimal"></div></label></div>
      <div class="col" style="grid-column: span 2"><label class="block"><div class="label">Nota (opcional)</div><input id="pNote" placeholder="Transferencia, efectivo, etc."></label></div>
    </div>
    <div class="spacer" style="height:16px"></div>
    <div class="row"><button id="btnAddPayment" class="btn success">Agregar pago</button></div>
  </section>
  <section class="panel">
    <h2>Pagos registrados</h2>
    ${state.payments.length===0 ? '<div class="muted">Todavía no hay pagos.</div>' : `
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Fecha</th><th>De</th><th>Para</th><th>Nota</th><th class="right">Monto</th><th></th></tr></thead>
          <tbody>
            ${state.payments.map(p=>`
              <tr>
                <td>${p.date||''}</td><td>${escapeHtml(nameById(p.fromId))}</td><td>${escapeHtml(nameById(p.toId))}</td><td>${escapeHtml(p.note||'')}</td>
                <td class="right"><b>$ ${formatAmount(p.amount)}</b></td>
                <td class="right"><button class="btn danger" data-del-pay="${p.id}">Eliminar</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`}
  </section>`;
}

function showExpenseDetail(e){
  const per=computePerHead(e);
  const mode=e.split?.mode || 'equal';

  function labelFor(id){
    if(mode==='equal'){
      const n=(e.involvedIds||[]).length||1;
      return `= 1/${n}`;
    } else if(mode==='shares'){
      const w = e.split?.shares?.[id] ?? '';
      return `peso ${w||'–'}`;
    } else if(mode==='percent'){
      const p = e.split?.percents?.[id] ?? '';
      return `${p||'0'}%`;
    } else if(mode==='exact'){
      const x = e.split?.exact?.[id] ?? '';
      return `$ ${x||'0,00'}`;
    }
    return '';
  }

  const overlay=document.createElement('div'); overlay.className='modal-overlay'; overlay.innerHTML=`
  <div class="modal">
    <div class="row" style="justify-content:space-between"><h2>Detalle del gasto</h2><button class="btn" data-close>✕</button></div>
    <div class="muted" style="margin-bottom:8px">${fmtDate(e.date)} · ${escapeHtml(e.category||'Otros')}</div>
    <div class="card" style="margin-bottom:8px">
      <div><b>${escapeHtml(e.desc||'(sin nota)')}</b></div>
      <div class="muted">Pagó: ${escapeHtml(nameById(e.payerId))} · Total: <b>$ ${formatAmount(e.amount)}</b></div>
      <div class="muted">Modo de división: ${({equal:'Partes iguales',shares:'Por ponderaciones',percent:'Porcentaje',exact:'Montos exactos'})[mode]}</div>
    </div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px">
      ${Object.keys(per).map(id=>`
        <div class="card">
          <div class="muted">${escapeHtml(nameById(id))}</div>
          <div><b>$ ${formatAmount(per[id])}</b> <span class="muted" style="margin-left:6px">(${escapeHtml(labelFor(id))})</span></div>
        </div>`).join('')}
    </div>
    <div class="spacer"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Cerrar</button></div>
  </div>`;
  function close(){document.body.removeChild(overlay);}
  overlay.addEventListener('click',(ev)=>{if(ev.target===overlay || ev.target.hasAttribute('data-close')) close();});
  document.addEventListener('keydown', esc); function esc(ev){if(ev.key==='Escape'){close(); document.removeEventListener('keydown', esc);}}
  document.body.appendChild(overlay);
}

function renderSaldos(calc, settlements){
  // Reordenar: si hay viewer seleccionado, va primero
  const viewer = state.currentViewerId;
  const ordered = [...state.participants].sort((a,b)=>{
    if(!viewer) return 0;
    if(a.id===viewer && b.id!==viewer) return -1;
    if(b.id===viewer && a.id!==viewer) return 1;
    return 0;
  });

  return `
  <section class="panel">
    <h2>Saldos por persona ${viewer? `<span class="muted">· Prioridad: ${escapeHtml(nameById(viewer))}</span>`:''}</h2>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px">
      ${ordered.map(p=>{
        const raw=calc.raw[p.id]||0, net=calc.net[p.id]||0, paid=calc.totals.paidBy[p.id]||0, owed=calc.totals.owedBy[p.id]||0;
        return `<div class="card">
          <div style="font-weight:600">${escapeHtml(p.name)}${viewer && p.id===viewer ? ' <span class="muted">(yo)</span>' : ''}</div>
          <div class="muted">Pagó: <b>$ ${formatAmount(paid)}</b></div>
          <div class="muted">Le corresponde: <b>$ ${formatAmount(owed)}</b></div>
          <div class="muted">Saldo (antes de pagos): <b>${raw>=0?'+':''}$ ${formatAmount(raw)}</b></div>
          <div style="margin-top:6px;font-weight:800;color:${net>=0?'var(--ok)':'#b91c1c'}">Saldo actual: ${net>=0?'+':''}$ ${formatAmount(net)}</div>
        </div>`;
      }).join('')}
    </div>
  </section>
  <section class="panel">
    <h2>Transferencias sugeridas (para saldar)</h2>
    ${settlements.length===0? '<div class="muted">No hay transferencias pendientes 🎉</div>' : `
      <div class="grid" style="grid-template-columns:1fr;gap:8px">
        ${settlements.map(t=>`<div class="card row" style="justify-content:space-between"><div><b>${escapeHtml(nameById(t.from))}</b> → <b>${escapeHtml(nameById(t.to))}</b></div><div style="font-weight:700">$ ${formatAmount(t.amount)}</div></div>`).join('')}
      </div>`}
    <div class="spacer"></div>
    <div class="muted">Tip: registrá pagos reales en la pestaña <b>Pagos</b> para ir cerrando saldos.</div>
  </section>`;
}

function renderResumen(){
  const totals={}; let grand=0;
  for(const e of state.expenses){const cat=e.category||'Otros'; const amt=parseAmount(e.amount)||0; if(amt<=0) continue; totals[cat]=(totals[cat]||0)+amt; grand+=amt;}
  const keys=Object.keys(totals).sort((a,b)=>totals[b]-totals[a]);
  return `
  <section class="panel">
    <h2>Resumen por categoría</h2>
    ${keys.length===0?'<div class="muted">Todavía no hay gastos.</div>':`
      <div class="row" style="align-items:flex-start;gap:16px;flex-wrap:wrap">
        <canvas id="pie" width="320" height="320"></canvas>
        <div style="flex:1;min-width:260px;overflow-x:auto">
          <table>
            <thead><tr><th>Categoría</th><th class="center">Total</th><th class="center">%</th></tr></thead>
            <tbody>
              ${keys.map(c=>`<tr><td>${escapeHtml(c)}</td><td class="right"><b>$ ${formatAmount(totals[c])}</b></td><td class="right">${grand? (totals[c]*100/grand).toFixed(1):'0.0'}%</td></tr>`).join('')}
            </tbody>
            <tfoot><tr><th>Total</th><th style="text-align:left">$ ${formatAmount(grand)}</th><th></th></tr></tfoot>
          </table>
        </div>
      </div>`}
  </section>`;
}

// ===== Trips: local list & modal selection =====
const LS_TRIPS_KEY = 'tripsplit_trips';
function loadTrips(){ try{ const arr = JSON.parse(localStorage.getItem(LS_TRIPS_KEY)||'[]'); return Array.isArray(arr)? arr : []; }catch(e){ return []; } }
function saveTrips(list){ localStorage.setItem(LS_TRIPS_KEY, JSON.stringify(list)); }
function ensureTripsSeed(){
  const existing = loadTrips();
  const map = Object.fromEntries(existing.map(t=>[t.id, t.name]));
  const seeded = KNOWN_BINS.map((t,i)=>({id:t.id, name: map[t.id] || t.name || `Viaje ${String(i+1).padStart(2,'0')}`}));
  saveTrips(seeded);
}
function setCurrentTrip(binId){
  if(!binId) return;
  CURRENT_BIN_ID = binId;
  startPolling();
  (async()=>{ const data = await fetchBin(); if(data) applyRemote(data);
    if(!state.tripName){ state.tripName = (loadTrips().find(t=>t.id===binId)?.name) || 'Viaje 01'; }
    render();
  })();
}
function openTripModal(){
  ensureTripsSeed();
  const trips = loadTrips();
  const overlay=document.createElement('div'); overlay.className='modal-overlay';
  const curr = CURRENT_BIN_ID;
  const items = trips.map(t=>`
    <label class="card" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <div class="row" style="gap:8px"><input type="radio" name="tripPick" value="${t.id}" ${t.id===curr?'checked':''}> <b>${escapeHtml(t.name||t.id)}</b></div>
      <span class="muted">${t.id===curr? 'actual' : ''}</span>
    </label>`).join('');

  overlay.innerHTML = `
    <div class="modal" style="max-width:720px">
      <div class="row" style="justify-content:space-between">
        <h2>Seleccionar viaje</h2>
        <button class="btn" data-close>✕</button>
      </div>
      <div class="spacer"></div>
      <div id="tripList">${items}</div>
      <div class="spacer"></div>
      <label class="block"><div class="label">Nombre del viaje seleccionado</div>
        <input id="modalTripName" value="${escapeHtml((trips.find(x=>x.id===curr)?.name)||'')}" placeholder="Viaje 01">
      </label>
      <div class="spacer"></div>
      <div class="row" style="justify-content:flex-end;gap:8px">
        <button class="btn" data-save>Guardar</button>
        <button class="btn" data-close>Cerrar</button>
      </div>
    </div>`;

  function close(){ document.body.removeChild(overlay); }
  overlay.addEventListener('click',(ev)=>{ if(ev.target===overlay || ev.target.hasAttribute('data-close')) close(); });

  overlay.querySelectorAll('input[name="tripPick"]').forEach(r=>{
    r.addEventListener('change', ()=>{
      const id = r.value; setCurrentTrip(id);
      const t = loadTrips().find(x=>x.id===id);
      if(t) state.tripName = t.name || state.tripName;
      const title = document.getElementById('tripTitle'); if(title) title.textContent = state.tripName;
      const nameInput = overlay.querySelector('#modalTripName'); if(nameInput) nameInput.value = state.tripName;
    });
  });

  overlay.querySelector('[data-save]').addEventListener('click', ()=>{
    const name = String(overlay.querySelector('#modalTripName').value||'').trim() || 'Viaje 01';
    const arr = loadTrips();
    const t = arr.find(x=>x.id===CURRENT_BIN_ID);
    if(t) t.name = name;
    saveTrips(arr);
    state.tripName = name; saveMaybe();
    const h = document.getElementById('tripTitle'); if(h) h.textContent = state.tripName;
    close();
  });

  document.body.appendChild(overlay);
}

function bindTripTitle(){
  const h = document.getElementById('tripTitle');
  if(!h) return;
  h.textContent = state.tripName || 'Viaje 01';
  h.addEventListener('click', openTripModal);
  h.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); openTripModal(); }});
}

// ===== Header: viewer & filter =====
function bindHeaderButtons(){
  const bViewer = document.getElementById('btnViewer');
  const bFilter = document.getElementById('btnFilter');

  if(bViewer){
    // si ya hay viewer, mostrar su nombre en el botón
    if(state.currentViewerId){
      const nm = nameById(state.currentViewerId) || 'Yo';
      bViewer.textContent = nm;
    }
    bViewer.onclick = openViewerModal;
  }

  if(bFilter){
    bFilter.classList.toggle('is-active', !!state.viewerFilter);
    bFilter.onclick = ()=>{
      state.viewerFilter = !state.viewerFilter;
      saveViewerFilterPref(state.viewerFilter);
      bFilter.classList.toggle('is-active', !!state.viewerFilter);
      render();
    };
  }
}

function openViewerModal(){
  const overlay=document.createElement('div'); overlay.className='modal-overlay';
  const opts = state.participants.map(p=>`
    <label class="row" style="justify-content:space-between" >
      <span>${escapeHtml(p.name)}</span>
      <input type="radio" name="whoami" value="${p.id}" ${p.id===state.currentViewerId?'checked':''}>
    </label>`).join('');

  overlay.innerHTML = `
    <div class="modal" style="max-width:520px">
      <div class="row" style="justify-content:space-between">
        <h2>¿Quién sos?</h2>
        <button class="btn" data-close>✕</button>
      </div>
      <div class="spacer"></div>
      <div class="grid" style="grid-template-columns:1fr;gap:8px">${opts||'<div class="muted">No hay viajeros aún.</div>'}</div>
      <div class="spacer"></div>
      <div class="row" style="justify-content:flex-end;gap:8px">
        <button class="btn" data-save>Guardar</button>
        <button class="btn" data-close>Cerrar</button>
      </div>
    </div>`;

  function close(){ document.body.removeChild(overlay); }
  overlay.addEventListener('click',(ev)=>{ if(ev.target===overlay || ev.target.hasAttribute('data-close')) close(); });

  overlay.querySelector('[data-save]').addEventListener('click', ()=>{
    const sel = overlay.querySelector('input[name="whoami"]:checked');
    if(sel){
      state.currentViewerId = sel.value;
      saveViewerPref(state.currentViewerId);
      const bViewer = document.getElementById('btnViewer');
      if(bViewer) bViewer.textContent = nameById(state.currentViewerId) || 'Yo';
      // mantener filtro como está; solo re-render
      render();
    }
    close();
  });

  document.body.appendChild(overlay);
}

// ===== Bindings =====
function bindViajeros(){
  document.getElementById('btnAddPerson').addEventListener('click',()=>{
    const name=document.getElementById('inpNewName').value.trim();
    if(!name) return;
    state.participants.push({id:uid(),name});
    document.getElementById('inpNewName').value='';
    saveMaybe(); render();
  });
  document.querySelectorAll('[data-del]').forEach(btn=>btn.addEventListener('click',()=>{
    const id=btn.getAttribute('data-del');
    if(!confirm('¿Eliminar viajero? Los gastos en los que participó quedarán sin identificación del viajero eliminado y se ajustarán los participantes.')) return;
    state.participants=state.participants.filter(p=>p.id!==id);
    state.expenses=state.expenses.map(e=>{
      const inv=(e.involvedIds||[]).filter(pid=>pid!==id);
      const split=sanitizeSplitForParticipants(e.split,inv);
      const payer=e.payerId===id?null:e.payerId;
      return {...e,involvedIds:inv,split:split,payerId:payer};
    });
    state.payments=state.payments.filter(p=>p.fromId!==id && p.toId!==id);
    saveMaybe(); render();
  }));
}

function sanitizeSplitForParticipants(split,involvedIds){
  const set=new Set(involvedIds);
  if(!split) return {mode:'equal'};
  const c=JSON.parse(JSON.stringify(split));
  if(c.shares) Object.keys(c.shares).forEach(k=>{if(!set.has(k)) delete c.shares[k];});
  if(c.percents) Object.keys(c.percents).forEach(k=>{if(!set.has(k)) delete c.percents[k];});
  if(c.exact) Object.keys(c.exact).forEach(k=>{if(!set.has(k)) delete c.exact[k];});
  return c;
}

function bindNuevo(){
  document.getElementById('gDesc').addEventListener('input',e=>state.draft.desc=e.target.value);
  document.getElementById('gAmount').addEventListener('input',e=>state.draft.amount=e.target.value);
  document.getElementById('gDate').addEventListener('input',e=>state.draft.date=e.target.value);
  document.getElementById('gPayer').addEventListener('change',e=>state.draft.payerId=e.target.value);
  document.getElementById('gMode').addEventListener('change',e=>{state.draft.split={mode:e.target.value}; render();});
  document.getElementById('gCategory').addEventListener('change',e=>state.draft.category=e.target.value);
  document.querySelectorAll('[data-tgl]').forEach(btn=>btn.addEventListener('click',()=>{
    const id=btn.getAttribute('data-tgl'); const set=new Set(state.draft.involvedIds);
    if(set.has(id)) set.delete(id); else set.add(id);
    state.draft.involvedIds=[...set];
    state.draft.split=sanitizeSplitForParticipants(state.draft.split,state.draft.involvedIds);
    render();
  }));
  document.querySelectorAll('[data-share]').forEach(inp=>inp.addEventListener('input',e=>{
    state.draft.split.shares={...(state.draft.split.shares||{}),[inp.dataset.share]:inp.value};
  }));
  document.querySelectorAll('[data-percent]').forEach(inp=>inp.addEventListener('input',e=>{
    state.draft.split.percents={...(state.draft.split.percents||{}),[inp.dataset.percent]:inp.value};
  }));
  document.querySelectorAll('[data-exact]').forEach(inp=>inp.addEventListener('input',e=>{
    state.draft.split.exact={...(state.draft.split.exact||{}),[inp.dataset.exact]:inp.value};
  }));
  const isEditing=!!state.editingId;
  if(isEditing){
    document.getElementById('btnSaveEdit').addEventListener('click',()=>{
      const d=state.draft; const amt=parseAmount(d.amount);
      if(!d.category){alert('Seleccioná una categoría.'); return;}
      if(!d.payerId){alert('Seleccioná quién pagó.'); return;}
      if(!amt||amt<=0){alert('Ingresá un monto válido.'); return;}
      state.expenses=state.expenses.map(x=>x.id===state.editingId?{...d,amount:amt}:x);
      state.draft=null; state.editingId=null; saveMaybe(); state.activeTab='gastos'; render();
    });
    document.getElementById('btnCancelEdit').addEventListener('click',()=>{state.draft=null; state.editingId=null; render();});
  } else {
    document.getElementById('btnAddExpense').addEventListener('click',()=>{
      const d=state.draft; const amt=parseAmount(d.amount);
      if(!d.category){alert('Seleccioná una categoría.'); return;}
      if(!d.payerId){alert('Seleccioná quién pagó.'); return;}
      if(!amt||amt<=0){alert('Ingresá un monto válido.'); return;}
      const normalized={...d,amount:amt};
      state.expenses=[normalized,...state.expenses];
      state.draft=null; saveMaybe(); state.activeTab='gastos'; render();
    });
  }
  document.getElementById('btnClearExpense').addEventListener('click',()=>{state.draft=null; render();});
}

function bindGastos(){
  document.querySelectorAll('[data-del-exp]').forEach(btn=>btn.addEventListener('click',()=>{
    const id=btn.getAttribute('data-del-exp');
    if(!confirm('¿Eliminar este gasto? Esta acción no se puede deshacer.')) return;
    state.expenses=state.expenses.filter(x=>x.id!==id);
    saveMaybe(); render();
  }));
  document.querySelectorAll('[data-edit-exp]').forEach(btn=>btn.addEventListener('click',()=>{
    const id=btn.getAttribute('data-edit-exp'); const exp=state.expenses.find(x=>x.id===id); if(!exp) return;
    ensureDraft(exp); state.editingId=id; state.activeTab='nuevo'; render();
  }));
  document.querySelectorAll('[data-detail-exp]').forEach(btn=>btn.addEventListener('click',()=>{
    const id=btn.getAttribute('data-detail-exp'); const exp=state.expenses.find(x=>x.id===id); if(!exp) return;
    showExpenseDetail(exp);
  }));
}

function bindPagos(){
  document.getElementById('btnAddPayment').addEventListener('click',()=>{
    const date=document.getElementById('pDate').value;
    const fromId=document.getElementById('pFrom').value;
    const toId=document.getElementById('pTo').value;
    const amount=parseAmount(document.getElementById('pAmount').value);
    const note=document.getElementById('pNote').value;
    if(!fromId||!toId||fromId===toId){alert('Elegí remitente y destinatario distintos.');return;}
    if(!amount||amount<=0){alert('Ingresá un monto válido.');return;}
    const pay={id:uid(),date,fromId,toId,amount,note};
    state.payments=[pay,...state.payments]; saveMaybe(); render();
  });
  document.querySelectorAll('[data-del-pay]').forEach(btn=>btn.addEventListener('click',()=>{
    const id=btn.getAttribute('data-del-pay');
    state.payments=state.payments.filter(x=>x.id!==id); saveMaybe(); render();
  }));
}

// ===== Sync =====
function serializeState(){ return {
  tripName:state.tripName,currency:state.currency,
  participants:state.participants,expenses:state.expenses,payments:state.payments,
  __ts:Date.now()
}; }
function applyRemote(d){
  if(!d) return;
  state.tripName = (typeof d.tripName==='string' && d.tripName.trim()) ? d.tripName : state.tripName;
  state.currency = d.currency ?? state.currency;
  state.participants = Array.isArray(d.participants)? d.participants : state.participants;
  state.expenses = Array.isArray(d.expenses)? d.expenses : state.expenses;
  state.payments = Array.isArray(d.payments)? d.payments : state.payments;
  lastRemoteTs=d.__ts||Date.now();
  state.draft=null; state.editingId=null;
}
const saveRemoteDebounced = debounce(()=>{
  const payload=serializeState(); lastRemoteTs=payload.__ts;
  fetch(JSONBIN_PUT_URL(CURRENT_BIN_ID),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
    .then(()=>showStatus('Guardado')).catch(()=>{});
},300);
function saveMaybe(){saveRemoteDebounced();}
async function fetchBin(){try{const r=await fetch(JSONBIN_GET_URL(CURRENT_BIN_ID)); if(!r.ok) throw new Error('GET failed'); const j=await r.json(); return j&&j.record? j.record : null;}catch(e){return null;}}
function startPolling(){clearInterval(pollTimer); pollTimer=setInterval(async()=>{const remote=await fetchBin(); if(remote && remote.__ts && remote.__ts!==lastRemoteTs){applyRemote(remote); render(); showStatus('Sincronizado');}},3000);}

// ===== Init & Share =====
document.getElementById('btnShare').addEventListener('click',()=>{
  const url=location.origin+location.pathname;
  if(navigator.clipboard) navigator.clipboard.writeText(url).then(()=>showStatus('Link copiado ✨'));
  else prompt('Copiá este link:',url);
});
(async function init(){
  ensureTripsSeed();
  setCurrentTrip(CURRENT_BIN_ID || (loadTrips()[0]?.id)||'');
  const data=await fetchBin(); if(data) applyRemote(data);
  render();
})();

// ===== Pie =====
function drawPie(){
  const ctx=document.getElementById('pie'); if(!ctx) return;
  const totals={}; let grand=0;
  for(const e of state.expenses){const cat=e.category||'Otros'; const amt=parseAmount(e.amount)||0; if(amt<=0) continue; totals[cat]=(totals[cat]||0)+amt; grand+=amt;}
  const keys=Object.keys(totals); if(keys.length===0||grand===0) return;
  const cx=ctx.getContext('2d'); const cxm=ctx.width/2, cym=ctx.height/2, r=Math.min(cxm,cym)-8;
  cx.clearRect(0,0,ctx.width,ctx.height); let start=0;
  keys.forEach((k,i)=>{const frac=totals[k]/grand; const end=start+frac*2*Math.PI; cx.beginPath(); cx.moveTo(cxm,cym); cx.arc(cxm,cym,r,start,end); cx.closePath(); const hue=Math.floor((i/keys.length)*330); cx.fillStyle=`hsl(${hue} 70% 55%)`; cx.fill(); start=end;});
  cx.beginPath(); cx.arc(cxm,cym,r*0.55,0,2*Math.PI); cx.fillStyle='#fff'; cx.fill();
}

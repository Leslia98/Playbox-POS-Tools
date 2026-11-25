// ==UserScript==
// @name         Playbox Odoo - 快捷调货
// @namespace    playbox.internal.pos.transfer
// @version      0.2.2
// @description  POS 快捷调货 · Odoo Online 通用版
// @match        https://*.odoo.com/pos/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(() => {
'use strict';
const KIND='transfer', GLOBAL='PBQuickTransfer';
/* Shared source copied into each independent userscript at build time. */
const VERSION = '0.2.2';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const idOf = value => Array.isArray(value) ? value[0] : value?.id || value || false;
const round = (n, step = .01) => Math.round((n + Number.EPSILON) / step) * step;
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const money = n => Number(n || 0).toLocaleString('es-MX', {minimumFractionDigits:2, maximumFractionDigits:2});
const ROOT = 'pb-' + KIND;
let pos, modal, busy = false;
let spanish = read(ROOT + ':es', false);
const t = (zh, es) => spanish ? es : zh;
const key = suffix => ROOT + ':' + location.host + ':' + pos.company.id + ':' + pos.config.id + ':' + suffix;
const rpc = async (model, method, args = [], kwargs = {}) => {
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
  let response;
  try { response = await fetch('/web/dataset/call_kw/' + model + '/' + method, {
    signal:controller.signal,
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0', method:'call', params:{model,method,args,kwargs:{context:{allowed_company_ids:[pos.company.id]},...kwargs}}})
  }); } finally {clearTimeout(timeout);}
  if (!response.ok) throw Error(t('连接失败，请检查网络后重新查看单据状态。','Error de conexión. Consulte el estado antes de reintentar.'));
  const result = await response.json();
  if (result.error) {const error=Error(result.error.data?.message || result.error.message);error.serverRejected=true;throw error;}
  return result.result;
};
function notice(message) {
  let box = document.getElementById(ROOT + '-notice');
  if (!box) {box=document.createElement('div');box.id=ROOT+'-notice';box.className='pbnt-notice';document.body.append(box);}
  box.textContent=message;clearTimeout(box.timer);box.timer=setTimeout(()=>box.remove(),6500);
}
function close() { if(busy)return; modal?.remove();modal=null; }
function show(title, body, footer='', wide=false) {
  const previousFocus=document.activeElement;
  modal?.remove();modal=document.createElement('div');modal.id=ROOT+'-modal';modal.className='pbnt-overlay';
  modal.innerHTML=`<section class="pbnt-dialog ${wide?'pbnt-wide':''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button data-lang title="中文 / Español">${spanish?'中':'ES'}</button><button data-close aria-label="${t('关闭','Cerrar')}">×</button></header><main>${body}</main><div class="pbnt-error" role="alert"></div><footer>${footer}</footer></section>`;
  modal.querySelector('[data-close]').onclick=()=>{close();previousFocus?.focus();};
  modal.querySelector('[data-lang]').onclick=()=>{if(busy)return;spanish=!spanish;save(ROOT+':es',spanish);open();};
  modal.addEventListener('keydown',event=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();close();previousFocus?.focus();}
    if(event.key==='Tab') {const all=[...modal.querySelectorAll('button,input,select,a')].filter(x=>!x.disabled&&x.offsetParent);const first=all[0],last=all.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  });
  document.body.append(modal);modal.querySelector('input,button')?.focus();return modal;
}
async function run(fn) {
  if(busy)return;busy=true;const current=modal;
  const controls=[...(current?.querySelectorAll('button,input,select')||[])].map(el=>[el,el.disabled]);
  controls.forEach(([el])=>el.disabled=true);
  try {return await fn();} catch(error) {const errorBox=modal?.querySelector('.pbnt-error');if(errorBox)errorBox.textContent=error.message;else notice(error.message);console.error(ROOT,error);}
  finally {busy=false;controls.forEach(([el,disabled])=>el.disabled=disabled);}
}
function installStyle() {
 const style=document.createElement('style');style.id=ROOT+'-css';
 style.textContent=`.pbnt-overlay{position:fixed;inset:0;background:#17263177;z-index:10900;display:flex;align-items:center;justify-content:center;padding:18px;font:14px/1.5 system-ui,-apple-system,"Segoe UI","Noto Sans SC",sans-serif;color:#243340}
.pbnt-dialog,.pbnt-dialog *{box-sizing:border-box}
.pbnt-dialog{width:580px;max-width:95vw;max-height:92vh;background:#fff;border:1px solid #d9dfe5;border-radius:14px;box-shadow:0 18px 70px #14253644;display:flex;flex-direction:column;overflow:hidden}
.pbnt-wide{width:1000px}
.pbnt-dialog header{display:flex;align-items:center;gap:8px;padding:12px 20px;border-bottom:1px solid #e2e6eb;flex-shrink:0}
.pbnt-dialog h2{font-size:19px;line-height:1.4;font-weight:650;margin:0;flex:1;min-width:0}
.pbnt-dialog main{padding:16px 20px;overflow:auto;min-height:0;overscroll-behavior:contain}
.pbnt-dialog button{border:1px solid #cbd4dc;border-radius:7px;background:#fff;color:#243340;padding:7px 12px;font:inherit;cursor:pointer;white-space:nowrap}
.pbnt-dialog button:hover{background:#f0f7f5;border-color:#97bcb6}
.pbnt-dialog button:disabled{opacity:.5;cursor:default}
.pbnt-dialog button.pbnt-primary{background:#295e60;border-color:#295e60;color:#fff}
.pbnt-dialog button.pbnt-primary:hover{background:#214e50}
.pbnt-dialog button.pbnt-selected{background:#edf5f3;border-color:#c5dcd6;color:#245c54;font-weight:650}
.pbnt-dialog input,.pbnt-dialog select{border:1px solid #bec9d3;border-radius:6px;background:white;color:#243340;padding:7px 9px;font:inherit;max-width:100%;min-width:0}
.pbnt-dialog input:focus,.pbnt-dialog select:focus,.pbnt-dialog button:focus-visible,.pbnt-dialog summary:focus-visible{outline:2px solid #438d95;outline-offset:2px}
.pbnt-dialog footer{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;padding:12px 20px;border-top:1px solid #e2e8ea;background:#fff;flex-shrink:0}
.pbnt-dialog .pbnt-muted{color:#647585;font-size:12px;line-height:1.5}
.pbnt-dialog .pbnt-summary{background:#f7faf9;border:1px solid #e0e9e5;padding:14px 16px;border-radius:8px;display:grid;gap:10px}
.pbnt-dialog .pbnt-summary b{font-size:20px;color:#235a57;font-variant-numeric:tabular-nums}
.pbnt-dialog .pbnt-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.pbnt-dialog .pbnt-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;margin:18px 0 10px}
.pbnt-dialog label{display:flex;flex-direction:column;gap:6px;font-size:13px;color:#526572}
.pbnt-dialog [data-amount],.pbnt-dialog [data-percent]{font-size:20px;font-weight:600;color:#235a57;font-variant-numeric:tabular-nums}
.pbnt-dialog [data-amount]{background:#f7fbf9;border-color:#97bcb6}
.pbnt-dialog .pbnt-total{border-top:1px solid #e5e9eb;padding-top:16px;margin-top:16px;font-size:15px}
.pbnt-dialog .pbnt-total strong{font-size:30px;font-weight:700;color:#235a57;font-variant-numeric:tabular-nums}
.pbnt-dialog .pbnt-toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #e5e9eb}
.pbnt-dialog .pbnt-toolbar [data-route]{border-color:transparent;background:transparent;color:#5d6a76}
.pbnt-dialog .pbnt-toolbar [data-route].pbnt-selected{border-color:#c5dcd6;background:#edf5f3;color:#245c54}
.pbnt-dialog [data-routes]{margin-left:auto}
.pbnt-dialog .pbnt-grow{flex:1;min-width:120px}
.pbnt-dialog table{width:100%;border-collapse:collapse;margin:12px 0 4px;font-size:13px}
.pbnt-dialog th{position:sticky;top:0;z-index:1;background:#f4f6f8;color:#667781;font-size:12px;font-weight:600;text-align:left;border-bottom:1px solid #dce3e7;padding:8px 10px;white-space:nowrap}
.pbnt-dialog td{padding:9px 10px;border-bottom:1px solid #e3e7ec;vertical-align:middle}
.pbnt-dialog tbody tr:hover{background:#f8fbfa}
.pbnt-dialog td:first-child{min-width:150px}
.pbnt-dialog td strong{font-size:14px;color:#243340}
.pbnt-dialog td:nth-child(2),.pbnt-dialog td:nth-child(4),.pbnt-dialog th:nth-child(2),.pbnt-dialog th:nth-child(4){text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pbnt-dialog td:nth-child(2){font-size:16px;font-weight:650;color:#235a57}
.pbnt-dialog td:nth-child(4){font-size:16px;font-weight:650}
.pbnt-cart-summary{font:600 13px/1.5 system-ui;color:#235a57;text-align:right;padding-top:4px;font-variant-numeric:tabular-nums}
.pbnt-dialog td:nth-child(2) strong,.pbnt-dialog td:nth-child(4) strong{color:inherit;font-size:15px}
.pbnt-dialog td:nth-child(3){white-space:nowrap}
.pbnt-dialog td input{width:68px;padding:6px;text-align:center;font-weight:600;font-variant-numeric:tabular-nums}
.pbnt-dialog td select{width:146px;padding:6px;margin-left:4px}
.pbnt-dialog .pbnt-search-results{max-height:230px;overflow:auto;border:1px solid #dce3e7;border-radius:7px;margin-top:6px}
.pbnt-dialog .pbnt-search-results:empty{display:none}
.pbnt-dialog .pbnt-search-results button{display:block;width:100%;border:0;border-radius:0;text-align:left;white-space:normal;border-bottom:1px solid #edf0f3;padding:9px 12px}
.pbnt-dialog .pbnt-empty{text-align:center;padding:36px 8px;color:#647585}
.pbnt-dialog .pbnt-warn{color:#b13723!important}
.pbnt-dialog .pbnt-small{font-size:12px;padding:5px 8px}
.pbnt-dialog a{color:#236b68}
.pbnt-dialog details.pbnt-help{margin-top:14px;border-top:1px solid #e5e9eb;padding-top:10px;color:#647585;font-size:12px}
.pbnt-dialog .pbnt-help summary{cursor:pointer;color:#526b70}
.pbnt-dialog .pbnt-help p{margin:8px 0 0;line-height:1.6}
.pbnt-error{color:#9f2e25;background:#fff5f3;padding:9px 20px;white-space:pre-line;font-size:13px;border-top:1px solid #f2dfdc}
.pbnt-error:empty{display:none}
.pbnt-notice{position:fixed;right:22px;top:78px;z-index:11000;max-width:min(460px,92vw);background:#29484a;color:#fff;padding:12px 16px;border-radius:8px;box-shadow:0 6px 20px #14253633;font:14px/1.5 system-ui}
.pbnt-launch{position:fixed;right:18px;z-index:1050;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:40px;min-width:82px;border:1px solid #5d3d55;border-radius:8px;background:#714b67;color:#fff;box-shadow:0 6px 18px #241a2233;padding:0 14px;font:700 13px/1 system-ui,-apple-system,"Segoe UI","Noto Sans SC",sans-serif;white-space:nowrap;cursor:pointer;touch-action:none}
@media(max-width:760px){.pbnt-overlay{padding:8px}.pbnt-dialog{max-width:98vw}.pbnt-dialog header,.pbnt-dialog footer{padding:10px 12px}.pbnt-dialog main{padding:12px}.pbnt-dialog h2{font-size:17px}.pbnt-dialog .pbnt-fields{gap:10px}.pbnt-dialog th,.pbnt-dialog td{padding:7px}.pbnt-dialog td select{display:block;margin:4px 0 0;width:130px}.pbnt-dialog td:first-child{min-width:120px}.pbnt-dialog [data-routes]{margin-left:0}}
@media(prefers-reduced-motion:reduce){.pbnt-dialog *{scroll-behavior:auto}}
/* Transfer-only presentation matched to selected preview; no stock behavior changes. */
#pb-transfer-modal.pbqt-compact{font-size:clamp(17px,1.286vw,22px);line-height:1.35;color:#111c2b;padding:clamp(18px,3.15vh,29px) 18px 18px;align-items:flex-start}
.pbqt-compact .pbnt-dialog{width:1612px;max-width:94.2vw;max-height:94vh;border-radius:16px;font:inherit;color:inherit}
.pbqt-compact .pbnt-dialog header{padding:.55em 1.27em;min-height:3.18em;gap:.64em}
.pbqt-compact .pbnt-dialog h2{font-size:1.45em;font-weight:750;line-height:1.3;color:#0c1625}
.pbqt-compact .pbnt-dialog main{padding:.36em .91em .82em}
.pbqt-compact .pbnt-dialog footer{padding:.64em 1.27em;min-height:3.73em;gap:.91em}
.pbqt-compact .pbnt-dialog button{font-size:1em;line-height:1.25;padding:.45em .82em;border-radius:7px;border-color:#aeb9c8;color:#14202e}
.pbqt-compact .pbnt-dialog button.pbnt-primary{background:#195e56;border-color:#195e56;color:white;font-weight:650}
.pbqt-compact .pbnt-dialog button.pbnt-primary:hover{background:#124c45}
.pbqt-compact .pbnt-dialog button:disabled{opacity:.48}
.pbqt-compact .pbnt-dialog [data-close],.pbqt-compact .pbnt-dialog [data-lang]{border-color:transparent;background:transparent;padding:.4em;min-width:1.7em}
.pbqt-compact .pbnt-dialog header button{height:2.1em;padding-top:0;padding-bottom:0}
.pbqt-compact .pbnt-dialog [data-close]{font-size:1.2em;font-weight:400;height:1.75em}
.pbqt-compact .pbnt-dialog .pbnt-muted{font-size:1em;color:#14202e}
.pbqt-routebar{display:flex;align-items:center;gap:.7em;margin:0 .36em}
.pbqt-route-tabs{display:flex;gap:.73em;min-width:0;overflow-x:auto;padding:0;flex:1;scrollbar-width:thin}
.pbqt-route-tabs button{flex-shrink:0}
.pbqt-compact .pbqt-route-tabs [data-route]{border:1px solid #9daabd;background:#fff;min-width:10.15em;padding:.36em 1em;font-size:1em;border-radius:7px;line-height:1.25}
.pbqt-compact .pbqt-route-tabs .pbnt-selected{background:#e0f1e9;border-color:#9ec3b7;color:#173d36;font-weight:700}
.pbqt-actions{display:flex;gap:.64em;flex-shrink:0}
.pbqt-searchbar{display:flex;gap:1.73em;align-items:center;margin:.73em .36em .64em}
.pbqt-compact .pbqt-searchbar input{flex:1;width:100%;padding:.35em .73em;font-size:1em;line-height:1.3;border-color:#8d9aab;border-radius:7px}
.pbqt-searchbar>span{flex-shrink:0;max-width:32%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pbqt-record{font-size:.85em;margin:.3em 0}
.pbqt-table-scroll{overflow:auto}
.pbqt-compact .pbqt-table{margin:0;font-size:1em;min-width:940px;table-layout:fixed;color:#111c2b}
.pbqt-compact .pbqt-table th{padding:.27em 1.05em;font-size:1em;color:#111c2b;font-weight:700;background:#e9edf2;height:2em;border-bottom:1px solid #cdd5e2}
.pbqt-compact .pbqt-table td{padding:.23em 1.05em;border-bottom:1px solid #dce2eb;vertical-align:middle;height:3.18em}
.pbqt-compact .pbqt-table th:first-child{width:33%}
.pbqt-compact .pbqt-table td:nth-child(2),.pbqt-compact .pbqt-table th:nth-child(2){text-align:left;font-size:1em;font-weight:400;white-space:nowrap;width:27%}
.pbqt-compact .pbqt-table th:nth-child(2){font-weight:700}
.pbqt-compact .pbqt-table th:nth-child(3){width:36%}
.pbqt-compact .pbqt-table td:nth-child(3){border-left:1px solid #d5dce7;padding-left:1.45em}
.pbqt-compact .pbqt-table th:nth-child(3){border-left:1px solid #d5dce7;padding-left:1.45em}
.pbqt-compact .pbqt-table th:nth-child(4){width:4%}
.pbqt-compact .pbqt-table td:nth-child(4){padding:.2em .45em;text-align:center;font-size:inherit;font-weight:400}
.pbqt-compact .pbqt-product{padding-left:1.45em!important;min-width:0}
.pbqt-product-title{font-size:1em;line-height:1.3;color:#111c2b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pbqt-compact .pbqt-product strong{font-size:1em;font-weight:750;color:#111c2b}
.pbqt-product-title>span{font-weight:400;margin-left:.25em}
.pbqt-product-name{font-size:.86em;color:#576273;line-height:1.3;margin-top:.09em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pbqt-compact .pbqt-category td{padding:.23em 1.05em;height:1.82em;background:#e9eef7;border-top:1px solid #cbd5e1;border-bottom:1px solid #d6deeb;font-size:1em;font-weight:750;color:#101b2b}
.pbqt-category small{float:right;font-size:.91em;font-weight:700;color:#1651e9}
.pbqt-stock{display:inline-block;max-width:100%;white-space:normal;overflow-wrap:anywhere;background:#e2f3e9;color:#14583c;padding:.15em .5em;border-radius:5px;font-size:.95em;line-height:1.3;font-weight:500}
.pbqt-stock.pbqt-short{background:#fff1d8;color:#ab5d07}
.pbqt-table td[data-stock]>small{display:block;color:#576273;font-size:.82em;line-height:1.3;margin-top:.09em;padding-left:.23em}
.pbqt-stepper{display:flex;align-items:center;gap:.32em}
.pbqt-compact .pbqt-stepper>button{width:1.82em;min-width:1.82em;height:1.48em;padding:0;font-size:1em;border-radius:5px;line-height:1}
.pbqt-compact .pbqt-stepper input{width:4.14em;height:1.48em;padding:0 .18em;font-weight:400;font-size:1em;border-radius:5px;appearance:textfield;line-height:1}
.pbqt-stepper input::-webkit-inner-spin-button,.pbqt-stepper input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.pbqt-units{display:inline-flex;margin-left:.73em;gap:0}
.pbqt-compact .pbqt-units button{height:1.48em;min-width:2.82em;padding:0 .5em;border-radius:0;font-size:1em;line-height:1.2}
.pbqt-compact .pbqt-units button:first-child{border-radius:5px 0 0 5px}
.pbqt-compact .pbqt-units button:last-child{border-radius:0 5px 5px 0;margin-left:-1px}
.pbqt-units button[aria-pressed="true"]{background:#dff0e8;color:#175549;border-color:#a8c5bb;font-weight:700;z-index:1}
.pbqt-compact .pbqt-stepper select{display:inline-block;margin:0 0 0 .4em;width:6.5em;height:1.6em;padding:0 .2em;font-size:.9em}
.pbqt-conversion{font-size:.86em;line-height:1.3;color:#576273;margin-top:.14em;white-space:normal}
.pbqt-short-text{color:#c36b09}
.pbqt-compact .pbnt-dialog .pbqt-remove{background:transparent;border-color:transparent;padding:.05em .15em;font-size:1.2em;font-weight:400;color:#14202e}
.pbqt-compact .pbnt-dialog footer button{min-width:7.9em;padding:.48em 1em}
@media(max-width:1100px){.pbqt-compact .pbnt-dialog{max-width:97vw}.pbqt-compact .pbnt-dialog header{padding:.55em .8em}.pbqt-compact .pbnt-dialog main{padding:.4em .6em .7em}.pbqt-compact .pbnt-dialog footer{padding:.6em .8em}.pbqt-compact .pbqt-table{min-width:940px}}
@media(max-width:760px){#pb-transfer-modal.pbqt-compact{padding:8px;font-size:16px}.pbqt-compact .pbnt-dialog{max-width:100%;max-height:96vh;border-radius:12px}.pbqt-compact .pbnt-dialog header{flex-wrap:wrap;gap:.4em}.pbqt-compact header .pbqt-actions{order:2;flex-basis:100%;justify-content:flex-end;gap:.4em}.pbqt-compact header h2{white-space:nowrap;font-size:1.25em}.pbqt-routebar{flex-wrap:wrap}.pbqt-route-tabs{flex-basis:100%;gap:.45em}.pbqt-compact .pbqt-route-tabs [data-route]{min-width:0;padding:.45em .7em;font-size:1em}.pbqt-searchbar{flex-wrap:wrap;gap:.4em;margin:.6em .2em}.pbqt-searchbar>span{max-width:100%;font-size:.85em!important}.pbqt-compact .pbqt-searchbar input{flex-basis:100%}.pbqt-compact .pbnt-dialog footer{gap:.5em}.pbqt-compact footer .pbnt-muted{flex-basis:100%}.pbqt-compact .pbnt-dialog footer button{min-width:0;flex:1;padding:.55em .4em}}
`;
 document.head.append(style);
}
function launcher(label) {
 const button=document.createElement('button');button.id=ROOT+'-launch';button.className='pbnt-launch';button.textContent=label;button.style.bottom=KIND==='discount'?'160px':'110px';
 const position=read(key('position'),null);if(position){button.style.right='auto';button.style.bottom='auto';button.style.left=Math.min(position.x,innerWidth-100)+'px';button.style.top=Math.min(position.y,innerHeight-50)+'px';}
 let start,moved=false;
 button.onpointerdown=e=>{start={x:e.clientX,y:e.clientY,rect:button.getBoundingClientRect()};moved=false;button.setPointerCapture(e.pointerId);};
 button.onpointermove=e=>{if(!start)return;if(Math.hypot(e.clientX-start.x,e.clientY-start.y)>6)moved=true;if(!moved)return;button.style.right='auto';button.style.bottom='auto';button.style.left=Math.max(0,Math.min(innerWidth-button.offsetWidth,start.rect.left+e.clientX-start.x))+'px';button.style.top=Math.max(0,Math.min(innerHeight-button.offsetHeight,start.rect.top+e.clientY-start.y))+'px';};
 button.onpointerup=()=>{if(moved){const r=button.getBoundingClientRect();save(key('position'),{x:r.left,y:r.top});}start=null;};
 button.onclick=()=>{if(!moved)run(open);};document.body.append(button);return button;
}
async function boot() {
 if(window[GLOBAL]||window[GLOBAL+'Booting'])return;
 window[GLOBAL+'Booting']=true;
 try {
 for(let i=0;i<180;i++) {pos=window.posmodel||window.odoo?.__WOWL_DEBUG__?.root?.env?.services?.pos;if(pos?.models?.['pos.order']&&pos.config&&pos.company)break;await new Promise(r=>setTimeout(r,1000));}
 if(!pos?.models?.['pos.order']){notice(t('POS 尚未就绪，请重新打开页面。','El POS aún no está listo. Recargue la página.'));return;}
 installStyle();await initialize();
 } finally {delete window[GLOBAL+'Booting'];}
}

let launch, routes=[], types=[], locations=[], draft, pending=[], lastSearch=0;
const clone=x=>JSON.parse(JSON.stringify(x));
const pickingFields=['id','name','state','origin','picking_type_id','partner_id','location_id','location_dest_id','move_ids','write_date'];
const newDraft=()=>({uuid:crypto.randomUUID(),route:routes[0]?clone(routes[0]):null,lines:[],id:null,phase:'local'});
const persist=()=>save(key('draft'),draft);
function indices(){return read(key('records'),[]);}
function track(id){save(key('records'),[...new Set([...indices(),id])]);}
async function refreshPending() {
 const ids=indices();pending=ids.length?await rpc('stock.picking','search_read',[[['id','in',ids],['company_id','=',pos.company.id],['state','not in',['done','cancel']]]],{fields:pickingFields,limit:500,order:'id desc'}):[];
 if(launch)launch.textContent=t('调货','Traslado')+(pending.length?' · '+pending.length:'');return pending;
}
async function loadRoutes() {
 [types,locations]=await Promise.all([
   rpc('stock.picking.type','search_read',[[['code','=','internal'],['company_id','=',pos.company.id]]],{fields:['id','display_name','warehouse_id','default_location_src_id','default_location_dest_id'],limit:200}),
   rpc('stock.location','search_read',[[['usage','=','internal'],['company_id','in',[false,pos.company.id]]]],{fields:['id','display_name','warehouse_id'],limit:2000})
 ]);
 routes=read(key('routes'),null);
 if(!routes || (!routes.length&&!read(key('routesConfigured'),false))) {
   let ownWarehouse=idOf(pos.config.picking_type_id?.warehouse_id || pos.pickingType?.warehouse_id);
   if(!ownWarehouse){const pickingTypeId=idOf(pos.config.picking_type_id||pos.pickingType);if(pickingTypeId){const [record]=await rpc('stock.picking.type','read',[[pickingTypeId],['warehouse_id']]);ownWarehouse=idOf(record?.warehouse_id);}}
   const own=types.find(x=>idOf(x.warehouse_id)===ownWarehouse);
   const source=own?.default_location_src_id,destination=own?.default_location_dest_id;
   const reverse=types.find(x=>idOf(x.default_location_src_id)===idOf(destination)&&idOf(x.default_location_dest_id)===idOf(source));
   const make=x=>({uuid:crypto.randomUUID(),name:x.default_location_src_id[1]+' → '+x.default_location_dest_id[1],type:x.id,source:idOf(x.default_location_src_id),destination:idOf(x.default_location_dest_id),contact:0,contactName:''});
   routes=[reverse,own].filter(x=>x&&idOf(x.default_location_src_id)!==idOf(x.default_location_dest_id)).map(make);save(key('routes'),routes);
 }
}
async function available(productIds,source) {
 if(!productIds.length)return {};
 const groups=await rpc('stock.quant','read_group',[[['product_id','in',productIds],['location_id','child_of',source],['company_id','=',pos.company.id]],['product_id','quantity:sum','reserved_quantity:sum'],['product_id']],{lazy:false});
 const result=Object.fromEntries(productIds.map(id=>[id,0]));
 for(const row of groups){if(!Number.isFinite(row.quantity)||!Number.isFinite(row.reserved_quantity))throw Error(t('库存返回异常，请稍后重试。','La consulta de existencias no devolvió cantidades válidas.'));result[idOf(row.product_id)]=(result[idOf(row.product_id)]||0)+row.quantity-row.reserved_quantity;}
 return result;
}
async function productInfo(product) {
 const records=await rpc('uom.uom','read',[[...new Set([idOf(product.uom_id),...(product.uom_ids||[])])],['id','name','factor','rounding']]);
 const base=records.find(x=>x.id===idOf(product.uom_id));if(!base?.factor)throw Error(t('商品基本单位配置异常。','La unidad del producto no es válida.'));
 const units=records.filter(x=>x.id===base.id||!/备用条码|alternate.*barcode/i.test(x.name)).map(x=>({id:x.id,name:x.name,factor:x.factor/base.factor}));
 const box=units.find(x=>x.factor>1&&/箱|caja|box/i.test(x.name));
 return {...product,units,base:base.id,rounding:base.rounding,unit:box?.id||base.id,quantity:1};
}
const pieces=line=>Number(line.quantity)*Number(line.units.find(x=>x.id===Number(line.unit))?.factor||0);
function cartonSize(line){
 const choices=[...new Set(line.units.filter(u=>/^(caja|cart[oó]n|箱|box)(?:\s|\d|$)/i.test(u.name||'')&&Number.isSafeInteger(u.factor)&&u.factor>1).map(u=>u.factor))];
 return choices.length===1?choices[0]:null;
}
function cartonText(line,quantity){
 if(!Number.isFinite(quantity))return '—';const size=cartonSize(line),n=round(quantity,.000001),fmt=x=>Number(x).toLocaleString('es-MX',{maximumFractionDigits:6});
 if(!size)return t('箱规待核对','Caja por verificar');
 if(n<0)return t('缺 '+fmt(-n)+' 件','Faltan '+fmt(-n)+' uds');
 const full=Math.floor(n/size),rest=round(n-full*size,.000001);
 return t(fmt(full)+' 箱'+(rest?' + '+fmt(rest)+' 件':''),fmt(full)+' cajas'+(rest?' + '+fmt(rest)+' uds':''));
}
function stockCell(line,quantity){const size=cartonSize(line);return `<strong>${esc(cartonText(line,quantity))}</strong><div class="pbnt-muted">${Number.isFinite(quantity)?esc(quantity):'—'} ${t('件','uds')}${size?' · '+t('每箱 '+size+' 件',size+' uds/caja'):''}</div>`;}
async function checkDraft() {
 if(!draft.route)throw Error(t('请先设置一条调货路线。','Configure una ruta primero.'));
 const route=draft.route;
 if(route.source===route.destination)throw Error(t('来源和目标库位不能相同。','El origen y el destino deben ser diferentes.'));
 if(!types.some(x=>x.id===route.type)||![route.source,route.destination].every(id=>locations.some(x=>x.id===id)))throw Error(t('路线已失效，请重新选择。','La ruta ya no está disponible.'));
 if(!draft.lines.length)throw Error(t('请添加商品。','Añada productos.'));
 for(const line of draft.lines){const n=pieces(line);if(!Number.isFinite(n)||n<=0||Math.abs(round(n,line.rounding)-n)>1e-6)throw Error(t('请核对商品数量和单位：','Revise la cantidad y unidad: ')+line.display_name);if(line.tracking!=='none')throw Error(t('此商品需要批次/序列号，请在后台完成调拨：','Este producto requiere lote/serie; use Inventario: ')+line.display_name);}
 const products=await rpc('product.product','read',[draft.lines.map(l=>l.id),['id','active','uom_id','uom_ids','tracking']]);
 const uoms=await rpc('uom.uom','read',[[...new Set(products.flatMap(p=>[idOf(p.uom_id),...(p.uom_ids||[])]))],['id','factor','rounding']]);
 for(const line of draft.lines){const product=products.find(p=>p.id===line.id),base=uoms.find(u=>u.id===idOf(product?.uom_id)),unit=uoms.find(u=>u.id===Number(line.unit));const factor=unit?.factor/base?.factor;if(!product?.active||product.tracking!=='none'||base?.id!==line.base||![base?.id,...(product.uom_ids||[])].includes(Number(line.unit))||!Number.isFinite(factor)||Math.abs(factor-line.units.find(u=>u.id===Number(line.unit)).factor)>1e-6||Math.abs(round(pieces(line),base.rounding)-pieces(line))>1e-6)throw Error(t('商品或箱规有变化，请重新添加此商品：','El producto o empaque cambió; vuelva a añadir: ')+line.display_name);}
}
async function recover() {
 const found=await rpc('stock.picking','search_read',[[['origin','=','PB-QT:'+draft.uuid],['company_id','=',pos.company.id]]],{fields:pickingFields,limit:2});
 if(found.length>1)throw Error(t('发现重复来源单，请在后台核对，已停止提交。','Se encontró más de un traslado con esta referencia. Revíselo en Inventario.'));
 if(found[0]){draft.id=found[0].id;track(draft.id);draft.phase=found[0].state;persist();return found[0];}
 if(draft.phase==='creating')throw Error(t('上次创建结果尚未确认。请先在库存中查找来源 PB-QT:'+draft.uuid+'，不要重复新建。','La creación anterior es incierta. Busque la referencia PB-QT:'+draft.uuid+' antes de crear otra.'));
 return null;
}
function moveValues(line) {return {product_id:line.id,product_uom:line.base,product_uom_qty:pieces(line),location_id:draft.route.source,location_dest_id:draft.route.destination,company_id:pos.company.id};}
async function savePicking(checked=false) {
 if(!checked)await checkDraft();const previousId=draft.id;let record=await recover();
 if(record&&!previousId){draft.dirty=false;draft.writeDate=record.write_date;persist();throw Error(t('已找到之前创建的单据，请从待处理中打开核对。不会重复新建。','Se encontró el traslado anterior. Ábralo desde Pendientes para revisarlo.'));}
 const route=draft.route,values={picking_type_id:route.type,partner_id:route.contact||false,location_id:route.source,location_dest_id:route.destination,origin:'PB-QT:'+draft.uuid,company_id:pos.company.id};
 if(record) {
   if(['done','cancel'].includes(record.state))throw Error(t('这张调拨单已完成或取消，不会再次调货。请点新建。','Este traslado ya terminó. Cree uno nuevo si es necesario.'));
   if(record.state!=='draft')return record;
   if(draft.writeDate&&record.write_date!==draft.writeDate)throw Error(t('后台已修改此单，请从待处理中重新打开后核对。','El traslado cambió en Inventario. Vuelva a abrirlo desde Pendientes.'));
   const existing=await rpc('stock.move','read',[record.move_ids,['id','product_id']]);
   const byProduct=new Map(existing.map(move=>[idOf(move.product_id),move.id]));
   values.move_ids=draft.lines.map(line=>{const id=byProduct.get(line.id);byProduct.delete(line.id);return id?[1,id,moveValues(line)]:[0,0,moveValues(line)];});
   values.move_ids.push(...[...byProduct.values()].map(id=>[2,id]));
   await rpc('stock.picking','write',[[record.id],values]);
 }else{
   draft.phase='creating';persist();values.move_ids=draft.lines.map(line=>[0,0,moveValues(line)]);
   let response;try{response=await rpc('stock.picking','create',[values]);}catch(error){if(error.serverRejected){draft.phase='local';persist();}throw error;}draft.id=Array.isArray(response)?response[0]:response;track(draft.id);
 }
 [record]=await rpc('stock.picking','read',[[draft.id],pickingFields]);draft.phase=record.state;draft.writeDate=record.write_date;draft.dirty=false;persist();return record;
}
async function commit(confirmShortage=false) {
 if(!navigator.locks)throw Error(t('浏览器不支持防重复提交，请更新浏览器。','Actualice el navegador para evitar duplicados.'));
 return navigator.locks.request(key('submit'),{ifAvailable:true},async lock=>{
   if(!lock)throw Error(t('另一窗口正在提交这张调拨，请稍候查看。','Otro tab está procesando este traslado.'));
   await checkDraft();
   const qty=await available(draft.lines.map(x=>x.id),draft.route.source);
   const totals={};draft.lines.forEach(x=>totals[x.id]=(totals[x.id]||0)+pieces(x));
   const shortages=draft.lines.filter(x=>qty[x.id]<totals[x.id]);
   if(shortages.length&&!confirmShortage)return {shortages:shortages.map(x=>({name:x.display_name,available:qty[x.id],needed:totals[x.id]}))};
   let record=await savePicking(true);
   if(record.state==='draft')await rpc('stock.picking','action_confirm',[[record.id]]);
   [record]=await rpc('stock.picking','read',[[record.id],pickingFields]);
   if(record.state==='done')return record;
   if(record.state==='cancel')throw Error(t('这张单已取消。','Este traslado fue cancelado.'));
   const moves=await rpc('stock.move','read',[record.move_ids,['id','product_id','product_uom_qty','product_uom','location_id','location_dest_id','state']]);
   const expected=new Map(draft.lines.map(x=>[x.id,{quantity:pieces(x),unit:x.base}]));
   if(moves.length!==expected.size||moves.some(m=>['done','cancel'].includes(m.state)||!expected.has(idOf(m.product_id))||Math.abs(m.product_uom_qty-expected.get(idOf(m.product_id)).quantity)>1e-6||idOf(m.product_uom)!==expected.get(idOf(m.product_id)).unit||idOf(m.location_id)!==draft.route.source||idOf(m.location_dest_id)!==draft.route.destination))throw Error(t('后台商品或路线有变化，已停止确认。请重新打开此单核对。','Los productos o la ruta cambiaron. Revise el traslado antes de validar.'));
   for(const move of moves)await rpc('stock.move','write',[[move.id],{quantity:move.product_uom_qty,picked:true}]);
   const result=await rpc('stock.picking','button_validate',[[record.id]]);
   [record]=await rpc('stock.picking','read',[[record.id],pickingFields]);draft.phase=record.state;persist();
   if(record.state!=='done')throw Error(t('Odoo 还需要确认其他信息，请在后台打开此单继续。单据已保留，不会重复创建。','Odoo requiere información adicional. Abra el traslado en Inventario; no se creará otro.'));
   return record;
 });
}
async function submit(finish,force=false) {
 if(finish) {
   const result=await commit(force);
   if(result.shortages){const message=result.shortages.map(x=>esc(x.name)+' · '+t('可用 ','Disponible ')+x.available+' / '+t('需调 ','Necesario ')+x.needed).join('<br>');show(t('来源库存不足','Existencias insuficientes'),`<p>${t('实物已搬好，可以继续记账；否则请返回核对。','Si ya movió la mercancía, puede continuar; de lo contrario, revise.')}</p><div class="pbnt-summary">${message}</div>`,`<button data-back>${t('返回核对','Volver')}</button><button class="pbnt-primary" data-force>${t('仍然调拨','Continuar traslado')}</button>`);modal.querySelector('[data-back]').onclick=()=>run(open);modal.querySelector('[data-force]').onclick=()=>run(()=>submit(true,true));return;}
   notice(t('调拨已完成：','Traslado completado: ')+result.name);draft=newDraft();persist();
 }else{
   await navigator.locks.request(key('submit'),{ifAvailable:true},async lock=>{if(!lock)throw Error(t('另一窗口正在提交，请稍候查看。','Otro tab está guardando. Espere.'));const result=await savePicking();notice(t('已保存待处理：','Guardado pendiente: ')+result.name);});
 }
 await refreshPending();await open();
}
async function addProduct(product) {
 if(!['local','draft'].includes(draft.phase))throw Error(t('请先核对上次提交状态，再修改商品。','Revise el estado anterior antes de modificar productos.'));
 if(draft.lines.some(x=>x.id===product.id)){notice(t('商品已在清单中，可直接修改数量。','El producto ya está en la lista. Modifique la cantidad.'));return;}
 if(product.tracking!=='none')throw Error(t('需批次/序列号的商品请用后台调拨。','Use Inventario para productos con lote o serie.'));
 draft.lines.push(await productInfo(product));draft.dirty=true;persist();await open();
}
function productFields(){return ['id','display_name','default_code','uom_id','uom_ids','tracking'];}
async function search(text,target) {
 const token=++lastSearch;if(text.trim().length<2){target.innerHTML='';return;}
 const rows=await rpc('product.product','search_read',[[['active','=',true],['is_storable','=',true],['company_id','in',[false,pos.company.id]],'|',['default_code','ilike',text],['name','ilike',text]]],{fields:productFields(),limit:40,order:'default_code,id'});
 if(token!==lastSearch||!target?.isConnected)return;
 target.innerHTML=rows.map((x,i)=>`<button data-result="${i}">${esc(x.display_name)}</button>`).join('')||`<div class="pbnt-empty">${t('没有找到商品','No se encontraron productos')}</div>`;
 target.querySelectorAll('[data-result]').forEach(el=>el.onclick=()=>run(()=>addProduct(rows[Number(el.dataset.result)])));
}
// Compact transfer presentation. Actual stock operations remain in transfer.js.
const quantityText=n=>Number(n).toLocaleString('es-MX',{maximumFractionDigits:6});
function quantityUnits(line){
 const size=cartonSize(line),base=line.units.find(u=>u.id===line.base)||line.units.find(u=>u.factor===1);
 const box=size?line.units.find(u=>u.factor===size&&/^(caja|cart[oó]n|箱|box)(?:\s|\d|$)/i.test(u.name||'')):null;
 return {base,box,size};
}
function sourceCaption(){
 const name=locations.find(x=>x.id===Number(draft.route?.source))?.display_name;
 return name?name.split('/')[0].trim():t('来源','Origen');
}
function productGroup(line){
 return String(line.display_name||line.name||'').replace(/^\[[^\]]*\]\s*/,'').trim().split(/\s+/)[0]||t('其他','Otros');
}
function sourceCell(line,available){
 const {size,box}=quantityUnits(line),known=Number.isFinite(available),needed=pieces(line);
 const shortage=known&&Number.isFinite(needed)&&needed>available;
 const full=known&&size?Math.floor(Math.max(0,available)/size):null;
 const count=known?t('可用 ','Disponible ')+quantityText(available)+' '+t('件','uds'):'—';
 const supply=full===null?t('箱规待核对','Caja por verificar'):full===0&&Number(line.unit)===box?.id?t('不足 1 箱','Menos de 1 caja'):t('可供 '+full+' 箱',full+(full===1?' caja':' cajas'));
 return `<span class="pbqt-stock ${shortage?'pbqt-short':''}">${esc(count+' · '+supply)}</span><small>${size?esc(t(quantityText(size)+' 件 / 箱',quantityText(size)+' uds / caja')):esc(t('按实际单位调拨','Traslado en unidad seleccionada'))}</small>`;
}
function conversionText(line,available){
 const unit=line.units.find(u=>u.id===Number(line.unit)),n=pieces(line),q=Number(line.quantity);
 if(!unit||!Number.isFinite(q)||q<=0||!Number.isFinite(n))return t('请输入有效数量','Introduzca una cantidad válida');
 let value=unit.factor===1?t('本次调拨 '+quantityText(n)+' 件','Mover '+quantityText(n)+' uds'):t(quantityText(q)+' 箱 × '+quantityText(unit.factor)+' 件 = '+quantityText(n)+' 件',quantityText(q)+' cajas × '+quantityText(unit.factor)+' uds = '+quantityText(n)+' uds');
 if(!/箱|caja|cart[oó]n|box/i.test(unit.name||'')&&unit.factor!==1)value=quantityText(q)+' × '+quantityText(unit.factor)+' = '+quantityText(n)+' '+t('件','uds');
 if(Number.isFinite(available)&&n>available)value+=' · '+t('差 '+quantityText(round(n-available,.000001))+' 件','Faltan '+quantityText(round(n-available,.000001))+' uds');
 return value;
}
function quantityCell(line,index,available){
 const {base,box}=quantityUnits(line),simple=base&&box&&[base.id,box.id].includes(Number(line.unit));
 const units=simple?`<span class="pbqt-units" role="group" aria-label="${t('单位','Unidad')} ${esc(line.default_code)}">${[[box,t('箱','Caja')],[base,t('件','Ud')]].map(([u,label])=>`<button data-unit-button="${index}" data-unit-id="${u.id}" aria-pressed="${Number(line.unit)===u.id}" aria-label="${esc(label+' '+line.default_code)}">${label}</button>`).join('')}</span>`:`<select data-unit="${index}" aria-label="${t('单位','Unidad')} ${esc(line.default_code)}">${line.units.map(u=>`<option value="${u.id}" ${u.id===Number(line.unit)?'selected':''}>${esc(u.name)}</option>`).join('')}</select>`;
 return `<div class="pbqt-stepper"><button data-step="${index}" data-delta="-1" aria-label="${t('减少','Reducir')} ${esc(line.default_code)}" ${Number(line.quantity)<=1?'disabled':''}>−</button><input data-qty="${index}" aria-label="${t('数量','Cantidad')} ${esc(line.default_code)}" type="number" min="0.001" step="1" value="${esc(line.quantity)}"><button data-step="${index}" data-delta="1" aria-label="${t('增加','Aumentar')} ${esc(line.default_code)}">+</button>${units}</div><div data-conversion="${index}" class="pbqt-conversion ${available<pieces(line)?'pbqt-short-text':''}">${esc(conversionText(line,available))}</div>`;
}
function productCaption(line){
 const text=String(line.display_name||line.name||'').replace(/^\[[^\]]*\]\s*/,'').trim();
 const match=text.match(/^(.*?)\s+[·]\s+(.+)$/)||text.match(/^(.*?)\s+\(([^()]+)\)$/);
 return {name:match?match[1]:text,variant:match?match[2]:''};
}
function productCell(line){
 const caption=productCaption(line);
 return `<div class="pbqt-product-title"><strong>${esc(line.default_code||'#'+line.id)}</strong>${caption.variant?` <span>${esc(caption.variant)}</span>`:''}</div><div class="pbqt-product-name" title="${esc(line.display_name)}">${esc(caption.name)}</div>`;
}
function productTable(qty){
 const groups=new Map();draft.lines.forEach((line,index)=>{const name=productGroup(line);if(!groups.has(name))groups.set(name,[]);groups.get(name).push({line,index});});
 return `<div class="pbqt-table-scroll"><table class="pbqt-table"><thead><tr><th>${t('商品','Producto')}</th><th>${esc(sourceCaption())} ${t('可用','disponible')}</th><th>${t('调货数量','Cantidad a mover')}</th><th></th></tr></thead><tbody>${[...groups].map(([name,items])=>`<tr class="pbqt-category"><td colspan="4"><span>${esc(name)}</span><small>${items.length} ${t('种','productos')}</small></td></tr>${items.map(({line:l,index:i})=>`<tr><td class="pbqt-product">${productCell(l)}</td><td data-stock="${i}">${sourceCell(l,qty[l.id])}</td><td>${quantityCell(l,i,qty[l.id])}</td><td><button class="pbqt-remove" data-remove="${i}" aria-label="${t('移除','Quitar')} ${esc(l.default_code)}">×</button></td></tr>`).join('')}`).join('')}</tbody></table></div>`;
}
function updateQuantityRow(index,qty){
 const line=draft.lines[index],available=qty[line.id],input=modal.querySelector(`[data-qty="${index}"]`);
 if(input)input.value=line.quantity;
 modal.querySelector(`[data-stock="${index}"]`).innerHTML=sourceCell(line,available);
 const conversion=modal.querySelector(`[data-conversion="${index}"]`);conversion.textContent=conversionText(line,available);conversion.classList.toggle('pbqt-short-text',available<pieces(line));
 const minus=modal.querySelector(`[data-step="${index}"][data-delta="-1"]`);minus.disabled=!Number.isFinite(Number(line.quantity))||Number(line.quantity)<=1;
 modal.querySelectorAll(`[data-unit-button="${index}"]`).forEach(el=>el.setAttribute('aria-pressed',String(Number(el.dataset.unitId)===Number(line.unit))));
}
async function open() {
 if(!types.length)await loadRoutes();if(!draft)draft=read(key('draft'),null)||newDraft();
 const qty=draft.route?await available(draft.lines.map(x=>x.id),draft.route.source):{};
 const editable=draft.phase==='draft'||draft.phase==='local';
 show(t('快捷调货','Traslado rápido'),`<div class="pbqt-routebar"><div class="pbqt-route-tabs" role="group" aria-label="${t('调货路线','Rutas de traslado')}">${routes.map((r,i)=>`<button class="${draft.route?.uuid===r.uuid?'pbnt-selected':''}" data-route="${i}" aria-pressed="${draft.route?.uuid===r.uuid}" ${!editable?'disabled':''}>${esc(r.name)}</button>`).join('')}</div><div class="pbqt-actions"><button data-routes>${t('管理收藏','Rutas favoritas')}</button><button data-pending>${t('待处理','Pendientes')} ${pending.length}</button><button class="pbnt-primary" data-new>${t('新建','Nuevo')}</button></div></div><div class="pbqt-searchbar"><input data-search placeholder="${t('搜索型号 / 商品名，再选择颜色','Buscar modelo / nombre y elegir color')}" ${!editable?'disabled':''}><span class="pbnt-muted">${t('联系人：','Contacto: ')}${esc(draft.route?.contactName||t('未指定','Sin asignar'))}</span></div>${draft.id?`<div class="pbqt-record"><a href="/odoo/action-stock.action_picking_tree_all/${draft.id}" target="_blank" rel="noopener">${t('打开后台单据','Abrir en Inventario')} #${draft.id}</a></div>`:''}<div class="pbnt-search-results" data-results></div>${draft.lines.length?productTable(qty):`<div class="pbnt-empty">${t('选好路线，搜索并添加要调的颜色商品。','Elija una ruta y añada los productos por color.')}</div>`}`,`<span class="pbnt-muted" style="margin-right:auto">${t('当前电脑 · ','Este equipo · ')}${draft.lines.length}${t(' 种商品',' productos')}</span><button data-save>${t('保存待处理','Guardar pendiente')}</button><button class="pbnt-primary" data-confirm>${t('确认调拨','Validar traslado')}</button>`,true);
 modal.classList.add('pbqt-compact');
 const actions=modal.querySelector('.pbqt-actions');modal.querySelector('header').insertBefore(actions,modal.querySelector('[data-lang]'));
 let timer;modal.querySelector('[data-search]').oninput=e=>{clearTimeout(timer);const text=e.target.value,target=modal.querySelector('[data-results]');timer=setTimeout(()=>search(text,target).catch(e=>notice(e.message)),250);};
 modal.querySelector('[data-routes]').onclick=()=>run(manageRoutes);modal.querySelector('[data-pending]').onclick=()=>run(showPending);
 modal.querySelector('[data-new]').onclick=()=>run(async()=>{if(draft.lines.length&&(!draft.id||draft.dirty))throw Error(t('当前还有未保存商品，请先保存待处理或移除商品。','Guarde los productos actuales antes de crear otro traslado.'));draft=newDraft();persist();await open();});
 modal.querySelectorAll('[data-route]').forEach(el=>el.onclick=()=>run(async()=>{if(!editable)throw Error(t('这张单已确认，请在后台修改路线。','Cambie esta ruta en Inventario.'));draft.route=clone(routes[Number(el.dataset.route)]);draft.dirty=true;persist();await open();}));
 const editQuantity=(index,value)=>{if(!editable||busy)return;draft.lines[index].quantity=value;draft.dirty=true;persist();updateQuantityRow(index,qty);};
 modal.querySelectorAll('[data-qty]').forEach(el=>el.oninput=()=>editQuantity(Number(el.dataset.qty),el.value));
 modal.querySelectorAll('[data-step]').forEach(el=>el.onclick=()=>{const i=Number(el.dataset.step),current=Number(draft.lines[i].quantity),next=round(current+Number(el.dataset.delta),.000001);if(Number.isFinite(current)&&current>0&&next>0)editQuantity(i,next);});
 const changeUnit=(index,value)=>{if(!editable||busy)return;draft.lines[index].unit=Number(value);draft.dirty=true;persist();updateQuantityRow(index,qty);};
 modal.querySelectorAll('[data-unit]').forEach(el=>el.onchange=()=>changeUnit(Number(el.dataset.unit),el.value));
 modal.querySelectorAll('[data-unit-button]').forEach(el=>el.onclick=()=>changeUnit(Number(el.dataset.unitButton),el.dataset.unitId));
 modal.querySelectorAll('[data-remove]').forEach(el=>el.onclick=()=>run(async()=>{draft.lines.splice(Number(el.dataset.remove),1);draft.dirty=true;persist();await open();}));
 if(!editable)modal.querySelectorAll('[data-qty],[data-unit],[data-unit-button],[data-step],[data-remove],[data-save]').forEach(el=>el.disabled=true);
 modal.querySelector('[data-save]').onclick=()=>run(()=>submit(false));modal.querySelector('[data-confirm]').onclick=()=>run(()=>submit(true));
}
async function showPending() {
 await refreshPending();show(t('待处理调货','Traslados pendientes'),pending.map((p,i)=>`<div class="pbnt-row" style="padding:12px 0;border-bottom:1px solid #eee"><div><b>${esc(p.name)}</b><div class="pbnt-muted">${esc(p.location_id[1])} → ${esc(p.location_dest_id[1])}</div></div><button data-resume="${i}">${t('打开','Abrir')}</button></div>`).join('')||`<div class="pbnt-empty">${t('当前电脑没有待处理单据','No hay traslados pendientes de este equipo')}</div>`,`<button data-back>${t('返回','Volver')}</button>`,true);
 modal.querySelector('[data-back]').onclick=()=>run(open);modal.querySelectorAll('[data-resume]').forEach(el=>el.onclick=()=>run(()=>resume(pending[Number(el.dataset.resume)])));
}
async function resume(record) {
 if(draft?.lines.length&&(!draft.id||draft.dirty))throw Error(t('请先保存当前调货，再打开另一张。','Guarde el traslado actual antes de abrir otro.'));
 const moves=await rpc('stock.move','read',[record.move_ids,['product_id','product_uom_qty','product_uom']]);
 const products=await rpc('product.product','read',[[...new Set(moves.map(x=>idOf(x.product_id)))],productFields()]);
 const lines=[];for(const move of moves){const line=await productInfo(products.find(x=>x.id===idOf(move.product_id)));if(line.base!==idOf(move.product_uom))throw Error(t('后台使用了其他计量单位，请在后台完成此单。','Esta unidad requiere revisión en Inventario.'));const chosen=line.units.find(u=>u.id===line.unit);const count=move.product_uom_qty/(chosen?.factor||1);if(Math.abs(count-Math.round(count))<1e-6){line.quantity=count;}else{line.unit=line.base;line.quantity=move.product_uom_qty;}lines.push(line);}
 draft={uuid:record.origin.replace('PB-QT:',''),id:record.id,phase:record.state,writeDate:record.write_date,route:{uuid:routes.find(r=>r.type===idOf(record.picking_type_id)&&r.source===idOf(record.location_id)&&r.destination===idOf(record.location_dest_id))?.uuid,name:record.name,type:idOf(record.picking_type_id),source:idOf(record.location_id),destination:idOf(record.location_dest_id),contact:idOf(record.partner_id),contactName:record.partner_id?.[1]||''},lines};persist();await open();
}
async function manageRoutes(selected=0) {
 const route=clone(routes[selected]||{uuid:crypto.randomUUID(),name:'',type:types[0]?.id,source:idOf(types[0]?.default_location_src_id),destination:idOf(types[0]?.default_location_dest_id),contact:0,contactName:''});
 show(t('路线收藏 · 当前电脑','Rutas favoritas · Este equipo'),`<div class="pbnt-toolbar">${routes.map((r,i)=>`<button data-edit="${i}" class="${i===selected?'pbnt-selected':''}">${esc(r.name)}</button>`).join('')}<button data-add>＋</button></div><label>${t('收藏名称','Nombre')}<input data-name value="${esc(route.name)}"></label><div class="pbnt-fields"><label>${t('调拨类型','Tipo de operación')}<select data-type>${types.map(x=>`<option value="${x.id}" ${x.id===route.type?'selected':''}>${esc(x.display_name)}</option>`).join('')}</select></label><label>${t('联系人','Contacto')}<input data-contact-search placeholder="${t('搜索联系人','Buscar contacto')}" value="${esc(route.contactName)}"></label><label>${t('来源库位','Origen')}<select data-source>${locations.map(x=>`<option value="${x.id}" ${x.id===route.source?'selected':''}>${esc(x.display_name)}</option>`).join('')}</select></label><label>${t('目标库位','Destino')}<select data-destination>${locations.map(x=>`<option value="${x.id}" ${x.id===route.destination?'selected':''}>${esc(x.display_name)}</option>`).join('')}</select></label></div><div class="pbnt-search-results" data-contacts></div>`,`<button data-back>${t('返回','Volver')}</button><button data-delete>${t('删除收藏','Quitar favorito')}</button><button class="pbnt-primary" data-save-route>${t('保存收藏','Guardar ruta')}</button>`,true);
 modal.querySelectorAll('[data-edit]').forEach(el=>el.onclick=()=>run(()=>manageRoutes(Number(el.dataset.edit))));modal.querySelector('[data-add]').onclick=()=>run(()=>manageRoutes(routes.length));modal.querySelector('[data-back]').onclick=()=>run(open);
 let contactTimer,contactRequest=0;
 modal.querySelector('[data-contact-search]').oninput=e=>{route.contact=0;route.contactName='';clearTimeout(contactTimer);const text=e.target.value,request=++contactRequest,target=modal.querySelector('[data-contacts]');contactTimer=setTimeout(async()=>{try{if(text.length<2){target.innerHTML='';return;}const contacts=await rpc('res.partner','search_read',[[['name','ilike',text]]],{fields:['id','display_name'],limit:15});if(!target.isConnected||request!==contactRequest)return;target.innerHTML=contacts.map((c,i)=>`<button data-person="${i}">${esc(c.display_name)}</button>`).join('');target.querySelectorAll('[data-person]').forEach(el=>el.onclick=()=>{const c=contacts[Number(el.dataset.person)];route.contact=c.id;route.contactName=c.display_name;modal.querySelector('[data-contact-search]').value=c.display_name;target.innerHTML='';});}catch(error){notice(error.message);}},250);};
 modal.querySelector('[data-save-route]').onclick=()=>run(async()=>{route.name=modal.querySelector('[data-name]').value.trim();route.type=Number(modal.querySelector('[data-type]').value);route.source=Number(modal.querySelector('[data-source]').value);route.destination=Number(modal.querySelector('[data-destination]').value);if(!route.name||route.source===route.destination)throw Error(t('请填写名称，并选择不同的库位。','Escriba un nombre y elija ubicaciones distintas.'));routes[selected]=route;save(key('routes'),routes);save(key('routesConfigured'),true);if(!draft.lines.length&&!draft.id)draft.route=clone(route);persist();await open();});
 modal.querySelector('[data-delete]').onclick=()=>run(async()=>{routes.splice(selected,1);save(key('routes'),routes);save(key('routesConfigured'),true);await manageRoutes(0);});
}
async function initialize() {
 launch=launcher(t('调货','Traslado'));await refreshPending().catch(error=>notice(error.message));
 setInterval(()=>{if(!document.hidden&&!busy)refreshPending().catch(()=>{});},60000);
 window[GLOBAL]={version:VERSION,open,available,refreshPending,diagnostics:()=>({pending:pending.map(x=>({id:x.id,state:x.state})),draft:clone(draft||{}),routes:clone(routes)}),test:{loadRoutes,productInfo,addProduct,savePicking,commit,resume,setDraft:value=>{draft=value;persist();},getDraft:()=>draft}};
}

boot().catch(console.error);
})();

// ==UserScript==
// @name         Playbox Odoo - 优惠
// @namespace    playbox.internal.pos.discount
// @version      0.2.2
// @description  POS 优惠 · Odoo Online 通用版
// @match        https://*.odoo.com/pos/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(() => {
'use strict';
const KIND='discount', GLOBAL='PBDiscount';
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

let tax, editingOrder, percentInput, amountInput, manualInput=false, launch;
const stateCache=new Map(), signatures=new Map();
let applying=false, scheduled=false;
const step=()=>pos.currency.rounding || .01;
const isDiscount=line=>line.isDiscountLine || line.product_id?.id===pos.config.discount_product_id?.id;
function state(order) {
 const marker=order.lines.map(l=>l.extra_tax_data?.pb_line_discount).find(x=>x?.orderUuid===order.uuid);
 if(marker){stateCache.set(order.uuid,marker);return marker;}
 const cached=stateCache.get(order.uuid)||read(key('native-order:'+order.uuid),null);
 return cached?.v===2?cached:null;
}
function remember(order,value){stateCache.set(order.uuid,value);try{save(key('native-order:'+order.uuid),value);}catch{notice(t('本机设置未能保存；商品原生折扣仍已写入订单。','Preferencia local no guardada; el descuento nativo permanece en el pedido.'));}}
function assertSupported(order){
 if(order.lines.some(l=>l.extra_tax_data?.pb_fixed_discount))throw Error(t('这是旧版优惠订单，请先按旧版流程核对，不能自动转换。','Pedido con descuento anterior; revise antes de convertir.'));
}
function eligibility(order) {
 assertSupported(order);
 const retail=pos.models['product.pricelist'].getAll().find(p=>/^(零售价?|retail|precio\s*(de\s*)?(venta|minorista))$/i.test(p.name?.trim()));
 if(!retail)throw Error(t('未找到零售价价格表，无法核对哪些商品可以优惠。','No se encontró la lista minorista.'));
 const rows=[];
 for(const line of order.lines) {
   if(isDiscount(line))continue;
   if(line.qty<0)throw Error(t('此优惠只用于正数商品的普通销售单。退款请使用原退款流程。','Este descuento es para ventas normales, sin devoluciones.'));
   if(line.qty===0)continue;
   if(line.sale_order_origin_id || line.sale_order_line_id || order.sale_order_count)throw Error(t('销售单导入的订单不使用此优惠。','No se aplica a pedidos importados de Ventas.'));
   if(line.is_reward_line || line.combo_parent_id || line.combo_line_ids?.length || line.product_id?.product_tmpl_id?.isCombo?.())throw Error(t('含组合商品或积分奖励，请用原优惠方式。','Use el flujo original para combos o recompensas.'));
   const raw=read('pb-cart-unit-v1:'+location.host+':'+order.uuid+':'+line.uuid,null);
   const metadata=raw?.productId===line.product_id.id?raw:null;
   const price=metadata?.priceId?pos.models['product.pricelist'].get(metadata.priceId):order.pricelist_id;
   const box=/箱价|批发|caja|mayoreo/i.test(price?.name || '');
   const original=line.product_id.getPrice(retail,line.qty,line.price_extra || 0,false,line.product_id);
   if(!Number.isFinite(original))throw Error(t('无法读取零售原价。','No se pudo leer el precio minorista.'));
   const changed=Math.abs(Number(line.price_unit)-original)>.005;
   const allowed=!box && !changed && line.isGlobalDiscountApplicable();
   const base=tax.prepare_base_line_for_taxes_computation(line,line.prepareBaseLineForTaxesComputationExtraValues({discount:0}));
   tax.add_tax_details_in_base_lines([base],order.company_id);tax.round_base_lines_tax_details([base],order.company_id);
   const gross=Number(base.tax_details.raw_total_included_currency??base.tax_details.total_included_currency);
   if(!Number.isFinite(gross))throw Error(t('金额计算尚未就绪。','El cálculo de impuestos no está listo.'));
   rows.push({line,base,gross,allowed,box,changed});
 }
 return {rows,eligible:round(rows.filter(x=>x.allowed).reduce((s,x)=>s+x.gross,0),step()),boxed:rows.filter(x=>x.box).reduce((s,x)=>s+x.gross,0),other:rows.filter(x=>!x.box&&!x.allowed).reduce((s,x)=>s+x.gross,0),gross:round(rows.reduce((s,x)=>s+x.gross,0),step())};
}
function allocation(rows,amount) {
 const total=rows.reduce((s,x)=>s+x.gross,0);let cumulative=0,previous=0;
 if(total<=0)return rows.map(x=>({uuid:x.line.uuid,product:x.line.product_id.id,qty:x.line.qty,amount:0}));
 return rows.map(x=>{cumulative+=x.gross;const next=round(amount*cumulative/total,step()),share=round(next-previous,step());previous=next;return {uuid:x.line.uuid,product:x.line.product_id.id,qty:x.line.qty,amount:share};});
}
// Monetary amounts are represented by native pos.order.line.discount.
// Metadata is only for continued editing, never needed to refund a paid order.
const nativeMark=line=>line.extra_tax_data?.pb_line_discount;
function baseTotal(order,line,quantity,discount){
 const base=tax.prepare_base_line_for_taxes_computation(line,line.prepareBaseLineForTaxesComputationExtraValues({quantity,discount}));
 tax.add_tax_details_in_base_lines([base],order.company_id);
 const value=Number(base.tax_details.raw_total_included_currency??base.tax_details.total_included_currency);
 if(!Number.isFinite(value))throw Error(t('无法核对商品税额。','No se pudo verificar el impuesto.'));
 return value;
}
function solvePercent(order,line,target){
 const full=baseTotal(order,line,1,0),min=baseTotal(order,line,1,100);
 if(target<min-1e-7||target>full+1e-7)throw Error(t('此商品税额不支持该优惠金额，请调整优惠。','Este importe no es compatible con los impuestos del producto.'));
 if(Math.abs(target-full)<1e-8)return 0;if(Math.abs(target-min)<1e-8)return 100;
 let low=0,high=100;
 for(let i=0;i<48;i++){const mid=(low+high)/2;if(baseTotal(order,line,1,mid)>target)low=mid;else high=mid;}
 const pct=Number(((low+high)/2).toFixed(10));
 if(Math.abs(baseTotal(order,line,1,pct)-target)>1e-6)throw Error(t('无法精确分配优惠，原订单未更改。','No se pudo repartir el descuento exactamente.'));
 return pct;
}
function groupsFor(order,rows){
 const groups=new Map();
 for(const r of rows){
  const l=r.line,mark=nativeMark(l),root=mark?.orderUuid===order.uuid?mark.group:l.uuid;
  const pack=read('pb-cart-unit-v1:'+location.host+':'+order.uuid+':'+l.uuid,null);
  const groupKey=JSON.stringify([root,l.product_id.id,l.price_unit,l.price_extra,l.tax_ids.map(x=>x.id),l.customer_note||'',l.note||'',(l.attribute_value_ids||[]).map(x=>x.id),pack?.priceId]);
  if(!groups.has(groupKey))groups.set(groupKey,{line:l,rows:[],qty:0,gross:0,root,pack});
  const g=groups.get(groupKey);g.rows.push(r);g.qty+=l.qty;g.gross+=r.gross;
 }
 return [...groups.values()];
}
function makePlan(order,info,amount){
 const groups=groupsFor(order,info.rows.filter(x=>x.allowed));
 const shares=allocation(groups,amount),plans=[];
 groups.forEach((g,index)=>{
  if(!Number.isSafeInteger(g.qty)||g.qty<1)throw Error(t('当前精确分摊仅支持整件商品。','El reparto exacto requiere cantidades enteras.'));
  const target=round(g.gross-shares[index].amount,step()),cents=Math.round(target/step());
  const low=Math.floor(cents/g.qty),remainder=cents-low*g.qty;
  const parts=[{qty:g.qty-remainder,cents:low},{qty:remainder,cents:low+1}].filter(x=>x.qty);
  const full=baseTotal(order,g.line,1,0);
  if(parts.some(x=>x.cents*step()>full+1e-7))throw Error(t('商品单价含不足一分的尾数，请先核对单价。','Revise el precio unitario con fracciones de centavo.'));
  const entries=parts.map(part=>({...part,discount:solvePercent(order,g.line,part.cents*step())}));
  if(entries.length>g.rows.length&&(g.line.pack_lot_ids?.length||g.line.custom_attribute_value_ids?.length||g.line.product_id.tracking&&g.line.product_id.tracking!=='none'))throw Error(t('此商品有批次或自定义属性，不能自动拆分优惠。','Este producto no admite división automática del descuento.'));
  plans.push({...g,entries});
 });
 return plans;
}
function cloneLineValues(line,order){
 return {order_id:order,product_id:line.product_id,product_tmpl_id:line.product_id.product_tmpl_id,price_unit:line.price_unit,price_extra:line.price_extra||0,price_type:line.price_type||'original',qty:0,discount:0,tax_ids:line.tax_ids.map(x=>['link',x]),attribute_value_ids:(line.attribute_value_ids||[]).map(x=>['link',x]),customer_note:line.customer_note||'',note:line.note||''};
}
function writeNative(order,info,amount,metadata){
 const plans=makePlan(order,info,amount),backup=order.lines.map(line=>({line,qty:line.qty,price_unit:line.price_unit,discount:line.discount,extra_tax_data:line.extra_tax_data})),created=[],unused=[],copiedKeys=[];
 applying=true;
 try{
  for(const l of order.lines){l.setDiscount(0);if(isDiscount(l))l.update({qty:0});const data={...(l.extra_tax_data||{})};delete data.pb_line_discount;l.update({extra_tax_data:data});}
  for(const plan of plans){
   for(let i=0;i<plan.entries.length;i++){
    const part=plan.entries[i];let line=plan.rows[i]?.line;
    if(!line){line=pos.models['pos.order.line'].create(cloneLineValues(plan.line,order));created.push(line);if(plan.pack){const k='pb-cart-unit-v1:'+location.host+':'+order.uuid+':'+line.uuid;save(k,plan.pack);copiedKeys.push(k);}}
    const mark={...metadata,orderUuid:order.uuid,group:plan.root,unitNet:part.cents*step()};
    line.update({qty:part.qty,extra_tax_data:{pb_line_discount:mark}});line.setDiscount(part.discount);
   }
   for(const extra of plan.rows.slice(plan.entries.length)){extra.line.update({qty:0});unused.push(extra.line);}
  }
  for(const r of info.rows.filter(x=>!x.allowed)){const data={...(r.line.extra_tax_data||{})};delete data.pb_line_discount;r.line.update({extra_tax_data:data});}
  const expected=round(info.gross-amount,step());
  if(Math.abs(order.totalDue-expected)>step()/2)throw Error(t('原生计算与优惠金额不一致，已撤回修改。','El total nativo no coincide; se revirtió el cambio.'));
  for(const l of [...unused,...order.lines.filter(isDiscount)])l.delete();
  remember(order,metadata);
 }catch(error){
  created.forEach(l=>l.delete());for(const b of backup){const{line,...values}=b;line.update(values);}copiedKeys.forEach(k=>localStorage.removeItem(k));throw error;
 }finally{applying=false;}
}

function apply(order,requested,percent=0,mode='fixed') {
 order.assertEditable();
 if(!pos.cashierHasPriceControlRights())throw Error(t('当前收银员没有改价权限。','El cajero no tiene permiso para cambiar precios.'));
 if(order.payment_ids.length)throw Error(t('请先移除已填写的付款，再修改优惠。','Quite los pagos registrados antes de cambiar el descuento.'));
 if(!Number.isFinite(requested)||requested<0)throw Error(t('请输入有效的优惠金额。','Introduzca un descuento válido.'));
 if(!Number.isFinite(percent)||percent<0||percent>100||!['fixed','percent'].includes(mode))throw Error(t('优惠比例应在 0 到 100 之间。','El porcentaje debe estar entre 0 y 100.'));
 const info=eligibility(order),amount=round(Math.min(requested,info.eligible),step());
 const rows=info.rows.filter(x=>x.allowed);
 const metadata={v:2,amount:round(requested,step()),applied:amount,percent,mode};
 writeNative(order,info,amount,metadata);
 signatures.set(order.uuid,fingerprint(order));
 if(requested>info.eligible+step()/2)notice(t('商品金额不足，当前优惠最多 '+money(amount)+'；你设置的金额仍保留，可打开优惠修改。','Se aplicó el máximo disponible: '+money(amount)+'. Puede ajustar el descuento.'));
 return {amount,total:order.totalDue};
}
function clear(order) {
 order.assertEditable();assertSupported(order);if(!pos.cashierHasPriceControlRights())throw Error(t('当前收银员没有改价权限。','Sin permiso para cambiar precios.'));if(order.payment_ids.length)throw Error(t('请先移除付款。','Quite los pagos primero.'));
 applying=true;try{for(const line of order.lines){if(nativeMark(line)?.orderUuid===order.uuid){line.setDiscount(0);const data={...(line.extra_tax_data||{})};delete data.pb_line_discount;line.update({extra_tax_data:data});}}remember(order,null);signatures.delete(order.uuid);}finally{applying=false;}
}
function fingerprint(order) {return JSON.stringify([order.fiscal_position_id?.id,order.pricelist_id?.id,order.lines.filter(l=>!isDiscount(l)).map(l=>[l.uuid,l.qty,l.price_unit,l.discount,l.product_id.id,l.refunded_orderline_id?.id,l.tax_ids.map(t=>t.id),read('pb-cart-unit-v1:'+location.host+':'+order.uuid+':'+l.uuid,null)])]);}
function refreshManaged() {
 if(applying)return;
 for(const order of pos.models['pos.order'].getAll()) {
   if(order.state!=='draft'||order.finalized||order.payment_ids.length)continue;
   const value=state(order);if(!value)continue;
   const fp=fingerprint(order);if(signatures.get(order.uuid)===fp)continue;
   try {
     if(order.lines.some(l=>l.refunded_orderline_id||l.qty<0))continue;
     const info=eligibility(order);apply(order,value.mode==='percent'?round(info.eligible*value.percent/100,step()):value.amount,value.percent,value.mode);
   }catch(error){notice(error.message);signatures.set(order.uuid,fp);}

 }
}
function paintSummary(){
 const target=document.querySelector('.order-summary'),order=pos.getOrder(),value=order&&state(order);let node=document.getElementById('pb-native-discount-summary');
 if(!target||!value||value.v!==2||!value.applied){node?.remove();return;}
 if(!node){node=document.createElement('div');node.id='pb-native-discount-summary';node.className='pbnt-cart-summary';}
 const label=t('优惠合计','Descuento total')+' −'+money(value.applied);if(node.textContent!==label)node.textContent=label;if(node.parentElement!==target)target.append(node);
}
function queueRefresh() {if(applying||scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;refreshManaged();paintSummary();});}
async function open() {
 const order=pos.getOrder();if(!order)throw Error(t('请先打开订单。','Abra un pedido.'));
 const info=eligibility(order);editingOrder=order;
 const current=state(order);percentInput=Number(current?.percent??10);amountInput=current?.amount??round(info.eligible*percentInput/100,step());manualInput=current?.mode==='fixed';
 show(t('整单优惠','Descuento del pedido'),`<div class="pbnt-summary"><div class="pbnt-row"><span>${t('可优惠商品','Productos con descuento')}</span><b>${money(info.eligible)}</b></div><div class="pbnt-row pbnt-muted"><span>${t('箱价 / 批发价 · 不参与','Caja / mayoreo · excluidos')}</span><span>${money(info.boxed)}</span></div><div class="pbnt-row pbnt-muted"><span>${t('其他改价 · 不参与','Otros precios modificados')}</span><span>${money(info.other)}</span></div></div><div class="pbnt-fields"><label>${t('优惠比例 %','Descuento %')}<input data-percent type="number" min="0" max="100" step="0.1" value="${percentInput}"></label><label>${t('优惠金额','Importe de descuento')}<input data-amount type="number" min="0" step="0.01" value="${amountInput}"></label></div><div class="pbnt-muted" data-calculated></div><div class="pbnt-row pbnt-total"><span>${t('优惠后应收','Total a cobrar')}</span><strong data-total></strong></div><details class="pbnt-help"><summary>${t('优惠规则与退款说明','Reglas y devoluciones')}</summary><p>${t('应用时清掉旧折扣；箱价、批发价和其他改价商品不参与。手动填写的优惠金额会保留。','Reemplaza los descuentos anteriores. Excluye caja, mayoreo y otros precios modificados. Conserva el importe manual.')}</p><p>${t('优惠保存为商品原生折扣。同款商品可能分两行以保证分摊精确。旧版优惠单不会自动转换。关账与发票尚待验收。','Descuento nativo por producto. Puede dividir líneas para repartir centavos. No convierte pedidos anteriores. Cierre contable y facturación pendientes.')}</p></details>`,`<button data-clear>${t('清除优惠','Quitar descuento')}</button><button class="pbnt-primary" data-apply>${t('应用优惠','Aplicar descuento')}</button>`);
 const update=()=>{const valid=Number.isFinite(amountInput)&&amountInput>=0;modal.querySelector('[data-total]').textContent=valid?money(Math.max(0,info.gross-Math.min(info.eligible,amountInput))):'—';modal.querySelector('[data-calculated]').textContent=valid?t('按比例计算：','Calculado: ')+money(info.eligible*percentInput/100)+(manualInput?t(' · 已手动调整',' · Ajuste manual'):''):t('请输入有效的优惠金额。','Introduzca un descuento válido.');};
 modal.querySelector('[data-percent]').oninput=e=>{percentInput=Math.min(100,Math.max(0,Number(e.target.value)||0));amountInput=round(info.eligible*percentInput/100,step());manualInput=false;modal.querySelector('[data-amount]').value=amountInput;update();};
 modal.querySelector('[data-amount]').oninput=e=>{amountInput=Number(e.target.value);manualInput=true;update();};
 modal.querySelector('[data-apply]').onclick=()=>run(()=>{if(pos.getOrder()!==editingOrder)throw Error(t('当前订单已切换，请重新打开优惠。','El pedido cambió. Vuelva a abrir el descuento.'));apply(editingOrder,amountInput,percentInput,manualInput?'fixed':'percent');modal.remove();modal=null;notice(t('优惠已保存为商品原生折扣。','Descuento aplicado. Puede cobrar normalmente.'));});
 modal.querySelector('[data-clear]').onclick=()=>run(()=>{clear(editingOrder);modal.remove();modal=null;});update();
}
async function initialize() {
 tax=window.odoo?.loader?.modules?.get('@account/helpers/account_tax')?.accountTaxHelpers;
 if(!tax)throw Error('Odoo 税额计算尚未就绪');
 launch=launcher(t('优惠','Descuento'));
 for(const model of ['pos.order.line','pos.order'])for(const event of ['create','update','delete'])pos.models[model].addEventListener(event,queueRefresh);
 // Cheap fallback for direct assignments from older scripts; no DOM scans or storage enumeration.
 setInterval(()=>{if(!document.hidden)queueRefresh();},750);
 window[GLOBAL]={version:VERSION,open,apply,clear,eligibility,refresh:refreshManaged,state};queueRefresh();
}

boot().catch(console.error);
})();

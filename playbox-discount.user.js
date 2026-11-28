// ==UserScript==
// @name         Playbox Odoo - 优惠
// @namespace    playbox.internal.pos.discount
// @version      0.2.11
// @description  POS 商品百分比优惠 · 保留原商品行与数量
// @match        https://*.odoo.com/pos/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(() => {
'use strict';
const KIND='discount', GLOBAL='PBDiscount';
/* Shared source copied into each independent userscript at build time. */
const VERSION = '0.2.11';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const idOf = value => Array.isArray(value) ? value[0] : value?.id || value || false;
const round = (n, step = .01) => Math.round((n + Number.EPSILON) / step) * step;
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const money = n => Number(n || 0).toLocaleString('es-MX', {minimumFractionDigits:2, maximumFractionDigits:2});
const ROOT = 'pb-' + KIND;
let pos, modal, busy = false;
// Same protocol as the existing Playbox global Chinese / Spanish switch.
const LANGUAGE_KEY='pb-suite:language:v1',LANGUAGE_EVENT='pb-suite:language-change:v1';
function parseLanguage(raw){
 try{const value=JSON.parse(raw);if(value?.schema!==1)return null;return ['es','es-MX'].includes(value.language)?'es-MX':['zh','zh-CN'].includes(value.language)?'zh-CN':null;}catch{return null;}
}
function readGlobalLanguage(){try{return parseLanguage(localStorage.getItem(LANGUAGE_KEY));}catch{return null;}}
let spanish=readGlobalLanguage()?readGlobalLanguage()==='es-MX':read(ROOT+':es',false);
let modalLanguageRender=null,queuedLanguage=null,languageInstalled=false;
const languagePairs=new Map();
const t=(zh,es)=>{if(languagePairs.size>1000)languagePairs.clear();languagePairs.set(zh,[zh,es]);languagePairs.set(es,[zh,es]);return spanish?es:zh;};
const translatedMessage=text=>languagePairs.get(text)?.[spanish?1:0]??text;
function updateLanguageLauncher(){
 const button=document.getElementById(ROOT+'-launch');
 if(button){button.textContent=KIND==='transfer'?t('调货','Traslado')+(pending.length?' · '+pending.length:''):t('优惠','Descuento');button.title=KIND==='transfer'?t('快捷调货','Traslado rápido'):t('整单优惠','Descuento del pedido');button.setAttribute('aria-label',button.title);}
 if(KIND==='discount'&&pos)paintSummary();
}
function preserveLanguageView(render){
 const before=modal;
 if(!before?.isConnected||!render)return;
 const nextSibling=before.nextSibling,externalFocus=before.contains(document.activeElement)?null:document.activeElement;
 const identify=el=>{const attribute=[...el.attributes].find(a=>a.name.startsWith('data-'));return attribute?'['+attribute.name+'="'+CSS.escape(attribute.value)+'"]':null;};
 const fields=[...before.querySelectorAll('input,select,textarea')].map(el=>({selector:identify(el),value:el.value,start:el.selectionStart,end:el.selectionEnd}));
 const details=[...before.querySelectorAll('details')].map(el=>el.open);
 const active=before.contains(document.activeElement)?identify(document.activeElement):null;
 const scrolls=['main','.pbqt-table-scroll','[data-results]','[data-contacts]'].map(selector=>{const el=before.querySelector(selector);return {selector,top:el?.scrollTop||0,left:el?.scrollLeft||0};});
 const results=['[data-results]','[data-contacts]'].map(selector=>({selector,node:before.querySelector(selector)}));
 const error=before.querySelector('.pbnt-error')?.textContent||'';
 render();
 if(nextSibling?.parentNode===document.body&&modal?.isConnected)document.body.insertBefore(modal,nextSibling);
 for(const {selector,node} of results){const replacement=modal?.querySelector(selector);if(node&&replacement){replacement.replaceWith(node);const empty=node.querySelector('.pbnt-empty');if(empty)empty.textContent=translatedMessage(empty.textContent);}}
 for(const field of fields){const el=field.selector&&modal?.querySelector(field.selector);if(el){el.value=field.value;if(field.start!==null&&typeof el.setSelectionRange==='function')try{el.setSelectionRange(field.start,field.end);}catch{}}}
 modal?.querySelectorAll('details').forEach((el,i)=>{el.open=details[i]||false;});
 // Only presentation reacts to this restored selection; no input/change handlers submit data.
 modal?.querySelector('[data-target-state]')?.dispatchEvent(new Event('change'));
 const errorBox=modal?.querySelector('.pbnt-error');if(errorBox)errorBox.textContent=translatedMessage(error);
 if(active)modal?.querySelector(active)?.focus({preventScroll:true});else if(externalFocus?.isConnected)externalFocus.focus({preventScroll:true});
 for(const {selector,top,left} of scrolls){const el=modal?.querySelector(selector);if(el){el.scrollTop=top;el.scrollLeft=left;}}
}
function receiveLanguage(language){
 if(!language)return;
 if(busy){queuedLanguage=language;return;}
 queuedLanguage=null;const next=language==='es-MX';if(next===spanish)return;
 spanish=next;updateLanguageLauncher();
 preserveLanguageView(modalLanguageRender);
 const box=document.getElementById(ROOT+'-notice');if(box)box.textContent=translatedMessage(box.textContent);
}
function flushLanguage(){if(queuedLanguage)receiveLanguage(queuedLanguage);}
function toggleGlobalLanguage(){
 if(busy)return;
 const language=spanish?'zh-CN':'es-MX',payload=JSON.stringify({schema:1,language});
 try{localStorage.setItem(LANGUAGE_KEY,payload);}catch{notice(t('语言已切换，但浏览器未能保存设置。','Se cambió el idioma, pero no se pudo guardar la preferencia.'));}
 receiveLanguage(language);window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT,{detail:payload}));
}
function installLanguageSync(){
 if(languageInstalled)return;languageInstalled=true;
 window.addEventListener(LANGUAGE_EVENT,event=>receiveLanguage(parseLanguage(event.detail)));
 window.addEventListener('storage',event=>{if(event.key===LANGUAGE_KEY&&(!event.storageArea||event.storageArea===localStorage))receiveLanguage(parseLanguage(event.newValue));});
 receiveLanguage(readGlobalLanguage());
}

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
  const previousFocus=document.activeElement;modalLanguageRender=null;
  modal?.remove();modal=document.createElement('div');modal.id=ROOT+'-modal';modal.className='pbnt-overlay';
  modal.innerHTML=`<section class="pbnt-dialog ${wide?'pbnt-wide':''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button data-lang title="${t('所有脚本切换为西语','Cambiar todos los scripts a chino')}" aria-label="${t('所有脚本切换为西语','Cambiar todos los scripts a chino')}">${spanish?'中':'ES'}</button><button data-close aria-label="${t('关闭','Cerrar')}">×</button></header><main>${body}</main><div class="pbnt-error" role="alert"></div><footer>${footer}</footer></section>`;
  modal.querySelector('[data-close]').onclick=()=>{close();previousFocus?.focus();};
  modal.querySelector('[data-lang]').onclick=toggleGlobalLanguage;
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
  finally {busy=false;controls.forEach(([el,disabled])=>el.disabled=disabled);flushLanguage();}
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
.pbnt-dialog .pbnt-fields{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;margin:18px 0 10px}
.pbnt-dialog label{display:flex;flex-direction:column;gap:6px;font-size:13px;color:#526572}
.pbnt-dialog [data-percent]{font-size:20px;font-weight:600;color:#235a57;font-variant-numeric:tabular-nums}
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
 installStyle();installLanguageSync();await initialize();updateLanguageLauncher();
 } finally {delete window[GLOBAL+'Booting'];}
}

let tax, editingOrder, percentInput, launch;
const stateCache=new Map(), signatures=new Map();
let applying=false, scheduled=false;
const step=()=>pos.currency.rounding || .01;
const isDiscount=line=>line.isDiscountLine || line.product_id?.id===pos.config.discount_product_id?.id;
function state(order) {
 const marker=order.lines.map(l=>l.extra_tax_data?.pb_line_discount).find(x=>x?.orderUuid===order.uuid);
 if(marker){stateCache.set(order.uuid,marker);return marker;}
 const cached=stateCache.has(order.uuid)?stateCache.get(order.uuid):read(key('native-order:'+order.uuid),null);
 return [2,3].includes(cached?.v)?cached:null;
}
function remember(order,value){stateCache.set(order.uuid,value);try{save(key('native-order:'+order.uuid),value);}catch{notice(t('本机设置未能保存；商品原生折扣仍已写入订单。','Preferencia local no guardada; el descuento nativo permanece en el pedido.'));}}
function assertSupported(order){
 if(order.lines.some(l=>l.extra_tax_data?.pb_fixed_discount))throw Error(t('这是旧版优惠订单，请先按旧版流程核对，不能自动转换。','Pedido con descuento anterior; revise antes de convertir.'));
}
function pricelistName(pricelist) {
 const name=String(pricelist?.name||pricelist?.display_name||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim().replace(/\s+/g,' ');
 const currency=String(pricelist?.currency_id?.name||pos.currency?.name||'').toLowerCase();
 const suffix=' ('+currency+')';
 return (currency&&name.endsWith(suffix)?name.slice(0,-suffix.length):name).replace(/[\s_\-]+/g,' ');
}
const retailNames=new Set([
 '零售','零售价','retail','public pricelist',
 'publica','publico','al publico','pvp','minorista','menudeo','al menudeo','al por menor',
 'precio venta','precio de venta','precio minorista','precio de minorista','precio publico',
 'precio al publico','precio de venta al publico','venta al publico','precio de menudeo',
 'precio menudeo','precio al menudeo','venta al menudeo','venta al por menor','precio al por menor',
 'precio de venta al por menor','precio de venta minorista',
]);
function selectRetailPricelist(order) {
 const candidates=pos.models['product.pricelist'].getAll().filter(pricelist=>{
   const name=pricelistName(pricelist);
   const category=name.replace(/^(?:lista de precios? (?:para (?:el )?|de )?|tarifa )/,'');
   return retailNames.has(name)||retailNames.has(category)||/^precio\s*(?:de\s*)?(?:venta|minorista)$/.test(name);
 });
 const preferred=[order.pricelist_id,pos.config.pricelist_id];
 for(const current of preferred) {
   const candidate=candidates.find(pricelist=>pricelist.id===idOf(current));
   if(candidate)return candidate;
 }
 if(candidates.length===1)return candidates[0];
 if(candidates.length>1)throw Error(t('找到多张零售价价格表，请在订单中选择实际使用的零售价表。','Hay varias listas minoristas. Seleccione en el pedido la lista minorista que corresponda.'));
 throw Error(t('未找到零售价价格表，无法核对哪些商品可以优惠。','No se encontró la lista minorista.'));
}
function eligibility(order) {
 assertSupported(order);
 const retail=selectRetailPricelist(order);
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
   const box=/箱价|批发|caja|mayoreo|mayorista|\bpor mayor\b/.test(pricelistName(price));
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
const ownedMark=(order,line)=>{
 const mark=line.extra_tax_data?.pb_line_discount;
 return mark?.orderUuid===order.uuid?mark:null;
};

function assertCanChange(order){
 order.assertEditable();assertSupported(order);
 if(!pos.cashierHasPriceControlRights())throw Error(t('当前收银员没有改价权限。','El cajero no tiene permiso para cambiar precios.'));
 if(order.payment_ids.length)throw Error(t('请先移除已填写的付款，再修改优惠。','Quite los pagos registrados antes de cambiar el descuento.'));
}
function validatePercent(value){
 if(!Number.isFinite(value)||value<0||value>100)throw Error(t('优惠比例应在 0 到 100 之间。','El porcentaje debe estar entre 0 y 100.'));
}
function originalPercent(order,line){
 const mark=ownedMark(order,line);
 return mark?Number(mark.originalDiscount||0):Number(line.discount||0);
}
function setPercent(line,value){
 if(Number(line.discount||0)!==value)line.setDiscount(value);
}
function writeMark(line,mark){
 const data={...(line.extra_tax_data||{})};
 if(mark)data.pb_line_discount=mark;else delete data.pb_line_discount;
 line.update({extra_tax_data:data});
}

function updateLines(order,eligible,percent){
 const previous=new Map();
 applying=true;
 try{
   for(const line of order.lines){
     if(!eligible.has(line)&&!ownedMark(order,line))continue;
     previous.set(line,{discount:line.discount,extra_tax_data:line.extra_tax_data});
     if(eligible.has(line))setPercent(line,0);
     else {setPercent(line,originalPercent(order,line));writeMark(line,null);}
   }
   const before=order.totalDue;
   for(const line of eligible)setPercent(line,percent);
   const total=order.totalDue,amount=round(before-total,step());
   if(!Number.isFinite(amount))throw Error(t('订单金额尚未就绪。','El total del pedido aún no está disponible.'));
   const metadata=percent>0?{v:3,mode:'percent',percent,applied:amount,orderUuid:order.uuid}:null;
   for(const line of eligible){
     const old=previous.get(line);
     const originalDiscount=ownedMark(order,line)?originalPercent(order,line):Number(old.discount||0);
     writeMark(line,{...metadata,originalDiscount});
   }
   signatures.set(order.uuid,fingerprint(order));
   remember(order,metadata);
   return {amount,total};
 }catch(error){
   for(const [line,values] of previous)line.update(values);
   throw error;
 }finally{applying=false;}
}
function clear(order){
 assertCanChange(order);
 return updateLines(order,new Set(),0);
}
function apply(order,percent){
 validatePercent(percent);
 if(percent===0)return clear(order);
 assertCanChange(order);
 const eligible=new Set(eligibility(order).rows.filter(row=>row.allowed).map(row=>row.line));
 return updateLines(order,eligible,percent);
}
function fingerprint(order) {return JSON.stringify([order.fiscal_position_id?.id,order.pricelist_id?.id,order.lines.filter(l=>!isDiscount(l)).map(l=>[l.uuid,l.qty,l.price_unit,l.discount,l.product_id.id,l.refunded_orderline_id?.id,l.tax_ids.map(t=>t.id),read('pb-cart-unit-v1:'+location.host+':'+order.uuid+':'+l.uuid,null)])]);}
function refreshManaged() {
 if(applying)return;
 for(const order of pos.models['pos.order'].getAll()) {
   if(order.state!=='draft'||order.finalized||order.payment_ids.length)continue;
   const value=state(order);if(value?.v!==3||value.mode!=='percent')continue;
   const fp=fingerprint(order);if(signatures.get(order.uuid)===fp)continue;
   try {
     if(order.lines.some(l=>l.refunded_orderline_id||l.qty<0))continue;
     apply(order,value.percent);
   }catch(error){notice(error.message);signatures.set(order.uuid,fp);}

 }
}
function paintSummary(){
 const target=document.querySelector('.order-summary'),order=pos.getOrder(),value=order&&state(order);let node=document.getElementById('pb-native-discount-summary');
 if(!target||!value||![2,3].includes(value.v)||!value.applied){node?.remove();return;}
 if(!node){node=document.createElement('div');node.id='pb-native-discount-summary';node.className='pbnt-cart-summary';}
 const label=t('优惠合计','Descuento total')+' −'+money(value.applied);if(node.textContent!==label)node.textContent=label;if(node.parentElement!==target)target.append(node);
}
function queueRefresh() {if(applying||scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;refreshManaged();paintSummary();});}
async function open() {
 const order=pos.getOrder();if(!order)throw Error(t('请先打开订单。','Abra un pedido.'));
 const info=eligibility(order);editingOrder=order;
 const current=state(order);percentInput=current?.mode==='percent'?Number(current.percent):10;
 renderDiscount(order,info);
}
function grossAt(order,line,discount){
 const base=tax.prepare_base_line_for_taxes_computation(line,line.prepareBaseLineForTaxesComputationExtraValues({discount}));
 tax.add_tax_details_in_base_lines([base],order.company_id);tax.round_base_lines_tax_details([base],order.company_id);
 return Number(base.tax_details.raw_total_included_currency??base.tax_details.total_included_currency);
}
function renderDiscount(order,info){
 show(t('整单优惠','Descuento del pedido'),`<div class="pbnt-summary"><div class="pbnt-row"><span>${t('可优惠商品','Productos con descuento')}</span><b>${money(info.eligible)}</b></div><div class="pbnt-row pbnt-muted"><span>${t('箱价 / 批发价 · 不参与','Caja / mayoreo · excluidos')}</span><span>${money(info.boxed)}</span></div><div class="pbnt-row pbnt-muted"><span>${t('其他改价 · 不参与','Otros precios modificados')}</span><span>${money(info.other)}</span></div></div><div class="pbnt-fields"><label>${t('优惠比例 %','Descuento %')}<input data-percent type="number" min="0" max="100" step="any" value="${Number.isFinite(percentInput)?percentInput:''}"></label></div><div class="pbnt-row"><span>${t('预计优惠','Descuento estimado')}</span><span data-calculated></span></div><div class="pbnt-row pbnt-total"><span>${t('预计应收','Total estimado')}</span><strong data-total></strong></div><div class="pbnt-muted">${t('折扣直接应用到符合条件的商品行，最终金额以收银台为准。','El descuento se aplica a cada línea elegible. El total final se muestra en caja.')}</div>`,`<button data-clear>${t('清除优惠','Quitar descuento')}</button><button class="pbnt-primary" data-apply>${t('应用优惠','Aplicar descuento')}</button>`);
 modalLanguageRender=()=>renderDiscount(order,info);
 const update=()=>{
   const valid=Number.isFinite(percentInput)&&percentInput>=0&&percentInput<=100;
   let payable=order.totalDue,savings=0;
   if(valid)for(const {line,allowed,gross} of info.rows){
     if(!allowed&&!ownedMark(order,line))continue;
     const target=percentInput>0&&allowed?percentInput:originalPercent(order,line);
     const net=grossAt(order,line,target);
     payable+=net-grossAt(order,line,Number(line.discount||0));
     if(allowed&&percentInput>0)savings+=gross-net;
   }
   modal.querySelector('[data-total]').textContent=valid?money(round(payable,step())):'—';
   modal.querySelector('[data-calculated]').textContent=valid?money(round(savings,step())):'—';
   modal.querySelector('[data-apply]').disabled=!valid;
 };
 modal.querySelector('[data-percent]').oninput=e=>{percentInput=e.target.valueAsNumber;update();};
 const checkOrder=()=>{if(pos.getOrder()!==editingOrder)throw Error(t('当前订单已切换，请重新打开优惠。','El pedido cambió. Vuelva a abrir el descuento.'));};
 modal.querySelector('[data-apply]').onclick=()=>run(()=>{checkOrder();apply(order,percentInput);closeAfterSave();});
 modal.querySelector('[data-clear]').onclick=()=>run(()=>{checkOrder();clear(order);closeAfterSave();});
 function closeAfterSave(){modal.remove();modal=null;paintSummary();notice(t('已更新商品折扣。','Descuento actualizado.'));}
 update();
}
async function initialize() {
 tax=window.odoo?.loader?.modules?.get('@account/helpers/account_tax')?.accountTaxHelpers;
 if(!tax)throw Error(t('Odoo 税额计算尚未就绪','El cálculo de impuestos de Odoo aún no está listo.'));
 launch=launcher(t('优惠','Descuento'));
 for(const model of ['pos.order.line','pos.order'])for(const event of ['create','update','delete'])pos.models[model].addEventListener(event,queueRefresh);
 // Cheap fallback for direct assignments from older scripts; no DOM scans or storage enumeration.
 setInterval(()=>{if(!document.hidden)queueRefresh();},750);
 window[GLOBAL]={version:VERSION,open,applyPercent:apply,apply(order,amount,percent,mode){
   if(mode!=='percent')throw Error(t('请使用百分比优惠。','Use un descuento porcentual.'));
   return apply(order,percent);
 },clear,eligibility,refresh:refreshManaged,state};queueRefresh();
}

boot().catch(console.error);
})();

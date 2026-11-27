// ==UserScript==
// @name         Playbox Odoo - 快捷调货
// @namespace    playbox.internal.pos.transfer
// @version      0.2.16
// @description  POS 快捷调货 · Odoo Online 通用版
// @match        https://*.odoo.com/pos/*
// @match        https://*.odoo.com/odoo
// @match        https://*.odoo.com/odoo/*
// @match        https://*.odoo.com/web
// @noframes
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(() => {
'use strict';
const KIND='transfer', GLOBAL='PBQuickTransfer';
/* Shared source copied into each independent userscript at build time. */
const VERSION = '0.2.16';
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
const backendPage = /^\/(odoo|web)(?:\/|$)/.test(location.pathname);
function requestedCompany() {
 const raw=document.cookie.match(/(?:^|;\s*)cids=([^;]*)/)?.[1];
 return raw ? Number(decodeURIComponent(raw).split(/[-,]/)[0]) : 0;
}
async function backendContext() {
 const response=await fetch('/web/session/get_session_info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:'call',params:{}}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error(t('读取当前公司失败，请刷新页面。','No se pudo cargar la compañía. Actualice la página.'));
 const {result}=await response.json();
 if(!result?.uid)return null;
 const companies=result.user_companies, id=requestedCompany()||Number(companies?.current_company);
 if(!id||!Object.hasOwn(companies?.allowed_companies||{},id))throw Error(t('请重新选择公司并刷新。','Seleccione la compañía y actualice.'));
 return {company:{id},config:{id:'backend-'+result.uid},backend:true};
}
const rpc = async (model, method, args = [], kwargs = {}) => {
  if(pos?.backend && requestedCompany() && requestedCompany()!==pos.company.id)throw Error(t('公司已切换，请刷新后再调货。','Cambió la compañía. Actualice antes del traslado.'));
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
function windowSizeKey() {
    const orientation = matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait';
    return 'playbox:transfer:window:v1:' + orientation;
}
function windowSizePreferences() {
    try { return JSON.parse(localStorage.getItem(windowSizeKey())) || {}; }
    catch { return {}; }
}
function windowSizeDefault() {
    return matchMedia('(orientation: portrait)').matches ? [98, 92] : [94, 92];
}
function windowSizeApply(panel) {
    if (!panel?.isConnected) return;
    const viewport = window.visualViewport;
    const available = [viewport?.width || innerWidth, viewport?.height || innerHeight];
    const prefs = windowSizePreferences(), defaults = windowSizeDefault();
    ['width','height'].forEach((axis, i) => {
        const fraction = Number(prefs[axis]);
        const percent = fraction >= 60 && fraction <= 100 ? fraction : defaults[i];
        const room = Math.max(1, available[i] - 16);
        const minimum = i ? 300 : 380;
        const px = Math.min(room, Math.max(minimum, Math.round(room * percent / 100)));
        panel.style.setProperty(axis, px + 'px','important');
        panel.style.setProperty('max-'+axis, room + 'px','important');
        const control = panel.querySelector('[data-window-axis="'+axis+'"]');
        if (control) {control.value = percent; control.nextElementSibling.textContent = percent + '%';}
    });
}
function mountWindowSize(panel, header) {
    if (!panel || !header) return;
    const menu = document.createElement('details');
    menu.className='pb-window-size';
    const title=document.createElement('summary');
    title.textContent=t('大小','Tamaño');menu.append(title);
    const form=document.createElement('div');
    menu.append(form);
    ['width','height'].forEach((axis,i)=>{
        const label=document.createElement('label'), slider=document.createElement('input'), output=document.createElement('output');
        label.append(i?t('高度','Alto'):t('宽度','Ancho'));
        slider.type='range';slider.min='60';slider.max='100';slider.step='1';slider.dataset.windowAxis=axis;
        label.append(slider,output);form.append(label);
        slider.oninput=()=>{
            const prefs=windowSizePreferences();prefs[axis]=Number(slider.value);
            localStorage.setItem(windowSizeKey(),JSON.stringify(prefs));windowSizeApply(panel);
        };
    });
    const reset=document.createElement('button');reset.type='button';reset.textContent=t('恢复默认','Restablecer');
    reset.onclick=()=>{localStorage.removeItem(windowSizeKey());windowSizeApply(panel);};form.append(reset);
    header.before(menu);windowSizeApply(panel);
}


function fitTransferWindow(){
 const panel=modal?.querySelector('.pbnt-dialog');
 if(!panel?.isConnected)return;
 const viewport=window.visualViewport;
 Object.assign(modal.style,{inset:'auto',left:(viewport?.offsetLeft||0)+'px',top:(viewport?.offsetTop||0)+'px',width:(viewport?.width||innerWidth)+'px',height:(viewport?.height||innerHeight)+'px',padding:'8px',boxSizing:'border-box'});
 windowSizeApply(panel);
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
  document.body.append(modal);
  mountWindowSize(modal.querySelector('.pbnt-dialog'),modal.querySelector('[data-lang]'));
  fitTransferWindow();modal.querySelector('input,button')?.focus();return modal;
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
/* Explicit emoji fonts also apply inside editable controls and saved route buttons. */
#pb-transfer-modal [data-name],#pb-transfer-modal [data-route],#pb-transfer-modal [data-edit],#pb-transfer-modal [data-name-symbol]{font-family:"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji","Segoe UI Symbol",system-ui,-apple-system,"Segoe UI","Noto Sans SC",sans-serif}
#pb-transfer-modal .pbqt-name-symbols{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:8px}
#pb-transfer-modal [data-name-symbol]{min-width:36px;padding:5px 8px;font-size:16px;line-height:1.5}
/* State controls inherit the dialog's typography and teal selection palette. */
#pb-transfer-modal .pbqt-order-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;margin-top:12px;font-size:12px;color:#647585}
#pb-transfer-modal .pbqt-current-state{display:flex;align-items:center;gap:6px}
#pb-transfer-modal .pbqt-order-meta a{margin-left:auto}
#pb-transfer-modal .pbqt-status{display:inline-flex;align-items:center;min-height:24px;padding:2px 8px;border:1px solid #dce3e7;border-radius:6px;background:#f4f6f8;color:#526572;font-size:12px;line-height:1.5;font-weight:600;white-space:nowrap}
#pb-transfer-modal .pbqt-status[data-status="assigned"]{border-color:#c5dcd6;background:#edf5f3;color:#245c54}
#pb-transfer-modal .pbqt-footer-meta{margin-right:auto;align-self:center}
#pb-transfer-modal .pbqt-state-panel{flex:0 1 420px;min-width:0;max-width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:6px 8px}
#pb-transfer-modal .pbqt-state-action{display:flex;flex-direction:column;align-items:stretch;gap:6px;margin:0;min-width:0;font-size:13px;font-weight:400;color:#526572}
#pb-transfer-modal [data-target-state]{display:block;width:100%;height:37px;margin:0;padding:7px 9px;border:1px solid #bec9d3;border-radius:6px;background:#fff;color:#243340;font:14px/1.5 system-ui,-apple-system,"Segoe UI","Noto Sans SC",sans-serif}
#pb-transfer-modal [data-apply-state]{height:37px;font-size:14px;line-height:1.5;margin:0}
#pb-transfer-modal .pbqt-state-help{grid-column:1/-1;margin:0;text-align:left;overflow-wrap:anywhere;font-size:12px;line-height:1.5}
#pb-transfer-modal .pbqt-pending-tabs{gap:6px;margin-bottom:0;padding-bottom:12px}
#pb-transfer-modal [data-pending-filter]{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:37px;padding:7px 12px;border-color:transparent;background:transparent;color:#5d6a76;font:inherit;font-weight:400}
#pb-transfer-modal [data-pending-filter]:hover{background:#f0f7f5;border-color:#dce3e7}
#pb-transfer-modal [data-pending-filter].pbnt-selected{background:#edf5f3;border-color:#c5dcd6;color:#245c54;font-weight:650}
#pb-transfer-modal .pbqt-filter-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;padding:0 5px;border-radius:5px;background:#f0f3f5;color:#647585;font-size:12px;line-height:20px;font-weight:400;font-variant-numeric:tabular-nums}
#pb-transfer-modal .pbnt-selected .pbqt-filter-count{background:#dcece7;color:#245c54}
#pb-transfer-modal .pbqt-pending-row{display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid #e3e7ec}
#pb-transfer-modal .pbqt-pending-info{flex:1;min-width:0;overflow-wrap:anywhere}
#pb-transfer-modal .pbqt-pending-info>b{font-size:14px;color:#243340;font-weight:650}
#pb-transfer-modal .pbqt-pending-info .pbnt-muted{margin-top:3px;white-space:normal}
#pb-transfer-modal .pbqt-pending-actions{display:flex;align-items:center;flex-wrap:wrap;justify-content:flex-end;gap:10px;flex-shrink:0}
@media(max-width:600px){
 #pb-transfer-modal .pbqt-route-tabs{flex-basis:100%}
 #pb-transfer-modal .pbqt-actions{flex-basis:100%;justify-content:flex-end}
 #pb-transfer-modal .pbqt-footer-meta{flex-basis:100%}
 #pb-transfer-modal .pbqt-state-panel{flex-basis:100%}
 #pb-transfer-modal .pbqt-pending-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
 #pb-transfer-modal [data-pending-filter]{justify-content:space-between;min-width:0}
 #pb-transfer-modal .pbqt-pending-row{align-items:flex-start;gap:10px}
 #pb-transfer-modal .pbqt-pending-actions{flex-direction:column;align-items:flex-end;gap:6px}
}
/* Main and secondary screens use the same dialog, toolbar and form controls. */
.pbnt-dialog .pbqt-route-tabs{display:flex;flex-wrap:wrap;gap:6px;flex:1;min-width:0}
.pbnt-dialog .pbqt-route-tabs button{white-space:normal;text-align:left}
.pbnt-dialog .pbqt-actions{display:flex;flex-wrap:wrap;gap:6px}
.pbnt-dialog .pbqt-searchbar{display:flex;align-items:center;flex-wrap:wrap;gap:12px}
.pbnt-dialog .pbqt-searchbar input{flex:1;min-width:min(240px,100%)}
.pbnt-dialog .pbqt-record{margin-top:10px}
.pbnt-dialog .pbqt-table-scroll{overflow:auto}
.pbnt-dialog .pbqt-table{min-width:760px}
.pbnt-dialog .pbqt-table td:nth-child(2),.pbnt-dialog .pbqt-table th:nth-child(2){text-align:left;white-space:normal;font-size:inherit;font-weight:inherit;color:inherit}
.pbnt-dialog .pbqt-table td:nth-child(3){white-space:normal}
.pbnt-dialog .pbqt-product{max-width:260px;overflow-wrap:anywhere}
.pbnt-dialog .pbqt-product-title>span{margin-left:4px}
.pbnt-dialog .pbqt-product-name,.pbnt-dialog .pbqt-conversion,.pbnt-dialog [data-stock]>small{display:block;font-size:12px;line-height:1.5;color:#647585;margin-top:4px}
.pbnt-dialog .pbqt-category td{background:#f4f6f8;color:#667781;font-size:12px;font-weight:600}
.pbnt-dialog .pbqt-category small{float:right;font:inherit}
.pbnt-dialog .pbqt-stock{color:#235a57}
.pbnt-dialog .pbqt-short,.pbnt-dialog .pbqt-short-text{color:#b13723}
.pbnt-dialog .pbqt-stepper{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.pbnt-dialog .pbqt-stepper input{font-weight:400}
.pbnt-dialog .pbqt-units{display:inline-flex;gap:4px}
.pbnt-dialog .pbqt-units button[aria-pressed="true"]{background:#edf5f3;border-color:#c5dcd6;color:#245c54;font-weight:650}
.pbnt-dialog .pbqt-stepper select{margin:0}
.pbnt-dialog .pbqt-remove{font-size:14px;font-weight:400}

`;
 style.textContent += `@media (pointer: coarse) and (orientation: landscape) and (min-width: 800px) {
#pb-transfer-modal[data-view="main"] .pbnt-dialog{width:min(1248px,94vw)!important;max-width:94vw!important;height:min(832px,90vh)!important;box-shadow:0 14px 55px #22334b28}
#pb-transfer-modal[data-view="main"] main{flex:1;min-height:0}#pb-transfer-modal[data-view="main"] th{background:#eaf0f6} #pb-transfer-modal[data-view="main"] td{padding-block:8px} #pb-transfer-modal[data-view="main"] .pbqt-category td{background:#f0f4f8}
}`;
 style.textContent+=`
#pb-transfer-modal .pb-window-size{position:relative;flex:0 0 auto;margin:0}
#pb-transfer-modal .pb-window-size summary{cursor:pointer;list-style:none;font:inherit;border:1px solid #c4d0d6;border-radius:6px;padding:6px 10px;background:white;color:#29444a}
#pb-transfer-modal .pb-window-size>div{position:absolute;z-index:40;right:0;top:calc(100% + 4px);width:min(238px,60vw);box-sizing:border-box;background:white;border:1px solid #cbd7db;border-radius:8px;padding:10px;box-shadow:0 6px 20px #162e3529}
#pb-transfer-modal .pb-window-size label{display:grid!important;grid-template-columns:auto minmax(50px,1fr) 38px;gap:6px;align-items:center;font-size:13px;margin:6px 0}
#pb-transfer-modal .pb-window-size input[type=range]{width:100%;min-width:0;height:32px;accent-color:#295e60;margin:0;padding:0}
#pb-transfer-modal .pb-window-size output{text-align:right;font-variant-numeric:tabular-nums}
`;
 style.textContent+='body:has(#pb-transfer-modal) #pbful-launch{visibility:hidden!important;pointer-events:none!important}';
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
 if(backendPage){
   pos=await backendContext();if(!pos)return;
 }else{
 for(let i=0;i<180;i++) {pos=window.posmodel||window.odoo?.__WOWL_DEBUG__?.root?.env?.services?.pos;if(pos?.models?.['pos.order']&&pos.config&&pos.company)break;await new Promise(r=>setTimeout(r,1000));}
 if(!pos?.models?.['pos.order']){notice(t('POS 尚未就绪，请重新打开页面。','El POS aún no está listo. Recargue la página.'));return;}
 }
 installStyle();installLanguageSync();await initialize();updateLanguageLauncher();
 } finally {delete window[GLOBAL+'Booting'];}
}

let launch, routes=[], types=[], locations=[], draft, pending=[], lastSearch=0;
const clone=x=>JSON.parse(JSON.stringify(x));
const pickingFields=['id','name','state','origin','picking_type_id','partner_id','location_id','location_dest_id','move_ids','write_date'];
const newDraft=()=>({uuid:crypto.randomUUID(),route:routes[0]?clone(routes[0]):null,lines:[],id:null,phase:'local'});
const persist=()=>save(key('draft'),draft);
function indices(){return read(key('records'),[]);}
function track(id){save(key('records'),[...new Set([...indices(),id])]);}
let cancelledRecords=[];
function cancelledIds(){return read(key('cancelledRecords'),[]);}
function rememberCancellation(id){
 save(key('cancelledRecords'),[id,...cancelledIds().filter(value=>value!==id)].slice(0,500));
}
const terminalState=state=>state==='done'||state==='cancel';
const stateLabel=state=>({local:t('未保存','Sin guardar'),draft:t('草稿','Borrador'),creating:t('创建结果待核对','Creación por verificar'),confirmed:t('等待预留','En espera de reserva'),waiting:t('等待前序作业','En espera de otra operación'),assigned:t('就绪','Listo'),done:t('已完成','Hecho'),cancel:t('已取消','Cancelado')})[state]||state;
function clearFinishedDraft(record){
 if(!draft?.id||draft.id!==record?.id||!terminalState(record.state))return false;
 if(record.state==='cancel')rememberCancellation(record.id);
 save(key('records'),indices().filter(id=>id!==record.id));pending=pending.filter(p=>p.id!==record.id);
 draft=newDraft();persist();
 notice(t('调货单','Traslado ')+(record.name||'#'+record.id)+' · '+stateLabel(record.state)+t('，已清除当前草稿，可以新建。','. Se limpió el borrador actual; puede crear otro.'));
 return true;
}
async function syncActiveDraft(background=false){
 const current=draft;if(!current?.id)return {changed:false,cleared:false};
 const [record]=await rpc('stock.picking','read',[[current.id],pickingFields]);
 // A late background response must not replace a different order or an active submission.
 if(draft!==current||(background&&busy))return {changed:false,cleared:false};
 if(!record)throw Error(t('无法读取当前调货单，草稿已保留，请在后台核对。','No se pudo leer el traslado. Se conservó el borrador; revíselo en Inventario.'));
 if(clearFinishedDraft(record))return {changed:true,cleared:true};
 const changed=draft.phase!==record.state;
 if(changed){draft.phase=record.state;persist();}
 return {changed,cleared:false,record};
}
let refreshing=false,lastRefresh=0;
async function refreshBackground(){
 if(document.hidden||busy||refreshing||Date.now()-lastRefresh<5000)return;
 refreshing=true;lastRefresh=Date.now();const view=modal;
 try{
   const result=await syncActiveDraft(true);
   if(result.changed&&!busy&&modal===view&&view?.dataset.view==='main')await run(open);
   await refreshPending();
   if(!result.changed && view && view===modal && !busy)await view.refreshVisibleStock?.(result.record);
 }catch(error){console.warn(ROOT,'Status refresh failed; draft retained.',error);}
 finally{refreshing=false;}
}
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
   const own=ownWarehouse && types.find(x=>idOf(x.warehouse_id)===ownWarehouse);
   const source=own?.default_location_src_id,destination=own?.default_location_dest_id;
   const reverse=own && types.find(x=>idOf(x.default_location_src_id)===idOf(destination)&&idOf(x.default_location_dest_id)===idOf(source));
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
function reservableState(state){
 return ['assigned','confirmed','partially_available'].includes(state);
}
function readySnapshot(record,moves){
 return JSON.stringify([record.id,idOf(record.picking_type_id),idOf(record.location_id),idOf(record.location_dest_id),
   moves.map(m=>[m.id,idOf(m.product_id),m.product_uom_qty,idOf(m.product_uom),idOf(m.location_id),idOf(m.location_dest_id)]).sort((a,b)=>a[0]-b[0])]);
}
function checkReadyBaseline(record,moves){
 if(!draft.readyBaseline || readySnapshot(record,moves)!==draft.readyBaseline || moves.some(m=>m.picked||terminalState(m.state)) || new Set(moves.map(m=>idOf(m.product_id))).size!==moves.length)
   throw Error(t('后台明细已变化或已拣取。请重新读取原单后核对。','Cambió el traslado o hay líneas recogidas. Vuelva a leer el original.'));
}
async function writeReadyChanges(record){
 const moves=await readMoves(record);
 checkReadyBaseline(record,moves);
 const remaining=new Map(moves.map(m=>[idOf(m.product_id),m]));
 const commands=[];
 for(const line of draft.lines){
   const existing=remaining.get(line.id);
   if(!existing)commands.push([0,0,moveValues(line)]);
   else if(Math.abs(pieces(line)-existing.product_uom_qty)>1e-6)commands.push([1,existing.id,{product_uom_qty:pieces(line)}]);
   remaining.delete(line.id);
 }
 for(const move of remaining.values())commands.push([2,move.id,0]);
 if(commands.length)await rpc('stock.picking','write',[[record.id],{move_ids:commands}]);
}
async function savePicking(checked=false) {
 if(!checked)await checkDraft();const previousId=draft.id;let record=await recover();
 if(record&&clearFinishedDraft(record)){await open();throw Error(t('这张调货单已结束，已清除当前草稿；未再次提交。','Este traslado terminó. Se limpió el borrador sin volver a enviarlo.'));}
 if(previousId&&!record)throw Error(t('原单据来源已变化，已停止提交；请在后台核对，避免重复建单。','Cambió la referencia del traslado. Revíselo en Inventario para evitar duplicados.'));
 if(record&&!previousId){draft.dirty=false;draft.writeDate=record.write_date;persist();throw Error(t('已找到之前创建的单据，请从待处理中打开核对。不会重复新建。','Se encontró el traslado anterior. Ábralo desde Pendientes para revisarlo.'));}
 const route=draft.route,values={picking_type_id:route.type,partner_id:route.contact||false,location_id:route.source,location_dest_id:route.destination,origin:'PB-QT:'+draft.uuid,company_id:pos.company.id};
 if(record) {
   if(['done','cancel'].includes(record.state))throw Error(t('这张调拨单已完成或取消，不会再次调货。请点新建。','Este traslado ya terminó. Cree uno nuevo si es necesario.'));
   if(record.state!=='draft'){
     if(!draft.dirty)return record;
     if(!reservableState(record.state))throw Error(t('请在后台核对当前状态。','Revise el estado en Inventario.'));
     await writeReadyChanges(record);
     [record]=await rpc('stock.picking','read',[[record.id],pickingFields]);
     await checkedMoves(record);
     draft.dirty=false;draft.phase=record.state;draft.writeDate=record.write_date;delete draft.readyBaseline;persist();
     return record;
   }
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
const readMoves=record=>rpc('stock.move','read',[record.move_ids,['id','product_id','product_uom_qty','product_uom','location_id','location_dest_id','state','quantity','picked']]);
function includeOwnReservations(qty,moves){
 qty.reserved={};
 for(const move of moves){
   const id=idOf(move.product_id),line=draft.lines.find(l=>l.id===id);
   if(!line||move.picked||terminalState(move.state)||idOf(move.product_uom)!==line.base||idOf(move.location_id)!==draft.route.source||idOf(move.location_dest_id)!==draft.route.destination)continue;
   const reserved=Math.max(0,Math.min(Number(move.quantity)||0,Number(move.product_uom_qty)));
   qty[id]=(qty[id]||0)+reserved;qty.reserved[id]=(qty.reserved[id]||0)+reserved;
 }
}
async function checkedMoves(record){
 const moves=await readMoves(record);
 const expected=new Map(draft.lines.map(x=>[x.id,{quantity:pieces(x),unit:x.base}]));
 if(moves.length!==expected.size||moves.some(m=>terminalState(m.state)||!expected.has(idOf(m.product_id))||Math.abs(m.product_uom_qty-expected.get(idOf(m.product_id)).quantity)>1e-6||idOf(m.product_uom)!==expected.get(idOf(m.product_id)).unit||idOf(m.location_id)!==draft.route.source||idOf(m.location_dest_id)!==draft.route.destination))throw Error(t('后台商品或路线有变化，已停止操作。请从待处理中重新打开核对。','Los productos o la ruta cambiaron. Abra el traslado desde Pendientes para revisarlo.'));
 return moves;
}
async function reservePicking(){
 if(!navigator.locks)throw Error(t('浏览器不支持防重复提交，请更新浏览器。','Actualice el navegador para evitar duplicados.'));
 await navigator.locks.request(key('submit'),{ifAvailable:true},async lock=>{
   if(!lock)throw Error(t('另一窗口正在提交，请稍候查看。','Otro tab está procesando el traslado. Espere.'));
   if((await syncActiveDraft()).cleared){await open();return;}
   let record=await savePicking();
   await checkedMoves(record);
   // Odoo confirms draft moves and reserves stock. This never validates the transfer.
   await rpc('stock.picking','action_assign',[[record.id]]);
   const result=await syncActiveDraft();
   if(result.cleared){await refreshPending();await open();return;}
   record=result.record;const moves=await checkedMoves(record);
   const full=moves.length>0&&moves.every(m=>m.state==='assigned'&&Number(m.quantity)>=Number(m.product_uom_qty)-1e-6);
   draft.writeDate=record.write_date;draft.dirty=false;persist();
   await refreshPending();await open();
   notice(record.name+' · '+stateLabel(record.state)+' · '+(full?t('已全部预留，尚未完成调拨。','Reserva completa; traslado aún sin validar.'):t('尚未全部预留，请检查库存或前序作业；可再次点击预留。','Reserva incompleta. Revise existencias u operaciones previas y vuelva a reservar.')));
 });
}
async function commit(confirmShortage=false) {
 if(!navigator.locks)throw Error(t('浏览器不支持防重复提交，请更新浏览器。','Actualice el navegador para evitar duplicados.'));
 return navigator.locks.request(key('submit'),{ifAvailable:true},async lock=>{
   if(!lock)throw Error(t('另一窗口正在提交这张调拨，请稍候查看。','Otro tab está procesando este traslado.'));
   const current=await syncActiveDraft();if(current.cleared)throw Error(t('原调货单已结束，当前草稿已清除。','El traslado terminó y se limpió el borrador.'));
   await checkDraft();
   const qty=await available(draft.lines.map(x=>x.id),draft.route.source);
   // Free stock excludes this order's own reservation; include it for the shortage check.
   if(current.record&&current.record.state!=='draft'){
     const moves = draft.dirty ? await readMoves(current.record) : await checkedMoves(current.record);
     if(draft.dirty)checkReadyBaseline(current.record,moves);
     includeOwnReservations(qty,moves);
   }
   const totals={};draft.lines.forEach(x=>totals[x.id]=(totals[x.id]||0)+pieces(x));
   const shortages=draft.lines.filter(x=>qty[x.id]<totals[x.id]);
   if(shortages.length&&!confirmShortage)return {shortages:shortages.map(x=>({name:x.display_name,available:qty[x.id],needed:totals[x.id]}))};
   let record=await savePicking(true);
   if(record.state==='draft')await rpc('stock.picking','action_confirm',[[record.id]]);
   [record]=await rpc('stock.picking','read',[[record.id],pickingFields]);
   if(record.state==='done')return record;
   if(record.state==='cancel')throw Error(t('这张单已取消。','Este traslado fue cancelado.'));
   const moves=await checkedMoves(record);
   for(const move of moves)await rpc('stock.move','write',[[move.id],{quantity:move.product_uom_qty,picked:true}]);
   const result=await rpc('stock.picking','button_validate',[[record.id]]);
   [record]=await rpc('stock.picking','read',[[record.id],pickingFields]);draft.phase=record.state;persist();
   if(record.state!=='done')throw Error(t('Odoo 还需要确认其他信息，请在后台打开此单继续。单据已保留，不会重复创建。','Odoo requiere información adicional. Abra el traslado en Inventario; no se creará otro.'));
   return record;
 });
}
function showShortages(result){
 const message=result.shortages.map(x=>esc(x.name)+' · '+t('可用 ','Disponible ')+x.available+' / '+t('需调 ','Necesario ')+x.needed).join('<br>');show(t('来源库存不足','Existencias insuficientes'),`<p>${t('实物已搬好，可以继续记账；否则请返回核对。','Si ya movió la mercancía, puede continuar; de lo contrario, revise.')}</p><div class="pbnt-summary">${message}</div>`,`<button data-back>${t('返回核对','Volver')}</button><button class="pbnt-primary" data-force>${t('仍然调拨','Continuar traslado')}</button>`);modal.querySelector('[data-back]').onclick=()=>run(open);modal.querySelector('[data-force]').onclick=()=>run(()=>submit(true,true));
 modalLanguageRender=()=>showShortages(result);
}
async function submit(finish,force=false) {
 if((await syncActiveDraft()).cleared){await refreshPending();await open();return;}
 if(finish) {
   const result=await commit(force);
   if(result.shortages){showShortages(result);return;}
   notice(t('调拨已完成：','Traslado completado: ')+result.name);draft=newDraft();persist();
 }else{
   await navigator.locks.request(key('submit'),{ifAvailable:true},async lock=>{if(!lock)throw Error(t('另一窗口正在提交，请稍候查看。','Otro tab está guardando. Espere.'));const result=await savePicking();notice(t('已保存待处理：','Guardado pendiente: ')+result.name);});
 }
 await refreshPending();await open();
}
async function addProduct(product) {
 if(!['local','draft'].includes(draft.phase)&&!(reservableState(draft.phase)&&draft.readyBaseline))throw Error(t('请先核对上次提交状态，再修改商品。','Revise el estado anterior antes de modificar productos.'));
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
function sourceCell(line,available,reserved=0){
 const {size,box}=quantityUnits(line),known=Number.isFinite(available),needed=pieces(line);
 const shortage=known&&Number.isFinite(needed)&&needed>available;
 const full=known&&size?Math.floor(Math.max(0,available)/size):null;
 const count=known?t('可用 ','Disponible ')+quantityText(available)+' '+t('件','uds'):'—';
 const supply=full===null?t('箱规待核对','Caja por verificar'):full===0&&Number(line.unit)===box?.id?t('不足 1 箱','Menos de 1 caja'):t('可供 '+full+' 箱',full+(full===1?' caja':' cajas'));
 return `<span class="pbqt-stock ${shortage?'pbqt-short':''}">${esc(count+' · '+supply)}</span><small>${size?esc(t(quantityText(size)+' 件 / 箱',quantityText(size)+' uds / caja')):esc(t('按实际单位调拨','Traslado en unidad seleccionada'))}${reserved>0?esc(t(' · 含本单预留 '+quantityText(reserved)+' 件',' · Incluye reserva propia: '+quantityText(reserved)+' uds')):''}</small>`;
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
 return `<div class="pbqt-table-scroll"><table class="pbqt-table"><thead><tr><th>${t('商品','Producto')}</th><th>${esc(sourceCaption())} ${t('可用','disponible')}</th><th>${t('调货数量','Cantidad a mover')}</th><th></th></tr></thead><tbody>${[...groups].map(([name,items])=>`<tr class="pbqt-category"><td colspan="4"><span>${esc(name)}</span><small>${items.length} ${t('种','productos')}</small></td></tr>${items.map(({line:l,index:i})=>`<tr data-transfer-product="${esc(l.id)}"><td class="pbqt-product">${productCell(l)}</td><td data-stock="${i}">${sourceCell(l,qty[l.id],qty.reserved?.[l.id]||0)}</td><td>${quantityCell(l,i,qty[l.id])}</td><td><button class="pbqt-remove" data-remove="${i}" aria-label="${t('移除','Quitar')} ${esc(l.default_code)}">×</button></td></tr>`).join('')}`).join('')}</tbody></table></div>`;
}
function updateQuantityRow(index,qty){
 const line=draft.lines[index],available=qty[line.id],input=modal.querySelector(`[data-qty="${index}"]`);
 if(input)input.value=line.quantity;
 modal.querySelector(`[data-stock="${index}"]`).innerHTML=sourceCell(line,available,qty.reserved?.[line.id]||0);
 const conversion=modal.querySelector(`[data-conversion="${index}"]`);conversion.textContent=conversionText(line,available);conversion.classList.toggle('pbqt-short-text',available<pieces(line));
 const minus=modal.querySelector(`[data-step="${index}"][data-delta="-1"]`);minus.disabled=!Number.isFinite(Number(line.quantity))||Number(line.quantity)<=1;
 modal.querySelectorAll(`[data-unit-button="${index}"]`).forEach(el=>el.setAttribute('aria-pressed',String(Number(el.dataset.unitId)===Number(line.unit))));
}
async function refreshVisibleStock(qty,record){
 const view=modal,order=draft,source=order?.route?.source,ids=order?.lines.map(line=>line.id);
 if(!source || !ids?.length)return;
 const [fresh,moves]=await Promise.all([available(ids,source),record && record.state!=='draft'?readMoves(record):[]]);
 if(view!==modal || order!==draft || busy || document.hidden || source!==draft.route?.source ||
    ids.length!==draft.lines.length || ids.some((id,i)=>id!==draft.lines[i].id))return;
 includeOwnReservations(fresh,moves);
 const oldReserved=qty.reserved||{};
 const reserved=fresh.reserved;
 qty.reserved=reserved;
 draft.lines.forEach((line,index)=>{
   const id=line.id;
   if(qty[id]===fresh[id] && (oldReserved[id]||0)===(reserved[id]||0))return;
   qty[id]=fresh[id];
   view.querySelector(`[data-stock="${index}"]`).innerHTML=sourceCell(line,fresh[id],reserved[id]||0);
   const conversion=view.querySelector(`[data-conversion="${index}"]`);
   conversion.textContent=conversionText(line,fresh[id]);
   conversion.classList.toggle('pbqt-short-text',fresh[id]<pieces(line));
 });
}
async function open() {
 if(!types.length)await loadRoutes();if(!draft)draft=read(key('draft'),null)||newDraft();
 const current=await syncActiveDraft();
 const qty=draft.route?await available(draft.lines.map(x=>x.id),draft.route.source):{};
 if(current.record&&current.record.state!=='draft'){
   const moves=await readMoves(current.record);
   includeOwnReservations(qty,moves);
   if(!draft.dirty){
     const matches=moves.length===draft.lines.length && moves.every(m=>draft.lines.some(l=>l.id===idOf(m.product_id)&&l.base===idOf(m.product_uom)&&Math.abs(pieces(l)-m.product_uom_qty)<1e-6));
     const consistent=matches && moves.every(m=>!m.picked&&!terminalState(m.state)&&idOf(m.location_id)===draft.route.source&&idOf(m.location_dest_id)===draft.route.destination) && idOf(current.record.picking_type_id)===draft.route.type && idOf(current.record.location_id)===draft.route.source && idOf(current.record.location_dest_id)===draft.route.destination;
     draft.readyBaseline=consistent?readySnapshot(current.record,moves):null;persist();
   }
 }
 renderTransfer(qty);
}
function captureTransferScroll(){
 if(!modal || modal.dataset.draftKey!==String(draft.uuid || draft.id))return null;
 const main=modal.querySelector('main'),table=modal.querySelector('.pbqt-table-scroll');
 if(!table)return null;
 const top=Math.max(table.getBoundingClientRect().top,main.getBoundingClientRect().top);
 const row=(main.scrollTop || table.scrollTop) && [...table.querySelectorAll('[data-transfer-product]')].find(el=>el.getBoundingClientRect().bottom>top);
 return {main:main.scrollTop,table:table.scrollTop,left:table.scrollLeft,id:row ? row.dataset.transferProduct : null,offset:row?row.getBoundingClientRect().top-top:0};
}
function restoreTransferScroll(saved){
 if(!saved)return;
 const main=modal.querySelector('main'),table=modal.querySelector('.pbqt-table-scroll');
 if(!table)return;
 main.scrollTop=saved.main;table.scrollTop=saved.table;table.scrollLeft=saved.left;
 const row=saved.id && table.querySelector('[data-transfer-product="'+CSS.escape(saved.id)+'"]');
 if(row){
   const top=Math.max(table.getBoundingClientRect().top,main.getBoundingClientRect().top);
   const scroller=table.scrollHeight>table.clientHeight+1?table:main;
   scroller.scrollTop+=row.getBoundingClientRect().top-top-saved.offset;
 }
}
function renderTransfer(qty){
 const savedScroll=captureTransferScroll();
 const routeEditable=['local','draft'].includes(draft.phase);
 const editable=routeEditable||Boolean(reservableState(draft.phase)&&draft.readyBaseline);
 show(t('快捷调货','Traslado rápido'),`<div class="pbnt-toolbar"><div class="pbqt-route-tabs" role="group" aria-label="${t('调货路线','Rutas de traslado')}">${routes.map((r,i)=>`<button class="${draft.route?.uuid===r.uuid?'pbnt-selected':''}" data-route="${i}" aria-pressed="${draft.route?.uuid===r.uuid}" ${!routeEditable?'disabled':''}>${esc(r.name)}</button>`).join('')}</div><div class="pbqt-actions"><button data-routes>${t('管理收藏','Rutas favoritas')}</button><button data-pending>${t('待处理','Pendientes')} ${pending.length}</button><button class="pbnt-primary" data-new>${t('新建','Nuevo')}</button></div></div><div class="pbqt-searchbar"><input data-search placeholder="${t('搜索型号 / 商品名，再选择颜色','Buscar modelo / nombre y elegir color')}" ${!editable?'disabled':''}><span class="pbnt-muted">${t('联系人：','Contacto: ')}${esc(draft.route?.contactName||t('未指定','Sin asignar'))}</span></div><div class="pbqt-order-meta"><span class="pbqt-current-state" data-state>${t('当前状态','Estado actual')}<span class="pbqt-status" data-status="${esc(draft.phase)}">${esc(stateLabel(draft.phase))}</span></span>${draft.id?`<a href="/odoo/action-stock.action_picking_tree_all/${draft.id}" target="_blank" rel="noopener">${t('打开后台单据','Abrir en Inventario')} #${draft.id}</a>`:''}</div><div class="pbnt-search-results" data-results></div>${draft.lines.length?productTable(qty):`<div class="pbnt-empty">${t('选好路线，搜索并添加要调的颜色商品。','Elija una ruta y añada los productos por color.')}</div>`}`,`<span class="pbnt-muted pbqt-footer-meta">${t('当前电脑 · ','Este equipo · ')}${draft.lines.length}${t(' 种商品',' productos')}</span><div class="pbqt-state-panel"><label class="pbqt-state-action">${t('切换到','Cambiar a')}<select data-target-state aria-describedby="pb-transfer-state-help" aria-label="${t('目标状态','Estado de destino')}"><option value="draft" ${!routeEditable?'disabled':''}>${t('草稿（保存待处理）','Borrador (guardar)')}</option><option value="assigned" selected>${t('就绪（预留库存）','Listo (reservar existencias)')}</option><option value="done">${t('已完成（确认调拨）','Hecho (validar traslado)')}</option><option value="cancel">${t('取消这张单','Cancelar traslado')}</option></select></label><button class="pbnt-primary" data-apply-state>${t('应用状态','Aplicar estado')}</button><div id="pb-transfer-state-help" class="pbnt-muted pbqt-state-help" data-state-help></div></div>`,true);
 if(reservableState(draft.phase)){
   const reload=document.createElement('button');reload.textContent=t('重新读取原单','Recargar original');
   modal.querySelector('.pbqt-order-meta').append(reload);
   reload.onclick=()=>run(async()=>{
     if(draft.dirty&&!confirm(t('放弃本机尚未保存的修改，重新读取这张调货单？','¿Descartar los cambios locales y recargar este traslado?')))return;
     await resume({id:draft.id},true);
   });
 }
 modal.dataset.view='main';modal.dataset.draftKey=String(draft.uuid || draft.id);modalLanguageRender=()=>renderTransfer(qty);
 modal.refreshVisibleStock=record=>refreshVisibleStock(qty,record);
 let timer;modal.querySelector('[data-search]').oninput=e=>{clearTimeout(timer);const text=e.target.value,target=modal.querySelector('[data-results]');timer=setTimeout(()=>search(text,target).catch(e=>notice(e.message)),250);};
 modal.querySelector('[data-routes]').onclick=()=>run(manageRoutes);modal.querySelector('[data-pending]').onclick=()=>run(showPending);
 modal.querySelector('[data-new]').onclick=()=>run(async()=>{await syncActiveDraft();if(draft.lines.length&&(!draft.id||draft.dirty))throw Error(t('当前还有未保存商品，请先保存待处理或移除商品。','Guarde los productos actuales antes de crear otro traslado.'));draft=newDraft();persist();await open();});
 modal.querySelectorAll('[data-route]').forEach(el=>el.onclick=()=>run(async()=>{if(!routeEditable)throw Error(t('这张单已确认，请在后台修改路线。','Cambie esta ruta en Inventario.'));draft.route=clone(routes[Number(el.dataset.route)]);draft.dirty=true;persist();await open();}));
 const editQuantity=(index,value)=>{if(!editable||busy)return;draft.lines[index].quantity=value;draft.dirty=true;persist();updateQuantityRow(index,qty);};
 modal.querySelectorAll('[data-qty]').forEach(el=>el.oninput=()=>editQuantity(Number(el.dataset.qty),el.value));
 modal.querySelectorAll('[data-step]').forEach(el=>el.onclick=()=>{const i=Number(el.dataset.step),current=Number(draft.lines[i].quantity),next=round(current+Number(el.dataset.delta),.000001);if(Number.isFinite(current)&&current>0&&next>0)editQuantity(i,next);});
 const changeUnit=(index,value)=>{if(!editable||busy)return;draft.lines[index].unit=Number(value);draft.dirty=true;persist();updateQuantityRow(index,qty);};
 modal.querySelectorAll('[data-unit]').forEach(el=>el.onchange=()=>changeUnit(Number(el.dataset.unit),el.value));
 modal.querySelectorAll('[data-unit-button]').forEach(el=>el.onclick=()=>changeUnit(Number(el.dataset.unitButton),el.dataset.unitId));
 modal.querySelectorAll('[data-remove]').forEach(el=>el.onclick=()=>run(async()=>{draft.lines.splice(Number(el.dataset.remove),1);draft.dirty=true;persist();await open();}));
 if(!editable)modal.querySelectorAll('[data-qty],[data-unit],[data-unit-button],[data-step],[data-remove]').forEach(el=>el.disabled=true);
 const targetState=modal.querySelector('[data-target-state]');
 const explainState=()=>{modal.querySelector('[data-state-help]').textContent=({cancel:t('取消当前调货单，并释放其库存预留。','Cancelar este traslado y liberar sus reservas.'),draft:t('保存单据，暂不主动预留库存。','Guardar el traslado sin solicitar una reserva.'),assigned:t('预留来源库存，减少可用库存；暂不完成调拨。','Reservar en origen y reducir existencias disponibles, sin validar el traslado.'),done:t('实际完成来源仓到目标仓的库存调拨。','Completar el movimiento de existencias del origen al destino.')})[targetState.value];};
 targetState.onchange=explainState;explainState();
 modal.querySelector('[data-apply-state]').onclick=()=>run(()=>applyTargetState(targetState.value));
 restoreTransferScroll(savedScroll);
}
async function cancelTransfer(){
 const original=draft;
 await navigator.locks.request(key('submit'),{ifAvailable:true},async lock=>{
   if(!lock)throw Error(t('另一窗口正在处理这张单。','El traslado está en uso.'));
   let record=null;
   if(draft.id){
     const current=await syncActiveDraft();
     if(current.cleared){await open();return;}
     record=current.record;
   }else if(draft.phase==='creating'){
     record=await recover();
   }
   if(original!==draft)return;
   if(record && (record.origin!=='PB-QT:'+draft.uuid || terminalState(record.state)))throw Error(t('原单状态已变化，请重新打开核对。','Vuelva a abrir el traslado para verificar su estado.'));
   const message=record?t('取消调货单 ','¿Cancelar el traslado ')+record.name+t(' 并释放库存预留？',' y liberar sus reservas?'):t('丢弃这张尚未保存的本机调货单？','¿Descartar este traslado local sin guardar?');
   if(!confirm(message))return;
   if(record){
     await rpc('stock.picking','action_cancel',[[record.id]]);
     const [updated]=await rpc('stock.picking','read',[[record.id],pickingFields]);
     if(updated?.state!=='cancel')throw Error(t('取消尚未确认，请重新读取原单。','Cancelación sin confirmar. Recargue el traslado.'));
     clearFinishedDraft(updated);
   }else{draft=newDraft();persist();}
   await refreshPending();await open();
 });
}
async function applyTargetState(target){
 if(!['draft','assigned','done','cancel'].includes(target))throw Error(t('请选择有效的目标状态。','Elija un estado válido.'));
 if(target==='cancel')return cancelTransfer();
 if(target==='assigned')return reservePicking();
 if(target==='draft'){
   if((await syncActiveDraft()).cleared){await open();return;}
   if(!['local','draft','creating'].includes(draft.phase))throw Error(t('这张单已确认，不能直接退回草稿。请在后台处理。','El traslado ya está confirmado; no puede volver directamente a borrador. Revíselo en Inventario.'));
 }
 return submit(target==='done');
}
let pendingFilter='all';
function pendingMatches(record,filter){
 if(filter==='all')return true;
 if(filter==='waiting')return ['confirmed','waiting','partially_available'].includes(record.state);
 return record.state===filter;
}
function renderPending(){
 const filters=[['all',t('全部','Todos')],['draft',t('草稿','Borrador')],['waiting',t('等待','En espera')],['assigned',t('就绪','Listo')],['cancel',t('已取消','Cancelados')]];
 const rows=pendingFilter==='cancel'?cancelledRecords:pending.filter(p=>pendingMatches(p,pendingFilter));
 const tabs='<div class="pbnt-toolbar pbqt-pending-tabs" role="group" aria-label="'+t('按状态查看','Filtrar por estado')+'">'+filters.map(([value,label])=>`<button data-pending-filter="${value}" class="${value===pendingFilter?'pbnt-selected':''}" aria-pressed="${value===pendingFilter}"><span>${esc(label)}</span><span class="pbqt-filter-count">${value==='cancel'?cancelledRecords.length:pending.filter(p=>pendingMatches(p,value)).length}</span></button>`).join('')+'</div>';
 const body=rows.map(p=>`<div class="pbqt-pending-row" data-pending-row="${p.id}"><div class="pbqt-pending-info"><b>${esc(p.name)}</b><div class="pbnt-muted">${esc(p.location_id[1])} → ${esc(p.location_dest_id[1])}</div></div><div class="pbqt-pending-actions"><span class="pbqt-status" data-status="${esc(p.state)}">${esc(stateLabel(p.state))}</span>${p.state==='cancel'?'':`<button data-resume-id="${p.id}">${t('打开','Abrir')}</button>`}${['draft','cancel'].includes(p.state)?`<button data-delete-transfer="${p.id}" disabled>${t('删除','Eliminar')}</button>`:''}</div></div>`).join('')||`<div class="pbnt-empty">${t('当前状态下没有待处理单据','No hay traslados pendientes en este estado')}</div>`;
 show(t('待处理调货','Traslados pendientes'),tabs+body,`<span class="pbnt-muted" style="margin-right:auto">${t('当前电脑记录','Registros de este equipo')}</span><button data-refresh-pending>${t('刷新状态','Actualizar estados')}</button><button data-back>${t('返回','Volver')}</button>`,true);
 modal.dataset.view='pending';modalLanguageRender=renderPending;
 prepareDeleteButtons(modal,rows);
 modal.querySelectorAll('[data-pending-filter]').forEach(button=>button.onclick=()=>{if(busy)return;pendingFilter=button.dataset.pendingFilter;renderPending();});
 modal.querySelector('[data-refresh-pending]').onclick=()=>run(showPending);
 modal.querySelector('[data-back]').onclick=()=>run(open);
 modal.querySelectorAll('[data-resume-id]').forEach(button=>button.onclick=()=>run(()=>resume(rows.find(p=>p.id===Number(button.dataset.resumeId)))));
}
async function prepareDeleteButtons(view,rows){
 for(const button of view.querySelectorAll('[data-delete-transfer]')){
   if(!view.isConnected)return;
   const record=rows.find(row=>row.id===Number(button.dataset.deleteTransfer));
   try{
     if(await rpc('stock.picking','has_access',[[record.id],'unlink'])!==true){
       button.title=t('没有此单的删除权限','Sin permiso para eliminar este traslado');continue;
     }
     button.disabled=false;
     button.onclick=()=>run(()=>deleteTransfer(record));
   }catch{button.disabled=true;button.title=t('无法核实删除权限','No se pudo verificar el permiso');}
 }
}
async function deleteTransfer(record){
 await navigator.locks.request(key('submit'),{ifAvailable:true},async lock=>{
   if(!lock)throw Error(t('另一窗口正在处理。','Otra ventana está procesando.'));
   const [fresh]=await rpc('stock.picking','read',[[record.id],pickingFields]);
   if(!fresh||fresh.origin!==record.origin||!fresh.origin?.startsWith('PB-QT:')||fresh.state!==record.state||!['draft','cancel'].includes(fresh.state))
     throw Error(t('单据状态已改变，请刷新。','El estado cambió. Actualice.'));
   if(await rpc('stock.picking','has_access',[[fresh.id],'unlink'])!==true){
     renderPending();throw Error(t('没有此单的删除权限。','Sin permiso para eliminar este traslado.'));
   }
   if(!confirm(t('永久删除调货单 ','¿Eliminar definitivamente ')+fresh.name+t('？删除后不能恢复。','? No se puede recuperar.')))return;
   if(await rpc('stock.picking','unlink',[[fresh.id]])!==true)throw Error(t('删除结果未确认，请刷新。','Eliminación sin confirmar. Actualice.'));
   save(key('records'),indices().filter(id=>id!==fresh.id));save(key('cancelledRecords'),cancelledIds().filter(id=>id!==fresh.id));
   if(draft?.id===fresh.id){draft=newDraft();persist();}
   await showPending();
 });
}
async function showPending(){
 await syncActiveDraft();await refreshPending();
 const ids=[...new Set([...cancelledIds(),...indices()])];
 cancelledRecords=ids.length?await rpc('stock.picking','search_read',[[['id','in',ids],['company_id','=',pos.company.id],['state','=','cancel']]],{fields:pickingFields,limit:500,order:'id desc'}):[];
 renderPending();
}
async function resume(record,replaceCurrent=false) {
 await syncActiveDraft();
 [record]=await rpc('stock.picking','read',[[record.id],pickingFields]);
 if(!record)throw Error(t('此单无法读取，请刷新待处理列表。','No se puede leer este traslado. Actualice Pendientes.'));
 if(terminalState(record.state)){clearFinishedDraft(record);notice(record.name+' · '+stateLabel(record.state));await showPending();return;}
 if(!(replaceCurrent&&draft?.id===record.id)&&draft?.lines.length&&(!draft.id||draft.dirty))throw Error(t('请先保存当前调货，再打开另一张。','Guarde el traslado actual antes de abrir otro.'));
 const moves=await rpc('stock.move','read',[record.move_ids,['product_id','product_uom_qty','product_uom']]);
 const products=await rpc('product.product','read',[[...new Set(moves.map(x=>idOf(x.product_id)))],productFields()]);
 const lines=[];for(const move of moves){const line=await productInfo(products.find(x=>x.id===idOf(move.product_id)));if(line.base!==idOf(move.product_uom))throw Error(t('后台使用了其他计量单位，请在后台完成此单。','Esta unidad requiere revisión en Inventario.'));const chosen=line.units.find(u=>u.id===line.unit);const count=move.product_uom_qty/(chosen?.factor||1);if(Math.abs(count-Math.round(count))<1e-6){line.quantity=count;}else{line.unit=line.base;line.quantity=move.product_uom_qty;}lines.push(line);}
 draft={uuid:record.origin.replace('PB-QT:',''),id:record.id,phase:record.state,writeDate:record.write_date,route:{uuid:routes.find(r=>r.type===idOf(record.picking_type_id)&&r.source===idOf(record.location_id)&&r.destination===idOf(record.location_dest_id))?.uuid,name:record.name,type:idOf(record.picking_type_id),source:idOf(record.location_id),destination:idOf(record.location_dest_id),contact:idOf(record.partner_id),contactName:record.partner_id?.[1]||''},lines};persist();await open();
}
function manageRoutes(selected=0,editingRoute=null) {
 const route=editingRoute||clone(routes[selected]||{uuid:crypto.randomUUID(),name:'',type:types[0]?.id,source:idOf(types[0]?.default_location_src_id),destination:idOf(types[0]?.default_location_dest_id),contact:0,contactName:''});
 show(t('路线收藏 · 当前电脑','Rutas favoritas · Este equipo'),`<div class="pbnt-toolbar">${routes.map((r,i)=>`<button data-edit="${i}" class="${i===selected?'pbnt-selected':''}">${esc(r.name)}</button>`).join('')}<button data-add>＋</button></div><label>${t('收藏名称','Nombre')}<input data-name value="${esc(route.name)}"></label><div class="pbqt-name-symbols" role="group" aria-label="${t('插入符号','Insertar símbolo')}"><span class="pbnt-muted">${t('插入符号：','Insertar símbolo: ')}</span>${['⬆️','⬇️','↑','↓','↔️','⭐','✅'].map(symbol=>`<button type="button" data-name-symbol="${esc(symbol)}" aria-label="${esc(t('插入 ','Insertar ')+symbol)}">${esc(symbol)}</button>`).join('')}</div><div class="pbnt-fields"><label>${t('调拨类型','Tipo de operación')}<select data-type>${types.map(x=>`<option value="${x.id}" ${x.id===route.type?'selected':''}>${esc(x.display_name)}</option>`).join('')}</select></label><label>${t('联系人','Contacto')}<input data-contact-search placeholder="${t('搜索联系人','Buscar contacto')}" value="${esc(route.contactName)}"></label><label>${t('来源库位','Origen')}<select data-source>${locations.map(x=>`<option value="${x.id}" ${x.id===route.source?'selected':''}>${esc(x.display_name)}</option>`).join('')}</select></label><label>${t('目标库位','Destino')}<select data-destination>${locations.map(x=>`<option value="${x.id}" ${x.id===route.destination?'selected':''}>${esc(x.display_name)}</option>`).join('')}</select></label></div><div class="pbnt-search-results" data-contacts></div>`,`<button data-back>${t('返回','Volver')}</button><button data-delete>${t('删除收藏','Quitar favorito')}</button><button class="pbnt-primary" data-save-route>${t('保存收藏','Guardar ruta')}</button>`,true);
 modalLanguageRender=()=>{
   route.name=modal.querySelector('[data-name]').value;route.type=Number(modal.querySelector('[data-type]').value);
   route.source=Number(modal.querySelector('[data-source]').value);route.destination=Number(modal.querySelector('[data-destination]').value);
   manageRoutes(selected,route);
 };
 const nameInput=modal.querySelector('[data-name]');
 modal.querySelectorAll('[data-name-symbol]').forEach(button=>{
   button.onmousedown=event=>event.preventDefault();
   button.onclick=()=>{const start=nameInput.selectionStart??nameInput.value.length,end=nameInput.selectionEnd??start;nameInput.setRangeText(button.dataset.nameSymbol,start,end,'end');nameInput.focus();nameInput.dispatchEvent(new Event('input',{bubbles:true}));};
 });
 modal.querySelectorAll('[data-edit]').forEach(el=>el.onclick=()=>run(()=>manageRoutes(Number(el.dataset.edit))));modal.querySelector('[data-add]').onclick=()=>run(()=>manageRoutes(routes.length));modal.querySelector('[data-back]').onclick=()=>run(open);
 let contactTimer,contactRequest=0;
 modal.querySelector('[data-contact-search]').oninput=e=>{route.contact=0;route.contactName='';clearTimeout(contactTimer);const text=e.target.value,request=++contactRequest,target=modal.querySelector('[data-contacts]');contactTimer=setTimeout(async()=>{try{if(text.length<2){target.innerHTML='';return;}const contacts=await rpc('res.partner','search_read',[[['name','ilike',text]]],{fields:['id','display_name'],limit:15});if(!target.isConnected||request!==contactRequest)return;target.innerHTML=contacts.map((c,i)=>`<button data-person="${i}">${esc(c.display_name)}</button>`).join('');target.querySelectorAll('[data-person]').forEach(el=>el.onclick=()=>{const c=contacts[Number(el.dataset.person)];route.contact=c.id;route.contactName=c.display_name;modal.querySelector('[data-contact-search]').value=c.display_name;target.innerHTML='';});}catch(error){notice(error.message);}},250);};
 modal.querySelector('[data-save-route]').onclick=()=>run(async()=>{route.name=modal.querySelector('[data-name]').value.trim();route.type=Number(modal.querySelector('[data-type]').value);route.source=Number(modal.querySelector('[data-source]').value);route.destination=Number(modal.querySelector('[data-destination]').value);if(!route.name||route.source===route.destination)throw Error(t('请填写名称，并选择不同的库位。','Escriba un nombre y elija ubicaciones distintas.'));routes[selected]=route;save(key('routes'),routes);save(key('routesConfigured'),true);if(!draft.lines.length&&!draft.id)draft.route=clone(route);persist();await open();});
 modal.querySelector('[data-delete]').onclick=()=>run(async()=>{routes.splice(selected,1);save(key('routes'),routes);save(key('routesConfigured'),true);await manageRoutes(0);});
}
async function initialize() {
 window.addEventListener('resize',fitTransferWindow);
 window.visualViewport?.addEventListener('resize',fitTransferWindow);
 window.visualViewport?.addEventListener('scroll',fitTransferWindow);
 launch=launcher(t('调货','Traslado'));await refreshPending().catch(error=>notice(error.message));
 setInterval(refreshBackground,60000);
 window.addEventListener('focus',refreshBackground);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshBackground();});
 window[GLOBAL]={version:VERSION,open,available,refreshPending,diagnostics:()=>({pending:pending.map(x=>({id:x.id,state:x.state})),draft:clone(draft||{}),routes:clone(routes)}),test:{loadRoutes,productInfo,addProduct,savePicking,commit,resume,setDraft:value=>{draft=value;persist();},getDraft:()=>draft}};
}

boot().catch(error=>{console.error(error);notice(error.message);});
})();

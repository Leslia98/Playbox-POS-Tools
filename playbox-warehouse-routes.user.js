// ==UserScript==
// @name         Playbox Odoo - 仓库路线与收藏
// @namespace    playbox.internal.transfer
// @version      1.0.22
// @description  恢复原版路线界面与尺寸，保留新版路线保护和收藏逻辑。
// @author       Playbox
// @match        https://*.odoo.com/odoo*
// @match        https://*.odoo.com/web*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==
// Source: user-supplied Playbox 仓库路线：收藏与快捷设置 1.0.1; original retained in checkpoint-1/old-two.

(function(){
    'use strict';
    if(window.top!==window.self||location.protocol!=='https:'||!location.hostname.endsWith('.odoo.com')||!/^\/(odoo|web)(?:\/|$)/.test(location.pathname))return;
    if(document.documentElement.hasAttribute('pb-addon-routes-instance'))return;
    document.documentElement.setAttribute('pb-addon-routes-instance','1.0.22');
    const PBAddonCore119 = (function(){const module={exports:{}};
/* New modules only. No writes to any of the nine 1.0.17 modules. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PBAddonCore119 = factory();
})(typeof globalThis === 'object' ? globalThis : this, () => {
    'use strict';
    const FORMULA = 'odoo19-asof-parent-move-v1';
    const number = n => typeof n === 'number' && Number.isFinite(n);
    const id = n => Number.isSafeInteger(n) && n > 0;
    const clone = x => JSON.parse(JSON.stringify(x));
    // Owl may expose distinct reactive proxies for one native datapoint.
    const sameRecord = (a,b) => !!a&&!!b&&typeof a.id==='string'&&a.id===b.id&&a.resId===b.resId&&a.resModel===b.resModel;
    const utc = value => {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return false;
        const d = new Date(value.replace(' ', 'T') + 'Z');
        return Number.isFinite(d.getTime()) && d.toISOString().slice(0,19).replace('T',' ') === value;
    };
    function identity(s) {
        if (!s.host || !s.db || !id(s.uid) || !Array.isArray(s.companies) || !s.companies.length || !s.companies.every(id) ||
            !id(s.product) || !id(s.unit) || !utc(s.at) || !(s.location === null || id(s.location)) || typeof s.children !== 'boolean') {
            throw new Error('identity');
        }
        return JSON.stringify([FORMULA,s.host,s.db,s.uid,[...new Set(s.companies)].sort((a,b)=>a-b),s.product,s.location,s.children,s.at,s.unit,s.facets || []]);
    }
    function values(record) {
        if (!record || !id(record.id)) throw new Error('empty');
        // Deliberately never coerce null/false/missing/string to zero.
        const hand=number(record.qty_available)?record.qty_available:null;
        const outgoing=number(record.outgoing_qty)?record.outgoing_qty:null;
        return {hand,act:hand!==null && outgoing!==null ? hand-outgoing : null,
            virt:number(record.virtual_available)?record.virtual_available:null,
            raw:{qty_available:hand,outgoing_qty:outgoing,virtual_available:number(record.virtual_available)?record.virtual_available:null}};
    }
    class Store {
        constructor(storage, warn=()=>{}) { this.storage=storage;this.warn=warn;this.memory=new Map();this.warned=false; }
        failed() { if(!this.warned){this.warned=true;this.warn('storage');} }
        get(key) {
            if(this.memory.has(key))return this.memory.get(key);
            try { return this.storage.getItem(key); } catch { this.failed();return null; }
        }
        set(key,raw) {
            try {this.storage.setItem(key,raw);if(this.storage.getItem(key)!==raw)throw Error('readback');this.memory.delete(key);return true;}
            catch {this.memory.set(key,raw);this.failed();return false;}
        }
        read(key,fallback,valid) {
            const raw=this.get(key);if(raw===null)return clone(fallback);
            const value=JSON.parse(raw);if(!valid(value))throw Error('invalid-storage');return value;
        }
        migrate(key, value, originals, valid) {
            if(this.get(key)!==null)return false;
            if(!valid(value))throw Error('invalid-migration');
            // Backups and target must both survive a readback. Never delete legacy keys.
            if(!this.set(key+':backup',JSON.stringify({schema:1,originals})))return false;
            return this.set(key,JSON.stringify(value));
        }
    }
    class Cache {
        constructor({capacity=1000,ttl=300000,now=Date.now}={}) {this.entries=new Map();this.capacity=capacity;this.ttl=ttl;this.now=now;}
        get(key) {const v=this.entries.get(key);if(!v)return null;if(this.now()-v.acquired>=this.ttl||v.acquired>this.now()){this.entries.delete(key);return null;}this.entries.delete(key);this.entries.set(key,v);return clone(v);}
        put(key,value) {const v=clone(value);v.acquired=this.now();this.entries.delete(key);this.entries.set(key,v);while(this.entries.size>this.capacity)this.entries.delete(this.entries.keys().next().value);}
        clear() {this.entries.clear();}
        dump() {return {schema:1,formula:FORMULA,entries:[...this.entries].filter(([,v])=>this.now()-v.acquired<this.ttl)};}
        restore(raw) {
            if(raw?.schema!==1||raw.formula!==FORMULA||!Array.isArray(raw.entries))return;
            for(const e of raw.entries.slice(-this.capacity)){
                if(!Array.isArray(e)||e.length!==2||typeof e[0]!=='string')continue;
                const v=e[1];if(!number(v?.acquired)||v.acquired>this.now()||this.now()-v.acquired>=this.ttl)continue;
                try {const k=JSON.parse(e[0]);if(k[0]!==FORMULA||k.length!==11)continue;}catch{continue;}
                if(!v.data||!['hand','act','virt'].every(k=>v.data[k]===null||number(v.data[k])))continue;
                this.entries.set(e[0],clone(v));
            }
        }
    }
    class QueryRun {
        constructor({cache=new Cache(),concurrency=3,valid=()=>true,update=()=>{}}={}) {
            this.cache=cache;this.concurrency=Math.min(6,Math.max(1,concurrency));this.validContext=valid;this.update=update;this.serial=0;this.state='idle';this.items=[];
        }
        valid(token){return token===this.serial&&this.validContext()&&this.state!=='stopped';}
        stop(){++this.serial;this.state='stopped';this.wake?.();this.update(this);}
        pause(){if(this.state==='running'){this.state='paused';this.update(this);}}
        resume(){if(this.state==='paused'){this.state='running';this.wake?.();this.update(this);}}
        counts(){const c={success:0,cache:0,failed:0,confirm:0,unqueried:0,running:0};for(const i of this.items)c[i.status in c?i.status:'unqueried']++;return c;}
        async run(items,fetch,{force=false}={}) {
            this.stop();const token=this.serial;this.state='running';this.items=items;this.started=Date.now();this.requests=0;this.halted=false;let cursor=0,errors=0;
            const groups=new Map();for(const item of items){item.status=item.reason?'confirm':'unqueried';if(!item.reason){const key=identity(item.scope);item.key=key;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}}
            const queue=[...groups];this.update(this);
            const notify=()=>{if(this.valid(token))this.update(this);};
            const worker=async()=>{
                while(this.valid(token)){
                    while(this.state==='paused'&&this.valid(token))await new Promise(resolve=>{const old=this.wake;this.wake=()=>{old?.();resolve();};});
                    if(!this.valid(token)||cursor>=queue.length)return;
                    const [key,rows]=queue[cursor++];const cached=force?null:this.cache.get(key);
                    if(cached){for(const r of rows)Object.assign(r,{status:'cache',result:cached});notify();continue;}
                    for(const r of rows)r.status='running';notify();
                    try {
                        ++this.requests;const result=await fetch(rows[0].scope);
                        if(!this.valid(token))return;
                        if(!result?.data||result.data.hand===null)throw Error('missing-field');
                        const stamped={...result,acquired:Date.now()};this.cache.put(key,stamped);errors=0;
                        for(const r of rows)Object.assign(r,{status:'success',result:stamped});
                    } catch(e) {
                        if(!this.valid(token))return;
                        for(const r of rows)Object.assign(r,{status:'failed',error:e.code||e.message||'unknown'});
                        errors++;
                        if(errors>=3||['permission','session','timeout'].includes(e.code)){
                            // Halt dispatch but keep the task identity: already dispatched read-only work may finish.
                            cursor=queue.length;this.halted=true;
                        }
                    }
                    notify();
                }
            };
            await Promise.all(Array.from({length:this.concurrency},worker));
            if(!this.valid(token))return;
            const c=this.counts();this.finished=Date.now();this.state=c.failed||c.confirm||c.unqueried?'partial':'success';notify();
        }
    }
    const textCell=s=> /^[\s]*[=+\-@]/.test(String(s)) ? "'"+s : String(s);
    function exportTable(rows,separator=',') {
        return rows.map(row=>row.map(v=>{
            const s=number(v)?String(v):v==null?'':textCell(v);
            return separator==='\t'?s.replace(/[\t\r\n]+/g,' '):'"'+s.replace(/"/g,'""')+'"';
        }).join(separator)).join('\r\n');
    }
    function routeValid(r) {return !!r&&['src','dst','type'].every(k=>typeof r[k]==='string'&&r[k].length<250)&&
        (r.partner===undefined||typeof r.partner==='string'&&r.partner.length<250)&&
        (r.name===undefined||typeof r.name==='string'&&r.name.length<=80)&&
        (r.ids===undefined||r.ids&&Object.values(r.ids).every(v=>v===0||id(v)));}
    return {FORMULA,number,id,utc,clone,sameRecord,identity,values,Store,Cache,QueryRun,exportTable,routeValid};
});

return module.exports;})();
    const PBLanguage = (function(){const module={exports:{}};
/* 只同步语言偏好。业务数据不通过此接口共享或迁移。 */
(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.PBLanguage = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
    "use strict";
    const KEY = "pb-suite:language:v1";
    const EVENT = "pb-suite:language-change:v1";
    function normalize(value) {
        return value === "zh" || value === "zh-CN" ? "zh-CN" :
            value === "es" || value === "es-MX" ? "es-MX" : null;
    }
    function parse(raw) {
        if (!raw) return null;
        try {
            const record = JSON.parse(raw);
            return record?.schema === 1 ? normalize(record.language) : null;
        } catch (_) { return null; }
    }
    function create({ storage, bus, legacy = [], onError = () => {}, eventFactory }) {
        const listeners = new Set();
        let current = "zh-CN", disposed = false;
        try {
            current = parse(storage.getItem(KEY)) || legacy.map(normalize).find(Boolean) || current;
        } catch (error) { onError(error); current = legacy.map(normalize).find(Boolean) || current; }
        function receive(value) {
            const next = normalize(value);
            if (!next || next === current || disposed) return false;
            current = next;
            for (const fn of listeners) {
                try { fn(current); } catch (error) { onError(error); }
            }
            return true;
        }
        const localEvent = event => receive(parse(event.detail));
        const storageEvent = event => {
            if (event.key === KEY && (!event.storageArea || event.storageArea === storage)) receive(parse(event.newValue));
        };
        bus.addEventListener(EVENT, localEvent);
        bus.addEventListener("storage", storageEvent);
        return {
            get: () => current,
            set(value) {
                const next = normalize(value);
                if (!next || disposed) return { changed: false, persisted: false };
                const payload = JSON.stringify({ schema: 1, language: next });
                let persisted = false;
                try {
                    storage.setItem(KEY, payload);
                    if (storage.getItem(KEY) !== payload) throw new Error("语言设置回读失败");
                    persisted = true;
                } catch (error) { onError(error); }
                const changed = receive(next);
                // 接收者只更新内存；不回写，不形成通知循环。
                if (changed) bus.dispatchEvent(eventFactory(EVENT, payload));
                return { changed, persisted };
            },
            subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
            dispose() {
                disposed = true; listeners.clear();
                bus.removeEventListener(EVENT, localEvent);
                bus.removeEventListener("storage", storageEvent);
            },
        };
    }
    function translator(controller, dictionary, report = () => {}) {
        const missing = new Set();
        return function t(key, values = {}) {
            const entry = dictionary[key];
            let text = entry?.[controller.get()] ?? entry?.["zh-CN"] ?? entry?.["es-MX"];
            if (typeof text !== "string") {
                if (!missing.has(key)) { missing.add(key); report({ kind: "missing-translation", key }); }
                text = controller.get() === "es-MX" ? "Información no disponible" : "暂无说明";
            }
            return text.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_, name) => String(values[name] ?? ""));
        };
    }
    // 显式绑定脚本拥有的标签，不遍历或翻译 Odoo/客户数据，也不重建输入框。
    function updateLabels(root, t) {
        root.querySelectorAll("[data-pb-text]").forEach(node => {
            const text = t(node.dataset.pbText);
            if (node.textContent !== text) node.textContent = text;
        });
        for (const attribute of ["title", "placeholder", "aria-label"]) {
            root.querySelectorAll("[data-pb-" + attribute + "]").forEach(node => {
                const text = t(node.getAttribute("data-pb-" + attribute));
                if (node.getAttribute(attribute) !== text) node.setAttribute(attribute, text);
            });
        }
    }
    return Object.freeze({ KEY, EVENT, normalize, create, translator, updateLabels });
});

return module.exports;})();
/* The builder embeds this inside each new module, after core.cjs and the unchanged language helper. */
const Core = PBAddonCore119;
const VERSION = '1.0.22';
const mod = name => window.odoo?.loader?.modules?.get(name);
const services = () => window.odoo?.__WOWL_DEBUG__?.root?.env?.services;
const plain = x => JSON.parse(JSON.stringify(x));
const relationId = x => Number(Array.isArray(x) ? x[0] : x?.id) || 0;
const relationName = x => String(Array.isArray(x) ? x[1] : x?.display_name || '');
function environment() {
    const user=mod('@web/core/user')?.user,session=mod('@web/session')?.session;
    const context=user?.context;
    if(!context?.allowed_company_ids?.length||!session?.db||!Core.id(user.userId))throw Error('context');
    const companyLabels=Array.from(context.allowed_company_ids,id=>user.allowedCompanies?.[id]?.name||user.activeCompany?.id===id&&user.activeCompany.name||String(id));
    return {host:location.hostname,db:session.db,uid:user.userId,companies:Array.from(context.allowed_company_ids),companyLabels,
        company:user.activeCompany?.id,companyName:user.activeCompany?.name,tz:user.tz||context.tz,
        context:plain(context),version:session.server_version};
}
function environmentKey(){try{const e=environment();return JSON.stringify([e.host,e.db,e.uid,e.company,e.companies,e.tz]);}catch{return '';}}
function createRPC() {
    let calls=0;
    return {
        get calls(){return calls;},
        async call(model,method,args,kwargs={},valid=()=>true) {
            if(!valid())throw Error('stopped');
            const orm=services()?.orm;if(!orm)throw Error('api');
            let timer;calls++;
            try {
                const result=await Promise.race([orm.call(model,method,args,kwargs),new Promise((_,reject)=>{
                    timer=setTimeout(()=>reject(Object.assign(Error('timeout'),{code:'timeout'})),15000);
                })]);
                if(!valid())throw Error('stopped');
                return result;
            } catch(error) {
                if(error.code)throw error;
                const name=String(error.data?.name||error.name||'');
                throw Object.assign(error,{code:name.includes('AccessError')?'permission':name.includes('SessionExpired')?'session':error.message==='stopped'?'stopped':'network'});
            } finally {clearTimeout(timer);}
        },
        read(model,ids,fields,context,valid){return this.call(model,'read',[ids,fields],{context},valid);}
    };
}
function findController(model,kind) {
    const action=services()?.action?.currentController;
    if(action?.action?.res_model!==model)return null;
    const queue=[window.odoo?.__WOWL_DEBUG__?.root?.__owl__],seen=new Set();
    while(queue.length&&seen.size<2000){
        const node=queue.shift();if(!node||seen.has(node))continue;seen.add(node);
        const c=node.component,r=c?.model?.root,el=c?.rootRef?.el;
        if(r?.resModel===model&&el?.isConnected&&!el.closest('.modal,.o_dialog')&&
            (kind==='list'?Array.isArray(r.records):typeof r.update==='function'))return c;
        queue.push(...Object.values(node.children||{}));
    }
    return null;
}
function element(tag,text,attrs={}) {
    const node=document.createElement(tag);if(text!==undefined&&text!==null)node.textContent=text;
    for(const [k,v] of Object.entries(attrs))if(k==='className')node.className=v;else node.setAttribute(k,String(v));
    return node;
}
function actionButton(text,fn) {const b=element('button',text,{type:'button'});b.addEventListener('click',fn);return b;}
function dialog(content,closeText) {
    const d=element('dialog',null,{className:'pb-addon-dialog'}),close=actionButton(closeText,()=>d.close());
    d.append(content,close);document.body.append(d);d.addEventListener('close',()=>d.remove(),{once:true});d.showModal();return d;
}
function scopedStorageKey(module,e=environment()) {return ['pb-addon',module,'v1',e.host,e.db,e.uid,e.company].join(':');}
function addStyle() {
    if(document.getElementById('pb-addon-style-119'))return;
    const style=element('style',null,{id:'pb-addon-style-119'});
    style.textContent=`
    .pb-addon-panel,.pb-addon-dialog{color:var(--pba-fg,#24343b);background:var(--pba-bg,#fff);border:1px solid #bccbce;border-radius:8px;padding:12px;font:14px/1.5 system-ui}
    .pb-addon-panel button,.pb-addon-dialog button{border:1px solid #bccbce;background:transparent;color:inherit;border-radius:4px;padding:5px 9px;cursor:pointer}
    .pb-addon-panel button:disabled{opacity:.5;cursor:default}
    .pb-addon-panel button:focus-visible,.pb-addon-dialog button:focus-visible{outline:2px solid #087e8b;outline-offset:2px}
    .pb-addon-panel input,.pb-addon-panel select,.pb-addon-dialog input{color:inherit;background:var(--pba-bg,#fff);border:1px solid #bccbce;padding:4px;border-radius:4px;max-width:100%}
    .pb-addon-panel .pba-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px}
    .pb-addon-panel summary{cursor:pointer;margin-top:7px}.pb-addon-panel small{display:block;opacity:.85}
    .pb-addon-dialog{max-width:min(740px,90vw);max-height:85vh;overflow:auto}.pb-addon-dialog::backdrop{background:#0005}
    .pb-addon-dialog pre{white-space:pre-wrap;overflow-wrap:anywhere}.pb-addon-dialog .pba-options{display:grid;gap:6px;margin:8px 0}
    [data-pb-history-column] button{color:#087e8b;background:transparent;border:0;white-space:nowrap;text-decoration:underline}
    @media print{.pb-addon-panel,.pb-addon-dialog{display:none!important}}
    `;document.head.append(style);
}
function bindDrag(panel,handle,store,key,onWarning) {
    let start=null,moved=false,suppress=0;
    const clamp=()=>{const r=panel.getBoundingClientRect();panel.style.left=Math.max(4,Math.min(r.left,innerWidth-r.width-4))+'px';panel.style.top=Math.max(4,Math.min(r.top,innerHeight-Math.min(r.height,innerHeight-8)-4))+'px';panel.style.right='auto';};
    try {const p=JSON.parse(store.get(key)||'null');if(Core.number(p?.left)&&Core.number(p?.top)){panel.style.left=p.left+'px';panel.style.top=p.top+'px';panel.style.right='auto';}}catch{onWarning();}
    handle.style.touchAction='none';handle.style.cursor='move';
    const down=e=>{if(e.button!==0||e.target.closest('button,input,select'))return;const r=panel.getBoundingClientRect();start={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top};moved=false;handle.setPointerCapture(e.pointerId);};
    const move=e=>{if(!start||e.pointerId!==start.id)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;if(!moved&&Math.hypot(dx,dy)<6)return;moved=true;panel.style.left=start.left+dx+'px';panel.style.top=start.top+dy+'px';panel.style.right='auto';clamp();};
    const end=e=>{if(!start||e.pointerId!==start.id)return;const original=start;start=null;if(e.type!=='pointerup'){panel.style.left=original.left+'px';panel.style.top=original.top+'px';}else if(moved){clamp();const r=panel.getBoundingClientRect();if(!store.set(key,JSON.stringify({left:r.left,top:r.top})))onWarning();}if(moved)suppress=Date.now()+600;};
    const click=e=>{if(e.detail&&Date.now()<suppress){e.preventDefault();e.stopPropagation();}};
    handle.addEventListener('pointerdown',down);handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);handle.addEventListener('lostpointercapture',end);handle.addEventListener('click',click,true);window.addEventListener('resize',clamp);clamp();
    return ()=>{handle.removeEventListener('pointerdown',down);handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);handle.removeEventListener('lostpointercapture',end);handle.removeEventListener('click',click,true);window.removeEventListener('resize',clamp);};
}

/* Native stock.picking form integration. No save/write/confirm/reserve/validate calls. */
const DICT={
 routesLabel:['路线：','Rutas:'],contactLabel:['联系人','Contacto'],nameSave:['保存','Guardar'],
 title:['仓库路线与收藏','Rutas de almacén y favoritos'],protect:['路线保护','Conservar la ruta'],save:['保存路线','Guardar ruta'],check:['重新核对','Volver a comprobar'],empty:['暂无保存路线','No hay rutas guardadas'],apply:['应用路线','Aplicar ruta'],rename:['重命名','Renombrar'],remove:['移除此常用路线','Quitar esta ruta favorita'],name:['路线名称','Nombre de la ruta'],cancel:['取消','Cancelar'],saved:['已保存','Guardado'],applied:['已应用，请核对原生表单及移动明细','Aplicada; revise el formulario y sus movimientos'],
 source:['未选择源仓','Seleccione origen'],dest:['未选择目标仓','Seleccione destino'],same:['源库位与目标库位相同','El origen y destino son iguales'],limit:['最多保存 12 条路线','Máximo de 12 rutas'],choose:['请先完成字段选择','Termine de seleccionar los campos'],busy:['正在通过原生表单应用…','Aplicando mediante el formulario nativo…'],
 changed:['单据、公司或收藏已变化；本次操作已停止','Cambió el documento, empresa o favoritos; operación detenida'],readonly:['该表单不可编辑','Formulario de solo lectura'],api:['无法确认原生表单接口，请手动选择','No se pudo verificar la interfaz nativa; seleccione manualmente'],domain:['收藏不在当前字段可选范围，或存在同名项；请手动选择','La ruta no es seleccionable o tiene nombres ambiguos; seleccione manualmente'],
 storage:['保存未成功，原配置已保留；本次仅保留在内存','No se guardó; se conservó la configuración anterior. Solo en memoria'],invalid:['收藏无法读取，保留原值；请先恢复备份','No se pueden leer los favoritos; se conservó el original. Restaure una copia'],timeout:['更新超时，结果未知；请核对原生字段和明细，不要重复应用','Tiempo agotado; resultado desconocido. Revise campos y movimientos antes de repetir'],
 failed:['更新失败，请核对原生字段和明细','Falló la actualización; revise campos y movimientos'],mismatch:['表头或移动明细不一致，请核对','El encabezado o los movimientos no coinciden; revise'],checked:['已核对当前表头和已加载的移动明细','Encabezado y movimientos cargados comprobados'],partialCheck:['表头已核对，部分明细未加载，请在原生表单继续检查','Encabezado comprobado; faltan movimientos por cargar. Revise el formulario nativo'],
 oldPartner:['未保存联系人（保持原值）','Contacto no guardado (conservar actual)'],noPartner:['明确清空联系人','Borrar el contacto'],warning:['请先完成路线核对再保存或验证','Compruebe la ruta antes de guardar o validar'],permission:['无读取权限','Sin permiso de lectura'],session:['会话已失效','La sesión expiró'],network:['网络或服务异常','Error de red o del servidor'],
};
const norm=x=>String(x??'').replace(/\s+/g,' ').trim();
const language=PBLanguage.create({storage:localStorage,bus:window,eventFactory:(name,detail)=>new CustomEvent(name,{detail})});
const t=key=>DICT[key]?.[language.get()==='es-MX'?1:0]||DICT.failed[language.get()==='es-MX'?1:0];
const store=new Core.Store(localStorage,()=>{if(state){state.message='storage';render();}}),rpc=createRPC();
const fields=['picking_type_id','partner_id','location_id','location_dest_id'];
let state=null,controller=null,lastAction=null;
function editable(s){return !!s?.record?.isInEdition&&!['done','cancel'].includes(s.record.data.state)&&!s.record.model._urgentSave;}
function alive(s,epoch=s.epoch){return state===s&&s.epoch===epoch&&!s.discarding&&s.form.isConnected&&s.scope===environmentKey()&&s.record===s.controller.model.root&&s.recordKey===(s.record.id+':'+s.record.resId)&&services()?.action?.currentController===s.action;}
function snapshot(s=state){const d=s.record.data;return {src:relationName(d.location_id),dst:relationName(d.location_dest_id),type:relationName(d.picking_type_id),partner:relationName(d.partner_id),ids:Object.fromEntries(fields.map(k=>[k,relationId(d[k])]))};}
function signature(r){return JSON.stringify([r.src,r.dst,r.type,Object.hasOwn(r,'partner')?r.partner:null,r.ids||{}]);}
function label(r){return r.name||r.src+' → '+r.dst+(r.partner?' · '+r.partner:'');}
function validPrefs(p){return p?.schema===1&&typeof p.protect==='boolean'&&Array.isArray(p.routes)&&p.routes.length<=12&&p.routes.every(Core.routeValid);}
function load(s){
    s.key=scopedStorageKey('routes');s.invalid=false;
    try{
        if(store.get(s.key)===null){
            const env=environment(),legacyKey='pb-internal-routes-v1:'+env.host+':'+norm(env.companyName),raw=store.get(legacyKey);
            if(raw!==null){const routes=JSON.parse(raw);if(!Array.isArray(routes)||routes.length>12||!routes.every(Core.routeValid))throw Error('invalid');store.migrate(s.key,{schema:1,protect:true,routes},{[legacyKey]:raw},validPrefs);}
        }
        s.prefs=store.read(s.key,{schema:1,protect:true,routes:[]},validPrefs);
    }catch{s.invalid=true;s.prefs={schema:1,protect:false,routes:[]};s.message='invalid';}
}
function save(s,prefs){if(!alive(s)||s.invalid||!validPrefs(prefs)){s.message=s.invalid?'invalid':'changed';return false;}const persisted=store.set(s.key,JSON.stringify(prefs));s.prefs=prefs;s.message=persisted?'saved':'storage';render(true);return persisted;}
function latestPrefs(s){return store.read(s.key,{schema:1,protect:true,routes:[]},validPrefs);}
function fieldWidgets(s){
    // Traverse only the confirmed controller, once at mount or when a rendered field is replaced.
    const q=[s.controller.__owl__],seen=new Set(),out=new Map();
    while(q.length&&seen.size<1500){const n=q.shift();if(!n||seen.has(n))continue;seen.add(n);const c=n.component;
        if(Core.sameRecord(c?.props?.record,s.record)&&fields.includes(c.props.name)&&c.m2oProps)out.set(c.props.name,c);
        q.push(...Object.values(n.children||{}));}
    return out;
}
function fieldProps(s,name){
    let c=s.widgets.get(name);if(!c||c.__owl__?.status===2){s.widgets=fieldWidgets(s);c=s.widgets.get(name);}
    const p=c?.m2oProps;if(!p||typeof p.domain!=='function'||!p.relation)throw Error('api');
    return {...p,domain:plain(p.domain()),context:plain(p.context||s.record.context)};
}
async function resolve(s,name,route,valid){
    if(!valid()||!editable(s))throw Error('changed');
    const p=fieldProps(s,name);if(p.readonly)throw Error('readonly');
    const text=route[{location_id:'src',location_dest_id:'dst',picking_type_id:'type',partner_id:'partner'}[name]];
    if(name==='partner_id'&&text==='')return false;
    const cached=route.ids?.[name];const domain=Core.clone(p.domain);
    if(Core.id(cached))domain.push(['id','=',cached]);
    const candidates=await rpc.call(p.relation,'name_search',[Core.id(cached)?'':text,domain,Core.id(cached)?'ilike':'=',3],{context:p.context},valid);
    const exact=Core.id(cached)?candidates.filter(x=>x[0]===cached):candidates.filter(x=>norm(x[1])===norm(text));
    if(exact.length!==1||!Core.id(exact[0][0]))throw Error('domain');
    return {id:exact[0][0],display_name:exact[0][1]};
}
async function boundedUpdate(s,values,valid,original=s.originalUpdate){
    if(!valid()||!editable(s))throw Error('changed');
    let timer;
    try{
        s.pendingNative=(s.pendingNative||0)+1;
        const settled=()=>{s.pendingNative--;if(state===s)render();};
        const native=Promise.resolve().then(()=>original.call(s.record,values,{save:false})).then(value=>{settled();return value;},error=>{settled();error.pbNativeUpdate=true;throw error;});
        await Promise.race([native,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),15000);})]);
        if(!valid()||!editable(s))throw Error('changed');
    }finally{clearTimeout(timer);}
}
function verifyDetails(s,wanted){
    for(const [k,id] of Object.entries(wanted))if(relationId(s.record.data[k])!==id)throw Error('mismatch');
    const moves=s.record.data.move_ids_without_package||s.record.data.move_ids;
    if(!moves?.records)return false;
    let complete=(!Number.isFinite(moves.count)||moves.records.length===moves.count);
    for(const line of moves.records){
        if(['done','cancel'].includes(line.data.state))continue;
        for(const k of ['location_id','location_dest_id']){
            if(!(k in line.data)){complete=false;continue;}
            if(wanted[k]&&relationId(line.data[k])!==wanted[k])throw Error('mismatch');
        }
    }
    return complete;
}
async function apply(route){
    const s=state;if(!s||!ready(s))return;
    const epoch=++s.epoch;const valid=()=>alive(s,epoch);s.busyEpoch=epoch;s.busy=true;s.error=false;s.message='busy';render();
    try{
        // Domains can depend on operation type/contact, so resolve against the updated native form at each stage.
        const wanted={};
        for(const name of ['picking_type_id','partner_id']){
            if(name==='partner_id'&&!Object.hasOwn(route,'partner'))continue;
            if(name==='picking_type_id'&&!route.type)continue;
            const value=await resolve(s,name,route,valid);wanted[name]=relationId(value);
            if(relationId(s.record.data[name])!==relationId(value))await boundedUpdate(s,{[name]:value},valid);
        }
        const source=await resolve(s,'location_id',route,valid),dest=await resolve(s,'location_dest_id',route,valid);
        wanted.location_id=relationId(source);wanted.location_dest_id=relationId(dest);
        await boundedUpdate(s,{location_id:source,location_dest_id:dest},valid);
        if(!valid())return;verifyDetails(s,wanted);s.message='applied';s.error=false;
        const prefs=latestPrefs(s),i=prefs.routes.findIndex(x=>signature(x)===signature(route));
        if(i>=0){prefs.routes[i]={...prefs.routes[i],ids:snapshot(s).ids};if(!store.set(s.key,JSON.stringify(prefs)))s.message='storage';s.prefs=prefs;}
    }catch(e){if(valid()){s.error=true;s.message=e.code||e.message||'failed';}}
    finally{if(s.busyEpoch===epoch)s.busy=false;if(valid())render(true);}
}
function hook(s){
    const r=s.record;s.originalUpdate=r.update;s.originalDiscard=r.discard;
    s.updateWrapper=async function(changes,options){
        if(!alive(s)||!s.prefs.protect||!editable(s)||s.error||s.pendingNative>0||options?.save||!Object.hasOwn(changes,'partner_id')||Object.hasOwn(changes,'picking_type_id')){
            if(s.busy){++s.epoch;s.busy=false;s.error=true;s.message='changed';}
            return s.originalUpdate.call(this,changes,options);
        }
        if(s.busy){++s.epoch;s.busy=false;s.error=true;s.message='changed';return s.originalUpdate.call(this,changes,options);}
        const before=snapshot(s);
        if(!Core.id(before.ids.location_id)||!Core.id(before.ids.location_dest_id))return s.originalUpdate.call(this,changes,options);
        const epoch=++s.epoch,valid=()=>alive(s,epoch);s.busyEpoch=epoch;s.busy=true;s.error=false;render();
        try{
            // Do not suppress native onchange values: preserve native business constraints and movement recomputation.
            await boundedUpdate(s,{...changes},valid);
            const src=await resolve(s,'location_id',before,valid),dst=await resolve(s,'location_dest_id',before,valid);
            await boundedUpdate(s,{location_id:src,location_dest_id:dst},valid);
            if(valid()){verifyDetails(s,{location_id:before.ids.location_id,location_dest_id:before.ids.location_dest_id});s.message='checked';}
        }catch(e){if(valid()){s.error=true;s.message=e.code||e.message||'failed';}if(e.pbNativeUpdate)throw e;}
        finally{if(s.busyEpoch===epoch)s.busy=false;if(valid())render();}
    };
    s.discardWrapper=async function(...args){++s.epoch;s.discarding=true;s.busy=false;s.error=false;s.message='';try{return await s.originalDiscard.apply(this,args);}finally{s.discarding=false;if(state===s){s.message='';render();}}};
    r.update=s.updateWrapper;if(typeof s.originalDiscard==='function')r.discard=s.discardWrapper;
}
function unhook(s){if(!s)return;++s.epoch;s.busy=false;if(s.record.update===s.updateWrapper)s.record.update=s.originalUpdate;if(s.record.discard===s.discardWrapper)s.record.discard=s.originalDiscard;}
function ready(s){if(!alive(s)||!editable(s)){s.message='readonly';render();return false;}if(s.busy||s.pendingNative>0||s.error||s.form.querySelector('.o_field_widget input[aria-expanded="true"]')){s.message=s.error?s.message:'choose';render();return false;}return true;}
function askName(value){return new Promise(resolve=>{
    const d=element('dialog',null,{className:'pb-route-name-dialog'}),form=element('form');
    const caption=element('label',t('name')),input=element('input',null,{type:'text',maxlength:80,'aria-label':t('name')});input.value=value.slice(0,80);caption.append(input);
    const actions=element('div',null,{className:'pb-name-actions'}),cancel=actionButton(t('cancel'),()=>d.close()),save=element('button',t('nameSave'),{type:'submit'});actions.append(cancel,save);form.append(caption,actions);d.append(form);
    let result=null;form.addEventListener('submit',event=>{event.preventDefault();result=norm(input.value).slice(0,80);d.close();});
    document.body.append(d);d.addEventListener('close',()=>{d.remove();resolve(result);},{once:true});d.showModal();input.focus();input.select();
});}
async function saveCurrent(){
    const s=state;if(!s||!ready(s))return;const snap=snapshot(s),epoch=s.epoch,raw=store.get(s.key);
    if(!snap.src||!snap.dst||!snap.type||snap.src===snap.dst){s.message='choose';render();return;}
    try{const prefs=latestPrefs(s);let index=prefs.routes.findIndex(r=>r.src===snap.src&&r.dst===snap.dst&&r.type===snap.type&&(r.partner===snap.partner||r.partner===undefined));
        if(index<0&&prefs.routes.length>=12){s.message='limit';render();return;}
        const name=await askName(index<0?label(snap):label(prefs.routes[index]));if(name===null)return;
        if(!alive(s,epoch)||s.busy||store.get(s.key)!==raw||signature(snapshot(s))!==signature(snap)){s.message='changed';render();return;}
        const route={...snap,name};if(index<0)prefs.routes.push(route);else prefs.routes[index]=route;save(s,prefs);
    }catch{s.message='invalid';s.invalid=true;render();}
}
async function rename(route){const s=state;if(!s||s.busy)return;const epoch=s.epoch,raw=store.get(s.key);const name=await askName(label(route));if(name===null)return;
    if(!alive(s,epoch)||s.busy||store.get(s.key)!==raw){if(state===s){s.message='changed';render();}return;}
    try{const p=latestPrefs(s),i=p.routes.findIndex(x=>signature(x)===signature(route));if(i<0)return;p.routes[i]={...p.routes[i],name};save(s,p);}catch{s.message='invalid';s.invalid=true;render();}}
function addOriginalRouteStyle(){
    if(document.getElementById('pb-routes-original-style-122'))return;
    const style=element('style',null,{id:'pb-routes-original-style-122'});style.textContent="\n    #pb-routes-119{position:sticky;top:var(--pb-statusbar-height,49px);z-index:5;background:var(--o-view-background-color,#fff);border:1px solid #d6dddf;border-left:3px solid #087e8b;border-radius:5px;padding:10px 13px;margin:0 0 16px;color:var(--o-main-text-color,#24343b)}\n    #pb-routes-119 .pb-route{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:17px;font-weight:600}\n    #pb-routes-119 .pb-label{font-size:12px;font-weight:400;color:#627279}\n    #pb-routes-119 .pb-arrow{font-size:22px;color:#087e8b}\n    #pb-routes-119 .pb-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;font-size:13px}\n    #pb-routes-119 button{border:1px solid #cbd5d8;border-radius:4px;padding:4px 9px;background:transparent;color:inherit;cursor:pointer}\n    #pb-routes-119 button:hover{background:#f2f6f7}\n    #pb-routes-119 button:focus-visible{outline:2px solid #087e8b;outline-offset:2px}\n    #pb-routes-119 button:disabled{opacity:.5;cursor:default}\n    #pb-routes-119 .pb-message{font-size:13px;margin-top:7px;min-height:18px}\n    #pb-routes-119[data-warning=\"true\"] .pb-message{color:#a74912;font-weight:600}\n    #pb-routes-119 .pb-favorites{display:flex;gap:6px;flex-wrap:wrap;align-items:center}\n    #pb-routes-119 .pb-favorite{display:inline-flex;border:1px solid #cbd5d8;border-radius:4px}\n    #pb-routes-119 .pb-favorite button{border:0;border-radius:0}\n    #pb-routes-119 .pb-favorite button+button{border-left:1px solid #cbd5d8}\n    #pb-routes-119 .pb-favorites{display:flex!important;visibility:visible!important}\n    #pb-routes-119{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 12px}\n    #pb-routes-119 .pb-actions{margin-top:0}\n    #pb-routes-119 .pb-favorites{grid-column:1/-1}\n    #pb-routes-119 .pb-message,#pb-routes-119 details{margin-top:0}\n    .o_form_sheet:has(>#pb-routes-119)>.oe_title h1{font-size:25px;margin-bottom:12px}\n    #pb-routes-119 details[open]{grid-column:1/-1}\n    @media(max-width:700px){#pb-routes-119{padding:8px}#pb-routes-119 .pb-route{font-size:15px!important}}\n    @media(max-width:700px){#pb-routes-119{grid-template-columns:1fr}#pb-routes-119 .pb-favorites{grid-column:1}}\n    .pb-route-name-dialog{border:1px solid #cbd5d8;border-radius:8px;padding:18px;width:min(420px,90vw);color:var(--o-main-text-color,#24343b);background:var(--o-view-background-color,#fff)}\n    .pb-route-name-dialog::backdrop{background:#0005}\n    .pb-route-name-dialog label{display:block;font-weight:600}\n    .pb-route-name-dialog input{display:block;width:100%;margin-top:10px;padding:7px;border:1px solid #cbd5d8;border-radius:4px}\n    .pb-name-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}\n    .pb-name-actions button{padding:5px 14px;border:1px solid #cbd5d8;border-radius:4px}\n    .pb-name-actions button[type=submit]{background:#087e8b;color:white}\n    @media print{#pb-routes-119{display:none!important}}\n  ";document.head.append(style);
}

function render(force=false){
    const s=state;if(!s)return;
    const top=(s.form.querySelector('.o_form_statusbar')?.offsetHeight||0)+'px';if(s.panel.style.getPropertyValue('--pb-statusbar-height')!==top)s.panel.style.setProperty('--pb-statusbar-height',top);
    const current=snapshot(s),key=JSON.stringify([current,s.prefs,s.message,s.error,s.busy,s.pendingNative||0,editable(s),language.get()]);if(!force&&key===s.renderKey)return;s.renderKey=key;
    s.source.textContent=current.src||t('source');s.dest.textContent=current.dst||t('dest');
    s.panel.dataset.warning=String(s.error||!!(current.src&&current.src===current.dst));
    s.messageEl.textContent=s.busy?t('busy'):s.message?t(s.message):current.src===current.dst&&current.src?t('same'):'';s.messageEl.hidden=!s.messageEl.textContent;
    s.checkbox.checked=s.prefs.protect;s.checkbox.setAttribute('aria-label',t('protect'));s.checkbox.disabled=s.busy||s.invalid||!editable(s);
    s.saveButton.disabled=s.busy||s.pendingNative>0||s.error||s.invalid||!editable(s);
    s.checkButton.hidden=!s.error;s.checkButton.disabled=s.busy||s.pendingNative>0;
    s.favorites.replaceChildren();s.favorites.append(element('span',t('routesLabel'),{className:'pb-label'}));
    if(!s.prefs.routes.length)s.favorites.append(element('span',t('empty'),{className:'pb-label'}));
    for(const route of s.prefs.routes){
        const row=element('span',null,{className:'pb-favorite'}),b=actionButton(label(route),()=>apply(route));b.dataset.pbApply='';b.disabled=s.busy||s.pendingNative>0||s.error||!editable(s);b.title=route.src+' → '+route.dst+'\n'+route.type+'\n'+t('contactLabel')+': '+(route.partner===undefined?t('oldPartner'):route.partner||t('noPartner'));
        const edit=actionButton('✎',()=>rename(route));edit.title=t('rename');edit.setAttribute('aria-label',t('rename')+' '+label(route));edit.disabled=s.busy||s.invalid;
        const del=actionButton('×',()=>{if(!alive(s)||s.busy)return;try{const p=latestPrefs(s);p.routes=p.routes.filter(x=>signature(x)!==signature(route));save(s,p);}catch{s.invalid=true;s.message='invalid';render();}});del.title=t('remove');del.setAttribute('aria-label',t('remove')+' '+label(route));del.disabled=s.busy||s.invalid;
        row.append(b,edit,del);s.favorites.append(row);
    }
}
function mount(c){
    addOriginalRouteStyle();const form=c.rootRef.el.querySelector('.o_form_sheet')?.closest('.o_form_view')||c.rootRef.el.closest('.o_form_view');const sheet=form?.querySelector('.o_form_sheet');if(!sheet)return;
    const record=c.model.root;state={controller:c,record,form,sheet,action:services().action.currentController,recordKey:record.id+':'+record.resId,scope:environmentKey(),epoch:0,busy:false,discarding:false,error:false,message:'',renderKey:''};const s=state;load(s);s.widgets=fieldWidgets(s);
    const panel=element('section',null,{id:'pb-routes-119','aria-label':t('title')});s.panel=panel;
    s.direction=element('div',null,{className:'pb-route'});s.source=element('span',null,{className:'pb-src'});s.dest=element('span',null,{className:'pb-dst'});s.direction.append(s.source,element('span','→',{className:'pb-arrow'}),s.dest);panel.append(s.direction);
    const actions=element('div',null,{className:'pb-actions'}),label=element('label');s.checkbox=element('input',null,{type:'checkbox','aria-label':t('protect')});s.checkbox.addEventListener('change',()=>{if(!alive(s)||s.busy)return;try{const p=latestPrefs(s);p.protect=s.checkbox.checked;save(s,p);}catch{s.message='invalid';s.invalid=true;render();}});s.protectText=document.createTextNode(' '+t('protect'));label.append(s.checkbox,s.protectText);actions.append(label);
    s.saveButton=actionButton(t('save'),saveCurrent);s.saveButton.dataset.pbSave='';s.checkButton=actionButton(t('check'),()=>{if(!alive(s)||s.busy)return;if(s.pendingNative>0){s.message='timeout';render();return;}try{const wanted=snapshot(s).ids;const full=verifyDetails(s,wanted);s.error=false;s.message=full?'checked':'partialCheck';}catch(e){s.error=true;s.message=e.message;}render();});s.checkButton.dataset.pbAdopt='';actions.append(s.saveButton,s.checkButton);panel.append(actions);
    s.favorites=element('div',null,{className:'pb-favorites'});s.messageEl=element('div',null,{className:'pb-message',role:'status','aria-live':'polite'});panel.append(s.favorites,s.messageEl);sheet.prepend(panel);hook(s);document.documentElement.setAttribute('data-pb-addon-routes',VERSION);render(true);
}
function leave(){if(!state)return;unhook(state);state.panel.remove();state=null;controller=null;}
function tick(){
    if(document.hidden)return;const action=services()?.action?.currentController;
    if(action?.action?.res_model!=='stock.picking'){leave();lastAction=action;return;}
    if(lastAction!==action||!controller?.rootRef?.el?.isConnected){leave();controller=findController('stock.picking','form');lastAction=action;}
    if(!controller)return;if(!state){mount(controller);return;}
    if(state.record!==controller.model.root||state.recordKey!==controller.model.root.id+':'+controller.model.root.resId||state.scope!==environmentKey()){leave();controller=findController('stock.picking','form');if(controller)mount(controller);return;}
    if(!state.panel.isConnected)state.sheet.prepend(state.panel);render();
}
function protectCommit(event){
    const s=state;if(!s||!s.form.contains(event.target)||event.target.closest('.modal,.o_dialog')||s.panel.contains(event.target))return;
    if(event.target.closest('.o_form_button_cancel,button[special="cancel"]'))return;
    const button=event.target.closest('button'),commit=button?.matches('.o_form_button_save,[name="action_confirm"],[name="button_validate"],[name="action_assign"]');
    const keyboard=event.type==='keydown'&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s';
    if((commit||keyboard)&&(s.busy||s.error)){event.preventDefault();event.stopImmediatePropagation();s.message=s.error?s.message:'warning';render();}
}
document.addEventListener('click',protectCommit,true);document.addEventListener('keydown',protectCommit,true);
window.addEventListener('storage',event=>{if(state&&event.key===state.key){load(state);render(true);}});
language.subscribe(()=>{if(!state)return;state.panel.setAttribute('aria-label',t('title'));state.saveButton.textContent=t('save');state.checkButton.textContent=t('check');state.protectText.textContent=' '+t('protect');render(true);});
const timer=setInterval(tick,700);window.addEventListener('pagehide',()=>{clearInterval(timer);leave();language.dispose();document.removeEventListener('click',protectCommit,true);document.removeEventListener('keydown',protectCommit,true);},{once:true});tick();

})();

// ==UserScript==
// @name         Playbox Odoo - 历史库存查询
// @namespace    playbox.stock.history
// @version      1.0.26
// @description  修复滚动时数字透过表头；历史列采用原生表格单元格与间距，保留原版数字字体配色。
// @author       Playbox
// @license      MIT
// @match        https://*.odoo.com/odoo*
// @match        https://*.odoo.com/web*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==
// Source: user-supplied Odoo Stock History RPC (V23.88 SearchBar Ultra), metadata 23.89.

(function(){
    'use strict';
    if(window.top!==window.self||location.protocol!=='https:'||!location.hostname.endsWith('.odoo.com')||!/^\/(odoo|web)(?:\/|$)/.test(location.pathname))return;
    if(document.documentElement.hasAttribute('pb-addon-history-instance'))return;
    document.documentElement.setAttribute('pb-addon-history-instance','1.0.26');
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
const VERSION = '1.0.26';
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

const HistoryAuto123=(function(){const module={exports:{}};
'use strict';
const id=n=>Number.isSafeInteger(n)&&n>0;
const rid=value=>Number(Array.isArray(value)?value[0]:value?.id)||0;
const empty=()=>({required:new Set(),references:new Set()});
function explicit(context={},domain=[]){
    for(const value of [context.location,context.search_location,context.active_model==='stock.location'?context.active_id:null]){
        if(id(value))return {kind:'location',id:value,reason:'context'};
        if(Array.isArray(value)&&value.length)return {kind:'ambiguous'};
    }
    let visited=0;
    const merge=(a,b,or=false)=>({required:new Set(or?[...a.required].filter(x=>b.required.has(x)):[...a.required,...b.required]),references:new Set([...a.references,...b.references])});
    const parse=(list,depth=0)=>{
        if(depth>24||!Array.isArray(list)||visited>1000)throw Error('domain');
        let index=0;
        const next=()=>{
            if(++visited>1000||index>=list.length)throw Error('domain');
            const token=list[index++];
            if(token==='!'){next();return empty();}
            if(token==='&'||token==='|'){const a=next(),b=next();return merge(a,b,token==='|');}
            if(!Array.isArray(token))return empty();
            if(typeof token[0]==='string'&&token.length===3&&!['&','|','!'].includes(token[0])){
                const [field,op,value]=token;
                if(!['location_id','location_dest_id'].includes(field))return empty();
                const ids=['=','child_of'].includes(op)&&id(value)?[value]:['in','child_of'].includes(op)&&Array.isArray(value)&&value.every(id)?[...new Set(value)]:[];
                return {required:new Set(ids.length===1?ids:[]),references:new Set(ids)};
            }
            return parse(token,depth+1);
        };
        let result=empty();while(index<list.length)result=merge(result,next());return result;
    };
    try{
        const parsed=parse(domain);
        if(parsed.required.size===1)return {kind:'location',id:[...parsed.required][0],reason:'domain'};
        if(parsed.required.size>1||parsed.references.size>1)return {kind:'ambiguous'};
    }catch{return {kind:'ambiguous'};}
    return {kind:'none'};
}
function rowChoice(lines,locations,companies){
    const sample=lines.slice(0,30),byId=new Map(locations.map(l=>[l.id,l])),counts=new Map();
    for(const line of sample)for(const field of ['location_id','location_dest_id']){
        const value=rid(line[field]);if(!id(value))continue;
        const location=byId.get(value);if(!location)return {kind:'unreadable'};
        if(location.usage!=='internal'||rid(location.company_id)&&!companies.includes(rid(location.company_id)))continue;
        counts.set(value,(counts.get(value)||0)+1);
    }
    const ranked=[...counts].sort((a,b)=>b[1]-a[1]);
    if(sample.length===1&&ranked.length>1)return {kind:'ambiguous'};
    if(ranked.length&&ranked[0][1]>sample.length*2*0.4){
        if(ranked[1]?.[1]===ranked[0][1])return {kind:'ambiguous'};
        return {kind:'location',id:ranked[0][0],reason:'rows',record:byId.get(ranked[0][0])};
    }
    return {kind:'company',reason:'company'};
}
function upgrade(prefs){
    if(prefs.autoSetup===1)return {changed:false,prefs};
    const next={...prefs,auto:true,autoSetup:1};delete next.selection;
    return {changed:true,prefs:next};
}
class Scheduler{
    constructor({key,eligible,fire,setTimer,clearTimer,delay=600}){Object.assign(this,{key,eligible,fire,setTimer,clearTimer,delay});this.timer=null;this.timerKey='';this.attempt='';this.stopped='';}
    cancel(){if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;this.timerKey='';}
    update(){
        const key=this.key();if(!key||!this.eligible()){this.cancel();return;}
        if(key===this.attempt||key===this.stopped){this.cancel();return;}
        if(this.timer!==null&&this.timerKey===key)return;
        this.cancel();this.timerKey=key;
        this.timer=this.setTimer(()=>{this.timer=null;this.timerKey='';if(!this.eligible()||this.key()!==key){this.update();return;}this.attempt=key;this.fire();},this.delay);
    }
    manual(){this.cancel();this.attempt=this.key();this.stopped='';}
    stop(){this.cancel();this.stopped=this.key();}
    reset(){this.cancel();this.attempt='';this.stopped='';}
}
module.exports={explicit,rowChoice,upgrade,Scheduler};

return module.exports;})();
/* Model-based history module. Business records are read-only. */
const DICT = {
 timeMode:['查询时间','Fecha de consulta'],dailyHelp:['日常只需勾选「历史数量」；另外两列仅供参考。','Para el uso habitual basta Exist. históricas; las otras dos columnas son referencias.'],rowsHelp:['每行按对应出入库记录的时间查询；同一秒的记录可能相同，不是逐笔累加余额。','Cada línea usa la fecha de su movimiento; los registros del mismo segundo pueden coincidir y no son saldos secuenciales.'],fixedHelp:['当前页的商品统一查你指定的时间；同一商品去重显示在下方面板，不把历史数量相加。','Consulta los productos de esta página a una misma fecha; cada producto se muestra una vez en el panel inferior, sin sumar saldos históricos.'],

 autoLocation:['自动识别库位','Detectar ubicación'],autoShort:['自动','Auto'],refreshShort:['刷新','Actualizar'],settingsShort:['设置','Ajustes'],diagnostics:['查询详情 / 调试','Detalles / diagnóstico'],companyShort:['公司仓库','Almacenes de la empresa'],detectingShort:['识别 / 查询中','Detectando / consultando'],doneShort:['完成','Listo'],chooseTimeShort:['请选择时间','Elija una fecha'],ambiguousLocation:['库位不唯一，请选择','Varias ubicaciones; elija una'],

 handShort:['历史数量','Exist. históricas'],actShort:['扣除待发货（参考）','Menos por enviar (ref.)'],virtShort:['预计结余（参考）','Saldo previsto (ref.)'],
 successCount:['已查询','Consultadas'],cacheCount:['缓存','Caché'],failedCount:['失败','Fallidas'],confirmCount:['待确认','Por confirmar'],unqueriedCount:['待查询','Sin consultar'],
 chooseFirst:['先选择查询库位，或明确使用当前公司仓库范围。','Elija una ubicación o confirme los almacenes de las empresas activas.'],
 queryHint:['库位已确认，点击「查询 / 刷新」显示库存。','Ubicación confirmada. Pulse Consultar / actualizar.'],
 hiddenColumns:['库存列均已关闭，请至少勾选一项。','Todas las columnas están ocultas; active al menos una.'],
 rowHint:['历史数量在数量右侧；点击可看查询时间、库位和单位。','Las existencias históricas están junto a la cantidad; pulse para ver fecha, ubicación y unidad.'],
 fixedHint:['当前为指定时点摘要，结果显示在下方面板，不写入移动历史列。','Resumen a una fecha: los resultados aparecen abajo, no en las líneas de movimientos.'],
 floating:['浮动面板','Panel flotante'],docked:['固定到列表上方','Acoplar encima de la lista'],readonly:['只读查询','Solo consulta'],
 more:['更多工具','Más herramientas'],display:['显示库存列','Columnas de existencias'],basis:['查询范围','Alcance'],
 noRows:['当前列表没有可查询明细；展开分组或切换到明细列表。','No hay líneas consultables. Expanda un grupo o abra la lista de detalles.'],
 failedView:['无法对应当前原生列表；请重开列表后重试。','No se pudo vincular la lista. Ábrala de nuevo y reintente.'],

 title:['历史库存查询','Consulta de existencias históricas'],query:['查询 / 刷新','Consultar / actualizar'],pause:['暂停','Pausar'],resume:['继续','Continuar'],stop:['停止','Detener'],retry:['重试失败项','Reintentar fallidas'],
 location:['选择库位','Elegir ubicación'],all:['当前公司仓库范围','Almacenes de las empresas activas'],follow:['跟随当前页面','Seguir la vista actual'],children:['包含子库位','Incluir sububicaciones'],exact:['仅此库位','Solo esta ubicación'],yes:['是','Sí'],no:['否','No'],manual:['手动','Manual'],scope:['范围待确认','Alcance por confirmar'],stale:['结果已超过5分钟，请刷新','Los resultados tienen más de 5 minutos; actualice'],
 hand:['所选库位在查询时间的在手数量；日常查库存勾这一项即可。','Existencias de la ubicación a la fecha consultada; basta esta columna para la consulta habitual.'],act:['历史数量减去 Odoo 本次返回的待出库数量，仅供参考，不代表当时可售数量。','Existencias históricas menos salidas pendientes devueltas por Odoo; referencia, no disponibilidad histórica.'],virt:['历史数量减待出库、加待入库，仅供参考，不代表当时实际库存。','Existencias históricas menos salidas pendientes más entradas pendientes; referencia, no existencias históricas reales.'],settings:['显示与设置','Presentación y ajustes'],auto:['翻页自动查询','Consultar al cambiar de página'],dark:['深色','Oscuro'],collapsed:['折叠','Contraer'],reset:['恢复位置','Restablecer posición'],clear:['清查询缓存','Borrar caché de consultas'],
 rows:['按每笔出入库的时间','Fecha de cada movimiento'],fixed:['统一查询指定时间','Consultar todos a una misma fecha'],now:['当前时刻','Ahora'],yesterday:['昨天结束','Fin de ayer'],date:['日期时间（Odoo 时区）','Fecha y hora (zona de Odoo)'],
 total:['按产品总量查询（忽略已提示的细分条件）','Consultar total del producto (omitir dimensiones indicadas)'],omitted:['未应用细分条件','Dimensiones omitidas'],unsupported:['当前细分范围不支持；请确认是否查询产品总量','Dimensiones no compatibles; confirme el total del producto'],
 idle:['待查询','Sin consultar'],running:['查询中','Consultando'],paused:['暂停','En pausa'],stopped:['已停止','Detenido'],success:['服务器已刷新','Actualizado desde el servidor'],complete:['完成','Completado'],cache:['缓存（5 分钟有效）','Caché (vigencia de 5 minutos)'],failed:['失败','Fallida'],confirm:['待确认','Por confirmar'],unqueried:['未查询','Sin consultar'],partial:['部分完成','Completado parcialmente'],
 storage:['浏览器未保存成功；本次仅保留在内存，请保留旧配置','No se guardó en el navegador; solo en memoria. Conserve la configuración anterior'],invalid:['旧设置无法读取，已保留原值；未覆盖','No se pudo leer la configuración anterior; se conservó sin sobrescribir'],
 close:['关闭','Cerrar'],search:['搜索完整库位名称','Buscar nombre completo de ubicación'],recent:['最近使用','Recientes'],favorites:['常用库位（最多 10 个）','Favoritos (máximo 10)'],favorite:['收藏 / 取消收藏','Agregar / quitar favorito'],empty:['无可用结果','Sin resultados disponibles'],details:['查看详情','Ver detalles'],issues:['问题与负库存','Problemas y existencias negativas'],next:['下一条问题','Siguiente problema'],
 copy:['复制本次结果','Copiar estos resultados'],csv:['导出 CSV','Exportar CSV'],copied:['已复制','Copiado'],unit:['库存单位','Unidad de inventario'],product:['产品','Producto'],company:['公司范围','Empresas'],time:['UTC 截止时间','Fecha límite UTC'],zone:['时区','Zona horaria'],source:['来源','Origen'],acquired:['取得时间','Fecha de consulta'],status:['状态','Estado'],raw:['诊断原始数据','Datos de diagnóstico'],
 explanation:['在手按查询时数据库记录回溯，历史更正后可能变化；同秒多行可相同，不代表逐笔余额。参考列采用查询时仍待处理的移动，不代表当时可售/预留。','Las existencias se reconstruyen con los registros actuales y pueden cambiar por correcciones. Varias líneas del mismo segundo pueden coincidir; no son saldos secuenciales. Las referencias usan movimientos pendientes actuales, no disponibilidad ni reservas históricas.'],
 noLink:['原生核对入口尚未验证；请在原生库存报告中按相同条件核对','Acceso nativo no verificado; compare en el informe nativo con las mismas condiciones'],
 permission:['无读取权限','Sin permiso de lectura'],session:['会话已失效，请重新登录','La sesión expiró; inicie sesión'],timeout:['查询超时，已停止派发；请稍后手动重试','Tiempo agotado; se detuvieron nuevas consultas. Reintente manualmente'],network:['网络或服务响应异常','Error de red o del servidor'],context:['上下文未就绪','Contexto no disponible'],api:['原生接口未就绪','Interfaz nativa no disponible'],
 'missing-field':['字段缺失或数值无效','Campo ausente o valor inválido'],emptyRecord:['记录不可读或已不存在','Registro no accesible o inexistente'],notDone:['计划 / 取消记录不代表已发生库存变化','Un movimiento pendiente o cancelado no representa existencias realizadas'],
 invalidTime:['时间缺失、无效或在未来','Fecha ausente, inválida o futura'],precision:['保留服务器数值；原生库存单位舍入精度','Se conserva el valor del servidor; redondeo de la unidad'],scopeChanged:['范围已变化，请重新查询','Cambió el alcance; vuelva a consultar'],notAvailable:['不可用','No disponible'],negative:['负库存','Existencias negativas'],
 locationInvalid:['该库位不可读或不属于当前公司范围，请重新选择','Ubicación no accesible o fuera de las empresas activas; elija otra'],busy:['请等待当前操作完成','Espere a que termine la operación'],exportEmpty:['当前页还没有查询结果','No hay resultados consultados en esta página'],
 'usage-internal':['内部','Interna'],'usage-view':['上级位置','Vista'],'usage-customer':['客户','Cliente'],'usage-supplier':['供应商','Proveedor'],'usage-inventory':['盘点/损耗','Ajuste de inventario'],'usage-transit':['中转','Tránsito'],'usage-production':['生产','Producción'],
};
const store=new Core.Store(localStorage,()=>notice('storage'));
const language=PBLanguage.create({storage:localStorage,bus:window,eventFactory:(name,detail)=>new CustomEvent(name,{detail})});
const t=key=>DICT[key]?.[language.get()==='es-MX'?1:0]||DICT.notAvailable[language.get()==='es-MX'?1:0];
const rpc=createRPC(),cache=new Core.Cache();
let controller=null,controllerAction=null,panel=null,output=null,statusEl=null,basisEl=null,viewKey='',epoch=0,preparing=false,dragCleanup=null,renderFrame=null;
let prefs=null,prefKey='',scopeSelection={mode:'follow'},fixedUTC=null,metadata=[],items=[],lastError='',persistDisabled=false,issueIndex=0;
let resolvedAutoScope=null;
const defaults={schema:1,hand:true,act:false,virt:false,auto:true,dark:false,collapsed:false,children:true,mode:'rows',total:false,favorites:[],recent:[]};
function prefsValid(p){return p?.schema===1&&(!Object.hasOwn(p,'floating')||typeof p.floating==='boolean')&&(!Object.hasOwn(p,'autoSetup')||p.autoSetup===1)&&['hand','act','virt','auto','dark','collapsed','children','total'].every(k=>typeof p[k]==='boolean')&&['rows','fixed'].includes(p.mode)&&Array.isArray(p.favorites)&&p.favorites.length<=10&&p.favorites.every(Core.id)&&Array.isArray(p.recent)&&p.recent.length<=10&&p.recent.every(Core.id);}
function businessScope(){try{const r=currentController()?.model.root;return r?JSON.stringify([r.resModel,plain(r.domain||[]),plain(r.context||{})]):'';}catch{return '';}}
function rememberScope(){prefs.selection={...scopeSelection,business:businessScope()};savePrefs();}
function restoreScope(){const p=prefs.selection;scopeSelection=p&&p.business===businessScope()&&(['auto','follow','all'].includes(p.mode)||p.mode==='manual'&&Core.id(p.id)&&typeof p.label==='string')?Core.clone(p):{mode:'auto'};}
function notice(code){lastError=code;if(statusEl)statusEl.textContent=t(code);}
function savePrefs(){if(persistDisabled){notice('invalid');return false;}return store.set(prefKey,JSON.stringify(prefs));}
function loadPrefs(){
    prefKey=scopedStorageKey('history');persistDisabled=false;
    try{
        if(store.get(prefKey)===null){
            const mapping={hand:'odoo_show_hand',act:'odoo_show_act',virt:'odoo_show_virt',auto:'odoo_auto_query_v23',collapsed:'odoo_ui_collapsed'};
            const legacy={},next=Core.clone(defaults);let found=false;
            for(const [k,key] of Object.entries(mapping)){const raw=store.get(key);if(raw!==null){legacy[key]=raw;if(!['true','false'].includes(raw))throw Error('invalid');next[k]=raw==='true';found=true;}}
            const theme=store.get('odoo_stock_theme_mode');if(theme!==null){legacy.odoo_stock_theme_mode=theme;if(!['dark','light'].includes(theme))throw Error('invalid');next.dark=theme==='dark';found=true;}
            if(found){if(!Object.hasOwn(legacy,'odoo_show_act'))next.act=true;store.migrate(prefKey,next,legacy,prefsValid);prefs=next;}else prefs=Core.clone(defaults);
        }else prefs=store.read(prefKey,defaults,prefsValid);
    }catch{prefs=Core.clone(defaults);persistDisabled=true;notice('invalid');}
    ensureAutomaticDefaults();
    try{cache.restore(JSON.parse(store.get(prefKey+':cache')||'null'));}catch{/* cache is disposable */}
}
function currentController(){
    const action=services()?.action?.currentController,model=action?.action?.res_model;
    if(!['stock.move.line','stock.move'].includes(model))return null;
    if(controllerAction===action&&controller?.model?.root?.resModel===model&&controller.rootRef?.el?.isConnected&&!controller.rootRef.el.closest('.modal,.o_dialog'))return controller;
    controllerAction=action;controller=findController(model,'list');return controller;
}
function fingerprint(){
    const c=currentController();if(!c)return '';
    const r=c.model.root;
    return JSON.stringify([environmentKey(),location.pathname,location.search,location.hash,r.resModel,Array.from(r.records||[],x=>[x.id,x.resId,relationId(x.data?.product_id),relationId(x.data?.location_id),relationId(x.data?.location_dest_id),x.data?.date?.toISO?.()||x.data?.date||'',x.data?.quantity,x.data?.state]),plain(r.domain||[]),plain(r.context||{})]);
}
const run=new Core.QueryRun({cache,valid:()=>!!panel?.isConnected&&fingerprint()===viewKey,update:()=>renderResults()});
function invalidate(reason='scopeChanged'){
    resolvedAutoScope=null;autoScheduler.cancel();epoch++;preparing=false;run.stop();items=[];metadata=[];run.items=[];lastError=reason;
    panel?.querySelectorAll('[data-pb-summary]')?.forEach(n=>n.remove());removeColumns();renderResults();scheduleAutomaticQuery();
}
function removeColumns(){document.querySelectorAll('[data-pb-history-column]').forEach(n=>n.remove());}
function pageSnapshot(){
    const c=currentController();if(!c)throw Error('context');const r=c.model.root;
    const entries=Array.from(r.records||[],record=>({point:record.id,id:record.resId})).filter(x=>Core.id(x.id));
    if(!entries.length)throw Error('empty');
    return {controller:c,model:r.resModel,entries,domain:plain(r.domain||[]),context:plain(r.context||{}),env:environment()};
}
function supportedScope(snapshot){
    if(scopeSelection.mode==='auto'){if(resolvedAutoScope?.view===fingerprint())return {...resolvedAutoScope.scope,label:resolvedAutoScope.scope.location===null?t('all'):resolvedAutoScope.scope.label};throw Error('scope');}
    if(scopeSelection.mode==='all')return {location:null,children:true,label:t('all')};
    if(scopeSelection.mode==='manual'&&Core.id(scopeSelection.id))return {location:scopeSelection.id,children:prefs.children,label:scopeSelection.label};
    // Only an explicit native inventory-context location is a calculation basis. List domains select rows.
    const loc=snapshot.context.location??snapshot.context.search_location;
    if(Core.id(loc))return {location:loc,children:prefs.children,label:'#'+loc};
    throw Object.assign(Error('scope'),{code:'scope'});
}
function facets(snapshot,line){
    const set=new Set();const keys=['lot_id','lot_name','owner_id','package_id','result_package_id'];
    const walk=x=>{if(!Array.isArray(x))return;if(typeof x[0]==='string'&&keys.some(k=>x[0].split('.').includes(k)))set.add(x[0]);else x.forEach(walk);};walk(snapshot.domain);
    for(const k of keys)if(snapshot.context[k]||snapshot.context['search_default_'+k]||line[k])set.add(k);
    return [...set].sort();
}
async function prepare(valid){
    const snap=pageSnapshot(),ctx=snap.env.context;
    if(!/^19\./.test(snap.env.version||''))throw Error('api');
    const fields=['product_id','company_id','date','state','location_id','location_dest_id'];
    if(snap.model==='stock.move.line')fields.push('move_id','lot_id','owner_id','package_id','result_package_id');
    const lines=await rpc.read(snap.model,snap.entries.map(x=>x.id),fields,ctx,valid);
    const scope=await resolveHistoryScope(snap,lines,valid);
    const byId=new Map(lines.map(x=>[x.id,x]));
    const moveIds=[...new Set(lines.map(x=>relationId(x.move_id)).filter(Core.id))];
    const moves=snap.model==='stock.move.line'&&moveIds.length?await rpc.read('stock.move',moveIds,['date','state','product_id'],ctx,valid):lines;
    const byMove=new Map(moves.map(x=>[x.id,x]));
    const productIds=[...new Set(lines.map(x=>relationId(x.product_id)).filter(Core.id))];
    const products=productIds.length?await rpc.read('product.product',productIds,['display_name','default_code','uom_id'],ctx,valid):[];
    const byProduct=new Map(products.map(x=>[x.id,x]));
    const unitIds=[...new Set(products.map(x=>relationId(x.uom_id)).filter(Core.id))];
    const units=unitIds.length?await rpc.read('uom.uom',unitIds,['name','rounding'],ctx,valid):[];
    const byUnit=new Map(units.map(x=>[x.id,x]));
    const rows=snap.entries.map(entry=>{
        const line=byId.get(entry.id),product=byProduct.get(relationId(line?.product_id));
        const move=snap.model==='stock.move.line'?byMove.get(relationId(line?.move_id)):line;
        const unit=byUnit.get(relationId(product?.uom_id));
        const at=prefs.mode==='fixed'?fixedUTC:move?.date;
        const omitted=facets(snap,line||{});
        let reason='';
        if(!line||!product||!unit||!move||relationId(move.product_id)!==product.id)reason='emptyRecord';
        else if(!Core.number(unit.rounding)||unit.rounding<=0)reason='missing-field';
        else if(prefs.mode==='rows'&&(line.state!=='done'||move.state!=='done'))reason='notDone';
        else if(!Core.utc(at)||new Date(at.replace(' ','T')+'Z').getTime()>Date.now())reason='invalidTime';
        else if(!snap.env.companies.includes(relationId(line.company_id)))reason='context';
        else if(omitted.length&&!prefs.total)reason='unsupported';
        return {...entry,line,move,product,unit,omitted,reason,scopeLabel:scope.label,env:snap.env,
            scope:{...snap.env,product:product?.id,unit:unit?.id,location:scope.location,children:scope.children,at,facets:[]}};
    });
    if(prefs.mode!=='fixed')return rows;
    // The summary is separate from the native movement table; never add historical balances together.
    const unique=new Map();for(const row of rows){const key=row.reason?row.id:Core.identity(row.scope);if(!unique.has(key))unique.set(key,row);else unique.get(key).omitted=[...new Set([...unique.get(key).omitted,...row.omitted])];}
    return [...unique.values()];
}
async function query(force=true,retry=false){
    if(document.hidden)return;autoScheduler.manual();if(scopeSelection.mode==='auto')resolvedAutoScope=null;
    const token=++epoch;run.stop();lastError='';preparing=true;viewKey=fingerprint();const requestStart=rpc.calls,started=performance.now();renderResults();
    const valid=()=>epoch===token&&fingerprint()===viewKey&&!!panel?.isConnected;
    try {
        const old=items;
        const prepared=await prepare(valid);if(!valid())return;
        metadata=prepared;const targets=retry?prepared.filter(x=>old.some(o=>o.id===x.id&&o.status==='failed'&&o.key===(!x.reason&&Core.identity(x.scope)))):prepared;
        if(retry&&!targets.length){preparing=false;items=old;run.items=old;renderResults();return;}items=targets;
        preparing=false;
        await run.run(items,async scope=>{
            const context={allowed_company_ids:scope.companies,uid:scope.uid,lang:environment().context.lang,tz:scope.tz,to_date:scope.at};
            if(scope.location!==null){context.location=scope.location;context.strict=!scope.children;}
            const started=Date.now();const result=await rpc.read('product.product',[scope.product],['qty_available','outgoing_qty','virtual_available'],context,valid);
            if(result.length!==1||result[0].id!==scope.product)throw Error('emptyRecord');
            return {data:Core.values(result[0]),started,finished:Date.now(),context};
        },{force});
        if(valid()){
            if(retry){const updated=new Map(items.map(x=>[x.id,x]));items=old.map(x=>updated.get(x.id)||x);run.items=items;}
            store.set(prefKey+':cache',JSON.stringify(cache.dump()));
            panel.dataset.pbHistoryMetrics=JSON.stringify({force,retry,rows:items.length,requests:rpc.calls-requestStart,stockRequests:run.requests,elapsedMs:Math.round(performance.now()-started),counts:run.counts(),at:new Date().toISOString()});renderResults();
        }
    }catch(e){if(valid()){items=[];run.items=[];notice(e.code||e.message);run.state='failed';}}
    finally{if(epoch===token){preparing=false;renderResults();}}
}
function amount(v,unit){
    if(v===null||!Core.number(v))return t('notAvailable');
    // Preserve meaningful server decimals, including a small negative quantity. Unit rounding is shown separately.
    return new Intl.NumberFormat(language.get(),{maximumSignificantDigits:17}).format(v)+' '+(unit?.name||'');
}
function detail(item){
    const box=element('div');box.append(element('h3',item.product?.display_name||t('emptyRecord')));
    const labels=[[t('company'),item.env?.companyLabels?.join(', ')||item.env?.companyName],[t('location'),item.scopeLabel],[t('children'),t(item.scope.children?'yes':'no')],[t('time'),item.scope.at],[t('zone'),item.env?.tz],[t('unit'),item.unit?.name],[t('precision'),item.unit?.rounding],[t('source'),t(item.result&&Date.now()-item.result.acquired>=300000?'stale':item.status)],[t('acquired'),item.result?.acquired?new Date(item.result.acquired).toISOString():''],[t('status'),t(item.reason||item.error||item.status)]];
    for(const [k,v] of labels)box.append(element('p',k+': '+String(v??'')));
    box.append(element('p',t('explanation')),element('p','qty_available − outgoing_qty; virtual_available = qty_available − outgoing_qty + incoming_qty'));
    if(item.omitted.length)box.append(element('p',t('omitted')+': '+item.omitted.join(', ')));
    box.append(element('p',t('noLink')));
    const raw=element('details');raw.append(element('summary',t('raw')),element('pre',JSON.stringify({scope:item.scope,line:item.line,move:item.move,unit:item.unit,result:item.result},null,2)));box.append(raw);historyDialog(box,t('close'));
}
function renderResults(){
    if(!panel||renderFrame!==null)return;
    renderFrame=requestAnimationFrame(()=>{renderFrame=null;paintResults();});
}
function paintResults(){
    if(!panel)return;
    const stale=items.some(i=>i.result&&Date.now()-i.result.acquired>=300000);
    const counts=run.counts(),summary=preparing?'running':stale?'stale':run.state==='success'&&counts.cache?(counts.success?'complete':'cache'):run.state;
    statusEl.textContent=lastError?t(lastError):[t(summary),...['success','cache','failed','confirm','unqueried'].filter(k=>counts[k]).map(k=>t(k+'Count')+' '+counts[k])].join(' · ');
    panel.dataset.pbStale=String(stale);
    let resolved=false;
    try{const snap=pageSnapshot(),s=supportedScope(snap);resolved=true;basisEl.textContent=[snap.env.companyLabels?.join(', ')||snap.env.companyName,s.label,s.children?t('children'):t('exact'),snap.env.tz].filter(Boolean).join(' · ');}catch{basisEl.textContent=t('scope');}
    const colKeys=['hand','act','virt'].filter(k=>prefs[k]);
    const hint=panel.querySelector('[data-pbh-hint]');
    hint.textContent=!colKeys.length?t('hiddenColumns'):!resolved?t('chooseFirst'):prefs.mode==='fixed'?t('fixedHint'):!items.length?t('queryHint'):t('rowHint');
    hint.dataset.tone=!resolved||!colKeys.length?'attention':'normal';paintCompactStatus(resolved,counts,summary);
    panel.querySelector('[data-pba-query]').disabled=preparing||run.state==='running';
    panel.querySelector('[data-pbh-pause]').disabled=preparing||!['running','paused'].includes(run.state);
    panel.querySelector('[data-pbh-pause]').textContent=t(run.state==='paused'?'resume':'pause');
    panel.querySelector('[data-pbh-stop]').disabled=!preparing&&!['running','paused'].includes(run.state);
    panel.querySelector('[data-pbh-fixed]').hidden=prefs.mode!=='fixed';
    if(!colKeys.length){removeColumns();if(output.childNodes.length)output.replaceChildren();return;}
    if(prefs.mode==='fixed'){
        removeColumns();output.replaceChildren();
        if(!items.length||!colKeys.length)return;
        const table=element('table',null,{className:'pbh-summary'}),head=element('tr');head.append(element('th',t('product')));colKeys.forEach(k=>head.append(element('th',t(k+'Short'),{'data-pbh-summary-column':k})));table.append(head);
        for(const item of items){const tr=element('tr');tr.append(element('td',item.product?.display_name||t('emptyRecord')));for(const k of colKeys){const td=element('td',null,{'data-pbh-summary-column':k}),button=actionButton(item.result?amount(item.result.data[k],item.unit):t(item.reason||item.error||item.status),()=>detail(item));button.dataset.pbResult=String(!!item.result);button.classList.toggle('pbh-zero',!!item.result&&item.result.data[k]===0);button.classList.toggle('pbh-negative',!!item.result&&item.result.data[k]<0);td.append(button);tr.append(td);}table.append(tr);}output.append(table);return;
    }
    if(output.childNodes.length)output.replaceChildren();
    const c=currentController(),table=c?.rootRef?.el?.querySelector('.o_list_table');
    if(!table||table.closest('.o_field_widget,.modal,.o_dialog'))return;
    const header=table.tHead?.rows[0];if(!header)return;
    const existing=[...header.querySelectorAll('[data-pb-history-column]')].map(n=>n.dataset.pbHistoryColumn);
    if(JSON.stringify(existing)!==JSON.stringify(colKeys))removeColumns();
    for(const k of colKeys){
        let th=header.querySelector('[data-pb-history-column="'+k+'"]');
        if(!th){th=element('th',t(k+'Short'),{'data-pb-history-column':k,scope:'col',title:t(k),className:'align-middle o_list_number_th w-print-auto'});th.style.cssText='width:132px;min-width:132px;white-space:nowrap';insertHistoryCell(header,th,true);}
        else if(th.textContent!==t(k+'Short'))th.textContent=t(k+'Short');
        insertHistoryCell(header,th,true);
    }
    const itemMap=new Map(items.map(item=>[item.point,item]));
    const records=new Map(Array.from(c.model.root.records||[],record=>[String(record.id),record]));
    for(const tr of table.querySelectorAll('tbody > tr.o_data_row')){
        const point=tr.dataset.id;if(!records.has(point)){tr.querySelectorAll('[data-pb-history-column]').forEach(n=>n.remove());continue;}
        const item=itemMap.get(point);
        for(const k of colKeys){
            let td=tr.querySelector('[data-pb-history-column="'+k+'"]');
            if(!td){td=element('td',null,{'data-pb-history-column':k,className:'o_data_cell o_list_number'});td.append(actionButton('',event=>{event.stopPropagation();const current=event.currentTarget.pbItem;if(current)detail(current);else if(!historyScopeReady())locationDialog(true);else query(true);}));insertHistoryCell(tr,td,false);}
            insertHistoryCell(tr,td,false);const button=td.firstChild;
            const pending=!resolved?'location':preparing?'running':!lastError||['scopeChanged','idle'].includes(lastError)?'unqueried':lastError;
            const state=item?.reason||item?.error||item?.status||pending;
            const text=item?.result?amount(item.result.data[k],item.unit):t(state);
            button.pbItem=item;button.dataset.pbResult=String(!!item?.result);
            button.classList.toggle('pbh-negative',!!item?.result&&item.result.data[k]<0);button.classList.toggle('pbh-zero',!!item?.result&&item.result.data[k]===0);
            button.title=text+' · '+t(k)+' · '+(item?.scopeLabel||basisEl.textContent)+(item?.scope?.at?' · '+item.scope.at+' UTC':'');
            if(button.textContent!==text)button.textContent=text;
        }
    }
}
function insertHistoryCell(row,cell,isHead){
    const fields=['quantity','quantity_product_uom','quantity_done'];
    const quantity=fields.map(key=>row.querySelector((isHead?'[data-name="':'[name="')+key+'"]')).find(Boolean);
    const keys=['hand','act','virt'].filter(key=>prefs[key]),index=keys.indexOf(cell.dataset.pbHistoryColumn);
    const previous=index>0?row.querySelector('[data-pb-history-column="'+keys[index-1]+'"]'):quantity;
    if(previous){if(previous.nextElementSibling!==cell)row.insertBefore(cell,previous.nextElementSibling);return;}
    const next=keys.slice(index+1).map(key=>row.querySelector('[data-pb-history-column="'+key+'"]')).find(Boolean);
    const anchor=next||row.querySelector(isHead?'.o_list_actions_header':'.o_list_record_remove');
    if(cell.nextElementSibling!==anchor||cell.parentElement!==row)row.insertBefore(cell,anchor||null);
}

function historyScopeReady(){try{supportedScope(pageSnapshot());return true;}catch{return false;}}
function repairListColumns(){
    if(prefs.mode!=='rows')return;
    const table=currentController()?.rootRef?.el?.querySelector('.o_list_table');if(!table)return;
    const keys=['hand','act','virt'].filter(key=>prefs[key]),header=table.tHead?.rows[0],rows=[...table.querySelectorAll('tbody > tr.o_data_row')];
    const headers=header?.querySelectorAll('[data-pb-history-column]').length||0,cells=table.querySelectorAll('tbody > tr.o_data_row > [data-pb-history-column]').length;
    const misplaced=keys.length&&[header,...rows].filter(Boolean).some(row=>{
        const isHead=row===header,quantity=['quantity','quantity_product_uom','quantity_done'].map(key=>row.querySelector((isHead?'[data-name="':'[name="')+key+'"]')).find(Boolean);
        if(!quantity)return false;let next=quantity.nextElementSibling;
        for(const key of keys){if(next?.dataset.pbHistoryColumn!==key)return true;next=next.nextElementSibling;}return false;
    });
    if(headers!==keys.length||cells!==rows.length*keys.length||misplaced)renderResults();
}

function check(key,parent){const label=element('label',null,{className:'pbh-toggle'}),input=element('input',null,{type:'checkbox','data-pba-check':key});input.checked=prefs[key];input.addEventListener('change',()=>{prefs[key]=input.checked;savePrefs();if(['children','total'].includes(key))invalidate();else if(key==='dark')applyTheme();else if(key==='auto'){if(input.checked){autoScheduler.reset();scheduleAutomaticQuery();}else autoScheduler.cancel();renderResults();}else renderResults();});input.setAttribute('aria-label',t(key));label.title=t(key);label.append(input,document.createTextNode(' '+t(({hand:'handShort',act:'actShort',virt:'virtShort',auto:'autoShort'})[key]||key)));parent.append(label);return input;}
function applyTheme(){document.documentElement.setAttribute('data-pb-history-theme',prefs.dark?'dark':'light');panel.style.setProperty('--pba-bg',prefs.dark?'#18232b':'#ffffff');panel.style.setProperty('--pba-fg',prefs.dark?'#e4edf1':'#24343b');}
function currentResults(){return items.map(i=>[i.product?.display_name||'',i.env?.companies.join(', ')||'',i.scopeLabel||'',i.scope.children?1:0,i.scope.at||'',i.env?.tz||'',i.result?.data.hand??null,i.result?.data.act??null,i.result?.data.virt??null,i.unit?.name||'',t(i.status),i.result?.acquired?new Date(i.result.acquired).toISOString():'',t(i.reason||i.error||i.status),i.omitted.join(', ')]);}
function exportRows(){return [[t('product'),t('company'),t('location'),t('children'),t('time'),t('zone'),t('hand'),t('act'),t('virt'),t('unit'),t('source'),t('acquired'),t('status'),t('omitted')],...currentResults()];}
async function locationDialog(queryAfter=false){
    const token=epoch,scopeKey=environmentKey(),env=environment();const valid=()=>token===epoch&&scopeKey===environmentKey()&&d.isConnected;
    const box=element('div'),input=element('input',null,{placeholder:t('search'),'aria-label':t('search')}),list=element('div',null,{className:'pba-options'});box.append(element('h3',t('location')),input,list);
    const d=historyDialog(box,t('close'));let request=0;
    const draw=async ids=>{
        const seq=++request;try{
            const domain=[['company_id','in',[false,...env.companies]]];if(ids)domain.push(['id','in',ids]);else if(input.value.trim())domain.push(['complete_name','ilike',input.value.trim()]);
            const locs=await rpc.call('stock.location','search_read',[domain],{fields:['complete_name','company_id','usage'],limit:30,context:env.context},()=>valid()&&seq===request);
            if(!valid()||seq!==request)return;list.replaceChildren();
            for(const loc of locs){const row=element('div'),choose=actionButton(loc.complete_name+' · '+relationName(loc.company_id)+' · '+t('usage-'+loc.usage),()=>{
                if(!valid())return;scopeSelection={mode:'manual',id:loc.id,label:loc.complete_name};prefs.recent=[loc.id,...prefs.recent.filter(id=>id!==loc.id)].slice(0,10);rememberScope();d.close();invalidate();if(queryAfter||prefs.auto)query(true);
            });const star=actionButton(prefs.favorites.includes(loc.id)?'★':'☆',()=>{if(!valid())return;if(prefs.favorites.includes(loc.id))prefs.favorites=prefs.favorites.filter(id=>id!==loc.id);else if(prefs.favorites.length<10)prefs.favorites.push(loc.id);savePrefs();star.textContent=prefs.favorites.includes(loc.id)?'★':'☆';});star.title=t('favorite');star.setAttribute('aria-label',t('favorite'));row.append(choose,star);list.append(row);}if(!locs.length)list.append(element('p',t('empty')));
        }catch(e){if(valid()&&seq===request)list.replaceChildren(element('p',t(e.code||e.message)));}
    };
    box.insertBefore(actionButton(t('search'),()=>draw()),list);box.insertBefore(actionButton(t('favorites'),()=>draw(prefs.favorites)),list);box.insertBefore(actionButton(t('recent'),()=>draw(prefs.recent)),list);
    input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();draw();}});draw(prefs.recent.length?prefs.recent:undefined);input.focus();
}
function showIssues(){const bad=items.filter(i=>i.reason||i.error||i.result?.data.hand<0);const box=element('div');box.append(element('h3',t('issues')));for(const item of bad)box.append(actionButton((item.product?.display_name||'#'+item.id)+' · '+t(item.reason||item.error||'negative'),()=>detail(item)));if(!bad.length)box.append(element('p',t('empty')));historyDialog(box,t('close'));}
function setFixed(input,value){const DateTime=window.luxon?.DateTime;if(!DateTime){notice('api');return;}const dt=DateTime.fromISO(value,{zone:environment().tz});if(!dt.isValid){notice('invalidTime');return;}fixedUTC=dt.toUTC().toFormat('yyyy-MM-dd HH:mm:ss');input.value=dt.toFormat("yyyy-MM-dd'T'HH:mm:ss");invalidate();}
function mount(){
    addStyle();addHistoryStyle();addCompactStyle();loadPrefs();restoreScope();
    panel=element('section',null,{id:'pb-history-119',className:'pb-addon-panel pbh-panel pbh-compact','aria-label':t('title')});
    const handle=element('div',null,{className:'pbh-header'}),body=element('div',null,{className:'pba-history-content'});
    handle.append(element('strong',t('title')));check('auto',handle);
    const locationButton=actionButton(t('autoLocation'),()=>locationDialog(true));locationButton.dataset.pbhLocation='';locationButton.setAttribute('aria-label',t('location'));
    const refresh=actionButton(t('refreshShort'),startManualHistoryQuery);refresh.dataset.pbaQuery='';refresh.className='pbh-primary';
    const compact=element('span',null,{'data-pbh-compact-status':'',role:'status','aria-live':'polite',className:'pbh-compact-status'});
    const pause=actionButton(t('pause'),()=>{if(run.state==='paused')run.resume();else run.pause();renderResults();});pause.dataset.pbhPause='';
    const stop=actionButton(t('stop'),()=>{autoScheduler.stop();epoch++;preparing=false;run.stop();lastError='stopped';renderResults();});stop.dataset.pbhStop='';
    const settingsButton=actionButton(t('settingsShort'),()=>{body.hidden=false;prefs.collapsed=false;settings.open=!settings.open;settingsButton.setAttribute('aria-expanded',String(settings.open));savePrefs();});settingsButton.className='pbh-settings-toggle';settingsButton.setAttribute('aria-controls','pbh-options-123');settingsButton.setAttribute('aria-expanded','false');
    handle.append(locationButton,refresh,compact,pause,stop,settingsButton);panel.append(handle,body);body.hidden=prefs.collapsed;
    const settings=element('details',null,{className:'pbh-settings',id:'pbh-options-123'});settings.append(element('summary',t('settings')));
    const choices=element('div',null,{className:'pba-row'});choices.append(element('span',t('display'),{className:'pbh-label'}));['hand','act','virt'].forEach(key=>check(key,choices));check('children',choices);settings.append(choices,element('p',t('dailyHelp'),{className:'pbh-plain-help'}));
    const ranges=element('div',null,{className:'pba-row'});ranges.append(actionButton(t('autoLocation'),automaticScopeButton),actionButton(t('all'),()=>{scopeSelection={mode:'all'};rememberScope();invalidate();}),actionButton(t('location'),()=>locationDialog(true)));settings.append(ranges);
    const mode=element('select',null,{'aria-label':t('timeMode'),'data-pbh-mode':''});for(const key of ['rows','fixed']){const option=element('option',t(key),{value:key});option.selected=prefs.mode===key;mode.append(option);}mode.addEventListener('change',()=>{prefs.mode=mode.value;savePrefs();invalidate();autoScheduler.reset();scheduleAutomaticQuery();});const modeRow=element('div',null,{className:'pba-row'});modeRow.append(element('span',t('timeMode'),{className:'pbh-label'}),mode);settings.append(modeRow,element('p',null,{'data-pbh-mode-help':'',className:'pbh-plain-help'}));
    const fixed=element('div',null,{'data-pbh-fixed':'',className:'pbh-fixed'}),datetime=element('input',null,{type:'datetime-local',step:1,'aria-label':t('date')});datetime.addEventListener('change',()=>setFixed(datetime,datetime.value));
    if(fixedUTC&&window.luxon?.DateTime)datetime.value=window.luxon.DateTime.fromSQL(fixedUTC,{zone:'UTC'}).setZone(environment().tz).toFormat("yyyy-MM-dd'T'HH:mm:ss");
    fixed.append(element('span',t('date')),datetime,actionButton(t('now'),()=>{const d=window.luxon?.DateTime?.now().setZone(environment().tz);if(d)setFixed(datetime,d.toISO());else notice('api');}),actionButton(t('yesterday'),()=>{const d=window.luxon?.DateTime?.now().setZone(environment().tz).startOf('day').minus({seconds:1});if(d)setFixed(datetime,d.toISO());else notice('api');}));settings.append(fixed);
    const options=element('div',null,{className:'pba-row'});['dark','total'].forEach(key=>check(key,options));const placement=actionButton(t(prefs.floating?'docked':'floating'),()=>{prefs.floating=!prefs.floating;savePrefs();applyPlacement();applyTheme();});placement.dataset.pbhPlacement='';options.append(placement);settings.append(options);
    const debug=element('details',null,{className:'pbh-debug'});debug.append(element('summary',t('diagnostics')));
    const basis=element('div',null,{className:'pbh-basis'});basis.append(element('span',t('basis'),{className:'pbh-label'}));basisEl=element('span');basis.append(basisEl);debug.append(basis);
    statusEl=element('p',null,{className:'pbh-status'});debug.append(statusEl,element('p',null,{'data-pbh-hint':'',className:'pbh-hint'}),element('small',t('title')+' v'+VERSION));
    const tools=element('div',null,{className:'pba-row'});tools.append(actionButton(t('retry'),()=>query(true,true)),actionButton(t('issues'),showIssues),actionButton(t('next'),()=>{const bad=items.filter(i=>i.reason||i.error||i.result?.data.hand<0);if(!bad.length)return;const item=bad[issueIndex++%bad.length];currentController()?.rootRef.el.querySelector('[data-id="'+CSS.escape(String(item.point))+'"]')?.scrollIntoView({block:'center'});detail(item);}),actionButton(t('copy'),async()=>{try{await navigator.clipboard.writeText(Core.exportTable(exportRows(),'\t'));notice('copied');}catch{notice('failed');}}),actionButton(t('csv'),()=>{if(!items.length){notice('exportEmpty');return;}const url=URL.createObjectURL(new Blob(['\uFEFF'+Core.exportTable(exportRows())],{type:'text/csv;charset=utf-8'}));const a=element('a',null,{href:url,download:'Playbox-history-'+new Date().toISOString().slice(0,10)+'.csv'});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));debug.append(tools);
    const maintenance=element('div',null,{className:'pba-row'});maintenance.append(actionButton(t('clear'),()=>{invalidate('idle');cache.clear();store.set(prefKey+':cache',JSON.stringify(cache.dump()));}),actionButton(t('reset'),()=>{prefs.floating=true;savePrefs();applyPlacement();applyTheme();panel.style.left='auto';panel.style.right='24px';panel.style.top='90px';const r=panel.getBoundingClientRect();store.set(prefKey+':position',JSON.stringify({left:r.left,top:r.top}));}));debug.append(maintenance);settings.append(debug);body.append(settings);
    output=element('div',null,{className:'pbh-output'});body.append(output);applyPlacement();applyTheme();document.documentElement.setAttribute('data-pb-addon-history',VERSION);if(lastError==='scopeChanged')lastError='idle';renderResults();
}

function unmount(){epoch++;run.stop();autoScheduler.cancel();if(renderFrame!==null)cancelAnimationFrame(renderFrame);renderFrame=null;dragCleanup?.();dragCleanup=null;panel?.remove();panel=null;removeColumns();items=[];run.items=[];controller=null;controllerAction=null;}
function tick(){
    if(document.hidden)return;
    const next=fingerprint();if(!next){if(panel)unmount();viewKey='';return;}
    if(next!==viewKey){const oldScope=prefKey;invalidate();viewKey=next;if(!panel||oldScope!==scopedStorageKey('history')){if(panel)unmount();viewKey=next;mount();}else restoreScope();renderResults();autoScheduler.cancel();scheduleAutomaticQuery();}
    else if(panel&&panel.dataset.pbStale!=='true'&&items.some(i=>i.result&&Date.now()-i.result.acquired>=300000))renderResults();
    if(panel){repairListColumns();scheduleAutomaticQuery();}
}
language.subscribe(()=>{if(!panel)return;const savedItems=items,savedRunItems=run.items,savedScope=scopeSelection;dragCleanup?.();panel.remove();panel=null;mount();scopeSelection=savedScope;items=savedItems;run.items=savedRunItems;renderResults();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){autoScheduler.cancel();if(run.state==='running')run.pause();}else tick();});
window.addEventListener('storage',event=>{if(!panel||event.key!==prefKey)return;try{
    const updated=JSON.parse(event.newValue);if(!prefsValid(updated))return;
    const autoChanged=updated.auto!==prefs.auto;const changed=['children','mode','total','selection'].some(k=>JSON.stringify(updated[k])!==JSON.stringify(prefs[k]));prefs=updated;restoreScope();
    for(const input of panel.querySelectorAll('[data-pba-check]'))input.checked=prefs[input.dataset.pbaCheck];
    panel.querySelector('.pba-history-content').hidden=prefs.collapsed;applyPlacement();applyTheme();if(changed)invalidate();else{if(autoChanged){if(prefs.auto)autoScheduler.reset();else autoScheduler.cancel();scheduleAutomaticQuery();}renderResults();}
}catch{notice('invalid');}});
const autoScheduler=new HistoryAuto123.Scheduler({key:automaticIdentity,eligible:()=>!document.hidden&&!!panel&&!!prefs?.auto&&!persistDisabled&&!preparing&&!['running','paused'].includes(run.state)&&['hand','act','virt'].some(key=>prefs[key])&&(prefs.mode!=='fixed'||Core.utc(fixedUTC)),fire:()=>query(false),setTimer:(fn,ms)=>setTimeout(fn,ms),clearTimer:id=>clearTimeout(id)});
const timer=setInterval(tick,800);window.addEventListener('pagehide',()=>{clearInterval(timer);unmount();language.dispose();},{once:true});tick();

function historyDialog(content,closeText){const d=dialog(content,closeText);d.classList.add('pbh-history-dialog');return d;}
function applyPlacement(){
    if(!panel)return;
    dragCleanup?.();dragCleanup=null;
    panel.classList.toggle('pbh-floating',!!prefs.floating);
    panel.style.cssText='';
    const handle=panel.querySelector('.pbh-header');
    if(prefs.floating){
        panel.style.cssText='position:fixed;top:90px;right:24px;z-index:100;width:min(460px,calc(100vw - 24px));max-height:80vh;overflow:auto';
        document.body.append(panel);
        migrateHistoryPosition();
        dragCleanup=bindDrag(panel,handle,store,prefKey+':position',()=>notice('storage'));
    }else{
        const host=currentController()?.rootRef?.el?.querySelector('.o_content');
        if(host){host.insertBefore(panel,host.firstChild);handle.style.cursor='default';}
        else{panel.classList.add('pbh-floating');panel.style.cssText='position:fixed;top:90px;right:24px;z-index:100;width:min(460px,calc(100vw - 24px));max-height:80vh;overflow:auto';document.body.append(panel);migrateHistoryPosition();dragCleanup=bindDrag(panel,handle,store,prefKey+':position',()=>notice('storage'));}
    }
    panel.querySelector('[data-pbh-placement]').textContent=t(prefs.floating?'docked':'floating');
}
function migrateHistoryPosition(){
    if(store.get(prefKey+':position')!==null)return;
    try{
        const raw=store.get('odoo_stock_rpc_btn_pos_final');
        if(raw!==null){
            const old=JSON.parse(raw),px=x=>typeof x==='string'&&/^[-\d.]+px$/.test(x)?Number.parseFloat(x):NaN;
            const p={top:px(old.top),left:Number.isFinite(px(old.left))?px(old.left):innerWidth-panel.offsetWidth-px(old.right)};
            if(Core.number(p.left)&&Core.number(p.top))store.migrate(prefKey+':position',p,{odoo_stock_rpc_btn_pos_final:raw},x=>Core.number(x.left)&&Core.number(x.top));
            else notice('invalid');
        }
    }catch{notice('invalid');}
}
function addHistoryStyle(){
    if(document.getElementById('pbh-style-121'))return;
    const style=element('style',null,{id:'pbh-style-121'});
    style.textContent=`
    #pb-history-119{flex:0 0 auto;margin:12px 16px 8px;padding:12px 14px;border:1px solid #d7dce2;border-radius:10px;box-shadow:0 2px 8px #24343b08;font-size:13px;line-height:1.45;min-width:0;box-sizing:border-box}
    #pb-history-119.pbh-floating{margin:0;box-shadow:0 10px 32px #17242e26}
    #pb-history-119 .pbh-header{display:flex;align-items:center;gap:8px;min-height:28px}
    #pb-history-119 .pbh-header strong{font-size:15px;letter-spacing:.1px}
    #pb-history-119 .pbh-version{font-size:11px;opacity:.65}
    #pb-history-119 .pbh-badge{font-size:11px;padding:2px 7px;border-radius:20px;background:#087e8b12;color:#08727b;white-space:nowrap}
    #pb-history-119 .pbh-header-actions{margin-left:auto;display:flex;gap:6px}
    #pb-history-119 button{font-size:12px;min-height:30px;border-color:#d1d7df;border-radius:6px;padding:5px 10px;line-height:1.4}
    #pb-history-119 button:hover:enabled{background:#75808f10}
    #pb-history-119 .pbh-primary{background:#714b67;color:#fff;border-color:#714b67;font-weight:600;min-width:112px}
    #pb-history-119 .pbh-primary:hover:enabled{background:#603b56}
    #pb-history-119 .pbh-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}
    #pb-history-119 select,#pb-history-119 input[type=datetime-local]{min-height:30px;border-radius:6px;font-size:12px}
    #pb-history-119 .pbh-toolbar select{width:210px;flex:0 1 210px;max-width:100%}
    #pb-history-119 .pbh-toggle{display:inline-flex;align-items:center;gap:4px;white-space:nowrap;font-size:12px;margin:0;cursor:pointer}
    #pb-history-119 input[type=checkbox]{accent-color:#714b67;width:14px;height:14px;padding:0}
    #pb-history-119 .pbh-basis{display:flex;gap:8px;margin-top:9px;font-size:12px;align-items:baseline}
    #pb-history-119 .pbh-label{opacity:.65;white-space:nowrap;font-size:11px}
    #pb-history-119 .pbh-metrics{display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-top:8px}
    #pb-history-119 .pbh-columns{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
    #pb-history-119 .pbh-status{font-size:12px;color:var(--pba-fg,#24343b);opacity:.8}
    #pb-history-119 .pbh-hint{font-size:12px;margin:8px 0 0;padding:7px 10px;border-radius:6px;background:#7884930b}
    #pb-history-119 .pbh-hint[data-tone=attention]{background:#b9830012;border-left:3px solid #b98300}
    #pb-history-119 .pbh-settings{font-size:12px;margin-top:6px}
    #pb-history-119 .pbh-settings summary{margin:0;padding:3px 0;opacity:.8}
    #pb-history-119 .pbh-fixed{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}
    #pb-history-119 [hidden]{display:none!important}
    #pb-history-119 .pbh-output:empty{display:none}
    #pb-history-119 .pbh-output{overflow:auto;max-height:42vh;margin-top:8px}
    .pbh-summary{width:100%;border-collapse:collapse}.pbh-summary td,.pbh-summary th{padding:7px 10px;border-bottom:1px solid #a0abb82e;text-align:left;white-space:nowrap}
    th[data-pb-history-column]{width:132px!important;min-width:132px!important;white-space:nowrap!important;vertical-align:middle!important;}
    td[data-pb-history-column]{min-width:132px;white-space:nowrap}
    [data-pb-history-column] button{font:inherit;border:0;border-radius:0;padding:0;margin:0;background:none;text-decoration:none;min-height:0;line-height:inherit;vertical-align:baseline}
    [data-pb-history-column] button:hover{background:none;text-decoration:underline}
    [data-pb-history-column] button[data-pb-result=false]{font-weight:400;color:#717b87}
    [data-pb-history-column] button.pbh-negative{color:#b93838}
    .pbh-history-dialog{border:1px solid #d7dce2;box-shadow:0 16px 48px #17242e30;min-width:min(600px,90vw)}
    .pbh-history-dialog .pba-options>div{display:flex;gap:8px}.pbh-history-dialog .pba-options>div>button:first-child{flex:1;text-align:left}
    @media(max-width:760px){#pb-history-119{margin:8px;padding:10px}#pb-history-119 .pbh-badge{display:none}#pb-history-119 .pbh-toolbar{gap:6px}#pb-history-119 .pbh-basis{display:block}#pb-history-119 .pbh-label{margin-right:6px}#pb-history-119 .pbh-header-actions button{padding:4px 7px}}
    `;
    document.head.append(style);
}

function ensureAutomaticDefaults(){
    if(persistDisabled)return;
    const next=HistoryAuto123.upgrade(prefs);if(!next.changed)return;
    const raw=store.get(prefKey),backup=prefKey+':before-auto-setup';
    if(raw!==null&&!store.set(backup,store.get(backup)??raw)){prefs=next.prefs;notice('storage');return;}
    prefs=next.prefs;savePrefs();
}
function automaticIdentity(){
    if(!panel||!prefs)return '';
    const view=fingerprint();if(!view)return '';
    return JSON.stringify([view,scopeSelection,prefs.children,prefs.total,prefs.mode,fixedUTC]);
}
function startManualHistoryQuery(){
    if(lastError==='ambiguousLocation'||scopeSelection.mode!=='auto'&&!historyScopeReady())return locationDialog(true);
    query(true);
}
function automaticScopeButton(){
    scopeSelection={mode:'auto'};rememberScope();invalidate();autoScheduler.reset();autoScheduler.update();
}
async function resolveHistoryScope(snap,lines,valid){
    if(scopeSelection.mode!=='auto'){
        const scope=supportedScope(snap);
        if(scope.location!==null){
            const locations=await rpc.read('stock.location',[scope.location],['complete_name','company_id','usage'],snap.env.context,valid);
            if(locations.length!==1||relationId(locations[0].company_id)&&!snap.env.companies.includes(relationId(locations[0].company_id)))throw Error('locationInvalid');
            scope.label=locations[0].complete_name;
        }
        return scope;
    }
    let choice=HistoryAuto123.explicit(snap.context,snap.domain);
    if(choice.kind==='ambiguous')throw Error('ambiguousLocation');
    if(choice.kind==='none'){
        const byId=new Map(lines.map(line=>[line.id,line]));
        const sample=snap.entries.slice(0,30).map(entry=>byId.get(entry.id)).filter(Boolean);
        const ids=[...new Set(sample.flatMap(line=>[relationId(line.location_id),relationId(line.location_dest_id)]).filter(Core.id))];
        const locations=ids.length?await rpc.read('stock.location',ids,['complete_name','company_id','usage'],snap.env.context,valid):[];
        choice=HistoryAuto123.rowChoice(sample,locations,snap.env.companies);
    }
    if(choice.kind==='ambiguous')throw Error('ambiguousLocation');
    if(choice.kind==='unreadable')throw Error('locationInvalid');
    let scope;
    if(choice.kind==='company')scope={location:null,children:true,label:t('all'),automatic:true,reason:choice.reason};
    else{
        const locations=choice.record?[choice.record]:await rpc.read('stock.location',[choice.id],['complete_name','company_id','usage'],snap.env.context,valid);
        if(locations.length!==1||relationId(locations[0].company_id)&&!snap.env.companies.includes(relationId(locations[0].company_id)))throw Error('locationInvalid');
        scope={location:choice.id,children:prefs.children,label:locations[0].complete_name,automatic:true,reason:choice.reason};
    }
    if(!valid())throw Error('stopped');
    resolvedAutoScope={view:fingerprint(),scope};return scope;
}
function scheduleAutomaticQuery(){autoScheduler.update();}

function paintCompactStatus(resolved,counts,summary){
    const help=panel.querySelector('[data-pbh-mode-help]');if(help){const text=t(prefs.mode==='fixed'?'fixedHelp':'rowsHelp');if(help.textContent!==text)help.textContent=text;}
    const compact=panel.querySelector('[data-pbh-compact-status]');
    if(compact){
        const total=items.length,done=(counts.success||0)+(counts.cache||0)+(counts.failed||0)+(counts.confirm||0);
        compact.textContent=lastError&& !['idle','scopeChanged'].includes(lastError)?t(lastError):preparing?t('detectingShort'):run.state==='running'?t('running')+(total?' '+done+'/'+total:''):run.state==='paused'?t('paused'):prefs.mode==='fixed'&&!Core.utc(fixedUTC)?t('chooseTimeShort'):total?t('doneShort')+' '+done+'/'+total:t('idle');
        compact.title=lastError?t(lastError):statusEl.textContent;
    }
    const location=panel.querySelector('[data-pbh-location]');if(location){
        let scope;try{scope=supportedScope(pageSnapshot());}catch{}
        location.textContent=scope?(scopeSelection.mode==='auto'?t('autoShort')+' · ':'')+(scope.location===null?t('companyShort'):scope.label):t('autoLocation');
        location.title=basisEl.textContent;
    }
    for(const key of ['pause','stop']){const button=panel.querySelector('[data-pbh-'+key+']');if(button)button.hidden=!preparing&&!['running','paused'].includes(run.state);}
}
function addCompactStyle(){
    if(document.getElementById('pbh-compact-123'))return;
    const style=element('style',null,{id:'pbh-compact-123'});style.textContent=`

[data-pb-history-column],[data-pbh-summary-column]{--pbh-classic-hand:#006400;--pbh-classic-act:#d63031;--pbh-classic-virt:#6c5ce7;--pbh-classic-zero:#999999;--pbh-classic-heading:#2d3436;--pbh-classic-border:#dcdde1;text-align:right!important;font-variant-numeric:tabular-nums}
:root[data-pb-history-theme=dark] [data-pb-history-column],:root[data-pb-history-theme=dark] [data-pbh-summary-column]{--pbh-classic-hand:#55efc4;--pbh-classic-act:#ff7675;--pbh-classic-virt:#a29bfe;--pbh-classic-zero:#b2bec3;--pbh-classic-heading:#81ecec;--pbh-classic-border:rgba(255,255,255,.2)}
.o_list_table th[data-pb-history-column]{background-color:var(--body-bg,#f9fafb)!important}
.o_list_table [data-pb-history-column]>button,#pb-history-119 .pbh-summary [data-pbh-summary-column]>button{display:block;width:100%;box-sizing:border-box;text-align:right;font-family:"Roboto Mono",Consolas,monospace!important;font-size:13px!important;line-height:inherit}
.o_list_table [data-pb-history-column]>button[data-pb-result=true],#pb-history-119 .pbh-summary [data-pbh-summary-column]>button[data-pb-result=true]{font-weight:800!important}
.o_list_table [data-pb-history-column=hand]>button[data-pb-result=true],#pb-history-119 .pbh-summary [data-pbh-summary-column=hand]>button[data-pb-result=true]{color:var(--pbh-classic-hand)!important}
.o_list_table [data-pb-history-column=act]>button[data-pb-result=true],#pb-history-119 .pbh-summary [data-pbh-summary-column=act]>button[data-pb-result=true]{color:var(--pbh-classic-act)!important}
.o_list_table [data-pb-history-column=virt]>button[data-pb-result=true],#pb-history-119 .pbh-summary [data-pbh-summary-column=virt]>button[data-pb-result=true]{color:var(--pbh-classic-virt)!important}
.o_list_table [data-pb-history-column]>button.pbh-zero[data-pb-result=true],#pb-history-119 .pbh-summary [data-pbh-summary-column]>button.pbh-zero[data-pb-result=true]{color:var(--pbh-classic-zero)!important;font-weight:700!important;opacity:.8}
.o_list_table [data-pb-history-column]>button.pbh-negative[data-pb-result=true],#pb-history-119 .pbh-summary [data-pbh-summary-column]>button.pbh-negative[data-pb-result=true]{color:var(--pbh-classic-act)!important}

    #pb-history-119 .pbh-plain-help{font-size:12px;line-height:1.5;opacity:.8;margin:4px 0 8px}
    #pb-history-119.pbh-compact{margin:8px 16px;padding:8px 10px;border-radius:7px;box-shadow:none}
    #pb-history-119.pbh-compact .pbh-header{flex-wrap:wrap;gap:8px;min-height:30px}
    #pb-history-119.pbh-compact .pbh-header strong{font-size:13px;margin-right:2px}
    #pb-history-119.pbh-compact .pbh-primary{min-width:60px;font-weight:500}
    #pb-history-119.pbh-compact [data-pbh-location]{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #pb-history-119.pbh-compact .pbh-compact-status{font-size:12px;opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px}
    #pb-history-119.pbh-compact .pbh-settings-toggle{margin-left:auto}
    #pb-history-119.pbh-compact .pbh-settings>summary{display:none}
    #pb-history-119.pbh-compact .pbh-settings[open]{margin-top:9px;padding-top:8px;border-top:1px solid #a0abb82e}
    #pb-history-119.pbh-compact .pbh-debug{margin-top:9px;font-size:12px}
    #pb-history-119.pbh-compact .pbh-debug summary{cursor:pointer}
    #pb-history-119.pbh-compact .pba-history-content:has(>.pbh-settings:not([open])):has(>.pbh-output:empty){margin:0;padding:0}
    @media(max-width:760px){#pb-history-119.pbh-compact{margin:6px 8px}#pb-history-119.pbh-compact .pbh-compact-status{max-width:140px}#pb-history-119.pbh-compact [data-pbh-location]{max-width:200px}}
    `;document.head.append(style);
}

})();

// ==UserScript==
// @name         Playbox Odoo - 补货提醒
// @namespace    playbox.odoo.replenishment
// @version      0.1.28
// @description  选中商品低库存提醒、门店和货源设置、共享门槛与本机显示开关；不创建调拨采购。
// @match        https://*.odoo.com/*
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function(){
'use strict';
const Core=(()=>{const module={exports:{}};
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PBReplenishmentCore=factory();})(typeof globalThis==='object'?globalThis:this,function(){
    'use strict';
    const MODEL='x_pb_replenishment_rule';
    const id=v=>Number(Array.isArray(v)?v[0]:v?.id??v??0);
    function minimum(value){
        const text=String(value??'').trim();
        if(!/^\d{1,9}$/.test(text))throw Error('请输入 0～999999999 之间的整数件数 / Ingrese un número entero de piezas.');
        return Number(text);
    }
    function resolveWarehouses(rows,companyId){
        const owned=rows.filter(w=>id(w.company_id)===companyId);
        const specs=[['HR27',['HR27']],['BODEGA31',['BG31P','BODEGA31']],['BODEGA27',['BP27','BODEGA27']],['CUBA63',['CB63','CUBA63']]];
        return specs.map(([label,codes])=>{
            const compact=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
            const candidates=owned.filter(w=>codes.includes(compact(w.code))||compact(Array.isArray(w.lot_stock_id)?w.lot_stock_id[1]:'').startsWith(label));
            if(candidates.length!==1||!id(candidates[0].lot_stock_id))throw Error(`无法唯一确定仓库 ${label} / No se pudo identificar el almacén.`);
            return {...candidates[0],label,stockId:id(candidates[0].lot_stock_id)};
        });
    }
    function ruleIndex(rows,companyId,warehouseId){
        const map=new Map();
        for(const row of rows){
            const productId=id(row.x_pb_product_id);
            if(id(row.x_pb_company_id)!==companyId||id(row.x_pb_warehouse_id)!==warehouseId||!Number.isSafeInteger(productId)||productId<=0)throw Error('提醒配置的公司、门店或商品不一致 / Configuración fuera del ámbito.');
            if(map.has(productId))throw Error(`商品 ${productId} 存在重复提醒配置，请管理员核对 / Configuración duplicada.`);
            if(row.x_pb_threshold_set)minimum(row.x_pb_min_pieces);
            map.set(productId,row);
        }
        return map;
    }
    const watched=index=>[...index.values()].filter(r=>r.x_pb_enabled&&r.x_pb_threshold_set).map(r=>id(r.x_pb_product_id));
    function templateLabel(product){
        const name=String(product?.name||product?.product_tmpl_id?.[1]||'');
        return name.match(/(?:^|\s)N\s*-\s*([A-Z0-9][A-Z0-9_-]*)/i)?.[1]||String(product?.default_code||name.replace(/^\[[^\]]*\]\s*/,''));
    }
    function templateGroups(products){
        const groups=new Map();
        for(const p of products){const key=id(p.product_tmpl_id);if(!Number.isSafeInteger(key)||key<=0)throw Error('无法核实商品型号 / Modelo sin verificar.');if(!groups.has(key))groups.set(key,{id:key,label:templateLabel(p),matchedIds:[]});groups.get(key).matchedIds.push(p.id);}
        return [...groups.values()].sort((a,b)=>a.label.localeCompare(b.label,'en',{numeric:true})||a.id-b.id);
    }
    function groupThreshold(products,index){
        const rules=products.map(p=>index.get(p.id)),enabled=rules.filter(r=>r?.x_pb_enabled&&r.x_pb_threshold_set),values=new Set(enabled.map(r=>r.x_pb_min_pieces));
        return {kind:!enabled.length?'unset':enabled.length===products.length&&values.size===1?'uniform':'mixed',value:values.size===1?[...values][0]:null,enabled:enabled.length,total:products.length,overrides:enabled.filter(r=>r.x_pb_is_override).length};
    }
    function reminderDomain(index,{monitoring='all',threshold=''}={}){
        if(!['all','enabled','disabled'].includes(monitoring))throw Error('提醒筛选无效 / Filtro inválido.');
        const hasThreshold=String(threshold??'').trim()!=='';
        const value=hasThreshold?minimum(threshold):null;
        const active=[...index.values()].filter(r=>r.x_pb_enabled&&r.x_pb_threshold_set);
        if(monitoring==='disabled')return hasThreshold?[['id','in',[]]]:[['id','not in',active.map(r=>id(r.x_pb_product_id))]];
        if(monitoring==='enabled'||hasThreshold)return [['id','in',active.filter(r=>!hasThreshold||r.x_pb_min_pieces===value).map(r=>id(r.x_pb_product_id))]];
        return [];
    }
    function pieceProduct(product){return product?.active!==false&&product?.is_storable===true&&/^(pieza|piezas|unit|units|unidad|unidades|件|个)$/i.test(String(product.uom_id?.[1]||'').trim());}
    function stockMap(groups,productIds){
        if(!Array.isArray(groups))throw Error('库存响应不完整 / Respuesta de existencias incompleta.');
        const allowed=new Set(productIds),out=new Map(productIds.map(p=>[p,{onHand:0,reserved:0,available:0}]));
        const seen=new Set();
        for(const row of groups){
            // Odoo can return false for an empty numeric SUM; detail reads expose the same value as 0.
            // Normalize only explicit false, keeping missing fields and other malformed values invalid.
            const p=id(row.product_id),q=row.quantity===false?0:row.quantity,r=row.reserved_quantity===false?0:row.reserved_quantity;
            if(!allowed.has(p)||seen.has(p)||typeof q!=='number'||typeof r!=='number'||!Number.isFinite(q)||!Number.isFinite(r)||r<0)throw Error('库存聚合结果异常 / Resultado de existencias no verificable.');
            seen.add(p);out.set(p,{onHand:q,reserved:r,available:q-r});
        }
        return out;
    }
    function cartonSize(product,units){
        const base=units.get(id(product.uom_id));if(!base||!Number.isFinite(base.factor)||base.factor<=0)return null;
        const candidates=new Set((product.uom_ids||[]).map(id).map(i=>units.get(i)).filter(u=>u&&/^(caja|cart[oó]n|箱)(?:\s|\d|$)/i.test(String(u.name))).map(u=>u.factor/base.factor).filter(n=>Number.isSafeInteger(n)&&n>1));
        return candidates.size===1?[...candidates][0]:null;
    }
    function alerts(index,products,warehouses,stocks,units){
        const out=[];
        for(const productId of watched(index)){
            const rule=index.get(productId),product=products.get(productId);
            if(!pieceProduct(product)){out.push({productId,product,rule,status:'invalid-product',sources:[]});continue;}
            const current=stocks[0].get(productId);if(!current)throw Error('门店库存尚未核实 / Existencias de tienda sin verificar.');
            if(current.available+1e-7>=rule.x_pb_min_pieces)continue;
            const carton=cartonSize(product,units);
            const sources=warehouses.slice(1).map((w,i)=>{
                const stock=stocks[i+1].get(productId);if(!stock)throw Error('货源库存尚未核实 / Existencias de origen sin verificar.');
                return {warehouseId:w.id,label:w.label,...stock,carton,fullCarton:carton===null?null:stock.available>=carton};
            });
            out.push({productId,product,rule,current,carton,sources,status:sources.some(s=>s.available>0)?'available':'no-source'});
        }
        return out.sort((a,b)=>({available:0,'no-source':1,'invalid-product':2}[a.status]-{available:0,'no-source':1,'invalid-product':2}[b.status])||(a.current?.available??0)-(b.current?.available??0)||a.productId-b.productId);
    }
    function ruleStamp(rule){return rule?JSON.stringify([rule.id,rule.write_date,rule.x_pb_enabled,rule.x_pb_threshold_set,rule.x_pb_min_pieces,rule.x_pb_is_override,rule.x_pb_followup_state||false,rule.x_pb_snooze_until||false]):'missing';}
    function newerSnapshot(candidate,previous,invalidatedAt,now){return Boolean(candidate&&Number.isFinite(candidate.at)&&candidate.at>Math.max(previous?.at||0,invalidatedAt||0)&&candidate.at>now-60000&&candidate.at<=now+5000);}
    function savePlan(products,current,expected,{value,individual=false,overwrite=false,disable=false}){
        if(!products.length)throw Error('请先勾选商品 / Seleccione productos.');
        const min=disable?null:minimum(value),changes=[],protectedIds=[];
        for(const product of products){
            if(!pieceProduct(product))throw Error('只支持启用库存管理、基础单位为件的商品 / Solo productos inventariados por pieza.');
            const prior=current.get(product.id);
            if(ruleStamp(prior)!==ruleStamp(expected.get(product.id)))throw Error('门槛已在其他页面或电脑修改，请重新载入后再保存 / Otro equipo cambió la configuración; recargue.');
            if(disable&&(!prior||!prior.x_pb_enabled))continue;
            if(!individual&&!overwrite&&prior?.x_pb_is_override){protectedIds.push(product.id);continue;}
            const values=disable?{x_pb_enabled:false}:{x_pb_enabled:true,x_pb_threshold_set:true,x_pb_min_pieces:min,x_pb_is_override:individual||Boolean(prior?.x_pb_is_override)};
            if(prior&&Object.entries(values).every(([k,v])=>prior[k]===v))continue;
            changes.push({product,prior,values});
        }
        return {changes,protectedIds};
    }
    function defaultCopyLine(product){
        const code=String(product?.default_code||'').trim();
        if(!code||/[\r\n]/.test(code))return '';
        const model=String(product?.name||'').match(/(?:^|\s)N-([A-Z0-9][A-Z0-9_-]*)/i)?.[1];
        if(model){
            if(code.toUpperCase()===model.toUpperCase())return `${code} 1C`;
            const suffix=code.slice(model.length);
            if(code.toUpperCase().startsWith(model.toUpperCase())&&/^[A-Z]{1,3}$/i.test(suffix))return `${code.slice(0,model.length)} 1${suffix.toUpperCase()}`;
        }
        const match=code.match(/^(.+\d[\w-]*?)([NB])$/i);
        return match?`${match[1]} 1${match[2].toUpperCase()}`:`${code} 1C`;
    }
    function parseCopyLine(raw){
        if(typeof raw!=='string'||/[\r\n]/.test(raw))throw Error('请核对复制内容 / Revise el texto a copiar.');
        const match=raw.trim().match(/^(\S(?:.*\S)?)\s+([1-9]\d*)([A-Za-z]{1,3})$/);
        if(!match||!Number.isSafeInteger(Number(match[2])))throw Error('复制格式应为：CAB186 1N / Formato: CAB186 1N.');
        const model=match[1].trim(),cartons=Number(match[2]),color=match[3].toUpperCase();
        return {model,cartons,color,text:`${model} ${cartons}${color}`};
    }
    function copyText(rows,{drafts=new Map()}={}){
        return rows.filter(r=>r.status==='available').map(r=>{
            const raw=drafts.has(r.productId)?drafts.get(r.productId):defaultCopyLine(r.product);
            return parseCopyLine(raw).text;
        }).join('\n');
    }
    return Object.freeze({MODEL,id,minimum,resolveWarehouses,ruleIndex,watched,templateLabel,templateGroups,groupThreshold,reminderDomain,pieceProduct,stockMap,cartonSize,alerts,ruleStamp,newerSnapshot,savePlan,defaultCopyLine,parseCopyLine,copyText});
});

return module.exports;})();
const Views=(()=>{const module={exports:{}};
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PBReplenishmentViews=factory();})(typeof globalThis==='object'?globalThis:this,function(){
    'use strict';
    // Match the existing POS cart: the first word of the product name is the display group.
    const typeOf=product=>String(product?.name||'').trim().match(/^([^\s]+)/)?.[1].toUpperCase()||'OTROS';
    const collator=new Intl.Collator('es',{numeric:true,sensitivity:'base'});
    function groups(items,key){
        const buckets=new Map();
        for(const item of items){const type=key(item)||'OTROS';if(!buckets.has(type))buckets.set(type,[]);buckets.get(type).push(item);}
        return [...buckets].sort(([a],[b])=>collator.compare(a,b)).map(([type,items])=>({type,items}));
    }
    function preferences(raw){
        let value;try{value=JSON.parse(raw||'null');}catch(_){}
        return {alerts:typeof value?.alerts==='boolean'?value.alerts:true,settings:typeof value?.settings==='boolean'?value.settings:true};
    }
    const preferenceKey=(uid,companyId,surface)=>`pb-replenishment:grouping:v1:${uid}:${companyId}:${surface}`;
    function models(rows){
        const buckets=new Map();
        for(const row of rows){const ref=row.product?.product_tmpl_id,id=Array.isArray(ref)?ref[0]:ref;
            const key=Number.isSafeInteger(id)&&id>0?'t:'+id:'p:'+row.productId;
            if(!buckets.has(key))buckets.set(key,{key,items:[]});buckets.get(key).items.push(row);
        }
        return [...buckets.values()].map(group=>({...group,items:[...group.items].sort((a,b)=>collator.compare(a.product?.default_code||'',b.product?.default_code||'')||a.productId-b.productId)}));
    }
    function priority(ids,sources){
        const available=new Set(sources.map(s=>s.id)),result=[];
        for(const id of [...(Array.isArray(ids)?ids:[]),...sources.map(s=>s.id)])if(available.has(id)&&!result.includes(id))result.push(id);
        return result;
    }
    function assignedSource(row,ids){
        return ids.find(id=>row.sources?.some(s=>s.warehouseId===id&&Number.isFinite(s.available)&&s.available>0))||0;
    }
    function assignedRows(rows,sourceId,ids){return sourceId?rows.filter(row=>assignedSource(row,ids)===sourceId):rows;}
    return Object.freeze({typeOf,groups,preferences,preferenceKey,models,priority,assignedSource,assignedRows});
});

return module.exports;})();
const BaseService=(()=>{const module={exports:{}};const require=n=>n==='./core.js'?Core:Views;
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./core.js'),require('./view-core.js'));else root.PBReplenishmentService=factory(root.PBReplenishmentCore,root.PBReplenishmentViews);})(typeof globalThis==='object'?globalThis:this,function(Core,Views){
    'use strict';
    const RULE_FIELDS=['id','x_name','x_pb_company_id','x_pb_warehouse_id','x_pb_product_id','x_pb_enabled','x_pb_threshold_set','x_pb_min_pieces','x_pb_is_override','write_date'];
    const PRODUCT_FIELDS=['id','name','display_name','product_tmpl_id','default_code','barcode','active','is_storable','uom_id','uom_ids','categ_id','company_id'];
    const chunks=(items,size=500)=>Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,(i+1)*size));
    class Service{
        constructor({rpc,companyId,uid,assertScope=()=>{}}){this.rpc=rpc;this.companyId=companyId;this.uid=uid;this.assertScope=assertScope;this.saving=false;}
        async all(model,domain,fields,limit=20000){
            const out=[];let after=0;
            for(;;){const rows=await this.rpc(model,'search_read',[[...domain,['id','>',after]]],{fields,order:'id',limit:500});
                this.assertScope();if(!Array.isArray(rows))throw Error('读取不完整 / Lectura incompleta.');
                if(rows.some((r,i)=>!Number.isSafeInteger(r.id)||r.id<=(i?rows[i-1].id:after)))throw Error('读取分页异常 / Paginación inválida.');
                out.push(...rows);if(out.length>limit)throw Error('结果过多，请按分类分批 / Demasiados resultados; filtre por categoría.');
                if(rows.length<500)return out;after=rows.at(-1).id;
            }
        }
        async init(){
            let defs;try{defs=await this.rpc(Core.MODEL,'fields_get',[],{attributes:['type','relation']});}
            catch(error){if(error.httpStatus===404||/KeyError$/.test(error.rpcName||'')&&error.message.includes(Core.MODEL))throw Object.assign(Error('此数据库尚未部署共享提醒配置，不启动库存查询 / Configuración no desplegada; consultas de existencias desactivadas.'),{code:'RPL_SCHEMA_MISSING'});throw error;}
            const types={x_name:'char',x_pb_company_id:'many2one',x_pb_warehouse_id:'many2one',x_pb_product_id:'many2one',x_pb_enabled:'boolean',x_pb_threshold_set:'boolean',x_pb_min_pieces:'integer',x_pb_is_override:'boolean'};
            if(Object.entries(types).some(([n,t])=>defs[n]?.type!==t)||defs.x_pb_product_id.relation!=='product.product'||defs.x_pb_company_id.relation!=='res.company'||defs.x_pb_warehouse_id.relation!=='stock.warehouse')throw Error('共享提醒配置尚未安装或结构不兼容 / Configuración compartida no instalada o incompatible.');
            this.fieldDefinitions=defs;
            const access=await Promise.all([[Core.MODEL,'read'],[Core.MODEL,'write'],[Core.MODEL,'create'],['stock.quant','read'],['product.product','read']].map(([m,o])=>this.rpc(m,'check_access_rights',[o,false])));
            if(!access[0]||!access[3]||!access[4])throw Error('当前账号无权读取提醒或库存 / Sin permiso para consultar alertas o existencias.');
            this.canEdit=Boolean(access[1]&&access[2]);
            const rows=await this.all('stock.warehouse',[['company_id','=',this.companyId],['active','=',true]],['id','name','code','company_id','lot_stock_id']);
            this.availableWarehouses=rows;
            this.warehouses=this.dynamicWarehouses?[]:Core.resolveWarehouses(rows,this.companyId);this.warehouseId=this.warehouses[0]?.id||0;return this;
        }
        domain(){return [['x_pb_company_id','=',this.companyId],['x_pb_warehouse_id','=',this.warehouseId]];}
        async rules(){return Core.ruleIndex(await this.all(Core.MODEL,this.domain(),this.ruleFields||RULE_FIELDS),this.companyId,this.warehouseId);}
        async productRecords(ids){
            const out=[];for(const batch of chunks(ids))out.push(...await this.all('product.product',[['id','in',batch]],PRODUCT_FIELDS));
            return out;
        }
        async specificationUnits(products){
            const ids=[...new Set(products.flatMap(p=>[Core.id(p?.uom_id),...(p?.uom_ids||[]).map(Core.id)]).filter(id=>Number.isSafeInteger(id)&&id>0))];
            const units=new Map();this.assertScope();
            for(const batch of chunks(ids)){
                const rows=await this.all('uom.uom',[['id','in',batch]],['id','name','factor']);
                this.assertScope();for(const unit of rows)units.set(unit.id,unit);
            }
            return units;
        }
        async snapshot(){
            const index=await this.rules(),ids=Core.watched(index),products=new Map((await this.productRecords(ids)).map(p=>[p.id,p]));
            if(!ids.length)return {at:Date.now(),index:[...index],products:[],rows:[],warnings:[]};
            let failed=false;
            const stockResults=await Promise.allSettled(this.warehouses.map(async warehouse=>{
              try{
                const all=[];for(const batch of chunks(ids)){
                    if(failed)throw Error('库存批次已停止 / Consulta detenida.');
                    const grouped=await this.rpc('stock.quant','read_group',[[['company_id','=',this.companyId],['location_id','child_of',warehouse.stockId],['product_id','in',batch]],['product_id','quantity:sum','reserved_quantity:sum'],['product_id']],{lazy:false});
                    if(!Array.isArray(grouped))throw Error('库存响应不完整 / Respuesta de existencias incompleta.');all.push(...grouped);this.assertScope();
                }
                return Core.stockMap(all,ids);
              }catch(error){failed=true;throw error;}
            }));
            const rejected=stockResults.find(r=>r.status==='rejected');if(rejected)throw rejected.reason;
            const stocks=stockResults.map(r=>r.value);
            const unitIds=[...new Set([...products.values()].flatMap(p=>[Core.id(p.uom_id),...(p.uom_ids||[]).map(Core.id)]))];
            const units=new Map(),warnings=[];
            try{for(const batch of chunks(unitIds)){for(const u of await this.all('uom.uom',[['id','in',batch]],['id','name','factor']))units.set(u.id,u);}}
            catch(error){warnings.push('箱规未核实 / Cajas sin verificar.');}
            this.assertScope();return {at:Date.now(),index:[...index],products:[...products],rows:Core.alerts(index,products,this.warehouses,stocks,units),warnings};
        }
        incomingDomain(ids){return [['company_id','=',this.companyId],['product_id','in',ids],['state','in',['waiting','confirmed','assigned','partially_available']],['location_dest_id','child_of',this.warehouses[0].stockId],'!',['location_id','child_of',this.warehouses[0].stockId]];}
        async incomingDetails(productId){
            if(!Number.isSafeInteger(productId)||productId<=0)throw Error('商品无效 / Producto inválido.');
            const rows=await this.all('stock.move',this.incomingDomain([productId]),['id','company_id','product_id','product_qty','state','picking_id','location_id','location_dest_id','date'],2000);
            for(const r of rows)if(Core.id(r.company_id)!==this.companyId||Core.id(r.product_id)!==productId||!['waiting','confirmed','assigned','partially_available'].includes(r.state)||typeof r.product_qty!=='number'||!Number.isFinite(r.product_qty)||r.product_qty<0||!Core.id(r.location_id)||!Core.id(r.location_dest_id))throw Error('待收货明细未核实，请刷新 / Detalles sin verificar; actualice.');
            this.assertScope();return rows.filter(r=>r.product_qty>0);
        }
        async incoming(ids){
            const out=new Map(ids.map(i=>[i,0]));
            for(const batch of chunks(ids)){
                const rows=await this.rpc('stock.move','read_group',[this.incomingDomain(batch),['product_id','product_qty:sum'],['product_id']],{lazy:false});
                if(!Array.isArray(rows))throw Error('待收货记录未核实 / Recepciones sin verificar.');
                const seen=new Set();for(const r of rows){const i=Core.id(r.product_id);if(!batch.includes(i)||seen.has(i)||typeof r.product_qty!=='number'||!Number.isFinite(r.product_qty)||r.product_qty<0)throw Error('待收货记录异常 / Recepciones inválidas.');seen.add(i);out.set(i,r.product_qty);}
                this.assertScope();
            }return out;
        }
        productDomain(query='',category=0){
            const d=[['active','=',true],['is_storable','=',true],'|',['company_id','=',false],['company_id','=',this.companyId]];
            if(category)d.push(['categ_id','child_of',category]);
            if(query.trim())d.push('|','|',['name','ilike',query.trim()],['default_code','ilike',query.trim()],['barcode','ilike',query.trim()]);return d;
        }
        invalidateStoreStock(){this.storeStockCache=null;}
        async storeAvailableIds(){
            this.assertScope();
            const warehouse=this.warehouses?.[0],companyId=this.companyId,warehouseId=this.warehouseId,stockId=warehouse?.stockId;
            if(warehouse?.id!==warehouseId||!Number.isSafeInteger(stockId)||stockId<=0)throw Error('请先选择提醒门店 / Seleccione el almacén de destino.');
            const key=JSON.stringify([companyId,warehouseId,stockId]),cached=this.storeStockCache;
            if(cached?.key===key){if(cached.promise)return cached.promise;if(cached.expires>Date.now())return cached.ids;}
            const state={key,promise:null,ids:null,expires:0};this.storeStockCache=state;
            state.promise=(async()=>{
                try{
                    // Group the complete destination subtree before filtering; omitted products have zero stock.
                    const rows=await this.rpc('stock.quant','read_group',[[['company_id','=',companyId],['location_id','child_of',stockId]],['product_id','quantity:sum','reserved_quantity:sum'],['product_id']],{lazy:false,limit:false});
                    this.assertScope();
                    if(this.companyId!==companyId||this.warehouseId!==warehouseId||this.warehouses?.[0]?.stockId!==stockId)throw Error('提醒门店已切换，请重新查询 / Cambió el destino; vuelva a consultar.');
                    if(!Array.isArray(rows)||rows.some(r=>!Number.isSafeInteger(Core.id(r?.product_id))||Core.id(r?.product_id)<=0))throw Error('门店库存未核实，请重试 / Existencias del destino sin verificar; reintente.');
                    const stocks=Core.stockMap(rows,rows.map(r=>Core.id(r.product_id)));
                    state.ids=[...stocks].filter(([,s])=>s.available>0).map(([id])=>id).sort((a,b)=>a-b);state.expires=Date.now()+60000;
                    return state.ids;
                }catch(error){if(this.storeStockCache===state)this.storeStockCache=null;throw error;}
                finally{state.promise=null;}
            })();
            return state.promise;
        }
        async filterDomain(query,category,filters={}){
            const domain=this.productDomain(query,category);
            if(filters.monitoring&&filters.monitoring!=='all'||String(filters.threshold??'').trim()!==''){
                const index=filters.ruleIndex||await this.rules();
                domain.push(...Core.reminderDomain(index,filters));
            }
            if(filters.posCategory)domain.push(['pos_categ_ids','child_of',filters.posCategory]);
            if(filters.supplier){
                const sellers=await this.all('product.supplierinfo',[['partner_id','=',filters.supplier],'|',['company_id','=',false],['company_id','=',this.companyId]],['id','product_id','product_tmpl_id']);
                const variants=[...new Set(sellers.map(s=>Core.id(s.product_id)).filter(Boolean))];
                const templates=[...new Set(sellers.filter(s=>!Core.id(s.product_id)).map(s=>Core.id(s.product_tmpl_id)).filter(Boolean))];
                // Older uncolored products can remain on supplier lines after color variants replace them.
                // Only this archived, attribute-free predecessor applies to the whole model.
                const linked=new Map();
                for(const batch of chunks(variants)){
                    const records=await this.rpc('product.product','read',[batch],{fields:['id','active','product_tmpl_id','product_template_attribute_value_ids','company_id']});
                    this.assertScope();if(!Array.isArray(records))throw Error('供应商商品资料未核实 / Productos del proveedor sin verificar.');
                    for(const p of records)if(batch.includes(p.id))linked.set(p.id,p);
                }
                for(const seller of sellers){
                    const p=linked.get(Core.id(seller.product_id)),template=Core.id(seller.product_tmpl_id);
                    if(p?.active===false&&Array.isArray(p.product_template_attribute_value_ids)&&p.product_template_attribute_value_ids.length===0&&Core.id(p.product_tmpl_id)===template&&template&&(!Core.id(p.company_id)||Core.id(p.company_id)===this.companyId)&&!templates.includes(template))templates.push(template);
                }
                domain.push('|',['id','in',variants],['product_tmpl_id','in',templates]);
            }
            const storeStock=filters.storeStock||'all';
            if(!['all','in','out'].includes(storeStock))throw Error('门店库存筛选无效 / Filtro de existencias inválido.');
            if(storeStock!=='all')domain.push(['id',storeStock==='in'?'in':'not in',await this.storeAvailableIds()]);
            return domain;
        }
        async filterChoices(){
            const [categoryResult,posResult,sellerResult]=await Promise.allSettled([this.all('product.category',[],['id','display_name']),this.all('pos.category',[],['id','display_name']),this.all('product.supplierinfo',['|',['company_id','=',false],['company_id','=',this.companyId]],['id','partner_id'])]);
            if(categoryResult.status==='rejected')throw categoryResult.reason;
            const categories=categoryResult.value,posCategories=posResult.status==='fulfilled'?posResult.value:[],sellers=sellerResult.status==='fulfilled'?sellerResult.value:[];
            const suppliers=new Map();for(const s of sellers)if(Core.id(s.partner_id))suppliers.set(Core.id(s.partner_id),{id:Core.id(s.partner_id),display_name:s.partner_id[1]});
            return {categories,posCategories,suppliers:[...suppliers.values()].sort((a,b)=>a.display_name.localeCompare(b.display_name)),supplierUnavailable:sellerResult.status==='rejected',posUnavailable:posResult.status==='rejected'};
        }
        async search(query,category,page=0,filters={}){
            const domain=await this.filterDomain(query,category,filters);
            const [rows,count]=await Promise.all([this.rpc('product.product','search_read',[domain],{fields:PRODUCT_FIELDS,order:'default_code,id',offset:page*50,limit:50}),this.rpc('product.product','search_count',[domain])]);
            this.assertScope();if(!Array.isArray(rows)||!Number.isSafeInteger(count))throw Error('商品查询未核实 / Consulta sin verificar.');return {rows,count,page};
        }
        async allMatches(query,category,filters={}){return this.all('product.product',await this.filterDomain(query,category,filters),PRODUCT_FIELDS,10000);}
        async searchGroups(query,category,page=0,filters={},catalog=null){
            const domain=await this.filterDomain(query,category,filters),key=JSON.stringify(domain);
            if(!catalog||catalog.key!==key){
                const matches=await this.all('product.product',domain,['id','name','default_code','product_tmpl_id'],10000);
                const types=new Map();for(const p of matches)if(!types.has(Core.id(p.product_tmpl_id)))types.set(Core.id(p.product_tmpl_id),Views.typeOf(p));
                catalog={key,groups:Core.templateGroups(matches).map(g=>({...g,typeLabel:types.get(g.id)||'OTROS'})),variantCount:matches.length};
            }
            const ordered=filters.groupTypes?Views.groups(catalog.groups,g=>g.typeLabel).flatMap(g=>g.items):catalog.groups;
            const selected=ordered.slice(page*50,(page+1)*50),ids=selected.map(g=>g.id);
            const variants=ids.length?await this.all('product.product',[...this.productDomain(),['product_tmpl_id','in',ids]],PRODUCT_FIELDS,10000):[];
            const groups=selected.map(g=>({...g,variants:variants.filter(p=>Core.id(p.product_tmpl_id)===g.id).sort((a,b)=>String(a.default_code).localeCompare(String(b.default_code))||a.id-b.id)}));
            for(const g of groups)if(g.matchedIds.some(id=>!g.variants.some(p=>p.id===id)))throw Error('商品变体刚发生变化，请刷新 / Cambiaron las variantes; actualice.');
            const matching=new Set(selected.flatMap(g=>g.matchedIds));
            return {groups,rows:variants.filter(p=>matching.has(p.id)),count:catalog.groups.length,variantCount:catalog.variantCount,page,catalog};
        }
        async preview(products,expected,options){
            if(!this.canEdit)throw Error('没有修改补货设置的权限 / Sin permiso para editar los ajustes.');
            const fresh=await this.rules();return Core.savePlan(products,fresh,expected,options);
        }
        async save(products,expected,options){
            if(this.saving)throw Error('正在保存，请勿重复点击 / Guardando; no repita.');
            this.saving=true;let mutationStarted=false;
            try{
                const freshProducts=await this.productRecords(products.map(p=>p.id));
                if(freshProducts.length!==products.length||freshProducts.some(p=>Core.id(p.company_id)&&Core.id(p.company_id)!==this.companyId))throw Error('商品已变更或不属于当前公司 / Productos modificados o de otra compañía.');
                if(options.templateId){
                    const siblings=await this.all('product.product',[...this.productDomain(),['product_tmpl_id','=',options.templateId]],['id'],10000);
                    if(siblings.length!==products.length||siblings.some(p=>!products.some(old=>old.id===p.id))||freshProducts.some(p=>Core.id(p.product_tmpl_id)!==options.templateId))throw Error('该型号的变体已变化，请刷新后重新选择型号 / Cambiaron las variantes del modelo; vuelva a seleccionarlo.');
                }
                const plan=await this.preview(freshProducts,expected,options);this.assertScope();
                const updates=new Map(),creates=[];
                for(const c of plan.changes){
                    if(c.prior){const key=JSON.stringify(c.values);if(!updates.has(key))updates.set(key,[]);updates.get(key).push(c.prior.id);}
                    else if(!options.disable)creates.push({x_name:`${this.warehouses[0]?.code||'Playbox'} · ${c.product.default_code||c.product.id}`,x_pb_company_id:this.companyId,x_pb_warehouse_id:this.warehouseId,x_pb_product_id:c.product.id,...c.values});
                }
                for(const [values,ids] of updates){for(const batch of chunks(ids,200)){this.assertScope();mutationStarted=true;await this.rpc(Core.MODEL,'write',[batch,JSON.parse(values)]);}}
                for(const batch of chunks(creates,200)){this.assertScope();mutationStarted=true;await this.rpc(Core.MODEL,'create',[batch]);}
                const verified=await this.rules();
                for(const c of plan.changes){if(options.disable&&!c.prior)continue;const actual=verified.get(c.product.id);if(!actual||Object.entries(c.values).some(([k,v])=>actual[k]!==v))throw Error('保存结果被其他修改覆盖或未能核实 / Guardado sin verificar o cambiado por otro equipo.');}
                return {changed:plan.changes.length,protected:plan.protectedIds.length,index:verified};
            }catch(error){if(mutationStarted)throw Error('保存可能部分完成或响应未核实，请重新载入核对，勿直接重复保存。 / Puede haberse guardado parcialmente; recargue antes de repetir. '+error.message);throw error;}
            finally{this.saving=false;}
        }
    }
    return Object.freeze({Service,RULE_FIELDS,PRODUCT_FIELDS,chunks});
});

return module.exports;})();
const Warehouse=(()=>{const module={exports:{}};const require=n=>n==='./core.js'?Core:BaseService;
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./core.js'),require('./service.js'));else root.PBReplenishmentWarehouse=factory(root.PBReplenishmentCore,root.PBReplenishmentService);})(typeof globalThis==='object'?globalThis:this,function(Core,Base){
    'use strict';
    const SETTINGS='x_pb_replenishment_warehouse';
    const FIELDS=['id','x_name','x_pb_company_id','x_pb_warehouse_id','x_pb_source_ids','write_date'];
    const PRIORITY='x_pb_source_priority';
    function defaultPriority(warehouses){
        const rank=w=>{const text=String(w.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'');return ['BP27','BODEGA27'].includes(text)?0:['BG31P','BP31','BODEGA31'].includes(text)?1:['CB63','CUBA63'].includes(text)?2:3;};
        return [...warehouses].sort((a,b)=>rank(a)-rank(b)).map(w=>w.id);
    }
    const stamp=r=>r?JSON.stringify([r.id,r.write_date,[...r.x_pb_source_ids].sort((a,b)=>a-b),r[PRIORITY]||false]):'default';
    function sourcePriority(raw,ids){
        let order=[];if(raw){try{order=JSON.parse(raw);}catch(_){throw Error('货源优先级无法读取，请重新设置 / Prioridad no válida.');}
            if(!Array.isArray(order)||order.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(order).size!==order.length)throw Error('货源优先级无效 / Prioridad no válida.');}
        return [...order.filter(id=>ids.includes(id)),...ids.filter(id=>!order.includes(id))];
    }
    function selectWarehouses(rows,companyId,targetId,sources){
        const owned=rows.filter(w=>Core.id(w.company_id)===companyId&&w.active!==false&&Core.id(w.lot_stock_id)>0);
        const target=owned.find(w=>w.id===targetId);if(!target)throw Error('所选门店已停用或不属于当前公司 / Almacén de destino no válido.');
        if(!Array.isArray(sources)||sources.some(i=>!Number.isSafeInteger(i)||i<=0)||new Set(sources).size!==sources.length||sources.includes(targetId))throw Error('货源仓库重复或包含门店自身 / Origen duplicado o igual al destino.');
        return [target,...sources.map(id=>{const w=owned.find(w=>w.id===id);if(!w)throw Error('货源仓库已停用或不属于当前公司 / Almacén de origen no válido.');return w;})].map(w=>({...w,label:w.code||w.name,stockId:Core.id(w.lot_stock_id)}));
    }
    class Service extends Base.Service{
        constructor(options){super(options);this.targetId=options.targetId||0;this.dynamicWarehouses=true;this.warehouseSettingsMissing=false;this.canEditWarehouses=false;this.warehouseAccess={write:false,create:false};}
        async init(){
            await super.init();
            const target=this.targetId?this.availableWarehouses.find(w=>w.id===this.targetId):this.availableWarehouses.find(w=>w.code==='HR27')||this.availableWarehouses[0];
            this.warehouseId=target?.id||0;this.defaultSources=[];
            if(target?.code==='HR27'){try{this.defaultSources=Core.resolveWarehouses(this.availableWarehouses,this.companyId).slice(1).map(w=>w.id);}catch(_){}}
            try{
                const defs=await this.rpc(SETTINGS,'fields_get',[],{attributes:['type','relation']});
                this.priorityAvailable=defs[PRIORITY]?.type==='char';
                if(defs.x_pb_company_id?.relation!=='res.company'||defs.x_pb_warehouse_id?.relation!=='stock.warehouse'||defs.x_pb_source_ids?.type!=='many2many'||defs.x_pb_source_ids.relation!=='stock.warehouse')throw Error('仓库设置结构不兼容 / Configuración de almacenes incompatible.');
                const access=await Promise.all(['read','write','create'].map(op=>this.rpc(SETTINGS,'check_access_rights',[op,false])));
                if(!access[0])throw Error('无权读取共享仓库设置 / Sin permiso de lectura de almacenes.');
                // Warehouse settings have their own ACLs. Updating an existing record
                // does not require create access or permission to edit product thresholds.
                this.warehouseAccess={write:Boolean(access[1]),create:Boolean(access[2])};
            }catch(e){if(e.httpStatus===404||/KeyError$/.test(e.rpcName||'')&&e.message.includes(SETTINGS))this.warehouseSettingsMissing=true;else throw e;}
            await this.loadWarehouseSettings();return this;
        }
        async warehouseRecord(){
            if(this.warehouseSettingsMissing)return null;
            const rows=await this.all(SETTINGS,[['x_pb_company_id','=',this.companyId],['x_pb_warehouse_id','=',this.warehouseId]],this.priorityAvailable?[...FIELDS,PRIORITY]:FIELDS);
            if(rows.length>1)throw Error('门店存在重复货源配置，请管理员核对 / Configuración de origen duplicada.');
            const r=rows[0]||null;if(r&&(Core.id(r.x_pb_company_id)!==this.companyId||Core.id(r.x_pb_warehouse_id)!==this.warehouseId||!Array.isArray(r.x_pb_source_ids)))throw Error('仓库配置范围不一致 / Configuración fuera del ámbito.');
            return r;
        }
        async loadWarehouseSettings(){
            const record=await this.warehouseRecord();this.warehouses=selectWarehouses(this.availableWarehouses,this.companyId,this.warehouseId,record?record.x_pb_source_ids:this.defaultSources);
            this.sourceRecord=record;this.sourceStamp=stamp(record);this.sourcePriority=sourcePriority(record?.[PRIORITY],defaultPriority(this.warehouses.slice(1)));
            this.canEditWarehouses=!this.warehouseSettingsMissing&&Boolean(record?this.warehouseAccess.write:this.warehouseAccess.create);return record;
        }
        async snapshot(){
            await this.loadWarehouseSettings();if(this.warehouses.length<2)throw Error('请先到“仓库设置”勾选货源仓库 / Seleccione almacenes de origen.');
            const before=this.sourceStamp,result=await super.snapshot();
            if(stamp(await this.warehouseRecord())!==before)throw Error('核对期间货源刚被修改，请刷新 / Cambiaron los almacenes; actualice.');return result;
        }
        async saveWarehouseSources(ids,expectedStamp){
            if(!this.canEditWarehouses||this.warehouseSettingsMissing)throw Error('需要补货设置修改权限或先部署仓库设置 / Configuración no disponible para editar.');
            if(this.saving)throw Error('正在保存 / Guardando.');this.saving=true;let started=false;
            try{
                if(!ids.length)throw Error('至少选择一个货源仓库 / Seleccione al menos un origen.');
                const fresh=await this.all('stock.warehouse',[['company_id','=',this.companyId],['active','=',true]],['id','name','code','company_id','lot_stock_id']);
                const chosen=selectWarehouses(fresh,this.companyId,this.warehouseId,ids);
                const locations=await this.rpc('stock.location','read',[chosen.map(w=>w.stockId),['id','parent_path']]);
                if(!Array.isArray(locations)||locations.length!==chosen.length||locations.some(l=>typeof l.parent_path!=='string'||!l.parent_path.endsWith(l.id+'/')))throw Error('无法核实库位范围 / Ubicaciones sin verificar.');
                for(let i=0;i<locations.length;i++)for(let j=i+1;j<locations.length;j++)if(locations[i].parent_path.startsWith(locations[j].parent_path)||locations[j].parent_path.startsWith(locations[i].parent_path))throw Error('所选仓库库存范围重叠，请改选独立仓库 / Los almacenes se superponen.');
                const current=await this.warehouseRecord();if(stamp(current)!==expectedStamp)throw Error('货源已被其他电脑修改，请重新打开 / Otro equipo cambió los orígenes; recargue.');
                if(!(current?this.warehouseAccess.write:this.warehouseAccess.create))throw Error('当前账号无权保存此货源配置 / Sin permiso para guardar estos orígenes.');
                const sorted=[...ids].sort((a,b)=>a-b);if(current&&JSON.stringify([...current.x_pb_source_ids].sort((a,b)=>a-b))===JSON.stringify(sorted))return {changed:false};
                this.assertScope();started=true;
                if(current)await this.rpc(SETTINGS,'write',[[current.id],{x_pb_source_ids:[[6,0,sorted]]}]);
                else await this.rpc(SETTINGS,'create',[[{x_name:'Playbox · '+chosen[0].label,x_pb_company_id:this.companyId,x_pb_warehouse_id:this.warehouseId,x_pb_source_ids:[[6,0,sorted]]}]]);
                const actual=await this.warehouseRecord();if(!actual||JSON.stringify([...actual.x_pb_source_ids].sort((a,b)=>a-b))!==JSON.stringify(sorted))throw Error('保存后货源未核实 / Guardado sin verificar.');
                this.availableWarehouses=fresh;await this.loadWarehouseSettings();return {changed:true};
            }catch(e){if(started)throw Error('保存可能已完成，请重新打开核对，勿直接重试 / Verifique antes de repetir. '+e.message);throw e;}
            finally{this.saving=false;}
        }
        async saveSourcePriority(ids,expectedStamp){
            if(!this.priorityAvailable||!this.canEditWarehouses)throw Error('共享优先级尚未启用或无修改权限 / Prioridad no disponible.');
            if(this.saving)throw Error('正在保存 / Guardando.');this.saving=true;let started=false;
            try{
                const current=await this.warehouseRecord();if(stamp(current)!==expectedStamp)throw Error('货源设置已变化，请重新打开 / Cambiaron los orígenes; recargue.');
                if(!(current?this.warehouseAccess.write:this.warehouseAccess.create))throw Error('当前账号无权保存此货源配置 / Sin permiso para guardar estos orígenes.');
                const sources=current?current.x_pb_source_ids:this.defaultSources;
                if(!Array.isArray(ids)||ids.length!==sources.length||new Set(ids).size!==ids.length||ids.some(id=>!sources.includes(id)))throw Error('优先级必须包含每个货源一次 / Incluya cada origen una vez.');
                const value=JSON.stringify(ids);if(current?.[PRIORITY]===value)return {changed:false};
                this.assertScope();started=true;
                if(current)await this.rpc(SETTINGS,'write',[[current.id],{[PRIORITY]:value}]);
                else await this.rpc(SETTINGS,'create',[[{x_name:'Playbox · '+this.warehouses[0].label,x_pb_company_id:this.companyId,x_pb_warehouse_id:this.warehouseId,x_pb_source_ids:[[6,0,[...sources]]],[PRIORITY]:value}]]);
                const actual=await this.warehouseRecord();if(actual?.[PRIORITY]!==value)throw Error('优先级保存后未核实 / Prioridad sin verificar.');
                await this.loadWarehouseSettings();return {changed:true};
            }catch(e){if(started)throw Error('保存可能已完成，请重新打开核对 / Verifique el guardado. '+e.message);throw e;}
            finally{this.saving=false;}
        }
    }
    return Object.freeze({Service,SETTINGS,FIELDS,stamp,selectWarehouses,PRIORITY,sourcePriority,defaultPriority});
});

return module.exports;})();
// Use fresh stock-operation records, not pos.config.warehouse_id, which can
// contain a legacy default or a Ship Later override.
const PosWarehouse=(()=>{
    const validId=value=>{const id=Core.id(value);return Number.isSafeInteger(id)&&id>0?id:0;};
    const preferenceKey=(uid,companyId,configId)=>`pos:${uid}:${companyId}:${configId}`;
    async function resolve(rpc,configId,companyId){
        if(!validId(configId))throw Error('POS 正在启动，请稍后再打开 / POS iniciándose; vuelva a abrir.');
        const configs=await rpc('pos.config','read',[[configId],['id','name','company_id','picking_type_id']]);
        const config=Array.isArray(configs)&&configs.length===1?configs[0]:null;
        if(config?.id!==configId||validId(config.company_id)!==companyId)throw Error('POS 配置与当前公司不一致 / La configuración POS no corresponde a esta compañía.');
        const pickingTypeId=validId(config.picking_type_id);
        if(!pickingTypeId)throw Error('POS 未设置出库类型，请在 Odoo 后台核对 / Configure el tipo de operación del POS.');
        const types=await rpc('stock.picking.type','read',[[pickingTypeId],['id','company_id','warehouse_id','default_location_src_id']]);
        const type=Array.isArray(types)&&types.length===1?types[0]:null;
        if(type?.id!==pickingTypeId||validId(type.company_id)!==companyId)throw Error('POS 出库类型与当前公司不一致 / El tipo de operación POS no corresponde a esta compañía.');
        let warehouseId=validId(type.warehouse_id),resolvedBy='picking_type';
        if(!warehouseId){
            // Custom operation types may omit warehouse_id. Require a unique
            // stock root containing the source location; never guess by name.
            const locationId=validId(type.default_location_src_id);
            if(!locationId)throw Error('POS 出库类型未关联仓库或源库位 / Operación POS sin almacén ni ubicación de origen.');
            const locations=await rpc('stock.location','read',[[locationId],['id','company_id','parent_path']]);
            const location=Array.isArray(locations)&&locations.length===1?locations[0]:null;
            if(location?.id!==locationId||validId(location.company_id)!==companyId||typeof location.parent_path!=='string'||!location.parent_path.endsWith(locationId+'/'))throw Error('无法核实 POS 源库位 / Ubicación de origen POS sin verificar.');
            const ancestors=new Set(location.parent_path.split('/').filter(Boolean).map(Number));
            const rows=await rpc('stock.warehouse','search_read',[[['company_id','=',companyId],['active','=',true],['lot_stock_id','in',[...ancestors]]]],{fields:['id','company_id','lot_stock_id'],limit:2});
            if(!Array.isArray(rows)||rows.length!==1||validId(rows[0].company_id)!==companyId||!ancestors.has(validId(rows[0].lot_stock_id))||!validId(rows[0].id))throw Error('无法唯一确定 POS 源库位所属仓库 / No se pudo identificar un almacén único para el origen POS.');
            warehouseId=rows[0].id;resolvedBy='source_location';
        }
        return {configId,configName:config.name||String(configId),pickingTypeId,warehouseId,resolvedBy};
    }
    return Object.freeze({resolve,preferenceKey,validId});
})();
const Extras=(()=>{const module={exports:{}};const require=()=>Core;
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./core.js'));else root.PBReplenishmentExtras=factory(root.PBReplenishmentCore);})(typeof globalThis==='object'?globalThis:this,function(Core){
    'use strict';
    const FOLLOWUP_FIELDS=['x_pb_followup_state','x_pb_snooze_until'];
    const FORMAT='playbox-replenishment-thresholds';
    function followup(rule,now=Date.now()){
        const state=rule?.x_pb_followup_state,raw=rule?.x_pb_snooze_until;
        const until=typeof raw==='string'&&/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(raw)?Date.parse(raw.replace(' ','T')+'Z'):NaN;
        const valid=Number.isFinite(until)&&new Date(until).toISOString().slice(0,19).replace('T',' ')===raw;
        return ['contacted','snoozed'].includes(state)&&valid&&until>now?{state,until}:{state:'pending',until:0};
    }
    function followupValues(state,days,now=Date.now()){
        if(state==='pending')return {x_pb_followup_state:false,x_pb_snooze_until:false};
        if(!['contacted','snoozed'].includes(state))throw Error('处理状态无效 / Estado inválido.');
        const count=Core.minimum(days);if(count<1||count>30)throw Error('请选择 1～30 天 / Elija de 1 a 30 días.');
        return {x_pb_followup_state:state,x_pb_snooze_until:new Date(now+count*86400000).toISOString().slice(0,19).replace('T',' ')};
    }
    function backup(index,products,scope,now=Date.now()){
        return {format:FORMAT,schema:1,exportedAt:new Date(now).toISOString(),...scope,entries:[...index].map(([productId,r])=>{
            const p=products.get(productId);if(!p)throw Error('部分商品无法读取，无法生成完整备份 / No se puede completar la copia.');
            return {productId,code:String(p.default_code||''),templateId:Core.id(p.product_tmpl_id),enabled:r.x_pb_enabled,thresholdSet:r.x_pb_threshold_set,minPieces:r.x_pb_min_pieces,individual:r.x_pb_is_override};
        })};
    }
    function validateBackup(value,scope){
        if(!value||typeof value!=='object'||value.format!==FORMAT||value.schema!==1||!Array.isArray(value.entries)||value.entries.length>20000)throw Error('备份格式不正确 / Copia no válida.');
        if(value.origin!==scope.origin||value.companyId!==scope.companyId||value.warehouseId!==scope.warehouseId)throw Error('备份不属于当前数据库、公司或门店 / La copia es de otra base, compañía o tienda.');
        const seen=new Set();
        for(const e of value.entries){
            if(!e||!Number.isSafeInteger(e.productId)||e.productId<=0||seen.has(e.productId)||!Number.isSafeInteger(e.templateId)||e.templateId<=0||typeof e.code!=='string'||e.code.length>512||['enabled','thresholdSet','individual'].some(k=>typeof e[k]!=='boolean')||!Number.isSafeInteger(e.minPieces)||e.minPieces<0||e.minPieces>999999999)throw Error('备份商品重复或数值无效 / Productos duplicados o valores inválidos.');
            seen.add(e.productId);
        }return value;
    }
    function restorePlan(file,current,products){
        const changes=[],skipped=[];
        for(const entry of file.entries){
            const p=products.get(entry.productId);
            if(!p||String(p.default_code||'')!==entry.code||Core.id(p.product_tmpl_id)!==entry.templateId){skipped.push({code:entry.code,reason:'identity'});continue;}
            if(entry.enabled&&(!Core.pieceProduct(p)||!entry.thresholdSet)){skipped.push({code:entry.code,reason:'inactive'});continue;}
            const prior=current.get(entry.productId),values={x_pb_enabled:entry.enabled,x_pb_threshold_set:entry.thresholdSet,x_pb_min_pieces:entry.minPieces,x_pb_is_override:entry.individual};
            if(prior&&Object.entries(values).every(([k,v])=>prior[k]===v))continue;
            changes.push({product:p,prior,values});
        }return {changes,skipped,total:file.entries.length};
    }
    const planStamp=plan=>JSON.stringify({changes:plan.changes.map(c=>[c.product.id,Core.ruleStamp(c.prior),c.values]),skipped:plan.skipped});
    const searchKey=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    function searchRows(rows,query=''){
        const tokens=searchKey(query).trim().split(/\s+/).filter(Boolean);
        if(!tokens.length)return rows;
        return rows.filter(r=>{const p=r.product,haystack=searchKey(`${p?.default_code||''} ${p?.name||''} ${p?.display_name||''}`);return tokens.every(token=>haystack.includes(token));});
    }
    function cartonCheck(row,raw=Core.defaultCopyLine(row.product),sourceId=0){
        let request,original;
        try{request=Core.parseCopyLine(raw);}catch(_){return {status:'invalid-text',sources:[]};}
        try{original=Core.parseCopyLine(Core.defaultCopyLine(row.product));}catch(_){}
        if(!original||request.model.toUpperCase()!==original.model.toUpperCase()||request.color!==original.color)return {...request,status:'changed-product',sources:[]};
        const carton=row.carton;
        if(!Number.isSafeInteger(carton)||carton<=1)return {...request,status:'unknown-carton',sources:[]};
        const required=request.cartons*carton;
        if(!Number.isSafeInteger(required))return {...request,status:'quantity-overflow',sources:[]};
        const sources=(row.sources||[]).filter(s=>!sourceId||s.warehouseId===sourceId).map(s=>{
            const verified=Number.isFinite(s.available),maxCartons=verified?Math.floor((Math.max(0,s.available)+1e-7)/carton):null;
            return {...s,maxCartons,status:!verified?'unknown-stock':maxCartons>=request.cartons?'enough':'shortage'};
        });
        return {...request,carton,required,sources,status:sources.some(s=>s.status==='enough')?'enough':!sources.length||sources.some(s=>s.status==='unknown-stock')?'unknown-stock':'shortage'};
    }
    function supplyRows(rows,{sourceId=0,receipt='all',incoming=new Map(),incomingReady=false,state='all',query=''}={}){
        if(!Number.isSafeInteger(sourceId)||sourceId<0||!['all','with','without'].includes(receipt))throw Error('筛选无效 / Filtro inválido.');
        return searchRows(rows,query).filter(r=>r.status==='available'&&(!sourceId||r.sources.some(s=>s.warehouseId===sourceId&&s.available>0))&&(state==='all'||followup(r.rule).state===state)&&(receipt==='all'||incomingReady&&incoming.has(r.productId)&&(receipt==='with'?incoming.get(r.productId)>0:incoming.get(r.productId)===0)));
    }
    return Object.freeze({FOLLOWUP_FIELDS,FORMAT,followup,followupValues,backup,validateBackup,restorePlan,planStamp,searchRows,cartonCheck,supplyRows});
});

return module.exports;})();
const {Service}=(()=>{const module={exports:{}};const require=n=>({'./core.js':Core,'./extras-core.js':Extras,'./warehouse.js':Warehouse,'./service.js':BaseService})[n];
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./core.js'),require('./extras-core.js'),require('./warehouse.js'),require('./service.js'));else root.PBReplenishmentExtraService=factory(root.PBReplenishmentCore,root.PBReplenishmentExtras,root.PBReplenishmentWarehouse,root.PBReplenishmentService);})(typeof globalThis==='object'?globalThis:this,function(Core,Extras,Warehouse,Base){
    'use strict';
    class Service extends Warehouse.Service{
        async init(){
            await super.init();const defs=this.fieldDefinitions;
            this.followupAvailable=defs.x_pb_followup_state?.type==='char'&&defs.x_pb_snooze_until?.type==='datetime';
            this.ruleFields=[...Base.RULE_FIELDS,...(this.followupAvailable?Extras.FOLLOWUP_FIELDS:[])];return this;
        }
        async filterDomain(query,category,filters={}){
            if(filters.monitoring!=='missing')return super.filterDomain(query,category,filters);
            const index=filters.ruleIndex||await this.rules(),anchors=await this.productRecords(Core.watched(index));
            const templates=[...new Set(anchors.map(p=>Core.id(p.product_tmpl_id)).filter(Boolean))];
            const domain=await super.filterDomain(query,category,{...filters,monitoring:'all',threshold:''});
            domain.push(['product_tmpl_id','in',templates],['id','not in',[...index.keys()]]);return domain;
        }
        async setFollowup(ids,expected,state,days){
            if(!this.canEdit||!this.followupAvailable)throw Error('此库未启用共享处理标记，或当前账号无修改权限 / Seguimiento no disponible.');
            if(this.saving)throw Error('正在保存 / Guardando.');if(!ids.length||new Set(ids).size!==ids.length)throw Error('请勾选商品 / Seleccione productos.');
            const values=Extras.followupValues(state,days);this.saving=true;let started=false;
            try{
                const fresh=await this.rules(),rows=ids.map(id=>fresh.get(id));
                if(rows.some((r,i)=>!r||!r.x_pb_enabled||!r.x_pb_threshold_set||Core.ruleStamp(r)!==Core.ruleStamp(expected.get(ids[i]))))throw Error('商品设置已变化，请刷新后重试 / Cambiaron los ajustes; actualice.');
                const changed=rows.filter(r=>Object.entries(values).some(([k,v])=>(r[k]||false)!==v));
                for(const batch of Base.chunks(changed.map(r=>r.id),200)){this.assertScope();started=true;await this.rpc(Core.MODEL,'write',[batch,values]);}
                const verified=await this.rules();if(ids.some(id=>Object.entries(values).some(([k,v])=>(verified.get(id)?.[k]||false)!==v)))throw Error('处理标记未能核实 / Seguimiento sin verificar.');
                return {changed:changed.length,index:verified};
            }catch(e){if(started)throw Error('保存可能已完成，请刷新核对，勿直接重试 / Verifique antes de repetir. '+e.message);throw e;}
            finally{this.saving=false;}
        }
        async exportBackup(scope){
            const index=await this.rules(),products=new Map((await this.productRecords([...index.keys()])).map(p=>[p.id,p]));
            return Extras.backup(index,products,scope);
        }
        async previewRestore(input,scope){
            const file=Extras.validateBackup(input,scope),index=await this.rules();
            const records=await this.productRecords(file.entries.map(e=>e.productId));
            const products=new Map(records.filter(p=>!Core.id(p.company_id)||Core.id(p.company_id)===this.companyId).map(p=>[p.id,p]));
            return {file,plan:Extras.restorePlan(file,index,products)};
        }
        async restoreBackup(preview,scope){
            if(!this.canEdit)throw Error('没有恢复门槛的权限 / Sin permiso.');
            if(this.saving)throw Error('正在保存 / Guardando.');this.saving=true;let started=false;
            try{
                const fresh=await this.previewRestore(preview.file,scope);
                if(Extras.planStamp(preview.plan)!==Extras.planStamp(fresh.plan))throw Error('配置或商品已变化，请重新预览 / Cambiaron los datos; vuelva a previsualizar.');
                const updates=new Map(),creates=[];
                for(const c of fresh.plan.changes){if(c.prior){const key=JSON.stringify(c.values);if(!updates.has(key))updates.set(key,[]);updates.get(key).push(c.prior.id);}else creates.push({x_name:`${this.warehouses[0]?.code||'Playbox'} · ${c.product.default_code||c.product.id}`,x_pb_company_id:this.companyId,x_pb_warehouse_id:this.warehouseId,x_pb_product_id:c.product.id,...c.values});}
                for(const [values,ids] of updates)for(const batch of Base.chunks(ids,200)){this.assertScope();started=true;await this.rpc(Core.MODEL,'write',[batch,JSON.parse(values)]);}
                for(const batch of Base.chunks(creates,200)){this.assertScope();started=true;await this.rpc(Core.MODEL,'create',[batch]);}
                const verified=await this.rules();if(fresh.plan.changes.some(c=>Object.entries(c.values).some(([k,v])=>verified.get(c.product.id)?.[k]!==v)))throw Error('恢复结果未核实 / Restauración sin verificar.');
                return {changed:fresh.plan.changes.length,skipped:fresh.plan.skipped.length};
            }catch(e){if(started)throw Error('恢复可能部分完成，请重新预览核对，勿直接重试 / Verifique antes de repetir. '+e.message);throw e;}
            finally{this.saving=false;}
        }
    }
    return Object.freeze({Service});
});

return module.exports;})();
const Drafts=(()=>{const module={exports:{}};const require=()=>Core;
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./core.js'));else root.PBReplenishmentDrafts=factory(root.PBReplenishmentCore);})(typeof globalThis==='object'?globalThis:this,function(Core){
    'use strict';
    const defaults=()=>({query:'',sourceId:0,receipt:'all',state:'pending'});
    function count(value){const text=String(value??'');if(!/^[1-9]\d{0,8}$/.test(text))throw Error('箱数请输入 1～999999999 的整数 / Ingrese cajas enteras entre 1 y 999999999.');return Number(text);}
    function identity(p){return JSON.stringify([p?.id,Core.id(p?.product_tmpl_id),String(p?.default_code||''),Core.defaultCopyLine(p)]);}
    function line(p,value){const c=count(value),base=Core.parseCopyLine(Core.defaultCopyLine(p));return `${base.model} ${c}${base.color}`;}
    function key(scope){
        if(!scope||typeof scope.origin!=='string'||!['backend','pos'].includes(scope.surface)||['uid','companyId','warehouseId'].some(k=>!Number.isSafeInteger(scope[k])||scope[k]<=0))throw Error('草稿范围未核实 / Ámbito del borrador sin verificar.');
        return `pb-replenishment:draft:v1:${scope.uid}:${scope.companyId}:${scope.warehouseId}:${scope.surface}`;
    }
    function filters(value){
        if(!value||typeof value.query!=='string'||value.query.length>200||!Number.isSafeInteger(value.sourceId)||value.sourceId<0||!['all','with','without'].includes(value.receipt)||!['pending','contacted','snoozed','all'].includes(value.state))throw Error('草稿筛选无效 / Filtros del borrador inválidos.');
        return {query:value.query,sourceId:value.sourceId,receipt:value.receipt,state:value.state};
    }
    function decode(raw,scope){
        key(scope);
        if(raw===null)return {schema:1,scope:{...scope},savedAt:0,filters:defaults(),entries:[]};
        if(typeof raw!=='string'||raw.length>5*1024*1024)throw Error('草稿过大或格式无效 / Borrador inválido.');
        const data=JSON.parse(raw);
        if(data?.schema!==1||!data.scope||Object.keys(scope).some(k=>data.scope[k]!==scope[k])||!Number.isFinite(data.savedAt)||!Array.isArray(data.entries)||data.entries.length>20000)throw Error('草稿不属于当前账号或门店 / Borrador de otra cuenta o tienda.');
        const seen=new Set();
        const entries=data.entries.map(e=>{if(!e||!Number.isSafeInteger(e.productId)||e.productId<=0||seen.has(e.productId)||typeof e.identity!=='string'||e.identity.length>2048||typeof e.selected!=='boolean'||typeof e.cartons!=='number')throw Error('草稿商品无效 / Producto del borrador inválido.');seen.add(e.productId);return {productId:e.productId,identity:e.identity,selected:e.selected,cartons:count(e.cartons)};});
        return {schema:1,scope:{...scope},savedAt:data.savedAt,filters:filters(data.filters),entries};
    }
    function state(entry,p){const changed=Boolean(entry&&entry.identity!==identity(p));return {selected:changed?false:entry?.selected??true,cartons:changed?1:entry?.cartons??1,changed};}
    function merge(raw,scope,patches,view=null,now=Date.now()){
        const base=decode(raw,scope),entries=new Map(base.entries.map(e=>[e.productId,e]));
        for(const [id,patch] of patches){const prior=entries.get(id),same=prior?.identity===patch.identity;
            entries.set(id,{productId:id,identity:patch.identity,selected:patch.selected??(same?prior.selected:true),cartons:patch.cartons??(same?prior.cartons:1)});
        }
        return decode(JSON.stringify({schema:1,scope,savedAt:now,filters:view||base.filters,entries:[...entries.values()].sort((a,b)=>a.productId-b.productId)}),scope);
    }
    function batchPlan(rows,selected,value){const cartons=count(value);return rows.filter(r=>selected.has(r.productId)).map(r=>({row:r,cartons,line:line(r.product,cartons)}));}
    return Object.freeze({defaults,count,identity,line,key,filters,decode,state,merge,batchPlan});
});

return module.exports;})();
    // Presentation only: keep the existing data, drafts and warehouse routing services.
    let openMenu='',alertToolbar=null,alertSources=null,actionBar=null;
function windowSizeKey() {
    const orientation = matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait';
    return 'playbox:replenishment:window:v1:' + orientation;
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


    function fitReminderWindow() {
        if (!dialog?.open) return;
        windowSizeApply(dialog);
        const viewport = window.visualViewport;
        const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
        dialog.style.setProperty('--pb-room-w', Math.max(1, width - 16) + 'px');
        dialog.style.setProperty('--pb-room-h', Math.max(1, height - 16) + 'px');
        dialog.style.setProperty('--pb-mid-x', ((viewport?.offsetLeft ?? 0) + width / 2) + 'px');
        dialog.style.setProperty('--pb-mid-y', ((viewport?.offsetTop ?? 0) + height / 2) + 'px');
    }
    const viewportEvents = ['resize','scroll'];
    for (const type of viewportEvents) window.visualViewport?.addEventListener(type, fitReminderWindow);
    window.addEventListener('resize', fitReminderWindow);
    const TABLET_ALERT_CSS = `@media (any-pointer: coarse) and (orientation: landscape) and (min-width: 800px) {
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls){width:min(1248px,94vw)!important;max-width:94vw!important;height:min(832px,90vh)!important;box-shadow:0 14px 55px #22334b28;border-radius:12px}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-head strong{font-size:22px} #pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-product-name{font-size:12px}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-low{font-variant-numeric:tabular-nums}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls){display:grid!important;grid-template-columns:195px minmax(0,1fr);grid-template-rows:auto auto minmax(0,1fr) auto;overflow:hidden}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-head,#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-footer{grid-column:1/-1}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-tabs{grid-column:2;grid-row:2}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-alert-controls{grid-column:1;grid-row:2/4;background:#edf4f1;border-right:1px solid #d9e6e0;display:flex;flex-direction:column;padding:15px 10px;overflow:auto}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-alert-toolbar,#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-sources-line,#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-source-tabs{display:flex;flex-direction:column;align-items:stretch;gap:8px}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-alert-toolbar>* ,#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-sources-line>*{max-width:100%;min-width:0;width:100%}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-source-tab{justify-content:space-between!important} #pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-body{grid-column:2;grid-row:3;overflow:auto;padding:0 12px}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-alert-toolbar input{min-width:0;width:100%} #pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-footer{grid-row:4}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-alert-toolbar .pb-rpl-alert-search {flex:0 0 auto;min-width:0}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-alert-toolbar .pb-rpl-segment {display:grid;grid-template-columns:1fr 1fr;gap:4px}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-alert-toolbar .pb-rpl-segment button {padding:6px 3px;min-width:0}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-alert-controls .pb-rpl-menu-panel {position:fixed;left:calc(50% - min(624px,47vw) + 165px);right:auto;top:28vh}

#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-alert-controls{background:#edf3f5;border-color:#d1dfe3;padding:14px 12px;gap:14px}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-sources-line{border-top:1px solid #ccdadd;padding-top:14px}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-source-tab{border:1px solid transparent;background:transparent;color:#384f58;border-radius:7px;min-height:36px;padding:6px 10px}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-source-tab[aria-pressed=true]{background:#28585c;color:white;border-color:#28585c}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-source-tab[aria-pressed=true] .pb-rpl-source-count{background:#427175;color:white}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-segment button{background:#fff;color:#3c525a;border:1px solid #d0dee1}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-segment button[aria-pressed=true]{background:#d0e5e4;color:#163f41;border-color:#9dbebd}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-alert-controls :focus-visible{outline:2px solid #246b77;outline-offset:1px}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-alert-controls .pb-rpl-menu{position:static}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-alert-controls .pb-rpl-menu-panel{z-index:10;max-height:55vh}
#pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls) .pb-rpl-alert-toolbar{align-content:stretch}

}`;
    const LAYOUT_CSS=`
    dialog.pb-rpl-modal{min-height:min(420px,90vh)}dialog.pb-rpl-modal[data-page="alerts"]{height:min(780px,90vh)}
    .pb-rpl-modal .pb-rpl-head{padding:12px 18px;min-height:58px}.pb-rpl-head-actions{display:flex;gap:12px;align-items:center}
    .pb-rpl-modal .pb-rpl-head-actions>button{border:0;background:transparent}.pb-rpl-modal .pb-rpl-tabs{padding:0 18px;gap:24px}.pb-rpl-tabs button{padding:10px 0}
    .pb-rpl-menu{position:relative;flex:0 0 auto}.pb-rpl-menu>summary{display:flex;align-items:center;justify-content:center;gap:8px;list-style:none;border:1px solid #cbd4dc;background:#fff;border-radius:7px;padding:7px 11px;font:inherit;color:#243340;white-space:nowrap;min-height:34px}
    .pb-rpl-menu>summary::-webkit-details-marker{display:none}.pb-rpl-menu>summary:focus-visible{outline:2px solid #438d95;outline-offset:2px}.pb-rpl-menu>summary[aria-disabled="true"]{opacity:.5;cursor:default}.pb-rpl-menu[open]>summary{border-color:#97bcb6;background:#f0f7f5;color:#245c54}
    .pb-rpl-menu-panel{position:absolute;right:0;top:calc(100% + 5px);z-index:6;min-width:240px;max-width:min(390px,calc(95vw - 36px));max-height:min(380px,50vh);overflow:auto;overscroll-behavior:contain;padding:12px;border:1px solid #d9e2e5;border-radius:9px;background:white;box-shadow:0 9px 28px #172d3b22}
    .pb-rpl-menu-panel>.pb-rpl-form{margin:0 0 8px}.pb-rpl-menu-panel>.pb-rpl-form>button{flex:1 0 auto}.pb-rpl-menu-panel>.pb-rpl-form label{flex-wrap:wrap}.pb-rpl-menu-panel>.pb-rpl-muted{white-space:normal;line-height:1.5}
    .pb-rpl-menu-nav{display:flex;flex-direction:column;gap:4px}.pb-rpl-menu-nav>button{text-align:left;border:0;padding:9px;background:transparent}.pb-rpl-menu-nav>button[aria-pressed="true"]{background:#edf5f3;color:#245c54;font-weight:650}
    .pb-rpl-alert-controls{padding:8px 16px 0;flex-shrink:0;border-bottom:1px solid #e5e9eb}.pb-rpl-alert-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.pb-rpl-alert-toolbar .pb-rpl-alert-search{flex:1 1 200px;min-width:160px}.pb-rpl-alert-toolbar .pb-rpl-alert-search>button{padding:7px 8px}
    .pb-rpl-alert-toolbar .pb-rpl-segment{background:transparent;padding:0;gap:4px}.pb-rpl-alert-toolbar .pb-rpl-segment button{background:#f4f6f7;padding:7px 9px;border-radius:6px;font-size:13px;white-space:nowrap}.pb-rpl-alert-toolbar .pb-rpl-segment button[aria-pressed="true"]{background:#295e60;color:white;box-shadow:none}
    .pb-rpl-alert-toolbar .pb-rpl-refresh{white-space:nowrap;padding:7px 10px}.pb-rpl-sources-line{display:flex;align-items:center;gap:12px;min-width:0;padding:6px 0}.pb-rpl-sources-line>.pb-rpl-source-tabs{flex:1;min-width:0;border:0;margin:0;padding:0}.pb-rpl-sources-line>select{width:auto;max-width:240px;flex-shrink:0;font-size:13px}
    .pb-rpl-active-filters{display:flex;gap:6px;flex-wrap:wrap}.pb-rpl-active-filters:empty{display:none}.pb-rpl-active-filters>button{font-size:12px;padding:3px 8px;margin-bottom:6px;background:#edf5f3;border-color:#c5dcd6;color:#245c54}
    .pb-rpl-modal[data-page="alerts"] .pb-rpl-body{padding:0 16px 6px;min-height:80px}.pb-rpl-modal .pb-rpl-alert-table{margin:0 0 7px}.pb-rpl-alert-table th{padding-top:8px;padding-bottom:8px;background:#f4f6f8}.pb-rpl-alert-table th:nth-child(3),.pb-rpl-alert-table th:nth-child(4){text-align:right}.pb-rpl-alert-table tbody tr.pb-rpl-alert-variant:hover{background:#fafcfb}
    .pb-rpl-footer{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:10px 16px;border-top:1px solid #e2e8ea;flex-shrink:0;background:#fff}.pb-rpl-footer>#pb-rpl-selection-count{font-size:13px;color:#334950;white-space:nowrap}.pb-rpl-footer>.pb-rpl-menu>.pb-rpl-menu-panel{bottom:calc(100% + 7px);top:auto;left:0;right:auto}.pb-rpl-footer>.pb-rpl-status{flex:1;min-width:100px;border:0;padding:0;background:transparent;text-align:right;font-size:11px;white-space:normal}.pb-rpl-footer>.pb-rpl-status.pb-rpl-error{order:5;flex-basis:100%;text-align:left;padding:5px 8px;border-radius:4px;background:#fff5f3}.pb-rpl-footer>#pb-rpl-copy-selected{margin-left:auto;white-space:nowrap}
    #pb-rpl-draft-status:not([hidden]){padding:7px 9px;background:#fff7e8;border:1px solid #ead8b4;border-radius:5px;margin:6px 0}#pb-rpl-draft-status[hidden]{display:none!important}
    .pb-rpl-filter-panel{display:flex;flex-direction:column;gap:12px}.pb-rpl-filter-panel>label{display:flex;justify-content:space-between;gap:12px;white-space:nowrap}.pb-rpl-filter-panel select{max-width:180px;min-width:0}.pb-rpl-filter-panel>.pb-rpl-type-toggle{align-self:flex-start}.pb-rpl-help-text{font-size:12px;color:#647585;line-height:1.6;white-space:normal}
    @media(max-width:760px){.pb-rpl-alert-toolbar .pb-rpl-alert-search{flex-basis:calc(100% - 150px)}.pb-rpl-alert-toolbar .pb-rpl-segment{order:4;width:100%;overflow-x:auto}.pb-rpl-alert-toolbar .pb-rpl-segment button{flex:1}.pb-rpl-footer{gap:7px}.pb-rpl-footer>.pb-rpl-status{flex-basis:100%;order:4;text-align:left}.pb-rpl-footer>.pb-rpl-menu>.pb-rpl-menu-panel{position:fixed;left:5vw;right:5vw;top:auto;bottom:16vh;width:90vw;max-width:none}.pb-rpl-sources-line{gap:5px}.pb-rpl-sources-line>select{max-width:165px}.pb-rpl-modal .pb-rpl-source-tab{padding:6px 8px}.pb-rpl-alert-controls{padding-left:12px;padding-right:12px}}
    `;
    function closeActionMenus(restoreFocus=false){
        const opened=dialog?.querySelector('.pb-rpl-menu[open]');openMenu='';
        for(const node of dialog?.querySelectorAll('.pb-rpl-menu[open]')||[])node.open=false;
        if(restoreFocus)opened?.querySelector('summary')?.focus({preventScroll:true});
        return Boolean(opened);
    }
    function actionMenu(id,label,...children){
        const panelId='pb-rpl-menu-'+id,summary=el('summary',{'aria-controls':panelId,'aria-expanded':String(openMenu===id)},label),panel=el('div',{id:panelId,class:'pb-rpl-menu-panel'},...children);
        const node=el('details',{class:'pb-rpl-menu','data-menu':id},summary,panel);node.open=openMenu===id;
        summary.addEventListener('click',event=>{if(summary.getAttribute('aria-disabled')==='true'){event.preventDefault();return;}const opening=!node.open;closeActionMenus();openMenu=opening?id:'';node.open=opening;summary.setAttribute('aria-expanded',String(opening));event.preventDefault();});
        node.addEventListener('toggle',()=>{if(!node.isConnected)return;summary.setAttribute('aria-expanded',String(node.open));});
        return node;
    }
    function navigateReminder(next){
        if(editor?.busy||service?.saving||backupBusy||followupBusy||copying)return;
        closeActionMenus();editor=null;
        if(next==='settings'){settings().catch(e=>setStatus(e.message,true));return;}
        if(next==='warehouses'){warehouseSettings().catch(e=>setStatus(e.message,true));return;}
        page=next;render();if(next==='alerts')refresh(false).catch(()=>{});
    }
    function renderChrome(){
        dialog.dataset.page=page;dialog.replaceChildren();alertToolbar=null;alertSources=null;actionBar=null;
        const busy=Boolean(editor?.busy||service?.saving||backupBusy||followupBusy||copying);
        const nav=el('div',{class:'pb-rpl-menu-nav'});
        for(const [key,zh,es] of [['display','显示开关','Visibilidad'],['warehouses','仓库设置','Almacenes'],['backup','备份与恢复','Copia y restauración']])nav.append(button(t(zh,es),()=>navigateReminder(key),{disabled:busy,'aria-pressed':String(page===key)}));
        nav.append(el('details',{class:'pb-rpl-more'},el('summary',{},t('使用说明','Ayuda')),el('div',{class:'pb-rpl-help-text'},t('默认每项 1 箱，可加减或直接输入。N 黑色，B 白色，C 单色；其他颜色沿用编码后缀。按优先级分单时，归到首个有可用库存的货仓，整箱不足仍提示，不自动拆单。勾选和箱数自动保存在本机。','Una caja por producto; ajuste con +/− o escriba. N negro, B blanco, C un color; otros sufijos se conservan. Por prioridad se asigna al primer origen disponible, sin dividir pedidos. La selección y las cajas se guardan en este navegador.'))));
        const settingsMenu=actionMenu('settings',t('设置','Ajustes'),nav);settingsMenu.querySelector('summary').setAttribute('aria-disabled',String(busy));
        dialog.append(el('div',{class:'pb-rpl-head'},el('strong',{id:'pb-rpl-title'},t('补货提醒','Reposición')),el('div',{class:'pb-rpl-head-actions'},settingsMenu,button('×',()=>{if(!editor?.busy&&!service?.saving&&!backupBusy&&!followupBusy&&!copying)dialog.close();},{'aria-label':t('关闭','Cerrar'),disabled:busy}))),el('div',{class:'pb-rpl-tabs'},...[
            ['alerts','提醒清单','Alertas'],['settings','商品与门槛','Productos y umbrales']
        ].map(([key,zh,es])=>button(t(zh,es),()=>navigateReminder(key),{disabled:busy,'aria-pressed':String(page===key)}))));
        mountWindowSize(dialog,dialog.querySelector('.pb-rpl-head-actions').firstElementChild);
        body=el('div',{class:'pb-rpl-body'});statusNode=el('div',{class:'pb-rpl-status',role:'status','aria-live':'polite'});dialog.append(body,statusNode);
        if(!['alerts','settings'].includes(page))body.append(el('h3',{class:'pb-rpl-section-title'},t({display:'显示开关',warehouses:'仓库设置',backup:'备份与恢复'}[page],{display:'Visibilidad',warehouses:'Almacenes',backup:'Copia y restauración'}[page])));
    }
    function renderAlertChrome(){
        const controls=el('div',{class:'pb-rpl-alert-controls'});alertToolbar=el('div',{class:'pb-rpl-alert-toolbar'});alertSources=el('div',{class:'pb-rpl-sources-line'});controls.append(alertToolbar,alertSources);dialog.insertBefore(controls,body);
        actionBar=el('div',{class:'pb-rpl-footer'});dialog.append(actionBar);
        const draftWarning=el('div',{id:'pb-rpl-draft-status',role:'status','aria-live':'polite'});draftWarning.hidden=true;body.append(draftWarning);
        return controls;
    }

    const VERSION='0.1.28',PAGE=typeof unsafeWindow==='undefined'?window:unsafeWindow;
    if(PAGE.PBReplenishment)return;
    const prefKey='pb-replenishment:display:v1',languageKey='pb-suite:language:v1';
    const targetKey='pb-replenishment:target:v1';let targetPrefs={},scopeEpoch=0,warehouseEditor=null;
    try{targetPrefs=JSON.parse(localStorage.getItem(targetKey)||'{}')||{};}catch(_){}
    let disposed=false,service=null,booting=null,refreshing=null,snapshot=null,incoming=new Map(),error='',stale=true,dialog=null,body=null,statusNode=null,page='alerts',editor=null,companyId=0,uid=0,canShow=false,searchEpoch=0,prefError='',lang='zh-CN';
    let prefs={schema:1,companies:{},lastCompanyId:0};
    try{const raw=localStorage.getItem(prefKey);if(raw){const p=JSON.parse(raw);if(p.schema!==1||!p.companies)throw Error('format');prefs=p;}}catch(_){prefError='显示设置无法读取，请重新保存 / No se pudo leer la preferencia.';}
    const readLang=()=>{try{lang=JSON.parse(localStorage.getItem(languageKey)||'null')?.language||'zh-CN';}catch(_){lang='zh-CN';}};readLang();
    const t=(zh,es)=>lang==='es-MX'?es:zh;
    const surface=()=>/^\/pos\/ui(?:\/|$)/.test(location.pathname)?'pos':/^\/odoo(?:\/|$)/.test(location.pathname)||location.pathname==='/web'?'backend':null;
    const companyHint=()=>{const raw=document.cookie.match(/(?:^|;\s*)cids=([^;]*)/)?.[1];const n=Number(raw?.split(/[-,]/)[0]);return Number.isSafeInteger(n)&&n>0?n:companyId||prefs.lastCompanyId||0;};
    const displayPrefs=()=>({pos:true,backend:true,...prefs.companies[String(companyHint())]});
    const enabled=()=>Boolean(surface()&&displayPrefs()[surface()]);
    const scopeOK=()=>{if(disposed||companyHint()&&companyId&&companyHint()!==companyId)throw Error('公司已切换，请重新打开提醒 / Cambió la compañía; abra de nuevo.');};
    const number=n=>Number.isFinite(n)?Number(n.toFixed(4)).toLocaleString(lang==='es-MX'?'es-MX':'zh-CN'):'?';
    const time=n=>new Date(n).toLocaleString(lang==='es-MX'?'es-MX':'zh-CN');
    let loadingStock=false,pending=0,fetchingSnapshot=false,alertSelection=null,knownAlertIds=new Set(),wrongPos=0,copying=false,copyFallbackText='',notice=null,configEpoch=0,configInvalidatedAt=0,schemaMissing=false;const waiters=[],copyDrafts=new Map();
    const metrics={requests:0,stockGroups:0,configWrites:0,maxConcurrent:0};
    const AUTO_REFRESH_MS=60000,AUTO_RETRY_MS=15000;let incomingLoad=null;
    const hasFreshSnapshot=()=>Boolean(snapshot&&!stale&&!error&&snapshot.at>Date.now()-AUTO_REFRESH_MS);
    async function transport(model,method,args=[],kwargs={}){
        if(!['fields_get','search_read','read','read_group','search_count','check_access_rights'].includes(method)&&!([Core.MODEL,'x_pb_replenishment_warehouse'].includes(model)&&['create','write'].includes(method)))throw Error('禁止此业务操作 / Operación no permitida.');
        scopeOK();if(pending>=2)await new Promise(r=>waiters.push(r));pending++;
        const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),18000);
        try{
            scopeOK();metrics.requests++;metrics.maxConcurrent=Math.max(metrics.maxConcurrent,pending);if(model==='stock.quant'&&method==='read_group')metrics.stockGroups++;if(['write','create'].includes(method))metrics.configWrites++;
            const context={allowed_company_ids:[companyId],lang:lang==='es-MX'?'es_MX':'zh_CN',active_test:false,...kwargs.context};
            const response=await fetch(`/web/dataset/call_kw/${encodeURIComponent(model)}/${encodeURIComponent(method)}`,{method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:'call',params:{model,method,args,kwargs:{...kwargs,context}},id:Date.now()})});
            if(!response.ok)throw Object.assign(Error(`HTTP ${response.status}`),{httpStatus:response.status});const j=await response.json();
            if(j.error)throw Object.assign(Error(j.error.data?.message||j.error.message),{rpcName:j.error.data?.name});if(!Object.hasOwn(j,'result'))throw Error('响应未核实 / Respuesta no verificada.');scopeOK();return j.result;
        }catch(e){if(e.name==='AbortError')throw Error('请求超时，当前数据未核实 / Tiempo agotado; datos sin verificar.');throw e;}
        finally{clearTimeout(timeout);pending--;waiters.shift()?.();}
    }
    async function boot(){
        if(service)return service;if(booting)return booting;
        booting=(async()=>{
            const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),18000);let response,j;
            try{response=await fetch('/web/session/get_session_info',{method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:'call',params:{},id:Date.now()})});j=await response.json();}
            catch(e){if(e.name==='AbortError')throw Error('连接超时，将自动重试 / Tiempo agotado; se reintentará automáticamente.');throw e;}
            finally{clearTimeout(timeout);}
            const s=j.result;if(!response.ok||j.error||!s?.uid)throw Error('请先登录 Odoo / Inicie sesión.');
            const allowed=Object.keys(s.user_companies?.allowed_companies||{}).map(Number),hint=companyHint();
            companyId=allowed.includes(hint)?hint:Number(s.user_companies?.current_company);uid=s.uid;
            if(!allowed.includes(companyId))throw Error('无法核实当前公司 / Compañía sin verificar.');
            const expectedCompany=companyId,expectedEpoch=scopeEpoch,expectedSurface=surface(),expectedPosConfig=expectedSurface==='pos'?Core.id(PAGE.posmodel?.config):0;
            const assert=()=>{scopeOK();if(companyId!==expectedCompany||expectedEpoch!==scopeEpoch||surface()!==expectedSurface||expectedSurface==='pos'&&Core.id(PAGE.posmodel?.config)!==expectedPosConfig)throw Error('公司、门店或收银机已切换，请刷新页面 / Cambió la compañía, tienda o caja; recargue.');};
            const scopedRpc=async(m,method,args,kw={})=>{assert();const value=await transport(m,method,args,{...kw,context:{...kw.context,allowed_company_ids:[expectedCompany]}});assert();return value;};
            let targetId=PosWarehouse.validId(targetPrefs[String(companyId)]),posContext=null;
            if(surface()==='pos'){
                posContext=await PosWarehouse.resolve(scopedRpc,expectedPosConfig,companyId);
                const override=PosWarehouse.validId(targetPrefs[PosWarehouse.preferenceKey(uid,companyId,expectedPosConfig)]);
                let validOverride=false;
                if(override){const rows=await scopedRpc('stock.warehouse','search_read',[[['id','=',override],['company_id','=',companyId],['active','=',true]]],{fields:['id','company_id','lot_stock_id'],limit:1});validOverride=Array.isArray(rows)&&rows.length===1&&rows[0].id===override&&Core.id(rows[0].company_id)===companyId&&Boolean(PosWarehouse.validId(rows[0].lot_stock_id));}
                targetId=validOverride?override:posContext.warehouseId;posContext={...posContext,manual:validOverride,invalidOverride:Boolean(override&&!validOverride)};
            }
            const next=new Service({rpc:scopedRpc,companyId,uid,assertScope:assert,targetId});await next.init();
            assert();next.posContext=posContext;service=next;schemaMissing=false;prefs.lastCompanyId=companyId;return service;
        })().catch(error=>{if(error.code==='RPL_SCHEMA_MISSING')schemaMissing=true;throw error;}).finally(()=>{booting=null;});return booting;
    }
    const style=document.createElement('style');style.id='pb-rpl-style';style.textContent=`
    .pb-rpl-launch{position:fixed;right:18px;bottom:18px;z-index:1040;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:40px;min-width:82px;border:1px solid #5d3d55;border-radius:8px;background:#714b67;color:#fff;box-shadow:0 6px 18px #241a2233;padding:0 14px;font:700 13px/1 system-ui,-apple-system,"Segoe UI","Noto Sans SC",sans-serif;white-space:nowrap;cursor:pointer}
    .pb-rpl-launch[data-alert="true"]{background:#a34216;color:white;border-color:#a34216}.pb-rpl-launch[hidden]{display:none!important}
    dialog.pb-rpl-modal{width:min(1000px,95vw);max-width:95vw;max-height:90vh;padding:0;border:1px solid #d9dfe5;border-radius:14px;background:#fff;color:#243340;font:14px/1.5 system-ui;box-shadow:0 18px 70px #14253644}
    .pb-rpl-modal::backdrop{background:#17263177}.pb-rpl-modal *{box-sizing:border-box}.pb-rpl-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e2e6eb;gap:12px}.pb-rpl-head strong{font-size:19px}.pb-rpl-tabs,.pb-rpl-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.pb-rpl-tabs{padding:10px 20px;background:#f5f7f9}.pb-rpl-body{padding:16px 20px;overflow:auto;max-height:65vh}.pb-rpl-status{padding:9px 20px;color:#596a78;border-top:1px solid #e2e6eb;white-space:pre-wrap}.pb-rpl-error{color:#9f2e25!important;background:#fff5f3}
    .pb-rpl-modal button{border:1px solid #cbd4dc;background:#fff;color:#243340;border-radius:7px;padding:7px 12px;font:inherit;cursor:pointer}.pb-rpl-modal button.pb-rpl-primary{background:#295e60;border-color:#295e60;color:#fff}.pb-rpl-modal button:disabled{opacity:.5;cursor:default}.pb-rpl-modal input:not([type=checkbox]),.pb-rpl-modal select{border:1px solid #bec9d3;background:white;color:#243340;border-radius:6px;padding:7px 9px;font:inherit;max-width:100%}.pb-rpl-modal input[type=checkbox]{width:16px;height:16px;accent-color:#295e60;vertical-align:middle}.pb-rpl-modal label{display:inline-flex;gap:6px;align-items:center}.pb-rpl-modal table{border-collapse:collapse;width:100%;margin:12px 0;font:inherit}.pb-rpl-modal th{text-align:left;background:#f4f6f8;font-weight:600;position:sticky;top:0;z-index:1}.pb-rpl-modal td,.pb-rpl-modal th{padding:10px;border-bottom:1px solid #e3e7ec;vertical-align:top}.pb-rpl-modal .pb-rpl-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.pb-rpl-low{color:#b13723;font-size:18px;font-weight:700}.pb-rpl-muted{color:#647585;font-size:12px}.pb-rpl-source{display:inline-block;margin:2px 6px 2px 0;background:#edf5f1;border-radius:4px;padding:3px 7px;color:#245644}.pb-rpl-warn{color:#9a6615}.pb-rpl-empty{padding:34px 8px;text-align:center;color:#647585}.pb-rpl-form{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:12px 0}.pb-rpl-form input[type=number]{width:145px}.pb-rpl-modal textarea{width:100%;height:180px;font:13px/1.5 system-ui;border:1px solid #bcc8d3}.pb-rpl-help{padding:10px 12px;background:#f5f7f9;border-radius:6px;margin:10px 0}.pb-rpl-settings{display:flex;gap:20px;flex-wrap:wrap}.pb-rpl-modal:focus-visible,.pb-rpl-modal button:focus-visible,.pb-rpl-modal input:focus-visible,.pb-rpl-modal select:focus-visible{outline:2px solid #438d95;outline-offset:2px}
    dialog.pb-rpl-modal[open]{display:flex;flex-direction:column;overflow:hidden}.pb-rpl-head,.pb-rpl-tabs,.pb-rpl-status{flex-shrink:0}.pb-rpl-body{min-height:0;max-height:none;overflow:auto;flex:1}.pb-rpl-modal .pb-rpl-form select{width:auto;flex:1 1 165px;min-width:0}.pb-rpl-modal .pb-rpl-form input[type=search]{width:auto;flex:1 1 200px;min-width:0}
    .pb-rpl-modal .pb-rpl-tabs{background:#fff;border-bottom:1px solid #e5e9eb;padding:6px 20px;gap:16px}
    .pb-rpl-tabs button{border:0;border-radius:0;background:transparent;color:#697780;padding:9px 0;border-bottom:2px solid transparent}
    .pb-rpl-tabs button[aria-pressed="true"]{color:#235a57;border-bottom-color:#235a57;font-weight:650}
    .pb-rpl-status:empty{display:none}.pb-rpl-status{font-size:12px;padding:8px 20px;background:#fafbfc}
    .pb-rpl-editor{display:flex;flex-direction:column;gap:12px}.pb-rpl-filter-row,.pb-rpl-search-row,.pb-rpl-selection,.pb-rpl-pager{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
    .pb-rpl-search-row{flex-wrap:nowrap;gap:8px}.pb-rpl-search-row input{flex:1;min-width:0}.pb-rpl-search-row button{flex-shrink:0}
    .pb-rpl-segment{display:inline-flex;background:#f1f4f5;padding:3px;border-radius:8px;gap:2px}
    .pb-rpl-segment button{border:0;background:transparent;color:#64727c;padding:6px 12px}
    .pb-rpl-segment button[aria-pressed="true"]{background:white;color:#235a57;box-shadow:0 1px 3px #182e3c18;font-weight:650}
    .pb-rpl-modal summary{cursor:pointer;color:#607078;font-size:13px}.pb-rpl-more>.pb-rpl-form{margin:10px 0 2px}
    .pb-rpl-selection .pb-rpl-actions{gap:3px}.pb-rpl-selection button{border:0;color:#326d68;padding:4px 8px;background:transparent;font-size:13px}
    .pb-rpl-table-wrap{overflow:auto;max-height:38vh;min-height:90px;flex:1 1 auto;border:1px solid #e5e9eb;border-radius:8px}
    .pb-rpl-modal .pb-rpl-product-table{margin:0}.pb-rpl-product-table th{font-size:12px;background:#f8fafb;color:#667781;box-shadow:0 1px 0 #e5e9eb}.pb-rpl-product-table td{vertical-align:middle;padding:9px 12px}
    .pb-rpl-product-table td:first-child{width:36px}.pb-rpl-product-table td:last-child{width:64px;text-align:right}.pb-rpl-product-table td:nth-child(3){width:135px}.pb-rpl-product-table td:nth-child(4){width:125px}.pb-rpl-product-table tr:last-child td{border-bottom:0}
    .pb-rpl-spec-value{font-size:13px;font-weight:600;color:#405a66;white-space:nowrap}.pb-rpl-spec-unknown{font-size:12px;color:#647585;white-space:normal}
    .pb-rpl-product-table tbody tr:hover{background:#f8fbfa}.pb-rpl-product-table td:last-child button{border:0;background:transparent;color:#326d68;padding:3px 5px;font-size:13px}.pb-rpl-threshold{color:#235a57;font-size:15px}
    .pb-rpl-batch{border-top:1px solid #e5e9eb;padding-top:12px;display:flex;flex-direction:column;gap:8px}.pb-rpl-batch input[type=number]{width:110px}.pb-rpl-editor>.pb-rpl-empty{padding:28px 8px}
    .pb-rpl-editor-top{display:flex;align-items:center;flex-wrap:wrap;gap:10px 16px}.pb-rpl-editor-top>.pb-rpl-filter-row{gap:10px}.pb-rpl-editor-top>.pb-rpl-search-row{flex:1;min-width:260px}
    dialog.pb-rpl-modal[data-page="settings"]{height:min(820px,94vh);max-height:94vh}
    .pb-rpl-modal[data-page="settings"] .pb-rpl-head{padding:10px 20px}.pb-rpl-modal[data-page="settings"] .pb-rpl-head strong{font-size:18px}
    .pb-rpl-modal[data-page="settings"] .pb-rpl-tabs{padding-top:2px;padding-bottom:2px}
    .pb-rpl-editor{gap:8px;padding-top:12px;padding-bottom:12px}.pb-rpl-editor>*{flex-shrink:0}.pb-rpl-editor>.pb-rpl-table-wrap{flex:1 1 160px;max-height:none;min-height:100px}
    .pb-rpl-filter-row>label{white-space:nowrap;flex-shrink:0}.pb-rpl-filter-row>label select{width:125px}
    .pb-rpl-selection{gap:6px;font-size:12px}.pb-rpl-selection>.pb-rpl-muted{margin-right:auto}.pb-rpl-pager{gap:8px}.pb-rpl-pager button{padding:4px 7px;border:1px solid #dce3e6}
    .pb-rpl-batch{padding-top:8px;gap:6px}.pb-rpl-batch>.pb-rpl-filter-row{gap:8px}.pb-rpl-batch .pb-rpl-more{font-size:12px}
    .pb-rpl-model{background:#f7faf9}.pb-rpl-model .pb-rpl-group-toggle{border:0;padding:0;background:none;color:#243340;font-weight:650;text-align:left}
    .pb-rpl-variant td:nth-child(2){padding-left:30px}.pb-rpl-model-edit{display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:13px}.pb-rpl-model-edit select{margin-left:auto;width:auto;max-width:100%;min-width:0}
    .pb-rpl-product-table td:last-child{width:95px;white-space:nowrap}
    @media(max-width:640px){.pb-rpl-modal .pb-rpl-tabs{padding:6px 12px;gap:12px}.pb-rpl-tabs button{font-size:12px}.pb-rpl-segment button{padding:6px 8px;font-size:13px}.pb-rpl-filter-row{gap:8px}.pb-rpl-product-table td{padding:8px}.pb-rpl-table-wrap{max-height:32vh}}
    @media(max-width:640px){.pb-rpl-body{padding:12px}.pb-rpl-head{padding:12px}.pb-rpl-modal td,.pb-rpl-modal th{padding:7px}.pb-rpl-source{display:block}.pb-rpl-head strong{font-size:16px}.pb-rpl-launch{right:10px;bottom:12px}}
    .pb-rpl-modal .pb-rpl-supply-filters select{width:180px;flex:none}.pb-rpl-supply-filters{margin:12px 0}.pb-rpl-modal .pb-rpl-incoming-link{border:0;background:transparent;color:#326d68;padding:4px 0;font-size:12px;text-align:left}.pb-rpl-incoming-link:hover{text-decoration:underline}.pb-rpl-modal #pb-rpl-incoming-detail{overflow:auto;margin:14px 0}.pb-rpl-modal #pb-rpl-incoming-detail a{color:#236b68;text-decoration:underline}.pb-rpl-modal #pb-rpl-incoming-detail th{position:static}.pb-rpl-modal #pb-rpl-backup-filename{overflow-wrap:anywhere}
    .pb-rpl-alert-search{flex:1 1 220px;margin:0;min-width:180px}.pb-rpl-carton-hint{font-size:12px;margin-top:5px;max-width:270px;line-height:1.5}.pb-rpl-source[data-carton-state="shortage"]{background:#fff4df;color:#865714}.pb-rpl-source[data-carton-state="unknown-stock"]{background:#f2f4f5;color:#65727b}.pb-rpl-copy-cell{min-width:190px}.pb-rpl-copy-cell input{width:100%}
    .pb-rpl-carton-controls{display:flex;gap:5px;align-items:center}.pb-rpl-modal .pb-rpl-carton-controls input{width:76px;text-align:center;padding:5px}.pb-rpl-carton-controls button{padding:4px 9px}.pb-rpl-copy-preview{display:block;margin-top:4px;font-size:12px;color:#415961}.pb-rpl-draft-tools{margin:8px 0}.pb-rpl-draft-tools .pb-rpl-more{margin-top:4px}.pb-rpl-draft-tools .pb-rpl-form{gap:6px}.pb-rpl-draft-tools button{padding:5px 8px;font-size:12px}.pb-rpl-modal #pb-rpl-batch-count{width:85px}.pb-rpl-copy-cell{min-width:240px}
    .pb-rpl-modal .pb-rpl-type-toggle{font-size:12px;padding:5px 9px;white-space:nowrap}.pb-rpl-type-toggle[aria-pressed="true"]{background:#edf5f1;border-color:#b4cec7;color:#245644}
    .pb-rpl-modal .pb-rpl-category-row>td{padding:5px 9px;background:#f1f5f9;border-top:1px solid #cbd5e1;border-bottom:1px solid #dbe3ec;text-align:left;white-space:normal}
    .pb-rpl-warehouse-row>td{padding:7px 9px;background:#e7eef1;border-top:2px solid #a8bcc4}.pb-rpl-modal .pb-rpl-warehouse-row button{font-size:12px;padding:4px 8px}.pb-rpl-category-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;font-weight:750;color:#1e293b}.pb-rpl-category-count{font-size:11px;font-weight:600;color:#1d4ed8}
    .pb-rpl-modal[data-page="alerts"] .pb-rpl-body{padding:10px 16px}.pb-rpl-modal[data-page="alerts"] .pb-rpl-supply-filters{margin:8px 0;gap:8px}.pb-rpl-modal[data-page="alerts"] .pb-rpl-draft-tools{margin:5px 0}.pb-rpl-modal[data-page="alerts"] .pb-rpl-form{margin-top:6px;margin-bottom:6px}
    .pb-rpl-modal .pb-rpl-alert-table{margin:7px 0;font-size:13px}.pb-rpl-alert-table td,.pb-rpl-alert-table th{padding:6px 8px;vertical-align:middle}.pb-rpl-alert-table th{font-size:12px;white-space:nowrap}.pb-rpl-alert-table .pb-rpl-low{font-size:16px}.pb-rpl-alert-table td{min-width:0}.pb-rpl-alert-table [data-product-id] td:nth-child(2){min-width:170px}.pb-rpl-product-name{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:1.3}
    .pb-rpl-alert-table .pb-rpl-source{margin:1px 3px 1px 0;padding:2px 5px;font-size:11px;line-height:1.35}.pb-rpl-alert-table .pb-rpl-copy-cell{min-width:260px}.pb-rpl-alert-table .pb-rpl-quantity{display:flex;align-items:center;flex-wrap:wrap;gap:3px 9px}.pb-rpl-alert-table .pb-rpl-copy-preview{margin:0;font-size:11px;white-space:nowrap}.pb-rpl-alert-table .pb-rpl-carton-controls{gap:3px}.pb-rpl-modal .pb-rpl-alert-table .pb-rpl-carton-controls input{width:52px;padding:3px;height:26px}.pb-rpl-alert-table .pb-rpl-carton-controls button{padding:2px 6px;min-width:25px;height:26px}.pb-rpl-alert-table .pb-rpl-carton-hint{font-size:11px;line-height:1.35;margin-top:2px;max-width:300px}
    .pb-rpl-source-tabs{display:flex;align-items:center;gap:6px;overflow-x:auto;max-width:100%;padding:3px 0 7px;margin:2px 0 5px;border-bottom:1px solid #e5e9ed;scrollbar-width:thin;overscroll-behavior-x:contain}
    .pb-rpl-modal .pb-rpl-source-tab{display:inline-flex;align-items:center;gap:8px;flex:0 0 auto;border:1px solid transparent;background:transparent;color:#5d6a76;padding:6px 11px;border-radius:7px;font-size:13px;white-space:nowrap}
    .pb-rpl-modal .pb-rpl-source-tab[aria-pressed="true"]{background:#edf5f3;color:#245c54;border-color:#c5dcd6;font-weight:650}.pb-rpl-source-count{font-size:11px;line-height:18px;min-width:18px;text-align:center;padding:0 4px;border-radius:4px;background:#edf0f3;color:#5b6874}.pb-rpl-source-tab[aria-pressed="true"] .pb-rpl-source-count{background:#d6e9e3;color:#245c54}
    .pb-rpl-modal .pb-rpl-alert-variant>td{padding-top:5px;padding-bottom:5px;border-bottom-color:#edf0f3}.pb-rpl-alert-table .pb-rpl-carton-hint{margin-top:1px;line-height:1.25}
    `+LAYOUT_CSS+TABLET_ALERT_CSS+`
    #pb-rpl-dialog[open][data-page] {position:fixed;inset:auto;left:var(--pb-mid-x,50%);top:var(--pb-mid-y,50%);transform:translate(-50%,-50%);margin:0;box-sizing:border-box;min-height:0!important;min-width:0;max-height:var(--pb-room-h,calc(100dvh - 16px))!important;max-width:var(--pb-room-w,calc(100vw - 16px))!important}
    #pb-rpl-dialog[open] .pb-rpl-body,#pb-rpl-dialog[open] .pb-rpl-alert-controls{min-height:0;min-width:0;overscroll-behavior:contain}
    #pb-rpl-dialog[open][data-page] .pb-rpl-menu-panel{max-width:min(390px,calc(var(--pb-room-w,100vw) - 24px));max-height:min(380px,48dvh);overflow:auto}
    @media(any-pointer:coarse) and (orientation:landscape) and (min-width:800px){
      #pb-rpl-dialog[open][data-page="alerts"]:has(.pb-rpl-alert-controls){max-width:var(--pb-room-w,calc(100vw - 16px))!important;grid-template-columns:clamp(156px,16vw,195px) minmax(0,1fr)}
      #pb-rpl-dialog[open][data-page="alerts"] .pb-rpl-alert-controls .pb-rpl-menu-panel{position:static;min-width:0;width:100%;max-height:32dvh}
    }
    `+`
#pb-rpl-dialog .pb-window-size{position:relative;flex:0 0 auto;margin:0}
#pb-rpl-dialog .pb-window-size summary{cursor:pointer;list-style:none;font:inherit;border:1px solid #c4d0d6;border-radius:6px;padding:6px 10px;background:white;color:#29444a}
#pb-rpl-dialog .pb-window-size>div{position:absolute;z-index:40;right:0;top:calc(100% + 4px);width:min(238px,60vw);box-sizing:border-box;background:white;border:1px solid #cbd7db;border-radius:8px;padding:10px;box-shadow:0 6px 20px #162e3529}
#pb-rpl-dialog .pb-window-size label{display:grid!important;grid-template-columns:auto minmax(50px,1fr) 38px;gap:6px;align-items:center;font-size:13px;margin:6px 0}
#pb-rpl-dialog .pb-window-size input[type=range]{width:100%;min-width:0;height:32px;accent-color:#295e60;margin:0;padding:0}
#pb-rpl-dialog .pb-window-size output{text-align:right;font-variant-numeric:tabular-nums}
`; (document.head||document.documentElement).appendChild(style);
    function el(tag,attrs={},...children){const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(k.startsWith('on'))n.addEventListener(k.slice(2).toLowerCase(),v);else if(k==='class')n.className=v;else if(k==='text')n.textContent=v;else if(k==='checked'||k==='disabled'||k==='value')n[k]=v;else n.setAttribute(k,v);}for(const c of children.flat())if(c!==null&&c!==undefined)n.append(typeof c==='string'?document.createTextNode(c):c);return n;}
    const button=(label,fn,attrs={})=>el('button',{type:'button',onClick:fn,...attrs},label);
    let groupingCache=null,groupingCacheKey='';
    function groupingPrefs(){
        const key=Views.preferenceKey(uid,companyId,surface());
        if(!groupingCache||key!==groupingCacheKey){let raw;try{raw=localStorage.getItem(key);}catch(_){}groupingCache=Views.preferences(raw);groupingCacheKey=key;}
        return groupingCache;
    }
    function groupingButton(list,disabled=false){
        const enabled=groupingPrefs()[list];
        return button(enabled?t('分组：开','Agrupar: sí'):t('分组：关','Agrupar: no'),async()=>{
            const next={...groupingPrefs(),[list]:!groupingPrefs()[list]};let stored=true;
            try{localStorage.setItem(groupingCacheKey,JSON.stringify(next));}catch(_){stored=false;}
            groupingCache=next;if(list==='settings')await searchProducts(0);else render();
            if(!stored)setStatus(t('本次分组已切换，但浏览器未能记住设置。','Agrupación cambiada; no se pudo guardar la preferencia.'),true);
        },{id:'pb-rpl-group-'+list,class:'pb-rpl-type-toggle','aria-pressed':String(enabled),'aria-label':list==='alerts'?t('切换提醒清单品类分组','Agrupar alertas por tipo'):t('切换商品列表品类分组','Agrupar productos por tipo'),title:t('与 POS 相同，按商品名称首词分组；只改变显示。','Como el POS: por la primera palabra del nombre; solo cambia la presentación.'),disabled});
    }
    function categoryRow(type,count,columns,models=false){
        return el('tr',{class:'pb-rpl-category-row','data-category':type},el('td',{colspan:String(columns)},el('div',{class:'pb-rpl-category-heading'},el('span',{},type),el('span',{class:'pb-rpl-category-count'},models?t(`本页 ${count} 个型号`,`${count} modelos en esta página`):t(`${count} 种`,`${count} productos`)))));
    }
    const launcher=button(t('补货','Reposición'),()=>open('alerts'),{id:'pb-rpl-launch',class:'pb-rpl-launch'});launcher.hidden=true;(document.body||document.documentElement).appendChild(launcher);
    const positionKey='pb-replenishment:position:v1';let positions={};
    try{positions=JSON.parse(localStorage.getItem(positionKey)||'{}')||{};}catch(_){}
    let drag=null,suppressClick=false;
    launcher.style.touchAction='none';launcher.title=t('拖动调整位置','Arrastre para mover');
    function placeLauncher(x,y){const r=launcher.getBoundingClientRect();const left=Math.max(8,Math.min(x,Math.max(8,innerWidth-r.width-8))),top=Math.max(8,Math.min(y,Math.max(8,innerHeight-r.height-8)));Object.assign(launcher.style,{left:left+'px',top:top+'px',right:'auto',bottom:'auto'});return {left,top,width:r.width,height:r.height};}
    launcher.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();suppressClick=false;}},true);
    launcher.addEventListener('pointerdown',e=>{if(e.button!==0)return;const r=launcher.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top,moved:false};launcher.setPointerCapture(e.pointerId);});
    launcher.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5)drag.moved=true;if(drag.moved){e.preventDefault();placeLauncher(drag.left+e.clientX-drag.x,drag.top+e.clientY-drag.y);}});
    function endDrag(e){if(!drag||drag.id!==e.pointerId)return;if(drag.moved){suppressClick=e.type!=='pointercancel';const r=placeLauncher(launcher.offsetLeft,launcher.offsetTop);positions[surface()]={x:r.left/Math.max(1,innerWidth-r.width),y:r.top/Math.max(1,innerHeight-r.height)};try{localStorage.setItem(positionKey,JSON.stringify(positions));}catch(_){}}drag=null;}
    launcher.addEventListener('pointerup',endDrag);launcher.addEventListener('pointercancel',endDrag);
    function setStatus(message,bad=false){if(statusNode){statusNode.textContent=message;statusNode.classList.toggle('pb-rpl-error',bad);}}
    function setNotice(message,bad=false){notice={message,bad,at:Date.now()};setStatus(message,bad);}
    function updateBadge(){
        canShow=surface()==='pos'?Boolean(PAGE.posmodel?.config)&&PAGE.posmodel.config.id!==wrongPos&&!/\/(login|opening)(\/|$)/.test(location.pathname):surface()==='backend';
        const hidden=!enabled()||!canShow;if(launcher.hidden!==hidden)launcher.hidden=hidden;
        const count=snapshot?.rows.filter(r=>r.status==='available'&&Extras.followup(r.rule).state==='pending').length||0;
        const label=count?t(`补货 · ${count}`,`Reposición · ${count}`):t('补货','Reposición');if(launcher.textContent!==label)launcher.textContent=label;
        const alert=String(count>0);if(launcher.dataset.alert!==alert)launcher.dataset.alert=alert;
        if(!launcher.hidden){
            const saved=positions[surface()];if(drag)return;
            if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y)){const r=launcher.getBoundingClientRect();placeLauncher(saved.x*(innerWidth-r.width),saved.y*(innerHeight-r.height));return;}
            launcher.style.left='auto';launcher.style.top='auto';launcher.style.right='18px';
            let bottom=18;const own=launcher.getBoundingClientRect();
            for(let pass=0;pass<3;pass++)for(const id of ['pbful-launch','pb-suite-language-toggle']){const other=document.getElementById(id)?.getBoundingClientRect();if(other?.width&&own.right>other.left-8&&own.left<other.right+8&&innerHeight-bottom>other.top-8&&innerHeight-bottom-own.height<other.bottom+8)bottom=Math.max(bottom,innerHeight-other.top+12);}
            launcher.style.bottom=bottom+'px';
        }
    }
    let channel;try{channel=new BroadcastChannel('pb-replenishment:v1:'+location.origin);}catch(_){}
    const stamp=()=>`${uid}:${companyId}:${service?.warehouseId||0}:${service?.sourceStamp||''}`;
    channel?.addEventListener('message',event=>{
        const m=event.data;if(!service||m?.scope!==stamp()||disposed)return;if(m.type==='snapshot'&&m.schema!==3)return;
        if(m.type==='snapshot'&&!fetchingSnapshot&&!service.saving&&!error&&Core.newerSnapshot(m.data,snapshot,configInvalidatedAt,Date.now())){try{Core.ruleIndex(m.data.index.map(x=>x[1]),companyId,service.warehouseId);if(!Array.isArray(m.data.rows))return;snapshot=m.data;copyFallbackText='';resetIncoming();stale=false;updateBadge();if(dialog?.open&&page==='alerts')render();loadIncoming();}catch(_){}}
        if(m.type==='request'&&snapshot&&!stale&&snapshot.at>Date.now()-60000)channel.postMessage({type:'snapshot',schema:3,scope:stamp(),data:snapshot});
        if(m.type==='config-changed'){configEpoch++;configInvalidatedAt=Date.now();stale=true;lastAuto=0;updateBadge();if(enabled()&&!document.hidden)refresh(false).catch(()=>{});}
    });
    async function refresh(force=false){
        if(refreshing)return refreshing;
        loadingStock=true;updateBadge();if(dialog?.open&&page==='alerts')render();
        refreshing=(async()=>{
            try{
                await boot();if(loadLocalDraft())force=true;channel?.postMessage({type:'request',scope:stamp()});
                const run=async()=>{await new Promise(r=>setTimeout(r,35));if(!force&&snapshot&&!stale&&snapshot.at>Date.now()-60000)return;fetchingSnapshot=true;const epoch=configEpoch;try{const result=await service.snapshot();scopeOK();if(epoch!==configEpoch)throw Error('核对期间门槛刚被修改，请刷新 / Umbrales modificados durante la consulta; actualice.');snapshot=result;copyFallbackText='';resetIncoming();stale=false;error='';channel?.postMessage({type:'snapshot',schema:3,scope:stamp(),data:snapshot});}finally{fetchingSnapshot=false;}};
                if(navigator.locks?.request)await navigator.locks.request('pb-replenishment:refresh:'+location.origin+':'+stamp(),{mode:'exclusive'},run);else await run();
                updateBadge();if(dialog?.open&&page==='alerts')render();await loadIncoming();
            }catch(e){error=e.message;stale=true;updateBadge();if(dialog?.open&&page==='alerts')render();throw e;}
        })().finally(()=>{refreshing=null;loadingStock=false;updateBadge();if(dialog?.open&&page==='alerts')render();});return refreshing;
    }
    async function loadIncoming(){
        if(!snapshot||stale||incomingReady)return;const snap=snapshot;
        if(incomingLoad?.snapshot===snap)return incomingLoad.promise;
        const sequence=++incomingSequence;
        const task=(async()=>{
            try{const values=await service.incoming(snap.rows.filter(r=>r.status!=='invalid-product').map(r=>r.productId));if(snapshot===snap&&sequence===incomingSequence){incoming=values;incomingReady=true;incomingError='';if(dialog?.open&&page==='alerts')render();}}
            catch(e){if(snapshot===snap&&sequence===incomingSequence){incoming=new Map();incomingReady=false;incomingError=e.message;if(dialog?.open&&page==='alerts')render();}}
        })();
        incomingLoad={snapshot:snap,promise:task};
        try{await task;}finally{if(incomingLoad?.promise===task)incomingLoad=null;}
    }
    function guardKeys(event){
        if(!dialog?.open)return;
        if(event.key==='Escape'){
            event.preventDefault();
            if(!closeActionMenus(true)&&!copying&&!service?.saving&&!(typeof backupBusy!=='undefined'&&backupBusy)&&!(typeof followupBusy!=='undefined'&&followupBusy))dialog.close();
        }else if(['Enter','F3','F4'].includes(event.key)){
            event.preventDefault();
            if(event.key==='Enter'&&!event.isComposing&&!event.repeat){
                const control=event.target?.closest?.('button,summary');
                if(control&&dialog.contains(control)&&!control.disabled&&control.getAttribute('aria-disabled')!=='true')control.click();
                else if(event.target?.id==='pb-rpl-search'&&editor&&!editor.loading&&!editor.busy)searchProducts(0);
            }
        }
        event.stopImmediatePropagation();
    }
    window.addEventListener('keydown',guardKeys,true);
    async function open(next='alerts'){
        if(disposed||service?.saving||backupBusy||followupBusy||copying)return;
        schemaMissing=false;
        if(!dialog){
            dialog=el('dialog',{id:'pb-rpl-dialog',class:'pb-rpl-modal','aria-labelledby':'pb-rpl-title'});
            dialog.addEventListener('cancel',e=>{if(service?.saving||backupBusy||followupBusy||copying)e.preventDefault();});
            dialog.addEventListener('close',()=>{flushLocalDraft();closeActionMenus();editor=null;backupPreview=null;alertComposing=false;incomingDetail=null;page='alerts';if(!launcher.hidden)launcher.focus({preventScroll:true});});
            dialog.addEventListener('click',event=>{if(!event.target.closest('.pb-rpl-menu'))closeActionMenus();});
            (document.body||document.documentElement).appendChild(dialog);
        }
        page=next;if(!dialog.open)dialog.showModal();fitReminderWindow();render();
        try{await boot();service.assertScope();if(next==='settings')await settings();else if(next==='warehouses')await warehouseSettings();else if(next==='display'||next==='backup')render();else if(hasFreshSnapshot()&&!loadLocalDraft()){render();await loadIncoming();}else await refresh(false);}catch(e){error=e.message;stale=true;updateBadge();render();setStatus(error,true);}
    }
    function render(){
        if(!dialog?.open||page==='settings'&&editor||alertComposing)return;
        const priorViewport = page === 'alerts' && dialog.dataset.page === 'alerts' && body
            ? captureAlertViewport() : null;
        try {
            renderPage();
        } finally {
            if (priorViewport && dialog.open && page === 'alerts') restoreAlertViewport(priorViewport);
        }
    }

    function captureAlertViewport() {
        const top = body.getBoundingClientRect().top + body.clientTop;
        const anchor = body.scrollTop > 0 ? [...body.querySelectorAll('.pb-rpl-alert-variant')].find(
            row => row.getBoundingClientRect().bottom > top
        ) : undefined;
        return {
            scrollTop: body.scrollTop,
            scrollLeft: body.scrollLeft,
            controlsTop: dialog.querySelector('.pb-rpl-alert-controls')?.scrollTop || 0,
            tabsLeft: alertSources?.querySelector('.pb-rpl-source-tabs')?.scrollLeft || 0,
            productId: anchor?.dataset.productId,
            offset: anchor ? anchor.getBoundingClientRect().top - top : 0,
            view: JSON.stringify(draftView())
        };
    }

    function restoreAlertViewport(viewport) {
        const tabs = alertSources?.querySelector('.pb-rpl-source-tabs');
        if (tabs) tabs.scrollLeft = viewport.tabsLeft;
        const controls = dialog.querySelector('.pb-rpl-alert-controls');
        if (controls) controls.scrollTop = viewport.controlsTop;
        if (viewport.view !== JSON.stringify(draftView())) return;
        const anchor = viewport.productId && [...body.querySelectorAll('.pb-rpl-alert-variant')].find(
            row => row.dataset.productId === viewport.productId
        );
        const top = body.getBoundingClientRect().top + body.clientTop;
        body.scrollLeft = viewport.scrollLeft;
        body.scrollTop = anchor
            ? body.scrollTop + anchor.getBoundingClientRect().top - top - viewport.offset
            : viewport.scrollTop;
    }

    function renderPage(){
        const focused=document.activeElement,searchFocus=focused?.id==='pb-rpl-alert-search'||/^pb-rpl-cartons-\d+$/.test(focused?.id||'')?{id:focused.id,start:focused.selectionStart,end:focused.selectionEnd}:null;
        renderChrome();const warehouseLabel=service?.warehouses?.[0]?.label||'';
        if(page==='backup'){renderBackupBody();return;}
        if(page==='display'){renderDisplayBody();return;}
        if(page==='warehouses'){renderWarehouseBody();return;}
        if(page==='settings'){body.append(el('div',{class:'pb-rpl-empty'},t('正在读取商品与门槛…','Leyendo productos y umbrales…')));return;}
        if(!service||!snapshot){body.append(el('div',{class:'pb-rpl-empty'},error||t('正在读取共享配置和库存…','Leyendo configuración y existencias…')),button(error?t('重试','Reintentar'):t('立即加载','Cargar ahora'),()=>refresh(true).catch(()=>{}),{disabled:loadingStock}));setStatus(error||prefError,Boolean(error||prefError));return;}
        const actionable=filteredAlerts(),other=Extras.searchRows(snapshot.rows.filter(r=>r.status!=='available'),alertQuery);
        const controls=renderAlertChrome();
        alertToolbar.append(renderAlertSearch());renderFollowupFilters(alertToolbar);
        renderSupplyFilters(controls);
        syncDraftRows(actionable);
        const selected=alertSelection||new Set();
        alertToolbar.append(button(error?t('重试','Reintentar'):t('刷新','Actualizar'),()=>refresh(true).catch(()=>{}),{class:'pb-rpl-refresh','aria-label':t('刷新库存','Actualizar existencias'),disabled:followupBusy||copying||loadingStock}));
        renderDraftTools(actionable,actionBar);renderFollowupActions(selected,actionable,actionBar);
        actionBar.append(statusNode,button(t('复制到微信','Copiar a WeChat'),()=>{if(copying)return;const chosen=new Set(selected);copying=true;copySelected(chosen).catch(e=>setNotice(e.message,true)).finally(()=>{copying=false;render();});render();},{id:'pb-rpl-copy-selected',class:'pb-rpl-primary',disabled:true}));
        if(actionable.length){const table=el('table',{class:'pb-rpl-alert-table'}),head=el('tr');for(const title of ['',t('商品','Producto'),t(`${warehouseLabel} 可用`,`Disponible ${warehouseLabel}`),t('门槛','Umbral'),t('有货仓库','Almacenes disponibles'),t('箱数 / 微信内容','Cajas / Texto para WeChat')])head.append(el('th',{},title));table.append(el('thead',{},head));const tbody=el('tbody');
            const batches=splitSources()?sourcePriority().map(id=>({id,items:actionable.filter(row=>Views.assignedSource(row,sourcePriority())===id)})).filter(batch=>batch.items.length):[{id:0,items:actionable}];
            for(const batch of batches){if(batch.id){const warehouse=service.warehouses.find(w=>w.id===batch.id),ids=new Set(batch.items.filter(row=>selected.has(row.productId)).map(row=>row.productId));
                tbody.append(el('tr',{class:'pb-rpl-warehouse-row'},el('td',{colspan:'6'},el('div',{class:'pb-rpl-category-heading'},el('strong',{},`${warehouse?.label||batch.id} · ${batch.items.length} ${t('个颜色','colores')}`),button(t('复制本仓勾选','Copiar seleccionados de este origen'),()=>{if(copying)return;const values=new Map(copyDrafts),filter={...supplyOptions(alertFilter),sourceId:batch.id};const chosen=new Set(batch.items.filter(row=>alertSelection?.has(row.productId)).map(row=>row.productId));copying=true;copySelected(chosen,values,filter).catch(e=>setNotice(e.message,true)).finally(()=>{copying=false;render();});render();},{disabled:stale||Boolean(error)||loadingStock||copying||followupBusy||!ids.size,'data-copy-warehouse':String(batch.id)})))));
            }
            const sections=groupingPrefs().alerts?Views.groups(batch.items,row=>Views.typeOf(row.product)):[{type:null,items:batch.items}];
            for(const section of sections){if(section.type)tbody.append(categoryRow(section.type,section.items.length,6));
            for(const model of Views.models(section.items)){
            for(const row of model.items){const check=el('input',{type:'checkbox',disabled:copying||followupBusy,checked:selected.has(row.productId),'aria-label':`${t('选择','Seleccionar')} ${row.product.default_code||row.productId}`,onChange:e=>selectDraftRow(row,e.target.checked)});
                const source=el('td'),sourceNotes=new Map();for(const s of row.sources.filter(s=>s.available>0&&(!sourceForRow(row)||s.warehouseId===sourceForRow(row)))){const note=el('span');sourceNotes.set(s.warehouseId,note);source.append(el('span',{class:'pb-rpl-source'},`${s.label} · ${number(s.available)} ${t('件','pzas')}`,note));}
                const receiptButton=incomingButton(row);if(receiptButton)source.append(el('div',{},receiptButton));
                const hint=el('div'),quantity=renderQuantity(row,hint,sourceNotes);
                const tr=el('tr',{class:'pb-rpl-alert-variant','data-product-id':String(row.productId),'data-model':model.key},el('td',{},check));
                tr.append(el('td',{},el('strong',{title:row.product.display_name||row.product.name},row.product.default_code||'#'+row.productId),el('div',{class:'pb-rpl-muted pb-rpl-product-name',title:row.product.display_name||row.product.name},row.product.name),followupInfo(row.rule)),el('td',{class:'pb-rpl-num pb-rpl-low',title:t(`在手 ${row.current.onHand}，已预留 ${row.current.reserved}`,`Existencias ${row.current.onHand}; reservado ${row.current.reserved}`)},number(row.current.available)),el('td',{class:'pb-rpl-num'},number(row.rule.x_pb_min_pieces)),source,el('td',{class:'pb-rpl-copy-cell'},quantity,hint));tbody.append(tr);
            }}}}table.append(tbody);body.append(table);
        }else body.append(el('div',{class:'pb-rpl-empty'},stale||error?t('当前数据未核实，请刷新。','Datos sin verificar; actualice.'):receiptFilter!=='all'&&!incomingReady?t('待收货尚未核实，暂不判断是否有待收货。','Recepciones sin verificar; no se puede determinar este filtro.'):alertQuery.trim()?t('当前筛选下没有匹配商品，可清空搜索。','No hay coincidencias con estos filtros; limpie la búsqueda.'):Core.watched(new Map(snapshot.index)).length?t('此状态下暂无需要补货的商品。','No hay productos para reponer en este estado.'):t('尚未选择监控商品，请到“商品与门槛”批量设置。','Seleccione productos y umbrales para iniciar.')));
        renderIncomingDetail();
        if(other.length){const details=el('details',{},el('summary',{},t(`另有 ${other.length} 个低库存或配置待核对商品`,`Otros ${other.length} productos bajos o por revisar`)));for(const r of other)details.append(el('div',{class:'pb-rpl-help'},`${r.product?.default_code||'#'+r.productId} · ${r.status==='no-source'?t('货仓暂时无可用货源','Sin existencias disponibles en origen'):t('商品已停用或单位不适用，请核对门槛设置','Producto inactivo o unidad incompatible; revise la configuración')}`,incomingButton(r)));body.append(details);}
        setStatus(loadingStock?t('正在核对库存…','Consultando existencias…'):error||`${stale?t('旧数据，尚未核实 · ','Datos anteriores sin verificar · '):''}${t('最近核对：','Última consulta: ')}${time(snapshot.at)}${snapshot.warnings.length?' · '+snapshot.warnings.join(' / '):''}`,Boolean(!loadingStock&&(error||stale)));
        if(copyFallbackText)body.append(el('div',{class:'pb-rpl-copy-fallback'},el('label',{},t('也可以直接复制以下内容：','También puede copiar este texto:')),el('textarea',{readonly:'readonly',value:copyFallbackText})));
        if(notice&&!loadingStock&&Date.now()-notice.at<8000&&!error&&!stale)setStatus(notice.message,notice.bad);
        updateDraftActions();
        if(searchFocus){const input=document.getElementById(searchFocus.id);if(input&&!input.disabled){input.focus({preventScroll:true});if(input.type!=='number')input.setSelectionRange(searchFocus.start,searchFocus.end);}}
    }
    async function copySelected(ids,copyValues=new Map(copyDrafts),copyFilter=null){
        notice=null;copyFallbackText='';const filter=copyFilter||supplyOptions(alertFilter),scope=stamp();
        const routes=(filter.split || filter.sourceId)?new Map(snapshot.rows.filter(r=>ids.has(r.productId)).map(r=>[r.productId,Views.assignedSource(r,filter.priority)])):null;
        if(!ids.size)throw Error(t('请先勾选商品。','Seleccione productos.'));
        await refresh(true);
        if(scope!==stamp())throw Error(t('门店或货源设置已变化，请重新选择。','Cambió la tienda o sus orígenes; seleccione de nuevo.'));
        if(filter.receipt!=='all'&&!incomingReady)throw Error(t('待收货尚未核实，不能按此筛选复制。请刷新重试。','Recepciones sin verificar; no se puede copiar con este filtro.'));
        if(routes&&snapshot.rows.some(r=>ids.has(r.productId)&&routes.get(r.productId)!==Views.assignedSource(r,sourcePriority())))throw Error(t('货源归属已变化，请核对分仓清单后重新复制。','Cambió el origen asignado; revise la lista antes de copiar.'));
        const rows=supplyRows(snapshot.rows,{...filter,incoming,incomingReady}).filter(r=>ids.has(r.productId));
        if(!rows.length||stale||error)throw Error(t('所选商品已变化或库存未核实，请重新查看。','Productos cambiados o existencias sin verificar.'));
        const text=Core.copyText(rows,{drafts:copyValues});
        if(rows.length!==ids.size){copyFallbackText=text;setNotice(t(`有 ${ids.size-rows.length} 项已不符合筛选，本次未自动复制；下方保留 ${rows.length} 项，请核对。`,`${ids.size-rows.length} ya no cumplen el filtro. No se copió automáticamente; revise los ${rows.length} restantes abajo.`),true);return;}
        const cartonIssues=rows.filter(r=>Extras.cartonCheck(r,copyValues.has(r.productId)?copyValues.get(r.productId):Core.defaultCopyLine(r.product),filter.split?Views.assignedSource(r,filter.priority):filter.sourceId).status!=='enough').length;
        let clipboardTimer;
        try{if(!document.hasFocus())throw Error('not focused');await Promise.race([navigator.clipboard.writeText(text),new Promise((_,reject)=>{clipboardTimer=setTimeout(()=>reject(Object.assign(Error('clipboard timeout'),{code:'PB_CLIPBOARD_TIMEOUT'})),1500);})]);setNotice(cartonIssues?t(`已复制全部 ${rows.length} 项；其中 ${cartonIssues} 项货源不足或箱数未核实，请查看行内提示再联系仓管。`,`Copiados los ${rows.length}; ${cartonIssues} tienen existencias insuficientes o cajas sin verificar. Revise los avisos antes de contactar.`):t(`已复制 ${rows.length} 项。请自行粘贴到微信联系仓管。`,`Copiados ${rows.length}. Péguelo en WeChat para contactar al almacén.`),cartonIssues>0);}
        catch(e){copyFallbackText=text;const uncertain=e.code==='PB_CLIPBOARD_TIMEOUT';setNotice(uncertain?t('浏览器尚未确认复制结果，可先尝试粘贴，或复制下方文字。','El navegador no confirmó la copia. Pruebe pegar o copie el texto de abajo.'):t('请在下方文本框中手动复制。','Copie manualmente el texto de abajo.'),!uncertain);}
        finally{clearTimeout(clipboardTimer);}
    }
    function renderDisplay(){render();}
    function renderDisplayBody(){
        body.append(el('div',{class:'pb-rpl-help'},t('开关只影响这台电脑当前浏览器；共享门槛不会删除。关闭后不再自动查询该端库存。两端都关闭时，可从油猴菜单再次打开设置。','Preferencias locales de este navegador. No borran umbrales compartidos. Desactivar detiene consultas automáticas. Reabra desde el menú de Tampermonkey.')));
        const value=displayPrefs();for(const [key,zh,es] of [['pos','POS 显示提醒','Mostrar en POS'],['backend','库存后台显示提醒','Mostrar en Inventario']])body.append(el('div',{class:'pb-rpl-form'},el('label',{},el('input',{type:'checkbox',checked:value[key],disabled:!companyId,onChange:e=>saveDisplay(key,e.target.checked)}),t(zh,es))));
        body.append(button(t('重置补货按钮位置','Restablecer posición'),()=>{delete positions[surface()];try{localStorage.setItem(positionKey,JSON.stringify(positions));}catch(_){}updateBadge();setStatus(t('已恢复默认位置。','Posición restablecida.'));}));
        setStatus(prefError,Boolean(prefError));
    }
    function saveDisplay(key,value){
        const i=String(companyHint());const previous=prefs;
        const next={...prefs,lastCompanyId:companyHint(),companies:{...prefs.companies,[i]:{...displayPrefs(),[key]:value}}};
        try{const raw=JSON.stringify(next);localStorage.setItem(prefKey,raw);if(localStorage.getItem(prefKey)!==raw)throw Error('readback');prefs=next;prefError='';setStatus(t('已保存本机显示设置。','Preferencia local guardada.'));updateBadge();if(enabled())refresh(false).catch(()=>{});}
        catch(_){prefs=previous;prefError=t('显示设置未能保存，请重新打开核对。','No se guardó la preferencia; vuelva a abrir.');setStatus(prefError,true);}
    }
    async function warehouseSettings(){
        await boot();editor=null;page='warehouses';warehouseEditor=null;render();
        const before=service.sourceStamp;await service.loadWarehouseSettings();
        if(before!==service.sourceStamp){snapshot=null;stale=true;configEpoch++;configInvalidatedAt=Date.now();}
        warehouseEditor={selected:new Set(service.warehouses.slice(1).map(w=>w.id)),expected:service.sourceStamp,priority:[...sourcePriority()],busy:false};render();
    }
    async function switchWarehouse(id){
        if(service?.saving||warehouseEditor?.busy||refreshing||booting||pending||copying||followupBusy||backupBusy)throw Error(t('正在读取或保存，请稍后再切换。','Espere a que termine la consulta.'));
        service.assertScope();
        const isPos=surface()==='pos',automatic=isPos&&id===0;
        if(!automatic&&!service.availableWarehouses.some(w=>w.id===id&&Core.id(w.company_id)===companyId&&PosWarehouse.validId(w.lot_stock_id)))throw Error(t('门店不属于当前公司或没有有效库位。','Tienda o ubicación no válida para esta compañía.'));
        const key=isPos?PosWarehouse.preferenceKey(uid,companyId,service.posContext.configId):String(companyId);
        let latest;try{latest=JSON.parse(localStorage.getItem(targetKey)||'{}');}catch(_){latest=targetPrefs;}
        const next={...(latest&&typeof latest==='object'&&!Array.isArray(latest)?latest:targetPrefs)};
        if(automatic)delete next[key];else next[key]=id;
        const raw=JSON.stringify(next);localStorage.setItem(targetKey,raw);if(localStorage.getItem(targetKey)!==raw)throw Error(t('本机门店选择未能保存。','No se pudo guardar la tienda.'));targetPrefs=next;
        releaseLocalDraft();scopeEpoch++;service=null;snapshot=null;editor=null;backupPreview=null;alertFilter='pending';sourceFilter=0;receiptFilter='all';alertQuery='';alertComposing=false;resetIncoming();warehouseEditor=null;stale=true;error='';alertSelection=null;knownAlertIds.clear();copyDrafts.clear();copyFallbackText='';configEpoch++;configInvalidatedAt=Date.now();lastAuto=0;
        await boot();await warehouseSettings();updateBadge();
    }
    function renderWarehouseBody(){
        if(!service||!warehouseEditor){body.append(el('div',{class:'pb-rpl-empty'},t('正在读取仓库设置…','Leyendo almacenes…')));return;}
        const e=warehouseEditor;
        body.append(el('div',{class:'pb-rpl-help'},t('选门店，再勾选有货时可向它补货的仓库。货源和门槛按门店共享；切换门店不会复制或删除原门槛。','Elija tienda y orígenes. Los orígenes y umbrales se comparten por tienda; cambiar de tienda conserva sus reglas.')));
        const target=el('select',{'aria-label':t('提醒门店','Tienda destino'),disabled:e.busy||service.saving,onChange:event=>switchWarehouse(Number(event.target.value)).catch(x=>{render();setStatus(x.message,true);})},...service.availableWarehouses.filter(w=>Core.id(w.company_id)===companyId&&Core.id(w.lot_stock_id)).map(w=>el('option',{value:String(w.id)},`${w.code} · ${w.name}`)));target.value=String(service.warehouseId);
        body.append(el('div',{class:'pb-rpl-form'},el('label',{},t('提醒门店','Tienda destino')),target));
        if(surface()==='pos'){
            const context=service.posContext,automatic=service.availableWarehouses.find(w=>w.id===context?.warehouseId),label=automatic?`${automatic.code} · ${automatic.name}`:String(context?.warehouseId||'?');
            body.append(el('div',{class:'pb-rpl-help'},
                el('div',{},`${t('当前 POS','POS actual')}: ${context?.configName||'?'} · ${t('自动识别仓库','Almacén detectado')}: ${label}`),
                el('div',{class:'pb-rpl-muted'},t(context?.manual?'当前为手动选择，仅在本机当前账号和此 POS 记忆；不改变 POS 销售扣库存仓库。':'当前跟随 POS 出库类型。可在上方手动选择补货提醒的门店，不改变 POS 销售扣库存仓库。',context?.manual?'Selección manual guardada para esta cuenta y este POS en este navegador; no cambia el almacén de las ventas.':'Según el tipo de operación POS. Puede elegir otra tienda para las alertas; no cambia el almacén de las ventas.')),
                context?.invalidOverride?el('div',{class:'pb-rpl-warn'},t('原手动仓库已不可用，本次已恢复自动识别。','El almacén manual ya no está disponible; se restauró la detección automática.')):null,
                context?.manual||context?.invalidOverride?button(t('恢复 POS 自动识别','Usar almacén automático'),()=>switchWarehouse(0).catch(x=>{render();setStatus(x.message,true);}),{disabled:e.busy||service.saving}):null));
        }
        const choices=el('div',{class:'pb-rpl-form'});for(const w of service.availableWarehouses.filter(w=>w.id!==service.warehouseId&&Core.id(w.lot_stock_id)))choices.append(el('label',{},el('input',{type:'checkbox',checked:e.selected.has(w.id),disabled:e.busy||!service.canEditWarehouses,'aria-label':t('货源 ','Origen ')+w.code,onChange:event=>{event.target.checked?e.selected.add(w.id):e.selected.delete(w.id);const save=body.querySelector('#pb-rpl-save-warehouses');if(save)save.disabled=!e.selected.size||!service.canEditWarehouses||e.busy;}}),`${w.code} · ${w.name}`));
        body.append(choices,button(t('保存货源仓库','Guardar orígenes'),async()=>{
            if(e.busy)return;e.busy=true;render();const oldScope=stamp();
            try{const result=await service.saveWarehouseSources([...e.selected],e.expected);e.expected=service.sourceStamp;e.priority=[...sourcePriority()];if(result.changed){snapshot=null;stale=true;configEpoch++;configInvalidatedAt=Date.now();lastAuto=0;channel?.postMessage({type:'config-changed',scope:oldScope});updateBadge();}setStatus(t(result.changed?'货源已保存，所有电脑共用。':'货源与当前设置一致，无需修改。',result.changed?'Orígenes guardados y compartidos.':'Los orígenes no han cambiado.'));}
            catch(x){setStatus(x.message,true);}finally{e.busy=false;renderWarehouseRefresh();}
        },{id:'pb-rpl-save-warehouses',class:'pb-rpl-primary',disabled:e.busy||!service.canEditWarehouses||!e.selected.size}));
        const priorityBox=el('section',{class:'pb-rpl-help','aria-label':t('货源仓库优先级','Prioridad de orígenes')},el('strong',{},t('货源优先级','Prioridad de orígenes')),el('div',{class:'pb-rpl-muted'},t('从上到下优先取货。先保存货源，再调整顺序；所有电脑共用。','De arriba abajo. Guarde los orígenes antes de ordenar; se comparte entre equipos.')));
        e.priority.forEach((id,index)=>{const w=service.warehouses.find(w=>w.id===id),move=delta=>{[e.priority[index],e.priority[index+delta]]=[e.priority[index+delta],e.priority[index]];render();};
            priorityBox.append(el('div',{class:'pb-rpl-filter-row'},el('span',{},`${index+1}. ${w?.label||id}`),button('↑',()=>move(-1),{disabled:e.busy||!service.canEditWarehouses||!service.priorityAvailable||index===0,'aria-label':t('提高优先级 ','Subir prioridad ')+(w?.label||id)}),button('↓',()=>move(1),{disabled:e.busy||!service.canEditWarehouses||!service.priorityAvailable||index===e.priority.length-1,'aria-label':t('降低优先级 ','Bajar prioridad ')+(w?.label||id)})));
        });
        priorityBox.append(button(t('保存优先级','Guardar prioridad'),async()=>{if(e.busy)return;e.busy=true;render();
            try{await service.saveSourcePriority(e.priority,e.expected);e.expected=service.sourceStamp;e.priority=[...sourcePriority()];snapshot=null;stale=true;configEpoch++;configInvalidatedAt=Date.now();lastAuto=0;channel?.postMessage({type:'config-changed',scope:stamp()});setStatus(t('优先级已保存，所有电脑共用。','Prioridad guardada y compartida.'));}
            catch(x){setStatus(x.message,true);}finally{e.busy=false;renderWarehouseRefresh();}
        },{disabled:e.busy||!service.canEditWarehouses||!service.priorityAvailable||!e.priority.length}));
        if(!service.priorityAvailable)priorityBox.append(el('div',{class:'pb-rpl-warn'},t('本库尚未启用共享优先级，暂按当前货源顺序分单。','Prioridad compartida aún no disponible; se usa el orden actual.')));
        body.append(priorityBox);
        if(service.warehouseSettingsMissing||!service.canEditWarehouses)body.append(el('div',{class:'pb-rpl-warn'},t(service.warehouseSettingsMissing?'此数据库尚未准备共享仓库设置。':'当前账号没有修改仓库设置的权限。','Configuración no disponible o acceso de solo lectura.')));
    }
    function renderWarehouseRefresh(){const text=statusNode?.textContent,bad=statusNode?.classList.contains('pb-rpl-error');render();setStatus(text,bad);}
    async function settings(){
        await boot();service.invalidateStoreStock();const previous=editor;editor=null;page='settings';const ticket=++searchEpoch;render();
        const [rules,choices]=await Promise.all([service.rules(),service.filterChoices()]);
        if(ticket!==searchEpoch||!dialog?.open||page!=='settings')return;
        editor={rules,...choices,selected:new Map(),expanded:new Set(),catalog:null,templateId:0,templateLabel:'',query:previous?.query||'',category:previous?.category||0,supplier:previous?.supplier||0,posCategory:previous?.posCategory||0,monitoring:previous?.monitoring||'all',storeStock:previous?.storeStock||'all',threshold:previous?.threshold??'',moreOpen:previous?.moreOpen||false,advancedOpen:false,page:0,value:'',overwrite:false,disable:false,individual:false,preview:false,busy:false,loading:false,dirty:false,results:null};
        renderEditor();await searchProducts(0);
    }
    function saveReady(e){if(!e||e.busy||e.loading||e.dirty||!service.canEdit||!e.selected.size)return false;try{if(!e.disable)Core.minimum(e.value);return true;}catch(_){return false;}}
    function resetSelectionMode(e,clearValue=false){
        e.individual=false;e.templateId=0;e.templateLabel='';e.overwrite=false;e.disable=false;
        if(clearValue)e.value='';
    }
    function startBatchSelection(e){
        if(e.templateId||e.individual)e.selected.clear();
        resetSelectionMode(e);
    }
    function renderSelection(){renderEditor();if(editor)setStatus(t(`已选 ${editor.selected.size} 个变体`,`${editor.selected.size} variantes seleccionadas`));}
    function invalidatePreview(){if(!editor)return;editor.preview=false;const save=body.querySelector('#pb-rpl-save');if(save){save.disabled=!saveReady(editor);save.textContent=editor.disable?t('关闭所选提醒','Desactivar seleccionados'):t('保存所选','Guardar seleccionados');}const label=body.querySelector('#pb-rpl-selected');if(label)label.textContent=t(`已选 ${editor.selected.size} 个变体`,`Seleccionados: ${editor.selected.size}`);}
    const editorFilters=e=>({supplier:e.supplier,posCategory:e.posCategory,monitoring:e.monitoring,storeStock:e.storeStock,threshold:e.threshold,ruleIndex:e.rules,groupTypes:groupingPrefs().settings});
    function changeProductFilter(e,key,value){
        if(e!==editor||e.busy||e.loading)return;
        e[key]=value;e.selected.clear();resetSelectionMode(e,true);e.dirty=true;e.results=null;e.catalog=null;
        if(key==='monitoring'&&['disabled','missing'].includes(value))e.threshold='';
        if(key==='threshold'&&value!=='')e.monitoring='enabled';
        searchProducts(0);
    }
    async function searchProducts(pageNumber){
        const e=editor;if(!e||e.busy)return;const ticket=++searchEpoch;e.page=pageNumber;e.loading=true;e.results=null;renderEditor();
        setStatus(t('正在查询…','Consultando…'));
        try{
            const rules=e.rules;
            const result=await service.searchGroups(e.query,e.category,pageNumber,{...editorFilters(e),ruleIndex:rules},e.catalog);
            if(editor!==e||ticket!==searchEpoch)return;
            // Read units once per result page; expanding rows and editing thresholds do not fetch again.
            try{result.units=await service.specificationUnits(result.groups.flatMap(group=>group.variants));}
            catch(_){result.units=new Map();}
            scopeOK();
            if(editor!==e||ticket!==searchEpoch)return;e.rules=rules;e.results=result;e.catalog=result.catalog;e.dirty=false;
            setStatus(t(`共 ${result.count} 个型号 · ${result.variantCount} 个变体匹配筛选`,`${result.count} modelos · ${result.variantCount} variantes coincidentes`));
        }catch(error){if(editor===e&&ticket===searchEpoch){e.dirty=true;setStatus(error.message,true);}}
        finally{if(editor===e&&ticket===searchEpoch){e.loading=false;renderEditor();}}
    }
    function editorSpecification(products,units=new Map()){
        const sizes=products.map(p=>{
            if(!Core.pieceProduct(p))return 'unsupported';
            const ids=[Core.id(p.uom_id),...(p.uom_ids||[]).map(Core.id)];
            // A partial unit response must never make one of several box sizes look unambiguous.
            if(ids.some(id=>!Number.isSafeInteger(id)||id<=0||!units.has(id)||!Number.isFinite(units.get(id).factor)||units.get(id).factor<=0))return null;
            return Core.cartonSize(p,units);
        });
        const known=sizes.filter(Number.isSafeInteger),distinct=new Set(known);
        if(known.length===products.length&&distinct.size===1)return el('span',{class:'pb-rpl-spec-value'},t(`${number(known[0])} 件/箱`,`${number(known[0])} pzas/caja`));
        const text=known.length===products.length&&distinct.size>1?t('各颜色不同','Varía por color'):sizes.length&&sizes.every(v=>v==='unsupported')?t('不适用','No aplicable'):known.length?t('部分未核实','Parcial sin verificar'):t('未核实','Sin verificar');
        return el('span',{class:'pb-rpl-spec-unknown',title:t('按商品计量单位读取箱规；多种箱规或资料不完整时不猜测。型号可展开查看各颜色。','Se consulta la unidad del producto; no se adivina si hay varias cajas o datos incompletos. Expanda el modelo para ver cada color.')},text);
    }
    function renderEditor(){
        if(!editor||!dialog?.open||page!=='settings')return;const e=editor,blocked=e.busy||e.loading,selectable=service.canEdit&&!blocked&&!e.dirty&&Boolean(e.results);
        const previousTable=body.querySelector('.pb-rpl-table-wrap'),scrollTop=previousTable?.scrollTop||0,scrollLeft=previousTable?.scrollLeft||0;body.replaceChildren();body.classList.add('pb-rpl-editor');
        const statuses=[['all','全部','Todos'],['enabled','已设置提醒','Con aviso'],['disabled','未设置提醒','Sin aviso'],['missing','待设颜色','Colores sin configurar']];
        const segment=el('div',{class:'pb-rpl-segment',role:'group','aria-label':t('提醒状态','Estado del aviso')},...statuses.map(([value,zh,es])=>button(t(zh,es),()=>changeProductFilter(e,'monitoring',value),{'aria-pressed':String(e.monitoring===value),disabled:blocked})));
        const thresholds=[...new Set([...e.rules.values()].filter(r=>r.x_pb_enabled&&r.x_pb_threshold_set).map(r=>r.x_pb_min_pieces))];
        if(e.threshold!==''&&!thresholds.includes(Number(e.threshold)))thresholds.push(Number(e.threshold));thresholds.sort((a,b)=>a-b);
        const threshold=el('select',{'aria-label':t('按门槛件数筛选','Filtrar por umbral'),disabled:blocked||['disabled','missing'].includes(e.monitoring),onChange:event=>changeProductFilter(e,'threshold',event.target.value)},el('option',{value:''},t('不限门槛','Cualquier umbral')),...thresholds.map(n=>el('option',{value:String(n)},t(`${number(n)} 件`,`${number(n)} pzas`))));threshold.value=e.threshold;
        const storeStock=el('select',{id:'pb-rpl-store-stock','aria-label':t('提醒门店库存','Existencias del destino'),title:t('按所选门店可用库存判断：已扣除预留，0 或负数为没货。','Disponible del destino, descontando reservas; cero o negativo = sin existencias.'),disabled:blocked,onChange:event=>changeProductFilter(e,'storeStock',event.target.value)},...[["all","全部","Todos"],["in","有货","Con existencias"],["out","没货","Sin existencias"]].map(([value,zh,es])=>el('option',{value},t(zh,es))));storeStock.value=e.storeStock;
        const top=el('div',{class:'pb-rpl-editor-top'},el('div',{class:'pb-rpl-filter-row'},segment,el('label',{},t('门槛','Umbral'),threshold),el('label',{},t('门店库存','Existencias'),storeStock)));body.append(top);
        const search=el('input',{id:'pb-rpl-search',type:'search',disabled:blocked,value:e.query,placeholder:t('搜索编码、名称或条码','Código, nombre o código de barras'),'aria-label':t('搜索商品','Buscar producto'),onInput:event=>{
            e.query=event.target.value;e.dirty=true;e.catalog=null;e.selected.clear();resetSelectionMode(e,true);invalidatePreview();
            for(const control of body.querySelectorAll('[data-selection]'))control.disabled=true;
            body.querySelectorAll('input[data-selection]').forEach(c=>{c.checked=false;c.indeterminate=false;});
            setStatus(t('点击搜索或按回车应用筛选。','Pulse Buscar o Enter para aplicar.'));
        }});
        const moreCount=[e.category,e.supplier,e.posCategory].filter(Boolean).length;
        const more=el('details',{class:'pb-rpl-more'},el('summary',{},t(`分类与供应商${moreCount?' · '+moreCount:''}`,`Categorías y proveedor${moreCount?' · '+moreCount:''}`)));more.open=e.moreOpen;more.addEventListener('toggle',()=>{e.moreOpen=more.open;});
        const category=el('select',{disabled:blocked,'aria-label':t('商品分类','Categoría'),onChange:event=>changeProductFilter(e,'category',Number(event.target.value))},el('option',{value:'0'},t('全部分类','Todas las categorías')),...e.categories.map(c=>el('option',{value:String(c.id)},c.display_name)));category.value=String(e.category);
        const filterSelect=(key,items,label,all)=>{const select=el('select',{disabled:blocked||(key==='supplier'?e.supplierUnavailable:e.posUnavailable),'aria-label':label,onChange:event=>changeProductFilter(e,key,Number(event.target.value))},el('option',{value:'0'},all),...items.map(c=>el('option',{value:String(c.id)},c.display_name)));select.value=String(e[key]);return select;};
        more.append(el('div',{class:'pb-rpl-form'},category,filterSelect('supplier',e.suppliers,t('供应商','Proveedor'),t('全部供应商','Todos los proveedores')),filterSelect('posCategory',e.posCategories,t('POS 品类','Categoría POS'),t('全部 POS 品类','Todas las categorías POS'))));
        if(e.supplierUnavailable||e.posUnavailable)more.append(el('div',{class:'pb-rpl-warn'},t('部分筛选暂不可用，已停用。','Algunos filtros no están disponibles.')));
        if(e.monitoring==='missing')body.append(el('div',{class:'pb-rpl-muted'},t('已有提醒的型号中，从未设置门槛的颜色；已主动关闭的不计入。','Variantes nunca configuradas de modelos con avisos; excluye las desactivadas.')));
        top.append(el('div',{class:'pb-rpl-search-row'},search,button(t('搜索','Buscar'),()=>searchProducts(0),{disabled:blocked}),button(t('刷新','Actualizar'),()=>settings().catch(x=>setStatus(x.message,true)),{disabled:blocked,title:t('重新读取共享门槛与门店库存','Recargar umbrales y existencias del destino')})));body.append(more);
        const selection=el('div',{class:'pb-rpl-selection'},el('div',{class:'pb-rpl-actions'},
            button(t('选本页','Esta página'),()=>{startBatchSelection(e);for(const p of e.results?.rows||[])if(Core.pieceProduct(p))e.selected.set(p.id,p);renderSelection();},{disabled:!selectable,'data-selection':''}),
            button(t('选全部结果','Todos los resultados'),async()=>{
                if(!selectable)return;e.busy=true;renderEditor();
                try{const rows=await service.allMatches(e.query,e.category,editorFilters(e));if(editor!==e)return;startBatchSelection(e);for(const p of rows)if(Core.pieceProduct(p))e.selected.set(p.id,p);setStatus(t(`已选 ${e.selected.size} 个变体`,`Seleccionados: ${e.selected.size}`));}
                catch(x){setStatus(x.message,true);}finally{e.busy=false;if(editor===e)renderEditor();}
            },{disabled:!selectable,'data-selection':''}),
            button(t('清空','Limpiar'),()=>{resetSelectionMode(e,true);e.selected.clear();renderSelection();},{disabled:blocked||!e.selected.size,'data-selection':''})),el('span',{id:'pb-rpl-selected',class:'pb-rpl-muted'},t(`已选 ${e.selected.size} 个变体`,`Seleccionados: ${e.selected.size}`)));
        selection.append(groupingButton('settings',blocked||e.dirty));body.append(selection);
        if(e.results?.rows.length){
            const table=el('table',{class:'pb-rpl-product-table'}),head=el('tr');
            for(const [title,cls] of [['',''],[t('商品','Producto'),''],[t('规格','Presentación'),'pb-rpl-num'],[t('提醒门槛','Umbral'),'pb-rpl-num'],['','']])head.append(el('th',{class:cls},title));
            const rows=el('tbody');
            const addVariant=(p,child=false,matched=true)=>{
                const r=e.rules.get(p.id),valid=Core.pieceProduct(p),active=r?.x_pb_enabled&&r.x_pb_threshold_set;
                rows.append(el('tr',{class:child?'pb-rpl-variant':''},el('td',{},el('input',{type:'checkbox',checked:e.selected.has(p.id),disabled:!selectable||!valid||!matched,'data-selection':'','aria-label':`${t('勾选','Seleccionar')} ${p.default_code||p.id}`,onChange:event=>{resetSelectionMode(e);if(event.target.checked)e.selected.set(p.id,p);else e.selected.delete(p.id);renderSelection();}})),
                    el('td',{},el('strong',{},p.default_code||'#'+p.id),el('div',{class:'pb-rpl-muted'},child?(String(p.display_name||p.name).replace(/^\[[^\]]+\]\s*/,'').replace(p.name,'').trim()||p.name):p.name),!matched?el('div',{class:'pb-rpl-muted'},t('不符合当前筛选','Fuera del filtro actual')):null,!valid?el('div',{class:'pb-rpl-warn'},t('不支持此单位','Unidad no compatible')):null),
                    el('td',{class:'pb-rpl-num'},editorSpecification([p],e.results.units)),
                    el('td',{class:'pb-rpl-num'},active?el('strong',{class:'pb-rpl-threshold'},t(`${number(r.x_pb_min_pieces)} 件`,`${number(r.x_pb_min_pieces)} pzas`)):el('span',{class:'pb-rpl-muted'},t('未设置','Sin aviso')),active&&r.x_pb_is_override?el('div',{class:'pb-rpl-muted'},t('单独设置','Individual')):null),
                    el('td',{},button(t('修改','Editar'),()=>{e.selected=new Map([[p.id,p]]);e.templateId=0;e.individual=true;e.overwrite=false;e.disable=false;e.value=r?.x_pb_threshold_set?String(r.x_pb_min_pieces):'';renderEditor();body.querySelector('#pb-rpl-minimum')?.focus();setStatus(t(`单独设置 ${p.default_code||p.id}。`,`Editando ${p.default_code||p.id}.`));},{disabled:!selectable||!valid,'data-selection':''}))));
            };
            const typeCounts=new Map();for(const group of e.results.groups)typeCounts.set(group.typeLabel,(typeCounts.get(group.typeLabel)||0)+1);let lastType=null;
            for(const group of e.results.groups){
                if(groupingPrefs().settings&&group.typeLabel!==lastType){lastType=group.typeLabel;rows.append(categoryRow(group.typeLabel||'OTROS',typeCounts.get(group.typeLabel),5,true));}
                if(group.variants.length===1){addVariant(group.variants[0]);continue;}
                const summary=Core.groupThreshold(group.variants,e.rules),matched=new Set(group.matchedIds),eligible=group.variants.filter(p=>matched.has(p.id)&&Core.pieceProduct(p));
                const checked=eligible.filter(p=>e.selected.has(p.id)).length;
                const check=el('input',{type:'checkbox',checked:eligible.length>0&&checked===eligible.length,disabled:!selectable||!eligible.length,'data-selection':'','aria-label':t('勾选型号匹配变体 ','Seleccionar coincidencias del modelo ')+group.label,onChange:event=>{resetSelectionMode(e);for(const p of eligible)event.target.checked?e.selected.set(p.id,p):e.selected.delete(p.id);renderSelection();}});check.indeterminate=checked>0&&checked<eligible.length;
                const expanded=e.expanded.has(group.id);
                const toggle=button(`${expanded?'▾':'▸'} ${group.label}`,()=>{expanded?e.expanded.delete(group.id):e.expanded.add(group.id);renderEditor();},{class:'pb-rpl-group-toggle','aria-expanded':String(expanded),'aria-label':t('展开或折叠型号 ','Expandir o contraer modelo ')+group.label});
                const info=t(`${group.variants.length} 个变体${group.matchedIds.length!==group.variants.length?' · '+group.matchedIds.length+' 个匹配筛选':''}`,`${group.variants.length} variantes${group.matchedIds.length!==group.variants.length?' · '+group.matchedIds.length+' coinciden':''}`);
                rows.append(el('tr',{class:'pb-rpl-model'},el('td',{},check),el('td',{},toggle,el('div',{class:'pb-rpl-muted'},info)),
                    el('td',{class:'pb-rpl-num'},editorSpecification(group.variants,e.results.units)),
                    el('td',{class:'pb-rpl-num'},el('strong',{class:summary.kind==='uniform'?'pb-rpl-threshold':'pb-rpl-muted'},summary.kind==='uniform'?t(`${number(summary.value)} 件`,`${number(summary.value)} pzas`):summary.kind==='mixed'?t('各颜色不同','Por variante'):t('未设置','Sin aviso'))),
                    el('td',{},button(t('修改型号','Editar modelo'),()=>{e.selected=new Map(group.variants.map(p=>[p.id,p]));e.individual=false;e.templateId=group.id;e.templateLabel=group.label;e.overwrite=false;e.disable=false;e.value=summary.kind==='uniform'?String(summary.value):'';renderEditor();body.querySelector('#pb-rpl-minimum')?.focus();setStatus(t(`${group.label}：已选全部 ${group.variants.length} 个变体，可在下方选择是否覆盖单独门槛。`,`${group.label}: ${group.variants.length} variantes; elija si incluye umbrales individuales.`));},{disabled:!selectable||group.variants.some(p=>!Core.pieceProduct(p)),'data-selection':''}))));
                if(expanded)for(const p of group.variants)addVariant(p,true,matched.has(p.id));
            }
            table.append(el('thead',{},head),rows);body.append(el('div',{class:'pb-rpl-table-wrap'},table));const wrap=body.querySelector('.pb-rpl-table-wrap');wrap.scrollTop=scrollTop;wrap.scrollLeft=scrollLeft;
        }else body.append(el('div',{class:'pb-rpl-empty'},e.loading?t('正在查询…','Consultando…'):e.dirty?t('请重新搜索。','Vuelva a buscar.'):t('没有符合筛选的商品。','No hay productos que coincidan.')));
        if(e.results)selection.append(el('div',{class:'pb-rpl-pager'},el('span',{class:'pb-rpl-muted'},`${e.results.count?e.page*50+1:0}–${e.page*50+e.results.groups.length} / ${e.results.count}`),el('div',{class:'pb-rpl-actions'},button(t('上一页','Anterior'),()=>searchProducts(e.page-1),{disabled:blocked||e.dirty||e.page===0}),button(t('下一页','Siguiente'),()=>searchProducts(e.page+1),{disabled:blocked||e.dirty||(e.page+1)*50>=e.results.count}))));
        const minInput=el('input',{id:'pb-rpl-minimum',type:'number',min:'0',step:'1',value:e.value,placeholder:t('件数','Piezas'),'aria-label':t('少于多少件提醒','Umbral en piezas'),disabled:!selectable,onInput:event=>{e.value=event.target.value;invalidatePreview();}});
        const run=async()=>{
            if(!saveReady(e))return;e.busy=true;renderEditor();let message='';
            try{
                const result=await service.save([...e.selected.values()],e.rules,{value:e.value,overwrite:e.overwrite,disable:e.disable,individual:e.individual,templateId:e.templateId});
                e.rules=result.index;e.catalog=null;e.selected.clear();resetSelectionMode(e,true);stale=true;snapshot=null;channel?.postMessage({type:'config-changed',scope:stamp()});updateBadge();
                message=t(`已保存 ${result.changed} 项${result.protected?'，保留 '+result.protected+' 项单独门槛':''}。`,`Guardados: ${result.changed}; individuales conservados: ${result.protected}.`);
            }catch(x){e.dirty=true;e.selected.clear();setStatus(x.message,true);}
            finally{e.busy=false;if(editor===e){if(message){await searchProducts(0);if(!e.dirty)setStatus(message);}else renderEditor();}}
        };
        if(e.templateId){
            const mode=el('select',{'aria-label':t('型号修改方式','Modo de edición del modelo'),disabled:blocked,onChange:event=>{e.overwrite=event.target.value==='overwrite';invalidatePreview();}},el('option',{value:'preserve'},t('保留单独设置的颜色','Conservar umbrales individuales')),el('option',{value:'overwrite'},t('本次统一修改全部颜色','Incluir todas las variantes esta vez')));mode.value=e.overwrite?'overwrite':'preserve';
            body.append(el('div',{class:'pb-rpl-model-edit'},el('strong',{},`${e.templateLabel} · ${e.selected.size} ${t('个变体','variantes')}`),mode));
        }
        const advanced=el('details',{class:'pb-rpl-more'},el('summary',{},t('更多操作','Más opciones')),el('div',{class:'pb-rpl-form'},
            !e.templateId?el('label',{},el('input',{type:'checkbox',checked:e.overwrite,disabled:!selectable,onChange:event=>{e.overwrite=event.target.checked;invalidatePreview();}}),t('包含单独设置的门槛','Incluir umbrales individuales')):null,
            el('label',{},el('input',{type:'checkbox',checked:e.disable,disabled:!selectable,onChange:event=>{e.disable=event.target.checked;renderEditor();}}),t('关闭所选商品提醒','Desactivar avisos seleccionados'))));
        advanced.open=e.advancedOpen;advanced.addEventListener('toggle',()=>{e.advancedOpen=advanced.open;});
        body.append(el('div',{class:'pb-rpl-batch'},el('div',{class:'pb-rpl-filter-row'},el('label',{},t('少于','Menos de'),minInput,t('件时提醒','piezas')),button(e.disable?t('关闭所选提醒','Desactivar seleccionados'):t('保存所选','Guardar seleccionados'),run,{id:'pb-rpl-save',class:'pb-rpl-primary',disabled:!saveReady(e)})),advanced));
        if(!service.canEdit)body.append(el('div',{class:'pb-rpl-muted'},t('当前账号没有修改补货设置的权限。','Su cuenta no puede editar estos ajustes.')));
    }

    const languageChange=()=>{readLang();updateBadge();if(page==='settings'&&editor)renderEditor();else render();};
    window.addEventListener('pb-suite:language-change:v1',languageChange);
    const storageChange=e=>{if(e.key===languageKey)languageChange();if(e.key===prefKey){try{const p=JSON.parse(e.newValue);if(p?.schema===1&&p.companies)prefs=p;}catch(_){}updateBadge();}};
    window.addEventListener('storage',storageChange);
    let lastAuto=0;const readyAfter=performance.now()+9000;
    const tick=()=>{
        if(disposed)return;updateBadge();if(performance.now()<readyAfter)return;
        if(dialog?.open&&page==='alerts'&&!followupBusy&&!copying&&followupBoundary&&Date.now()>=followupBoundary)render();
        if(schemaMissing||!enabled()||!canShow||document.hidden||refreshing||service?.saving||copying||followupBusy||backupBusy||alertComposing||dialog?.open&&page!=='alerts')return;
        if(companyId&&companyHint()!==companyId){releaseLocalDraft();service=null;snapshot=null;error='';stale=true;companyId=0;lastAuto=0;}
        const reference=error?lastAuto:Math.max(lastAuto,stale?0:snapshot?.at||0),interval=error?AUTO_RETRY_MS:AUTO_REFRESH_MS;
        if(Date.now()-reference>=interval){lastAuto=Date.now();refresh(false).catch(()=>{});}
    };
    const timer=setInterval(tick,5000),initial=setTimeout(tick,9000);
    const visibility=()=>{if(document.hidden)flushLocalDraft();else tick();};document.addEventListener('visibilitychange',visibility);
    if(typeof GM_registerMenuCommand==='function')GM_registerMenuCommand('Playbox · 补货提醒设置 / Reposición',()=>open('display'));
    const api={version:VERSION,open:()=>open('alerts'),settings:()=>open('settings'),warehouses:()=>open('warehouses'),display:()=>open('display'),refresh:()=>refresh(true),diagnostics:()=>({version:VERSION,companyId,uid,warehouseId:service?.warehouseId||0,posWarehouse:service?.posContext?{...service.posContext}:null,sourceWarehouseIds:service?.warehouses.slice(1).map(w=>w.id)||[],warehouseSettingsMissing:service?.warehouseSettingsMissing??null,canEditWarehouses:service?.canEditWarehouses||false,canEdit:service?.canEdit||false,surface:surface(),enabled:enabled(),watched:snapshot?Core.watched(new Map(snapshot.index)).length:null,actionable:snapshot?.rows.filter(r=>r.status==='available').length??null,stale,error,lastSuccess:snapshot?.at||null,pending,display:displayPrefs(),model:Core.MODEL,schemaMissing,followupAvailable:service?.followupAvailable||false,pendingAlerts:snapshot?.rows.filter(r=>r.status==='available'&&Extras.followup(r.rule).state==='pending').length??null,loadingStock,incomingReady,incomingError,autoRefreshMs:AUTO_REFRESH_MS,draftSavedAt,draftProblem,metrics:{...metrics}}),checkAutomatic:()=>{lastAuto=0;tick();},dispose:()=>{flushLocalDraft();clearTimeout(draftSaveTimer);window.removeEventListener('pagehide',draftPageHide);disposed=true;window.removeEventListener('resize',fitReminderWindow);for(const type of viewportEvents)window.visualViewport?.removeEventListener(type,fitReminderWindow);clearInterval(timer);clearTimeout(initial);channel?.close();window.removeEventListener('keydown',guardKeys,true);window.removeEventListener('storage',storageChange);window.removeEventListener('pb-suite:language-change:v1',languageChange);document.removeEventListener('visibilitychange',visibility);dialog?.remove();launcher.remove();style.remove();delete PAGE.PBReplenishment;}};
    PAGE.PBReplenishment=Object.freeze(api);

    let alertFilter='pending',followupDays='1',followupBusy=false,backupBusy=false,backupPreview=null,followupBoundary=0;
    const backupScope=()=>({origin:location.origin,companyId,warehouseId:service?.warehouseId||0});
    function followupInfo(rule){const value=Extras.followup(rule);return value.until?el('div',{class:'pb-rpl-muted'},`${value.state==='contacted'?t('已联系','Contactado'):t('已暂缓','Pospuesto')} · ${t('恢复于','Hasta')} ${time(value.until)}`):null;}
    function renderFollowupFilters(target=body){
        const options=[['pending','待联系','Pendientes'],['contacted','已联系','Contactados'],['snoozed','已暂缓','Pospuestos'],['all','全部','Todos']];
        target.append(el('div',{class:'pb-rpl-segment',role:'group','aria-label':t('补货处理状态','Estado de seguimiento')},...options.map(([value,zh,es])=>{
            const count=filteredAlerts(value).length;
            return button(`${t(zh,es)} ${count}`,()=>{if(followupBusy||copying)return;alertFilter=value;alertSelection=null;knownAlertIds.clear();incomingDetail=null;saveDraftFilters();render();},{disabled:followupBusy||copying,'aria-pressed':String(alertFilter===value)});
        })));
        followupBoundary=Math.min(...snapshot.rows.map(r=>Extras.followup(r.rule).until).filter(n=>n>Date.now()),Infinity);
    }
    function renderFollowupActions(selected,rows,target=body){
        if(!rows.length)return;
        if(!service.followupAvailable){target.append(actionMenu('followup',t('标记状态','Marcar seguimiento'),el('p',{class:'pb-rpl-muted'},t('此数据库尚未准备共享处理标记。','Seguimiento compartido aún no disponible en esta base.'))));return;}
        const controls=el('div',{class:'pb-rpl-form'}),days=el('input',{type:'number',min:'1',max:'30',step:'1',value:followupDays,'aria-label':t('暂缓天数','Días de pausa'),disabled:followupBusy,onInput:e=>{followupDays=e.target.value;}});
        controls.append(el('label',{},t('暂缓','Pausar'),days,t('天','días')));
        const act=async state=>{
            if(followupBusy||copying||stale||error||loadingStock||!service.canEdit)return;
            const ids=rows.filter(r=>selected.has(r.productId)).map(r=>r.productId);if(!ids.length){setNotice(t('请先勾选商品。','Seleccione productos.'),true);return;}
            try{Extras.followupValues(state,followupDays);}catch(e){setNotice(e.message,true);return;}
            const expected=new Map(snapshot.index);followupBusy=true;render();
            try{const result=await service.setFollowup(ids,expected,state,followupDays);if(result.changed){stale=true;configEpoch++;configInvalidatedAt=Date.now();channel?.postMessage({type:'config-changed',scope:stamp()});await refresh(true);}setNotice(t(`已更新 ${result.changed} 项，所有电脑共用。`,`${result.changed} actualizados para todos los equipos.`));}
            catch(e){stale=true;error=e.message;setNotice(e.message,true);}finally{followupBusy=false;updateBadge();render();}
        };
        for(const [state,zh,es] of [['contacted','已联系仓管','Ya contacté al almacén'],['snoozed','稍后提醒','Recordar después'],['pending','恢复提醒','Reactivar aviso']])controls.append(button(t(zh,es),()=>act(state),{disabled:followupBusy||copying||stale||Boolean(error)||loadingStock||!service.canEdit||!rows.some(r=>selected.has(r.productId)),'data-followup-action':''}));
        target.append(actionMenu('followup',t('标记状态','Marcar seguimiento'),controls,el('div',{class:'pb-rpl-muted'},t('已联系和稍后提醒都会暂缓所选天数；到期自动恢复。只记录状态，不发送消息。','Contactar o posponer pausa los avisos durante esos días. Al vencer reaparecen. No se envían mensajes.'))));
    }
    function downloadThresholdBackup(file){
        const blob=new Blob([JSON.stringify(file,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=el('a',{href:url,download:`Playbox-umbrales-${service.warehouses[0]?.code||file.warehouseId}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`});
        document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    }
    function renderBackupBody(){
        if(!service){body.append(el('p',{},t('正在读取…','Cargando…')));return;}
        body.append(el('p',{class:'pb-rpl-muted'},t('备份当前门店的商品门槛和单独设置。恢复只合并文件中的商品，未列出的商品不变；处理状态和货源仓库不包含在内。','Copia umbrales y ajustes individuales de esta tienda. Restaura solo los productos del archivo; no incluye seguimiento ni almacenes de origen.')));
        const exportButton=button(t('导出门槛备份','Exportar umbrales'),async()=>{
            if(backupBusy)return;backupBusy=true;render();
            try{const file=await service.exportBackup(backupScope());downloadThresholdBackup(file);setNotice(t(`已生成 ${file.entries.length} 项备份，请保留下载文件。`,`Copia de ${file.entries.length} productos preparada. Conserve el archivo.`));}
            catch(e){setNotice(e.message,true);}finally{backupBusy=false;if(page==='backup'){render();if(notice)setStatus(notice.message,notice.bad);}}
        },{disabled:backupBusy,class:'pb-rpl-primary'});
        const fileInput=el('input',{type:'file',accept:'.json,application/json','aria-label':t('选择门槛备份','Elegir copia de umbrales'),disabled:backupBusy||!service.canEdit,onChange:async event=>{
            const file=event.target.files?.[0];if(!file||backupBusy)return;notice=null;backupPreview=null;backupBusy=true;render();
            try{if(file.size>8*1024*1024)throw Error(t('文件过大，最多 8 MB。','Archivo demasiado grande: máximo 8 MB.'));const raw=await file.text();backupPreview={...await service.previewRestore(JSON.parse(raw),backupScope()),fileName:file.name};}
            catch(e){setNotice(e.message,true);}finally{backupBusy=false;if(page==='backup'){render();if(notice)setStatus(notice.message,notice.bad);}}
        }});
        fileInput.hidden=true;
        body.append(el('div',{class:'pb-rpl-actions'},exportButton,button(backupPreview?t('更换备份文件','Cambiar archivo'):t('从文件恢复','Restaurar archivo'),()=>fileInput.click(),{disabled:backupBusy||!service.canEdit}),fileInput));
        if(!backupPreview)return;
        const preview=backupPreview,{changes,skipped,total}=preview.plan;
        body.append(el('div',{id:'pb-rpl-backup-filename',class:'pb-rpl-help'},t('已载入：','Archivo cargado: '),el('strong',{},preview.fileName)));
        body.append(el('p',{},t(`文件共 ${total} 项：将修改 ${changes.length} 项，跳过 ${skipped.length} 项。`,`Archivo: ${total}; cambios: ${changes.length}; omitidos: ${skipped.length}.`)));
        const label=r=>r?.x_pb_enabled&&r.x_pb_threshold_set?t(`${r.x_pb_min_pieces} 件${r.x_pb_is_override?' · 单独':''}`,`${r.x_pb_min_pieces} pzas${r.x_pb_is_override?' · individual':''}`):t('未启用','Inactivo');
        if(changes.length){const table=el('table',{},el('thead',{},el('tr',{},el('th',{},t('商品','Producto')),el('th',{},t('当前','Actual')),el('th',{},t('恢复后','Restaurado')))));for(const c of changes.slice(0,30))table.append(el('tr',{},el('td',{},c.product.default_code||c.product.name),el('td',{},label(c.prior)),el('td',{},label(c.values))));body.append(table);if(changes.length>30)body.append(el('p',{class:'pb-rpl-muted'},t('预览仅显示前 30 项；恢复将处理上方总数。','Se muestran los primeros 30; se aplicará el total indicado.')));}
        if(skipped.length){const detail=el('details',{},el('summary',{},t('查看跳过项','Ver omitidos')));for(const s of skipped.slice(0,100))detail.append(el('div',{},`${s.code||'?'} · ${s.reason==='identity'?t('商品不存在或编码已变','Producto ausente o código diferente'):t('商品已停用或单位不适用','Producto inactivo o unidad incompatible')}`));body.append(detail);}
        body.append(button(t(`恢复这 ${changes.length} 项`,`Restaurar ${changes.length}`),async()=>{
            if(backupBusy||!changes.length)return;backupBusy=true;render();
            try{downloadThresholdBackup(await service.exportBackup(backupScope()));const result=await service.restoreBackup(preview,backupScope());backupPreview=null;snapshot=null;stale=true;configEpoch++;configInvalidatedAt=Date.now();channel?.postMessage({type:'config-changed',scope:stamp()});setNotice(t(`已恢复 ${result.changed} 项；恢复前的备份也已生成。`,`Restaurados ${result.changed}; se preparó una copia previa.`));}
            catch(e){backupPreview=null;setNotice(e.message,true);}finally{backupBusy=false;updateBadge();if(page==='backup'){render();if(notice)setStatus(notice.message,notice.bad);}}
        },{disabled:backupBusy||!service.canEdit||!changes.length,class:'pb-rpl-primary'}));
    }

    let sourceFilter=0,receiptFilter='all',incomingReady=false,incomingError='',incomingSequence=0,incomingDetail=null,alertQuery='',alertComposing=false,alertSearchRow=null;
    let splitCache=null,splitKey='';
    function splitSources(){
        const key=`pb-replenishment:split:v1:${uid}:${companyId}:${service?.warehouseId||0}:${surface()}`;
        if(key!==splitKey){splitKey=key;try{splitCache=localStorage.getItem(key)==='true';}catch(_){splitCache=false;}}
        return splitCache===true;
    }
    const sourcePriority=()=>Views.priority(service?.sourcePriority,service?.warehouses.slice(1)||[]);
    const sourceForRow = row => sourceFilter || (splitSources() ? Views.assignedSource(row, sourcePriority()) : 0);
    function supplyRows(rows,options){
        const visible = Extras.supplyRows(rows, {...options, sourceId: 0});
        return Views.assignedRows(visible, options.sourceId, options.priority);
    }
    function resetIncoming(){incoming=new Map();incomingReady=false;incomingError='';incomingSequence++;incomingDetail=null;}
    function supplyOptions(state='all'){return {sourceId:sourceFilter,receipt:receiptFilter,incoming,incomingReady,state,query:alertQuery,split:splitSources(),priority:sourcePriority()};}
    function filteredAlerts(state=alertFilter){return supplyRows(snapshot?.rows||[],supplyOptions(state));}
    function setAlertQuery(value){
        alertQuery=value;alertSelection=null;knownAlertIds.clear();incomingDetail=null;copyFallbackText='';notice=null;saveDraftFilters();render();
    }
    function renderAlertSearch(){
        if(!alertSearchRow){const search=el('input',{id:'pb-rpl-alert-search',type:'search',maxlength:'200',
            onCompositionstart:()=>{alertComposing=true;},onCompositionend:e=>{alertComposing=false;setAlertQuery(e.target.value);},
            onInput:e=>{if(!e.isComposing&&!alertComposing&&e.target.value!==alertQuery)setAlertQuery(e.target.value);}});
            alertSearchRow=el('div',{class:'pb-rpl-search-row pb-rpl-alert-search'},search,button('',()=>{setAlertQuery('');document.getElementById('pb-rpl-alert-search')?.focus();}));
        }
        const search=alertSearchRow.querySelector('input'),clear=alertSearchRow.querySelector('button');
        if(search.value!==alertQuery)search.value=alertQuery;
        search.disabled=copying||followupBusy;search.placeholder=t('搜索编码或名称','Buscar código o nombre');search.setAttribute('aria-label',t('搜索提醒清单','Buscar en alertas'));
        clear.disabled=!alertQuery||copying||followupBusy;clear.textContent=t('清空','Limpiar');clear.setAttribute('aria-label',t('清空提醒搜索','Limpiar búsqueda de alertas'));
        return alertSearchRow;
    }
    function updateCartonPreview(row,raw,hint,notes){
        const check=Extras.cartonCheck(row,raw,sourceForRow(row)),verified=!stale&&!error;
        const labels={
            'invalid-text':t('请输入正整数箱数，并核对商品编码。','Ingrese cajas enteras positivas y verifique el código.'),
            'changed-product':t('编码或颜色已改，请核对对应商品。','Código o color modificado; verifique el producto.'),
            'unknown-carton':t('箱规待核，暂不能换算件数。','Caja sin verificar; no se pueden calcular las piezas.'),
            'quantity-overflow':t('箱数过大，暂不能核实。','Cantidad demasiado grande para verificar.'),
            'unknown-stock':t('货源库存尚未核实。','Existencias de origen sin verificar.')
        };
        const quantity=check.required?t(`${number(check.cartons)} 箱 × ${number(check.carton)} 件 = ${number(check.required)} 件`,`${number(check.cartons)} cajas × ${number(check.carton)} pzas = ${number(check.required)} pzas`):'';
        const result=check.status==='enough'?(sourceForRow(row)?t('所选货源足够','Origen suficiente'):t('至少一处货源足够','Al menos un origen suficiente')):check.status==='shortage'?(sourceForRow(row)?t('所选货源不足','Origen insuficiente'):t('各货源均不足','Ningún origen suficiente')):labels[check.status];
        hint.textContent=verified?[quantity,result].filter(Boolean).join(' · '):t('库存未核实，请刷新。','Existencias sin verificar; actualice.');
        hint.dataset.state=verified?check.status:'unknown-stock';
        hint.className='pb-rpl-carton-hint '+(verified&&check.status==='enough'?'pb-rpl-muted':'pb-rpl-warn');
        for(const [id,node] of notes){const s=check.sources.find(s=>s.warehouseId===id);node.textContent=verified&&s?.maxCartons!==null&&s?.maxCartons!==undefined?t(` · 可供 ${number(s.maxCartons)} 箱`,` · ${number(s.maxCartons)} cajas disponibles`):'';node.parentElement.dataset.cartonState=verified?(s?.status||'unknown-stock'):'unknown-stock';}
    }
    function renderSupplyFilters(controls){
        const disabled=copying||followupBusy;
        const change=()=>{alertSelection=null;knownAlertIds.clear();incomingDetail=null;copyFallbackText='';notice=null;saveDraftFilters();render();};
        const mode=el('select',{'aria-label':t('补货清单显示方式','Vista de reposición'),disabled,onChange:e=>{splitCache=e.target.value==='split';try{localStorage.setItem(splitKey,String(splitCache));}catch(_){setNotice(t('显示方式未能保存在本机。','No se guardó la vista.'),true);}change();}},el('option',{value:'all'},t('全部仓库清单','Lista de todos los orígenes')),el('option',{value:'split'},t('按货源优先级分单','Separar por prioridad')));mode.value=splitSources()?'split':'all';
        const options={...supplyOptions(alertFilter),sourceId:0},visible=supplyRows(snapshot.rows,options);
        const tabs=el('div',{class:'pb-rpl-source-tabs',role:'group','aria-label':t('仓库清单标签','Listas por origen')});
        for(const id of [0,...sourcePriority()]){const w=service.warehouses.find(w=>w.id===id),count=id?supplyRows(visible,{...options,sourceId:id}).length:visible.length,label=id?w.label:t('全部','Todos');
            tabs.append(button('',()=>{sourceFilter=id;change();document.querySelector('.pb-rpl-source-tab[data-source-id="'+id+'"]').focus({preventScroll:true});},{class:'pb-rpl-source-tab','data-source-id':String(id),'aria-label':t('查看仓库清单 ','Ver lista de ')+label,'aria-pressed':String(sourceFilter===id),disabled}));
            tabs.lastChild.append(el('span',{},label),el('span',{class:'pb-rpl-source-count'},String(count)));
        }
        if(sourceFilter&&!service.warehouses.slice(1).some(w=>w.id===sourceFilter))tabs.append(el('span',{class:'pb-rpl-muted'},t('原货源已取消，请选“全部”。','Origen eliminado; seleccione Todos.')));
        const receipts=el('select',{id:'pb-rpl-receipt-filter','aria-label':t('按待收货筛选','Filtrar recepciones'),disabled,onChange:e=>{receiptFilter=e.target.value;change();}});
        for(const [value,zh,es] of [['all','全部','Todos'],['without','没有待收货','Sin recepción pendiente'],['with','已有待收货','Con recepción pendiente']])receipts.append(el('option',{value},t(zh,es)));
        receipts.value=receiptFilter;
        const filterPanel=el('div',{class:'pb-rpl-filter-panel'},el('label',{},t('待收货','Recepciones'),receipts),groupingButton('alerts',disabled),el('div',{class:'pb-rpl-help-text'},t('仓库分页按优先级归到首个有可用库存的货仓。整箱不足仍提示，不自动拆单。','Las pestañas asignan cada producto al primer origen con existencias según la prioridad. Se avisa si no alcanza para una caja y no se divide el pedido.')));
        const filterMenu=actionMenu('filters',t('筛选','Filtros')+(receiptFilter!=='all'?' · 1':''),filterPanel);filterMenu.querySelector('summary').setAttribute('aria-disabled',String(disabled));alertToolbar.append(filterMenu);
        alertSources.append(tabs,mode);
        const active=el('div',{class:'pb-rpl-active-filters'});
        if(receiptFilter!=='all')active.append(button(t(receiptFilter==='with'?'已有待收货 · 清除':'没有待收货 · 清除',receiptFilter==='with'?'Con recepción · Quitar':'Sin recepción · Quitar'),()=>{receiptFilter='all';change();},{disabled}));
        controls.append(active);
        if(!incomingReady)body.append(el('div',{class:incomingError?'pb-rpl-warn':'pb-rpl-muted'},incomingError?t('待收货尚未核实；相关筛选和复制暂不可用。可刷新重试。','Recepciones sin verificar; filtro y copia correspondientes no disponibles. Actualice.'):t('正在核对待收货…','Consultando recepciones…')));
    }
    function incomingButton(row){
        if(!incomingReady||!(incoming.get(row.productId)>0))return null;
        return button(t(`待收 ${number(incoming.get(row.productId))} 件 · 查看`,`Pendiente ${number(incoming.get(row.productId))} pzas · Ver`),()=>showIncoming(row),{class:'pb-rpl-incoming-link',disabled:stale||Boolean(error)||copying});
    }
    async function showIncoming(row){
        if(stale||error||copying)return;
        const snap=snapshot,detail={productId:row.productId,code:row.product.default_code||row.product.name,loading:true,rows:[],error:''};incomingDetail=detail;render();
        try{const rows=await service.incomingDetails(row.productId);if(snapshot===snap&&incomingDetail===detail){detail.rows=rows;detail.loading=false;}}
        catch(e){if(snapshot===snap&&incomingDetail===detail){detail.error=e.message;detail.loading=false;}}
        if(snapshot===snap&&incomingDetail===detail&&dialog?.open&&page==='alerts'){render();document.getElementById('pb-rpl-incoming-detail')?.scrollIntoView({block:'nearest',behavior:'auto'});}
    }
    function renderIncomingDetail(){
        if(!incomingDetail)return;
        const d=incomingDetail,box=el('section',{id:'pb-rpl-incoming-detail',class:'pb-rpl-help','aria-label':t('待收货明细','Detalle de recepciones')});
        box.append(el('div',{class:'pb-rpl-filter-row'},el('strong',{},`${d.code} · ${t('待收货明细','Recepciones pendientes')}`),button(t('收起','Cerrar'),()=>{incomingDetail=null;render();})));
        if(d.loading)box.append(el('p',{},t('正在读取…','Cargando…')));
        else if(d.error)box.append(el('p',{class:'pb-rpl-error'},d.error));
        else if(!d.rows.length)box.append(el('p',{},t('现在已无待收记录，请刷新清单。','Ya no hay recepciones pendientes; actualice la lista.')));
        else{
            const states={waiting:t('等待前一步','Esperando operación previa'),confirmed:t('等待备货','Esperando disponibilidad'),assigned:t('已预留','Reservado'),partially_available:t('部分预留','Reserva parcial')};
            const total=d.rows.reduce((n,r)=>n+r.product_qty,0),table=el('table'),head=el('tr');
            for(const title of [t('单号','Referencia'),t('库位','Ubicaciones'),t('计划件数','Pzas previstas'),t('状态 / 计划时间','Estado / Fecha prevista')])head.append(el('th',{},title));table.append(el('thead',{},head));
            const tbody=el('tbody');
            for(const r of d.rows){const pickingId=Core.id(r.picking_id),date=Date.parse(String(r.date||'').replace(' ','T')+'Z');
                tbody.append(el('tr',{},el('td',{},pickingId?el('a',{href:`/web#id=${pickingId}&model=stock.picking&view_type=form`,target:'_blank',rel:'noopener noreferrer'},r.picking_id[1]||String(pickingId)):t('未关联调拨单','Sin traslado asociado')),el('td',{},`${r.location_id[1]} → ${r.location_dest_id[1]}`),el('td',{class:'pb-rpl-num'},number(r.product_qty)),el('td',{},states[r.state]||r.state,el('div',{class:'pb-rpl-muted'},Number.isFinite(date)?time(date):t('未排期','Sin fecha')))));
            }
            table.append(tbody);box.append(table,el('div',{class:'pb-rpl-muted'},t(`合计 ${number(total)} 件，尚未计入可用库存。点击单号可查看原单。`,`Total ${number(total)} pzas; no se incluyen en disponibles. Abra la referencia para ver el traslado.`)));
            if(Math.abs(total-(incoming.get(d.productId)||0))>0.00001)box.append(el('p',{class:'pb-rpl-warn'},t('明细与上次汇总已有变化，请刷新清单后再复制。','Los detalles cambiaron; actualice la lista antes de copiar.')));
        }
        body.append(box);
    }

    let localDraftKey='',localDraftScope=null,draftEntries=new Map(),draftPatches=new Map(),draftViewDirty=false,draftSaveTimer=null,draftSavedAt=0,draftProblem='',draftRecovered=false;
    const quantityEdits=new Map();let batchCount='1';
    function draftView(){return {query:alertQuery,sourceId:sourceFilter,receipt:receiptFilter,state:alertFilter};}
    function loadLocalDraft(){
        const scope={origin:location.origin,uid,companyId,warehouseId:service.warehouseId,surface:surface()},key=Drafts.key(scope);
        if(key===localDraftKey)return false;
        releaseLocalDraft();localDraftScope=scope;localDraftKey=key;
        try{const raw=localStorage.getItem(key),saved=Drafts.decode(raw,scope);draftEntries=new Map(saved.entries.map(e=>[e.productId,e]));draftSavedAt=saved.savedAt;draftRecovered=raw!==null;
            alertQuery=saved.filters.query;sourceFilter=saved.filters.sourceId;receiptFilter=saved.filters.receipt;alertFilter=saved.filters.state;
        }catch(_){draftProblem=t('旧草稿无法读取；新修改保存前会先保留旧内容。','No se pudo leer el borrador; se conservará antes de guardar cambios.');}
        return true;
    }
    function releaseLocalDraft(){
        flushLocalDraft();clearTimeout(draftSaveTimer);draftSaveTimer=null;localDraftKey='';localDraftScope=null;draftEntries.clear();draftPatches.clear();quantityEdits.clear();copyDrafts.clear();draftViewDirty=false;draftSavedAt=0;draftProblem='';draftRecovered=false;
    }
    function scheduleDraftSave(){if(!localDraftKey)return;clearTimeout(draftSaveTimer);draftSaveTimer=setTimeout(flushLocalDraft,250);}
    function saveDraftFilters(){if(!localDraftKey)return;draftViewDirty=true;scheduleDraftSave();}
    function flushLocalDraft(){
        clearTimeout(draftSaveTimer);draftSaveTimer=null;
        if(!localDraftKey||!localDraftScope||!draftPatches.size&&!draftViewDirty)return;
        try{
            let raw=localStorage.getItem(localDraftKey);
            try{Drafts.decode(raw,localDraftScope);}catch(_){if(raw!==null)localStorage.setItem(localDraftKey+':recovery',raw);raw=null;}
            const saved=Drafts.merge(raw,localDraftScope,draftPatches,draftViewDirty?draftView():null);
            localStorage.setItem(localDraftKey,JSON.stringify(saved));draftPatches.clear();draftViewDirty=false;draftSavedAt=saved.savedAt;draftProblem='';
        }catch(_){draftProblem=t('草稿未能保存，请勿依赖刷新恢复；可继续复制清单。','No se pudo guardar el borrador; no confíe en restaurarlo al recargar. Puede copiar la lista.');}
        updateDraftStatus();
    }
    function updateDraftStatus(){
        const node=document.getElementById('pb-rpl-draft-status');if(!node)return;
        let invalid=false;for(const edit of quantityEdits.values())try{Drafts.count(edit.raw);}catch(_){invalid=true;}
        node.textContent=draftProblem||(invalid?t('有无效箱数；刷新会恢复上次有效值。','Hay cajas inválidas; al recargar se restaurará el último valor válido.'):'');
        node.hidden=!node.textContent;
        node.className='pb-rpl-warn';
    }
    function draftRowState(row){
        const value=Drafts.state(draftEntries.get(row.productId),row.product),edit=quantityEdits.get(row.productId);
        return {...value,raw:edit?.identity===Drafts.identity(row.product)?edit.raw:String(value.cartons)};
    }
    function recordDraftRow(row,patch){
        const identity=Drafts.identity(row.product),prior=draftEntries.get(row.productId),state=Drafts.state(prior,row.product);
        draftEntries.set(row.productId,{productId:row.productId,identity,selected:state.selected,cartons:state.cartons,...patch});
        const dirty=draftPatches.get(row.productId);draftPatches.set(row.productId,{...(dirty?.identity===identity?dirty:{}),identity,...patch});scheduleDraftSave();
    }
    function syncDraftRows(rows){
        alertSelection=new Set();
        for(const row of rows){const state=draftRowState(row);if(state.selected)alertSelection.add(row.productId);try{copyDrafts.set(row.productId,Drafts.line(row.product,state.raw));}catch(_){copyDrafts.set(row.productId,'');}}
    }
    function selectDraftRow(row,selected){recordDraftRow(row,{selected});if(selected)alertSelection.add(row.productId);else alertSelection.delete(row.productId);updateDraftActions();}
    function updateDraftActions(){
        if(!snapshot||!dialog?.open||page!=='alerts')return;
        const rows=filteredAlerts(),chosen=rows.filter(r=>alertSelection?.has(r.productId)),blocked=copying||followupBusy||stale||Boolean(error)||loadingStock;
        const label=document.getElementById('pb-rpl-selection-count');if(label)label.textContent=t(`已选 ${chosen.length} / 当前 ${rows.length}`,`${chosen.length} seleccionados / ${rows.length} visibles`);
        const copy=document.getElementById('pb-rpl-copy-selected');if(copy)copy.disabled=blocked||!chosen.length||chosen.some(r=>!copyDrafts.get(r.productId));
        for(const button of document.querySelectorAll('[data-copy-warehouse]')){const selected=chosen.filter(r=>Views.assignedSource(r,sourcePriority())===Number(button.dataset.copyWarehouse));button.disabled=blocked||!selected.length||selected.some(r=>!copyDrafts.get(r.productId));}
        const apply=document.getElementById('pb-rpl-batch-apply');if(apply){let valid=true;try{Drafts.count(batchCount);}catch(_){valid=false;}apply.disabled=blocked||!chosen.length||!valid;}
        for(const button of dialog.querySelectorAll('[data-followup-action]'))button.disabled=blocked||!service?.canEdit||!chosen.length;
        updateDraftStatus();
    }
    function renderQuantity(row,hint,notes){
        const state=draftRowState(row),code=row.product.default_code||String(row.productId),identity=Drafts.identity(row.product),output=el('output',{class:'pb-rpl-copy-preview','aria-label':t('微信内容 ','Texto para WeChat ')+code});
        let known=true;try{Core.parseCopyLine(Core.defaultCopyLine(row.product));}catch(_){known=false;}
        const input=el('input',{id:'pb-rpl-cartons-'+row.productId,type:'number',min:'1',max:'999999999',step:'1',value:state.raw,disabled:copying||followupBusy||!known,'aria-label':t('箱数 ','Cajas ')+code});
        const minus=button('−',()=>step(-1),{'aria-label':t('减少一箱 ','Quitar una caja ')+code}),plus=button('+',()=>step(1),{'aria-label':t('增加一箱 ','Añadir una caja ')+code});
        const update=(notify=true)=>{
            let count=null;try{count=Drafts.count(input.value);const line=Drafts.line(row.product,count);copyDrafts.set(row.productId,line);output.textContent=line;}catch(_){copyDrafts.set(row.productId,'');output.textContent=t('箱数或编码待核','Verifique cajas o código');}
            minus.disabled=copying||followupBusy||!known||count===null||count<=1;plus.disabled=copying||followupBusy||!known||count===null||count>=999999999;
            updateCartonPreview(row,copyDrafts.get(row.productId),hint,notes);if(notify)updateDraftActions();
        };
        const edit=()=>{quantityEdits.set(row.productId,{identity,raw:input.value});try{const cartons=Drafts.count(input.value);Drafts.line(row.product,cartons);recordDraftRow(row,{cartons});}catch(_){}copyFallbackText='';notice=null;body.querySelector('.pb-rpl-copy-fallback')?.remove();update();};
        function step(delta){try{input.value=String(Drafts.count(input.value)+delta);edit();}catch(_){} }
        input.addEventListener('input',edit);update(false);
        return el('div',{class:'pb-rpl-quantity'},el('div',{class:'pb-rpl-carton-controls'},minus,input,plus,el('span',{class:'pb-rpl-muted'},t('箱','cajas'))),output,state.changed?el('div',{class:'pb-rpl-warn'},t('商品编码或型号已变，旧草稿未恢复。','Cambió el producto; no se restauró el borrador anterior.')):null);
    }
    function renderDraftTools(rows,target=body){
        const blocked=copying||followupBusy||stale||Boolean(error)||loadingStock;
        const controls=el('div',{class:'pb-rpl-form'});
        const choose=mode=>{if(blocked)return;for(const row of rows){const selected=mode==='all'||mode==='enough'&&Extras.cartonCheck(row,copyDrafts.get(row.productId),sourceForRow(row)).status==='enough';recordDraftRow(row,{selected});}render();};
        for(const [mode,zh,es] of [['all','全选当前结果','Seleccionar visibles'],['none','取消当前选择','Deseleccionar visibles'],['enough','只选够整箱','Solo cajas suficientes']])controls.append(button(t(zh,es),()=>choose(mode),{disabled:blocked||!rows.length}));
        const count=el('input',{id:'pb-rpl-batch-count',type:'number',min:'1',max:'999999999',step:'1',value:batchCount,'aria-label':t('统一箱数','Cajas para seleccionados'),disabled:blocked,onInput:e=>{batchCount=e.target.value;updateDraftActions();}});
        controls.append(el('label',{},t('统一改为','Cambiar a'),count,t('箱','cajas')),button(t('应用到所选','Aplicar a seleccionados'),()=>{
            if(blocked)return;try{const plan=Drafts.batchPlan(rows,alertSelection||new Set(),batchCount);if(!plan.length)throw Error(t('请先勾选商品。','Seleccione productos.'));
                for(const item of plan){recordDraftRow(item.row,{cartons:item.cartons});quantityEdits.set(item.row.productId,{identity:Drafts.identity(item.row.product),raw:String(item.cartons)});}render();
            }catch(e){setNotice(e.message,true);}
        },{id:'pb-rpl-batch-apply',disabled:true}));
        const details=actionMenu('batch',t('批量操作','Acciones en lote'),controls,el('div',{class:'pb-rpl-muted'},t('只处理当前结果。够整箱按最近核对结果判断，复制前会再次核对。','Solo resultados visibles. La suficiencia se comprueba de nuevo antes de copiar.')));
        target.append(el('span',{id:'pb-rpl-selection-count',class:'pb-rpl-muted'}),details);
    }
    const draftPageHide=()=>flushLocalDraft();window.addEventListener('pagehide',draftPageHide);

updateBadge();
})();

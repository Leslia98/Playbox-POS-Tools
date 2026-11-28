// ==UserScript==
// @name         Playbox Odoo - 拆色与制造
// @namespace    https://playboxelectronics1.odoo.com/playbox-suite
// @version      1.0.17
// @description  拆色与制造；定向修复候选，已通过本地回归，待安装后组合验收。
// @author       Playbox
// @run-at       document-start
// @match        https://*.odoo.com/odoo
// @match        https://*.odoo.com/odoo/*
// @grant        none
// ==/UserScript==

(function () {
'use strict';

if (location.protocol !== "https:" || !/(^|\.)odoo\.com$/i.test(location.hostname)) return;

if (!/^\/odoo(?:\/|$)/.test(location.pathname)) return;

if (document.documentElement?.hasAttribute("data-pb-suite-color")) return;
document.documentElement?.setAttribute("data-pb-suite-color","1.0.17");

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


const pbReadLocal = key => { try { return localStorage.getItem(key); } catch (_) { return null; } };
function pbPreferenceError(error) {
 console.error("[Playbox] Preference failure",error);
 const show = () => {
  if(document.getElementById("pb-suite-preference-error")) return;
  const notice=document.createElement("div");
  notice.id="pb-suite-preference-error"; notice.setAttribute("role","alert");
  notice.style.cssText="position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#8b1e1e;color:white;padding:12px";
  notice.textContent="设置保存或迁移失败，请保留备份并检查。 / No se pudo guardar o migrar la configuración. Conserve la copia y revise.";
  document.body.appendChild(notice);
 };
 if(document.body) show(); else document.addEventListener("DOMContentLoaded",show,{once:true});
}
const PBUI = PBLanguage.create({
 storage:localStorage,bus:window,
 legacy:[pbReadLocal("pb-cart-unit-language:"+location.host),pbReadLocal("pbful_lang_v1"),pbReadLocal("pb_odoo_pos_box_barcode_language_v1"),"zh-CN"],
 onError:pbPreferenceError,
 eventFactory:(name,detail)=>new CustomEvent(name,{detail})
});
const pbUiText = (zh,es) => PBUI.get() === "es-MX" ? es : zh;
const pbUiPair = (zh,es) => ({toString:()=>String(pbUiText(zh,es))});
if (typeof GM_registerMenuCommand === "function") {
 GM_registerMenuCommand("界面语言：中文 / Idioma: 中文",()=>PBUI.set("zh-CN"));
 GM_registerMenuCommand("界面语言：Español (México)",()=>PBUI.set("es-MX"));
}
function pbEnsureLanguageEntry() {
 if (!document.body) return;
 let button=document.getElementById("pb-suite-language-toggle");
 if (!button) {
  button=document.createElement("button"); button.id="pb-suite-language-toggle";button.type="button";
  button.style.cssText="position:fixed;right:8px;bottom:8px;z-index:2147482000;min-width:54px;min-height:32px;padding:4px 8px;border:1px solid #7b8794;border-radius:16px;background:#fff;color:#25313c;font:700 12px/1 system-ui;opacity:.82;box-shadow:0 2px 8px #0002";
  const changeLanguage=()=>PBUI.set(PBUI.get()==="zh-CN"?"es-MX":"zh-CN");
  if(typeof button.addEventListener==="function")button.addEventListener("click",changeLanguage);else button.onclick=changeLanguage;
  document.body.appendChild(button);
 }
 const render=()=>{button.textContent=PBUI.get()==="zh-CN"?"中 / ES":"ES / 中";button.title=PBUI.get()==="zh-CN"?"切换为墨西哥西语":"Cambiar a chino";button.setAttribute("aria-label",button.title)};
 render();PBUI.subscribe(render);
}
if(document.body)pbEnsureLanguageEntry();else document.addEventListener("DOMContentLoaded",pbEnsureLanguageEntry,{once:true});


// suite-bootstrap-end

(function () {
/* Update translated text without replacing controls or touching business state.
 * Validate the entire shape first: a changed render must never partly patch UI.
 */
function pbUpdateTextInPlace(current, translated) {
    const changes = [];
    function collect(a, b) {
        if (!a || !b || a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
        if (a.nodeType === 3) {
            if (a.nodeValue !== b.nodeValue) changes.push(() => { a.nodeValue = b.nodeValue; });
            return true;
        }
        if (a.nodeType === 1) {
            // Matching data identities prevents writing one product's text into another.
            const identity = node => Array.from(node.attributes)
                .filter(attr => attr.name === "id" || attr.name.startsWith("data-"))
                .map(attr => [attr.name, attr.value]).sort();
            if (JSON.stringify(identity(a)) !== JSON.stringify(identity(b))) return false;
            for (const key of ["title", "aria-label", "placeholder"]) {
                const value = b.getAttribute(key);
                if (value !== a.getAttribute(key)) changes.push(() => {
                    if (value === null) a.removeAttribute(key);
                    else a.setAttribute(key, value);
                });
            }
        }
        if (a.childNodes.length !== b.childNodes.length) return false;
        for (let i = 0; i < a.childNodes.length; i++) {
            if (!collect(a.childNodes[i], b.childNodes[i])) return false;
        }
        return true;
    }
    if (!collect(current, translated)) return false;
    changes.forEach(change => change());
    return true;
}

/* Playbox batch color split for Odoo 19. Appended to the fulfillment scanner userscript. */
(() => {
    "use strict";
    if (location.protocol !== "https:" || !/(^|\.)odoo\.com$/i.test(location.hostname) || !/^\/odoo(?:\/|$)/.test(location.pathname)) return;
    if (window.__PB_COLOR_SPLIT_V1__) return;
    window.__PB_COLOR_SPLIT_V1__ = true;

    const VERSION = "1.0.17";
    const ORIGIN_PREFIX = "PB-COLOR-SPLIT";
    const DEFAULT_COLOR_NAMES = new Set(["默认色", "DEFAULT", "COLOR PREDETERMINADO", "PREDETERMINADO", "通用 GENERAL", "通用", "GENERAL"]);
    const state = { open: false, busy: false, allPickings: [], pickings: [], picking: null, groups: [], result: null, error: "", lang: "zh", listQuery: "", pickingFilter: "actionable", listLoadedAt: 0 };

    const tr = (zh, es) => state.lang === "es" ? es : zh;
    const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    const round = value => Math.round((num(value) + Number.EPSILON) * 10000) / 10000;
    const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
    const m2o = value => Array.isArray(value) ? Number(value[0]) : Number(value || 0);
    const normalize = value => String(value || "").trim().toUpperCase();
    const productLabel = product => product?.default_code || String(product?.display_name || "").match(/[A-Z]{2,}\d+[A-Z0-9-]*/i)?.[0]?.toUpperCase() || `#${product?.id || ""}`;
    const originFor = (pickingId, sourceId, targetId) => `${ORIGIN_PREFIX}:${pickingId}:${sourceId}:${targetId}`;
    const isDefaultColor = name => DEFAULT_COLOR_NAMES.has(normalize(name));
    const splitStatus = (transferQty, committedQty, doneQty = committedQty) => {
        if (num(committedQty) <= 0) return "unstarted";
        if (num(doneQty) + 1e-6 >= num(transferQty)) return "complete";
        return "partial";
    };
    const statusLabel = status => ({
        unstarted: tr("未拆", "Sin iniciar"), partial: tr("部分完成", "Parcial"),
        complete: tr("全部完成", "Completa"), ineligible: tr("无可拆产品", "Sin productos aptos"),
    })[status] || status;
    const filterLabel = filter => ({
        actionable: tr("可继续拆色", "Se puede continuar"), unstarted: tr("未拆", "Sin iniciar"),
        partial: tr("部分完成", "Parcial"), complete: tr("全部完成", "Completa"), all: tr("全部已完成调拨", "Todas las transferencias"),
    })[filter] || filter;

    async function rpc(model, method, args = [], kwargs = {}) {
        const response = await fetch(`/web/dataset/call_kw/${model}/${method}`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { model, method, args, kwargs } }),
        });
        let payload;
        try { payload = await response.json(); }
        catch (error) {
            if (!response.ok) throw Object.assign(new Error(`${response.status} ${response.statusText || "HTTP error"}`), { model, method, httpStatus: response.status });
            throw error;
        }
        if (payload.error) {
            const message = payload.error.data?.message || payload.error.data?.arguments?.[0] || payload.error.message || "Odoo RPC error";
            throw Object.assign(new Error(message), { odoo: payload.error, model, method, httpStatus: response.status });
        }
        if (!response.ok) throw Object.assign(new Error(`${response.status} ${response.statusText || "HTTP error"}`), { model, method, httpStatus: response.status });
        return payload.result;
    }

    function colorSplitError(error) {
        const message = String(error?.message || error);
        if (error?.model === "mrp.production" && (error.httpStatus === 404 || /\b404\b|not found/i.test(message))) {
            return tr("当前数据库无法读取制造单（mrp.production，404）。请在 Odoo「应用」检查是否已安装“制造”，并确认当前账号有制造单的读取权限。确认前无法执行批量拆色。",
                "No se pueden consultar las órdenes de fabricación (mrp.production, 404). Verifique en Aplicaciones que Manufactura esté instalada y que su usuario pueda consultar órdenes de fabricación. La conversión de colores está detenida.");
        }
        return message;
    }

    async function read(model, ids, fields) {
        if (!ids?.length) return [];
        return rpc(model, "read", [ids], { fields });
    }

    async function searchRead(model, domain, fields, options = {}) {
        return rpc(model, "search_read", [domain], { fields, ...options });
    }

    async function create(model, values) {
        const result = await rpc(model, "create", [[values]]);
        return Number(Array.isArray(result) ? result[0] : result);
    }

    function groupTotals(groups = state.groups) {
        return groups.map(group => ({
            sourceId: group.source.id,
            required: round(group.remainingQty),
            entered: round(group.variants.reduce((sum, variant) => sum + num(variant.qty), 0)),
        }));
    }

    function validatePlan(groups = state.groups) {
        const problems = [];
        for (const group of groups) {
            const entered = round(group.variants.reduce((sum, variant) => sum + num(variant.qty), 0));
            if (group.remainingQty <= 0 && entered <= 0) continue;
            if (entered > round(group.remainingQty) + 1e-6) problems.push(`${group.source.display_name}: ${tr("本次数量超过待拆数量", "La cantidad supera lo pendiente")} ${entered} / ${group.remainingQty}`);
            if (group.available + 1e-6 < entered) problems.push(`${group.source.display_name}: ${tr("默认色可用库存不足", "Stock disponible del color predeterminado insuficiente")} ${group.available} / ${entered}`);
            for (const variant of group.variants) {
                if (num(variant.qty) < 0 || !Number.isInteger(num(variant.qty))) problems.push(`${variant.display_name}: ${tr("数量必须是非负整数", "La cantidad debe ser un entero no negativo")}`);
            }
        }
        if (!groups.some(group => group.variants.some(variant => num(variant.qty) > 0))) problems.push(tr("没有输入待拆数量", "No hay cantidades para convertir"));
        return problems;
    }

    function applyPickingFilter() {
        state.pickings = state.allPickings.filter(picking => {
            if (state.pickingFilter === "all") return true;
            if (state.pickingFilter === "actionable") return picking.splitStatus !== "ineligible" && (num(picking.actionableQty) > 0 || num(picking.committedQty) > num(picking.doneQty));
            return picking.splitStatus === state.pickingFilter;
        });
    }

    async function classifyPickings(pickings) {
        if (!pickings.length) return pickings;
        const moveIds = [...new Set(pickings.flatMap(picking => picking.move_ids || []))];
        const moves = await read("stock.move", moveIds, ["product_id", "quantity", "state"]);
        const productIds = [...new Set(moves.filter(move => move.state === "done" && num(move.quantity) > 0).map(move => m2o(move.product_id)).filter(Boolean))];
        const products = await read("product.product", productIds, ["product_tmpl_id", "product_template_attribute_value_ids", "is_storable"]);
        const ptavIds = [...new Set(products.flatMap(product => product.product_template_attribute_value_ids || []))];
        const ptavs = await read("product.template.attribute.value", ptavIds, ["name", "attribute_id"]);
        const ptavById = new Map(ptavs.map(value => [Number(value.id), value]));
        const productById = new Map(products.map(product => [Number(product.id), product]));
        const pickingByMove = new Map(pickings.flatMap(picking => (picking.move_ids || []).map(id => [Number(id), picking])));
        const totals = new Map(pickings.map(picking => [Number(picking.id), new Map()]));
        for (const move of moves) {
            const picking = pickingByMove.get(Number(move.id)), product = productById.get(m2o(move.product_id));
            if (!picking || move.state !== "done" || num(move.quantity) <= 0 || !product?.is_storable) continue;
            const values = (product.product_template_attribute_value_ids || []).map(id => ptavById.get(Number(id))).filter(Boolean);
            if (!values.some(value => isDefaultColor(value.name))) continue;
            const bySource = totals.get(Number(picking.id));
            bySource.set(Number(product.id), round((bySource.get(Number(product.id)) || 0) + num(move.quantity)));
        }
        const eligibleSourceIds = [...new Set([...totals.values()].flatMap(bySource => [...bySource.keys()]))];
        const destinationIds = [...new Set(pickings.map(picking => m2o(picking.location_dest_id)).filter(Boolean))];
        const quants = eligibleSourceIds.length && destinationIds.length ? await searchRead("stock.quant",
            [["product_id", "in", eligibleSourceIds], ["location_id", "in", destinationIds]],
            ["product_id", "location_id", "available_quantity"], { limit: 10000 }) : [];
        const availableByProductLocation = new Map();
        for (const quant of quants) {
            const key = `${m2o(quant.product_id)}:${m2o(quant.location_id)}`;
            availableByProductLocation.set(key, round((availableByProductLocation.get(key) || 0) + num(quant.available_quantity)));
        }
        const originClauses = pickings.flatMap(picking => [
            ["origin", "ilike", `${ORIGIN_PREFIX}:${picking.id}:`],
            ["origin", "ilike", `PB拆色 ${picking.name} #`],
        ]);
        const productionDomain = [["state", "!=", "cancel"], ...Array(Math.max(0, originClauses.length - 1)).fill("|"), ...originClauses];
        const productions = await searchRead("mrp.production", productionDomain,
            ["origin", "product_qty", "state"], { limit: 20000, order: "id" });
        const pickingIdByName = new Map(pickings.map(picking => [String(picking.name), Number(picking.id)]));
        const progress = new Map();
        for (const production of productions) {
            const origin = String(production.origin || "");
            const modern = origin.match(/^PB-COLOR-SPLIT:(\d+):(\d+):(\d+)/);
            const legacy = origin.match(/^PB拆色 (.+) #(\d+)>(\d+)$/);
            const pickingId = modern ? Number(modern[1]) : legacy ? pickingIdByName.get(legacy[1]) : 0;
            const sourceId = modern ? Number(modern[2]) : legacy ? Number(legacy[2]) : 0;
            if (!totals.has(pickingId) || !totals.get(pickingId).has(sourceId)) continue;
            const key = `${pickingId}:${sourceId}`, item = progress.get(key) || { committed: 0, done: 0 };
            item.committed = round(item.committed + num(production.product_qty));
            if (production.state === "done") item.done = round(item.done + num(production.product_qty));
            progress.set(key, item);
        }
        return pickings.map(picking => {
            const bySource = totals.get(Number(picking.id)) || new Map();
            let transferQty = 0, committedQty = 0, doneQty = 0, remainingQty = 0, availableQty = 0, actionableQty = 0, anyCommitted = false, allComplete = bySource.size > 0;
            for (const [sourceId, qty] of bySource) {
                const item = progress.get(`${picking.id}:${sourceId}`) || { committed: 0, done: 0 };
                const sourceRemaining = round(Math.max(0, qty - item.committed));
                const sourceAvailable = round(Math.max(0, availableByProductLocation.get(`${sourceId}:${m2o(picking.location_dest_id)}`) || 0));
                transferQty = round(transferQty + qty); committedQty = round(committedQty + item.committed); doneQty = round(doneQty + item.done);
                remainingQty = round(remainingQty + sourceRemaining);
                availableQty = round(availableQty + sourceAvailable);
                actionableQty = round(actionableQty + Math.min(sourceRemaining, sourceAvailable));
                anyCommitted ||= item.committed > 0;
                if (item.done + 1e-6 < qty) allComplete = false;
            }
            const pickingStatus = !bySource.size ? "ineligible" : allComplete ? "complete" : anyCommitted ? "partial" : "unstarted";
            return { ...picking, eligibleCount: bySource.size, transferQty, committedQty, doneQty, remainingQty, availableQty, actionableQty, splitStatus: pickingStatus };
        });
    }

    async function loadRecentPickings(query = "", options = {}) {
        state.error = "";
        try {
            const domain = [["state", "=", "done"], ["picking_type_id.code", "=", "internal"]];
            if (query.trim()) domain.push(["name", "ilike", query.trim()]);
            const found = await searchRead("stock.picking", domain,
                ["name", "state", "picking_type_id", "location_id", "location_dest_id", "move_ids", "date_done"],
                { limit: query.trim() ? 40 : 80, order: "date_done desc,id desc" });
            const classified = await classifyPickings(found);
            state.allPickings = classified;
            applyPickingFilter();
            state.listQuery = query.trim(); state.listLoadedAt = Date.now();
            const latest = state.pickings[0];
            if (options.selectLatest && latest && Number(latest.id) !== Number(state.picking?.id)) return loadPicking(latest.id);
        } catch (error) {
            // Never treat missing manufacturing history as zero conversions.
            // Stale entries could allow a second conversion of the same stock.
            state.error = colorSplitError(error);
            state.allPickings = []; state.pickings = [];
            state.picking = null; state.groups = []; state.result = null;
        }
        render();
    }

    async function loadPicking(pickingId, options = {}) {
        state.busy = true; state.error = ""; state.result = null; render();
        try {
            const [picking] = await read("stock.picking", [Number(pickingId)], ["name", "state", "picking_type_id", "picking_type_code", "location_id", "location_dest_id", "move_ids", "date_done", "company_id"]);
            if (!picking || picking.state !== "done" || picking.picking_type_code !== "internal") throw new Error(tr("只能拆分已完成的内部调拨", "Solo se pueden convertir transferencias internas completadas"));
            const moves = await read("stock.move", picking.move_ids || [], ["product_id", "quantity", "state", "location_id", "location_dest_id", "product_uom"]);
            const productIds = [...new Set(moves.filter(move => move.state === "done" && num(move.quantity) > 0).map(move => m2o(move.product_id)).filter(Boolean))];
            const products = await read("product.product", productIds, ["display_name", "default_code", "barcode", "product_tmpl_id", "product_template_attribute_value_ids", "uom_id", "tracking", "is_storable", "active"]);
            const ptavIds = [...new Set(products.flatMap(product => product.product_template_attribute_value_ids || []))];
            const ptavs = await read("product.template.attribute.value", ptavIds, ["name", "attribute_id", "product_tmpl_id"]);
            const ptavById = new Map(ptavs.map(value => [Number(value.id), value]));
            const productById = new Map(products.map(product => [Number(product.id), product]));
            const sourceMoves = new Map();
            for (const move of moves) {
                const product = productById.get(m2o(move.product_id));
                if (!product?.is_storable) continue;
                const values = (product.product_template_attribute_value_ids || []).map(id => ptavById.get(Number(id))).filter(Boolean);
                if (!values.some(value => isDefaultColor(value.name))) continue;
                if (m2o(move.product_uom) !== m2o(product.uom_id) || (product.tracking && product.tracking !== 'none'))
                    throw new Error(tr('通用款涉及批次/序列号或计量单位不同，请在 Odoo 核对，本次未拆色', 'El producto requiere lotes/series o tiene otra unidad. Revise en Odoo; no se convirtió'));
                const current = sourceMoves.get(product.id) || { product, qty: 0, defaultAttributeIds: new Set() };
                current.qty = round(current.qty + num(move.quantity));
                for (const value of values) if (isDefaultColor(value.name)) current.defaultAttributeIds.add(m2o(value.attribute_id));
                sourceMoves.set(product.id, current);
            }
            if (!sourceMoves.size) throw new Error(tr("这张调拨没有可拆分的库存产品：必须是已完成数量且变体包含“通用款”", "Esta transferencia no contiene productos almacenables convertibles: deben estar completados y contener la variante predeterminada"));

            const sourceIds = [...sourceMoves.keys()];
            const templateIds = [...new Set([...sourceMoves.values()].map(item => m2o(item.product.product_tmpl_id)))];
            const variants = await searchRead("product.product", [["product_tmpl_id", "in", templateIds], ["active", "=", true]],
                ["display_name", "default_code", "barcode", "product_tmpl_id", "product_template_attribute_value_ids", "uom_id", "tracking", "is_storable"], { limit: 1000, order: "product_tmpl_id,id" });
            const allPtavIds = [...new Set(variants.flatMap(product => product.product_template_attribute_value_ids || []))];
            const allPtavs = await read("product.template.attribute.value", allPtavIds, ["name", "attribute_id", "product_tmpl_id"]);
            const allPtavById = new Map(allPtavs.map(value => [Number(value.id), value]));
            const quants = await searchRead("stock.quant", [["product_id", "in", sourceIds], ["location_id", "=", m2o(picking.location_dest_id)]],
                ["product_id", "quantity", "reserved_quantity", "available_quantity"], { limit: 500 });
            const availableByProduct = new Map(sourceIds.map(id => [id, 0]));
            for (const quant of quants) availableByProduct.set(m2o(quant.product_id), round((availableByProduct.get(m2o(quant.product_id)) || 0) + num(quant.available_quantity)));
            const legacyOriginPrefix = `PB拆色 ${picking.name} #`;
            const existing = await searchRead("mrp.production", ["&", ["state", "!=", "cancel"], "|",
                ["origin", "ilike", `${ORIGIN_PREFIX}:${picking.id}:`], ["origin", "ilike", legacyOriginPrefix]],
                ["name", "origin", "product_id", "product_qty", "state", "bom_id", "product_uom_id", "location_src_id", "location_dest_id"], { limit: 1000 });
            const priorBySource = new Map();
            for (const production of existing) {
                const origin = String(production.origin || "");
                const legacyMatch = origin.match(/#(\d+)>(\d+)$/);
                const sourceId = legacyMatch ? Number(legacyMatch[1]) : Number(origin.split(":")[2]);
                if (!sourceIds.includes(sourceId)) continue;
                const item = priorBySource.get(sourceId) || { committedTotal: 0, doneTotal: 0, byTarget: new Map(), doneByTarget: new Map(), productions: [] };
                item.committedTotal = round(item.committedTotal + num(production.product_qty));
                item.byTarget.set(m2o(production.product_id), round((item.byTarget.get(m2o(production.product_id)) || 0) + num(production.product_qty)));
                if (production.state === "done") {
                    item.doneTotal = round(item.doneTotal + num(production.product_qty));
                    item.doneByTarget.set(m2o(production.product_id), round((item.doneByTarget.get(m2o(production.product_id)) || 0) + num(production.product_qty)));
                }
                item.productions.push(production);
                priorBySource.set(sourceId, item);
            }

            const groups = [];
            for (const [sourceId, sourceMove] of sourceMoves) {
                const templateId = m2o(sourceMove.product.product_tmpl_id);
                const prior = priorBySource.get(sourceId) || { committedTotal: 0, doneTotal: 0, byTarget: new Map(), doneByTarget: new Map(), productions: [] };
                const sourceOtherPtavIds = (sourceMove.product.product_template_attribute_value_ids || []).filter(id => {
                    const value = ptavById.get(Number(id));
                    return value && !sourceMove.defaultAttributeIds.has(m2o(value.attribute_id));
                }).map(Number).sort((a, b) => a - b);
                const targets = variants.filter(product => {
                    if (!product.is_storable || m2o(product.product_tmpl_id) !== templateId || Number(product.id) === Number(sourceId)) return false;
                    const values = (product.product_template_attribute_value_ids || []).map(id => allPtavById.get(Number(id))).filter(Boolean);
                    const hasTargetColor = values.some(value => sourceMove.defaultAttributeIds.has(m2o(value.attribute_id)) && !isDefaultColor(value.name));
                    const otherPtavIds = values.filter(value => !sourceMove.defaultAttributeIds.has(m2o(value.attribute_id))).map(value => Number(value.id)).sort((a, b) => a - b);
                    return hasTargetColor && otherPtavIds.length === sourceOtherPtavIds.length && otherPtavIds.every((id, index) => id === sourceOtherPtavIds[index]);
                }).map(product => {
                    const values = (product.product_template_attribute_value_ids || []).map(id => allPtavById.get(Number(id))).filter(Boolean);
                    const color = values.find(value => sourceMove.defaultAttributeIds.has(m2o(value.attribute_id)) && !isDefaultColor(value.name));
                    return { ...product, color: color?.name || product.display_name, priorQty: prior.doneByTarget.get(Number(product.id)) || 0, committedQty: prior.byTarget.get(Number(product.id)) || 0, qty: 0 };
                });
                groups.push({
                    source: sourceMove.product,
                    transferQty: sourceMove.qty,
                    alreadyQty: prior.doneTotal,
                    committedQty: prior.committedTotal,
                    inProgressQty: round(Math.max(0, prior.committedTotal - prior.doneTotal)),
                    remainingQty: round(Math.max(0, sourceMove.qty - prior.committedTotal)),
                    splitStatus: splitStatus(sourceMove.qty, prior.committedTotal, prior.doneTotal),
                    available: availableByProduct.get(sourceId) || 0,
                    variants: targets,
                    productions: prior.productions,
                });
            }
            state.picking = picking; state.groups = groups; state.result = null;
        } catch (error) {
            state.error = colorSplitError(error); state.picking = null; state.groups = [];
        } finally {
            state.busy = Boolean(options.keepBusy); render();
        }
    }

    async function warehouseForLocation(locationId) {
        const [location] = await read("stock.location", [locationId], ["complete_name", "warehouse_id", "company_id"]);
        const warehouseId = m2o(location?.warehouse_id);
        if (!warehouseId) throw new Error(tr("目标库位不属于任何仓库，无法选择制造类型", "La ubicación de destino no pertenece a un almacén"));
        const [warehouse] = await read("stock.warehouse", [warehouseId], ["name", "lot_stock_id", "manu_type_id", "company_id"]);
        if (!m2o(warehouse?.manu_type_id)) throw new Error(tr("目标仓库没有制造操作类型", "El almacén de destino no tiene tipo de fabricación"));
        return warehouse;
    }

    async function ensureBom(source, target, companyId) {
        const boms = await searchRead("mrp.bom", [["product_id", "=", target.id], ["type", "=", "normal"], ["company_id", "in", [false, companyId]]],
            ["product_id", "product_tmpl_id", "product_qty", "product_uom_id", "bom_line_ids", "company_id", "code"], { limit: 50, order: "company_id desc,id" });
        for (const bom of boms) {
            const lines = await read("mrp.bom.line", bom.bom_line_ids || [], ["product_id", "product_qty", "product_uom_id"]);
            if (round(bom.product_qty) === 1 && lines.length === 1 && m2o(lines[0].product_id) === Number(source.id) && round(lines[0].product_qty) === 1 && m2o(bom.product_uom_id) === m2o(target.uom_id) && m2o(lines[0].product_uom_id) === m2o(source.uom_id)) return bom.id;
        }
        return create("mrp.bom", {
            code: `PB拆色 ${source.default_code || source.id}→${target.default_code || target.id}`,
            product_tmpl_id: m2o(target.product_tmpl_id), product_id: target.id,
            product_qty: 1, product_uom_id: m2o(target.uom_id), type: "normal", company_id: companyId,
            bom_line_ids: [[0, 0, { product_id: source.id, product_qty: 1, product_uom_id: m2o(source.uom_id) }]],
        });
    }

    async function finishProduction(productionId) {
        let [production] = await read("mrp.production", [productionId], ["state", "product_qty", "qty_producing", "name"]);
        if (production.state === "draft") await rpc("mrp.production", "action_confirm", [[productionId]]);
        production = (await read("mrp.production", [productionId], ["state", "product_qty", "qty_producing", "name"]))[0];
        if (production.state === "done") return production;
        await rpc("mrp.production", "write", [[productionId], { qty_producing: production.product_qty }]);
        const action = await rpc("mrp.production", "button_mark_done", [[productionId]]);
        if (action && action !== true) {
            const model = action.res_model || "";
            throw new Error(`${production.name}: ${tr("Odoo 要求额外确认，请在制造单中完成", "Odoo requiere confirmación adicional; complete la orden de fabricación")} (${model || "wizard"})`);
        }
        production = (await read("mrp.production", [productionId], ["state", "product_qty", "qty_producing", "name"]))[0];
        if (production.state !== "done") throw new Error(`${production.name}: ${tr("制造单未完成", "La orden de fabricación no terminó")} (${production.state})`);
        return production;
    }

    async function executePlan() {
        if (state.busy) return;
        const task = () => executePlanUnlocked();
        if (navigator.locks?.request && state.picking) return navigator.locks.request('pbful-color-split:' + state.picking.id, {mode:'exclusive'}, task);
        return task();
    }
    async function executePlanUnlocked() {
        if (state.busy) return;
        const problems = validatePlan();
        if (problems.length) { state.error = problems.join("\n"); render(); return; }
        if (state.groups.some(group => group.inProgressQty > 0 && group.variants.some(v => num(v.qty) > 0))) {
            state.error = tr('本产品有未完成制造单，请先继续原单', 'Este producto tiene fabricación pendiente; continúe la orden existente'); render(); return;
        }
        const originalPicking = state.picking;
        const planned = state.groups.flatMap(group => group.variants.filter(variant => num(variant.qty) > 0).map(variant => ({ group, variant, qty: num(variant.qty) })));
        const unsafeTarget = planned.find(item => m2o(item.variant.uom_id) !== m2o(item.group.source.uom_id) || (item.variant.tracking && item.variant.tracking !== 'none'));
        if (unsafeTarget) {state.error=tr('所选颜色涉及批次/序列号或计量单位不同，请在 Odoo 核对', 'La variante requiere lotes/series o tiene otra unidad; revise en Odoo');render();return;}
        const planStamp = JSON.stringify(state.groups.map(group => [group.source.id, group.transferQty, group.committedQty, group.available, group.variants.map(v => v.id)]));
        state.busy = true; state.error = ""; state.result = { items: [], status: "running" }; render();
        try {
            const pickingId = originalPicking.id;
            const [freshPicking] = await read("stock.picking", [pickingId], ["state", "location_dest_id", "company_id", "name"]);
            if (freshPicking.state !== "done") throw new Error(tr("调拨状态已经变化，请重新加载", "El estado de la transferencia cambió; vuelva a cargar"));
            const locationId = m2o(freshPicking.location_dest_id), companyId = m2o(freshPicking.company_id);
            const warehouse = await warehouseForLocation(locationId);
            // Re-read the transfer, committed manufacturing quantities and available stock before any mutation.
            await loadPicking(pickingId, {keepBusy:true});
            state.busy = true;
            if (!state.picking || state.picking.id !== pickingId) throw new Error(state.error || tr('调拨无法核对，未执行拆色', 'No se pudo verificar la transferencia'));
            const freshStamp = JSON.stringify(state.groups.map(group => [group.source.id, group.transferQty, group.committedQty, group.available, group.variants.map(v => v.id)]));
            if (freshStamp !== planStamp) throw new Error(tr('待拆数量、可用库存或颜色列表已经变化，请重新填写；本次未创建制造单', 'Cambió la cantidad pendiente, el stock o los colores. Capture el plan de nuevo; no se creó una orden'));
            state.result = {items:[], status:'running'};
            for (const item of planned) {
                const originBase = originFor(pickingId, item.group.source.id, item.variant.id);
                const existing = await searchRead("mrp.production", ["&", ["state", "!=", "cancel"], "|",
                    ["origin", "=", originBase], ["origin", "=like", `${originBase}:%`]],
                    ["name", "origin", "state", "product_id", "product_qty", "bom_id"], { limit: 100, order: "id" });
                const resumable = existing.filter(production => production.state !== "done");
                let productionId;
                if (resumable.length) {
                    if (resumable.length > 1 || round(resumable[0].product_qty) !== round(item.qty)) throw new Error(`${originBase}: ${tr("存在冲突的制造单", "Existe una orden de fabricación en conflicto")}`);
                    productionId = resumable[0].id;
                } else {
                    const origin = existing.length ? `${originBase}:${existing.length + 1}` : originBase;
                    const bomId = await ensureBom(item.group.source, item.variant, companyId);
                    productionId = await create("mrp.production", {
                        product_id: item.variant.id, product_qty: item.qty, product_uom_id: m2o(item.variant.uom_id), bom_id: bomId,
                        picking_type_id: m2o(warehouse.manu_type_id), location_src_id: locationId, location_dest_id: locationId,
                        company_id: companyId, origin,
                    });
                }
                const production = await finishProduction(productionId);
                state.result.items.push({ id: productionId, name: production.name, target: item.variant, qty: item.qty, source: item.group.source });
                render();
            }
            state.result.status = "done";
            await loadPicking(pickingId);
            state.result = { status: "done", items: planned.map(item => ({ target: item.variant, qty: item.qty, source: item.group.source })) };
            await loadRecentPickings(state.listQuery);
        } catch (error) {
            state.error = colorSplitError(error);
            if (state.result) state.result.status = "error";
        } finally {
            state.busy = false; render();
        }
    }

    async function resumeProduction(productionId) {
        if (state.busy || !state.picking) return;
        const pickingId = Number(state.picking.id);
        const task = async () => {
            if (state.busy || Number(state.picking?.id) !== pickingId) return;
            state.busy = true; state.error = ''; render();
            let completed = null;
            try {
                await loadPicking(pickingId, {keepBusy:true});
                if (!state.picking) throw new Error(state.error || tr('无法核对调拨', 'No se pudo verificar la transferencia'));
                const group = state.groups.find(g => g.productions.some(p => Number(p.id) === Number(productionId)));
                const production = group?.productions.find(p => Number(p.id) === Number(productionId));
                if (!production) throw new Error(tr('制造单关联已变化，请在 Odoo 核对；本次没有创建新单', 'Cambió el vínculo de fabricación. Revise en Odoo; no se creó otra orden'));
                if (production.state === 'done') return;
                const target = group.variants.find(v => Number(v.id) === m2o(production.product_id));
                if (!target || m2o(production.location_src_id) !== m2o(state.picking.location_dest_id) ||
                    m2o(production.location_dest_id) !== m2o(state.picking.location_dest_id))
                    throw new Error(tr('制造单的颜色或库位已变化，请在 Odoo 核对', 'Cambió el color o la ubicación; revise la orden en Odoo'));
                await verifyResumeBom(group.source, target, production);
                const result = await finishProduction(productionId);
                completed = {id:productionId, name:result.name, target, qty:num(production.product_qty), source:group.source};
            } catch (error) {
                state.error = colorSplitError(error);
            } finally {
                const errorMessage = state.error;
                await loadPicking(pickingId, {keepBusy:true});
                state.error = errorMessage || state.error;
                if (completed) state.result = {status:'done', items:[completed]};
                state.busy = false; render();
            }
        };
        if (navigator.locks?.request) return navigator.locks.request('pbful-color-split:' + pickingId, {mode:'exclusive'}, task);
        return task();
    }

    async function verifyResumeBom(source, target, production) {
        const [bom] = await read('mrp.bom', [m2o(production.bom_id)], ['product_qty','product_uom_id','bom_line_ids']);
        const lines = bom ? await read('mrp.bom.line', bom.bom_line_ids || [], ['product_id','product_qty','product_uom_id']) : [];
        if (!bom || lines.length !== 1 || round(bom.product_qty) !== 1 || round(lines[0].product_qty) !== 1 ||
            m2o(lines[0].product_id) !== Number(source.id) || m2o(bom.product_uom_id) !== m2o(target.uom_id) ||
            m2o(lines[0].product_uom_id) !== m2o(source.uom_id) || m2o(production.product_uom_id) !== m2o(target.uom_id) ||
            m2o(source.uom_id) !== m2o(target.uom_id) || (source.tracking && source.tracking !== 'none') || (target.tracking && target.tracking !== 'none'))
            throw new Error(tr('原制造单的配方、单位或追踪方式需要人工核对，请在 Odoo 处理；未创建新单', 'Revise la receta, unidad o trazabilidad de la orden en Odoo; no se creó otra orden'));
    }

    function pendingProductionsMarkup(group) {
        const pending = (group.productions || []).filter(p => !['done','cancel'].includes(p.state));
        if (!pending.length) return '';
        return `<div class="notice">${tr('未完成制造单：先继续原单，再新增拆色', 'Fabricación pendiente: continúe la orden antes de crear otra')}<br>${pending.map(p => `<span>${esc(p.name)} · ${esc(p.product_id?.[1] || String(m2o(p.product_id)))} · ${num(p.product_qty)} <button data-resume-production="${p.id}" ${state.busy ? 'disabled' : ''}>${tr('继续完成', 'Continuar')}</button></span>`).join('<br>')}</div>`;
    }

    function printLabels() {
        const items = state.result?.items || [];
        if (!items.length) return;
        const labels = items.flatMap(item => Array.from({ length: Math.max(1, Math.floor(num(item.qty))) }, () => {
            const code = item.target.barcode || item.target.default_code || String(item.target.id);
            return `<article><strong>${esc(item.target.default_code || "")}</strong><span>${esc(item.target.color || item.target.display_name)}</span><img src="/report/barcode/Code128/${encodeURIComponent(code)}?width=520&height=120&humanreadable=1"><small>${esc(item.target.display_name)}</small></article>`;
        })).join("");
        const popup = window.open("", "pb-color-labels", "width=980,height=760");
        if (!popup) throw new Error(tr("浏览器阻止了标签窗口", "El navegador bloqueó la ventana de etiquetas"));
        popup.document.write(`<!doctype html><meta charset="utf-8"><title>${tr("颜色标签", "Etiquetas de color")}</title><style>@page{size:auto;margin:6mm}body{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm;font-family:Arial,sans-serif}article{break-inside:avoid;border:1px solid #999;padding:4mm;text-align:center;display:grid;gap:2mm}strong{font-size:18px}span{font-weight:700}img{width:100%;height:48px;object-fit:contain}small{font-size:9px}</style>${labels}<script>onload=()=>print()<\/script>`);
        popup.document.close();
    }

    let host, root, mountNode;
    function ensureUi(container) {
        if (!container) return false;
        if (host?.isConnected && mountNode === container) return true;
        host?.remove();
        host = document.createElement("div"); host.id = "pb-color-split-host"; container.replaceChildren(host); mountNode = container;
        root = host.attachShadow({ mode: "open" });
        root.innerHTML = `<style>
          :host{all:initial;display:block;height:100%;min-height:0;font-family:"Inter",system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#0f172a}
          *{box-sizing:border-box}button,select,input{font:inherit}
          button{min-height:38px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#1e293b;padding:7px 13px;font-weight:700;cursor:pointer;transition:background .15s ease,border-color .15s ease}
          button:hover:not(:disabled){border-color:#94a3b8;background:#f8fafc}
          button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid rgba(37,99,235,.24);outline-offset:1px;border-color:#2563eb}
          button.primary{background:#086be8;border-color:#086be8;color:#fff;font-weight:800}
          button.primary:hover:not(:disabled){background:#0656c2;border-color:#0656c2}
          button:disabled{opacity:.48;cursor:not-allowed}
          .workspace{height:100%;min-height:0;min-width:0;background:#f8fafc;display:flex;flex-direction:column;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}
          .picker{flex:0 0 auto;border-bottom:1px solid #e2e8f0;background:#ffffff}
          .picker-tools{display:grid;grid-template-columns:minmax(155px,.6fr) minmax(145px,.55fr) minmax(280px,1.35fr) auto auto;gap:9px;padding:12px 14px 9px}
          .picker input,.picker select{width:100%;min-width:0;height:38px;border:1px solid #cbd5e1;border-radius:8px;background:#ffffff;color:#0f172a;padding:7px 11px;font-weight:600}
          .picker input:focus,.picker select:focus{border-color:#2563eb}
          .latest-btn{border-color:#93c5fd;background:#eff6ff;color:#1d4ed8;font-weight:800}
          .latest-btn:hover:not(:disabled){border-color:#60a5fa;background:#dbeafe}
          .recent{display:flex;align-items:center;gap:6px;min-width:0;overflow-x:auto;padding:0 14px 9px;scrollbar-width:thin}
          .recent-label{display:flex;align-items:center;flex:0 0 auto;color:#64748b;font-size:11.5px;font-weight:800;margin-right:2px}
          .recent button{display:flex;align-items:center;gap:6px;flex:0 0 auto;min-height:32px;padding:4px 10px;border-radius:999px;text-align:left;background:#f8fafc;border-color:#e2e8f0}
          .recent button.current{border-color:#2563eb;background:#eff6ff;color:#1e3a8a}
          .recent button b{font-size:11.5px;font-weight:800}
          .recent button small{color:#64748b;font-size:10px;font-variant-numeric:tabular-nums}
          .newest,.status-pill{border-radius:999px;padding:2px 7px;font-size:9.5px;font-weight:800;letter-spacing:.2px}
          .newest{background:#d1fae5;color:#065f46}
          .status-unstarted{background:#f1f5f9;color:#475569}
          .status-partial{background:#fef3c7;color:#92400e}
          .status-complete{background:#d1fae5;color:#065f46}
          .status-ineligible{background:#f1f5f9;color:#94a3b8}
          .current{display:none}
          .product-nav{display:flex;align-items:center;gap:6px;flex:0 0 auto;min-width:0;overflow-x:auto;padding:7px 14px;border-bottom:1px solid #e2e8f0;background:#f8fafc;scrollbar-width:thin}
          .product-nav:empty{display:none}
          .product-nav button{display:flex;align-items:center;gap:7px;min-width:0;min-height:34px;padding:5px 10px;border-radius:8px;text-align:left}
          .product-nav button b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;font-weight:800}
          .product-nav button span{display:none}
          .product-nav button em{border-radius:999px;background:#f1f5f9;padding:2px 8px;color:#334155;font-size:10px;font-style:normal;font-weight:700;font-variant-numeric:tabular-nums}
          .product-nav button.complete em{background:#d1fae5;color:#065f46}
          .product-nav button.incomplete em{background:#ffe4e6;color:#be123c}
          main{flex:1 1 auto;min-height:0;min-width:0;overflow:auto;padding:12px 14px 16px;overscroll-behavior:contain;scrollbar-gutter:stable}
          .empty{display:grid;place-items:center;min-height:220px;padding:32px;text-align:center;color:#64748b;background:#fff;border:1px dashed #cbd5e1;border-radius:12px;font-size:14px}
          .notice{white-space:pre-wrap;border-radius:10px;padding:10px 14px;margin-bottom:10px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-weight:600;font-size:13.5px}
          .notice.error{background:#fef2f2;border-color:#fecaca;color:#b91c1c}
          .success{background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46}
          .group{scroll-margin-top:10px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:12px;overflow:hidden;background:#fff}
          .group:last-child{margin-bottom:0}
          .group-head{display:grid;grid-template-columns:minmax(220px,1fr) repeat(4,minmax(68px,auto));gap:12px;align-items:center;padding:11px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
          .group-title{min-width:0}
          .group-title strong{display:flex;align-items:center;gap:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14.5px;font-weight:800;color:#0f172a}
          .group-title small{display:block;margin-top:2px;color:#64748b;font-size:12px}
          .metric{font-size:10.5px;font-weight:700;color:#64748b;background:#fff;padding:5px 9px;border-radius:8px;border:1px solid #e2e8f0;text-align:center}
          .metric b{display:block;font-size:15.5px;font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums;margin-top:1px}
          .variants{width:100%;border-collapse:collapse;table-layout:fixed}
          .variants th,.variants td{padding:9px 12px;border-top:1px solid #f1f5f9;text-align:left;vertical-align:middle}
          .variants tbody tr:hover td{background:#f8fafc}
          .variants th{background:#ffffff;color:#64748b;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.3px;border-top:none;border-bottom:1px solid #e2e8f0}
          .variants th:nth-child(1){width:40%}.variants th:nth-child(2){width:13%}.variants th:nth-child(3){width:20%}.variants th:nth-child(4){width:11%}.variants th:nth-child(5){width:16%}
          .variants td:last-child,.variants th:last-child{text-align:right}
          .variant-name strong{display:block;font-size:13.5px;color:#0f172a}
          .variant-name small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;font-size:11px;margin-top:1px}
          .variants input{width:100%;max-width:108px;height:38px;border:1.5px solid #cbd5e1;border-radius:8px;padding:6px 10px;text-align:right;font-weight:800;font-size:15px;font-variant-numeric:tabular-nums;background:#ffffff;color:#0f172a}
          .variants input:focus{border-color:#2563eb}
          .done{color:#059669;font-weight:800;background:#ecfdf5;padding:2px 7px;border-radius:6px}
          .missing{color:#b45309;font-weight:700}
          .missing small{display:inline-block;margin-left:5px;border-radius:5px;background:#fef3c7;color:#92400e;padding:1px 5px;font-size:9.5px;font-weight:800}
          footer{display:flex;align-items:center;gap:12px;flex:0 0 auto;min-height:60px;padding:10px 14px;border-top:1px solid #e2e8f0;background:#fff}
          .totals{display:grid;flex:1;gap:2px;color:#475569}
          .totals strong{font-size:14.5px;font-weight:800;font-variant-numeric:tabular-nums}
          .totals small{color:#64748b;font-size:11.5px}
          .totals.bad strong{color:#e11d48}
          .totals.good strong{color:#059669}
          footer .primary{min-width:156px;min-height:42px;font-size:14px}
          @media(max-width:920px){.picker-tools{grid-template-columns:minmax(150px,.7fr) minmax(140px,.6fr) minmax(230px,1.2fr) auto auto}.group-head{grid-template-columns:minmax(180px,1fr) repeat(2,minmax(58px,auto))}.group-head .metric:nth-last-child(-n+2){display:none}.variants th:nth-child(3),.variants td:nth-child(3){display:none}.variants th:nth-child(1){width:48%}.variants th:nth-child(2){width:18%}.variants th:nth-child(4){width:14%}.variants th:nth-child(5){width:20%}}
          @media(max-width:680px){.workspace{border:0;border-radius:0}.picker-tools{grid-template-columns:1fr 1fr auto auto}.picker-tools [data-picking]{grid-column:1/-1;grid-row:2}.recent{padding-inline:8px}.recent button small{display:none}.product-nav{padding-inline:8px}.group-head{grid-template-columns:1fr repeat(2,auto);gap:8px}.variants{min-width:570px}.variants-wrap{overflow-x:auto}main{padding:8px}.variants th:nth-child(3),.variants td:nth-child(3){display:table-cell}footer{padding:8px}footer .primary{min-width:130px}}
        </style><section class="workspace"><section class="picker"></section><section class="current"></section><nav class="product-nav" aria-label="${tr("本单产品", "Productos de esta transferencia")}"></nav><main></main><footer></footer></section>`;
        root.addEventListener("click", onClick);
        root.addEventListener("input", onInput);
        root.addEventListener("keydown", onKeydown);
        render();
        return true;
    }

    function pickingOptions() {
        return `<option value="">${tr("选择调拨", "Seleccione una transferencia")}</option>${state.pickings.map((picking, index) => `<option value="${picking.id}" ${state.picking?.id === picking.id ? "selected" : ""}>${index === 0 && !state.listQuery ? `${tr("最新", "Última")} · ` : ""}${statusLabel(picking.splitStatus)} · ${esc(picking.name)} · ${picking.doneQty}/${picking.transferQty}</option>`).join("")}`;
    }

    function filterOptions() {
        return ["actionable", "unstarted", "partial", "complete", "all"].map(filter => `<option value="${filter}" ${state.pickingFilter === filter ? "selected" : ""}>${filterLabel(filter)}</option>`).join("");
    }

    function recentPickings() {
        if (!state.pickings.length) return `<span class="recent-label">${tr("没有找到已完成调拨", "No se encontraron transferencias completadas")}</span>`;
        const items = state.pickings.slice(0, 5).map((picking, index) => `<button type="button" data-recent="${picking.id}" class="${Number(state.picking?.id) === Number(picking.id) ? "current" : ""}" aria-pressed="${Number(state.picking?.id) === Number(picking.id)}" title="${esc(picking.location_dest_id?.[1] || "")}"><b>${esc(picking.name)}</b><span class="status-pill status-${picking.splitStatus}">${statusLabel(picking.splitStatus)}</span>${index === 0 && !state.listQuery ? `<span class="newest">${tr("最新", "ÚLTIMA")}</span>` : ""}<small>${picking.doneQty}/${picking.transferQty}</small></button>`).join("");
        return `<span class="recent-label">${state.listQuery ? tr("搜索结果", "Resultados") : filterLabel(state.pickingFilter)}</span>${items}`;
    }

    function currentPicking() {
        if (!state.picking) return `<span class="current-empty">${state.busy ? tr("正在读取最新调拨…", "Cargando la transferencia más reciente…") : tr("选择调拨后开始分配颜色", "Seleccione una transferencia para asignar colores")}</span>`;
        const isLatest = !state.listQuery && Number(state.pickings[0]?.id) === Number(state.picking.id);
        return `<strong>${esc(state.picking.name)}</strong><span>${esc(state.picking.location_dest_id?.[1] || "")}</span><span>${esc(String(state.picking.date_done || "").slice(0,16))}</span>${isLatest ? `<span class="latest-mark">${tr("当前最新调拨", "Transferencia más reciente")}</span>` : ""}`;
    }

    function productNavigation() {
        if (state.groups.length < 2) return "";
        return state.groups.map(group => {
            const entered = round(group.variants.reduce((sum, variant) => sum + num(variant.qty), 0));
            return `<button type="button" data-jump-source="${group.source.id}" class="${group.splitStatus === "complete" ? "complete" : "incomplete"}" title="${esc(group.source.display_name)}"><b>${esc(productLabel(group.source))}</b><span>${esc(group.source.display_name)}</span><span class="status-pill status-${group.splitStatus}">${statusLabel(group.splitStatus)}</span><em>${tr("本次", "Ahora")} ${entered} · ${tr("待拆", "Pend.")} ${group.remainingQty}</em></button>`;
        }).join("");
    }

    function renderGroup(group) {
        const entered = round(group.variants.reduce((sum, variant) => sum + num(variant.qty), 0));
        const inProgress = group.inProgressQty > 0 ? ` · ${tr("处理中", "En proceso")} ${group.inProgressQty}` : "";
        return `<section class="group" id="pbcs-group-${group.source.id}" data-source="${group.source.id}"><div class="group-head"><div class="group-title"><strong><span>${esc(group.source.display_name)}</span><span class="status-pill status-${group.splitStatus}">${statusLabel(group.splitStatus)}</span></strong><small>${group.source.default_code ? `${esc(group.source.default_code)} · ` : ""}${tr("通用款", "Presentación general")} · ${tr("本次输入", "Esta vez")} <span data-group-entered>${entered}</span>${inProgress}</small>${pendingProductionsMarkup(group)}</div><span class="metric">${tr("本单到货", "Recibido")}<b>${group.transferQty}</b></span><span class="metric">${tr("已拆", "Convertido")}<b>${group.alreadyQty}</b></span><span class="metric">${tr("待拆", "Pendiente")}<b>${group.remainingQty}</b></span><span class="metric">${tr("可用", "Disponible")}<b>${group.available}</b></span></div><div class="variants-wrap"><table class="variants"><thead><tr><th>${tr("颜色变体", "Variante de color")}</th><th>${tr("内部参考", "Referencia")}</th><th>${tr("标签条码", "Código de etiqueta")}</th><th>${tr("此前已拆", "Ya convertido")}</th><th>${tr("本次数量", "Cantidad")}</th></tr></thead><tbody>${group.variants.map(variant => `<tr><td class="variant-name"><strong>${esc(variant.color)}</strong><small>${esc(variant.display_name)}</small></td><td>${esc(variant.default_code || "—")}</td><td class="${variant.barcode ? "" : "missing"}">${esc(variant.barcode || variant.default_code || tr("缺失", "Falta"))}${variant.barcode ? "" : `<small>${tr("缺条码", "Sin código")}</small>`}</td><td>${variant.priorQty ? `<span class="done">${variant.priorQty}</span>` : "—"}</td><td><input aria-label="${esc(variant.color)} ${tr("本次数量", "Cantidad")}" type="number" min="0" step="1" inputmode="numeric" data-qty="${variant.id}" data-source="${group.source.id}" value="${variant.qty || ""}" ${group.remainingQty <= 0 || group.inProgressQty > 0 || state.busy ? "disabled" : ""}></td></tr>`).join("")}</tbody></table></div></section>`;
    }

    function render() {
        if (!root) return;
        const picker = root.querySelector(".picker"), current = root.querySelector(".current"), productNav = root.querySelector(".product-nav"), main = root.querySelector("main"), footer = root.querySelector("footer");
        if (!picker || !current || !productNav || !main || !footer) return;
        picker.innerHTML = `<div class="picker-tools"><input aria-label="${tr("搜索调拨号", "Buscar transferencia")}" data-search value="${esc(state.listQuery)}" placeholder="${tr("搜索调拨号", "Número de transferencia")}"><select aria-label="${tr("拆色状态", "Estado de separación")}" data-filter>${filterOptions()}</select><select aria-label="${tr("已完成内部调拨", "Transferencias internas completadas")}" data-picking>${pickingOptions()}</select><button data-search-btn ${state.busy ? "disabled" : ""}>${tr("搜索", "Buscar")}</button><button class="latest-btn" data-latest ${state.busy ? "disabled" : ""}>${tr("加载最新", "Cargar última")}</button></div><div class="recent">${recentPickings()}</div>`;
        current.innerHTML = currentPicking();
        productNav.innerHTML = productNavigation();
        const error = state.error ? `<div class="notice error">${esc(state.error)}</div>` : "";
        const success = state.result?.status === "done" ? `<div class="notice success">${tr("本次拆色已完成；剩余数量已保留，可以稍后继续。", "Esta conversión terminó; la cantidad restante queda guardada para continuar después.")}</div>` : "";
        if (state.busy && !state.picking) main.innerHTML = `<div class="empty">${tr("正在读取调拨与变体…", "Cargando transferencia y variantes…")}</div>`;
        else if (!state.picking) main.innerHTML = `${error}<div class="empty">${tr("选择一张已经到达收货仓的内部调拨。系统只显示其中的“通用款”变体。", "Seleccione una transferencia interna ya recibida. Solo se mostrarán variantes de color predeterminado.")}</div>`;
        else main.innerHTML = `${error}${success}${state.groups.map(renderGroup).join("")}`;
        renderFooter();
    }

    function renderFooter() {
        const footer = root?.querySelector("footer"); if (!footer) return;
        const totals = groupTotals(), valid = state.picking && !validatePlan().length;
        const entered = round(totals.reduce((sum, total) => sum + total.entered, 0));
        const required = round(totals.reduce((sum, total) => sum + total.required, 0));
        const touchedGroups = totals.filter(total => total.entered > 0).length;
        const status = !state.picking ? tr("尚未选择调拨", "Sin transferencia") : required === 0 ? tr("本单已全部拆色", "Conversión ya completada") : `${tr("本次拆色", "Esta vez")} ${entered} · ${tr("原待拆", "Pendiente inicial")} ${required} · ${touchedGroups} ${tr("款有输入", "productos con cantidad")}`;
        const hint = !state.picking ? tr("请选择调拨", "Seleccione una transferencia") : valid ? tr("可先确认本次数量，剩余部分稍后继续", "Puede confirmar ahora y continuar con el resto después") : tr("至少输入一件，且不能超过待拆数量和可用库存", "Ingrese al menos una unidad sin superar lo pendiente ni el stock disponible");
        footer.innerHTML = `<span class="totals ${valid ? "good" : "bad"}"><strong>${status}</strong><small>${hint}</small></span>${state.result?.status === "done" ? `<button data-print>${tr("打印颜色标签", "Imprimir etiquetas")}</button>` : ""}<button class="primary" data-execute ${!valid || state.busy ? "disabled" : ""}>${state.busy ? tr("正在转换…", "Convirtiendo…") : tr("确认本次拆色", "Confirmar esta conversión")}</button>`;
    }

    async function onClick(event) {
        const button = event.target.closest("button"); if (!button || button.disabled || state.busy) return;
        try {
            if (button.hasAttribute("data-latest")) await loadRecentPickings("", { selectLatest: true });
            else if (button.hasAttribute("data-search-btn")) {
                const query = root.querySelector("[data-search]")?.value || ""; await loadRecentPickings(query);
                if (state.pickings.length === 1) await loadPicking(state.pickings[0].id);
            } else if (button.hasAttribute("data-recent")) await loadPicking(Number(button.dataset.recent));
            else if (button.hasAttribute("data-jump-source")) root.getElementById(`pbcs-group-${button.dataset.jumpSource}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
            else if (button.hasAttribute("data-resume-production")) await resumeProduction(Number(button.dataset.resumeProduction));
            else if (button.hasAttribute("data-execute")) await executePlan();
            else if (button.hasAttribute("data-print")) printLabels();
        } catch (error) { state.error = colorSplitError(error); state.busy = false; render(); }
    }

    function onInput(event) {
        if (state.busy) return;
        if (event.target.matches("[data-filter]")) {
            state.pickingFilter = event.target.value;
            applyPickingFilter();
            render();
            return;
        }
        if (event.target.matches("[data-picking]")) { const id = Number(event.target.value); if (id) loadPicking(id); return; }
        if (event.target.matches("[data-qty]")) {
            const group = state.groups.find(item => Number(item.source.id) === Number(event.target.dataset.source));
            const variant = group?.variants.find(item => Number(item.id) === Number(event.target.dataset.qty));
            if (variant) variant.qty = event.target.value === "" ? 0 : num(event.target.value);
            const entered = round(group?.variants.reduce((sum, item) => sum + num(item.qty), 0) || 0);
            const enteredNode = root.getElementById(`pbcs-group-${group?.source.id}`)?.querySelector("[data-group-entered]");
            if (enteredNode) enteredNode.textContent = `${entered}`;
            const productNav = root.querySelector(".product-nav"); if (productNav) productNav.innerHTML = productNavigation();
            renderFooter();
        }
    }

    function onKeydown(event) {
        if (!event.target.matches("[data-search]") || event.key !== "Enter") return;
        event.preventDefault();
        root.querySelector("[data-search-btn]")?.click();
    }

    function refreshLanguage() {
        state.lang = PBUI.get() === "es-MX" ? "es" : "zh";
        if (!root || !host?.isConnected) return;
        const live = root;
        const preview = document.createElement("div");
        preview.innerHTML = live.innerHTML;
        try { root = preview; render(); } finally { root = live; }
        // Only text and accessibility labels change. Raw input values, focus,
        // selection, disabled controls and scroll positions remain untouched.
        for (const selector of [".picker", ".current", ".product-nav", "main", "footer"]) {
            pbUpdateTextInPlace(live.querySelector(selector), preview.querySelector(selector));
        }
        live.querySelector(".product-nav")?.setAttribute("aria-label", tr("本单产品", "Productos de esta transferencia"));
    }
    PBUI.subscribe(refreshLanguage);
    async function mountTo(container, options = {}) {
        state.lang = PBUI.get() === "es-MX" ? "es" : "zh";
        state.open = true;
        if (host?.isConnected && mountNode === container) { refreshLanguage(); return host; }
        ensureUi(container);
        render();
        if (!state.pickings.length && !state.busy) await loadRecentPickings("", { selectLatest: !state.picking });
        else if (!state.busy && Date.now() - state.listLoadedAt > 60000) await loadRecentPickings();
        return host;
    }

    window.PBColorSplit = { version: VERSION, mountTo, unmount: () => { host?.remove(); host = root = mountNode = null; }, state, loadRecentPickings, loadPicking, validatePlan, originFor, splitStatus, applyPickingFilter };
    window.dispatchEvent(new Event("pb-suite:color-ready:v1"));
})();
})();

})();

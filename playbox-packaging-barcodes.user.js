// ==UserScript==
// @name         Playbox Odoo - 包装条码与单位
// @namespace    https://playboxelectronics1.odoo.com/playbox-suite
// @version      1.0.20
// @description  包装条码与单位；修复启动连接与恢复提示重复读取，保留原数量和扫码保护。
// @author       Playbox
// @run-at       document-start
// @match        https://*.odoo.com/pos/ui*
// @grant        GM_deleteValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      docs.google.com
// ==/UserScript==

(function () {
'use strict';

if (location.protocol !== "https:" || !/(^|\.)odoo\.com$/i.test(location.hostname)) return;

if (!/^\/pos\/ui(?:\/|$)/.test(location.pathname)) return;

if (document.documentElement?.hasAttribute("data-pb-suite-packaging")) return;
document.documentElement?.setAttribute("data-pb-suite-packaging","1.0.20");

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


const PBMigration = (function(){const module={exports:{}};
/* Playbox 配置迁移：纯数据与存储接口；不访问 Odoo，不搬运业务队列。 */
(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.PBConfigMigration = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
    "use strict";
    const schema = 1;
    const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
    function clone(value) {
        if (value === undefined) return undefined;
        return JSON.parse(JSON.stringify(value));
    }
    function decode(value) {
        if (typeof value !== "string" || !value.length) throw new Error("无效的 Tampermonkey 导出值");
        const tag = value[0], payload = value.slice(1);
        if (tag === "s") return payload;
        if (tag === "b" && (payload === "true" || payload === "false")) return payload === "true";
        if (tag === "n" && payload.trim() && Number.isFinite(Number(payload))) return Number(payload);
        if (tag === "o") return JSON.parse(payload);
        throw new Error("不支持的 Tampermonkey 值类型：" + tag);
    }
    function language(value) {
        if (value === "zh" || value === "zh-CN") return "zh-CN";
        if (value === "es" || value === "es-MX") return "es-MX";
        return null;
    }
    function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
    function preferenceKey(component, key) {
        if (!/^[a-z][a-z0-9-]*$/.test(component) || typeof key !== "string") throw new Error("无效配置键");
        return "pb-suite:preference:v1:" + component + ":" + key;
    }
    function buildPlan(component, exported, allowedKeys) {
        if (!exported || typeof exported !== "object" || Array.isArray(exported)) throw new Error("配置必须为对象");
        if (!Array.isArray(allowedKeys)) throw new Error("缺少明确迁移范围");
        const changes = [];
        for (const key of allowedKeys) {
            if (key === "enable_F4") continue; // 新规则：旧报价开关不能影响打印。
            if (!own(exported, key)) continue;
            // 仅显式配置。业务队列、操作身份及订单缓存不得作为安装默认数据。
            if (/offline|outbox|pending|operation|order[_:-]|remote_cache/i.test(key)) {
                throw new Error("拒绝将业务状态或缓存作为通用配置迁移：" + key);
            }
            changes.push({ key: preferenceKey(component, key), value: decode(exported[key]) });
        }
        return { schema, component, changes };
    }
    function validate(plan) {
        if (!plan || plan.schema !== schema || !Array.isArray(plan.changes) || !/^[a-z][a-z0-9-]*$/.test(plan.component)) {
            throw new Error("不支持的配置迁移结构");
        }
        const keys = new Set();
        for (const entry of plan.changes) {
            if (!entry || typeof entry.key !== "string" ||
                !entry.key.startsWith("pb-suite:preference:v1:" + plan.component + ":") || keys.has(entry.key)) {
                throw new Error("配置迁移包含重复或越界的键");
            }
            keys.add(entry.key);
        }
    }
    function migrate(store, plan, options = {}) {
        validate(plan);
        const markerKey = "pb-suite:migration:v1:" + plan.component;
        const prior = store.get(markerKey);
        if (prior?.schema === schema && prior.status === "complete") return { applied: false, journal: clone(prior) };
        // A rollback is an explicit user decision. Keep it across reloads until
        // the user chooses the separate re-import action.
        if (prior?.schema === schema && prior.status === "rolled-back" && options.explicit !== true) {
            return { applied: false, rolledBack: true, journal: clone(prior) };
        }
        if (prior && prior.status !== "rolled-back") throw new Error("上次配置迁移未完成；请先恢复迁移记录");
        const journal = { schema, component: plan.component, status: "pending", entries: [] };
        for (const change of plan.changes) {
            const existing = store.get(change.key);
            // 新版中已经设置的偏好不被旧导出反复覆盖。
            if (existing !== undefined) continue;
            journal.entries.push({ key: change.key, existed: false, next: clone(change.value) });
        }
        store.set(markerKey, clone(journal));
        if (!same(store.get(markerKey), journal)) throw new Error("无法回读配置迁移记录");
        try {
            for (const entry of journal.entries) {
                store.set(entry.key, clone(entry.next));
                if (!same(store.get(entry.key), entry.next)) throw new Error("配置保存后回读不一致：" + entry.key);
            }
            journal.status = "complete";
            store.set(markerKey, clone(journal));
            if (!same(store.get(markerKey), journal)) throw new Error("无法确认配置迁移完成");
            return { applied: true, journal };
        } catch (cause) {
            // 不抹去未完成记录。恢复功能可据此逐键处理；旧脚本数据从未改动。
            const error = new Error("配置迁移未完成，原始导出仍保留。请恢复后重试。");
            error.cause = cause;
            throw error;
        }
    }
    function reimport(store, plan) {
        return migrate(store, plan, { explicit: true });
    }
    function rollback(store, component) {
        if (!/^[a-z][a-z0-9-]*$/.test(component)) throw new Error("无效模块");
        const markerKey = "pb-suite:migration:v1:" + component;
        const journal = store.get(markerKey);
        if (!journal) return { restored: 0 };
        validate({ schema: journal.schema, component, changes: journal.entries?.map(x => ({ key: x.key })) });
        if (journal.status === "rolled-back") return { restored: 0 };
        // 先检查所有冲突，不能在用户已修改某些偏好时部分回退。
        for (const entry of journal.entries) {
            const current = store.get(entry.key);
            if (current !== undefined && !same(current, entry.next)) throw new Error("迁移后配置已变化，请导出后手工处理：" + entry.key);
        }
        let restored = 0;
        for (const entry of journal.entries) {
            if (!entry.existed) store.delete(entry.key);
            else store.set(entry.key, clone(entry.previous));
            if (store.get(entry.key) !== undefined && !entry.existed) throw new Error("回退未完成：" + entry.key);
            restored++;
        }
        journal.status = "rolled-back";
        store.set(markerKey, clone(journal));
        if (!same(store.get(markerKey), journal)) throw new Error("无法确认回退记录");
        return { restored };
    }
    return Object.freeze({ schema, decode, language, preferenceKey, buildPlan, migrate, reimport, rollback });
});

return module.exports;})();

function createSuitePreferences(api, plan, migration, registerMenu, notify) {
    const store = {get:key=>api.get(key,undefined),set:(key,value)=>api.set(key,value),delete:key=>api.delete(key)};
    const target = key => migration.preferenceKey(plan.component,key);
    registerMenu?.("回退本次配置迁移 / Revertir migración", () => {
        try {
            migration.rollback(store,plan.component);
            notify("已回退迁移的配置，请重新打开页面。 / Configuración restaurada. Vuelva a abrir la página.");
        } catch (error) { notify(error.message); }
    });
    // Register recovery before migrating so a partial write cannot hide it.
    migration.migrate(store,plan);
    registerMenu?.("重新导入旧配置 / Volver a importar", () => {
        try {
            const result=migration.reimport(store,plan);
            notify(result.applied
                ? "已重新导入旧配置，请重新打开页面。 / Configuración importada. Vuelva a abrir la página."
                : "旧配置已经导入。 / La configuración ya está importada.");
        } catch (error) { notify(error.message); }
    });
    return {
        get(key,fallback) {
            const value=store.get(target(key));
            if(value!==undefined) return value;
            return api.get(key,fallback);
        },
        set(key,value) {
            const destination=target(key);
            store.set(destination,value);
            if(JSON.stringify(store.get(destination))!==JSON.stringify(value)) throw new Error(
                "配置保存失败 / No se pudo guardar la configuración");
        }
    };
}


const pbMigrationPlan = PBMigration.buildPlan("packaging",{"pb_odoo_pos_box_barcode_language_v1": "szh-CN", "pb_odoo_pos_box_barcode_mappings_v2": "o[]"},["pb_odoo_pos_box_barcode_mappings_v2", "pb_odoo_pos_box_barcode_language_v1"]);

const PBPrefs = (()=>{try{return createSuitePreferences(
 {get:(key,fallback)=>GM_getValue(key,fallback),set:(key,value)=>GM_setValue(key,value),delete:key=>GM_deleteValue(key)},
 pbMigrationPlan,PBMigration,
 typeof GM_registerMenuCommand === "function" ? GM_registerMenuCommand : null,
 message=>window.alert(message));}catch(error){pbPreferenceError(error);throw error;}})();

const pbBoxPreferenceKeys = new Set(["pb_odoo_pos_box_barcode_mappings_v2", "pb_odoo_pos_box_barcode_language_v1"]);

const PBBoxPrefs = {
 get:(key,fallback)=>pbBoxPreferenceKeys.has(key)?PBPrefs.get(key,fallback):GM_getValue(key,fallback),
 set:(key,value)=>pbBoxPreferenceKeys.has(key)?PBPrefs.set(key,value):GM_setValue(key,value)
};

const pbBarcodeCacheBackup = {"mappings": [{"id": "remote:16974368778592", "name": "AUT117B-50PZ", "boxCodes": ["16974368778592"], "boxCode": "16974368778592", "unitCode": "6974368778076", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368778615", "name": "AUT117N-50PZ", "boxCodes": ["16974368778615"], "boxCode": "16974368778615", "unitCode": "6974368778083", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368773535", "name": "AUT119AM-20PZ", "boxCodes": ["16974368773535"], "boxCode": "16974368773535", "unitCode": "6974368777178", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368773641", "name": "AUT119B-20PZ", "boxCodes": ["16974368773641"], "boxCode": "16974368773641", "unitCode": "6974368777185", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368773542", "name": "AUT119L-20PZ", "boxCodes": ["16974368773542"], "boxCode": "16974368773542", "unitCode": "6974368777161", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368773566", "name": "AUT119M-20PZ", "boxCodes": ["16974368773566"], "boxCode": "16974368773566", "unitCode": "6974368777130", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368773634", "name": "AUT119N-20PZ", "boxCodes": ["16974368773634"], "boxCode": "16974368773634", "unitCode": "6974368777208", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368773573", "name": "AUT119RS-20PZ", "boxCodes": ["16974368773573"], "boxCode": "16974368773573", "unitCode": "6974368777154", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7503035048885", "name": "AUT122B-50PZ", "boxCodes": ["7503035048885"], "boxCode": "7503035048885", "unitCode": "7503035048809", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368777571", "name": "AUT122N-50PZ", "boxCodes": ["16974368777571"], "boxCode": "16974368777571", "unitCode": "6974368777604", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368770244", "name": "AUT124B-50PZ", "boxCodes": ["16974368770244"], "boxCode": "16974368770244", "unitCode": "6974368771039", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368770220", "name": "AUT124N-50PZ", "boxCodes": ["16974368770220"], "boxCode": "16974368770220", "unitCode": "6974368771046", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776406", "name": "AUT125B-50PZ", "boxCodes": ["16974368776406"], "boxCode": "16974368776406", "unitCode": "6974368776812", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368779179", "name": "AUT127B-50PZ", "boxCodes": ["16974368779179"], "boxCode": "16974368779179", "unitCode": "6974368778298", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368779186", "name": "AUT127N-50PZ", "boxCodes": ["16974368779186"], "boxCode": "16974368779186", "unitCode": "6974368778304", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368779292", "name": "AUT128DC-50PZ", "boxCodes": ["16974368779292"], "boxCode": "16974368779292", "unitCode": "6974368778342", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368779278", "name": "AUT128DR-50PZ", "boxCodes": ["16974368779278"], "boxCode": "16974368779278", "unitCode": "6974368778359", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368779223", "name": "AUT128N-50PZ", "boxCodes": ["16974368779223"], "boxCode": "16974368779223", "unitCode": "6974368778311", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368779216", "name": "AUT128P-50PZ", "boxCodes": ["16974368779216"], "boxCode": "16974368779216", "unitCode": "6974368778328", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368773825", "name": "AUT203B-20PZ", "boxCodes": ["16974368773825"], "boxCode": "16974368773825", "unitCode": "6974368777253", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368773467", "name": "AUT205B-20PZ", "boxCodes": ["16974368773467"], "boxCode": "16974368773467", "unitCode": "6974368771060", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368773450", "name": "AUT205N-20PZ", "boxCodes": ["16974368773450"], "boxCode": "16974368773450", "unitCode": "6974368771053", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368775386", "name": "AUT208A-20PZ", "boxCodes": ["16974368775386"], "boxCode": "16974368775386", "unitCode": "6974368775976", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368775362", "name": "AUT208B-20PZ", "boxCodes": ["16974368775362"], "boxCode": "16974368775362", "unitCode": "6974368775969", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368775348", "name": "AUT208N-20PZ", "boxCodes": ["16974368775348"], "boxCode": "16974368775348", "unitCode": "6974368775952", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776154", "name": "AUT210B-20PZ", "boxCodes": ["16974368776154"], "boxCode": "16974368776154", "unitCode": "6974368776652", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776130", "name": "AUT210N-20PZ", "boxCodes": ["16974368776130"], "boxCode": "16974368776130", "unitCode": "6974368776669", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776321", "name": "AUT211N-20PZ", "boxCodes": ["16974368776321"], "boxCode": "16974368776321", "unitCode": "6974368776782", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776451", "name": "AUT212B-20PZ", "boxCodes": ["16974368776451"], "boxCode": "16974368776451", "unitCode": "6974368776881", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776475", "name": "AUT212N-20PZ", "boxCodes": ["16974368776475"], "boxCode": "16974368776475", "unitCode": "6974368776874", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368777939", "name": "AUT216A-20PZ", "boxCodes": ["16974368777939"], "boxCode": "16974368777939", "unitCode": "6974368777796", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368777878", "name": "AUT216B-20PZ", "boxCodes": ["16974368777878"], "boxCode": "16974368777878", "unitCode": "6974368777765", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368777892", "name": "AUT216N-20PZ", "boxCodes": ["16974368777892"], "boxCode": "16974368777892", "unitCode": "6974368777772", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368777915", "name": "AUT216RS-20PZ", "boxCodes": ["16974368777915"], "boxCode": "16974368777915", "unitCode": "6974368777789", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368779063", "name": "AUT217B-20PZ", "boxCodes": ["16974368779063"], "boxCode": "16974368779063", "unitCode": "6974368778205", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:6974368776850", "name": "BAT001-24PZ", "boxCodes": ["6974368776850"], "boxCode": "6974368776850", "unitCode": "", "boxCodeIsProductCode": true, "quantity": 24, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:6974368776867", "name": "BAT002-24PZ", "boxCodes": ["6974368776867"], "boxCode": "6974368776867", "unitCode": "", "boxCodeIsProductCode": true, "quantity": 24, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368778455", "name": "CAB164B-20PZ", "boxCodes": ["16974368778455"], "boxCode": "16974368778455", "unitCode": "6974368773484", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368778479", "name": "CAB164N-20PZ", "boxCodes": ["16974368778479"], "boxCode": "16974368778479", "unitCode": "6974368773477", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368778011", "name": "CAB177B-50PZ", "boxCodes": ["16974368778011"], "boxCode": "16974368778011", "unitCode": "7503027214243", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368778035", "name": "CAB177N-50PZ", "boxCodes": ["16974368778035"], "boxCode": "16974368778035", "unitCode": "6974368777840", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7503030783507", "name": "CAB178B-50PZ", "boxCodes": ["7503030783507"], "boxCode": "7503030783507", "unitCode": "7503027214298", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7503030783491", "name": "CAB178N-50PZ", "boxCodes": ["7503030783491"], "boxCode": "7503030783491", "unitCode": "7503027214304", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776758", "name": "CAB179B-50PZ", "boxCodes": ["16974368776758"], "boxCode": "16974368776758", "unitCode": "6974368777284", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776772", "name": "CAB184B-50PZ", "boxCodes": ["16974368776772"], "boxCode": "16974368776772", "unitCode": "6974368777307", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776765", "name": "CAB184N-50PZ", "boxCodes": ["16974368776765"], "boxCode": "16974368776765", "unitCode": "6974368777291", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368778516", "name": "CAB185B-50PZ", "boxCodes": ["16974368778516"], "boxCode": "16974368778516", "unitCode": "6974368777888", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368778493", "name": "CAB185N-50PZ", "boxCodes": ["16974368778493"], "boxCode": "16974368778493", "unitCode": "6974368777871", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7503030739467", "name": "CAB186B-20PZ", "boxCodes": ["7503030739467"], "boxCode": "7503030739467", "unitCode": "6974368773088", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368778110", "name": "CAB206B-50PZ", "boxCodes": ["16974368778110"], "boxCode": "16974368778110", "unitCode": "6974368777864", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7503030523301", "name": "CAB236B-50PZ", "boxCodes": ["7503030523301"], "boxCode": "7503030523301", "unitCode": "7503028615087", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368777007", "name": "CAB236N-50PZ", "boxCodes": ["16974368777007"], "boxCode": "16974368777007", "unitCode": "6974368777444", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368777083", "name": "CAB237B-50PZ", "boxCodes": ["16974368777083"], "boxCode": "16974368777083", "unitCode": "6974368776997", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368777069", "name": "CAB237N-50PZ", "boxCodes": ["16974368777069"], "boxCode": "16974368777069", "unitCode": "6974368777000", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368777106", "name": "CAB238B-50PZ", "boxCodes": ["16974368777106"], "boxCode": "16974368777106", "unitCode": "6974368777468", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776499", "name": "CAB239B-50PZ", "boxCodes": ["16974368776499"], "boxCode": "16974368776499", "unitCode": "6974368776904", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:6974368773316", "name": "CAB242B-100PZ", "boxCodes": ["6974368773316"], "boxCode": "6974368773316", "unitCode": "6974368773309", "boxCodeIsProductCode": false, "quantity": 100, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:6974368773354", "name": "CAB243B-100PZ", "boxCodes": ["6974368773354"], "boxCode": "6974368773354", "unitCode": "6974368773347", "boxCodeIsProductCode": false, "quantity": 100, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:6974368773392", "name": "CAB244B-100PZ", "boxCodes": ["6974368773392"], "boxCode": "6974368773392", "unitCode": "6974368773385", "boxCodeIsProductCode": false, "quantity": 100, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:6974368773378", "name": "CAB244N-100PZ", "boxCodes": ["6974368773378"], "boxCode": "6974368773378", "unitCode": "6974368773361", "boxCodeIsProductCode": false, "quantity": 100, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7503030523424", "name": "CAB245B-50PZ", "boxCodes": ["7503030523424"], "boxCode": "7503030523424", "unitCode": "7503030523387", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7503030523431", "name": "CAB245N-50PZ", "boxCodes": ["7503030523431"], "boxCode": "7503030523431", "unitCode": "7503030523394", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368778431", "name": "CAB246B-50PZ", "boxCodes": ["16974368778431"], "boxCode": "16974368778431", "unitCode": "7503030523448", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7503030523561", "name": "CAB246B-50PZ", "boxCodes": ["7503030523561"], "boxCode": "7503030523561", "unitCode": "7503030523448", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368778417", "name": "CAB246N-50PZ", "boxCodes": ["16974368778417"], "boxCode": "16974368778417", "unitCode": "6974368777710", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7503030523585", "name": "CAB247B-50PZ", "boxCodes": ["7503030523585"], "boxCode": "7503030523585", "unitCode": "7503030523486", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368777144", "name": "CAB248N-50PZ", "boxCodes": ["16974368777144"], "boxCode": "16974368777144", "unitCode": "6974368777475", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776802", "name": "CAB249N-50PZ", "boxCodes": ["16974368776802"], "boxCode": "16974368776802", "unitCode": "6974368777338", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7503031700022", "name": "CAB249R-50PZ", "boxCodes": ["7503031700022"], "boxCode": "7503031700022", "unitCode": "7503031669947", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776789", "name": "CAB250N-50PZ", "boxCodes": ["16974368776789"], "boxCode": "16974368776789", "unitCode": "6974368777314", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7503031700060", "name": "CAB250R-50PZ", "boxCodes": ["7503031700060"], "boxCode": "7503031700060", "unitCode": "7503031669985", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368777205", "name": "CAB251B-50PZ", "boxCodes": ["16974368777205"], "boxCode": "16974368777205", "unitCode": "7503031349443", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368777182", "name": "CAB251N-50PZ", "boxCodes": ["16974368777182"], "boxCode": "16974368777182", "unitCode": "6974368777024", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368777229", "name": "CAB252B-50PZ", "boxCodes": ["16974368777229"], "boxCode": "16974368777229", "unitCode": "6974368776027", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368777243", "name": "CAB252N-50PZ", "boxCodes": ["16974368777243"], "boxCode": "16974368777243", "unitCode": "6974368777499", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776512", "name": "CAB257B-50PZ", "boxCodes": ["16974368776512"], "boxCode": "16974368776512", "unitCode": "6974368776898", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368777267", "name": "CAB258B-50PZ", "boxCodes": ["16974368777267"], "boxCode": "16974368777267", "unitCode": "7500907000026", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368778677", "name": "CAB259N-50PZ", "boxCodes": ["16974368778677"], "boxCode": "16974368778677", "unitCode": "6974368777895", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7500907000828", "name": "CAB262N-50PZ", "boxCodes": ["7500907000828"], "boxCode": "7500907000828", "unitCode": "7500907000767", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7500907000903", "name": "CAB264N-50PZ", "boxCodes": ["7500907000903"], "boxCode": "7500907000903", "unitCode": "7500907000804", "boxCodeIsProductCode": false, "quantity": 50, "enabled": false, "note": "", "source": "remote"}, {"id": "remote:16974368779537", "name": "CAB265N-50PZ", "boxCodes": ["16974368779537"], "boxCode": "16974368779537", "unitCode": "6974368778441", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368777557", "name": "CAB267N-50PZ", "boxCodes": ["16974368777557"], "boxCode": "16974368777557", "unitCode": "6974368778175", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368773948", "name": "CAB270B-50PZ", "boxCodes": ["16974368773948"], "boxCode": "16974368773948", "unitCode": "6974368774696", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368779926", "name": "CAB271B-50PZ", "boxCodes": ["16974368779926"], "boxCode": "16974368779926", "unitCode": "6974368774771", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776574", "name": "CAB272A-50PZ", "boxCodes": ["16974368776574"], "boxCode": "16974368776574", "unitCode": "6974368776911", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368775638", "name": "CAB272B-50PZ", "boxCodes": ["16974368775638"], "boxCode": "16974368775638", "unitCode": "6974368776027", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776611", "name": "CAB272M-50PZ", "boxCodes": ["16974368776611"], "boxCode": "16974368776611", "unitCode": "6974368776928", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776598", "name": "CAB272ROSA-50PZ", "boxCodes": ["16974368776598"], "boxCode": "16974368776598", "unitCode": "6974368776935", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368775652", "name": "CAB273B-50PZ", "boxCodes": ["16974368775652"], "boxCode": "16974368775652", "unitCode": "6974368776034", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368775676", "name": "CAB273N-50PZ", "boxCodes": ["16974368775676"], "boxCode": "16974368775676", "unitCode": "6974368776041", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:6974368773330", "name": "CBA242N-100PZ", "boxCodes": ["6974368773330"], "boxCode": "6974368773330", "unitCode": "6974368773323", "boxCodeIsProductCode": false, "quantity": 100, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:6974368777123", "name": "GAR063CB-50PZ", "boxCodes": ["6974368777123"], "boxCode": "6974368777123", "unitCode": "N-GAR063CB", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:6974683777116", "name": "GAR063CN-50PZ", "boxCodes": ["6974683777116"], "boxCode": "6974683777116", "unitCode": "N-GAR063CN", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7503029878740", "name": "GAR089N-50PZ", "boxCodes": ["7503029878740"], "boxCode": "7503029878740", "unitCode": "6974368777352", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7503031000672", "name": "GAR097B-125PZ", "boxCodes": ["7503031000672"], "boxCode": "7503031000672", "unitCode": "N-NGAR97B", "boxCodeIsProductCode": false, "quantity": 125, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7503031000665", "name": "GAR097N-125PZ", "boxCodes": ["7503031000665"], "boxCode": "7503031000665", "unitCode": "N-GAR097N", "boxCodeIsProductCode": false, "quantity": 125, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368778295", "name": "GAR107B-20PZ", "boxCodes": ["16974368778295"], "boxCode": "16974368778295", "unitCode": "6974368774061", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368778226", "name": "GAR107N-20PZ", "boxCodes": ["16974368778226"], "boxCode": "16974368778226", "unitCode": "6974368774054", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7503030682213", "name": "GAR108R-20PZ", "boxCodes": ["7503030682213"], "boxCode": "7503030682213", "unitCode": "6974368774085", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7503029878818", "name": "GAR116-20PZ", "boxCodes": ["7503029878818"], "boxCode": "7503029878818", "unitCode": "7503028490981", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7503030682046", "name": "GAR124B-50PZ", "boxCodes": ["7503030682046"], "boxCode": "7503030682046", "unitCode": "7503028615643", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7503030682053", "name": "GAR124N-50PZ", "boxCodes": ["7503030682053"], "boxCode": "7503030682053", "unitCode": "7503028615650", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:7503031277043", "name": "GAR128-50PZ", "boxCodes": ["7503031277043"], "boxCode": "7503031277043", "unitCode": "6974368773224", "boxCodeIsProductCode": false, "quantity": 50, "enabled": false, "note": "", "source": "remote"}, {"id": "remote:16974368778844", "name": "GAR128B-20PZ", "boxCodes": ["16974368778844"], "boxCode": "16974368778844", "unitCode": "6974368773224", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368778370", "name": "GAR129B-50PZ", "boxCodes": ["16974368778370"], "boxCode": "16974368778370", "unitCode": "6974368778052", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368778394", "name": "GAR129N-50PZ", "boxCodes": ["16974368778394"], "boxCode": "16974368778394", "unitCode": "6974368778069", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:6974368774399", "name": "GAR131-40PZ", "boxCodes": ["6974368774399"], "boxCode": "6974368774399", "unitCode": "", "boxCodeIsProductCode": true, "quantity": 40, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:6974368774405", "name": "GAR132-40PZ", "boxCodes": ["6974368774405"], "boxCode": "6974368774405", "unitCode": "", "boxCodeIsProductCode": true, "quantity": 40, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368773382", "name": "GAR135-40PZ", "boxCodes": ["16974368773382"], "boxCode": "16974368773382", "unitCode": "6974368772531", "boxCodeIsProductCode": false, "quantity": 40, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:6974368772531", "name": "GAR135-4PZ", "boxCodes": ["6974368772531"], "boxCode": "6974368772531", "unitCode": "", "boxCodeIsProductCode": true, "quantity": 4, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368773368", "name": "GAR136-40PZ", "boxCodes": ["16974368773368"], "boxCode": "16974368773368", "unitCode": "6974368772517", "boxCodeIsProductCode": false, "quantity": 40, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:6974368772517", "name": "GAR136-4PZ", "boxCodes": ["6974368772517"], "boxCode": "6974368772517", "unitCode": "", "boxCodeIsProductCode": true, "quantity": 4, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776888", "name": "GAR142N-50PZ", "boxCodes": ["16974368776888"], "boxCode": "16974368776888", "unitCode": "7503030727181", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368778356", "name": "GAR143B-50PZ", "boxCodes": ["16974368778356"], "boxCode": "16974368778356", "unitCode": "7503030727198", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368777120", "name": "GAR152B-10PZ", "boxCodes": ["16974368777120"], "boxCode": "16974368777120", "unitCode": "6974368777529", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368774785", "name": "GAR152N-10PZ", "boxCodes": ["16974368774785"], "boxCode": "16974368774785", "unitCode": "6974368775594", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368777717", "name": "GAR153B-10PZ", "boxCodes": ["16974368777717"], "boxCode": "16974368777717", "unitCode": "6974368774177", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368774808", "name": "GAR153N-10PZ", "boxCodes": ["16974368774808"], "boxCode": "16974368774808", "unitCode": "6974368775587", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368777731", "name": "GAR154B-10PZ", "boxCodes": ["16974368777731"], "boxCode": "16974368777731", "unitCode": "6974368773200", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368774297", "name": "GAR161B-10PZ", "boxCodes": ["16974368774297"], "boxCode": "16974368774297", "unitCode": "6974368773002", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776864", "name": "GAR161B-10PZ", "boxCodes": ["16974368776864"], "boxCode": "16974368776864", "unitCode": "6974368773002", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368774310", "name": "GAR162B-10PZ", "boxCodes": ["16974368774310"], "boxCode": "16974368774310", "unitCode": "6974368773019", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368774334", "name": "GAR163B-10PZ", "boxCodes": ["16974368774334"], "boxCode": "16974368774334", "unitCode": "6974368773026", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368774914", "name": "GAR164B-10PZ", "boxCodes": ["16974368774914"], "boxCode": "16974368774914", "unitCode": "6974368775600", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368774938", "name": "GAR164N-10PZ", "boxCodes": ["16974368774938"], "boxCode": "16974368774938", "unitCode": "6974368775617", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368774976", "name": "GAR165N-50PZ", "boxCodes": ["16974368774976"], "boxCode": "16974368774976", "unitCode": "6974368775631", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776697", "name": "GAR171B-10PZ", "boxCodes": ["16974368776697"], "boxCode": "16974368776697", "unitCode": "6974368776966", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368776673", "name": "GAR171N-10PZ", "boxCodes": ["16974368776673"], "boxCode": "16974368776673", "unitCode": "6974368776959", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368779452", "name": "GAR172B-10PZ", "boxCodes": ["16974368779452"], "boxCode": "16974368779452", "unitCode": "6974368778403", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368779438", "name": "GAR172N-10PZ", "boxCodes": ["16974368779438"], "boxCode": "16974368779438", "unitCode": "6974368778397", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368779490", "name": "GAR173B-10PZ", "boxCodes": ["16974368779490"], "boxCode": "16974368779490", "unitCode": "6974368778427", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368771104", "name": "GAR241-20PZ", "boxCodes": ["16974368771104"], "boxCode": "16974368771104", "unitCode": "6974368771886", "boxCodeIsProductCode": false, "quantity": 20, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368779100", "name": "GAR243-10PZ", "boxCodes": ["16974368779100"], "boxCode": "16974368779100", "unitCode": "6974368778229", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368779957", "name": "GAR322N-10PZ", "boxCodes": ["16974368779957"], "boxCode": "16974368779957", "unitCode": "6974368774672", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368778264", "name": "PJ033-50PZ", "boxCodes": ["16974368778264"], "boxCode": "16974368778264", "unitCode": "6974368777901", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368778240", "name": "PJ093-50PZ", "boxCodes": ["16974368778240"], "boxCode": "16974368778240", "unitCode": "6974368777918", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368773252", "name": "PJ098-50PZ", "boxCodes": ["16974368773252"], "boxCode": "16974368773252", "unitCode": "6974368772845", "boxCodeIsProductCode": false, "quantity": 50, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:16974368779728", "name": "PJ100-10PZ", "boxCodes": ["16974368779728"], "boxCode": "16974368779728", "unitCode": "6974368778557", "boxCodeIsProductCode": false, "quantity": 10, "enabled": true, "note": "", "source": "remote"}, {"id": "remote:6974368775365", "name": "YCL033-10PZ", "boxCodes": ["6974368775365"], "boxCode": "6974368775365", "unitCode": "", "boxCodeIsProductCode": true, "quantity": 10, "enabled": true, "note": "", "source": "remote"}], "fetchedAt": "2026-10-20T15:32:10.097Z", "appliedAt": "2026-10-20T14:53:20.921Z", "sourceUrl": "https://docs.google.com/spreadsheets/d/1bpm82a1NHDQLczAlXazvDABkMk8PNVvCYtyFCiTjfs8/gviz/tq?tqx=out:csv&sheet=%E6%9D%A1%E7%A0%81%E6%95%B0%E6%8D%AE"};

// suite-bootstrap-end

(function () {
(function () {
    "use strict";

    const SCRIPT_VERSION = "1.0.20";
    const DEBUG_ENABLED = false;
    const DEBUG_PREFIX = "PB盒码调试";
    const STORAGE_KEY = "pb_odoo_pos_box_barcode_mappings_v2";
    const LEGACY_STORAGE_KEY = "pb_odoo_pos_box_barcode_mappings_v1";
    const REMOTE_CACHE_KEY = "pb_odoo_pos_box_barcode_remote_cache_v1";
    // 所有门店安装的脚本使用同一个固定公开只读表格；需要换表时再逐台修改此常量。
    // 通过工作表名称读取“条码数据”，避免依赖可能变化的 gid 数字。
    const REMOTE_CSV_URL = "https://docs.google.com/spreadsheets/d/1bpm82a1NHDQLczAlXazvDABkMk8PNVvCYtyFCiTjfs8/gviz/tq?tqx=out:csv&sheet=%E6%9D%A1%E7%A0%81%E6%95%B0%E6%8D%AE";
    const ADMIN_PASSWORD_SHA256 = "2671e88703e6661f0b2732940cfb5780c1dd1d5ea552191147f813e5a7083641";
    const BRIDGE_BOX_CODES_ATTR = "data-pb-box-barcode-codes";
    const BRIDGE_COMMAND_ATTR = "data-pb-box-barcode-command";
    const BRIDGE_READY_ATTR = "data-pb-box-barcode-bridge";
    const BRIDGE_NATIVE_SCAN_EVENT = "pb-box-odoo-native-scan-v1";
    const BRIDGE_COMMAND_EVENT = "pb-box-odoo-command-v1";
    const BRIDGE_ERROR_EVENT = "pb-box-odoo-bridge-error-v1";
    const BRIDGE_RESULT_ATTR = "data-pb-box-barcode-result";
    const BRIDGE_RESULT_EVENT = "pb-box-odoo-result-v1";
    const BRIDGE_CONNECT_EVENT = "pb-box-odoo-connect-v1";
    const BRIDGE_STATE_EVENT = "pb-box-odoo-state-v1";
    const SCAN_JOURNAL_EVENT = "pb-box-scan-journal-change-v1";
    function notifyScanJournalChanged() {
        try { document.dispatchEvent(new Event(SCAN_JOURNAL_EVENT)); } catch (_) { /* UI only. */ }
    }
    const MAX_NATIVE_SCAN_GAP_MS = Math.max(
        100,
        Number(window.odoo?.__session_info__?.max_time_between_keys_in_ms) || 100
    );
    // 以下旧键盘兼容参数只用于原生桥接失效时的内部后备逻辑。V7 正常运行时
    // 不再拦截用户键盘，也不会等待 CANDIDATE_HOLD_MS。
    const CANDIDATE_HOLD_MS = Math.max(260, MAX_NATIVE_SCAN_GAP_MS + 160);
    const PASSTHROUGH_RESET_MS = Math.max(1500, MAX_NATIVE_SCAN_GAP_MS * 10);
    const FORWARD_DELAY_MS = 0;
    // 仅在 Odoo 数字缓冲桥接不可用时使用的安全后备间隔。
    const NUMPAD_DIGIT_INTERVAL_MS = 120;
    const MAX_QUANTITY = 9999;
    const MAX_CART_QUANTITY = 999999;

    // Language preference is independent of barcode mappings and online cache.
    const LANGUAGE_STORAGE_KEY = "pb_odoo_pos_box_barcode_language_v1";
    const ES_MX = {
        "扫码连接中": "Conectando escáner",
        "扫码未连接": "Escáner sin conexión",
        "扫码已就绪": "Escáner listo",
        "扫码连接尚未就绪，请稍候后重试": "El escáner aún no está listo; espera y vuelve a intentarlo",
        "检查扫码连接": "Comprobar conexión del escáner",
        "Odoo 原生扫码桥接不可用": "La conexión con el escáner de Odoo no está disponible",
        "无法接入 Odoo 模块加载器": "No se pudo conectar con los módulos de Odoo",
        "脚本发给 Odoo 的命令格式错误": "El comando enviado a Odoo tiene un formato incorrecto",
        "Odoo 商品扫码服务尚未准备好": "El escáner de productos de Odoo todavía no está listo",
        "Odoo 数量服务尚未准备好或数量无效": "El servicio de cantidades de Odoo no está listo o la cantidad no es válida",
        "Odoo 原生扫码桥接发生错误": "Ocurrió un error en la conexión con el escáner de Odoo",
        "未命名商品": "Producto sin nombre",
        "在线表格没有任何内容。": "La hoja en línea está vacía.",
        "包装码为空": "Falta el código del empaque",
        "“包装码本身就是Odoo商品码”只能填写是或否": "La columna de código de empaque como producto solo acepta sí o no",
        "“启用”只能填写是或否": "La columna de activo solo acepta sí o no",
        "普通模式必须填写 Odoo 商品识别码": "En modo normal debes indicar el código de producto de Odoo",
        "普通模式下包装码不能与商品识别码相同": "En modo normal, el código del empaque debe ser distinto al del producto",
        "无包装码": "sin código de empaque",
        "条码冲突": "Conflicto entre códigos",
        "当前 Tampermonkey 不支持在线请求": "Esta versión de Tampermonkey no permite solicitudes en línea",
        "读取 Google 表格超时": "Se agotó el tiempo de espera de Google Sheets",
        "无法连接 Google 表格": "No se pudo conectar con Google Sheets",
        "管理员密码错误": "Contraseña de administrador incorrecta",
        "当前浏览器无法校验管理员密码": "Este navegador no puede verificar la contraseña de administrador",
        "未命名": "Sin nombre",
        "正在检查…": "Buscando…",
        "立即检查更新": "Buscar actualizaciones",
        "在线表格：尚未写入发布后的 CSV 地址": "Hoja en línea: falta configurar la dirección del CSV publicado",
        "在线表格：正在检查更新…": "Hoja en línea: buscando actualizaciones…",
        "尚未成功同步": "Todavía no se ha sincronizado",
        "正在检查在线条码，请稍候": "Buscando códigos en línea. Espera un momento",
        "请先把 Google Sheets 发布后的 CSV 地址写入脚本顶部": "Primero configura al inicio del script la dirección del CSV publicado de Google Sheets",
        "正在读取在线条码…": "Cargando códigos en línea…",
        "在线条码已经是最新版本": "Los códigos en línea ya están actualizados",
        "手工数字恢复失败，请重新输入": "No se pudieron recuperar los números. Escríbelos de nuevo",
        "小盒码": "código de empaque",
        "没有可用于 Odoo 识别商品的条码": "No hay un código con el que Odoo pueda identificar el producto",
        "请查看控制台": "Revisa la consola del navegador",
        "；已恢复扫码前数量": "; se recuperó la cantidad anterior al escaneo",
        "；请人工检查购物车数量": "; revisa manualmente las cantidades del carrito",
        "无法找到扫码前的商品行，已停止处理": "No se encontró el renglón del producto anterior al escaneo. Se detuvo el proceso",
        "找不到 Odoo 的数量按钮，请保持在商品登记页面": "No se encontró el botón de cantidad de Odoo. Mantente en la pantalla de productos",
        "设置小盒条码对应关系": "Configurar códigos de empaque",
        "此模式不需要填写": "No se necesita en este modo",
        "Odoo 当前能够识别的单品条码": "Código de la pieza que Odoo reconoce",
        "请至少输入一个小盒条码。": "Escribe al menos un código de empaque.",
        "请填写 Odoo 能识别的固定商品条码；如果当前包装码本身已在 Odoo 中，请勾选上方特殊模式。": "Escribe un código de producto que Odoo reconozca. Si el código del empaque ya está registrado en Odoo, marca la casilla de arriba.",
        "修改本机特殊设置需要管理员确认。": "Se necesita autorización del administrador para modificar una configuración local.",
        "新增本机特殊设置需要管理员确认。": "Se necesita autorización del administrador para agregar una configuración local.",
        "添加": "Agregar",
        "备份文件中没有 mappings 列表": "El respaldo no contiene la lista de códigos (mappings)",
        "备份里没有有效的小盒码对应关系": "El respaldo no contiene configuraciones válidas de códigos de empaque",
        "导入本机特殊设置需要管理员确认。": "Se necesita autorización del administrador para importar configuraciones locales.",
        "文件格式错误": "El formato del archivo es incorrecto",
        "还没有已应用的在线条码数据。": "Todavía no se han cargado códigos en línea.",
        "这台电脑还没有特殊设置。": "Esta computadora todavía no tiene configuraciones locales.",
        "在线统一数据": "Códigos compartidos en línea",
        "来自 Google 表格，只读": "De Google Sheets · Solo lectura",
        "本机特殊设置": "Configuración local",
        "只影响当前 POS 电脑": "Solo se aplica en esta computadora",
        "启用或停用本机特殊设置需要管理员确认。": "Se necesita autorización del administrador para activar o desactivar una configuración local.",
        "保存修改": "Guardar cambios",
        "删除本机特殊设置需要管理员确认。": "Se necesita autorización del administrador para eliminar una configuración local.",
        "扫码桥接错误：{0}": "Error de conexión del escáner: {0}",
        "包装条码 {0} 已经用于“{1}”。": "El código de empaque {0} ya está asignado a “{1}”.",
        "包装条码 {0} 已经是“{1}”的 Odoo 商品识别码。": "El código de empaque {0} ya es el código de producto de Odoo para “{1}”.",
        "商品识别码 {0} 已经是“{1}”的普通包装条码。": "El código de producto {0} ya se usa como código de empaque normal para “{1}”.",
        "第一行缺少必要列：{0}": "Falta una columna obligatoria en la primera fila: {0}",
        "数量必须是 1–{0} 的整数": "La cantidad debe ser un número entero entre 1 y {0}",
        "包装码与第 {0} 行重复": "El código de empaque está repetido en la fila {0}",
        "第 {0} 行（{1}）：{2}": "Fila {0} ({1}): {2}",
        "Google 表格返回 HTTP {0}": "Google Sheets devolvió HTTP {0}",
        "{0}｜包装码 {1}｜数量 {2}": "{0} | Empaque {1} | Cantidad {2}",
        "在线表格：更新失败，继续使用缓存（{0}）": "Hoja en línea: falló la actualización. Se usan los datos guardados ({0})",
        "在线表格：{0} 条｜上次应用 {1}": "Hoja en línea: {0} registros | Última actualización: {1}",
        "\n……另有 {0} 个错误": "\n…y {0} errores más",
        "在线表格发现 {0} 个错误：\n\n{1}{2}\n\n确定＝跳过错误行并继续；取消＝取消整次更新并继续使用旧数据。": "Se encontraron {0} errores en la hoja en línea:\n\n{1}{2}\n\nAceptar = omitir las filas con errores y continuar.\nCancelar = cancelar toda la actualización y conservar los datos anteriores.",
        "发现在线与本地特殊设置冲突：\n\n在线：{0}\n本地：{1}\n原因：{2}\n\n确定＝使用在线数据并删除冲突的本地设置；取消＝保留本地设置并跳过这条在线数据。": "Hay un conflicto entre los datos en línea y la configuración local:\n\nEn línea: {0}\nLocal: {1}\nMotivo: {2}\n\nAceptar = usar los datos en línea y eliminar la configuración local en conflicto.\nCancelar = conservar la configuración local y omitir este registro en línea.",
        "\n……另有 {0} 条": "\n…y {0} registros más",
        "在线表格删除或跳过了 {0} 条现有在线数据：\n\n{1}{2}\n\n确定＝从本机在线缓存删除；取消＝保留这些旧缓存数据。": "Se eliminaron u omitieron {0} registros existentes de la hoja en línea:\n\n{1}{2}\n\nAceptar = eliminarlos de los datos guardados en esta computadora.\nCancelar = conservar estos registros anteriores.",
        "在线条码有变化：\n新增 {0} 条\n修改 {1} 条\n删除 {2} 条\n\n是否确认更新？": "Hay cambios en los códigos en línea:\nNuevos: {0}\nModificados: {1}\nEliminados: {2}\n\n¿Aplicar la actualización?",
        "在线更新完成：新增 {0}，修改 {1}，删除 {2}": "Actualización lista: {0} nuevos, {1} modificados y {2} eliminados",
        "在线同步失败，继续使用上次缓存：{0}": "Falló la sincronización. Se usarán los últimos datos guardados: {0}",
        "无法恢复手工数字 {0}": "No se pudo recuperar el número {0}",
        "已识别{0}：{1}，准备增加 {2} 个": "Se detectó {0}: {1}. Se agregarán {2} piezas",
        "Odoo 没有通过商品条码 {0} 选中商品行": "Odoo no seleccionó el producto con el código {0}",
        "计算出的目标数量无效：{0}": "La cantidad calculada no es válida: {0}",
        "正在设置：{0} {1} + {2} = {3}": "Actualizando: {0} · {1} + {2} = {3}",
        "Odoo 数量没有更新到 {0}": "Odoo no actualizó la cantidad a {0}",
        "完成：{0} 当前数量 {1}": "Listo: {0} · Cantidad actual: {1}",
        "处理失败：{0}{1}": "No se pudo completar: {0}{1}",
        "无法清除小盒码数字并恢复原数量 {0}": "No se pudo borrar el código de empaque y recuperar la cantidad original: {0}",
        "找不到 Odoo 数字键 {0}": "No se encontró la tecla {0} en Odoo",
        "📦 小盒码{0}": "📦 Empaques{0}",
        "条码 {0} 不能同时作为小盒码和单品码。": "El código {0} no puede ser a la vez código de empaque y código de pieza.",
        "数量必须是 1–{0} 的整数。": "La cantidad debe ser un número entero entre 1 y {0}.",
        "已保存：{0}": "Guardado: {0}",
        "已导出 {0} 个本机特殊设置": "Se exportaron {0} configuraciones locales",
        "\n有 {0} 条无效、重复或与在线数据冲突的记录会被跳过。": "\nSe omitirán {0} registros inválidos, repetidos o en conflicto con los datos en línea.",
        "将用备份中的 {0} 个本机特殊设置替换当前 {1} 个。{2}\n是否继续？": "Se reemplazarán las {1} configuraciones locales actuales por las {0} del respaldo.{2}\n¿Continuar?",
        "导入完成：{0} 个本机特殊设置": "Importación lista: {0} configuraciones locales",
        "导入失败：{0}": "No se pudo importar: {0}",
        "确定删除“{0}”吗？": "¿Eliminar “{0}”?",
        "管理员验证": "Autorización de administrador",
        "管理员密码": "Contraseña de administrador",
        "输入内容会以圆点隐藏。": "La contraseña se muestra con puntos.",
        "取消": "Cancelar",
        "确认": "Confirmar",
        "小盒条码设置": "Códigos de empaque",
        "在线数据来自统一 Google 表格并保持只读；下面的表单只管理这台电脑的少量特殊设置。每个商品都可以单独设置“每次扫描增加数量”，同一商品的不同包装数量请分别添加。": "Los códigos compartidos vienen de Google Sheets y son de solo lectura. Aquí puedes agregar excepciones para esta computadora. Indica cuántas piezas suma cada escaneo. Si un producto tiene varios tamaños de empaque, agrega un registro para cada uno.",
        "在线 Google 表格": "Google Sheets en línea",
        "只保存在当前这台 POS 电脑": "Se guarda solo en esta computadora",
        "这个包装码本身就是 Odoo 商品条码": "Este código de empaque ya está registrado como código de producto en Odoo",
        "勾选后不需要填写固定单品码；适合已经录入 Odoo 的 4 个装、12 个装等包装条码。其他更大包装可以把这个条码作为固定商品识别码。": "Marca esta opción si el código del empaque de 4, 12 u otra cantidad de piezas ya está registrado en Odoo. No necesitas indicar un código de pieza. También puedes usarlo como código de producto para empaques más grandes.",
        "小盒条码（每行一个）*": "Códigos de empaque (uno por renglón) *",
        "固定单品条码": "Código de la pieza",
        "每次扫描增加数量 *": "Piezas por escaneo *",
        "名称/颜色": "Nombre / color",
        "在线条码只读；导入和导出仅包含本机特殊设置": "Los códigos en línea son de solo lectura. El respaldo solo incluye la configuración local.",
        "导出备份": "Exportar respaldo",
        "导入备份": "Importar respaldo",
        "完成": "Listo",
        "测试": "Probar",
        "在线只读": "Solo lectura",
        "修改": "Editar",
        "删除": "Eliminar",
        "启用": "Activo",
        "包装条码": "Código de empaque",
        "Odoo 商品识别码": "Código de producto en Odoo",
        "每次增加": "Piezas por escaneo",
        "操作": "Acciones",
        "关闭": "Cerrar",
        "扫描旧盒码、新盒码；每行一个": "Escanea los códigos de empaque, uno por renglón",
        "如 GAR080 黑色": "Ej. GAR080 negro",
        "是": "Sí",
        "否": "No",
        "包装码本身": "El mismo código de empaque",
        "{0} 条": "{0} registros",
        "切换为墨西哥西班牙语": "Cambiar a español de México",
        "切换为中文": "Cambiar a chino"
};
    let uiLanguage = PBUI.get();

    function loadUiLanguage() {
        try {
            const saved = typeof GM_getValue === "function" ? PBBoxPrefs.get(LANGUAGE_STORAGE_KEY, "") : "";
            if (saved === "zh-CN" || saved === "es-MX") return saved;
        } catch (_) { /* Try the local preference if script storage is unavailable. */ }
        try {
            const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
            if (saved === "zh-CN" || saved === "es-MX") return saved;
        } catch (_) { /* Language changes still work for this page. */ }
        return "zh-CN";
    }

    function t(key, ...values) {
        const text = uiLanguage === "es-MX" && Object.prototype.hasOwnProperty.call(ES_MX, key)
            ? ES_MX[key] : key;
        return text.replace(/\{(\d+)\}/g, (match, index) =>
            Number(index) < values.length ? String(values[Number(index)] ?? "") : match
        );
    }

    function updateLanguageButton() {
        const button = document.getElementById("pb-box-language-toggle");
        if (button) {
            button.textContent = uiLanguage === "zh-CN" ? "Español" : "中文";
            button.lang = uiLanguage === "zh-CN" ? "es-MX" : "zh-CN";
            button.title = t(uiLanguage === "zh-CN" ? "切换为墨西哥西班牙语" : "切换为中文");
            button.setAttribute("aria-label", button.title);
        }
        const modal = document.getElementById("pb-box-modal");
        if (modal) modal.lang = uiLanguage;
    }

    function toggleLanguage(event) {
        event?.preventDefault();
        event?.stopPropagation();
        PBUI.set(PBUI.get() === "zh-CN" ? "es-MX" : "zh-CN");
    }

    function applySuiteLanguage(value) {
        uiLanguage = value;
        const modal = document.getElementById("pb-box-modal");
        if (modal) {
            modal.querySelectorAll("[data-pb-i18n]").forEach((element) => {
                element.textContent = t(element.getAttribute("data-pb-i18n"));
            });
            for (const attribute of ["title", "placeholder", "aria-label"]) {
                modal.querySelectorAll(`[data-pb-i18n-${attribute}]`).forEach((element) => {
                    element.setAttribute(attribute, t(element.getAttribute(`data-pb-i18n-${attribute}`)));
                });
            }
            const saveButton = document.getElementById("pb-box-save-btn");
            if (saveButton) saveButton.textContent = t(state.editingId ? "保存修改" : "添加");
            updateBarcodeModeForm();
            renderMappingList();
            // Clear old transient messages; subsequent validation uses the new language.
            showFormError("");
        }
        hideToast();
        updateSettingsButton();
        updateLanguageButton();
        updateRemoteStatus();
    }

/* Two configuration keys, one recovery journal. No network or business writes. */
function createBarcodeConfigTransaction(storage, keys) {
    const journalKey = "pb-suite:barcode-config-transaction:v1";
    const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
    function write(key,value) {
        storage.set(key,value);
        if (!equal(storage.get(key,null),value)) throw Error("Barcode configuration readback failed");
    }
    function clear() {
        storage.delete(journalKey);
        if (storage.get(journalKey,null)!==null) throw Error("Barcode configuration journal removal failed");
    }
    function recover() {
        const record=storage.get(journalKey,null);
        if(record===null)return false;
        if(!record || record.schema!==1 || !Array.isArray(record.before) ||
           record.before.length!==keys.length ||
           record.before.some((entry,index)=>!entry || entry.key!==keys[index] || !Object.hasOwn(entry,"value")))
            throw Error("Invalid barcode configuration journal; preserved for inspection");
        // Repeating recovery is safe if interruption occurs between these writes.
        for(const entry of record.before)write(entry.key,entry.value);
        clear();
        return true;
    }
    function commit(values) {
        if(!Array.isArray(values)||values.length!==keys.length)throw Error("Invalid barcode configuration update");
        if(storage.get(journalKey,null)!==null)throw Error("Pending barcode configuration recovery");
        const record={schema:1,before:keys.map(key=>({key,value:storage.get(key,null)}))};
        write(journalKey,record);
        try {
            keys.forEach((key,index)=>write(key,values[index]));
            clear();
        } catch(error) {
            try { recover(); } catch(recoveryError) { error.recoveryError=recoveryError; }
            throw error;
        }
    }
    return {commit,recover};
}

    const pbBarcodeTransaction=createBarcodeConfigTransaction({
        get:(key,fallback)=>PBBoxPrefs.get(key,fallback),
        set:(key,value)=>PBBoxPrefs.set(key,value),
        delete:key=>GM_deleteValue(key)
    },[STORAGE_KEY,REMOTE_CACHE_KEY]);
    try { pbBarcodeTransaction.recover(); }
    catch(error) { pbPreferenceError(error); throw error; }
    PBUI.subscribe(applySuiteLanguage);
    installOdooNativeBarcodeBridge();

    const initialLocalMappings = loadMappings();
    const initialRemoteCache = loadRemoteCache();
    const state = {
        buffer: "",
        lastKeyAt: 0,
        scanTarget: null,
        scanTargetSnapshot: null,
        boxScanContext: null,
        lastStableOrderlineSnapshot: null,
        interceptingCandidate: false,
        passthroughUntilEnter: false,
        candidateTimer: null,
        passthroughTimer: null,
        forwardingRaw: false,
        blockedKeyups: new Map(),
        scanSink: null,
        previousFocus: null,
        releaseSinkTimer: null,
        releaseSinkOnEnterKeyup: false,
        localMappings: initialLocalMappings,
        remoteMappings: initialRemoteCache.mappings,
        remoteCache: initialRemoteCache,
        mappings: [],
        remoteSyncing: false,
        remoteLastError: "",
        modalOpen: false,
        editingId: null,
        replaying: false,
        queue: [],
        toastTimer: null,
        debugScanId: 0,
        debugStartedAt: 0,
        debugRecentUntil: 0,
        debugEventSeq: 0,
        debugLastQuantitySignature: "",
        bridgeErrorShown: false,
    };
    refreshEffectiveMappings();

    /**
     * 在 Odoo 页面自己的 JavaScript 环境中接入三个官方服务：
     * 1. barcode：在 POS 处理前取得完整实体扫码；
     * 2. barcode_reader：把固定商品码直接交给 Odoo，不再模拟逐个键盘字符；
     * 3. number_buffer：把 120 等多位数量一次提交，不再逐位等待。
     *
     * Tampermonkey 使用隔离环境，因此桥接命令和结果只通过 DOM 属性与简单事件传递。
     */
    function installOdooNativeBarcodeBridge() {
        const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
        const marker = "__pbBoxBarcodeNativeBridgeV1";
        if (pageWindow[marker]) return;

        const bridge = {
            barcodeReader: null,
            numberBuffer: null,
            barcodeBus: null,
            loader: null,
            posStore: null,
            blockNextEnterKeyup: false,
            enterBlockTimer: null,
        };
        pageWindow[marker] = bridge;

        const pageDocument = pageWindow.document;

        function rootElement() {
            return pageDocument.documentElement;
        }

        function plainLineSnapshot(order, line) {
            return {
                orderUuid: String(order?.uuid || ""),
                orderState: String(order?.state || ""),
                finalized: Boolean(order?.finalized),
                lineUuid: line?.uuid ? String(line.uuid) : "",
                productId: Number(line?.product_id?.id || 0),
                quantity: Number(line?.qty),
            };
        }

        function activeOrderSnapshot() {
            const order = bridge.posStore?.getOrder?.();
            return order ? plainLineSnapshot(order, order.getSelectedOrderline?.()) : null;
        }

        function assertOwnedOrder(command) {
            const active = bridge.posStore?.getOrder?.();
            if (!active || String(active.uuid || "") !== String(command.orderUuid || "")) {
                throw Object.assign(new Error("ORDER_CONTEXT_CHANGED"), { code: "ORDER_CONTEXT_CHANGED" });
            }
            active.assertEditable?.();
            if (active.state !== "draft" || active.finalized) {
                throw Object.assign(new Error("ORDER_NOT_EDITABLE"), { code: "ORDER_NOT_EDITABLE" });
            }
            return active;
        }

        function dispatchBridgeResult(result) {
            const root = rootElement();
            if (!root) return;
            root.setAttribute(BRIDGE_RESULT_ATTR, JSON.stringify(result));
            pageDocument.dispatchEvent(new pageWindow.Event(BRIDGE_RESULT_EVENT));
        }

        async function findOwnedProduct(code) {
            const reader = bridge.barcodeReader;
            const pos = bridge.posStore;
            if (!reader?.parser || !pos?.models) throw new Error("ODOO_SERVICES_NOT_READY");
            const parsed = reader.parser.parse_barcode(String(code || ""));
            const parsedProduct = Array.isArray(parsed)
                ? parsed.find(item => item?.type === "product")
                : parsed;
            if (!parsedProduct || !["product", "quantity", "weight", "price"].includes(parsedProduct.type)) {
                throw new Error("BARCODE_IS_NOT_A_PRODUCT");
            }
            const baseCode = String(parsedProduct.base_code || parsedProduct.code || "");
            const productModel = pos.models["product.product"];
            const packagingModel = pos.models["product.uom"];
            let product = productModel?.getBy?.("barcode", baseCode);
            if (!product) product = packagingModel?.getBy?.("barcode", baseCode)?.product_id;
            const stripped = /^0\d+$/.test(baseCode) ? String(parseInt(baseCode, 10)) : "";
            if (!product && stripped) product = productModel?.getBy?.("barcode", stripped) || packagingModel?.getBy?.("barcode", stripped)?.product_id;
            if (!product && typeof pos.loadNewProducts === "function") {
                await pos.loadNewProducts([["product_variant_ids.barcode", "in", stripped ? [baseCode, stripped] : [baseCode]]]);
                product = productModel?.getBy?.("barcode", baseCode) || (stripped && productModel?.getBy?.("barcode", stripped));
            }
            if (!product) throw new Error("PRODUCT_NOT_FOUND");
            return { product, parsedProduct };
        }

    function pbScanJournal(storage) {
        const prefix = "pb_box_task_v4:";
        function read() {
            const legacy = JSON.parse(storage.getItem("pb_box_transactions_v3") || "{}");
            if (!legacy || Array.isArray(legacy) || typeof legacy !== "object") throw new Error("SCAN_JOURNAL_INVALID");
            const records = {...legacy};
            for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                if (!key?.startsWith(prefix)) continue;
                const record = JSON.parse(storage.getItem(key));
                if (!record?.taskId || key !== prefix + encodeURIComponent(record.taskId)) throw new Error("SCAN_JOURNAL_INVALID");
                records[record.taskId] = record;
            }
            return records;
        }
        function write(task) {
            if (!task?.taskId) throw new Error("SCAN_TASK_ID_MISSING");
            const key = prefix + encodeURIComponent(task.taskId);
            const text = JSON.stringify({...task, at:new Date().toISOString()});
            try {
                storage.setItem(key,text);
                if (storage.getItem(key) !== text) throw new Error("SCAN_JOURNAL_NOT_SAVED");
            } finally { notifyScanJournalChanged(); }
            // Terminal task IDs cannot be executed again. Bound routine evidence
            // like v3, but never prune unknown tasks or a v3 override (which
            // would uncover the old pending record). Cleanup is best effort.
            if (["completed","cancelled","reviewed"].includes(task.phase)) {
                try {
                    const legacy = JSON.parse(storage.getItem("pb_box_transactions_v3") || "{}");
                    const terminal = Object.values(read()).filter(r => r.taskId !== task.taskId && !legacy[r.taskId] &&
                        ["completed","cancelled","reviewed"].includes(r.phase)).sort((a,b) => String(b.at).localeCompare(String(a.at)));
                    for (const old of terminal.slice(99)) {
                        const oldKey = prefix + encodeURIComponent(old.taskId);
                        const current = storage.getItem(oldKey);
                        if (current && JSON.stringify(JSON.parse(current)) === JSON.stringify(old)) storage.removeItem(oldKey);
                    }
                } catch (_) { /* Preserve evidence when optional cleanup fails. */ }
            }
        }
        return {read,write};
    }
        const ownedTasks = new Map();
        const ownedLines = new WeakMap();
        const journal = pbScanJournal(pageWindow.localStorage);
        const readOwnedTasks = journal.read;
        const saveOwnedTask = journal.write;
        function cancelOwnedTask(taskId) {
            const task = ownedTasks.get(String(taskId));
            if (!task) return; // Do not fabricate an acknowledgement for an unknown task.
            if (task.phase === "lookup") {
                task.phase = "cancelled";
                saveOwnedTask(task);
                task.cancelLookup?.(new Error("SCAN_CANCELLED_BEFORE_WRITE"));
            } else if (task.phase === "native") {
                task.timedOut = true;
                saveOwnedTask(task);
                dispatchBridgeResult({taskId, pending:true, phase:"native"});
            }
        }
        function guardOwnedNativeAdd(pos) {
            const original = pos.addLineToOrder;
            if (typeof original !== "function") throw new Error("ODOO_ADD_API_NOT_READY");
            const guarded = function(vals, order, opts, ...rest) {
                const task = opts?.pbBoxTaskId && ownedTasks.get(opts.pbBoxTaskId);
                if (opts?.pbBoxTaskId && (!task || task.phase !== "native" || String(order?.uuid) !== task.orderUuid)) {
                    throw new Error("ORDER_CONTEXT_CHANGED");
                }
                return original.call(this, vals, order, opts, ...rest);
            };
            Object.assign(guarded, original); // Preserve the copy guard's idempotence marker.
            guarded.__pbTaskGuard = true;
            if (!original.__pbTaskGuard) pos.addLineToOrder = guarded;
            const Line = pageWindow.odoo?.loader?.modules?.get("@point_of_sale/app/models/pos_order_line")?.PosOrderline;
            if (!Line?.prototype?.setOptions) throw new Error("ODOO_LINE_OPTIONS_NOT_READY");
            if (!Line.prototype.setOptions.__pbTaskQuantity) {
                const setOptions = Line.prototype.setOptions;
                const withPackageQuantity = function(options) {
                    const task = options?.pbBoxTaskId && ownedTasks.get(options.pbBoxTaskId);
                    const result = setOptions.apply(this, arguments);
                    if (options?.pbBoxTaskId) {
                        if (!task || task.phase !== "native" || String(this.order_id?.uuid) !== task.orderUuid) throw new Error("SCAN_LINE_CONTEXT_CHANGED");
                        // This is the NEW unmerged native line, never the pre-existing
                        // cart line. Native quantity/weight/UoM barcode options may have
                        // changed its qty; apply the configured package before merging.
                        if (this.setQuantity(task.quantity) !== true || Number(this.qty) !== task.quantity) throw new Error("PACKAGE_QUANTITY_REJECTED");
                        task.addedLineUuid = String(this.uuid);
                        ownedLines.set(this, task);
                    }
                    return result;
                };
                withPackageQuantity.__pbTaskQuantity = true;
                Line.prototype.setOptions = withPackageQuantity;
            }
            // Inspect the actual merge target synchronously, after configuration and
            // intervening edits. Never restore a previous absolute quantity.
            if (!Line.prototype.merge?.__pbTaskLimit) {
                const merge = Line.prototype.merge;
                if (typeof merge !== "function") throw new Error("ODOO_MERGE_API_NOT_READY");
                const limited = function(incoming, ...args) {
                    const task = ownedLines.get(incoming);
                    if (task && Number(this.qty) + Number(incoming.qty) > 999999) {
                        const order = incoming.order_id;
                        incoming.delete(); // Only our new, unmerged line is removed.
                        if (!(order.lines || []).some(l => l === incoming || l.uuid === incoming.uuid)) {
                            const selected = order.getSelectedOrderline?.();
                            if (!selected || selected === incoming || selected.uuid === incoming.uuid) pos.selectOrderLine(order,this);
                            task.safeRejected = true;
                        }
                        throw new Error("MAX_CART_QUANTITY_EXCEEDED");
                    }
                    return merge.call(this,incoming,...args);
                };
                limited.__pbTaskLimit = true;
                Line.prototype.merge = limited;
            }
        }
        async function ownedProductScan(command) {
            const locks = pageWindow.navigator?.locks;
            if (!locks?.request) throw new Error("SCAN_DEVICE_LOCK_UNAVAILABLE");
            return locks.request("pb-box-order:" + String(command.orderUuid), {mode:"exclusive",ifAvailable:true}, lock => {
                if (!lock) throw new Error("SCAN_RUNNING_IN_ANOTHER_TAB");
                return executeOwnedProductScan(command);
            });
        }
        async function executeOwnedProductScan(command) {
            const order = assertOwnedOrder(command);
            const records = readOwnedTasks();
            const previous = records[command.taskId];
            if (previous) {
                if (previous.phase === "completed") return previous.result;
                throw new Error("SCAN_TASK_ALREADY_RECORDED");
            }
            if (Object.values(records).some(r => r.orderUuid === String(command.orderUuid) &&
                !["completed", "cancelled", "reviewed"].includes(r.phase))) throw new Error("SCAN_PREVIOUS_RESULT_NEEDS_REVIEW");
            const quantity = Number(command.quantity);
            if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999999) throw new Error("INVALID_QUANTITY");
            const task = {taskId:String(command.taskId), orderUuid:String(command.orderUuid), code:String(command.code), quantity, phase:"lookup"};
            saveOwnedTask(task); // Write-ahead evidence survives reload, independent of model serialization.
            ownedTasks.set(task.taskId, task);
            try {
                const cancelled = new Promise((_, reject) => { task.cancelLookup = reject; });
                const { product, parsedProduct } = await Promise.race([findOwnedProduct(command.code), cancelled]);
                delete task.cancelLookup;
                if (task.phase === "cancelled") throw new Error("SCAN_CANCELLED_BEFORE_WRITE");
                assertOwnedOrder(command);
                if (typeof bridge.posStore.addLineToCurrentOrder !== "function") throw new Error("ODOO_CURRENT_ADD_API_NOT_READY");
                guardOwnedNativeAdd(bridge.posStore);
                task.before = (order.lines || []).map(line => plainLineSnapshot(order,line));
                task.phase = "native";
                saveOwnedTask(task);
                // Submit the whole package as a native increment. There is no later
                // absolute-quantity write and no rollback to a stale snapshot.
                // Use the public entry point so its installed module extensions run.
                const line = await bridge.posStore.addLineToCurrentOrder(
                    { product_id:product, product_tmpl_id:product.product_tmpl_id, qty:quantity },
                    { code:parsedProduct, pbBoxTaskId:task.taskId },
                    product.needToConfigure?.() ?? true
                );
                if (!line || String(line.order_id?.uuid || "") !== task.orderUuid) throw new Error("NATIVE_RESULT_NEEDS_REVIEW");
                const result = {...plainLineSnapshot(order,line), contextActive:String(bridge.posStore.getOrder?.()?.uuid) === task.orderUuid};
                task.phase = "completed";
                task.result = result;
                saveOwnedTask(task);
                return result;
            } catch (error) {
                task.phase = (task.safeRejected || ["lookup","cancelled"].includes(task.phase)) ? "cancelled" : "needs-review";
                task.error = String(error?.message || error);
                saveOwnedTask(task);
                throw error;
            } finally {
                ownedTasks.delete(task.taskId);
            }
        }

        function ownedSetQuantity(command) {
            const order = assertOwnedOrder(command);
            const line = (order.lines || []).find(item => String(item.uuid) === String(command.lineUuid) &&
                Number(item.product_id?.id || 0) === Number(command.productId));
            if (!line) throw new Error("OWNED_LINE_NOT_FOUND");
            const quantity = Number(command.value);
            if (!Number.isFinite(quantity)) throw new Error("INVALID_QUANTITY");
            const result = line.setQuantity(quantity);
            if (result !== true || !Number.isFinite(Number(line.qty))) throw new Error("QUANTITY_REJECTED");
            return plainLineSnapshot(order, line);
        }

        function setBridgeStatus() {
            const root = rootElement();
            if (!root) return;
            const parts = [];
            if (bridge.barcodeBus) parts.push("barcode");
            if (bridge.barcodeReader) parts.push("reader");
            if (bridge.numberBuffer) parts.push("number");
            if (bridge.posStore?.models) parts.push("pos");
            if (pageWindow.PBCartUnit?.isConnected?.()) parts.push("unit");
            const value = parts.join(",");
            const status = bridgeReady() ? "ready" : Date.now() >= connectionDeadline ? "retry" : "connecting";
            if (root.getAttribute(BRIDGE_READY_ATTR) !== value || root.getAttribute("data-pb-box-barcode-connection") !== status) {
                root.setAttribute(BRIDGE_READY_ATTR, value);
                root.setAttribute("data-pb-box-barcode-connection", status);
                pageDocument.dispatchEvent(new pageWindow.Event(BRIDGE_STATE_EVENT));
            }
        }

        function activeBoxCodes() {
            const raw = rootElement()?.getAttribute(BRIDGE_BOX_CODES_ATTR) || "[]";
            try {
                const parsed = JSON.parse(raw);
                return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
            } catch (_) {
                return new Set();
            }
        }

        function clearNumberBufferEvents() {
            const numberBuffer = bridge.numberBuffer;
            if (!numberBuffer) return;
            pageWindow.clearTimeout(numberBuffer._timeout);
            numberBuffer.eventsBuffer = [];
            delete numberBuffer.handler;
            numberBuffer.reset?.();
        }

        function dispatchBridgeError(message) {
            pageWindow.dispatchEvent(new pageWindow.CustomEvent(BRIDGE_ERROR_EVENT, {
                detail: String(message || t("Odoo 原生扫码桥接不可用")),
            }));
        }

        function handleOdooBarcodeScanned(event) {
            const barcode = String(event?.detail?.barcode || "").trim();
            if (!barcode || !activeBoxCodes().has(barcode)) return;

            // 此监听器在 POS barcode_reader 之前注册。包装码到这里后停止继续传播，
            // 因此 Odoo 不会显示“未知条码”；普通单品码完全不受影响。
            event.stopImmediatePropagation();

            // Odoo 的数量缓冲同时收到了实体扫描的 keyup。完整条码通常会被原生
            // 规则丢弃，这里再主动清空并拦截最后的 Enter keyup，避免与后续数量命令混合。
            clearNumberBufferEvents();
            bridge.blockNextEnterKeyup = true;
            pageWindow.clearTimeout(bridge.enterBlockTimer);
            bridge.enterBlockTimer = pageWindow.setTimeout(() => {
                bridge.blockNextEnterKeyup = false;
                clearNumberBufferEvents();
            }, 600);

            pageWindow.dispatchEvent(new pageWindow.CustomEvent(BRIDGE_NATIVE_SCAN_EVENT, {
                detail: { barcode, context: activeOrderSnapshot() },
            }));
        }

        pageWindow.addEventListener("keyup", (event) => {
            if (!bridge.blockNextEnterKeyup) return;
            if (event.key !== "Enter" && event.key !== "NumpadEnter") return;
            bridge.blockNextEnterKeyup = false;
            pageWindow.clearTimeout(bridge.enterBlockTimer);
            event.preventDefault();
            event.stopImmediatePropagation();
            clearNumberBufferEvents();
        }, true);

        // Startup only: adopt existing instances; never start an Odoo service ourselves.
        let connectionTimer = null;
        let connectionDeadline = Date.now() + 300000;
        let connectionDisposed = false;
        let checkingConnection = false;
        let loaderListener = null;
        let observedOdoo = null;
        let busHook = null;

        function bridgeReady() {
            return !!(bridge.barcodeBus && bridge.barcodeReader && bridge.numberBuffer &&
                bridge.posStore?.models && pageWindow.PBCartUnit?.isConnected?.());
        }

        function bindBarcodeService(service) {
            const bus = service?.bus;
            if (!bus || typeof bus.dispatchEvent !== "function") return;
            if (busHook?.bus === bus) return;
            if (busHook && busHook.bus.dispatchEvent === busHook.wrapped) {
                busHook.bus.dispatchEvent = busHook.original;
            }
            const original = bus.dispatchEvent;
            const wrapped = function (event) {
                if (this !== bus) return original.apply(this, arguments);
                const code = String(event?.detail?.barcode || "").trim();
                if (!connectionDisposed && bridge.barcodeBus === bus &&
                    event?.type === "barcode_scanned" && activeBoxCodes().has(code)) {
                    // A late DOM listener would run after the reader's existing listener.
                    // Intercept only our mapped codes before dispatch; all other events
                    // retain the original receiver, return value and exception behavior.
                    checkConnection();
                    if (bridge.barcodeBus !== bus) return true;
                    if (!bridgeReady()) {
                        dispatchBridgeError(t("扫码连接尚未就绪，请稍候后重试"));
                        return true;
                    }
                    handleOdooBarcodeScanned(event);
                    return !event.defaultPrevented;
                }
                return original.apply(this, arguments);
            };
            try {
                bus.dispatchEvent = wrapped;
                if (bus.dispatchEvent !== wrapped) return;
                busHook = { bus, original, wrapped };
                bridge.barcodeBus = bus;
            } catch (_) { /* Keep connecting; do not publish a false ready state. */ }
        }

        function adoptServices(env, deps, pos) {
            const services = env?.services;
            const livePos = pos || services?.pos;
            if (livePos && typeof livePos.getOrder === "function" && livePos.models) {
                bridge.posStore = livePos;
            }
            bindBarcodeService(services?.barcode || deps?.barcode);
            const reader = services?.barcode_reader || deps?.barcode_reader || livePos?.barcodeReader;
            const number = services?.number_buffer || deps?.number_buffer || livePos?.numberBuffer;
            if (typeof reader?.scan === "function") bridge.barcodeReader = reader;
            if (typeof number?.reset === "function") bridge.numberBuffer = number;
        }

        function currentLoader(captured) {
            return !connectionDisposed && captured === bridge.loader && captured === pageWindow.odoo?.loader;
        }

        function wrapServiceStart(service, accept) {
            if (!service || typeof service.start !== "function" || service.__pbBoxBridgePatched) return;
            const original = service.start;
            service.start = function (env, deps) {
                const captured = bridge.loader;
                if (currentLoader(captured)) {
                    try { adoptServices(env, deps); } catch (_) { /* Services may still be starting. */ }
                }
                const result = original.apply(this, arguments);
                const capture = value => {
                    if (!currentLoader(captured)) return;
                    try { adoptServices(env, deps); accept(value); setBridgeStatus(); scheduleConnection(); }
                    catch (_) { /* A startup probe must not reject the native service. */ }
                };
                if (result && typeof result.then === "function") result.then(capture, () => {});
                else capture(result);
                return result;
            };
            service.__pbBoxBridgePatched = true;
        }

        function patchBarcodeModule(module) {
            wrapServiceStart(module?.barcodeService, bindBarcodeService);
        }
        function patchBarcodeReaderModule(module) {
            wrapServiceStart(module?.barcodeReaderService, value => {
                if (typeof value?.scan === "function") bridge.barcodeReader = value;
            });
        }
        function patchNumberBufferModule(module) {
            wrapServiceStart(module?.numberBufferService, value => {
                if (typeof value?.reset === "function") bridge.numberBuffer = value;
            });
        }

        function patchPosStoreModule(module) {
            const PosStore = module?.PosStore;
            if (!PosStore || PosStore.prototype.__pbOwnedBoxScanV1) return;
            const original = PosStore.prototype.getOrder;
            if (typeof original !== "function") return;
            const captured = bridge.loader;
            Object.defineProperty(PosStore.prototype, "__pbOwnedBoxScanV1", { value: true });
            PosStore.prototype.getOrder = function (...args) {
                if (currentLoader(captured) && (bridge.posStore !== this || !bridgeReady())) {
                    try { adoptServices(this.env, null, this); setBridgeStatus(); }
                    catch (_) { /* Preserve the native getter even during partial setup. */ }
                }
                return original.apply(this, args);
            };
        }

        function patchStartedModule(moduleName, module) {
            if (moduleName === "@point_of_sale/app/services/pos_store") patchPosStoreModule(module);
            else if (moduleName === "@barcodes/barcode_service") patchBarcodeModule(module);
            else if (moduleName === "@point_of_sale/app/services/barcode_reader_service") patchBarcodeReaderModule(module);
            else if (moduleName === "@point_of_sale/app/services/number_buffer_service") patchNumberBufferModule(module);
        }

        function hookLoader(loader) {
            if (!loader || bridge.loader === loader) return;
            if (loaderListener) bridge.loader?.bus?.removeEventListener("module-started", loaderListener);
            bridge.loader = loader;
            for (const moduleName of [
                "@point_of_sale/app/services/pos_store", "@barcodes/barcode_service",
                "@point_of_sale/app/services/barcode_reader_service", "@point_of_sale/app/services/number_buffer_service",
            ]) patchStartedModule(moduleName, loader.modules?.get(moduleName));
            loaderListener = event => {
                if (!currentLoader(loader)) return;
                patchStartedModule(event.detail?.moduleName, event.detail?.module);
                checkConnection();
            };
            loader.bus?.addEventListener("module-started", loaderListener);
        }

        function scheduleConnection() {
            if (connectionDisposed || connectionTimer !== null) return;
            if (bridgeReady() || Date.now() >= connectionDeadline || pageDocument.hidden) return;
            connectionTimer = pageWindow.setTimeout(() => {
                connectionTimer = null;
                checkConnection();
            }, 250);
        }

        function checkConnection() {
            if (connectionDisposed || checkingConnection) return;
            checkingConnection = true;
            try {
                const odoo = pageWindow.odoo;
                const loader = odoo?.loader;
                if (observedOdoo !== odoo || (bridge.loader && loader !== bridge.loader)) {
                    observedOdoo = odoo;
                    bridge.barcodeReader = bridge.numberBuffer = bridge.posStore = null;
                    bridge.barcodeBus = null;
                    if (busHook && busHook.bus.dispatchEvent === busHook.wrapped) busHook.bus.dispatchEvent = busHook.original;
                    busHook = null;
                    if (loaderListener) bridge.loader?.bus?.removeEventListener("module-started", loaderListener);
                    bridge.loader = null;
                    loaderListener = null;
                }
                hookLoader(loader);
                const pos = pageWindow.posmodel;
                if (pos) adoptServices(pos.env, null, pos);
                adoptServices(odoo?.__WOWL_DEBUG__?.root?.env);
            } catch (_) { /* An incomplete loader is retried, not replaced or restarted. */ }
            finally { checkingConnection = false; }
            setBridgeStatus();
            if (bridgeReady() && connectionTimer !== null) {
                pageWindow.clearTimeout(connectionTimer); connectionTimer = null;
            }
            scheduleConnection();
        }

        function requestConnection() {
            if (connectionDisposed) return;
            connectionDeadline = Date.now() + 300000;
            checkConnection();
        }
        function onConnectionVisibility() {
            if (pageDocument.hidden && connectionTimer !== null) {
                pageWindow.clearTimeout(connectionTimer); connectionTimer = null;
            } else if (!pageDocument.hidden) requestConnection();
        }
        function onConnectionKeydown() {
            // No keyboard interception or quantity handling here: only identity checks.
            if (!bridgeReady() || observedOdoo !== pageWindow.odoo || bridge.loader !== pageWindow.odoo?.loader ||
                (pageWindow.posmodel && bridge.posStore !== pageWindow.posmodel)) checkConnection();
        }
        function disposeConnection() {
            connectionDisposed = true;
            if (connectionTimer !== null) pageWindow.clearTimeout(connectionTimer);
            connectionTimer = null;
            if (loaderListener) bridge.loader?.bus?.removeEventListener("module-started", loaderListener);
            pageDocument.removeEventListener(BRIDGE_CONNECT_EVENT, requestConnection);
            pageDocument.removeEventListener("visibilitychange", onConnectionVisibility);
            pageWindow.removeEventListener("keydown", onConnectionKeydown, true);
            if (busHook && busHook.bus.dispatchEvent === busHook.wrapped) busHook.bus.dispatchEvent = busHook.original;
        }
        pageDocument.addEventListener(BRIDGE_CONNECT_EVENT, requestConnection);
        pageDocument.addEventListener("visibilitychange", onConnectionVisibility);
        pageWindow.addEventListener("keydown", onConnectionKeydown, true);
        pageWindow.addEventListener("pagehide", event => { if (!event.persisted) disposeConnection(); else {
            if (connectionTimer !== null) pageWindow.clearTimeout(connectionTimer); connectionTimer = null;
        } });
        pageWindow.addEventListener("pageshow", event => { if (event.persisted) requestConnection(); });

        pageDocument.addEventListener(BRIDGE_COMMAND_EVENT, async () => {
            const root = rootElement();
            const raw = root?.getAttribute(BRIDGE_COMMAND_ATTR);
            root?.removeAttribute(BRIDGE_COMMAND_ATTR);
            if (!raw) return;

            let command;
            try {
                command = JSON.parse(raw);
            } catch (_) {
                dispatchBridgeError(t("脚本发给 Odoo 的命令格式错误"));
                return;
            }

            if (command.type === "owned_cancel") {
                cancelOwnedTask(command.taskId);
                return;
            }
            if (command.type === "owned_scan" || command.type === "owned_set_quantity") {
                try {
                    const value = command.type === "owned_scan"
                        ? await ownedProductScan(command)
                        : ownedSetQuantity(command);
                    dispatchBridgeResult({ taskId: command.taskId, ok: true, value });
                } catch (error) {
                    dispatchBridgeResult({ taskId: command.taskId, ok: false,
                        error: String(error?.message || error), code: String(error?.code || "") });
                }
                return;
            }

            if (command.type === "scan") {
                if (!bridge.barcodeReader) {
                    dispatchBridgeError(t("Odoo 商品扫码服务尚未准备好"));
                    return;
                }
                Promise.resolve(bridge.barcodeReader.scan(String(command.code || "")))
                    .catch((error) => dispatchBridgeError(error?.message || error));
                return;
            }

            if (command.type === "set_number") {
                const value = String(command.value ?? "");
                if (!bridge.numberBuffer || !/^-?\d+$/.test(value)) {
                    dispatchBridgeError(t("Odoo 数量服务尚未准备好或数量无效"));
                    return;
                }
                try {
                    clearNumberBufferEvents();
                    for (const character of value) {
                        bridge.numberBuffer.sendKey(character);
                    }
                    // capture(true) 可让 Odoo 一次处理任意位数，避免 120 等三位数
                    // 因输入过快被官方防扫码规则丢弃。
                    bridge.numberBuffer.capture();
                } catch (error) {
                    dispatchBridgeError(error?.message || error);
                }
            }
        });

        requestConnection();
    }

    function syncNativeBridgeCodes() {
        const root = document.documentElement;
        if (!root) return;
        const codes = state.mappings
            .filter((mapping) => mapping.enabled)
            .flatMap((mapping) => mapping.boxCodes);
        root.setAttribute(BRIDGE_BOX_CODES_ATTR, JSON.stringify([...new Set(codes)]));
        document.dispatchEvent(new Event(BRIDGE_CONNECT_EVENT));
    }

    function bridgeStatusParts() {
        return new Set(
            String(document.documentElement?.getAttribute(BRIDGE_READY_ATTR) || "")
                .split(",")
                .filter(Boolean)
        );
    }

    function sendOdooBridgeCommand(command, requiredPart) {
        const root = document.documentElement;
        if (!root || (requiredPart && !bridgeStatusParts().has(requiredPart))) return false;
        root.setAttribute(BRIDGE_COMMAND_ATTR, JSON.stringify(command));
        document.dispatchEvent(new Event(BRIDGE_COMMAND_EVENT));
        return true;
    }

    function sendOwnedOdooBridgeCommand(command, timeoutMs = 5000) {
        const root = document.documentElement;
        if (!root || !bridgeStatusParts().has("reader")) return Promise.reject(Object.assign(new Error(t("Odoo 原生扫码桥接尚未准备好")), {code:"BRIDGE_NOT_READY"}));
        return new Promise((resolve, reject) => {
            let timer;
            const finish = () => {
                const raw = root.getAttribute(BRIDGE_RESULT_ATTR);
                if (!raw) return;
                let result;
                try { result = JSON.parse(raw); } catch (_) { return; }
                if (String(result.taskId || "") !== String(command.taskId || "")) return;
                if (result.pending) return;
                root.removeAttribute(BRIDGE_RESULT_ATTR);
                document.removeEventListener(BRIDGE_RESULT_EVENT, finish);
                clearTimeout(timer);
                if (result.ok) resolve(result.value);
                else reject(Object.assign(new Error(result.error || t("Odoo 操作失败")), {code:result.code || "BRIDGE_FAILED"}));
            };
            document.addEventListener(BRIDGE_RESULT_EVENT, finish);
            timer = setTimeout(() => {
                // Timeout requests cancellation; it is NOT proof that nothing happened.
                // Keep both the listener and queue lock until the bridge acknowledges
                // cancellation-before-write or the native call actually settles.
                showToast(uiLanguage === "es-MX" ? "Resultado pendiente; no repita el escaneo ni recargue" : "扫码结果仍在核对，请勿重复扫码或刷新页面", "working", 15000);
                sendOdooBridgeCommand({type:"owned_cancel", taskId:command.taskId}, "reader");
            }, timeoutMs);
            if (!sendOdooBridgeCommand(command, "reader")) {
                clearTimeout(timer); document.removeEventListener(BRIDGE_RESULT_EVENT, finish);
                reject(Object.assign(new Error(t("Odoo 原生扫码桥接尚未准备好")), {code:"BRIDGE_NOT_READY"}));
            }
        });
    }

    function handleOdooNativeBoxScan(event) {
        if (state.modalOpen) return;
        const detail = event.detail && typeof event.detail === "object" ? event.detail : { barcode: event.detail };
        const scannedCode = normalizeCode(detail.barcode);
        const match = getActiveScanMatch(scannedCode);
        if (!match) return;

        enqueueMapping(
            match.mapping,
            detail.context ? { orderUuid: detail.context.orderUuid, snapshot: detail.context.lineUuid ? detail.context : null, nativeIntercepted: true } : null,
            match.quantity,
            match.kind,
            match.scannedCode
        );
    }

    function handleOdooBridgeError(event) {
        const message = String(event.detail || t("Odoo 原生扫码桥接发生错误"));
        console.error("[PB 小盒码]", message);
        if (!state.bridgeErrorShown) {
            state.bridgeErrorShown = true;
            showToast(t("扫码桥接错误：{0}", message), "error", 5000);
        }
    }

    function describeElement(element) {
        if (!element) return null;
        if (element === window) return "window";
        if (element === document) return "document";
        if (!(element instanceof Element)) {
            return Object.prototype.toString.call(element);
        }

        const id = element.id ? `#${element.id}` : "";
        const classes = Array.from(element.classList || []).slice(0, 5);
        const classText = classes.length ? `.${classes.join(".")}` : "";
        const attributes = {};
        for (const name of ["type", "name", "role", "data-product-id", "data-id"]) {
            const value = element.getAttribute?.(name);
            if (value) attributes[name] = value;
        }
        return {
            selector: `${element.tagName.toLowerCase()}${id}${classText}`,
            editable: isEditableElement(element),
            attributes,
        };
    }

    function describeOrderlineSnapshot(snapshot = getSelectedOrderlineSnapshot()) {
        if (!snapshot) return null;
        return {
            quantity: snapshot.quantity,
            element: describeElement(snapshot.element),
            text: String(snapshot.element?.textContent || "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 180),
        };
    }

    function blockedKeyupSummary() {
        return Array.from(state.blockedKeyups.entries()).reduce((result, [key, tokens]) => {
            result[key] = tokens.length;
            return result;
        }, {});
    }

    function keepDebugWindowAlive(durationMs = 8000) {
        if (!DEBUG_ENABLED) return;
        state.debugRecentUntil = Math.max(state.debugRecentUntil, performance.now() + durationMs);
    }

    function isDebugWindowActive() {
        return DEBUG_ENABLED && Boolean(
            state.interceptingCandidate ||
            state.replaying ||
            state.releaseSinkOnEnterKeyup ||
            performance.now() <= state.debugRecentUntil
        );
    }

    function debugLog(label, details = {}) {
        if (!DEBUG_ENABLED) return;
        const elapsed = state.debugStartedAt
            ? Math.round((performance.now() - state.debugStartedAt) * 10) / 10
            : null;
        const record = {
            seq: ++state.debugEventSeq,
            scanId: state.debugScanId || null,
            elapsedMs: elapsed,
            ...details,
        };
        let serialized;
        try {
            serialized = JSON.stringify(record);
        } catch (error) {
            serialized = JSON.stringify({
                seq: record.seq,
                scanId: record.scanId,
                elapsedMs: record.elapsedMs,
                serializationError: String(error),
            });
        }
        console.log(`[${DEBUG_PREFIX}] ${label} ${serialized}`);
    }

    function debugEvent(label, event, extra = {}) {
        if (!isDebugWindowActive()) return;
        debugLog(label, {
            type: event.type,
            key: event.key,
            code: event.code,
            isTrusted: event.isTrusted,
            eventPhase: event.eventPhase,
            defaultPrevented: event.defaultPrevented,
            cancelBubble: event.cancelBubble,
            target: describeElement(event.target),
            activeElement: describeElement(document.activeElement),
            buffer: state.buffer,
            interceptingCandidate: state.interceptingCandidate,
            releaseSinkOnEnterKeyup: state.releaseSinkOnEnterKeyup,
            forwardingRaw: state.forwardingRaw,
            replaying: state.replaying,
            blockedKeyups: blockedKeyupSummary(),
            selectedOrderline: describeOrderlineSnapshot(),
            ...extra,
        });
    }

    function startDebugScan(event) {
        if (!DEBUG_ENABLED) return;
        state.debugScanId += 1;
        state.debugStartedAt = performance.now();
        state.debugEventSeq = 0;
        keepDebugWindowAlive();
        state.debugLastQuantitySignature = getDebugQuantitySignature();
        debugLog("SCAN START / 识别到可能的盒码首字符", {
            event: {
                key: event.key,
                code: event.code,
                isTrusted: event.isTrusted,
                target: describeElement(event.target),
            },
            activeElement: describeElement(document.activeElement),
            selectedOrderline: describeOrderlineSnapshot(),
            activeMappings: state.mappings
                .filter((mapping) => mapping.enabled)
                .map((mapping) => ({
                    name: mapping.name,
                    boxCodes: mapping.boxCodes,
                    unitCode: mapping.unitCode,
                    boxCodeIsProductCode: mapping.boxCodeIsProductCode,
                    quantity: mapping.quantity,
                })),
            timing: {
                maxNativeScanGapMs: MAX_NATIVE_SCAN_GAP_MS,
                candidateHoldMs: CANDIDATE_HOLD_MS,
                forwardDelayMs: FORWARD_DELAY_MS,
            },
        });
    }

    function getDebugQuantitySignature() {
        const snapshot = getSelectedOrderlineSnapshot();
        if (!snapshot) return "none";
        const productText = String(snapshot.element?.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 100);
        return `${snapshot.quantity}|${productText}`;
    }

    function detectAndLogQuantityChange(source) {
        if (!DEBUG_ENABLED) return;
        const currentSignature = getDebugQuantitySignature();
        if (isDebugWindowActive() && currentSignature !== state.debugLastQuantitySignature) {
            debugLog("QUANTITY CHANGE / 购物车选中行发生变化", {
                source,
                previousSignature: state.debugLastQuantitySignature,
                currentSignature,
                selectedOrderline: describeOrderlineSnapshot(),
                activeElement: describeElement(document.activeElement),
                buffer: state.buffer,
                interceptingCandidate: state.interceptingCandidate,
                replaying: state.replaying,
            });
        }
        state.debugLastQuantitySignature = currentSignature;
    }

    function normalizeCode(value) {
        return String(value ?? "").trim();
    }

    function normalizeCodeList(value) {
        const rawItems = Array.isArray(value) ? value : [value];
        const codes = rawItems
            .flatMap((item) => String(item ?? "").split(/[\n\r,，;；]+/))
            .map(normalizeCode)
            .filter(Boolean);
        return [...new Set(codes)];
    }

    function makeId() {
        if (window.crypto?.randomUUID) {
            return window.crypto.randomUUID();
        }
        return `pb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function normalizeMapping(raw) {
        const quantity = Math.trunc(Number(raw?.quantity));
        const boxCodes = normalizeCodeList(raw?.boxCodes ?? raw?.boxCode);
        const boxCodeIsProductCode = Boolean(
            raw?.boxCodeIsProductCode ?? raw?.boxCodeIsUnitCode ?? raw?.useBoxCodeAsProductCode
        );
        // V5 曾允许多个单品码；V5.2 起固定为一个 Odoo 主单品码。
        // 读取旧设置/备份时自动保留原列表的第一条，避免升级后丢失现有配置。
        const legacyUnitCodes = normalizeCodeList(raw?.unitCodes ?? raw?.unitCode);
        const unitCode = boxCodeIsProductCode
            ? ""
            : (normalizeCode(raw?.unitCode) || legacyUnitCodes[0] || "");
        return {
            id: String(raw?.id || makeId()),
            name: String(raw?.name || "").trim(),
            boxCodes,
            boxCode: boxCodes[0] || "",
            unitCode,
            boxCodeIsProductCode,
            quantity: Number.isFinite(quantity) ? quantity : 1,
            enabled: raw?.enabled !== false,
            note: String(raw?.note || "").trim(),
            source: raw?.source === "remote" ? "remote" : "local",
        };
    }

    function loadMappings() {
        try {
            const stored = typeof GM_getValue === "function"
                ? PBBoxPrefs.get(STORAGE_KEY, null)
                : null;
            if (Array.isArray(stored)) {
                return stored.map(normalizeMapping).filter(isValidStoredMapping);
            }

            // 自动迁移第一版保存在 Odoo 网站 localStorage 里的设置。
            const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
            const legacy = legacyRaw ? JSON.parse(legacyRaw) : [];
            const migrated = Array.isArray(legacy)
                ? legacy.map(normalizeMapping).filter(isValidStoredMapping)
                : [];
            if (migrated.length && typeof GM_setValue === "function") {
                PBBoxPrefs.set(STORAGE_KEY, migrated);
                console.info(`[PB 小盒码] 已从第一版迁移 ${migrated.length} 个对应关系。`);
            }
            return migrated;
        } catch (error) {
            console.error("[PB 小盒码] 读取设置失败：", error);
            return [];
        }
    }

    function isValidStoredMapping(item) {
        return Boolean(
            item.boxCodes?.length &&
            (item.boxCodeIsProductCode || item.unitCode) &&
            (item.boxCodeIsProductCode || !item.boxCodes.includes(item.unitCode)) &&
            Number.isInteger(item.quantity) &&
            item.quantity >= 1 &&
            item.quantity <= MAX_QUANTITY
        );
    }

    function seedRemoteCacheIfMissing() {
        const marker="pb-suite:barcode-cache-import:v1";
        if (PBBoxPrefs.get(REMOTE_CACHE_KEY,null)!==null || PBBoxPrefs.get(marker,false)) return;
        const backup=pbBarcodeCacheBackup;
        if(backup.sourceUrl!==REMOTE_CSV_URL || !Array.isArray(backup.mappings) ||
            !backup.mappings.length || !backup.mappings.every(item=>isValidStoredMapping(normalizeMapping(item)))) {
            throw new Error(pbUiText("备份条码缓存未通过校验；原备份保留。","La caché de respaldo no pasó la validación; se conserva el respaldo."));
        }
        PBBoxPrefs.set(REMOTE_CACHE_KEY,backup);
        if(JSON.stringify(PBBoxPrefs.get(REMOTE_CACHE_KEY,null))!==JSON.stringify(backup))
            throw new Error(pbUiText("备份条码缓存恢复未确认。","No se confirmó la restauración de la caché."));
        PBBoxPrefs.set(marker,true);
    }
    function loadRemoteCache() {
        const empty = {
            mappings: [],
            fetchedAt: "",
            appliedAt: "",
            sourceUrl: "",
        };
        try {
            seedRemoteCacheIfMissing();
            const stored = typeof GM_getValue === "function"
                ? PBBoxPrefs.get(REMOTE_CACHE_KEY, null)
                : null;
            if (!stored || typeof stored !== "object") return empty;
            const mappings = Array.isArray(stored.mappings)
                ? stored.mappings
                    .map((item) => normalizeMapping({ ...item, source: "remote" }))
                    .filter(isValidStoredMapping)
                : [];
            return {
                mappings,
                fetchedAt: String(stored.fetchedAt || ""),
                appliedAt: String(stored.appliedAt || ""),
                sourceUrl: String(stored.sourceUrl || ""),
            };
        } catch (error) {
            console.error("[PB 小盒码] 读取在线缓存失败：", error);
            pbPreferenceError(error);
            return empty;
        }
    }

    function saveRemoteCache(mappings, fetchedAt = new Date().toISOString()) {
        const normalized = mappings
            .map((item) => normalizeMapping({ ...item, source: "remote" }))
            .filter(isValidStoredMapping);
        const nextCache = {
            mappings: normalized,
            fetchedAt,
            appliedAt: new Date().toISOString(),
            sourceUrl: REMOTE_CSV_URL,
        };
        if (typeof GM_setValue === "function") {
            PBBoxPrefs.set(REMOTE_CACHE_KEY, nextCache);
            if (JSON.stringify(PBBoxPrefs.get(REMOTE_CACHE_KEY, null)) !== JSON.stringify(nextCache)) {
                throw new Error(pbUiText("在线条码保存未确认；继续使用原缓存。","No se confirmó el guardado; se sigue usando la caché anterior."));
            }
        } else {
            throw new Error(pbUiText("无法保存在线条码；继续使用原缓存。","No se pueden guardar los códigos; se conserva la caché anterior."));
        }
        state.remoteMappings = normalized;
        state.remoteCache = nextCache;
        refreshEffectiveMappings();
    }

    function refreshEffectiveMappings() {
        const effective = state?.localMappings
            ? state.localMappings.map((item) => normalizeMapping({ ...item, source: "local" }))
            : initialLocalMappings.map((item) => normalizeMapping({ ...item, source: "local" }));
        const remote = state?.remoteMappings || initialRemoteCache.mappings;
        for (const item of remote) {
            if (findMappingCodeConflict(item, effective)) continue;
            effective.push(normalizeMapping({ ...item, source: "remote" }));
        }
        if (state) {
            state.mappings = effective;
        }
        syncNativeBridgeCodes();
        updateSettingsButton();
        updateRemoteStatus();
    }

    function saveMappings() {
        if (typeof GM_setValue === "function") {
            PBBoxPrefs.set(STORAGE_KEY, state.localMappings);
        } else {
            // 兼容不支持 GM 存储的脚本管理器。
            localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(state.localMappings));
        }
        refreshEffectiveMappings();
    }

    function mappingLabel(mapping) {
        return mapping?.name || mapping?.unitCode || mapping?.boxCode || t("未命名商品");
    }

    function findMappingCodeConflict(mapping, otherMappings) {
        for (const boxCode of mapping.boxCodes) {
            const boxOwner = otherMappings.find((item) => item.boxCodes.includes(boxCode));
            if (boxOwner) {
                return {
                    code: boxCode,
                    message: t("包装条码 {0} 已经用于“{1}”。", boxCode, mappingLabel(boxOwner)),
                };
            }

            const unitOwner = otherMappings.find(
                (item) => !item.boxCodeIsProductCode && item.unitCode === boxCode
            );
            // 自身模式中的盒码就是 Odoo 商品识别码，因此允许其他包装记录
            // 把它作为 unitCode 引用；普通包装码则不能占用已有的商品识别码。
            if (unitOwner && !mapping.boxCodeIsProductCode) {
                return {
                    code: boxCode,
                    message: t("包装条码 {0} 已经是“{1}”的 Odoo 商品识别码。", boxCode, mappingLabel(unitOwner)),
                };
            }
        }

        if (!mapping.boxCodeIsProductCode && mapping.unitCode) {
            const incompatibleBoxOwner = otherMappings.find(
                (item) => item.boxCodes.includes(mapping.unitCode) && !item.boxCodeIsProductCode
            );
            if (incompatibleBoxOwner) {
                return {
                    code: mapping.unitCode,
                    message: t("商品识别码 {0} 已经是“{1}”的普通包装条码。", mapping.unitCode, mappingLabel(incompatibleBoxOwner)),
                };
            }
        }

        // 多条包装记录可以共用同一个 unitCode；也允许 unitCode 指向另一条
        // “盒码本身就是 Odoo 商品码”的记录，以支持 4 个装与 40 个装共用商品。
        return null;
    }

    function isRemoteConfigured() {
        return /^https:\/\/docs\.google\.com\/spreadsheets\//i.test(REMOTE_CSV_URL);
    }

    function parseCsv(text) {
        const rows = [];
        let row = [];
        let value = "";
        let quoted = false;
        const source = String(text || "").replace(/^\uFEFF/, "");
        for (let index = 0; index < source.length; index += 1) {
            const character = source[index];
            if (quoted) {
                if (character === '"' && source[index + 1] === '"') {
                    value += '"';
                    index += 1;
                } else if (character === '"') {
                    quoted = false;
                } else {
                    value += character;
                }
                continue;
            }
            if (character === '"') {
                quoted = true;
            } else if (character === ",") {
                row.push(value);
                value = "";
            } else if (character === "\n") {
                row.push(value.replace(/\r$/, ""));
                rows.push(row);
                row = [];
                value = "";
            } else {
                value += character;
            }
        }
        if (value || row.length) {
            row.push(value.replace(/\r$/, ""));
            rows.push(row);
        }
        return rows;
    }

    function normalizeHeader(value) {
        return String(value || "")
            .replace(/\s+/g, "")
            .replace(/[（）()_-]/g, "")
            .toLowerCase();
    }

    function booleanCell(value, defaultValue = false) {
        const normalized = String(value ?? "").trim().toLowerCase();
        if (!normalized) return defaultValue;
        if (["是", "启用", "true", "yes", "y", "1", "si", "sí"].includes(normalized)) {
            return true;
        }
        if (["否", "停用", "false", "no", "n", "0"].includes(normalized)) {
            return false;
        }
        return null;
    }

    function parseRemoteMappings(csvText) {
        const rows = parseCsv(csvText);
        const errors = [];
        if (!rows.length) {
            return { mappings: [], errors: [t("在线表格没有任何内容。")] };
        }
        const headerIndexes = new Map();
        rows[0].forEach((header, index) => headerIndexes.set(normalizeHeader(header), index));
        const aliases = {
            name: ["商品名称", "名称", "name"],
            boxCode: ["包装码", "小盒条码", "boxcode", "barcode"],
            unitCode: ["odoo商品识别码", "商品识别码", "单品码", "unitcode", "productcode"],
            quantity: ["每扫增加数量", "数量", "quantity", "qty"],
            boxIsProduct: [
                "包装码本身就是odoo商品码",
                "包装码就是商品码",
                "boxcodeisproductcode",
            ],
            enabled: ["启用", "enabled", "active"],
            note: ["备注", "note"],
        };
        const findColumn = (keys) => {
            for (const key of keys) {
                const index = headerIndexes.get(normalizeHeader(key));
                if (Number.isInteger(index)) return index;
            }
            return -1;
        };
        const columns = Object.fromEntries(
            Object.entries(aliases).map(([key, values]) => [key, findColumn(values)])
        );
        for (const required of ["boxCode", "quantity", "boxIsProduct", "enabled"]) {
            if (columns[required] < 0) {
                errors.push(t("第一行缺少必要列：{0}", aliases[required][0]));
            }
        }
        if (errors.length) return { mappings: [], errors };

        const mappings = [];
        const seenCodes = new Map();
        for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
            const row = rows[rowIndex];
            if (!row.some((cell) => String(cell || "").trim())) continue;
            const rowNumber = rowIndex + 1;
            const cell = (column) => column >= 0 ? String(row[column] ?? "").trim() : "";
            const boxCode = normalizeCode(cell(columns.boxCode));
            const unitCode = normalizeCode(cell(columns.unitCode));
            const quantity = Number(cell(columns.quantity));
            const boxCodeIsProductCode = booleanCell(cell(columns.boxIsProduct), false);
            const enabled = booleanCell(cell(columns.enabled), true);
            const rowErrors = [];
            if (!boxCode) rowErrors.push(t("包装码为空"));
            if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
                rowErrors.push(t("数量必须是 1–{0} 的整数", MAX_QUANTITY));
            }
            if (boxCodeIsProductCode === null) {
                rowErrors.push(t("“包装码本身就是Odoo商品码”只能填写是或否"));
            }
            if (enabled === null) rowErrors.push(t("“启用”只能填写是或否"));
            if (boxCodeIsProductCode === false && !unitCode) {
                rowErrors.push(t("普通模式必须填写 Odoo 商品识别码"));
            }
            if (boxCodeIsProductCode === false && unitCode === boxCode) {
                rowErrors.push(t("普通模式下包装码不能与商品识别码相同"));
            }
            if (seenCodes.has(boxCode)) {
                rowErrors.push(t("包装码与第 {0} 行重复", seenCodes.get(boxCode)));
            }
            if (rowErrors.length) {
                errors.push(t("第 {0} 行（{1}）：{2}", rowNumber, boxCode || t("无包装码"), rowErrors.join("; ")));
                continue;
            }
            seenCodes.set(boxCode, rowNumber);
            mappings.push(normalizeMapping({
                id: `remote:${boxCode}`,
                name: cell(columns.name),
                boxCodes: [boxCode],
                unitCode,
                boxCodeIsProductCode,
                quantity,
                enabled,
                note: cell(columns.note),
                source: "remote",
            }));
        }
        return { mappings, errors };
    }

    function mappingFingerprint(mapping) {
        return JSON.stringify({
            name: mapping.name,
            boxCode: mapping.boxCodes[0] || "",
            unitCode: mapping.unitCode,
            boxCodeIsProductCode: mapping.boxCodeIsProductCode,
            quantity: mapping.quantity,
            enabled: mapping.enabled,
            note: mapping.note || "",
        });
    }

    function diffRemoteMappings(previous, next) {
        const previousByCode = new Map(previous.map((item) => [item.boxCodes[0], item]));
        const nextByCode = new Map(next.map((item) => [item.boxCodes[0], item]));
        const added = [];
        const modified = [];
        const removed = [];
        for (const [code, item] of nextByCode) {
            if (!previousByCode.has(code)) {
                added.push(item);
            } else if (mappingFingerprint(previousByCode.get(code)) !== mappingFingerprint(item)) {
                modified.push({ previous: previousByCode.get(code), next: item });
            }
        }
        for (const [code, item] of previousByCode) {
            if (!nextByCode.has(code)) removed.push(item);
        }
        return { added, modified, removed };
    }

    function remoteLocalConflicts(mappings) {
        return mappings
            .map((remote) => {
                const local = state.localMappings.find((candidate) =>
                    Boolean(findMappingCodeConflict(remote, [candidate]))
                );
                return local
                    ? {
                        remote,
                        local,
                        message: findMappingCodeConflict(remote, [local])?.message || t("条码冲突"),
                    }
                    : null;
            })
            .filter(Boolean);
    }

    function withoutConflictingLocalMapping(remote, localMappings) {
        const updated = [];
        for (const local of localMappings) {
            const conflict = findMappingCodeConflict(remote, [local]);
            if (!conflict) {
                updated.push(local);
                continue;
            }
            const remoteCodes = new Set(remote.boxCodes);
            const remainingCodes = local.boxCodes.filter((code) => !remoteCodes.has(code));
            if (remainingCodes.length && remainingCodes.length !== local.boxCodes.length) {
                updated.push(normalizeMapping({
                    ...local,
                    boxCodes: remainingCodes,
                    boxCode: remainingCodes[0],
                    source: "local",
                }));
            }
            // 其他类型的冲突需要整条删除，才能真正让在线记录生效。
        }
        return updated;
    }

    function requestRemoteCsv() {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== "function") {
                reject(new Error(t("当前 Tampermonkey 不支持在线请求")));
                return;
            }
            let settled = false;
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                window.clearTimeout(watchdogTimer);
                callback(value);
            };
            // 某些 Tampermonkey/网络组合偶尔不会触发 ontimeout，增加独立保险计时。
            const watchdogTimer = window.setTimeout(() => {
                finish(reject, new Error(t("读取 Google 表格超时")));
            }, 15000);
            GM_xmlhttpRequest({
                method: "GET",
                url: REMOTE_CSV_URL,
                timeout: 12000,
                headers: { Accept: "text/csv,text/plain,*/*" },
                onload(response) {
                    if (response.status >= 200 && response.status < 300) {
                        finish(resolve, String(response.responseText || ""));
                    } else {
                        finish(reject, new Error(t("Google 表格返回 HTTP {0}", response.status)));
                    }
                },
                ontimeout() {
                    finish(reject, new Error(t("读取 Google 表格超时")));
                },
                onerror() {
                    finish(reject, new Error(t("无法连接 Google 表格")));
                },
            });
        });
    }

    async function sha256Hex(value) {
        const bytes = new TextEncoder().encode(String(value || ""));
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return [...new Uint8Array(digest)]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
    }

    function requestMaskedAdminPassword(reason) {
        return new Promise((resolve) => {
            document.getElementById("pb-box-password-modal")?.remove();

            const overlay = document.createElement("div");
            overlay.id = "pb-box-password-modal";
            overlay.innerHTML = `
                <form class="pb-box-password-card" autocomplete="off">
                    <h3><span data-pb-i18n="管理员验证">${escapeHtml(t("管理员验证"))}</span></h3>
                    <p>${escapeHtml(reason)}</p>
                    <label for="pb-box-admin-password"><span data-pb-i18n="管理员密码">${escapeHtml(t("管理员密码"))}</span></label>
                    <input id="pb-box-admin-password" type="password" autocomplete="new-password" spellcheck="false" required>
                    <small><span data-pb-i18n="输入内容会以圆点隐藏。">${escapeHtml(t("输入内容会以圆点隐藏。"))}</span></small>
                    <div class="pb-box-password-actions">
                        <button type="button" class="pb-box-secondary" data-password-action="cancel"><span data-pb-i18n="取消">${escapeHtml(t("取消"))}</span></button>
                        <button type="submit" class="pb-box-primary"><span data-pb-i18n="确认">${escapeHtml(t("确认"))}</span></button>
                    </div>
                </form>
            `;

            const finish = (value) => {
                document.removeEventListener("keydown", handleEscape, true);
                overlay.remove();
                resolve(value);
            };
            const handleEscape = (event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopImmediatePropagation();
                finish(null);
            };

            overlay.querySelector("form")?.addEventListener("submit", (event) => {
                event.preventDefault();
                finish(overlay.querySelector("#pb-box-admin-password")?.value || "");
            });
            overlay.querySelector('[data-password-action="cancel"]')?.addEventListener("click", () => finish(null));
            document.addEventListener("keydown", handleEscape, true);
            document.body.appendChild(overlay);
            window.setTimeout(() => overlay.querySelector("#pb-box-admin-password")?.focus(), 0);
        });
    }

    async function verifyAdminPassword(reason) {
        const password = await requestMaskedAdminPassword(reason);
        if (password === null) return false;
        try {
            const valid = await sha256Hex(password) === ADMIN_PASSWORD_SHA256;
            if (!valid) showToast(t("管理员密码错误"), "error", 2600);
            return valid;
        } catch (error) {
            console.error("[PB 小盒码] 密码校验失败：", error);
            showToast(t("当前浏览器无法校验管理员密码"), "error", 3500);
            return false;
        }
    }

    function formatMappingSummary(mapping) {
        return t("{0}｜包装码 {1}｜数量 {2}", mapping.name || t("未命名"), mapping.boxCodes[0], mapping.quantity);
    }

    function updateRemoteStatus() {
        const status = document.getElementById("pb-box-remote-status");
        const button = document.getElementById("pb-box-sync-now");
        if (button) {
            button.disabled = state.remoteSyncing;
            button.textContent = state.remoteSyncing ? t("正在检查…") : t("立即检查更新");
        }
        if (!status) return;
        if (!isRemoteConfigured()) {
            status.textContent = t("在线表格：尚未写入发布后的 CSV 地址");
            status.className = "pb-box-remote-status pb-error-text";
            return;
        }
        if (state.remoteSyncing) {
            status.textContent = t("在线表格：正在检查更新…");
            status.className = "pb-box-remote-status";
            return;
        }
        if (state.remoteLastError) {
            status.textContent = t("在线表格：更新失败，继续使用缓存（{0}）", state.remoteLastError);
            status.className = "pb-box-remote-status pb-error-text";
            return;
        }
        const applied = state.remoteCache?.appliedAt
            ? new Date(state.remoteCache.appliedAt).toLocaleString(uiLanguage)
            : t("尚未成功同步");
        status.textContent = t("在线表格：{0} 条｜上次应用 {1}", state.remoteMappings.length, applied);
        status.className = "pb-box-remote-status";
    }

    async function syncRemoteMappings({ manual = false } = {}) {
        if (state.remoteSyncing) {
            if (manual) showToast(t("正在检查在线条码，请稍候"), "working", 1800);
            return;
        }
        if (!isRemoteConfigured()) {
            if (manual) {
                showToast(t("请先把 Google Sheets 发布后的 CSV 地址写入脚本顶部"), "error", 5200);
            }
            updateRemoteStatus();
            return;
        }

        state.remoteSyncing = true;
        state.remoteLastError = "";
        updateRemoteStatus();
        if (manual) showToast(t("正在读取在线条码…"), "working");

        try {
            const csvText = await requestRemoteCsv();
            const parsed = parseRemoteMappings(csvText);
            // Empty or malformed responses are not an instruction to erase
            // the last working table. Do not offer a partial-data overwrite.
            if (parsed.errors.length || !parsed.mappings.length) {
                throw new Error(pbUiText(
                    "在线表格为空或含错误；已保留上次有效条码，请修正表格后重试。",
                    "La tabla está vacía o contiene errores. Se conservaron los códigos anteriores; corrige la tabla y vuelve a intentar."));
            }
            let candidate = parsed.mappings;
            const initialDiff = diffRemoteMappings(state.remoteMappings, candidate);
            const initialConflicts = remoteLocalConflicts(candidate);

            if (
                !parsed.errors.length &&
                !initialConflicts.length &&
                !initialDiff.added.length &&
                !initialDiff.modified.length &&
                !initialDiff.removed.length
            ) {
                state.remoteCache.fetchedAt = new Date().toISOString();
                if (typeof GM_setValue === "function") {
                    PBBoxPrefs.set(REMOTE_CACHE_KEY, state.remoteCache);
                }
                if (manual) showToast(t("在线条码已经是最新版本"), "success", 2200);
                return;
            }

            if (parsed.errors.length) {
                const detail = parsed.errors.slice(0, 15).join("\n");
                const more = parsed.errors.length > 15
                    ? t("\n……另有 {0} 个错误", parsed.errors.length - 15)
                    : "";
                const skipInvalid = window.confirm(
                    t("在线表格发现 {0} 个错误：\n\n{1}{2}\n\n确定＝跳过错误行并继续；取消＝取消整次更新并继续使用旧数据。", parsed.errors.length, detail, more)
                );
                if (!skipInvalid) return;
            }

            let nextLocalMappings = state.localMappings;
            const conflicts = remoteLocalConflicts(candidate);
            for (const conflict of conflicts) {
                const useOnline = window.confirm(
                    t("发现在线与本地特殊设置冲突：\n\n在线：{0}\n本地：{1}\n原因：{2}\n\n确定＝使用在线数据并删除冲突的本地设置；取消＝保留本地设置并跳过这条在线数据。", formatMappingSummary(conflict.remote), formatMappingSummary(conflict.local), conflict.message)
                );
                if (useOnline) {
                    nextLocalMappings = withoutConflictingLocalMapping(
                        conflict.remote,
                        nextLocalMappings
                    );
                } else {
                    candidate = candidate.filter(
                        (item) => item.boxCodes[0] !== conflict.remote.boxCodes[0]
                    );
                }
            }

            const deletionDiff = diffRemoteMappings(state.remoteMappings, candidate);
            if (deletionDiff.removed.length) {
                const details = deletionDiff.removed
                    .slice(0, 15)
                    .map(formatMappingSummary)
                    .join("\n");
                const more = deletionDiff.removed.length > 15
                    ? t("\n……另有 {0} 条", deletionDiff.removed.length - 15)
                    : "";
                const applyDeletions = window.confirm(
                    t("在线表格删除或跳过了 {0} 条现有在线数据：\n\n{1}{2}\n\n确定＝从本机在线缓存删除；取消＝保留这些旧缓存数据。", deletionDiff.removed.length, details, more)
                );
                if (!applyDeletions) {
                    const existingCodes = new Set(candidate.map((item) => item.boxCodes[0]));
                    for (const item of deletionDiff.removed) {
                        if (!existingCodes.has(item.boxCodes[0])) candidate.push(item);
                    }
                }
            }

            const finalDiff = diffRemoteMappings(state.remoteMappings, candidate);
            const confirmUpdate = window.confirm(
                t("在线条码有变化：\n新增 {0} 条\n修改 {1} 条\n删除 {2} 条\n\n是否确认更新？", finalDiff.added.length, finalDiff.modified.length, finalDiff.removed.length)
            );
            if (!confirmUpdate) return;

            const normalizedRemote=candidate
                .map(item=>normalizeMapping({...item,source:"remote"}))
                .filter(isValidStoredMapping);
            const nextRemoteCache={mappings:normalizedRemote,fetchedAt:new Date().toISOString(),
                appliedAt:new Date().toISOString(),sourceUrl:REMOTE_CSV_URL};
            pbBarcodeTransaction.commit([nextLocalMappings,nextRemoteCache]);
            state.localMappings=nextLocalMappings;
            state.remoteMappings=normalizedRemote;
            state.remoteCache=nextRemoteCache;
            refreshEffectiveMappings();
            renderMappingList();
            showToast(
                t("在线更新完成：新增 {0}，修改 {1}，删除 {2}", finalDiff.added.length, finalDiff.modified.length, finalDiff.removed.length),
                "success",
                3600
            );
        } catch (error) {
            state.remoteLastError = error?.message || String(error);
            console.error("[PB 小盒码] 在线同步失败：", error);
            showToast(
                t("在线同步失败，继续使用上次缓存：{0}", state.remoteLastError),
                "error",
                manual ? 6000 : 4200
            );
        } finally {
            state.remoteSyncing = false;
            updateRemoteStatus();
            hideToast("working");
        }
    }

    function getInterceptCodes(mapping) {
        // 只拦截小盒码；固定单品码始终完全交给 Odoo 原生扫码。
        return mapping.boxCodes;
    }

    function getActiveScanMatch(scannedCode) {
        for (const mapping of state.mappings) {
            if (!mapping.enabled) continue;
            if (mapping.boxCodes.includes(scannedCode)) {
                return { mapping, quantity: mapping.quantity, kind: "box", scannedCode };
            }
        }
        return null;
    }

    function hasActiveInterceptPrefix(value) {
        return state.mappings.some(
            (item) => item.enabled && getInterceptCodes(item).some((code) => code.startsWith(value))
        );
    }

    function isEditableElement(element) {
        if (!(element instanceof Element)) return false;
        return Boolean(
            element.matches("input, textarea, [contenteditable='true']") ||
            element.closest("input, textarea, [contenteditable='true']")
        );
    }

    function snapshotEditableTarget(target) {
        if (!isEditableElement(target)) return null;
        const element = target.closest?.("input, textarea, [contenteditable='true']") || target;

        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            return {
                element,
                kind: "value",
                value: element.value,
                selectionStart: element.selectionStart,
                selectionEnd: element.selectionEnd,
            };
        }

        return {
            element,
            kind: "html",
            value: element.innerHTML,
        };
    }

    function restoreEditableTarget(snapshot) {
        if (!snapshot?.element?.isConnected) return;

        if (snapshot.kind === "value") {
            snapshot.element.value = snapshot.value;
            snapshot.element.dispatchEvent(new Event("input", { bubbles: true }));
            try {
                snapshot.element.setSelectionRange(
                    snapshot.selectionStart,
                    snapshot.selectionEnd
                );
            } catch (_) {
                // 某些 input 类型不支持 setSelectionRange。
            }
            return;
        }

        snapshot.element.innerHTML = snapshot.value;
        snapshot.element.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function clearCandidateTimer() {
        window.clearTimeout(state.candidateTimer);
        state.candidateTimer = null;
    }

    function clearPassthroughTimer() {
        window.clearTimeout(state.passthroughTimer);
        state.passthroughTimer = null;
    }

    function resetScanBuffer() {
        clearCandidateTimer();
        clearPassthroughTimer();
        state.buffer = "";
        state.lastKeyAt = 0;
        state.scanTarget = null;
        state.scanTargetSnapshot = null;
        state.boxScanContext = null;
        state.interceptingCandidate = false;
        state.passthroughUntilEnter = false;
    }

    function ensureScanSink() {
        if (state.scanSink?.isConnected) return state.scanSink;
        if (!document.body) return null;

        const sink = document.createElement("input");
        sink.id = "pb-box-scan-sink";
        sink.type = "text";
        sink.tabIndex = -1;
        sink.autocomplete = "off";
        sink.inputMode = "none";
        sink.setAttribute("aria-hidden", "true");
        sink.setAttribute("data-pb-box-scan-sink", "true");
        sink.style.cssText = [
            "position:fixed",
            "left:-10000px",
            "top:-10000px",
            "width:1px",
            "height:1px",
            "opacity:0",
            "pointer-events:none",
            "z-index:-1",
        ].join(";");
        document.body.appendChild(sink);
        state.scanSink = sink;
        return sink;
    }

    function activateScanSink() {
        const sink = ensureScanSink();
        if (!sink) {
            debugLog("SINK ACTIVATE FAILED / 隐藏输入框不存在", {
                bodyExists: Boolean(document.body),
                activeElement: describeElement(document.activeElement),
            });
            return false;
        }

        window.clearTimeout(state.releaseSinkTimer);
        state.releaseSinkTimer = null;
        state.releaseSinkOnEnterKeyup = false;
        const focusBefore = document.activeElement;
        if (document.activeElement !== sink) {
            state.previousFocus = document.activeElement;
        }
        sink.value = "";
        try {
            sink.focus({ preventScroll: true });
        } catch (_) {
            sink.focus();
        }
        const activated = document.activeElement === sink;
        debugLog("SINK ACTIVATE / 尝试把焦点移入隐藏输入框", {
            success: activated,
            focusBefore: describeElement(focusBefore),
            focusAfter: describeElement(document.activeElement),
            previousFocus: describeElement(state.previousFocus),
        });
        return activated;
    }

    function releaseScanSink() {
        window.clearTimeout(state.releaseSinkTimer);
        state.releaseSinkTimer = null;
        state.releaseSinkOnEnterKeyup = false;

        const sink = state.scanSink;
        const previousFocus = state.previousFocus;
        state.previousFocus = null;
        if (!sink || document.activeElement !== sink) {
            if (isDebugWindowActive()) {
                debugLog("SINK RELEASE SKIPPED / 当前焦点不在隐藏输入框", {
                    sinkExists: Boolean(sink),
                    activeElement: describeElement(document.activeElement),
                    previousFocus: describeElement(previousFocus),
                });
            }
            return;
        }

        sink.value = "";
        if (
            previousFocus?.isConnected &&
            previousFocus !== sink &&
            typeof previousFocus.focus === "function"
        ) {
            try {
                previousFocus.focus({ preventScroll: true });
            } catch (_) {
                previousFocus.focus();
            }
        } else {
            sink.blur();
        }
        if (isDebugWindowActive()) {
            debugLog("SINK RELEASE / 已恢复扫码前焦点", {
                previousFocus: describeElement(previousFocus),
                activeElement: describeElement(document.activeElement),
            });
        }
    }

    function releaseScanSinkAfterEnter() {
        state.releaseSinkOnEnterKeyup = true;
        window.clearTimeout(state.releaseSinkTimer);
        if (isDebugWindowActive()) {
            debugLog("SINK WAIT ENTER KEYUP / 等待回车抬起后恢复焦点", {
                activeElement: describeElement(document.activeElement),
            });
        }
        // 某些扫描枪可能不发送 Enter keyup，增加自动释放保险。
        state.releaseSinkTimer = window.setTimeout(releaseScanSink, 500);
    }

    function rememberBlockedKeyup(event) {
        const keyId = event.code || event.key;
        const tokens = state.blockedKeyups.get(keyId) || [];
        const token = {};
        tokens.push(token);
        state.blockedKeyups.set(keyId, tokens);

        // 防止页面切换等情况造成 keyup 丢失后误拦截后续键盘输入。
        window.setTimeout(() => {
            const pending = state.blockedKeyups.get(keyId);
            if (!pending) return;
            const index = pending.indexOf(token);
            if (index >= 0) pending.splice(index, 1);
            if (pending.length === 0) state.blockedKeyups.delete(keyId);
        }, 1500);
    }

    function consumeBlockedKeyup(event) {
        const keyId = event.code || event.key;
        const tokens = state.blockedKeyups.get(keyId);
        if (!tokens?.length) return false;
        tokens.shift();
        if (tokens.length === 0) state.blockedKeyups.delete(keyId);
        return true;
    }

    function blockFromOdoo(event, rememberKeyup = true) {
        if (rememberKeyup) rememberBlockedKeyup(event);
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    function handleScannerKeyup(event, listenerSource = "unknown") {
        const isEnter = event.key === "Enter" || event.key === "NumpadEnter";
        const mustBlock = Boolean(
            state.interceptingCandidate ||
            state.releaseSinkOnEnterKeyup ||
            event.target === state.scanSink
        );
        if (isDebugWindowActive() || event.target === state.scanSink) {
            debugEvent(`KEYUP BEFORE / ${listenerSource} 拦截前`, event, { mustBlock });
        }
        if (isEnter && state.releaseSinkOnEnterKeyup) {
            // 等本次 keyup 完全结束后再恢复焦点，确保 Odoo 看到的目标仍是 INPUT。
            state.releaseSinkOnEnterKeyup = false;
            window.setTimeout(releaseScanSink, 0);
        }
        const pairedKeydownWasBlocked = consumeBlockedKeyup(event);
        if (state.forwardingRaw || (!mustBlock && !pairedKeydownWasBlocked)) {
            if (isDebugWindowActive()) {
                debugEvent(`KEYUP PASS / ${listenerSource} 未拦截`, event, {
                    mustBlock,
                    pairedKeydownWasBlocked,
                });
            }
            return;
        }
        blockFromOdoo(event, false);
        debugEvent(`KEYUP BLOCKED / ${listenerSource} 已拦截`, event, {
            mustBlock,
            pairedKeydownWasBlocked,
        });
    }

    function getForwardTarget() {
        return state.scanTarget?.isConnected
            ? state.scanTarget
            : (document.body || document.documentElement || document);
    }

    function getEditableRoot(target) {
        if (!(target instanceof Element)) return null;
        return target.closest?.("input, textarea, [contenteditable='true']") || null;
    }

    function insertForwardedCharacter(target, character) {
        const editable = getEditableRoot(target);
        if (!editable) return;

        if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
            const start = editable.selectionStart ?? editable.value.length;
            const end = editable.selectionEnd ?? start;
            try {
                editable.setRangeText(character, start, end, "end");
            } catch (_) {
                editable.value = `${editable.value}${character}`;
            }
            editable.dispatchEvent(new InputEvent("input", {
                bubbles: true,
                composed: true,
                inputType: "insertText",
                data: character,
            }));
            return;
        }

        editable.focus();
        if (!document.execCommand?.("insertText", false, character)) {
            editable.textContent += character;
            editable.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
        }
    }

    function forwardKeyToOdoo(key, target = getForwardTarget()) {
        state.forwardingRaw = true;
        try {
            const keydown = createKeyboardEvent("keydown", key);
            const accepted = target.dispatchEvent(keydown);
            if (accepted && key.length === 1) {
                // 浏览器不会为脚本生成的键盘事件执行默认输入，这里补上输入框文字。
                insertForwardedCharacter(target, key);
            }
            const keyupTarget = isEditableElement(target)
                ? target
                : (ensureScanSink() || target);
            // 非输入框条码的 keyup 放到隐藏 INPUT，避免 Odoo 数量缓冲把
            // 补发的普通条码数字同时当成商品数量。
            keyupTarget.dispatchEvent(createKeyboardEvent("keyup", key));
        } finally {
            state.forwardingRaw = false;
        }
    }

    function forwardBufferedCode(includeEnter = false, delayMs = 0) {
        const code = state.buffer;
        const target = getForwardTarget();
        if (isDebugWindowActive()) {
            debugLog("FORWARD BUFFER / 候选码不是已配置盒码，准备原样转交 Odoo", {
                code,
                includeEnter,
                delayMs,
                target: describeElement(target),
                activeElement: describeElement(document.activeElement),
            });
        }
        const sinkIsActive = document.activeElement === state.scanSink;
        if (includeEnter && sinkIsActive) {
            releaseScanSinkAfterEnter();
        } else {
            releaseScanSink();
        }
        clearCandidateTimer();
        state.buffer = "";
        state.interceptingCandidate = false;
        state.scanTarget = null;
        state.scanTargetSnapshot = null;
        state.boxScanContext = null;

        const forward = () => {
            if (isDebugWindowActive()) {
                debugLog("FORWARD BUFFER START / 开始补发普通条码", {
                    code,
                    includeEnter,
                    target: describeElement(target),
                });
            }
            for (const character of code) {
                forwardKeyToOdoo(character, target);
            }
            if (includeEnter) {
                forwardKeyToOdoo("Enter", target);
            }
            if (isDebugWindowActive()) {
                debugLog("FORWARD BUFFER END / 普通条码补发结束", {
                    code,
                    activeElement: describeElement(document.activeElement),
                    selectedOrderline: describeOrderlineSnapshot(),
                });
            }
        };

        if (delayMs > 0) {
            window.setTimeout(forward, delayMs);
        } else {
            forward();
        }
    }

    function isLikelyManualNumber(value) {
        return /^[0-9.,+-]{1,6}$/.test(String(value || ""));
    }

    function replayBufferedManualInput() {
        const code = state.buffer;
        const target = getForwardTarget();
        const editableTarget = isEditableElement(target);

        releaseScanSink();
        clearCandidateTimer();
        state.buffer = "";
        state.interceptingCandidate = false;
        state.scanTarget = null;
        state.scanTargetSnapshot = null;
        state.boxScanContext = null;

        const replay = async () => {
            if (editableTarget) {
                for (const character of code) {
                    forwardKeyToOdoo(character, target);
                }
                return;
            }

            // 非输入框中的数字属于 POS 数量/折扣/价格缓冲。通过 Odoo 自己的
            // 屏幕数字键逐位还原，并保持安全间隔，避免三位数被误判为条码。
            for (const character of code) {
                const button = findNumpadButtonByValue(character);
                if (!button) {
                    throw new Error(t("无法恢复手工数字 {0}", character));
                }
                button.click();
                await wait(NUMPAD_DIGIT_INTERVAL_MS);
            }
        };

        replay().catch((error) => {
            console.error("[PB 小盒码] 恢复手工数字失败：", error);
            showToast(t("手工数字恢复失败，请重新输入"), "error", 2600);
        });
    }

    function scheduleCandidateRelease() {
        clearCandidateTimer();
        state.candidateTimer = window.setTimeout(() => {
            if (!state.interceptingCandidate || !state.buffer) return;
            // 最多六位的纯数字视为 POS 手工数量；更长内容仍按普通条码补发。
            if (isLikelyManualNumber(state.buffer)) {
                replayBufferedManualInput();
            } else {
                forwardBufferedCode(false);
            }
        }, CANDIDATE_HOLD_MS);
    }

    function beginPassthrough() {
        state.passthroughUntilEnter = true;
        clearPassthroughTimer();
        state.passthroughTimer = window.setTimeout(() => {
            state.passthroughUntilEnter = false;
            state.lastKeyAt = 0;
        }, PASSTHROUGH_RESET_MS);
    }

    function handleScannerKeydown(event) {
        if (state.modalOpen || event.isComposing) return;
        if (state.forwardingRaw) return;
        // Native package commits do not synthesize keys; keep capturing subsequent scans.
        if (event.ctrlKey || event.altKey || event.metaKey) return;

        const now = performance.now();
        const isEnter = event.key === "Enter" || event.key === "NumpadEnter";

        if (state.passthroughUntilEnter) {
            state.lastKeyAt = now;
            if (isEnter) {
                clearPassthroughTimer();
                state.passthroughUntilEnter = false;
                state.lastKeyAt = 0;
            } else {
                beginPassthrough();
            }
            return;
        }

        if (isEnter) {
            if (!state.interceptingCandidate) {
                resetScanBuffer();
                return;
            }

            const scannedCode = normalizeCode(state.buffer);
            const match = getActiveScanMatch(scannedCode);
            debugEvent("KEYDOWN ENTER BEFORE / 收到盒码结尾回车", event, {
                scannedCode,
                match: match ? {
                    name: match.mapping.name,
                    unitCode: match.mapping.unitCode,
                    boxCodeIsProductCode: match.mapping.boxCodeIsProductCode,
                    quantity: match.quantity,
                    kind: match.kind,
                } : null,
            });

            if (match) {
                const boxScanContext = state.boxScanContext;
                blockFromOdoo(event);
                debugEvent("KEYDOWN ENTER BLOCKED / 已拦截盒码回车", event, {
                    scannedCode,
                    baseline: describeOrderlineSnapshot(boxScanContext?.snapshot),
                });
                releaseScanSinkAfterEnter();
                debugLog("BOX CODE MATCH / 盒码完整匹配", {
                    scannedCode,
                    mappingName: match.mapping.name,
                    mainUnitCode: match.mapping.unitCode,
                    effectiveProductCode: match.mapping.boxCodeIsProductCode
                        ? match.scannedCode
                        : match.mapping.unitCode,
                    addQuantity: match.quantity,
                    scanKind: match.kind,
                    baseline: describeOrderlineSnapshot(boxScanContext?.snapshot),
                });
                resetScanBuffer();
                enqueueMapping(
                    match.mapping,
                    boxScanContext,
                    match.quantity,
                    match.kind,
                    match.scannedCode
                );
                return;
            }

            if (isLikelyManualNumber(scannedCode)) {
                // 手工输入数量后按 Enter：不要当成普通商品条码，直接还给
                // 当前 Odoo 数字键盘模式（数量、折扣或价格）。
                blockFromOdoo(event);
                replayBufferedManualInput();
                return;
            }

            // 不是完整盒码：等 Odoo 遗留的首字符缓冲超时后，再完整转交普通条码。
            blockFromOdoo(event);
            debugEvent("KEYDOWN ENTER BLOCKED / 候选码不匹配，暂时拦截回车", event, {
                scannedCode,
            });
            forwardBufferedCode(true, FORWARD_DELAY_MS);
            return;
        }

        if (event.key.length !== 1) return;

        if (!state.interceptingCandidate) {
            if (!hasActiveInterceptPrefix(event.key)) {
                // 这是普通单品码的第一位：从现在起到扫描枪回车前整段放行。
                // 旧逻辑没有启动此状态，导致条码扫到中间某个“小盒码首位”
                // 时才突然开始拦截，从而把单品条码截成两段。
                state.lastKeyAt = now;
                beginPassthrough();
                return;
            }

            // 从第一个可能属于小盒码的字符开始拦截，Odoo 不会看到半个盒码。
            startDebugScan(event);
            debugEvent("KEYDOWN FIRST BEFORE / 盒码首字符拦截前", event);
            blockFromOdoo(event);
            debugEvent("KEYDOWN FIRST BLOCKED / 盒码首字符已拦截", event);
            state.interceptingCandidate = true;
            state.buffer = event.key;
            state.scanTarget = event.target;
            state.scanTargetSnapshot = snapshotEditableTarget(event.target);
            const currentSnapshot = getSelectedOrderlineSnapshot();
            const stableSnapshot = state.lastStableOrderlineSnapshot;
            const baselineSnapshot = (
                currentSnapshot &&
                stableSnapshot &&
                currentSnapshot.element === stableSnapshot.element
            ) ? stableSnapshot : currentSnapshot;
            const nativeContext = currentBoxContext();
            state.boxScanContext = {
                orderUuid: nativeContext.orderUuid,
                snapshot: cloneOrderlineSnapshot(baselineSnapshot),
                nativeIntercepted: false,
            };
            debugLog("BASELINE CAPTURE / 已记录扫码前购物车数量", {
                currentSnapshot: describeOrderlineSnapshot(currentSnapshot),
                stableSnapshot: describeOrderlineSnapshot(stableSnapshot),
                chosenBaseline: describeOrderlineSnapshot(baselineSnapshot),
                originalEventTarget: describeElement(event.target),
            });
            // Odoo 的数量服务忽略 INPUT/TEXTAREA 的 keyup。首个 keydown 后立即
            // 把焦点移入隐藏输入框，使整段盒码不再进入商品数量缓冲。
            activateScanSink();
            debugEvent("KEYDOWN FIRST END / 首字符处理完成", event, {
                sinkFocused: document.activeElement === state.scanSink,
            });
            state.lastKeyAt = now;
            scheduleCandidateRelease();
            return;
        }

        debugEvent("KEYDOWN NEXT BEFORE / 后续盒码字符拦截前", event, {
            bufferBefore: state.buffer,
        });
        blockFromOdoo(event);
        state.buffer += event.key;
        state.lastKeyAt = now;
        debugEvent("KEYDOWN NEXT BLOCKED / 后续盒码字符已拦截", event, {
            bufferAfter: state.buffer,
            remainsKnownPrefix: hasActiveInterceptPrefix(state.buffer),
        });

        if (hasActiveInterceptPrefix(state.buffer)) {
            scheduleCandidateRelease();
            return;
        }

        // 已确认不是盒码时仍暂存到 Enter，避免第一个物理按键与补发条码重复。
        scheduleCandidateRelease();
    }

    let boxTaskSequence = 0;
    function nativeCartSnapshot() {
        const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
        try { return pageWindow.PBCartUnit?.scanSnapshot?.() || null; }
        catch (_) { return null; }
    }

    function getSelectedOrderlineSnapshot() {
        const native = nativeCartSnapshot();
        if (native?.orderUuid && native.lineUuid && Number.isFinite(Number(native.quantity))) {
            const escaped = globalThis.CSS?.escape ? CSS.escape(String(native.lineUuid)) : String(native.lineUuid).replace(/[^\w-]/g, "");
            const element = document.querySelector(`.orderline.pbcu-${escaped}`) || Array.from(document.querySelectorAll(".orderline.selected")).at(-1) || null;
            return { ...native, element, quantity: Number(native.quantity), productId: Number(native.productId || 0) };
        }
        return null; // Display text is never a business quantity source.
    }

    function cloneOrderlineSnapshot(snapshot) {
        return snapshot ? {
            element: snapshot.element, quantity: snapshot.quantity,
            orderUuid: String(snapshot.orderUuid || ""), lineUuid: String(snapshot.lineUuid || ""),
            productId: Number(snapshot.productId || 0), orderState: String(snapshot.orderState || ""),
            finalized: Boolean(snapshot.finalized),
        } : null;
    }

    function currentBoxContext() {
        const native = nativeCartSnapshot();
        const selected = getSelectedOrderlineSnapshot();
        return {
            orderUuid: String(native?.orderUuid || selected?.orderUuid || ""),
            snapshot: cloneOrderlineSnapshot(selected),
            nativeIntercepted: false,
        };
    }

    function updateStableOrderlineSnapshot() {
        if (state.interceptingCandidate || state.passthroughUntilEnter || state.replaying) return;
        state.lastStableOrderlineSnapshot = cloneOrderlineSnapshot(getSelectedOrderlineSnapshot());
    }

    function assertBoxJobOwner(job) {
        const current = nativeCartSnapshot();
        if (!job.orderUuid || !current?.orderUuid || String(current.orderUuid) !== String(job.orderUuid)) {
            throw Object.assign(new Error(t("扫码期间订单已切换；已停止处理，未修改新订单")), {code:"ORDER_CONTEXT_CHANGED"});
        }
        if (current.finalized || current.orderState !== "draft") {
            throw Object.assign(new Error(t("原订单已付款、关闭或不可编辑；已停止处理")), {code:"ORDER_NOT_EDITABLE"});
        }
        return current;
    }

    function enqueueMapping(mapping, boxScanContext = null, quantityOverride = mapping.quantity, scanKind = "box", scannedCode = "") {
        const context = boxScanContext || currentBoxContext();
        state.queue.push({
            taskId: `pb-box-${Date.now()}-${++boxTaskSequence}`,
            orderUuid: String(context?.orderUuid || context?.snapshot?.orderUuid || ""),
            mapping: { ...mapping, quantity: quantityOverride },
            boxScanContext: context,
            scanKind,
            scannedCode: normalizeCode(scannedCode),
        });
        keepDebugWindowAlive(12000);
        debugLog("QUEUE ADD / 已加入数量处理队列", {
            mappingName: mapping.name, mainUnitCode: mapping.unitCode,
            effectiveProductCode: mapping.boxCodeIsProductCode ? (normalizeCode(scannedCode) || mapping.boxCodes[0] || "") : mapping.unitCode,
            quantity: quantityOverride, scanKind, queueLength: state.queue.length,
            taskId: state.queue.at(-1).taskId, orderUuid: state.queue.at(-1).orderUuid,
            baseline: describeOrderlineSnapshot(context?.snapshot),
        });
        processQueue();
    }

    async function processQueue() {
        if (state.replaying || !state.queue.length) return;
        state.replaying = true;
        const job = state.queue.shift();
        const mapping = job.mapping;
        const code = mapping.boxCodeIsProductCode ? (job.scannedCode || mapping.boxCodes[0] || "") : mapping.unitCode;
        try {
            if (!code) throw new Error(t("没有可用于 Odoo 识别商品的条码"));
            assertBoxJobOwner(job);
            const result = await sendOwnedOdooBridgeCommand({type:"owned_scan", taskId:job.taskId,
                orderUuid:job.orderUuid, code, quantity:Number(mapping.quantity)}, 10000);
            showToast(t("完成：{0} 当前数量 {1}", mapping.name || code, result.quantity) +
                (result.contextActive ? "" : " · " + (uiLanguage === "es-MX" ? "Aplicado al pedido original" : "已加到原订单")), "success", 3500);
        } catch (error) {
            // Native errors may follow a partial write. Never guess a rollback delta.
            // The bridge journal blocks another package on that order until reviewed.
            console.error("[PB 小盒码]", error);
            const es = uiLanguage === "es-MX";
            const cancelled = String(error.message).includes("CANCELLED_BEFORE_WRITE");
            showToast(cancelled ? (es ? "Cancelado antes de agregar productos" : "已确认在加商品前取消") :
                (es ? "Revise el resultado del escaneo antes de reintentar: " : "请先核对扫码结果，再重试：") + error.message, "error", 10000);
        } finally {
            state.replaying = false;
            // A subsequent physical scan may already be partially buffered.
            // Its own Enter handler owns the sink and buffer lifecycle.
            updateStableOrderlineSnapshot();
            if (state.queue.length) { await wait(0); processQueue(); }
        }
    }

    function findNumpadButtonByValue(value) {
        return Array.from(document.querySelectorAll(".product-screen .numpad .numpad-button"))
            .find((button) => button.value === String(value) && !button.disabled);
    }

    async function setSelectedOrderlineQuantity(targetQuantity) {
        const quantityModeButton = document.querySelector(
            ".product-screen .numpad .numpad-qty:not(:disabled)"
        );
        if (!quantityModeButton) {
            throw new Error(t("找不到 Odoo 的数量按钮，请保持在商品登记页面"));
        }

        // Odoo 官方数量按钮先切换到 quantity 模式；V7 随后通过官方
        // number_buffer 的 capture() 一次提交所有位数。
        debugLog("NUMPAD MODE / 点击 Odoo 数量模式按钮", {
            targetQuantity,
            before: describeOrderlineSnapshot(),
        });
        quantityModeButton.click();
        await wait(0);

        if (sendOdooBridgeCommand(
            { type: "set_number", value: String(targetQuantity) },
            "number"
        )) {
            await wait(0);
            return;
        }

        // 原生服务桥接不可用时的兼容后备；正常 V7 不会进入这里。
        for (const digit of String(targetQuantity)) {
            const button = findNumpadButtonByValue(digit);
            if (!button) {
                throw new Error(t("找不到 Odoo 数字键 {0}", digit));
            }
            debugLog("NUMPAD DIGIT / 点击 Odoo 数字键", {
                digit,
                targetQuantity,
                intervalMs: NUMPAD_DIGIT_INTERVAL_MS,
                before: describeOrderlineSnapshot(),
            });
            button.click();
            await wait(NUMPAD_DIGIT_INTERVAL_MS);
        }
    }

    async function waitForSelectedQuantity(targetQuantity, timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const current = getSelectedOrderlineSnapshot();
            if (current?.quantity === targetQuantity) return true;
            await wait(40);
        }
        return false;
    }

    function wait(ms) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    function keyCodeFor(key) {
        if (key === "Enter") return 13;
        if (key.length !== 1) return 0;
        return key.toUpperCase().charCodeAt(0);
    }

    function codeFor(key) {
        if (key === "Enter") return "Enter";
        if (/^[0-9]$/.test(key)) return `Digit${key}`;
        if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
        return "Unidentified";
    }

    function createKeyboardEvent(type, key) {
        const keyCode = keyCodeFor(key);
        const event = new KeyboardEvent(type, {
            key,
            code: codeFor(key),
            bubbles: true,
            cancelable: true,
            composed: true,
        });

        // 兼容仍然读取 keyCode/which 的扫码监听器。
        for (const property of ["keyCode", "which", "charCode"]) {
            try {
                Object.defineProperty(event, property, {
                    configurable: true,
                    get: () => (property === "charCode" && key === "Enter" ? 0 : keyCode),
                });
            } catch (_) {
                // 新版浏览器主要读取 event.key，不影响转发。
            }
        }
        return event;
    }

    function dispatchKey(key) {
        const barcodeTarget = document.body || document.documentElement || document;
        const quantitySafeTarget = ensureScanSink() || barcodeTarget;

        // Odoo 条码服务从 BODY 的 keydown 读取条码；数量缓冲则从 window keyup
        // 读取数字。两种事件若都发到 BODY，同一串单品码会短暂变成商品数量。
        // 因此只把 keydown 发给条码服务，keyup 改发到隐藏 INPUT 并由本脚本拦截。
        barcodeTarget.dispatchEvent(createKeyboardEvent("keydown", key));
        quantitySafeTarget.dispatchEvent(createKeyboardEvent("keyup", key));
    }

    function dispatchBarcode(barcode) {
        debugLog("SYNTHETIC BARCODE START / 开始发送脚本生成的主单品码", {
            barcode,
            keydownTarget: describeElement(document.body || document.documentElement || document),
            keyupTarget: describeElement(ensureScanSink()),
            activeElement: describeElement(document.activeElement),
        });
        for (const character of barcode) {
            dispatchKey(character);
        }
        dispatchKey("Enter");
        debugLog("SYNTHETIC BARCODE END / 主单品码键盘事件发送完毕", {
            barcode,
            selectedOrderline: describeOrderlineSnapshot(),
            activeElement: describeElement(document.activeElement),
        });
    }

    function ensureStyles() {
        if (document.getElementById("pb-box-barcode-style")) return;
        const style = document.createElement("style");
        style.id = "pb-box-barcode-style";
        style.textContent = `
            #pb-box-settings-btn {
                white-space: nowrap;
                font-weight: 700 !important;
                border-radius: 8px !important;
            }
            #pb-box-settings-fallback {
                position: fixed; left: 16px; bottom: 16px; z-index: 99990;
                border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 16px;
                background: #ffffff;
                color: #0f172a; font-weight: 800;
                box-shadow: 0 8px 24px rgba(15,23,42,.18); cursor: pointer;
            }
            #pb-box-modal {
                position: fixed; inset: 0; z-index: 1000000;
                display: flex; align-items: center; justify-content: center;
                background: rgba(15,23,42,.60);
                backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
                padding: 20px;
                font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
            }
            #pb-box-modal * { box-sizing: border-box; }
            .pb-box-panel {
                width: min(1100px, 96vw); max-height: 92vh; overflow: hidden;
                display: flex; flex-direction: column;
                background: #f8fafc; color: #0f172a;
                border-radius: 14px;
                border: 1px solid #cbd5e1;
                box-shadow: 0 25px 70px -12px rgba(15,23,42,.40);
            }
            .pb-box-head {
                display: flex; align-items: center; justify-content: space-between;
                gap: 15px; padding: 16px 22px;
                background: #ffffff;
                color: #0f172a;
                border-bottom: 1px solid #e2e8f0;
            }
            .pb-box-head h2 { font-size: 19px; font-weight: 800; margin: 0; color: #0f172a; }
            .pb-box-head small { color: #64748b; margin-left: 8px; font-weight: 600; font-size: 13px; }
            .pb-box-head-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
            .pb-box-language-toggle {
                border: 1px solid #cbd5e1; border-radius: 8px;
                min-height: 38px; padding: 7px 13px;
                background: #f8fafc; color: #0f172a;
                font-size: 13.5px; font-weight: 700; cursor: pointer; white-space: nowrap;
            }
            .pb-box-language-toggle:hover { background: #e2e8f0; }
            .pb-box-language-toggle:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
            .pb-box-close {
                width: 38px; height: 38px; border: 1px solid #cbd5e1; border-radius: 8px;
                background: #ffffff; color: #0f172a;
                font-size: 24px; line-height: 1; cursor: pointer;
            }
            .pb-box-close:hover { background: #f1f5f9; }
            .pb-box-body { padding: 18px 22px; overflow: auto; }
            .pb-box-help {
                padding: 12px 15px; margin-bottom: 14px; border-radius: 10px;
                background: #eff6ff;
                border: 1px solid #bfdbfe; color: #1e3a8a;
                font-size: 13.5px; line-height: 1.5;
            }
            .pb-box-sync-card {
                display: flex; align-items: center; justify-content: space-between;
                gap: 14px; padding: 13px 16px; margin-bottom: 16px;
                background: #ecfdf5;
                border: 1px solid #a7f3d0; border-radius: 12px;
            }
            .pb-box-sync-copy { display: grid; gap: 4px; }
            .pb-box-sync-copy strong { color: #065f46; font-size: 14px; }
            .pb-box-remote-status { color: #334155; font-size: 13px; line-height: 1.45; }
            .pb-box-error-text { color: #b91c1c; font-weight: 600; }
            #pb-box-password-modal {
                position: fixed; inset: 0; z-index: 1000002;
                display: flex; align-items: center; justify-content: center;
                padding: 20px; background: rgba(15,23,42,.65);
                font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            }
            .pb-box-password-card {
                width: min(430px, 94vw); padding: 24px;
                border-radius: 14px; background: #fff;
                border: 1px solid #e2e8f0;
                box-shadow: 0 25px 70px rgba(15,23,42,.40);
            }
            .pb-box-password-card h3 { margin: 0 0 8px; color: #0f172a; font-size: 19px; font-weight: 800; }
            .pb-box-password-card p { margin: 0 0 16px; color: #475569; line-height: 1.5; font-size: 14px; }
            .pb-box-password-card label {
                display: block; margin-bottom: 6px; color: #334155;
                font-size: 13px; font-weight: 800;
            }
            .pb-box-password-card input {
                width: 100%; min-height: 44px; padding: 9px 12px;
                border: 1.5px solid #cbd5e1; border-radius: 8px;
                color: #0f172a; background: #f8fafc; font-size: 17px;
                box-sizing: border-box;
            }
            .pb-box-password-card input:focus {
                background: #fff;
                border-color: #2563eb; outline: none;
                box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.16);
            }
            .pb-box-password-card small { display: block; margin-top: 6px; color: #64748b; font-size: 12px; }
            .pb-box-password-actions {
                display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px;
            }
            .pb-box-section { margin-top: 18px; }
            .pb-box-section:first-child { margin-top: 0; }
            .pb-box-section-head {
                display: flex; align-items: center; justify-content: space-between;
                gap: 10px; margin: 0 0 10px; color: #1e293b;
            }
            .pb-box-section-head h3 { margin: 0; font-size: 15.5px; font-weight: 800; }
            .pb-box-badge {
                display: inline-block; margin-left: 7px; padding: 2px 9px;
                border-radius: 999px; background: #e2e8f0; color: #334155;
                font-size: 12px; font-weight: 800; vertical-align: 1px;
            }
            .pb-box-badge.pb-online { background: #d1fae5; color: #065f46; }
            .pb-box-section-note { color: #64748b; font-size: 12px; }
            .pb-box-form {
                display: grid; grid-template-columns: 1.2fr 1.2fr .55fr 1.2fr auto;
                gap: 12px; align-items: end; padding: 16px;
                background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
                margin-bottom: 16px;
            }
            .pb-box-field label {
                display: block; margin-bottom: 5px; font-size: 12.5px;
                font-weight: 800; color: #334155;
            }
            .pb-box-mode-field { grid-column: 1 / -1; padding-bottom: 6px; border-bottom: 1px dashed #e2e8f0; }
            .pb-box-mode-check {
                display: flex !important; align-items: center; gap: 8px;
                width: fit-content; margin: 0 !important; cursor: pointer;
                font-weight: 700; color: #1e293b;
            }
            .pb-box-mode-check input {
                width: 18px !important; height: 18px; min-height: 0 !important;
                margin: 0; accent-color: #2563eb;
            }
            .pb-box-mode-note {
                display: block; margin-top: 5px; color: #64748b;
                font-size: 12px; line-height: 1.45;
            }
            .pb-box-field input:disabled {
                color: #94a3b8; background: #f1f5f9; cursor: not-allowed;
            }
            .pb-box-field input, .pb-box-field textarea {
                width: 100%; min-height: 42px; padding: 8px 11px;
                border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14.5px;
                color: #0f172a; background: #fff;
            }
            .pb-box-field textarea { min-height: 76px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
            .pb-box-field input:focus, .pb-box-field textarea:focus {
                border-color: #2563eb; outline: none;
                box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
            }
            .pb-box-primary, .pb-box-secondary, .pb-box-danger, .pb-box-test {
                border: 1px solid transparent; border-radius: 8px; padding: 9px 14px;
                min-height: 40px; font-weight: 800; font-size: 13.5px; cursor: pointer;
            }
            .pb-box-primary { background: #2563eb; color: #fff; }
            .pb-box-primary:hover:not(:disabled) { background: #1d4ed8; }
            .pb-box-secondary { background: #f1f5f9; border-color: #cbd5e1; color: #334155; }
            .pb-box-secondary:hover:not(:disabled) { background: #e2e8f0; }
            .pb-box-danger { background: #fef2f2; border-color: #fecaca; color: #b91c1c; }
            .pb-box-danger:hover:not(:disabled) { background: #fee2e2; }
            .pb-box-test { background: #ecfdf5; border-color: #a7f3d0; color: #047857; }
            .pb-box-test:hover:not(:disabled) { background: #d1fae5; }
            .pb-box-form-actions { display: flex; gap: 8px; }
            .pb-box-table-wrap {
                overflow-x: auto; background: #fff;
                border: 1px solid #e2e8f0; border-radius: 12px;
            }
            .pb-box-table { width: 100%; border-collapse: collapse; min-width: 760px; font-size: 13.5px; }
            .pb-box-table th, .pb-box-table td {
                padding: 10px 12px; border-bottom: 1px solid #f1f5f9;
                text-align: left; vertical-align: middle;
            }
            .pb-box-table tbody tr:hover td { background: #f8fafc; }
            .pb-box-table th {
                background: #f1f5f9; color: #475569;
                font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.3px;
                border-bottom: 1px solid #e2e8f0;
            }
            .pb-box-table .pb-box-readonly { color: #64748b; font-size: 12.5px; }
            .pb-box-code {
                font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
                font-weight: 700; color: #1e293b;
                background: #f8fafc; padding: 2px 6px; border-radius: 5px; border: 1px solid #e2e8f0;
            }
            .pb-box-actions { display: flex; gap: 6px; flex-wrap: wrap; }
            .pb-box-toggle { width: 20px; height: 20px; accent-color: #2563eb; cursor: pointer; }
            .pb-box-empty { padding: 32px; text-align: center; color: #64748b; }
            .pb-box-error {
                display: none; padding: 10px 13px; margin: 0 0 12px;
                color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca;
                border-radius: 9px; font-weight: 700;
            }
            .pb-box-foot {
                display: flex; align-items: center; justify-content: space-between;
                gap: 10px; padding: 13px 22px; border-top: 1px solid #e2e8f0;
                background: #fff; color: #64748b; font-size: 13px;
            }
            .pb-box-foot-actions { display: flex; gap: 8px; flex-wrap: wrap; }
            #pb-box-toast {
                position: fixed; top: 76px; left: 50%; z-index: 1000001;
                transform: translate(-50%, -14px); opacity: 0;
                min-width: 310px; max-width: 82vw; padding: 12px 20px;
                border-radius: 12px; color: #fff; background: #1e293b;
                border: 1px solid rgba(255,255,255,.18);
                text-align: center; font-size: 15.5px; font-weight: 800;
                pointer-events: none; transition: .2s cubic-bezier(.16,1,.3,1);
                box-shadow: 0 12px 32px rgba(15,23,42,.32);
            }
            #pb-box-toast.pb-show { opacity: 1; transform: translate(-50%, 0); }
            #pb-box-toast.pb-success { background: #059669; }
            #pb-box-toast.pb-error { background: #e11d48; }
            #pb-box-toast.pb-working { background: #2563eb; }
            @media (max-width: 800px) {
                #pb-box-modal { padding: 8px; }
                .pb-box-panel { max-height: 97vh; }
                .pb-box-head { flex-wrap: wrap; gap: 10px; }
                .pb-box-head-actions { margin-left: auto; }
                .pb-box-foot { flex-wrap: wrap; }
                .pb-box-section-head { flex-wrap: wrap; }
                .pb-box-field { min-width: 0; }
                .pb-box-form { grid-template-columns: 1fr 1fr; }
                .pb-box-form-actions { grid-column: 1 / -1; }
                .pb-box-sync-card { align-items: stretch; flex-direction: column; }
            }
        `;
        document.head.appendChild(style);
    }

    function buttonLabel() {
        const activeCount = state.mappings.filter((item) => item.enabled).length;
        const parts = bridgeStatusParts();
        const ready = ["barcode", "reader", "number", "pos", "unit"].every(part => parts.has(part));
        const status = document.documentElement?.getAttribute("data-pb-box-barcode-connection");
        return t("📦 小盒码{0}", activeCount ? ` (${activeCount})` : "") + " · " + t(ready ? "扫码已就绪" : status === "retry" ? "扫码未连接" : "扫码连接中");
    }

    function createSettingsButton(id, fallback = false) {
        const button = document.createElement("button");
        button.id = id;
        button.type = "button";
        button.textContent = buttonLabel();
        button.title = t("设置小盒条码对应关系");
        if (fallback) {
            button.id = "pb-box-settings-fallback";
        } else {
            button.className = "btn btn-light btn-lg lh-lg";
        }
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            openSettings();
        });
        return button;
    }

    function pbScanJournal(storage) {
        const prefix = "pb_box_task_v4:";
        function read() {
            const legacy = JSON.parse(storage.getItem("pb_box_transactions_v3") || "{}");
            if (!legacy || Array.isArray(legacy) || typeof legacy !== "object") throw new Error("SCAN_JOURNAL_INVALID");
            const records = {...legacy};
            for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                if (!key?.startsWith(prefix)) continue;
                const record = JSON.parse(storage.getItem(key));
                if (!record?.taskId || key !== prefix + encodeURIComponent(record.taskId)) throw new Error("SCAN_JOURNAL_INVALID");
                records[record.taskId] = record;
            }
            return records;
        }
        function write(task) {
            if (!task?.taskId) throw new Error("SCAN_TASK_ID_MISSING");
            const key = prefix + encodeURIComponent(task.taskId);
            const text = JSON.stringify({...task, at:new Date().toISOString()});
            try {
                storage.setItem(key,text);
                if (storage.getItem(key) !== text) throw new Error("SCAN_JOURNAL_NOT_SAVED");
            } finally { notifyScanJournalChanged(); }
            // Terminal task IDs cannot be executed again. Bound routine evidence
            // like v3, but never prune unknown tasks or a v3 override (which
            // would uncover the old pending record). Cleanup is best effort.
            if (["completed","cancelled","reviewed"].includes(task.phase)) {
                try {
                    const legacy = JSON.parse(storage.getItem("pb_box_transactions_v3") || "{}");
                    const terminal = Object.values(read()).filter(r => r.taskId !== task.taskId && !legacy[r.taskId] &&
                        ["completed","cancelled","reviewed"].includes(r.phase)).sort((a,b) => String(b.at).localeCompare(String(a.at)));
                    for (const old of terminal.slice(99)) {
                        const oldKey = prefix + encodeURIComponent(old.taskId);
                        const current = storage.getItem(oldKey);
                        if (current && JSON.stringify(JSON.parse(current)) === JSON.stringify(old)) storage.removeItem(oldKey);
                    }
                } catch (_) { /* Preserve evidence when optional cleanup fails. */ }
            }
        }
        return {read,write};
    }
    // Only a UI summary is cached. Scan execution and manual recovery still read fresh journals.
    let scanRecoveryDirty = true;
    let scanRecoveryPending = null;
    let scanRecoveryTimer = null;
    let scanRecoveryDisposed = false;
    function invalidateScanRecovery() {
        if (scanRecoveryDisposed) return;
        scanRecoveryDirty = true;
        if (scanRecoveryTimer !== null || document.hidden) return;
        scanRecoveryTimer = window.setTimeout(() => {
            scanRecoveryTimer = null;
            if (document.hidden) return;
            ensureScanRecoveryButton();
        }, 40);
    }
    document.addEventListener(SCAN_JOURNAL_EVENT, invalidateScanRecovery);
    window.addEventListener("storage", event => {
        if (event.storageArea && event.storageArea !== localStorage) return;
        if (event.key === null || event.key === "pb_box_transactions_v3" || event.key?.startsWith("pb_box_task_v4:")) invalidateScanRecovery();
    });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) invalidateScanRecovery(); });
    window.addEventListener("pageshow", event => { if (event.persisted) invalidateScanRecovery(); });
    window.addEventListener("pagehide", event => {
        if (scanRecoveryTimer !== null) window.clearTimeout(scanRecoveryTimer);
        scanRecoveryTimer = null;
        if (!event.persisted) { scanRecoveryDisposed = true; document.removeEventListener(SCAN_JOURNAL_EVENT, invalidateScanRecovery); }
    });

    function ensureScanRecoveryButton() {
        if (scanRecoveryDirty) {
            scanRecoveryDirty = false;
            try {
                const records = pbScanJournal(localStorage).read();
                scanRecoveryPending = Object.values(records).filter(r => !["completed","cancelled","reviewed"].includes(r.phase));
            } catch (_) { return; } // Preserve the original indicator on unreadable storage.
        }
        if (scanRecoveryPending === null) return;
        const pending = scanRecoveryPending;
        let button = document.getElementById("pb-box-scan-recovery");
        if (!pending.length) { button?.remove(); return; }
        if (!button) {
            button = document.createElement("button"); button.id = "pb-box-scan-recovery";
            button.style.cssText = "position:fixed;bottom:65px;right:12px;z-index:100050;background:#fff3cd;color:#664d03;padding:10px";
            button.addEventListener("click", async () => {
                if (state.replaying) return showToast(uiLanguage === "es-MX" ? "Todavía esperando el resultado nativo" : "原生操作仍在等待，请勿确认或重复扫码", "working", 6000);
                const owner = nativeCartSnapshot()?.orderUuid;
                if (!owner || !navigator.locks?.request) return;
                await navigator.locks.request("pb-box-order:" + owner, {mode:"exclusive",ifAvailable:true}, lock => {
                if (!lock) return showToast(uiLanguage === "es-MX" ? "Escaneo pendiente en otra pestaña" : "另一标签页仍在处理此订单，暂不能归档", "working", 6000);
                const latest = pbScanJournal(localStorage).read();
                const current = nativeCartSnapshot();
                const items = Object.values(latest).filter(r => r.orderUuid === current?.orderUuid && !["completed","cancelled","reviewed"].includes(r.phase));
                const es = uiLanguage === "es-MX";
                if (!items.length) return showToast(es ? "Abra el pedido original para revisar" : "请打开原订单核对", "error", 5000);
                const text = items.map(r => `${r.taskId}\n${r.code} +${r.quantity} · ${r.phase}\n${JSON.stringify(r.before || [])}`).join("\n\n");
                if (!window.confirm((es ? "Compare el pedido con las cantidades anteriores. ¿Ya comprobó el resultado? No se agregará ni restará nada.\n" : "请对照原订单和以下扫码前数量，确认本次结果已人工核对。这里只归档记录，不加减商品。\n") + text)) return;
                // Re-read after confirmation; update only unchanged target tasks.
                // Other orders have independent keys, so no shared-map overwrite.
                const journal = pbScanJournal(localStorage);
                const fresh = journal.read();
                if (nativeCartSnapshot()?.orderUuid !== owner || items.some(item => JSON.stringify(fresh[item.taskId]) !== JSON.stringify(item))) throw new Error("SCAN_REVIEW_CHANGED");
                for (const item of items) journal.write({...item, phase:"reviewed", reviewedAt:new Date().toISOString(), reviewedSnapshot:nativeCartSnapshot()});
                ensureScanRecoveryButton();
                });
            });
            document.body.appendChild(button);
        }
        const label = (uiLanguage === "es-MX" ? "Revisar escaneos: " : "核对未确定扫码：") + pending.length;
        if (button.textContent !== label) button.textContent = label;
    }


    function ensureSettingsButton() {
        ensureScanRecoveryButton();
        if (!document.body) return;
        ensureStyles();

        const header = document.querySelector(".status-buttons");
        const headerButton = document.getElementById("pb-box-settings-btn");
        const fallbackButton = document.getElementById("pb-box-settings-fallback");

        if (header) {
            if (!headerButton) {
                header.appendChild(createSettingsButton("pb-box-settings-btn"));
            }
            fallbackButton?.remove();
            return;
        }

        if (!fallbackButton && !headerButton) {
            document.body.appendChild(createSettingsButton("pb-box-settings-fallback", true));
        }
    }

    function updateSettingsButton() {
        for (const id of ["pb-box-settings-btn", "pb-box-settings-fallback"]) {
            const button = document.getElementById(id);
            if (button) {
                const label = buttonLabel();
                if (button.textContent !== label) button.textContent = label;
                button.title = t("设置小盒条码对应关系");
            }
        }
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function openSettings() {
        document.dispatchEvent(new Event(BRIDGE_CONNECT_EVENT));
        if (document.getElementById("pb-box-modal")) return;
        state.modalOpen = true;
        state.editingId = null;
        releaseScanSink();
        resetScanBuffer();

        // Odoo Navbar 会在 document 上监听按键并可能重新聚焦 POS 商品搜索框。
        // 打开设置前先明确释放外层焦点，稍后再把焦点放入本窗口的条码输入框。
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }

        const modal = document.createElement("div");
        modal.id = "pb-box-modal";
        modal.innerHTML = `
            <span class="modal-dialog pb-box-dialog-sentinel" hidden aria-hidden="true"></span>
            <section class="pb-box-panel" role="dialog" aria-modal="true" data-pb-i18n-aria-label="小盒条码设置" aria-label="${escapeHtml(t("小盒条码设置"))}">
                <header class="pb-box-head">
                    <div><h2>📦 <span data-pb-i18n="小盒条码设置">${escapeHtml(t("小盒条码设置"))}</span> <small>v${SCRIPT_VERSION}</small></h2>
                    <button type="button" id="pb-box-check-connection" data-pb-i18n="检查扫码连接">${escapeHtml(t("检查扫码连接"))}</button></div>
                    <div class="pb-box-head-actions">
                        <button type="button" id="pb-box-language-toggle" class="pb-box-language-toggle"></button>
                        <button type="button" class="pb-box-close" data-pb-i18n-title="关闭" title="${escapeHtml(t("关闭"))}">×</button>
                    </div>
                </header>
                <div class="pb-box-body">
                    <div class="pb-box-help">
                        <span data-pb-i18n="在线数据来自统一 Google 表格并保持只读；下面的表单只管理这台电脑的少量特殊设置。每个商品都可以单独设置“每次扫描增加数量”，同一商品的不同包装数量请分别添加。">${escapeHtml(t("在线数据来自统一 Google 表格并保持只读；下面的表单只管理这台电脑的少量特殊设置。每个商品都可以单独设置“每次扫描增加数量”，同一商品的不同包装数量请分别添加。"))}</span>
                    </div>
                    <div class="pb-box-sync-card">
                        <div class="pb-box-sync-copy">
                            <strong><span data-pb-i18n="在线 Google 表格">${escapeHtml(t("在线 Google 表格"))}</span></strong>
                            <span id="pb-box-remote-status" class="pb-box-remote-status"></span>
                        </div>
                        <button type="button" class="pb-box-primary" id="pb-box-sync-now"><span data-pb-i18n="立即检查更新">${escapeHtml(t("立即检查更新"))}</span></button>
                    </div>
                    <div class="pb-box-section-head">
                        <h3><span data-pb-i18n="本机特殊设置">${escapeHtml(t("本机特殊设置"))}</span></h3>
                        <span class="pb-box-section-note"><span data-pb-i18n="只保存在当前这台 POS 电脑">${escapeHtml(t("只保存在当前这台 POS 电脑"))}</span></span>
                    </div>
                    <div id="pb-box-form-error" class="pb-box-error"></div>
                    <form id="pb-box-form" class="pb-box-form">
                        <div class="pb-box-field pb-box-mode-field">
                            <label class="pb-box-mode-check" for="pb-box-is-product-code-input">
                                <input id="pb-box-is-product-code-input" type="checkbox">
                                <span><span data-pb-i18n="这个包装码本身就是 Odoo 商品条码">${escapeHtml(t("这个包装码本身就是 Odoo 商品条码"))}</span></span>
                            </label>
                            <small class="pb-box-mode-note"><span data-pb-i18n="勾选后不需要填写固定单品码；适合已经录入 Odoo 的 4 个装、12 个装等包装条码。其他更大包装可以把这个条码作为固定商品识别码。">${escapeHtml(t("勾选后不需要填写固定单品码；适合已经录入 Odoo 的 4 个装、12 个装等包装条码。其他更大包装可以把这个条码作为固定商品识别码。"))}</span></small>
                        </div>
                        <div class="pb-box-field">
                            <label for="pb-box-code-input"><span data-pb-i18n="小盒条码（每行一个）*">${escapeHtml(t("小盒条码（每行一个）*"))}</span></label>
                            <textarea id="pb-box-code-input" autocomplete="off" required data-pb-i18n-placeholder="扫描旧盒码、新盒码；每行一个" placeholder="${escapeHtml(t("扫描旧盒码、新盒码；每行一个"))}"></textarea>
                        </div>
                        <div class="pb-box-field">
                            <label for="pb-unit-code-input"><span data-pb-i18n="固定单品条码">${escapeHtml(t("固定单品条码"))}</span> <span id="pb-unit-code-required">*</span></label>
                            <input id="pb-unit-code-input" type="text" inputmode="numeric" autocomplete="off" placeholder="${escapeHtml(t("Odoo 当前能够识别的单品条码"))}">
                        </div>
                        <div class="pb-box-field">
                            <label for="pb-box-qty-input"><span data-pb-i18n="每次扫描增加数量 *">${escapeHtml(t("每次扫描增加数量 *"))}</span></label>
                            <input id="pb-box-qty-input" type="number" min="1" max="${MAX_QUANTITY}" step="1" value="20" required>
                        </div>
                        <div class="pb-box-field">
                            <label for="pb-box-name-input"><span data-pb-i18n="名称/颜色">${escapeHtml(t("名称/颜色"))}</span></label>
                            <input id="pb-box-name-input" type="text" autocomplete="off" data-pb-i18n-placeholder="如 GAR080 黑色" placeholder="${escapeHtml(t("如 GAR080 黑色"))}">
                        </div>
                        <div class="pb-box-form-actions">
                            <button type="submit" class="pb-box-primary" id="pb-box-save-btn"><span data-pb-i18n="添加">${escapeHtml(t("添加"))}</span></button>
                            <button type="button" class="pb-box-secondary" id="pb-box-cancel-edit" hidden><span data-pb-i18n="取消">${escapeHtml(t("取消"))}</span></button>
                        </div>
                    </form>
                    <div id="pb-box-list"></div>
                </div>
                <footer class="pb-box-foot">
                    <span><span data-pb-i18n="在线条码只读；导入和导出仅包含本机特殊设置">${escapeHtml(t("在线条码只读；导入和导出仅包含本机特殊设置"))}</span></span>
                    <div class="pb-box-foot-actions">
                        <button type="button" class="pb-box-secondary" id="pb-box-export"><span data-pb-i18n="导出备份">${escapeHtml(t("导出备份"))}</span></button>
                        <button type="button" class="pb-box-secondary" id="pb-box-import"><span data-pb-i18n="导入备份">${escapeHtml(t("导入备份"))}</span></button>
                        <input type="file" id="pb-box-import-file" accept="application/json,.json" hidden>
                        <button type="button" class="pb-box-primary" id="pb-box-close-bottom"><span data-pb-i18n="完成">${escapeHtml(t("完成"))}</span></button>
                    </div>
                </footer>
            </section>
        `;
        document.body.appendChild(modal);

        bindModalEvents(modal);
        updateLanguageButton();
        updateBarcodeModeForm();
        renderMappingList();
        updateRemoteStatus();
        document.getElementById("pb-box-code-input")?.focus();
    }

    function closeSettings() {
        document.getElementById("pb-box-modal")?.remove();
        state.modalOpen = false;
        state.editingId = null;
        releaseScanSink();
        resetScanBuffer();
        document.removeEventListener("keydown", closeModalOnEscape, true);
    }

    function bindModalEvents(modal) {
        // 输入事件先正常到达当前 INPUT/TEXTAREA，再在设置窗口边界停止冒泡。
        // 这样 Odoo Navbar 的 document keydown 监听器不会同步修改 POS 商品搜索。
        for (const eventName of ["keydown", "keyup", "keypress"]) {
            modal.addEventListener(eventName, isolateSettingsKeyboardEvent, false);
        }

        modal.querySelector("#pb-box-language-toggle")?.addEventListener("click", toggleLanguage);
        modal.querySelector(".pb-box-close")?.addEventListener("click", closeSettings);
        modal.querySelector("#pb-box-close-bottom")?.addEventListener("click", closeSettings);
        modal.addEventListener("mousedown", (event) => {
            if (event.target === modal) closeSettings();
        });

        document.getElementById("pb-box-form")?.addEventListener("submit", handleMappingSubmit);
        document.getElementById("pb-box-is-product-code-input")?.addEventListener(
            "change",
            updateBarcodeModeForm
        );
        document.getElementById("pb-box-cancel-edit")?.addEventListener("click", resetMappingForm);
        document.getElementById("pb-box-check-connection")?.addEventListener("click", () => {
            document.dispatchEvent(new Event(BRIDGE_CONNECT_EVENT));
            updateSettingsButton();
            showToast(buttonLabel(), "working", 3000);
        });
        document.getElementById("pb-box-sync-now")?.addEventListener("click", () => {
            syncRemoteMappings({ manual: true });
        });
        document.getElementById("pb-box-export")?.addEventListener("click", exportMappings);
        document.getElementById("pb-box-import")?.addEventListener("click", () => {
            document.getElementById("pb-box-import-file")?.click();
        });
        document.getElementById("pb-box-import-file")?.addEventListener("change", importMappings);

        // 小盒条码框允许扫描枪的 Enter 换行；单品码框只保留一个固定条码。
        document.getElementById("pb-unit-code-input")?.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            document.getElementById("pb-box-qty-input")?.focus();
        });
        document.getElementById("pb-box-qty-input")?.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            document.getElementById("pb-box-name-input")?.focus();
        });
        document.getElementById("pb-box-name-input")?.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            document.getElementById("pb-box-form")?.requestSubmit();
        });

        document.addEventListener("keydown", closeModalOnEscape, true);
    }

    function isolateSettingsKeyboardEvent(event) {
        if (!state.modalOpen) return;
        event.stopPropagation();
    }

    function updateBarcodeModeForm() {
        const modeInput = document.getElementById("pb-box-is-product-code-input");
        const unitInput = document.getElementById("pb-unit-code-input");
        const requiredMark = document.getElementById("pb-unit-code-required");
        if (!modeInput || !unitInput) return;

        const boxCodeIsProductCode = modeInput.checked;
        unitInput.disabled = boxCodeIsProductCode;
        unitInput.required = !boxCodeIsProductCode;
        unitInput.placeholder = boxCodeIsProductCode
            ? t("此模式不需要填写")
            : t("Odoo 当前能够识别的单品条码");
        if (requiredMark) requiredMark.hidden = boxCodeIsProductCode;
    }

    function closeModalOnEscape(event) {
        if (!state.modalOpen) {
            document.removeEventListener("keydown", closeModalOnEscape, true);
            return;
        }
        if (document.getElementById("pb-box-password-modal")) return;
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeSettings();
            document.removeEventListener("keydown", closeModalOnEscape, true);
        }
    }

    function formValues() {
        return normalizeMapping({
            id: state.editingId || makeId(),
            boxCodes: document.getElementById("pb-box-code-input")?.value,
            unitCode: document.getElementById("pb-unit-code-input")?.value,
            boxCodeIsProductCode: document.getElementById("pb-box-is-product-code-input")?.checked,
            quantity: document.getElementById("pb-box-qty-input")?.value,
            name: document.getElementById("pb-box-name-input")?.value,
            enabled: true,
            source: "local",
        });
    }

    function showFormError(message) {
        const box = document.getElementById("pb-box-form-error");
        if (!box) return;
        box.textContent = message;
        box.style.display = message ? "block" : "none";
    }

    async function handleMappingSubmit(event) {
        event.preventDefault();
        const mapping = formValues();

        if (!mapping.boxCodes.length) {
            showFormError(t("请至少输入一个小盒条码。"));
            return;
        }
        if (!mapping.boxCodeIsProductCode && !mapping.unitCode) {
            showFormError(t("请填写 Odoo 能识别的固定商品条码；如果当前包装码本身已在 Odoo 中，请勾选上方特殊模式。"));
            return;
        }
        if (!mapping.boxCodeIsProductCode && mapping.boxCodes.includes(mapping.unitCode)) {
            showFormError(t("条码 {0} 不能同时作为小盒码和单品码。", mapping.unitCode));
            return;
        }
        if (!Number.isInteger(mapping.quantity) || mapping.quantity < 1 || mapping.quantity > MAX_QUANTITY) {
            showFormError(t("数量必须是 1–{0} 的整数。", MAX_QUANTITY));
            return;
        }

        const otherMappings = [
            ...state.localMappings.filter((item) => item.id !== mapping.id),
            ...state.remoteMappings,
        ];
        const conflict = findMappingCodeConflict(mapping, otherMappings);
        if (conflict) {
            showFormError(conflict.message);
            return;
        }

        const authorized = await verifyAdminPassword(
            state.editingId
                ? t("修改本机特殊设置需要管理员确认。")
                : t("新增本机特殊设置需要管理员确认。")
        );
        if (!authorized) return;

        const currentIndex = state.localMappings.findIndex((item) => item.id === mapping.id);
        if (currentIndex >= 0) {
            mapping.enabled = state.localMappings[currentIndex].enabled;
            state.localMappings.splice(currentIndex, 1, mapping);
        } else {
            state.localMappings.push(mapping);
        }

        saveMappings();
        renderMappingList();
        resetMappingForm();
        showToast(t("已保存：{0}", mapping.name || mapping.boxCode), "success", 1900);
    }

    function resetMappingForm() {
        state.editingId = null;
        const form = document.getElementById("pb-box-form");
        form?.reset();
        updateBarcodeModeForm();
        const qty = document.getElementById("pb-box-qty-input");
        if (qty) qty.value = "20";
        const saveButton = document.getElementById("pb-box-save-btn");
        if (saveButton) saveButton.textContent = t("添加");
        const cancelButton = document.getElementById("pb-box-cancel-edit");
        if (cancelButton) cancelButton.hidden = true;
        showFormError("");
        document.getElementById("pb-box-code-input")?.focus();
    }

    function exportMappings() {
        const payload = {
            format: "playbox-odoo-pos-box-barcodes",
            version: 7,
            exportedAt: new Date().toISOString(),
            mappings: state.localMappings,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
            type: "application/json;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `playbox_box_barcodes_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showToast(t("已导出 {0} 个本机特殊设置", state.localMappings.length), "success", 2300);
    }

    async function importMappings(event) {
        const input = event.currentTarget;
        const file = input.files?.[0];
        if (!file) return;

        try {
            const parsed = JSON.parse(await file.text());
            const rawMappings = Array.isArray(parsed) ? parsed : parsed?.mappings;
            if (!Array.isArray(rawMappings)) {
                throw new Error(t("备份文件中没有 mappings 列表"));
            }

            const normalized = rawMappings.map((item) => normalizeMapping({
                ...item,
                source: "local",
            }));
            const valid = normalized.filter(isValidStoredMapping);
            const unique = [];
            for (const item of valid) {
                if (findMappingCodeConflict(item, [...unique, ...state.remoteMappings])) continue;
                unique.push(item);
            }

            if (rawMappings.length > 0 && unique.length === 0) {
                throw new Error(t("备份里没有有效的小盒码对应关系"));
            }

            const skipped = rawMappings.length - unique.length;
            const message = t("将用备份中的 {0} 个本机特殊设置替换当前 {1} 个。{2}\n是否继续？", unique.length, state.localMappings.length, skipped ? t("\n有 {0} 条无效、重复或与在线数据冲突的记录会被跳过。", skipped) : "");
            if (!window.confirm(message)) return;
            if (!await verifyAdminPassword(t("导入本机特殊设置需要管理员确认。"))) return;

            state.localMappings = unique;
            saveMappings();
            renderMappingList();
            resetMappingForm();
            showToast(t("导入完成：{0} 个本机特殊设置", unique.length), "success", 2600);
        } catch (error) {
            console.error("[PB 小盒码] 导入失败：", error);
            showFormError(t("导入失败：{0}", error.message || t("文件格式错误")));
        } finally {
            input.value = "";
        }
    }

    function renderMappingList() {
        const container = document.getElementById("pb-box-list");
        if (!container) return;

        const renderRows = (items, source) => items.map((item) => {
            const boxCodesHtml = item.boxCodes.map(escapeHtml).join("<br>");
            const enabledCell = source === "remote"
                ? `<span class="pb-box-readonly">${item.enabled ? t("是") : t("否")}</span>`
                : `<input class="pb-box-toggle" type="checkbox" data-action="toggle" ${item.enabled ? "checked" : ""}>`;
            const actions = source === "remote"
                ? `<button type="button" class="pb-box-test" data-action="test"><span data-pb-i18n="测试">${escapeHtml(t("测试"))}</span></button><span class="pb-box-readonly"><span data-pb-i18n="在线只读">${escapeHtml(t("在线只读"))}</span></span>`
                : `<button type="button" class="pb-box-test" data-action="test"><span data-pb-i18n="测试">${escapeHtml(t("测试"))}</span></button><button type="button" class="pb-box-secondary" data-action="edit"><span data-pb-i18n="修改">${escapeHtml(t("修改"))}</span></button><button type="button" class="pb-box-danger" data-action="delete"><span data-pb-i18n="删除">${escapeHtml(t("删除"))}</span></button>`;
            return `
                <tr data-id="${escapeHtml(item.id)}" data-source="${source}">
                    <td>${enabledCell}</td>
                    <td>${escapeHtml(item.name || "—")}</td>
                    <td class="pb-box-code">${boxCodesHtml}</td>
                    <td class="pb-box-code">${item.boxCodeIsProductCode ? `<strong>${escapeHtml(t("包装码本身"))}</strong>` : escapeHtml(item.unitCode)}</td>
                    <td><strong>${item.quantity}</strong></td>
                    <td><div class="pb-box-actions">${actions}</div></td>
                </tr>
            `;
        }).join("");
        const renderSection = (title, items, source, note) => `
            <section class="pb-box-section">
                <div class="pb-box-section-head">
                    <h3>${title}<span class="pb-box-badge ${source === "remote" ? "pb-online" : ""}">${t("{0} 条", items.length)}</span></h3>
                    <span class="pb-box-section-note">${note}</span>
                </div>
                ${items.length ? `
                    <div class="pb-box-table-wrap">
                        <table class="pb-box-table">
                            <thead><tr><th><span data-pb-i18n="启用">${escapeHtml(t("启用"))}</span></th><th><span data-pb-i18n="名称/颜色">${escapeHtml(t("名称/颜色"))}</span></th><th><span data-pb-i18n="包装条码">${escapeHtml(t("包装条码"))}</span></th><th><span data-pb-i18n="Odoo 商品识别码">${escapeHtml(t("Odoo 商品识别码"))}</span></th><th><span data-pb-i18n="每次增加">${escapeHtml(t("每次增加"))}</span></th><th><span data-pb-i18n="操作">${escapeHtml(t("操作"))}</span></th></tr></thead>
                            <tbody>${renderRows(items, source)}</tbody>
                        </table>
                    </div>
                ` : `<div class="pb-box-empty">${source === "remote" ? t("还没有已应用的在线条码数据。") : t("这台电脑还没有特殊设置。")}</div>`}
            </section>
        `;

        container.innerHTML = [
            renderSection(t("在线统一数据"), state.remoteMappings, "remote", t("来自 Google 表格，只读")),
            renderSection(t("本机特殊设置"), state.localMappings, "local", t("只影响当前 POS 电脑")),
        ].join("");

        container.querySelectorAll("[data-action]").forEach((element) => {
            element.addEventListener("click", handleListAction);
        });
        updateRemoteStatus();
    }

    async function handleListAction(event) {
        const action = event.currentTarget.dataset.action;
        const row = event.currentTarget.closest("tr[data-id]");
        const source = row?.dataset.source;
        const sourceMappings = source === "remote" ? state.remoteMappings : state.localMappings;
        const mapping = sourceMappings.find((item) => item.id === row?.dataset.id);
        if (!mapping) return;

        if (source === "remote" && action !== "test") return;

        if (action === "toggle") {
            // currentTarget is cleared after event dispatch. Capture every
            // identity needed by the async continuation before authentication.
            const control = event.currentTarget;
            const mappingId = String(mapping.id);
            const previousValue = Boolean(mapping.enabled);
            const requestedValue = Boolean(control.checked);
            const restoreControl = () => { if (control?.isConnected) control.checked = previousValue; };
            if (!await verifyAdminPassword(t("启用或停用本机特殊设置需要管理员确认。"))) {
                restoreControl();
                return;
            }
            const current = state.localMappings.find(item => String(item.id) === mappingId);
            const currentRow = control?.closest?.("tr[data-id]");
            if (!current || !control.isConnected || String(currentRow?.dataset.id || "") !== mappingId) {
                restoreControl();
                showFormError(t("设置窗口已变化，请重新操作。"));
                return;
            }
            try {
                current.enabled = requestedValue;
                saveMappings();
                const saved = PBBoxPrefs.get(STORAGE_KEY, null);
                const confirmed = Array.isArray(saved) && saved.find(item => String(item.id) === mappingId);
                if (!confirmed || Boolean(confirmed.enabled) !== requestedValue) throw new Error(t("保存后回读不一致"));
                if (control.isConnected) control.checked = requestedValue;
            } catch (error) {
                current.enabled = previousValue;
                restoreControl();
                refreshEffectiveMappings();
                showFormError(t("保存失败：{0}", error.message || t("请重试")));
            }
            return;
        }

        if (action === "edit") {
            state.editingId = mapping.id;
            document.getElementById("pb-box-code-input").value = mapping.boxCodes.join("\n");
            document.getElementById("pb-unit-code-input").value = mapping.unitCode;
            document.getElementById("pb-box-is-product-code-input").checked = mapping.boxCodeIsProductCode;
            updateBarcodeModeForm();
            document.getElementById("pb-box-qty-input").value = String(mapping.quantity);
            document.getElementById("pb-box-name-input").value = mapping.name;
            document.getElementById("pb-box-save-btn").textContent = t("保存修改");
            document.getElementById("pb-box-cancel-edit").hidden = false;
            showFormError("");
            document.getElementById("pb-box-code-input").focus();
            return;
        }

        if (action === "delete") {
            const label = mapping.name || mapping.boxCode;
            if (!window.confirm(t("确定删除“{0}”吗？", label))) return;
            if (!await verifyAdminPassword(t("删除本机特殊设置需要管理员确认。"))) return;
            state.localMappings = state.localMappings.filter((item) => item.id !== mapping.id);
            saveMappings();
            renderMappingList();
            if (state.editingId === mapping.id) resetMappingForm();
            return;
        }

        if (action === "test") {
            closeSettings();
            enqueueMapping(mapping);
        }
    }

    function ensureToast() {
        let toast = document.getElementById("pb-box-toast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "pb-box-toast";
            document.body.appendChild(toast);
        }
        return toast;
    }

    function showToast(message, type = "working", duration = 0) {
        if (!document.body) return;
        ensureStyles();
        const toast = ensureToast();
        window.clearTimeout(state.toastTimer);
        toast.textContent = message;
        toast.className = `pb-show pb-${type}`;
        if (duration > 0) {
            state.toastTimer = window.setTimeout(() => {
                toast.className = "";
            }, duration);
        }
    }

    function hideToast(type = "") {
        const toast = document.getElementById("pb-box-toast");
        if (!toast) return;
        if (type && !toast.classList.contains(`pb-${type}`)) return;
        window.clearTimeout(state.toastTimer);
        state.toastTimer = null;
        toast.className = "";
    }

    function initializeUi() {
        if (!document.body) {
            window.setTimeout(initializeUi, 80);
            return;
        }
        ensureStyles();
        ensureScanSink();
        ensureSettingsButton();
        syncNativeBridgeCodes();
        window.setTimeout(() => syncRemoteMappings({ manual: false }), 900);

        updateStableOrderlineSnapshot();
        state.debugLastQuantitySignature = getDebugQuantitySignature();
        const observer = new MutationObserver(() => {
            ensureSettingsButton();
            detectAndLogQuantityChange("MutationObserver");
            updateStableOrderlineSnapshot();
        });
        observer.observe(document.body, {
            childList: true,
            characterData: true,
            subtree: true,
        });
        window.addEventListener("pointerup", () => {
            window.setTimeout(() => {
                detectAndLogQuantityChange("pointerup");
                updateStableOrderlineSnapshot();
            }, 0);
        });
        if (DEBUG_ENABLED) {
            console.info(`[PB 小盒码] v${SCRIPT_VERSION} 已启动，已启用 ${state.mappings.filter((m) => m.enabled).length} 个对应关系。`);
            debugLog("SCRIPT STARTUP / 调试版脚本已启动", {
                version: SCRIPT_VERSION,
                url: location.href,
                readyState: document.readyState,
                activeMappingCount: state.mappings.filter((mapping) => mapping.enabled).length,
                maxNativeScanGapMs: MAX_NATIVE_SCAN_GAP_MS,
                message: `控制台筛选 ${DEBUG_PREFIX}，从 SCAN START 复制到 PROCESS END。`,
            });
        }
    }

    // V7 只监听 Odoo 已收齐后的完整扫码事件；不再接管用户的 keydown/keyup。
    window.addEventListener(BRIDGE_NATIVE_SCAN_EVENT, handleOdooNativeBoxScan);
    window.addEventListener(BRIDGE_ERROR_EVENT, handleOdooBridgeError);
    document.addEventListener(BRIDGE_STATE_EVENT, updateSettingsButton);

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeUi, { once: true });
    } else {
        initializeUi();
    }
})();
})();

(function () {
const window = typeof unsafeWindow !== "undefined" ? unsafeWindow : globalThis.window;
(function () {
    'use strict';
    if (!/(^|\.)odoo\.com$/i.test(location.hostname) || location.protocol !== "https:") return;
    if (window.PBCartUnit) return;
    const VERSION = "1.0.20";
    // Existing Playbox launchers use 2147483000; keep this dialog and its errors above that fixed layer.
    const LAYERS = { modal: 2147483200, message: 2147483210 };
    const LANGUAGE_KEY = 'pb-cart-unit-language:' + location.host;
    let languageChoice = PBUI.get();
    function setLanguage(value) {
        if (value !== 'zh-CN' && value !== 'es-MX') return false;
        PBUI.set(value); return true;
    }
    function applySuiteLanguage(value) {
        languageChoice = value;
        if (panel) { panel.pbRefreshLanguage?.(); syncLanguageButton(); }
        metadataLayoutCache = new WeakMap();
        schedule();
    }
    function syncLanguageButton() {
        const mount = panel?.querySelector('.pb-cart-unit-dialog-header');
        let button = document.getElementById('pb-cart-unit-language');
        if (!mount) { button?.remove(); return; }
        if (!button) {
            button = document.createElement('button'); button.id = 'pb-cart-unit-language'; button.type = 'button';
            button.append(element('span', '中'), element('span', 'ES'));
            button.addEventListener('click', event => { event.stopPropagation(); if (panel) setLanguage(es() ? 'zh-CN' : 'es-MX'); });
        }
        if (button.parentElement !== mount) mount.append(button);
        const current = es() ? 'es-MX' : 'zh-CN';
        if (button.dataset.language !== current) button.dataset.language = current;
        const description = es() ? 'Idioma de unidad y precio: Español (México). Cambiar a chino.' : '单位与价格语言：中文。切换为墨西哥西语。';
        if (button.title !== description) { button.title = description; button.setAttribute('aria-label', description); }
        button.disabled = false;
    }
    const KEY = 'pb-cart-unit-v1:' + location.host + ':';
    const states = new Map();
    const internal = new Set();
    const unitCache = new Map();
    let store, loader, bootTimer, observer, frame, panel;
    const es = () => languageChoice ? languageChoice === 'es-MX' : !(document.documentElement.lang || 'zh').toLowerCase().startsWith('zh');
    const t = (zh, spanish) => es() ? spanish : zh;
    const id = (record) => Number(record?.id ?? record?.[0] ?? record);
    const label = (record) => String(record?.name ?? record?.[1] ?? '');
    const number = (value) => Number(value).toLocaleString(es() ? 'es-MX' : 'zh-CN', { maximumFractionDigits: 6 });
    const key = (line) => line.order_id?.uuid && line.uuid ? KEY + line.order_id.uuid + ':' + line.uuid : null;
    function state(line) {
        if (states.has(key(line))) return states.get(key(line));
        let data = null;
        try { data = JSON.parse(localStorage.getItem(key(line))); } catch (_) { /* Keep native POS usable if storage is unavailable. */ }
        if (!data || data.productId !== id(line.product_id) || !Number.isFinite(data.factor) || data.factor <= 0 || !Number.isInteger(data.priceId)) data = null;
        if (states.size >= 2048) states.delete(states.keys().next().value);
        states.set(key(line), data);
        return data;
    }
    function save(line, data) {
        states.set(key(line), data);
        try {
            const destination = key(line);
            if (!destination) throw new Error('Missing order-line identity');
            const payload = JSON.stringify({ ...data, time: Date.now() });
            localStorage.setItem(destination, payload);
            if (localStorage.getItem(destination) !== payload) throw new Error('Unit setting readback failed');
        } catch (error) {
            console.error('[Playbox] Unit display preference was not persisted', error);
            notify(t('包装显示设置未能保存，刷新后可能恢复为件；请核对数量和单价。', 'No se guardó la presentación. Al recargar puede volver a piezas; revisa la cantidad y el precio.'));
        }
        schedule(line);
    }
    function selected() { const order = store?.getOrder(); return { order, line: order?.getSelectedOrderline() }; }
    function editable(line) {
        if (!line?.uuid || !line?.product_id || !line.order_id?.uuid || !Array.isArray(line.order_id.lines) || !line.order_id.lines.some(item => item.uuid === line.uuid && id(item.product_id) === id(line.product_id))) throw new Error(t('商品行已变化，请重新选择。', 'La línea cambió. Selecciónala de nuevo.'));
        if (line.order_id.state !== 'draft' || line.order_id.finalized || line.order_id.preset_id?.is_return || line.refunded_orderline_id || line.qty <= 0) throw new Error(t('仅可修改未付款的正数销售行；退款沿用原单数量和价格。', 'Sólo líneas de venta positivas sin pagar. Las devoluciones conservan el precio original.'));
        if (line.is_reward_line || line.combo_parent_id || line.combo_line_ids?.length || line.product_id.product_tmpl_id?.tracking !== 'none' && line.product_id.product_tmpl_id?.tracking) throw new Error(t('奖励行、组合商品、批次和序列号商品请使用原有流程。', 'Usa el flujo original para premios, combos, lotes y números de serie.'));
        if (line.product_id.product_tmpl_id?.to_weight) throw new Error(t('称重商品请使用原有称重流程。', 'Usa el flujo de pesaje para este producto.'));
    }
    function allPrices() {
        return (store?.config?.available_pricelist_ids || []).filter(p => p && typeof p.getRulesByProductId === 'function');
    }
    function defaultBoxPrice() {
        const matches = allPrices().filter(p => /^(箱价|precio\s*(de\s*)?caja|precio\s*por\s*caja)$/i.test(label(p).trim()));
        return matches.length === 1 ? matches[0] : null;
    }
    function priceList(priceId) {
        const price = allPrices().find(p => id(p) === Number(priceId));
        if (!price) throw new Error(t('价格表未在当前 POS 加载，请先在 POS 配置中启用。', 'La lista no está cargada en este POS. Actívala en su configuración.'));
        return price;
    }
    function ruleFor(line, quantity, price) {
        const template = line.product_id.product_tmpl_id;
        const model = store.models['product.pricelist.item'];
        let rule = price.findBestRule(price.getRulesByProductId(id(line.product_id)), quantity) || price.findBestRule(price.getRulesByTmplId(id(template)), quantity);
        if (!rule) rule = price.findBestRule(model.readMany(price.getCategoryRulesIds(template.parentCategories)), quantity);
        if (!rule) rule = price.findBestRule(model.readMany(price.getGlobalRulesIds()), quantity);
        return rule;
    }
    function checkPriceChain(line, quantity, price, requireRule, seen = new Set()) {
        if (seen.has(id(price))) throw new Error(t('价格表存在循环引用，请先修正价格表。', 'La lista tiene una referencia circular. Corrígela primero.'));
        seen.add(id(price));
        const rule = ruleFor(line, quantity, price);
        if (requireRule && !rule) throw new Error(t('所选价格表没有适用的包装价格规则，请核对价格表。', 'La lista no tiene una regla de precio aplicable. Revísala.'));
        if (rule?.base === 'pricelist') {
            if (!rule.base_pricelist_id || typeof rule.base_pricelist_id.getRulesByProductId !== 'function') throw new Error(t('关联的基础价格表未加载，请先修正 POS 配置。', 'La lista base no está cargada. Revisa la configuración del POS.'));
            checkPriceChain(line, quantity, rule.base_pricelist_id, false, seen);
        }
    }
    function quote(line, quantity, priceId, requireRule = false) {
        const price = priceList(priceId);
        checkPriceChain(line, quantity, price, requireRule);
        // Delegate variant, quantity tiers, categories, formula, currencies and price extras to Odoo.
        const computed = line.product_id.product_tmpl_id.getPrice(price, quantity, line.getPriceExtra(), false, line.product_id);
        const precision = store.models['decimal.precision'].find(item => item.name === 'Product Price');
        const amount = precision.round(computed);
        if (!Number.isFinite(amount) || amount < 0) throw new Error(t('价格计算失败，数量和原价保持不变。', 'No se pudo calcular el precio. No se cambió la línea.'));
        return { amount, price };
    }
    async function rpc(model, method, args) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        let response;
        try { response = await fetch('/web/dataset/call_kw/' + model + '/' + method, { signal: controller.signal, method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: Date.now(), params: { model, method, args, kwargs: {} } }) }); }
        finally { clearTimeout(timeout); }
        if (!response.ok) throw new Error(t('读取包装配置失败，请检查网络。', 'No se pudo leer la presentación. Revisa la conexión.'));
        const result = await response.json();
        if (result.error || !Array.isArray(result.result)) throw new Error(result.error?.data?.message || t('包装配置无法读取。', 'No se pudo leer la presentación.'));
        return result.result;
    }
    async function units(line) {
        const productId = id(line.product_id);
        const cached = unitCache.get(productId);
        if (cached && cached.expires > Date.now()) return cached.promise;
        unitCache.delete(productId);
        const promise = (async () => {
            const [product] = await rpc('product.product', 'read', [[productId], ['id', 'uom_id', 'uom_ids']]);
            if (!product || product.id !== productId) throw new Error(t('商品配置已变化，请刷新 POS。', 'El producto cambió. Recarga el POS.'));
            const ids = [...new Set([id(product.uom_id), ...(product.uom_ids || []).map(id)])];
            const records = await rpc('uom.uom', 'read', [ids, ['id', 'name', 'factor', 'rounding']]);
            const base = records.find(r => r.id === id(product.uom_id));
            if (!base || !Number.isFinite(base.factor) || base.factor <= 0) throw new Error(t('基础单位配置无效。', 'La unidad base no es válida.'));
            return records.filter(r => r.id === base.id || !/备用条码|alternate.*barcode/i.test(r.name)).map(r => ({ id: r.id, name: r.name, factor: r.factor / base.factor, base: r.id === base.id, rounding: base.rounding })).filter(r => Number.isFinite(r.factor) && r.factor > 0).sort((a, b) => Number(b.base) - Number(a.base) || a.factor - b.factor);
        })();
        if (unitCache.size >= 256) unitCache.delete(unitCache.keys().next().value);
        unitCache.set(productId, { promise, expires: Date.now() + 300000 });
        try { return await promise; } catch (error) { unitCache.delete(productId); throw error; }
    }
    function targetQuantity(count, unit) {
        if (!Number.isFinite(count) || count <= 0 || count > 999999 || !Number.isFinite(unit.factor) || unit.factor <= 0) throw new Error(t('请输入有效的正数数量。', 'Ingresa una cantidad positiva válida.'));
        if (!unit.base && !Number.isInteger(count)) throw new Error(t('包装数量请输入整数；散件使用基础单位。', 'Ingresa presentaciones completas; usa la unidad base para piezas sueltas.'));
        const quantity = count * unit.factor;
        if (!Number.isFinite(quantity) || quantity > 999999) throw new Error(t('换算数量过大，请核对包装数量。', 'La cantidad convertida es demasiado grande.'));
        const rounding = unit.rounding || 0.01;
        if (Math.abs(quantity / rounding - Math.round(quantity / rounding)) > 1e-6) throw new Error(t('换算结果不符合商品单位精度。', 'La cantidad no coincide con la precisión de la unidad.'));
        return quantity;
    }
    function apply(line, unit, count, priceId, snapshot) {
        editable(line);
        const current = selected();
        if ((current.line && current.line.uuid !== line.uuid || current.order?.uuid !== line.order_id.uuid) || snapshot && (line.qty !== snapshot.qty || line.price_unit !== snapshot.price || line.discount !== snapshot.discount || id(line.order_id.pricelist_id) !== snapshot.orderPrice)) throw new Error(t('数量、价格或订单已变化，请关闭后重新打开。', 'La cantidad, el precio o la orden cambió. Abre de nuevo el selector.'));
        const quantity = targetQuantity(count, unit);
        const { amount } = quote(line, quantity, priceId, !unit.base); // Validate everything before mutating.
        const old = { qty: line.qty, price: line.price_unit, type: line.price_type, data: state(line) };
        internal.add(key(line));
        try {
            const result = line.setQuantity(quantity, true);
            if (result !== true || Math.abs(line.qty - quantity) > 1e-6) throw new Error(t('Odoo 拒绝了本次数量修改。', 'Odoo rechazó el cambio de cantidad.'));
            line.setUnitPrice(amount);
            line.price_type = 'manual'; // This line's list is independent of the order's list.
            save(line, { productId: id(line.product_id), unitId: unit.id, name: unit.name, factor: unit.factor, priceId: Number(priceId), manualOverride: false });
            store?.numberBuffer?.reset();
            return { quantity: line.qty, unitPrice: line.price_unit, totalBeforeTaxAndDiscount: line.qty * line.price_unit };
        } catch (error) {
            line.qty = old.qty;
            line.price_unit = old.price;
            line.price_type = old.type;
            states.set(key(line), old.data);
            throw error;
        } finally { internal.delete(key(line)); schedule(line); }
    }
    function patchLine(Class) {
        if (!Class || Class.prototype.__pbCartUnitV1) return;
        const proto = Class.prototype;
        const setQuantity = proto.setQuantity, setPrice = proto.setUnitPrice, canMerge = proto.canBeMergedWith;
        if (![setQuantity, setPrice, canMerge].every(fn => typeof fn === 'function')) return;
        Object.defineProperty(proto, '__pbCartUnitV1', { value: true });
        const displayClasses = proto.getDisplayClasses;
        proto.getDisplayClasses = function (...args) {
            const classes = displayClasses.apply(this, args);
            return /^[a-zA-Z0-9_-]+$/.test(this.uuid || '') ? { ...classes, ['pbcu-' + this.uuid]: true } : classes;
        };
        proto.setQuantity = function (quantity, keepPrice) {
            const data = state(this);
            if (!data || internal.has(key(this)) || data.manualOverride || typeof quantity !== 'number' && !/^\s*\d+(\.\d+)?\s*$/.test(String(quantity))) {
                const result = setQuantity.call(this, quantity, keepPrice); schedule(this); return result;
            }
            const next = Number(quantity);
            if (next <= 0 || !Number.isFinite(next)) { const result = setQuantity.call(this, quantity, keepPrice); schedule(this); return result; }
            let amount;
            try { amount = quote(this, this.product_id.uom_id?.round(next) ?? this.product_id.product_tmpl_id.uom_id.round(next), data.priceId, data.factor !== 1).amount; }
            catch (error) { notify(error.message); return { title: 'Unidad / 单位', body: error.message }; }
            internal.add(key(this));
            try {
                const result = setQuantity.call(this, quantity, true);
                if (result === true) { setPrice.call(this, amount); this.price_type = 'manual'; }
                return result;
            } finally { internal.delete(key(this)); schedule(this); }
        };
        proto.setUnitPrice = function (price) {
            const result = setPrice.call(this, price);
            const data = state(this);
            if (data && !internal.has(key(this))) save(this, { ...data, manualOverride: true });
            return result;
        };
        proto.canBeMergedWith = function (other) {
            const left = state(this), right = state(other);
            // Converted lines remain separate from newly added/scanned loose pieces.
            if (left || right) {
                if (!left || !right || left.unitId !== right.unitId || left.priceId !== right.priceId || left.factor !== right.factor || left.manualOverride !== right.manualOverride) return false;
            }
            return canMerge.call(this, other);
        };
    }
    function patchStore(Class) {
        if (!Class || Class.prototype.__pbCartUnitV1) return;
        const original = Class.prototype.getOrder;
        if (typeof original !== 'function') return;
        const capturedLoader = loader;
        Object.defineProperty(Class.prototype, '__pbCartUnitV1', { value: true });
        Class.prototype.getOrder = function (...args) {
            if (window.odoo?.loader === capturedLoader && store !== this) { store = this; document.dispatchEvent(new Event('pb-box-odoo-connect-v1')); }
            return original.apply(this, args);
        };
    }
    function moduleReady(name, exports) {
        if (name === '@point_of_sale/app/models/pos_order_line') patchLine(exports?.PosOrderline);
        if (name === '@point_of_sale/app/services/pos_store') patchStore(exports?.PosStore);
    }
    let unitLoaderListener = null;
    function attachLoader() {
        try {
            const existing = window.posmodel || window.odoo?.__WOWL_DEBUG__?.root?.env?.services?.pos;
            if (existing && typeof existing.getOrder === 'function' && existing.models && store !== existing) {
                store = existing;
                document.dispatchEvent(new Event('pb-box-odoo-connect-v1'));
            }
        } catch (_) { /* The native POS may still be in setup. */ }
        const current = window.odoo?.loader;
        if (current === loader) return;
        if (unitLoaderListener) loader?.bus?.removeEventListener('module-started', unitLoaderListener);
        loader = current;
        unitLoaderListener = null;
        if (!current) return;
        ['@point_of_sale/app/models/pos_order_line', '@point_of_sale/app/services/pos_store'].forEach(name => moduleReady(name, current.modules?.get(name)));
        unitLoaderListener = event => {
            if (loader === current && window.odoo?.loader === current) moduleReady(event.detail?.moduleName, event.detail?.module);
        };
        current.bus?.addEventListener('module-started', unitLoaderListener);
    }
    const pendingUnitRows = new Set();
    let fullUnitRender = false;
    function schedule(target) {
        if (target?.uuid) pendingUnitRows.add(target.uuid);
        else if (target?.nodeType === 1 && target.matches('.product-screen .orderline')) pendingUnitRows.add(target);
        else fullUnitRender = true;
        if (!frame && document.body) frame = requestAnimationFrame(() => {
            frame = null;
            const rows = fullUnitRender ? null : [...pendingUnitRows];
            fullUnitRender = false; pendingUnitRows.clear();
            render(rows);
        });
    }
    function notify(message) {
        if (panel) { const error = panel.querySelector('[data-error]'); if (error) { error.textContent = message; return; } }
        let toast = document.getElementById('pb-cart-unit-message');
        if (!toast) { toast = document.createElement('div'); toast.id = 'pb-cart-unit-message'; toast.setAttribute('role', 'alert'); document.body.append(toast); }
        toast.textContent = message;
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => toast.remove(), 8000);
    }
    function render(targets = null) {
        syncLanguageButton();
        for (const row of layoutRows) if (!row.isConnected) { layoutResize?.unobserve(row); layoutRows.delete(row); }
        const current = selected();
        const lineMap = new Map((current.order?.lines || []).map(line => [line.uuid, line]));
        const rows = targets === null ? document.querySelectorAll('.product-screen .orderline') :
            targets.map(target => typeof target === 'string'
                ? document.querySelector('.product-screen .orderline.pbcu-' + CSS.escape(target))
                : target).filter(row => row?.isConnected);
        rows.forEach(row => {
            const uuid = [...row.classList].find(name => name.startsWith('pbcu-'))?.slice(5);
            const line = lineMap.get(uuid) || (row.classList.contains('selected') ? current.line : null);
            if (!line) {
                if (row.dataset.pbUnitWide != null) delete row.dataset.pbUnitWide;
                layoutResize?.unobserve(row); layoutRows.delete(row);
                if (row.classList.contains('pb-cart-unit-full-row')) row.classList.remove('pb-cart-unit-full-row');
                if (row.classList.contains('pb-cart-unit-full-content')) row.classList.remove('pb-cart-unit-full-content');
                row.querySelector('.pb-cart-unit-full-content')?.classList.remove('pb-cart-unit-full-content');
                row.querySelector('.pb-cart-unit-toolbar')?.remove();
                const metadata = row.querySelector('.pb-cart-unit-meta');
                if (metadata) metadata.replaceWith(...metadata.childNodes);
                return;
            }
            renderLine(row, line);
        });
    }
    function shortUnit(name, packaged = false) {
        const value = String(name || '').trim();
        if (!packaged && /^(piezas?|pieces?|unidades?|units?|pzas?\.?|个|件)$/i.test(value)) return t('个', 'piezas');
        if (packaged && /caja|cart[oó]n|箱/i.test(value)) return t('箱', 'Caja');
        if (packaged && /盒|\bbox\b/i.test(value)) return t('盒', 'Paquete');
        if (packaged && /paquete|pack|包/i.test(value)) return t('包', 'Paquete');
        if (packaged) return t('份', 'presentación');
        return value || t('单位', 'Unidad');
    }
    function unitLabel(name, packaged = false) {
        const value = String(name || '').trim();
        if (!packaged && /^(piezas?|pieces?|unidades?|units?|pzas?\.?|个|件)$/i.test(value)) return es() ? 'Pieza' : value;
        // Preserve custom presentation names and factors. Only translate an exact generic name.
        if (es() && /^(箱|箱装)$/.test(value)) return 'Caja';
        if (es() && /^(盒|盒装)$/.test(value)) return 'Paquete';
        return value || t('单位', 'Unidad');
    }
    function matchingSpec(text, name, factor) {
        const normalize = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
        // A piece selection must not hide available box specifications; no substring matches.
        return factor !== 1 && normalize(text) === normalize(name);
    }
    let measureContext, layoutResize;
    let metadataLayoutCache = new WeakMap();
    const layoutRows = new Set();
    function inlineWidth(node) {
        const style = getComputedStyle(node);
        if (style.display === 'none') return 0;
        const px = value => Number.parseFloat(value) || 0;
        let width = 0, children = 0;
        for (const child of node.childNodes) {
            if (child.nodeType === 3) {
                const text = child.textContent.replace(/\s+/g, ' ');
                if (!text) continue;
                if (!measureContext) measureContext = document.createElement('canvas').getContext('2d');
                if (!measureContext) return Infinity; // Prefer safe wrapping if measuring is unavailable.
                measureContext.font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                width += measureContext.measureText(text).width + px(style.letterSpacing) * Math.max(0, text.length - 1);
                children++;
            } else if (child.nodeType === 1 && getComputedStyle(child).display !== 'none') {
                width += inlineWidth(child); children++;
            }
        }
        // Font Awesome chevrons use a pseudo-element rather than a text node.
        if (!children) width = node.getBoundingClientRect().width - px(style.paddingLeft) - px(style.paddingRight) - px(style.borderLeftWidth) - px(style.borderRightWidth);
        if (style.display.includes('flex')) width += px(style.columnGap) * Math.max(0, children - 1);
        return width + px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth) + px(style.marginLeft) + px(style.marginRight);
    }
    function adaptMetadata(row, content, metadata, toolbar, stock) {
        const rowWidth = row.clientWidth;
        if (!rowWidth) return; // Hidden cart: reconsider when its width becomes visible.
        const photoNode = [...row.children].find(item => item.classList.contains('pb-cart-product-image'));
        const signature = [rowWidth, photoNode?.offsetWidth || 0, toolbar.textContent, stock?.textContent || '', es()].join('\u001f');
        const cached = metadataLayoutCache.get(row);
        if (cached && cached.signature === signature && cached.content === content &&
            cached.metadata === metadata && cached.toolbar === toolbar && cached.stock === stock) return;

        const px = value => Number.parseFloat(value) || 0;
        const style = getComputedStyle(content), rowStyle = getComputedStyle(row);
        const photo = [...row.children].find(item => item.classList.contains('pb-cart-product-image'));
        let available = row.clientWidth - px(rowStyle.paddingLeft) - px(rowStyle.paddingRight) - px(style.paddingLeft) - px(style.paddingRight);
        if (photo && getComputedStyle(photo).display !== 'none') {
            const imageStyle = getComputedStyle(photo);
            available -= photo.getBoundingClientRect().width + px(imageStyle.marginLeft) + px(imageStyle.marginRight) + 6;
        }
        const items = [toolbar, ...Array.from(stock?.children || [])].filter(item => getComputedStyle(item).display !== 'none');
        const needed = items.reduce((sum, item) => sum + inlineWidth(item), 0) + Math.max(0, items.length - 1) * 3;
        // Fit is calculated from the normal right column, independently of the current mode.
        // Keep a small rounding allowance so font/subpixel differences cannot alternate modes.
        const wide = needed > Math.max(0, Math.floor(available) - 2) ? '1' : '0';
        if (row.dataset.pbUnitWide !== wide) row.dataset.pbUnitWide = wide;
        if (layoutResize && !layoutRows.has(row)) { layoutRows.add(row); layoutResize.observe(row); }
        metadataLayoutCache.set(row, { signature, content, metadata, toolbar, stock });
    }
    function renderLine(row, line) {
        const content = row.querySelector('.line-details')?.parentElement || row;
        if (!row.classList.contains('pb-cart-unit-full-row')) row.classList.add('pb-cart-unit-full-row');
        if (content !== row && !content.classList.contains('pb-cart-unit-full-content')) content.classList.add('pb-cart-unit-full-content');
        const stock = content.querySelector('.pos-mini-stock-display');
        let metadata = content.querySelector('.pb-cart-unit-meta');
        if (!metadata) {
            metadata = document.createElement('div'); metadata.className = 'pb-cart-unit-meta';
            if (stock) stock.before(metadata); else content.append(metadata);
        }
        let toolbar = row.querySelector('.pb-cart-unit-toolbar');
        if (!toolbar) {
            toolbar = document.createElement('div'); toolbar.className = 'pb-cart-unit-toolbar';
            const button = document.createElement('button'); button.type = 'button'; button.className = 'pb-cart-unit-trigger'; button.setAttribute('aria-haspopup', 'dialog');
            const buttonLabel = document.createElement('span'); buttonLabel.className = 'pb-cart-unit-label';
            const chevron = document.createElement('i'); chevron.className = 'fa fa-angle-down'; chevron.setAttribute('aria-hidden', 'true');
            button.append(buttonLabel, chevron);
            button.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); });
            button.addEventListener('click', event => { event.stopPropagation(); openPanel({ lineUuid: toolbar.dataset.lineUuid, orderUuid: toolbar.dataset.orderUuid }); });
            const detail = document.createElement('span'); toolbar.append(button, detail); metadata.append(toolbar);
        }
        // Share one wrapping row, without rewriting inventory-owned HTML or badge styles.
        // Its renderer searches descendants, so it can still update this same stock node.
        if (toolbar.parentElement !== metadata) metadata.prepend(toolbar);
        if (stock && stock.parentElement !== metadata) metadata.append(stock);
        const data = state(line);
        toolbar.dataset.lineUuid = line.uuid;
        toolbar.dataset.orderUuid = line.order_id.uuid;
        const baseName = label(line.product_id.product_tmpl_id.uom_id);
        const unitName = data?.name || baseName;
        const factor = data?.factor || 1;
        const text = unitLabel(unitName, factor !== 1) + ' · ' + number(line.qty / factor);
        // Never write inventory-owned HTML/classes: its renderer compares innerHTML.
        // Mark only our wrapper, so its next stock refresh does not start a rewrite loop.
        const spec = stock?.firstElementChild;
        const merged = spec?.tagName === 'SPAN' && !spec.querySelector('b') && matchingSpec(spec.textContent, unitName, factor) ? '1' : '0';
        if (metadata.dataset.specMerged !== merged) metadata.dataset.specMerged = merged;
        const buttonLabel = toolbar.firstChild.querySelector('.pb-cart-unit-label');
        if (buttonLabel.textContent !== text || !buttonLabel.querySelector('.pb-cart-unit-count')) {
            const name = element('span', unitLabel(unitName, factor !== 1)); name.className = 'pb-cart-unit-name';
            const count = element('span', number(line.qty / factor)); count.className = 'pb-cart-unit-count';
            buttonLabel.replaceChildren(name, document.createTextNode(' · '), count);
        }
        const conversion = number(line.qty / factor) + ' × ' + number(factor) + ' = ' + number(line.qty) + ' ' + unitLabel(baseName);
        const description = t('切换单位与本行价格：', 'Cambiar unidad y precio de esta línea: ') + (line.full_product_name || line.product_id.display_name || '') + ' · ' + unitLabel(unitName, factor !== 1) + ' · ' + conversion;
        if (toolbar.firstChild.getAttribute('aria-label') !== description) { toolbar.firstChild.setAttribute('aria-label', description); toolbar.firstChild.title = description; }
        const detail = data?.manualOverride ? t('手动价格', 'Precio manual') : '';
        if (toolbar.lastChild.textContent !== detail) toolbar.lastChild.textContent = detail;
        adaptMetadata(row, content, metadata, toolbar, stock);
    }
    function element(tag, text) { const node = document.createElement(tag); if (text != null) node.textContent = text; return node; }
    async function openPanel(target) {
        if (panel) return;
        store?.numberBuffer?.capture();
        store?.numberBuffer?.reset();
        const current = selected();
        const line = target && current.order?.uuid === target.orderUuid ? current.order.lines.find(item => item.uuid === target.lineUuid) : target ? null : current.line;
        try { editable(line); } catch (error) { notify(error.message); return; }
        current.order.selectOrderline(line);
        const snapshot = { qty: line.qty, price: line.price_unit, discount: line.discount, orderPrice: id(line.order_id.pricelist_id) };
        const previousFocus = document.activeElement;
        panel = element('div'); panel.className = 'pb-cart-unit-overlay';
        const dialog = element('section'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'pb-cart-unit-title');
        const theme = document.querySelector('.product-screen .btn-primary');
        if (theme) { const accent = getComputedStyle(theme).backgroundColor; if (accent && accent !== 'rgba(0, 0, 0, 0)' && accent !== 'transparent') panel.style.setProperty('--pbcu-accent', accent); }
        const title = element('h2', t('单位与价格', 'Unidad y precio')); title.id = 'pb-cart-unit-title';
        const product = element('p', line.full_product_name || line.product_id.display_name); product.className = 'pb-cart-unit-product';
        const close = element('button', t('取消', 'Cancelar')); close.type = 'button';
        const shield = event => { if (panel) { event.stopImmediatePropagation(); if (event.key === 'Enter') event.preventDefault(); } };
        const destroy = () => {
            panel?.remove(); panel = null;
            window.removeEventListener('keydown', keyboard, true);
            window.removeEventListener('keyup', shield, true); window.removeEventListener('keypress', shield, true);
            store?.numberBuffer?.reset();
            if (previousFocus?.isConnected) previousFocus.focus();
        };
        const keyboard = event => {
            if (!panel) return;
            event.stopImmediatePropagation();
            if (event.key === 'Escape') { event.preventDefault(); destroy(); }
            if (event.key === 'Enter') event.preventDefault(); // A scanner's suffix must not confirm a unit change.
            if (event.key === 'Tab') {
                const focusable = [...dialog.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled)')];
                const index = focusable.indexOf(document.activeElement);
                if (event.shiftKey && index <= 0) { event.preventDefault(); focusable.at(-1)?.focus(); }
                else if (!event.shiftKey && (index === focusable.length - 1 || index < 0)) { event.preventDefault(); focusable[0]?.focus(); }
            }
        };
        close.onclick = destroy; window.addEventListener('keydown', keyboard, true);
        window.addEventListener('keyup', shield, true); window.addEventListener('keypress', shield, true);
        const error = element('p', t('正在读取包装配置…', 'Leyendo presentaciones…')); error.dataset.error = '1'; error.dataset.loading = '1'; error.setAttribute('role', 'alert');
        const header = element('div'); header.className = 'pb-cart-unit-dialog-header'; header.append(title);
        panel.pbRefreshLanguage = () => {
            title.textContent = t('单位与价格', 'Unidad y precio'); close.textContent = t('取消', 'Cancelar');
            if (error.dataset.loading === '1') error.textContent = t('正在读取包装配置…', 'Leyendo presentaciones…');
        };
        dialog.append(header, product, error, close); panel.append(dialog); document.body.append(panel); syncLanguageButton(); close.focus();
        const thisPanel = panel;
        try {
            const choices = await units(line);
            if (panel !== thisPanel) return;
            error.dataset.loading = '0';
            editable(line);
            const data = state(line);
            const unitInput = element('select'); unitInput.id = 'pb-cart-unit-select';
            choices.forEach(unit => { const option = element('option', unitLabel(unit.name, !unit.base) + (unit.base ? '' : ' · ' + number(unit.factor) + t(' 个/包装', ' piezas/presentación'))); option.value = String(unit.id); unitInput.append(option); });
            unitInput.value = String(data?.unitId || choices.find(u => u.base)?.id);
            const count = element('input'); count.type = 'number'; count.inputMode = 'decimal'; count.min = '0'; count.max = '999999'; count.step = 'any'; count.id = 'pb-cart-unit-count'; count.value = String(line.qty / (data?.factor || 1));
            const price = element('select'); price.id = 'pb-cart-unit-price';
            const placeholder = element('option', t('选择价格表', 'Selecciona lista de precios')); placeholder.value = ''; price.append(placeholder);
            allPrices().forEach(list => { const option = element('option', label(list)); option.value = String(id(list)); price.append(option); });
            price.value = String(data?.priceId || id(line.order_id.pricelist_id) || '');
            const preview = element('div'); preview.className = 'pb-cart-unit-preview'; preview.setAttribute('aria-live', 'polite');
            const summary = element('div'); summary.className = 'pb-cart-unit-summary';
            const quantityCell = element('div'); quantityCell.append(element('span', t('实际件数', 'Cantidad base'))); const quantityValue = element('strong'); quantityCell.append(quantityValue);
            const totalCell = element('div'); totalCell.append(element('span', t('折扣前金额', 'Total antes de descuento'))); const totalValue = element('strong'); totalCell.append(totalValue); summary.append(quantityCell, totalCell);
            const pricing = element('p'); pricing.className = 'pb-cart-unit-pricing'; preview.append(summary, pricing);
            const hint = element('p', t('保留数字：10 个 → 10 箱。键盘数量仍按件输入；原折扣保留。', 'Conserva el número: 10 piezas → 10 cajas. El teclado usa piezas. Conserva el descuento.')); hint.className = 'pb-cart-unit-hint';
            const confirm = element('button', t('确认切换', 'Confirmar')); confirm.type = 'button'; confirm.className = 'pb-cart-unit-confirm';
            function refresh(changeUnit = false) {
                try {
                    const unit = choices.find(u => u.id === Number(unitInput.value));
                    if (!unit) throw new Error(t('请选择商品单位。', 'Selecciona una unidad.'));
                    if (changeUnit) price.value = String(unit.base ? id(line.order_id.pricelist_id) || '' : id(defaultBoxPrice()) || '');
                    const quantity = targetQuantity(Number(count.value), unit);
                    const q = quote(line, quantity, Number(price.value), !unit.base);
                    preview.hidden = false;
                    quantityValue.textContent = number(quantity) + ' ' + shortUnit(choices.find(u => u.base).name);
                    totalValue.textContent = (store.currency?.symbol || '') + ' ' + number(quantity * q.amount);
                    pricing.textContent = t('每件 ', 'Precio base ') + number(q.amount) + (unit.base ? '' : ' · ' + t('每', 'Por ') + shortUnit(unit.name, true) + ' ' + number(q.amount * unit.factor));
                    error.textContent = ''; confirm.disabled = false;
                } catch (problem) { preview.hidden = true; error.textContent = problem.message; confirm.disabled = true; }
            }
            const field = (text, control) => { const item = element('label', text); item.htmlFor = control.id; const div = element('div'); div.append(item, control); return div; };
            close.remove(); error.remove();
            const fields = element('div'); fields.className = 'pb-cart-unit-fields'; fields.append(field(t('单位 / 包装', 'Unidad / Presentación'), unitInput), field(t('数量', 'Cantidad'), count));
            const actions = element('div'); actions.className = 'pb-cart-unit-actions'; actions.append(close, confirm);
            dialog.append(fields, field(t('本行价格表', 'Lista de esta línea'), price), preview, hint, error, actions);
            panel.pbRefreshLanguage = () => {
                title.textContent = t('单位与价格', 'Unidad y precio'); close.textContent = t('取消', 'Cancelar');
                confirm.textContent = t('确认切换', 'Confirmar');
                fields.querySelector('label[for="pb-cart-unit-select"]').textContent = t('单位 / 包装', 'Unidad / Presentación');
                fields.querySelector('label[for="pb-cart-unit-count"]').textContent = t('数量', 'Cantidad');
                dialog.querySelector('label[for="pb-cart-unit-price"]').textContent = t('本行价格表', 'Lista de esta línea');
                choices.forEach((unit, i) => { unitInput.options[i].textContent = unitLabel(unit.name, !unit.base) + (unit.base ? '' : ' · ' + number(unit.factor) + t(' 个/包装', ' piezas/presentación')); });
                placeholder.textContent = t('选择价格表', 'Selecciona lista de precios');
                quantityCell.firstChild.textContent = t('实际件数', 'Cantidad base'); totalCell.firstChild.textContent = t('折扣前金额', 'Total antes de descuento');
                hint.textContent = t('保留数字：10 个 → 10 箱。键盘数量仍按件输入；原折扣保留。', 'Conserva el número: 10 piezas → 10 cajas. El teclado usa piezas. Conserva el descuento.');
                refresh();
            };
            unitInput.onchange = () => refresh(true); count.oninput = () => refresh(); price.onchange = () => refresh();
            confirm.onclick = () => {
                try { const unit = choices.find(u => u.id === Number(unitInput.value)); apply(line, unit, Number(count.value), Number(price.value), snapshot); destroy(); }
                catch (problem) { error.textContent = problem.message; confirm.disabled = true; }
            };
            refresh(); unitInput.focus();
        } catch (problem) { if (panel === thisPanel) { error.dataset.loading = '0'; error.textContent = problem.message; } }
    }
    function startUI() {
        if (observer || !document.body) return;
        const style = element('style'); style.id = 'pb-cart-unit-style'; style.textContent = `
#pb-cart-unit-language{display:inline-flex;align-items:center;flex-shrink:0;gap:0;min-height:32px;margin:0 6px;padding:2px;border:1px solid #cbd5e1;border-radius:8px;background:#f1f5f9;color:#475569;font:600 12px "Inter","Segoe UI","Microsoft YaHei",sans-serif;cursor:pointer}
#pb-cart-unit-language>span{padding:4px 9px;line-height:1.3;border-radius:6px}
#pb-cart-unit-language>span+span{border-left:none}
#pb-cart-unit-language[data-language="zh-CN"]>span:first-child,#pb-cart-unit-language[data-language="es-MX"]>span:last-child{background:#ffffff;color:#2563eb;font-weight:800;box-shadow:0 1px 2px rgba(15,23,42,.08)}
#pb-cart-unit-language:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
#pb-cart-unit-language:disabled{opacity:.65;cursor:default}
.pb-cart-unit-dialog-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:6px;padding-bottom:10px;border-bottom:1px solid #f1f5f9}
.pb-cart-unit-dialog-header h2{margin:0!important;min-width:0;flex:1;color:#0f172a}
.pb-cart-unit-dialog-header #pb-cart-unit-language{margin:0;min-height:32px}
.product-screen .orderline.pb-cart-unit-full-row[data-pb-unit-wide="1"]{display:grid!important;grid-template-columns:minmax(0,1fr);column-gap:6px}
.product-screen .orderline[data-pb-unit-wide="1"]>.pb-cart-unit-full-content{display:contents!important}
.product-screen .orderline[data-pb-unit-wide="1"]>.pb-cart-unit-full-content>:not(.pb-cart-unit-meta){grid-column:1;min-width:0;margin-right:8px}
.product-screen .orderline[data-pb-unit-wide="1"]>.pb-cart-unit-full-content>.line-details{margin-top:8px;margin-left:8px;flex-wrap:wrap;gap:2px 6px}
.product-screen .orderline[data-pb-unit-wide="1"]>.pb-cart-unit-full-content>.line-details>.product-name{min-width:min(130px,100%);flex:1 1 130px;white-space:normal}
.product-screen .orderline[data-pb-unit-wide="1"]>.pb-cart-unit-full-content>.line-details>.product-name .text-wrap{min-width:0;overflow-wrap:anywhere}
.product-screen .orderline[data-pb-unit-wide="1"]>.pb-cart-unit-full-content>.line-details>.product-price{flex:0 0 auto;margin-left:auto}
.product-screen .orderline.pb-cart-unit-full-row[data-pb-unit-wide="1"]:has(>.pb-cart-product-image){grid-template-columns:max-content minmax(0,1fr)}
.product-screen .orderline.pb-cart-unit-full-row[data-pb-unit-wide="1"]>.pb-cart-product-image{grid-column:1;grid-row:1 / span 2;align-self:start;margin:6px 6px 4px 8px!important}
.product-screen .orderline.pb-cart-unit-full-row[data-pb-unit-wide="1"]:has(>.pb-cart-product-image)>.pb-cart-unit-full-content>:not(.pb-cart-unit-meta){grid-column:2}
.pb-cart-unit-meta{grid-column:1/-1;display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin:4px 0 0;min-width:0;max-width:100%}
.product-screen .orderline[data-pb-unit-wide="1"] .pb-cart-unit-meta{margin:4px 8px 8px}
.product-screen .pb-cart-unit-full-content{min-width:0}
.pb-cart-unit-meta>.pos-mini-stock-display{display:contents!important}
.pb-cart-unit-meta[data-spec-merged="1"]>.pos-mini-stock-display>span:first-child{display:none!important}
.pb-cart-unit-toolbar{display:inline-flex;align-items:center;flex-wrap:wrap;gap:4px 6px;padding:0;margin:0;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;font-size:12px;line-height:1.4;min-width:0;max-width:100%}
.pb-cart-unit-toolbar .pb-cart-unit-trigger{display:inline-flex;align-items:center;gap:4px;flex-shrink:1;max-width:100%;min-height:24px;padding:2px 7px;border:1px solid #93c5fd;border-radius:6px;background:#eff6ff;color:#1d4ed8;font:inherit;font-weight:700;line-height:1.35;cursor:pointer;box-shadow:none;white-space:normal;overflow-wrap:anywhere;text-align:left}
.pb-cart-unit-trigger .pb-cart-unit-label{min-width:0;font-variant-numeric:tabular-nums;letter-spacing:0}
.pb-cart-unit-trigger .fa{flex-shrink:0;font-size:11px;color:#2563eb}
.pb-cart-unit-toolbar .pb-cart-unit-trigger:hover{background:#dbeafe;border-color:#60a5fa}
.pb-cart-unit-toolbar .pb-cart-unit-trigger:active{background:#bfdbfe}
.pb-cart-unit-toolbar>span{min-width:0;color:#475569;font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.pb-cart-unit-toolbar>span:empty{display:none}
.pb-cart-unit-overlay{--pbcu-accent:#2563eb;position:fixed;inset:0;z-index:${LAYERS.modal};background:rgba(15,23,42,.52);display:flex;align-items:center;justify-content:center;padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.45}
body:has(.pb-cart-unit-overlay) :is(#pos-img-overlay,#pb-cart-image-preview-overlay){visibility:hidden!important;pointer-events:none!important;transition:none!important}
.pb-cart-unit-overlay section{box-sizing:border-box;background:var(--bs-body-bg,#fff);color:var(--bs-body-color,#0f172a);border:1px solid #cbd5e1;border-radius:14px;width:100%;max-width:480px;padding:22px;max-height:calc(100dvh - 24px);overflow:auto;box-shadow:0 24px 60px rgba(15,23,42,.28)}
.pb-cart-unit-overlay h2{font:inherit;font-size:19px;font-weight:800;margin:0 0 4px;line-height:1.3;text-wrap:balance}
.pb-cart-unit-overlay p{white-space:normal;font-size:14px;margin:10px 0;text-wrap:pretty}
.pb-cart-unit-overlay .pb-cart-unit-product{color:#475569;margin:0 0 16px;font-size:13px;font-weight:600;padding:8px 10px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;overflow-wrap:anywhere}
.pb-cart-unit-fields{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:12px}
.pb-cart-unit-overlay label{display:block;margin:0 0 6px;font-weight:700;font-size:12.5px;color:#334155}
.pb-cart-unit-overlay .pb-cart-unit-fields+div{margin-top:12px}
.pb-cart-unit-overlay select,.pb-cart-unit-overlay input{box-sizing:border-box;width:100%;min-width:0;min-height:44px;border:1.5px solid #cbd5e1;border-radius:9px;padding:8px 11px;background:var(--bs-body-bg,#fff);color:inherit;font:inherit;font-size:16px;font-weight:600;font-variant-numeric:tabular-nums}
.pb-cart-unit-overlay select:focus,.pb-cart-unit-overlay input:focus{border-color:#2563eb;outline:none;box-shadow:0 0 0 3px rgba(37,99,235,.15)}
.pb-cart-unit-overlay .pb-cart-unit-preview{margin-top:16px;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;font-variant-numeric:tabular-nums}
.pb-cart-unit-overlay .pb-cart-unit-preview[hidden]{display:none!important}
.pb-cart-unit-summary{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:12px}
.pb-cart-unit-summary span{display:block;color:#64748b;font-size:12px;font-weight:600;margin-bottom:2px}
.pb-cart-unit-summary strong{display:block;font-size:21px;font-weight:800;color:#0f172a;overflow-wrap:anywhere}
.pb-cart-unit-summary>div:last-child{text-align:right}
.pb-cart-unit-overlay .pb-cart-unit-pricing{font-size:12px;color:#475569;border-top:1px solid #e2e8f0;padding-top:9px;margin:9px 0 0}
.pb-cart-unit-overlay .pb-cart-unit-hint{font-size:12px;color:#64748b;margin:10px 0 0}
.pb-cart-unit-overlay [data-error]{color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;padding:8px 10px;border-radius:8px;font-size:13px;font-weight:600;margin:12px 0 0}
.pb-cart-unit-overlay [data-error][data-loading='1']{color:#475569;background:#f8fafc;border-color:#e2e8f0}
.pb-cart-unit-overlay [data-error]:empty{display:none}
.pb-cart-unit-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:18px;padding-top:14px;border-top:1px solid #f1f5f9}
.pb-cart-unit-overlay button{box-sizing:border-box;min-height:44px;padding:9px 18px;border:1px solid #cbd5e1;border-radius:9px;margin:0;background:var(--bs-body-bg,#fff);color:#334155;font:inherit;font-weight:700;cursor:pointer;box-shadow:none}
.pb-cart-unit-overlay button:hover:not(:disabled){background:#f8fafc}
.pb-cart-unit-overlay .pb-cart-unit-confirm{background:#2563eb;color:#fff;border-color:#2563eb}
.pb-cart-unit-overlay .pb-cart-unit-confirm:hover:not(:disabled){background:#1d4ed8}
.pb-cart-unit-overlay button:disabled{opacity:.45;cursor:not-allowed}
#pb-cart-unit-message{position:fixed;bottom:max(20px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;padding:12px 18px;border-radius:10px;box-shadow:0 10px 25px rgba(15,23,42,.18);z-index:${LAYERS.message};max-width:90vw;font:inherit;font-size:14px;font-weight:700}
.pb-cart-unit-toolbar button:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
.pb-cart-unit-overlay :focus-visible{outline:2px solid var(--pbcu-accent,#2563eb);outline-offset:2px}
@media(pointer:coarse){.pb-cart-unit-toolbar .pb-cart-unit-trigger{min-height:44px;padding:8px 10px}.pb-cart-unit-toolbar>span{font-size:13px}}
@media(max-width:480px){.pb-cart-unit-overlay section{padding:16px}.pb-cart-unit-overlay h2{font-size:18px}.pb-cart-unit-actions>button{flex:1}.pb-cart-unit-summary strong{font-size:19px}}
`;
        document.head.append(style);
        function unitMutationRelevant(record) {
            const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
            if (!target) return false;
            if (target.closest('.pb-cart-unit-toolbar,.pb-cart-unit-overlay,#pb-cart-unit-message,.pb-seq-num,.pb-type-group-label,.pb-cart-product-image,.pb-inline-order-search')) return false;
            if (record.type === 'attributes') return target.matches('.product-screen .orderline');
            if (target.closest('.product-screen .orderline')) {
                const changed = [...record.addedNodes, ...record.removedNodes];
                return !changed.length || !changed.every(node => node.nodeType === 1 &&
                    node.matches('.pb-cart-unit-toolbar,.pb-cart-unit-meta,.pb-cart-unit-language'));
            }
            if (record.type !== 'childList') return false;
            return [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 &&
                (node.matches('.product-screen,.orderline') || node.querySelector('.product-screen,.orderline')));
        }
        observer = new MutationObserver(records => {
            for (const record of records) {
                if (!unitMutationRelevant(record)) continue;
                const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
                const row = target?.closest('.product-screen .orderline');
                if (row) schedule(row);
                else { schedule(); break; }
            }
        });
        observer.observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        if (typeof ResizeObserver === 'function') layoutResize = new ResizeObserver(entries => entries.forEach(entry => schedule(entry.target)));
        document.fonts?.ready.then(() => { metadataLayoutCache = new WeakMap(); schedule(); });
        window.addEventListener('resize', () => { metadataLayoutCache = new WeakMap(); schedule(); }, { passive: true });
        schedule();
    }
    function scanSnapshot() {
        const current = selected(), order = current.order, line = current.line;
        if (!order?.uuid) return null;
        return {
            orderUuid: String(order.uuid), orderState: String(order.state || ""), finalized: Boolean(order.finalized),
            lineUuid: line?.uuid ? String(line.uuid) : "", productId: line?.product_id ? id(line.product_id) : 0,
            quantity: line ? Number(line.qty) : null,
        };
    }
    window.PBCartUnit = { version: VERSION, open: openPanel, scanSnapshot, isConnected: () => Boolean(store), diagnostics: () => {
        const current = selected();
        return { version: VERSION, connected: Boolean(store), order: current.order?.uuid, line: current.line?.uuid, orderPriceId: id(current.order?.pricelist_id), lines: (current.order?.lines || []).map(item => ({ uuid: item.uuid, productId: id(item.product_id), quantity: item.qty, price: item.price_unit, unit: state(item)?.name, factor: state(item)?.factor, manualOverride: state(item)?.manualOverride })) };
    }, _test: { patchLine, patchStore, units, apply, state, targetQuantity, unitLabel, matchingSpec, renderLine, adaptMetadata, setLanguage, es } };
    // Do not expire unit metadata by age/count: an old order can still be
    // an active draft. Native quantities/prices and this record have different
    // lifetimes; cleanup requires confirmed terminal-order evidence.
    PBUI.subscribe(applySuiteLanguage);
    document.addEventListener('pb-box-odoo-connect-v1', attachLoader);
    attachLoader();
    let attempts = 0;
    bootTimer = setInterval(() => { attachLoader(); startUI(); if (store || ++attempts > 1500) { clearInterval(bootTimer); schedule(); } }, 200);
    document.addEventListener('DOMContentLoaded', startUI, { once: true });
    startUI();
})();
})();

})();

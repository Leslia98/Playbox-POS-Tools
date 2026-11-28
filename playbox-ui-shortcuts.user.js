// ==UserScript==
// @name         Playbox Odoo - 界面与快捷操作
// @namespace    https://playboxelectronics1.odoo.com/playbox-suite
// @version      1.0.17
// @description  界面与快捷操作；定向修复候选，已通过本地回归，待安装后组合验收。
// @author       Playbox
// @run-at       document-start
// @match        https://*.odoo.com/pos/ui*
// @grant        GM_deleteValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

(function () {
'use strict';

if (location.protocol !== "https:" || !/(^|\.)odoo\.com$/i.test(location.hostname)) return;

if (!/^\/pos\/ui(?:\/|$)/.test(location.pathname)) return;

if (document.documentElement?.hasAttribute("data-pb-suite-ui")) return;
document.documentElement?.setAttribute("data-pb-suite-ui","1.0.17");

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


const pbMigrationPlan = PBMigration.buildPlan("ui",{"enable_F3": "bfalse", "enable_F6": "bfalse", "enable_search_fix": "bfalse", "enable_voice": "bfalse", "imageSize": "slarge", "selected_voice_name": "sGoogle español de Estados Unidos", "showTips": "bfalse"},["enable_F1", "enable_F2", "enable_F3", "enable_F6", "enable_F7", "enable_F8", "enable_F9", "enable_F10", "enable_Enter", "enable_Escape", "enable_anti_sleep", "enable_search_fix", "enable_voice", "imagePreview", "imageSize", "showTips", "selected_voice_name"]);

const PBPrefs = (()=>{try{return createSuitePreferences(
 {get:(key,fallback)=>GM_getValue(key,fallback),set:(key,value)=>GM_setValue(key,value),delete:key=>GM_deleteValue(key)},
 pbMigrationPlan,PBMigration,
 typeof GM_registerMenuCommand === "function" ? GM_registerMenuCommand : null,
 message=>window.alert(message));}catch(error){pbPreferenceError(error);throw error;}})();

// suite-bootstrap-end

{
const start = () => {
(function () {
(function () {
    "use strict";

    // ==========================================
    // 0. Configuración Global
    // ==========================================
    const PREVIEW_DELAY = 300; // Retraso vista previa (ms)

    // ==========================================
    // 1. Estilos y UI
    // ==========================================
    const style = document.createElement("style");
    style.textContent = `
        .category-list {
            height: 150px !important;
            border-bottom: 1px solid #cbd5e1 !important;
            overflow-y: auto;
            scrollbar-width: thin;
        }
        #pos-img-overlay {
            position: fixed; right: 22px; bottom: 22px; z-index: 999999;
            background: #ffffff;
            padding: 10px; border-radius: 16px;
            border: 1px solid rgba(15, 23, 42, 0.10);
            box-shadow: 0 20px 50px rgba(15, 23, 42, 0.28);
            pointer-events: none;
            opacity: 0; transform: translateY(16px) scale(0.96);
            transition: opacity 0.22s ease-out, transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }
        #pos-img-overlay.visible { opacity: 1; transform: translateY(0) scale(1); }
        #pos-img-overlay img {
            display: block; border-radius: 10px; object-fit: contain;
            background: #f8fafc; opacity: 0; transition: opacity 0.18s ease-in;
        }
        #pos-img-overlay img.loaded { opacity: 1; }
        #pos-tip-box {
            position: fixed; top: 20px; right: 20px;
            background: #0f172a;
            color: #f8fafc;
            border: 1px solid rgba(148, 163, 184, 0.25);
            box-shadow: 0 12px 30px rgba(15, 23, 42, 0.28);
            padding: 10px 18px; border-radius: 12px;
            font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 15px; font-weight: 700; letter-spacing: 0.2px;
            z-index: 99999;
            transition: opacity 0.35s ease; opacity: 0; pointer-events: none;
        }
    `;
    document.head.appendChild(style);

    let tipTimer;
    PBUI.subscribe(() => {
        const tip=document.getElementById("pos-tip-box");
        if (tip?.pbMessage) tip.innerText=String(tip.pbMessage);
    });
    function showTip(msg) {
        if (!PBPrefs.get("showTips", true)) return;
        let tip = document.getElementById("pos-tip-box");
        if (!tip) {
            tip = document.createElement("div");
            tip.id = "pos-tip-box";
            document.body.appendChild(tip);
        }
        tip.pbMessage = msg;
        tip.innerText = String(msg);
        tip.style.opacity = "1";
        clearTimeout(tipTimer);
        tipTimer = setTimeout(() => { tip.style.opacity = "0"; }, 2000);
    }

    // 🎯 核心修复：同时抓取系统内的中文和所有西班牙语（优先墨西哥es-MX）音色
    function getAvailableVoices(language = PBUI.get()) {
        if (typeof window === "undefined" || !window.speechSynthesis) return [];
        const prefix = language === "es-MX" ? "es" : "zh";
        const preferredRegion = language === "es-MX" ? "MX" : "CN";
        return window.speechSynthesis.getVoices()
            .filter(voice => String(voice.lang || "").toLowerCase().startsWith(prefix))
            .sort((a, b) => Number(String(b.lang).toUpperCase().includes(preferredRegion)) -
                Number(String(a.lang).toUpperCase().includes(preferredRegion)));
    }
    function voicePreferenceKey(language = PBUI.get()) {
        return "selected_voice_name:" + language;
    }
    function selectedVoiceName(language, voices) {
        const perLanguage = PBPrefs.get(voicePreferenceKey(language), "");
        if (voices.some(voice => voice.name === perLanguage)) return perLanguage;
        const legacy = PBPrefs.get("selected_voice_name", "");
        return voices.some(voice => voice.name === legacy) ? legacy : "";
    }

    // 🔊 语音播报核心
    function speakText(text) {
        if (!PBPrefs.get("enable_voice", true)) return;
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        const language = PBUI.get();
        const voices = getAvailableVoices(language);
        const savedVoiceName = selectedVoiceName(language, voices);
        const matchedVoice = voices.find(v => v.name === savedVoiceName) || voices[0];
        if (matchedVoice) {
            utterance.voice = matchedVoice;
            utterance.lang = matchedVoice.lang;
        } else {
            utterance.lang = language;
        }

        utterance.rate = 1.25;
        window.speechSynthesis.speak(utterance);
    }

    function clickInModal(selector, label) {
        const modal = document.querySelector(".modal, .modal-dialog, .modal-body, .popup");
        if (modal) {
            const btn = modal.querySelector(selector)?.closest("button");
            if (btn) { btn.click(); showTip(pbUiPair(`✅ 已点击「${label}」`,`✅ Clic en «${label}»`)); }
            else {
                const close = modal.querySelector('button.btn-close[aria-label="Cerrar"], .button.cancel');
                if (close) { close.click(); showTip(pbUiPair("⚠️ 未找到按钮，正在关闭窗口","⚠️ No encontrado, cerrando ventana")); }
            }
            return;
        }
        const more = document.querySelector("button.more-btn");
        if (more) {
            more.click();
            let count = 0;
            const t = setInterval(() => {
                const m = document.querySelector(".modal, .modal-dialog, .modal-body, .popup");
                if (!m) return;
                const b = m.querySelector(selector)?.closest("button");
                const c = m.querySelector('button.btn-close[aria-label="Cerrar"], .button.cancel');
                if (b) { b.click(); showTip(pbUiPair(`✅ 已点击「${label}」`,`✅ Clic en «${label}»`)); clearInterval(t); }
                else if (c && ++count > 5) { c.click(); clearInterval(t); }
            }, 200);
            setTimeout(() => clearInterval(t), 2000);
        }
    }

    // ==========================================
    // 2. Módulo: Corrección de Búsqueda
    // ==========================================
    const SearchFix = {
        init: () => {
            if (PBPrefs.get("enable_search_fix", true) === false) return;

            const attach = (input) => {
                if (input.dataset.posFix) return;
                if (input.closest('.modal, .modal-dialog, .popup, .popups')) return;

                let manual = false;
                input.addEventListener('input', (e) => {
                    if (manual) { manual = false; return; }
                    e.stopImmediatePropagation(); e.stopPropagation();
                }, true);

                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        if (document.querySelector(".modal-content, .popup")) return;

                        manual = true;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        input.blur(); setTimeout(() => input.focus(), 10);
                    }
                }, true);

                input.dataset.posFix = "true";
            };

            const obs = new MutationObserver(() => {
                const inputs = document.querySelectorAll('.pos-search-bar input, .search-box input, .input-container input.o_input');
                inputs.forEach(attach);
            });
            obs.observe(document.body, { childList: true, subtree: true });
        }
    };

    // ==========================================
    // 3. Módulo: Vista Previa de Imágenes
    // ==========================================
    const ImagePreview = {
        init: () => {
            let overlay, img, timer;
            const getSize = () => ({ normal: [420,300], large: [640,480], xlarge: [800,600] }[PBPrefs.get("imageSize", "large")] || [640,480]);

            const create = () => {
                if (overlay) return;
                overlay = document.createElement("div"); overlay.id = "pos-img-overlay";
                img = document.createElement("img"); overlay.appendChild(img);
                document.body.appendChild(overlay);
            };

            const show = (el) => {
                const i = el.querySelector("img");
                if (!i) return;
                create();

                img.classList.remove("loaded");
                img.style.opacity = "0";
                img.src = "";

                const [w, h] = getSize();
                const newSrc = i.src.replace(/image_\d+/, "image_1024");
                Object.assign(img.style, { maxWidth: w+"px", maxHeight: h+"px" });

                img.onload = () => {
                    img.style.opacity = "";
                    img.classList.add("loaded");
                };

                img.src = newSrc;
                requestAnimationFrame(() => overlay.classList.add("visible"));
            };

            document.addEventListener("mouseover", (e) => {
                if (!PBPrefs.get("imagePreview", true)) return;
                const el = e.target.closest(".product-img, article.product");
                clearTimeout(timer);
                if (el) timer = setTimeout(() => show(el), PREVIEW_DELAY);
                else if (overlay) overlay.classList.remove("visible");
            }, true);

            document.addEventListener("mouseout", (e) => {
                if (e.target.closest(".product-img, article.product")) {
                    clearTimeout(timer);
                    if (overlay) overlay.classList.remove("visible");
                }
            }, true);
        }
    };

    // ==========================================
    // 4. Módulo: Contador de Cantidad
    // ==========================================
    const QtyCounter = {
        init: () => {
            let lastSum = null;
            const BLACKLIST = ["CORTESÍA", "税费", "IMPUESTO", "DESCUENTO", "GUIA", "折扣"];

            let dirty = true;
            const ownSelector = '#pos-total-qty,.pos-mini-stock-display,.pb-seq-num,.pb-type-group-label,.pb-cart-product-image,.pb-cart-unit-toolbar';
            const relevantSelector = '.order-container,.order-summary';
            function relevantMutation(record) {
                const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
                if (target?.closest(ownSelector)) return false;
                const nodes = [...(record.addedNodes || []), ...(record.removedNodes || [])];
                if (nodes.length && nodes.every(node => node.nodeType === 1 && node.matches(ownSelector))) return false;
                if (target?.closest(relevantSelector)) return true;
                if (record.type === 'attributes' && target?.querySelector(relevantSelector)) return true;
                return nodes.some(node => node.nodeType === 1 && (node.matches(relevantSelector) || node.querySelector(relevantSelector)));
            }
            const observer = new MutationObserver(records => {
                if (records.some(relevantMutation)) dirty = true;
            });
            observer.observe(document.body, {subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden']});
            document.addEventListener('visibilitychange', () => { if (!document.hidden) dirty = true; });
            setInterval(() => {
                if (!dirty || document.hidden) return;
                dirty = false;
                const container = [...document.querySelectorAll(".order-container")].find(c => getComputedStyle(c).display !== 'none');
                if (!container) {
                    const s = document.getElementById("pos-total-qty");
                    if(s && s.textContent !== "Cant: ...") s.textContent = "Cant: ...";
                    return;
                }

                let sum = 0;
                container.querySelectorAll(".orderline").forEach(line => {
                    const nameEl = line.querySelector(".product-name");
                    const qtyEl = line.querySelector(".qty");

                    if (nameEl && qtyEl) {
                        const name = nameEl.textContent.toUpperCase();
                        const isIgnored = BLACKLIST.some(k => name.includes(k));

                        if (!isIgnored) {
                            sum += parseFloat(qtyEl.textContent.trim().replace(",", ".")) || 0;
                        }
                    }
                });

                if (sum !== lastSum || !document.getElementById("pos-total-qty")) {
                    const totalEl = document.querySelector(".order-summary .total");
                    if (totalEl) {
                        let label = document.getElementById("pos-total-qty");
                        if (!label) {
                            label = document.createElement("span");
                            label.id = "pos-total-qty";
                            label.style.cssText = "margin-right: 10px; color: #007bff; font-weight: bold;";
                            totalEl.parentNode.insertBefore(label, totalEl);
                        }
                        label.textContent = `Cant: ${sum}`;
                    }

                    if (lastSum !== null && sum !== lastSum && sum > 0) {
                        speakText(`${sum}`);
                    }

                    lastSum = sum;
                }
            }, 300);
        }
    };

    // ==========================================
    // 5. Atajos de Teclado
    // ==========================================
    let paymentEnterPending = false;
    let paymentEnterLockedUntil = 0;
    let paymentEnterTimer;
    let paymentValidationButton = null;

    // Odoo puede escuchar otras fases del mismo Enter (keypress/keyup).
    // Conservar la marca aunque la validación cambie inmediatamente de pantalla.
    const consumePaymentEnter = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    for (const type of ["keypress", "keyup"]) {
        window.addEventListener(type, (event) => {
            if (event.key !== "Enter" || !paymentEnterPending) return;
            consumePaymentEnter(event);
            if (type === "keyup") {
                paymentEnterPending = false;
                clearTimeout(paymentEnterTimer);
                const button = paymentValidationButton;
                paymentValidationButton = null;
                // Validar después de terminar el evento, incluso si Odoo había
                // registrado un listener de keyup antes que Tampermonkey.
                if (button) setTimeout(() => {
                    if (window.location.href.includes("/payment") && button.isConnected &&
                        !button.disabled && !button.classList.contains("disabled")) button.click();
                }, 0);
            }
        }, true);
    }

    function pbVisibleSuiteModal() {
        const selectors = [
            ".pb-modal-overlay.pb-visible", "#pb-box-modal", ".pb-cart-unit-overlay",
            ".pbful-overlay.open", "#pbful-prompt", ".modal.show", ".modal-content", ".popup", '[data-pb-suite-modal="open"]'
        ];
        const roots = [document, document.querySelector("#pbful-host")?.shadowRoot].filter(Boolean);
        for (const scope of roots) for (const selector of selectors) for (const node of (scope.querySelectorAll ? scope.querySelectorAll(selector) : [scope.querySelector(selector)])) {
            if (!node || !node.isConnected || node.hidden || node.getAttribute("aria-hidden") === "true") continue;
            if (typeof node.getClientRects === "function" && !node.getClientRects().length) continue;
            const style = typeof getComputedStyle === "function" ? getComputedStyle(node) : null;
            if (!style || (style.display !== "none" && style.visibility !== "hidden")) return node;
        }
        return null;
    }

    document.addEventListener("keydown", (e) => {
        const k = e.key;
        if (e.isComposing || e.keyCode === 229 || e.repeat || e.defaultPrevented) return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        const isInput = e.target?.matches?.("input,textarea,select,[contenteditable=true]");
        const suiteModal = pbVisibleSuiteModal();
        if (suiteModal) {
            const nativeDialog = suiteModal.matches?.('.modal.show, .modal-content, .popup');
            if (nativeDialog && k === 'Enter' && PBPrefs.get('enable_Enter', true) &&
                !e.target?.matches?.('textarea,select,[contenteditable=true]')) {
                const confirmBtn = suiteModal.querySelector('.btn-primary, .button.confirm, .o-default-button');
                if (confirmBtn && !confirmBtn.disabled && !confirmBtn.classList.contains('disabled')) {
                    consumePaymentEnter(e);
                    // Consume the matching suffix without queuing payment validation.
                    paymentValidationButton = null;
                    paymentEnterPending = true;
                    clearTimeout(paymentEnterTimer);
                    paymentEnterTimer = setTimeout(() => { paymentEnterPending = false; }, 2000);
                    confirmBtn.click();
                }
            }
            // Suite-owned dialogs handle their own Enter/Escape. Function keys
            // must never reach the POS controls behind them.
            if (["F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12"].includes(k)) {
                e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            }
            return;
        }

        if (k === "Enter" && PBPrefs.get("enable_Enter", true)) {
            const modalContent = document.querySelector(".modal-content, .popup");
            if (modalContent) {
                const confirmBtn = modalContent.querySelector(".btn-primary, .button.confirm");
                if (confirmBtn && !confirmBtn.disabled && !confirmBtn.classList.contains("disabled")) {
                    e.preventDefault(); e.stopPropagation();
                    confirmBtn.click();
                    return;
                }
            }
        }

        if (k === 'F3' || k === 'F4') {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            if (!document.querySelector('.product-screen')) return;
            const preference = k === 'F3' ? 'enable_fulfillment_pay' : 'enable_send_prepick';
            if (PBPrefs.get(preference, true) === false) return;
            const button = document.getElementById(k === 'F3' ? 'pbful-pay-fulfillment' : 'pbful-pos-prepick');
            if (button && button.isConnected && !button.disabled && !button.classList.contains('disabled') &&
                (!button.getClientRects || button.getClientRects().length)) button.click();
            return;
        }

        if (isInput) {
            if (k !== "Enter" && k !== "Escape" && !k.startsWith("F")) {
                return;
            }
        }

        if (["F1","F2","F3","F6","F7","F8","F9","F10"].includes(k)) e.preventDefault();

        const href = window.location.href;
        const inProduct = href.includes("/product") || !href.includes("/payment");
        const inPayment = href.includes("/payment");

        if (inProduct) {
            if (k === "F1" && PBPrefs.get("enable_F1", true)) { const b = document.querySelector(".pay-order-button"); if(b) b.click(); }
            if (k === "F2" && PBPrefs.get("enable_F2", true)) clickInModal('i[aria-label="Información del producto"], i[title="Información del producto"]', pbUiPair("商品信息","Info Producto"));

            if (k === "F6" && PBPrefs.get("enable_F6", true)) clickInModal('i[aria-label="Lista de precios"]', pbUiPair("价格表","Lista de precios"));
            if (k === "F7" && PBPrefs.get("enable_F7", true)) clickInModal(".fa-trash", pbUiPair("取消","Cancelar"));
            if (k === "F8" && PBPrefs.get("enable_F8", true)) { const b = document.querySelector(".numpad-qty"); if(b) {b.click(); showTip(pbUiPair("🔢 数量","🔢 Cantidad"));} }
            if (k === "F9" && PBPrefs.get("enable_F9", true)) { const b = document.querySelector(".numpad-price"); if(b) {b.click(); showTip(pbUiPair("💲 价格","💲 Precio"));} }
            if (k === "F10" && PBPrefs.get("enable_F10", true)) { const b = document.querySelector(".list-plus-btn"); if(b) {b.click(); showTip(pbUiPair("🛒 新订单","🛒 Nueva Orden"));} }

            if (k === "Enter" && PBPrefs.get("enable_Enter", true)) {
                if (document.querySelector(".modal, .popup")) return;
                const b = document.querySelector("button.o-default-button");
                if(b) { b.click(); showTip(pbUiPair("✅ 添加","✅ Agregar")); }
            }
        }

        if (inPayment) {
            if (k === "Enter" && PBPrefs.get("enable_Enter", true)) {
                // Los diálogos conservan su propia confirmación con Enter.
                if (document.querySelector(".modal, .popup")) return;
                consumePaymentEnter(e);
                paymentEnterPending = true;
                clearTimeout(paymentEnterTimer);
                paymentEnterTimer = setTimeout(() => {
                    paymentEnterPending = false;
                    paymentValidationButton = null;
                }, 2000);

                // Una pulsación prolongada o dos Enter rápidos no validan dos veces.
                const now = Date.now();
                if (e.repeat || now < paymentEnterLockedUntil) return;
                const b = document.querySelector(".validation-button");
                if (b && !b.disabled && !b.classList.contains("disabled")) {
                    paymentEnterLockedUntil = now + 500;
                    paymentValidationButton = b;
                }
                return;
            }
            if (k === "Escape" && PBPrefs.get("enable_Escape", true)) { const b = document.querySelector(".back-button"); if(b) b.click(); }
        }

        if (k === "Escape" && PBPrefs.get("enable_Escape", true)) {
            const close = document.querySelector(".modal .btn-close, .modal .cancel, .modal .close, .popup .cancel");
            if (close) { close.click(); showTip(pbUiPair("❎ 关闭窗口","❎ Cerrar Ventana")); }
        }

    }, true);

    // ==========================================
    // 6. Módulo: Anti-Sleep
    // ==========================================
    const AntiSleep = {
        timer: null,
        init: () => {
            clearInterval(AntiSleep.timer);
            AntiSleep.timer = null;
            if (!PBPrefs.get("enable_anti_sleep", true)) return;

            AntiSleep.timer = setInterval(() => {
                if (document.hidden) return;
                const event = new MouseEvent('mousemove', {
                    'bubbles': true,
                    'cancelable': true,
                    'clientX': 1,
                    'clientY': 1
                });
                document.body.dispatchEvent(event);
                window.dispatchEvent(event);
            }, 60000);
        }
    };

    // ==========================================
    // 7. Menú Tampermonkey
    // ==========================================
    let menuIds = [];
    function refreshMenu() {
        menuIds.forEach(GM_unregisterMenuCommand);
        menuIds = [];

        const addToggle = (key, name) => {
            const v = PBPrefs.get(key, true);
            menuIds.push(GM_registerMenuCommand(`${v?"✅":"❌"} ${name}`, () => {
                PBPrefs.set(key, !v); if (key === "enable_anti_sleep") AntiSleep.init(); showTip(pbUiPair(`${name} ${!v?"已开启":"已关闭"}`,`${name} ${!v?pbUiText("已开启","Activado"):pbUiText("已关闭","Desactivado")}`)); refreshMenu();
            }));
        };

        addToggle("enable_voice", pbUiText("🔊 数量语音播报","🔊 Voz activo (Cantidad)"));

        // 🎯 动态渲染切换菜单：点击即可在中/西语不同的具体声音间轮流切换
        const voiceLanguage = PBUI.get();
        const voices = getAvailableVoices(voiceLanguage);
        if (voices.length > 0) {
            let currentVoiceName = selectedVoiceName(voiceLanguage, voices);
            if (!currentVoiceName) {
                currentVoiceName = voices[0].name;
                PBPrefs.set(voicePreferenceKey(voiceLanguage), currentVoiceName);
            }
            // 提取简短的名字和国家代码（例如：Sabina (es-MX)）
            const matched = voices.find(v => v.name === currentVoiceName);
            const voiceLabel = matched ? `${matched.name.split(" ")[0]} (${matched.lang})` : pbUiText("默认","Por defecto");

            menuIds.push(GM_registerMenuCommand(`${pbUiText("🔊 播报声音","🔊 Voz")}: ${voiceLabel} (${pbUiText("点击切换","Cambiar")})`, () => {
                const language = PBUI.get();
                const currentVoices = getAvailableVoices(language);
                let idx = currentVoices.findIndex(v => v.name === selectedVoiceName(language, currentVoices));
                let nextIdx = (idx + 1) % currentVoices.length;
                let nextVoice = currentVoices[nextIdx];

                PBPrefs.set(voicePreferenceKey(language), nextVoice.name);
                refreshMenu();

                // 根据当前切换到的语言进行对应的试听测试
                if (nextVoice.lang.includes("es") || nextVoice.lang.includes("MX")) {
                    speakText("uno dos tres");
                } else {
                    speakText("测试新声音");
                }
                showTip(pbUiPair(`语音：${nextVoice.name.split(" ")[0]} (${nextVoice.lang})`,`Voz: ${nextVoice.name.split(" ")[0]} (${nextVoice.lang})`));
            }));
        } else {
            menuIds.push(GM_registerMenuCommand(pbUiText("⏳ 正在查找系统语音（点击重试）","⏳ Buscando voces del sistema... (Click)"), () => {
                window.speechSynthesis.getVoices();
                refreshMenu();
            }));
        }

        addToggle("enable_anti_sleep", pbUiText("🛡️ 页面保活","🛡️ Modo Anti-Suspensión"));
        addToggle("enable_search_fix", pbUiText("搜索响应优化","Corrección Búsqueda (Anti-Lag)"));
        addToggle("showTips", pbUiText("显示提示","Mostrar Burbujas"));
        addToggle("imagePreview", pbUiText("图片预览","Vista Previa Imágenes"));

        const sz = PBPrefs.get("imageSize", "large");
        const label = {normal:pbUiText("普通","Normal"),large:pbUiText("大","Grande"),xlarge:pbUiText("特大","Extra grande")}[sz];
        menuIds.push(GM_registerMenuCommand(`${pbUiText("🖼️ 图片大小","🖼️ Tamaño de imagen")}: ${label}`, () => {
            const map = ["normal","large","xlarge"];
            const next = map[(map.indexOf(sz)+1)%3];
            PBPrefs.set("imageSize", next); showTip(pbUiPair(`图片大小：${next}`,`Tamaño: ${next}`)); refreshMenu();
        }));

        ["F1","F2","F3","F4","F6","F7","F8","F9","F10","Enter","Escape"].forEach(k => {
            const desc = {F1:pbUiText("收款","Cobrar"),F2:pbUiText("商品信息","Información"),F3:pbUiText("配货收款","Cobro para surtido"),F4:pbUiText("发送配货","Enviar surtido"),F6:pbUiText("价格表","Lista de precios"),F7:pbUiText("取消订单","Cancelar"),F8:pbUiText("数量","Cantidad"),F9:pbUiText("价格","Precio"),F10:pbUiText("新订单","Nuevo pedido"),Enter:pbUiText("确认","Confirmar"),Escape:pbUiText("返回","Volver")}[k];
            const shortcutKey = k === 'F3' ? 'enable_fulfillment_pay' : k === 'F4' ? 'enable_send_prepick' : `enable_${k}`;
            const v = PBPrefs.get(shortcutKey, true);
            menuIds.push(GM_registerMenuCommand(`${v?"✅":"❌"} ${k} ${desc}`, () => {
                PBPrefs.set(shortcutKey, !v); showTip(pbUiPair(`${k} ${!v?"已开启":"已关闭"}`,`${k} ${!v?pbUiText("已开启","Activado"):pbUiText("已关闭","Desactivado")}`)); refreshMenu();
            }));
        });
    }

    if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = () => { refreshMenu(); };
        for (let delay of [400, 1200, 2500, 4000]) {
            setTimeout(refreshMenu, delay);
        }
    }

    PBUI.subscribe(() => refreshMenu());
    refreshMenu();
    SearchFix.init();
    ImagePreview.init();
    QtyCounter.init();
    AntiSleep.init();
    console.log("🚀 Odoo POS Enhanced v5.9.10-MX Multi-Lingual Engine Loaded");

})();
})();
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once:true}); else start();
}

})();

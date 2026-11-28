// ==UserScript==
// @name         Playbox Odoo - 商品与购物车
// @namespace    https://playboxelectronics1.odoo.com/playbox-suite
// @version      1.0.17
// @description  商品与购物车；定向修复候选，已通过本地回归，待安装后组合验收。
// @author       Playbox
// @run-at       document-start
// @match        https://*.odoo.com/pos/ui*
// @grant        none
// ==/UserScript==

(function () {
'use strict';

if (location.protocol !== "https:" || !/(^|\.)odoo\.com$/i.test(location.hostname)) return;

if (!/^\/pos\/ui(?:\/|$)/.test(location.pathname)) return;

if (document.documentElement?.hasAttribute("data-pb-suite-cart")) return;
document.documentElement?.setAttribute("data-pb-suite-cart","1.0.17");

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

{
const start = () => {
(function () {
// Versión de interfaz es-MX preparada para Playbox. No active a la vez esta versión y la versión china de la misma función.

(function() {
    'use strict';

    var pbSearchStarted = false;
    var pbSearchSeq = 1;
    var pbTypeCollator = new Intl.Collator("es-MX", {
        sensitivity: "base",
        numeric: true
    });
    var pbImagePidCache = new Map();
    var pbImagePidPending = new Map();
    var pbCartFollowStates = new WeakMap();
    var pbCartScrollRequests = new WeakMap();
    var PB_CART_PREVIEW_DELAY = 300;
    var PB_CART_PREVIEW_SIZE_KEY = "pb_cart_preview_size";
    var PB_TYPE_GROUPING_KEY = "pb_cart_type_grouping_enabled";
    var pbTypeGroupingEnabled = true;
    var pbCartDomObserver = null;
    var pbCartMutationRefreshRunning = false;

    try {
        pbTypeGroupingEnabled = localStorage.getItem(PB_TYPE_GROUPING_KEY) !== "0";
    } catch (e) {}

    var PB_CART_PREVIEW_SIZES = {
        normal: { width: 420, height: 300, label: "Normal" },
        large: { width: 640, height: 480, label: "Grande" },
        xlarge: { width: 800, height: 600, label: "Extra grande" }
    };
    var pbCartPreviewTimer = null;
    var pbCartPreviewOverlay = null;
    var pbCartPreviewImage = null;
    var pbCartPreviewRequest = 0;
    var pbCartPreviewSourceBox = null;

    function pbNormalizeText(text) {
        var s = String(text || "").toLowerCase();

        try {
            s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        } catch (e) {}

        return s.replace(/\s+/g, " ").trim();
    }

    function pbInjectStyle() {
        if (document.getElementById("pb-inline-search-style")) return;

        var style = document.createElement("style");
        style.id = "pb-inline-search-style";
        style.textContent = `
            .pb-inline-order-search {
                display: flex !important;
                align-items: center !important;
                gap: 7px !important;
                padding: 7px 10px !important;
                margin: 6px 8px 8px 8px !important;
                background: #f8fafc !important;
                border: 1px solid #cbd5e1 !important;
                border-radius: 10px !important;
                box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05) !important;
                font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
                position: sticky !important;
                top: 0 !important;
                z-index: 50 !important;
                transition: border-color 0.16s ease, box-shadow 0.16s ease, background 0.16s ease !important;
            }
            .pb-inline-order-search:focus-within {
                background: #ffffff !important;
                border-color: #2563eb !important;
                box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14) !important;
            }

            .pb-inline-order-search .pb-inline-search-icon {
                color: #2563eb !important;
                font-size: 13px !important;
                font-weight: 900 !important;
                flex-shrink: 0 !important;
            }

            .pb-inline-order-search input {
                flex: 1 !important;
                min-width: 0 !important;
                height: 28px !important;
                border: none !important;
                outline: none !important;
                background: transparent !important;
                color: #0f172a !important;
                font-size: 13.5px !important;
                font-weight: 600 !important;
                font-family: inherit !important;
            }

            .pb-inline-order-search input::placeholder {
                color: #94a3b8 !important;
                font-weight: 500 !important;
            }

            .pb-inline-order-search .pb-inline-search-count {
                color: #475569 !important;
                background: #e2e8f0 !important;
                padding: 2px 7px !important;
                border-radius: 999px !important;
                font-size: 11px !important;
                font-weight: 800 !important;
                font-variant-numeric: tabular-nums !important;
                white-space: nowrap !important;
                min-width: 38px !important;
                text-align: center !important;
            }

            .pb-inline-order-search .pb-cart-preview-size {
                width: 94px !important;
                min-width: 94px !important;
                height: 27px !important;
                padding: 0 5px !important;
                border: 1px solid #cbd5e1 !important;
                border-radius: 7px !important;
                outline: none !important;
                background: #ffffff !important;
                color: #334155 !important;
                font-family: inherit !important;
                font-size: 11.5px !important;
                font-weight: 700 !important;
                cursor: pointer !important;
                flex-shrink: 0 !important;
            }

            .pb-inline-order-search .pb-cart-preview-size:focus {
                border-color: #2563eb !important;
                box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.16) !important;
            }

            .pb-inline-order-search .pb-type-group-toggle {
                min-width: 72px !important;
                height: 27px !important;
                padding: 0 9px !important;
                border: 1px solid #cbd5e1 !important;
                border-radius: 7px !important;
                background: #ffffff !important;
                color: #334155 !important;
                font-family: inherit !important;
                font-size: 11.5px !important;
                font-weight: 800 !important;
                line-height: 25px !important;
                white-space: nowrap !important;
                cursor: pointer !important;
                flex-shrink: 0 !important;
                transition: all 0.15s ease !important;
            }

            .pb-inline-order-search .pb-type-group-toggle.pb-type-group-enabled {
                border-color: #2563eb !important;
                background: #2563eb !important;
                color: #ffffff !important;
            }

            .pb-inline-order-search .pb-type-group-toggle:hover {
                border-color: #2563eb !important;
            }

            .pb-inline-order-search .pb-inline-search-clear {
                width: 24px !important;
                height: 24px !important;
                border: none !important;
                border-radius: 50% !important;
                background: #e2e8f0 !important;
                color: #475569 !important;
                font-size: 14px !important;
                font-weight: 900 !important;
                line-height: 24px !important;
                padding: 0 !important;
                cursor: pointer !important;
                flex-shrink: 0 !important;
            }

            .pb-inline-order-search .pb-inline-search-clear:hover {
                background: #cbd5e1 !important;
                color: #0f172a !important;
            }

            /* 按商品名称第一个单词显示的购物车分组标题（无左侧竖条） */
            .order-container.pb-type-grouped {
                display: flex !important;
                flex-direction: column !important;
            }

            .orderline.pb-type-group-start {
                position: relative !important;
                overflow: visible !important;
                margin-top: 38px !important;
            }

            .pb-type-group-label {
                position: absolute !important;
                top: -33px !important;
                left: 4px !important;
                right: 4px !important;
                height: 27px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                padding: 0 10px !important;
                border: 1px solid #cbd5e1 !important;
                border-radius: 7px !important;
                background: #f1f5f9 !important;
                color: #1e293b !important;
                font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
                font-size: 12px !important;
                font-weight: 800 !important;
                letter-spacing: 0.3px !important;
                line-height: 25px !important;
                box-sizing: border-box !important;
                pointer-events: none !important;
                user-select: none !important;
                z-index: 5 !important;
            }

            .pb-type-group-label .pb-type-group-count {
                color: #1d4ed8 !important;
                background: #dbeafe !important;
                padding: 1px 7px !important;
                border-radius: 999px !important;
                font-size: 11px !important;
                font-weight: 800 !important;
                line-height: 1.4 !important;
                letter-spacing: 0 !important;
            }

            /* 购物车商品缩略图：留足左/右间距，彻底避免与选中高亮边框冲突 */
            .orderline .pb-cart-product-image {
                width: 50px !important;
                height: 50px !important;
                min-width: 50px !important;
                flex: 0 0 50px !important;
                order: -10 !important;
                align-self: center !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                margin: 4px 10px 4px 6px !important;
                border: 1px solid #cbd5e1 !important;
                border-radius: 8px !important;
                background: #ffffff !important;
                overflow: hidden !important;
                box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05) !important;
                box-sizing: border-box !important;
                pointer-events: auto !important;
                cursor: zoom-in !important;
                position: relative !important;
                transition: border-color 0.16s ease, box-shadow 0.16s ease !important;
            }

            .orderline .pb-cart-product-image:hover {
                border-color: #2563eb !important;
                box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.18) !important;
            }

            .orderline .pb-cart-product-image::before {
                content: "IMG";
                position: absolute !important;
                color: #94a3b8 !important;
                font-size: 10px !important;
                font-weight: 800 !important;
                letter-spacing: 0.4px !important;
                z-index: 0 !important;
            }

            .orderline .pb-cart-product-image img {
                width: 100% !important;
                height: 100% !important;
                display: block !important;
                object-fit: contain !important;
                background: #ffffff !important;
                position: relative !important;
                z-index: 1 !important;
            }

            .orderline .pb-cart-product-image img:not([src]) { visibility: hidden !important; }

            .orderline .pb-cart-product-image.pb-cart-image-error img {
                display: none !important;
            }

            .orderline.selected .pb-cart-product-image {
                border-color: #60a5fa !important;
                background: #ffffff !important;
                box-shadow: none !important;
            }

            /* 购物车图片悬浮高清预览 */
            #pb-cart-image-preview-overlay {
                position: fixed !important;
                right: 22px !important;
                bottom: 22px !important;
                z-index: 1000000 !important;
                padding: 10px !important;
                border: 1px solid rgba(15, 23, 42, 0.10) !important;
                border-radius: 16px !important;
                background: #ffffff !important;
                box-shadow: 0 20px 50px rgba(15, 23, 42, 0.28) !important;
                pointer-events: none !important;
                opacity: 0 !important;
                visibility: hidden !important;
                transform: translateY(16px) scale(0.96) !important;
                transition:
                    opacity 0.22s ease-out,
                    transform 0.22s cubic-bezier(0.16, 1, 0.3, 1),
                    visibility 0s linear 0.22s !important;
            }

            #pb-cart-image-preview-overlay.visible {
                opacity: 1 !important;
                visibility: visible !important;
                transform: translateY(0) scale(1) !important;
                transition-delay: 0s !important;
            }

            #pb-cart-image-preview-overlay img {
                display: block !important;
                max-width: min(var(--pb-cart-preview-width, 640px), 60vw) !important;
                max-height: min(var(--pb-cart-preview-height, 480px), 70vh) !important;
                border-radius: 10px !important;
                object-fit: contain !important;
                background: #f8fafc !important;
                opacity: 0 !important;
                transition: opacity 0.18s ease-in !important;
            }

            #pb-cart-image-preview-overlay img.loaded {
                opacity: 1 !important;
            }

            .orderline.pb-inline-search-hidden {
                display: none !important;
            }
        `;

        document.head.appendChild(style);
    }

    function pbStopEvent(e) {
        e.stopPropagation();
    }

    function pbReleaseInlineSearchFocus(bar) {
        if (!bar) return;

        var searchInput = bar.querySelector("input");

        if (searchInput && typeof searchInput.blur === "function") {
            searchInput.blur();
        }

        var active = document.activeElement;

        if (
            active &&
            typeof bar.contains === "function" &&
            bar.contains(active) &&
            typeof active.blur === "function"
        ) {
            active.blur();
        }
    }

    function pbGetCartPreviewSizeKey() {
        var saved = "";

        try {
            saved = localStorage.getItem(PB_CART_PREVIEW_SIZE_KEY) || "";
        } catch (e) {}

        return Object.prototype.hasOwnProperty.call(PB_CART_PREVIEW_SIZES, saved)
            ? saved
            : "large";
    }

    function pbGetCartPreviewSize() {
        return PB_CART_PREVIEW_SIZES[pbGetCartPreviewSizeKey()];
    }

    function pbApplyCartPreviewSize() {
        if (!pbCartPreviewOverlay) return;

        var size = pbGetCartPreviewSize();
        pbCartPreviewOverlay.style.setProperty(
            "--pb-cart-preview-width",
            size.width + "px"
        );
        pbCartPreviewOverlay.style.setProperty(
            "--pb-cart-preview-height",
            size.height + "px"
        );
    }

    function pbSyncCartPreviewSizeSelects() {
        var sizeKey = pbGetCartPreviewSizeKey();

        document.querySelectorAll(".pb-cart-preview-size").forEach(function(select) {
            if (select.value !== sizeKey) select.value = sizeKey;
        });
    }

    function pbSetCartPreviewSize(sizeKey) {
        if (!Object.prototype.hasOwnProperty.call(PB_CART_PREVIEW_SIZES, sizeKey)) {
            sizeKey = "large";
        }

        try {
            localStorage.setItem(PB_CART_PREVIEW_SIZE_KEY, sizeKey);
        } catch (e) {}

        pbApplyCartPreviewSize();
        pbSyncCartPreviewSizeSelects();
    }

    function pbBindCartPreviewSizeSelect(select) {
        if (!select || select.getAttribute("data-pb-size-bound") === "1") return;

        select.setAttribute("data-pb-size-bound", "1");
        select.value = pbGetCartPreviewSizeKey();

        [
            "click",
            "mousedown",
            "mouseup",
            "pointerdown",
            "pointerup",
            "keydown",
            "keyup",
            "focus"
        ].forEach(function(evtName) {
            select.addEventListener(evtName, pbStopEvent, true);
        });

        select.addEventListener("change", function(e) {
            e.stopPropagation();
            pbSetCartPreviewSize(select.value);
        }, true);
    }

    function pbEnsureCartPreviewSizeSelect(bar) {
        if (!bar) return null;

        var select = bar.querySelector(".pb-cart-preview-size");

        if (!select) {
            select = document.createElement("select");
            select.className = "pb-cart-preview-size";
            select.title = pbUiText("选择图片预览大小","Elegir tamaño de ampliación de imagen");
            select.setAttribute("aria-label", pbUiText("选择图片预览大小","Elegir tamaño de ampliación de imagen"));
            select.innerHTML =
                '<option value="normal">' + pbUiText("预览：普通","Ampliar: normal") + '</option>' +
                '<option value="large">' + pbUiText("预览：大","Ampliar: grande") + '</option>' +
                '<option value="xlarge">' + pbUiText("预览：特大","Ampliar: extra grande") + '</option>';

            var clearButton = bar.querySelector(".pb-inline-search-clear");
            bar.insertBefore(select, clearButton || null);
        }

        pbBindCartPreviewSizeSelect(select);
        return select;
    }

    function pbIsTypeGroupingEnabled() {
        return pbTypeGroupingEnabled;
    }

    function pbUpdateTypeGroupingToggle(button) {
        if (!button) return;

        var enabled = pbIsTypeGroupingEnabled();
        button.textContent = enabled ? pbUiText("分组：开","Agrupar: sí") : pbUiText("分组：关","Agrupar: no");
        button.title = enabled
            ? pbUiText("已按商品类型分组，点击恢复录入顺序","Agrupado por tipo de producto; haz clic para volver al orden de captura")
            : pbUiText("未分组，点击按商品类型分组","Sin agrupación; haz clic para agrupar por tipo de producto");
        button.setAttribute("aria-pressed", enabled ? "true" : "false");
        button.classList.toggle("pb-type-group-enabled", enabled);
    }

    function pbSyncTypeGroupingToggles() {
        document.querySelectorAll(".pb-type-group-toggle").forEach(function(button) {
            pbUpdateTypeGroupingToggle(button);
        });
    }

    function pbSetTypeGroupingEnabled(enabled) {
        pbTypeGroupingEnabled = Boolean(enabled);

        try {
            localStorage.setItem(
                PB_TYPE_GROUPING_KEY,
                pbTypeGroupingEnabled ? "1" : "0"
            );
        } catch (e) {}

        pbSyncTypeGroupingToggles();
    }

    function pbRefreshAllSearchBars() {
        document.querySelectorAll(".pb-inline-order-search").forEach(function(bar) {
            var targetId = bar.getAttribute("data-target-container");
            var container = document.querySelector(
                '.order-container[data-pb-inline-search-id="' + targetId + '"]'
            );
            var input = bar.querySelector("input");
            var countEl = bar.querySelector(".pb-inline-search-count");

            if (container && input && countEl) {
                pbApplySearch(container, input, countEl);
            }
        });
    }

    function pbEnsureTypeGroupingToggle(bar) {
        if (!bar) return null;

        var button = bar.querySelector(".pb-type-group-toggle");

        if (!button) {
            button = document.createElement("button");
            button.type = "button";
            button.className = "pb-type-group-toggle";
            button.setAttribute("aria-label", pbUiText("切换购物车商品分组","Cambiar agrupación de productos del carrito"));

            var sizeSelect = bar.querySelector(".pb-cart-preview-size");
            var clearButton = bar.querySelector(".pb-inline-search-clear");
            bar.insertBefore(button, sizeSelect || clearButton || null);
        }

        if (button.getAttribute("data-pb-group-toggle-bound") !== "1") {
            button.setAttribute("data-pb-group-toggle-bound", "1");

            ["pointerdown", "mousedown", "pointerup", "mouseup"].forEach(function(evtName) {
                button.addEventListener(evtName, function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                }, true);
            });

            button.addEventListener("click", function(e) {
                e.preventDefault();
                e.stopPropagation();
                pbSetTypeGroupingEnabled(!pbIsTypeGroupingEnabled());
                pbRefreshAllSearchBars();

                if (typeof button.blur === "function") button.blur();
            }, true);
        }

        pbUpdateTypeGroupingToggle(button);
        return button;
    }

    function pbEnsureCartImagePreview() {
        if (pbCartPreviewOverlay && document.body.contains(pbCartPreviewOverlay)) {
            return;
        }

        pbCartPreviewOverlay = document.createElement("div");
        pbCartPreviewOverlay.id = "pb-cart-image-preview-overlay";
        pbCartPreviewOverlay.setAttribute("aria-hidden", "true");

        pbCartPreviewImage = document.createElement("img");
        pbCartPreviewImage.alt = "";
        pbCartPreviewImage.draggable = false;
        pbCartPreviewOverlay.appendChild(pbCartPreviewImage);
        document.body.appendChild(pbCartPreviewOverlay);
        pbApplyCartPreviewSize();
    }

    function pbGetCartPreviewImageUrl(src) {
        return String(src || "").replace(/image_\d+/i, "image_1024");
    }

    function pbHideCartImagePreview() {
        clearTimeout(pbCartPreviewTimer);
        pbCartPreviewTimer = null;
        pbCartPreviewRequest++;
        pbCartPreviewSourceBox = null;

        if (pbCartPreviewOverlay) {
            pbCartPreviewOverlay.classList.remove("visible");
        }

        if (pbCartPreviewImage) {
            pbCartPreviewImage.classList.remove("loaded");
        }
    }

    function pbShowCartImagePreview(box) {
        if (!box || box.classList.contains("pb-cart-image-error")) return;

        var thumbnail = box.querySelector("img");
        if (!thumbnail || !thumbnail.src) return;

        pbEnsureCartImagePreview();
        pbCartPreviewSourceBox = box;

        var requestId = ++pbCartPreviewRequest;
        var previewSrc = pbGetCartPreviewImageUrl(thumbnail.src);

        pbApplyCartPreviewSize();
        pbCartPreviewImage.classList.remove("loaded");
        pbCartPreviewImage.alt = thumbnail.alt || "Imagen del producto";
        pbCartPreviewImage.onload = function() {
            if (requestId !== pbCartPreviewRequest) return;
            pbCartPreviewImage.classList.add("loaded");
        };
        pbCartPreviewImage.onerror = function() {
            if (requestId === pbCartPreviewRequest) {
                pbHideCartImagePreview();
            }
        };
        pbCartPreviewImage.src = previewSrc;

        requestAnimationFrame(function() {
            if (requestId === pbCartPreviewRequest) {
                pbCartPreviewOverlay.classList.add("visible");
            }
        });
    }

    function pbBindCartImagePreview(box) {
        if (!box || box.getAttribute("data-pb-preview-bound") === "1") return;

        box.setAttribute("data-pb-preview-bound", "1");
        box.title = pbUiText("悬停放大图片","Pasa el cursor para ampliar la imagen");

        box.addEventListener("mouseenter", function() {
            clearTimeout(pbCartPreviewTimer);
            pbCartPreviewTimer = setTimeout(function() {
                pbShowCartImagePreview(box);
            }, PB_CART_PREVIEW_DELAY);
        });

        box.addEventListener("mouseleave", pbHideCartImagePreview);
    }

    function pbCartPreviewSourceIsInactive(box) {
        if (!box) return false;

        if (
            !document.body ||
            typeof document.body.contains !== "function" ||
            !document.body.contains(box)
        ) {
            return true;
        }

        // Odoo可能保留旧页面DOM但把整页隐藏；隐藏节点不会再触发mouseleave。
        if (
            typeof box.getClientRects === "function" &&
            box.getClientRects().length === 0
        ) {
            return true;
        }

        return Boolean(
            typeof box.closest === "function" &&
            box.closest(".payment-screen, .receipt-screen, .ticket-screen")
        );
    }

    function pbDismissCartPreviewIfInactive() {
        if (
            pbCartPreviewSourceBox &&
            pbCartPreviewSourceIsInactive(pbCartPreviewSourceBox)
        ) {
            pbHideCartImagePreview();
        }
    }

    function pbGetCleanProductName(line) {
        if (!line) return "";

        var nameEl =
            line.querySelector(".product-name .text-wrap") ||
            line.querySelector(".product-name");

        if (!nameEl) return "";

        if (!nameEl.querySelector('.pb-seq-num,.pos-mini-stock-display,.pb-type-group-label,small')) return String(nameEl.textContent || '').replace(/\s+/g, ' ').trim();
        var clone = nameEl.cloneNode(true);

        clone.querySelectorAll(
            ".pb-seq-num, .pos-mini-stock-display, .pb-type-group-label, small"
        ).forEach(function(el) {
            el.remove();
        });

        return String(clone.textContent || "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function pbGetProductType(line) {
        var productName = pbGetCleanProductName(line);
        var match = productName.match(/^([^\s]+)/);

        return match ? match[1].toUpperCase() : "OTROS";
    }

    function pbToArray(value) {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        if (Array.isArray(value.models)) return value.models;

        try {
            return Array.from(value);
        } catch (e) {
            return [];
        }
    }

    function pbNormalizeProductId(value) {
        if (!value) return null;
        if (Array.isArray(value)) value = value[0];
        if (typeof value === "object") value = value.id;

        var id = parseInt(value, 10);
        return Number.isFinite(id) && id > 0 ? id : null;
    }

    function pbGetProductFromOrderLine(orderLine) {
        if (!orderLine) return null;

        if (typeof orderLine.get_product === "function") {
            return orderLine.get_product();
        }

        return orderLine.product_id || orderLine.product || null;
    }

    function pbFindProductIdLocally(container, line, cleanName, identity) {
        var pos = window.posmodel || window.pos;

        if (pos) {
            var order = typeof pos.get_order === "function"
                ? pos.get_order()
                : pos.selectedOrder;

            if (order) {
                var orderLines = pbToArray(
                    typeof order.get_orderlines === "function"
                        ? order.get_orderlines()
                        : order.lines
                );
                var domIndex = identity ? identity.indexes.get(line) : Array.from(container.querySelectorAll('.orderline')).indexOf(line);

                if (domIndex >= 0 && orderLines[domIndex]) {
                    var indexedProduct = pbGetProductFromOrderLine(orderLines[domIndex]);
                    var indexedId = pbNormalizeProductId(indexedProduct);

                    if (indexedId) return indexedId;
                }

                var normalizedName = pbNormalizeText(cleanName);
                var rowText = pbNormalizeText(line.textContent || "");

                for (var i = 0; i < orderLines.length; i++) {
                    var product = pbGetProductFromOrderLine(orderLines[i]);
                    if (!product) continue;

                    var productName = pbNormalizeText(
                        product.display_name || product.name || ""
                    );

                    if (
                        productName === normalizedName ||
                        productName.indexOf(normalizedName) !== -1 ||
                        normalizedName.indexOf(productName) !== -1 ||
                        rowText.indexOf(productName) !== -1
                    ) {
                        var productId = pbNormalizeProductId(product);
                        if (productId) return productId;
                    }
                }
            }

            var productDb = pos.db && pos.db.product_by_id
                ? pos.db.product_by_id
                : null;

            if (productDb) {
                var targetName = pbNormalizeText(cleanName);

                for (var dbId in productDb) {
                    var dbProduct = productDb[dbId];
                    var dbName = pbNormalizeText(
                        dbProduct.display_name || dbProduct.name || ""
                    );

                    if (
                        dbName === targetName ||
                        dbName.indexOf(targetName) !== -1 ||
                        targetName.indexOf(dbName) !== -1
                    ) {
                        return pbNormalizeProductId(dbProduct) ||
                            pbNormalizeProductId(dbId);
                    }
                }
            }
        }

        var cards = document.querySelectorAll(
            "article.product[data-product-id], .product[data-product-id]"
        );
        var normalizedCleanName = pbNormalizeText(cleanName);

        for (var j = 0; j < cards.length; j++) {
            var cardNameEl = cards[j].querySelector(".product-name, img[alt]");
            var cardName = pbNormalizeText(
                cardNameEl
                    ? (cardNameEl.textContent || cardNameEl.getAttribute("alt") || "")
                    : ""
            );

            if (cardName === normalizedCleanName) {
                return pbNormalizeProductId(cards[j].getAttribute("data-product-id"));
            }
        }

        return null;
    }

    async function pbCallOdoo(model, method, args, kwargs) {
        var csrf = "";

        if (typeof odoo !== "undefined" && odoo.csrf_token) {
            csrf = odoo.csrf_token;
        }

        var response = await fetch(
            "/web/dataset/call_kw/" + model + "/" + method,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": csrf
                },
                credentials: "same-origin",
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "call",
                    params: {
                        model: model,
                        method: method,
                        args: args || [],
                        kwargs: kwargs || {}
                    },
                    id: Date.now()
                })
            }
        );
        var json = await response.json();

        if (json.error) throw new Error("Odoo RPC error");
        return json.result;
    }

    async function pbResolveProductId(container, line, cleanName, identity) {
        var localId = pbFindProductIdLocally(container, line, cleanName, identity);
        if (localId) return localId;

        var cacheKey = pbNormalizeText(cleanName);
        if (pbImagePidCache.has(cacheKey)) {
            return pbImagePidCache.get(cacheKey);
        }
        if (pbImagePidPending.has(cacheKey)) {
            return pbImagePidPending.get(cacheKey);
        }

        var pending = (async function() {
            try {
                var nameParts = String(cleanName || "").trim().split(/\s+/);
                var sku = nameParts.length ? nameParts[nameParts.length - 1] : "";
                var domain = [
                    "|",
                    ["name", "ilike", cleanName],
                    ["default_code", "ilike", sku]
                ];
                var products = await pbCallOdoo(
                    "product.product",
                    "search_read",
                    [domain, ["id", "name", "display_name", "default_code"]],
                    { limit: 10 }
                );
                var normalizedName = pbNormalizeText(cleanName);
                var normalizedSku = pbNormalizeText(sku);
                var best = null;

                (products || []).some(function(product) {
                    var candidateName = pbNormalizeText(
                        product.display_name || product.name || ""
                    );
                    var candidateSku = pbNormalizeText(product.default_code || "");
                    var exact = candidateName === normalizedName ||
                        (normalizedSku && candidateSku === normalizedSku);

                    if (exact) {
                        best = product;
                        return true;
                    }

                    if (!best) best = product;
                    return false;
                });

                var resolvedId = pbNormalizeProductId(best);
                pbImagePidCache.set(cacheKey, resolvedId);
                return resolvedId;
            } catch (e) {
                pbImagePidCache.set(cacheKey, null);
                return null;
            } finally {
                pbImagePidPending.delete(cacheKey);
            }
        })();

        pbImagePidPending.set(cacheKey, pending);
        return pending;
    }

    // Browser lazy loading still fetches images far outside this short cart pane.
    // Assign a URL only when the row approaches the viewport. Keep the latest
    // product identity if Odoo reuses a row before it becomes visible.
    const pbCartImageObserver = typeof IntersectionObserver === "function"
        ? new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const image = entry.target;
                pbCartImageObserver.unobserve(image);
                const url = image.dataset.pbDeferredSrc;
                if (!image.isConnected) { delete image.dataset.pbDeferredSrc; continue; }
                if (url && image.getAttribute("src") !== url) image.src = url;
                delete image.dataset.pbDeferredSrc;
            }
        }, { rootMargin: "220px 0px" }) : null;
    function pbQueueCartImage(image, url) {
        if (!pbCartImageObserver) { image.src = url; return; }
        const current = image.getAttribute("src");
        if (current && current !== url) image.removeAttribute("src");
        image.dataset.pbDeferredSrc = url;
        pbCartImageObserver.observe(image);
    }
    function pbForgetDetachedCartImages(mutations) {
        if (!pbCartImageObserver) return;
        for (const mutation of mutations) for (const node of mutation.removedNodes || []) {
            if (node.nodeType !== 1) continue;
            if (node.matches?.(".pb-cart-product-image img")) pbCartImageObserver.unobserve(node);
            node.querySelectorAll?.(".pb-cart-product-image img").forEach(image => pbCartImageObserver.unobserve(image));
        }
    }

    function pbGetOrCreateImageBox(line) {
        var box = line.querySelector(":scope > .pb-cart-product-image");

        if (!box) {
            box = document.createElement("div");
            box.className = "pb-cart-product-image";
            box.setAttribute("aria-hidden", "true");

            var img = document.createElement("img");
            img.loading = "lazy";
            img.decoding = "async";
            img.draggable = false;
            box.appendChild(img);

            var firstNormalChild = Array.from(line.children).find(function(child) {
                return !child.classList.contains("pb-type-group-label");
            });
            line.insertBefore(box, firstNormalChild || null);
        }

        pbBindCartImagePreview(box);

        return box;
    }

    async function pbRenderCartImage(container, line, identity) {
        if (!line || line.closest(".ticket-screen")) return;

        var cleanName = pbGetCleanProductName(line);
        if (!cleanName) return;

        var expectedName = cleanName;
        var rowIndex = identity && identity.indexes.get(line);
        var knownId = identity && pbNormalizeProductId(pbGetProductFromOrderLine(identity.orderLines[rowIndex]));
        var existingBox = line.querySelector(':scope > .pb-cart-product-image');
        var existingImage = existingBox && existingBox.querySelector('img');
        if (knownId && existingBox && existingBox.getAttribute('data-product-id') === String(knownId) && existingImage && existingImage.alt === cleanName) return;
        var productId = await pbResolveProductId(container, line, cleanName, identity);

        if (!productId || !document.body.contains(line)) return;
        if (pbGetCleanProductName(line) !== expectedName) return;

        var box = pbGetOrCreateImageBox(line);
        var img = box.querySelector("img");
        var pidText = String(productId);

        if (!img || box.getAttribute("data-product-id") === pidText) return;

        box.setAttribute("data-product-id", pidText);
        box.classList.remove("pb-cart-image-error");
        img.alt = cleanName;
        img.onerror = function() {
            box.classList.add("pb-cart-image-error");
        };
        img.onload = function() {
            box.classList.remove("pb-cart-image-error");
        };
        pbQueueCartImage(img, "/web/image?model=product.product&field=image_128&id=" +
            encodeURIComponent(pidText));
    }

    function pbRenderCartImages(container) {
        if (!container || container.closest(".ticket-screen")) return;

        var rows = Array.from(container.querySelectorAll('.orderline'));
        var pos = window.posmodel || window.pos;
        var order = pos && (typeof pos.get_order === 'function' ? pos.get_order() : pos.selectedOrder);
        var identity = { indexes: new Map(rows.map(function(line, index) { return [line, index]; })), orderLines: pbToArray(order && (typeof order.get_orderlines === 'function' ? order.get_orderlines() : order.lines)) };
        rows.forEach(function(line) { pbRenderCartImage(container, line, identity); });
    }

    function pbIsSearchVisible(line) {
        return !line.classList.contains("pb-inline-search-hidden");
    }

    function pbGetCartLineKey(line) {
        return pbNormalizeText(pbGetCleanProductName(line));
    }

    function pbBuildCartLineCounts(lines) {
        var counts = new Map();

        lines.forEach(function(line) {
            var key = pbGetCartLineKey(line);

            if (key) {
                counts.set(key, (counts.get(key) || 0) + 1);
            }
        });

        return counts;
    }

    function pbGetCartLineQuantitySignature(line) {
        if (!line || typeof line.querySelector !== "function") return "";

        var qtyEl = line.querySelector(".qty, .quantity");
        return qtyEl
            ? String(qtyEl.textContent || "").replace(/\s+/g, " ").trim()
            : "";
    }

    function pbBuildCartQuantitySignatures(lines) {
        var quantitiesByLine = new Map();
        var quantitiesByKey = new Map();

        lines.forEach(function(line) {
            var key = pbGetCartLineKey(line);
            var signature = pbGetCartLineQuantitySignature(line);

            quantitiesByLine.set(line, signature);

            if (!quantitiesByKey.has(key)) {
                quantitiesByKey.set(key, []);
            }

            quantitiesByKey.get(key).push(signature);
        });

        quantitiesByKey.forEach(function(signatures, key) {
            quantitiesByKey.set(key, signatures.join("\u001f"));
        });

        return {
            byLine: quantitiesByLine,
            byKey: quantitiesByKey
        };
    }

    function pbGetVisualCartLines(lines) {
        return lines.map(function(line, index) {
            return {
                line: line,
                index: index,
                order: parseInt(line.style.order || "0", 10) || 0
            };
        }).sort(function(a, b) {
            if (a.order !== b.order) return a.order - b.order;
            return a.index - b.index;
        }).map(function(entry) {
            return entry.line;
        });
    }

    function pbCreateCartFollowSnapshot(lines) {
        var quantities = pbBuildCartQuantitySignatures(lines);

        return {
            counts: pbBuildCartLineCounts(lines),
            lines: lines.slice(),
            visualLines: pbGetVisualCartLines(lines),
            quantitiesByLine: quantities.byLine,
            quantitiesByKey: quantities.byKey
        };
    }

    function pbFindQuantityChangedTarget(previous, current, lines) {
        if (!previous || !current) return null;

        var selectedLine = lines.find(function(line) {
            return line.classList.contains("selected") && pbIsSearchVisible(line);
        });

        if (!selectedLine) return null;

        var currentSignature = current.quantitiesByLine.get(selectedLine) || "";
        var previousSignature = previous.quantitiesByLine
            ? (previous.quantitiesByLine.get(selectedLine) || "")
            : "";

        // Odoo通常保留同一个orderline节点，直接比较这一行最准确。
        if (
            previous.quantitiesByLine &&
            previous.quantitiesByLine.has(selectedLine) &&
            currentSignature !== previousSignature
        ) {
            return selectedLine;
        }

        // 某些更新会重建整行DOM；此时按产品名称比较数量签名兜底。
        var key = pbGetCartLineKey(selectedLine);
        var oldKeySignature = previous.quantitiesByKey
            ? (previous.quantitiesByKey.get(key) || "")
            : "";
        var newKeySignature = current.quantitiesByKey.get(key) || "";

        return oldKeySignature && oldKeySignature !== newKeySignature
            ? selectedLine
            : null;
    }

    function pbFindDeletedVisualNeighbor(previous, lines) {
        if (
            !previous ||
            !previous.lines ||
            previous.lines.length <= lines.length
        ) {
            return null;
        }

        var currentSet = new Set(lines);
        var oldVisualLines = previous.visualLines || previous.lines;
        var removedIndex = -1;

        for (var i = 0; i < oldVisualLines.length; i++) {
            if (!currentSet.has(oldVisualLines[i])) {
                removedIndex = i;
                break;
            }
        }

        if (removedIndex === -1) return null;

        // 优先选择分类画面中被删除商品的上一件；如果删除的是第一件，
        // 才选择下一件，保证购物车仍有一个合理的选中项。
        for (var before = removedIndex - 1; before >= 0; before--) {
            if (
                currentSet.has(oldVisualLines[before]) &&
                pbIsSearchVisible(oldVisualLines[before])
            ) {
                return oldVisualLines[before];
            }
        }

        for (var after = removedIndex + 1; after < oldVisualLines.length; after++) {
            if (
                currentSet.has(oldVisualLines[after]) &&
                pbIsSearchVisible(oldVisualLines[after])
            ) {
                return oldVisualLines[after];
            }
        }

        return null;
    }

    function pbAnalyzeCartLineChange(container, lines) {
        var current = pbCreateCartFollowSnapshot(lines);
        var previous = pbCartFollowStates.get(container);

        // 第一次看到这个购物车时只记录，不在打开页面时突然滚动。
        if (!previous) {
            pbCartFollowStates.set(container, current);
            return {
                addedTarget: null,
                deletedTarget: null,
                quantityTarget: null
            };
        }

        var deletedTarget = pbFindDeletedVisualNeighbor(previous, lines);
        var quantityTarget = pbFindQuantityChangedTarget(previous, current, lines);
        var remainingNewCounts = new Map();

        current.counts.forEach(function(count, key) {
            var added = count - (previous.counts.get(key) || 0);

            if (added > 0) remainingNewCounts.set(key, added);
        });

        pbCartFollowStates.set(container, current);

        if (!remainingNewCounts.size) {
            return {
                addedTarget: null,
                deletedTarget: deletedTarget,
                quantityTarget: quantityTarget
            };
        }

        var selectedLine = lines.find(function(line) {
            return line.classList.contains("selected") &&
                remainingNewCounts.has(pbGetCartLineKey(line));
        });

        if (selectedLine) {
            return {
                addedTarget: selectedLine,
                deletedTarget: deletedTarget,
                quantityTarget: quantityTarget
            };
        }

        // 没有selected标记时，从后向前找本次新增的商品，符合Odoo追加商品行的顺序。
        for (var i = lines.length - 1; i >= 0; i--) {
            var lineKey = pbGetCartLineKey(lines[i]);
            var left = remainingNewCounts.get(lineKey) || 0;

            if (left > 0) {
                return {
                    addedTarget: lines[i],
                    deletedTarget: deletedTarget,
                    quantityTarget: quantityTarget
                };
            }
        }

        return {
            addedTarget: null,
            deletedTarget: deletedTarget,
            quantityTarget: quantityTarget
        };
    }

    function pbFindNewCartLineTarget(container, lines) {
        return pbAnalyzeCartLineChange(container, lines).addedTarget;
    }

    function pbScrollCartLineStable(container, target) {
        if (!container || !target) return;

        var requestId = (pbCartScrollRequests.get(container) || 0) + 1;
        pbCartScrollRequests.set(container, requestId);

        function scrollNow() {
            if (
                pbCartScrollRequests.get(container) !== requestId ||
                !document.body.contains(target) ||
                !pbIsSearchVisible(target) ||
                typeof target.scrollIntoView !== "function"
            ) {
                return;
            }

            target.scrollIntoView({
                block: "center",
                inline: "nearest",
                behavior: "auto"
            });
        }

        function afterFirstLayout() {
            scrollNow();

            // 新品类的标题会增加首行间距；布局稳定后再校准一次。
            setTimeout(scrollNow, 100);
        }

        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(afterFirstLayout);
        } else {
            setTimeout(afterFirstLayout, 0);
        }
    }

    function pbSelectDeletedVisualNeighbor(container, target) {
        if (!container || !target) return;

        setTimeout(function() {
            if (
                !document.body.contains(target) ||
                !pbIsSearchVisible(target)
            ) {
                return;
            }

            if (
                !target.classList.contains("selected") &&
                typeof target.click === "function"
            ) {
                target.click();
            }

            pbScrollCartLineStable(container, target);
        }, 0);
    }

    function pbFollowNewCartLine(container, lines) {
        if (!container || container.closest(".ticket-screen")) return;

        var change = pbAnalyzeCartLineChange(container, lines);
        var target = change.addedTarget;

        if (target && pbIsSearchVisible(target)) {
            pbScrollCartLineStable(container, target);
            return;
        }

        // 同一商品再次扫码时只会改变数量，Odoo会把选中行滚到顶部。
        // 在其更新完成后重新居中，不改变焦点，也不模拟商品点击。
        if (change.quantityTarget && pbIsTypeGroupingEnabled()) {
            pbScrollCartLineStable(container, change.quantityTarget);
            return;
        }

        if (
            change.deletedTarget &&
            pbIsTypeGroupingEnabled()
        ) {
            pbSelectDeletedVisualNeighbor(container, change.deletedTarget);
        }
    }

    function pbResetTypeGrouping(container, lines) {
        lines.forEach(function(line) {
            if (line.style.order) line.style.order = "";
            if (line.classList.contains("pb-type-group-start")) line.classList.remove("pb-type-group-start");

            if (typeof line.removeAttribute === "function") {
                if (line.hasAttribute("data-pb-product-type")) line.removeAttribute("data-pb-product-type");
            }

            var label = line.querySelector(":scope > .pb-type-group-label");
            if (label) label.remove();
        });

        if (container.classList.contains("pb-type-grouped")) container.classList.remove("pb-type-grouped");
        pbFollowNewCartLine(container, lines);
    }

    function pbApplyTypeGrouping(container) {
        if (!container) return;

        var allLines = Array.from(container.querySelectorAll(".orderline"));
        var lines = allLines.filter(function(line) {
            return line.parentElement === container;
        });

        // Odoo标准结构中商品行是order-container的直接子元素；保留后备兼容。
        if (!lines.length) lines = allLines;

        if (!lines.length) {
            if (container.classList.contains("pb-type-grouped")) container.classList.remove("pb-type-grouped");
            pbCartFollowStates.delete(container);
            return;
        }

        if (!pbIsTypeGroupingEnabled()) {
            pbResetTypeGrouping(container, lines);
            return;
        }

        var groups = new Map();

        lines.forEach(function(line) {
            var type = pbGetProductType(line);

            if (!groups.has(type)) {
                groups.set(type, []);
            }

            groups.get(type).push({ line: line });
        });

        var sortedTypes = Array.from(groups.keys()).sort(function(a, b) {
            return pbTypeCollator.compare(a, b);
        });
        var orderStep = lines.length + 1;
        var groupStarts = new Map();

        sortedTypes.forEach(function(type, groupIndex) {
            var entries = groups.get(type);
            var visibleEntries = entries.filter(function(entry) {
                return pbIsSearchVisible(entry.line);
            });

            entries.forEach(function(entry, lineIndex) {
                var targetOrder = String((groupIndex * orderStep) + lineIndex + 1);

                if (entry.line.style.order !== targetOrder) {
                    entry.line.style.order = targetOrder;
                }

                if (entry.line.getAttribute("data-pb-product-type") !== type) entry.line.setAttribute("data-pb-product-type", type);
            });

            if (visibleEntries.length) {
                groupStarts.set(visibleEntries[0].line, {
                    type: type,
                    visible: visibleEntries.length,
                    total: entries.length
                });
            }
        });

        lines.forEach(function(line) {
            var startInfo = groupStarts.get(line);
            var label = line.querySelector(":scope > .pb-type-group-label");

            if (line.classList.contains("pb-type-group-start") !== Boolean(startInfo)) line.classList.toggle("pb-type-group-start", Boolean(startInfo));

            if (!startInfo) {
                if (label) label.remove();
                return;
            }

            if (!label) {
                label = document.createElement("div");
                label.className = "pb-type-group-label";
                label.setAttribute("aria-hidden", "true");
                label.innerHTML =
                    '<span class="pb-type-group-name"></span>' +
                    '<span class="pb-type-group-count"></span>';
                line.insertBefore(label, line.firstChild);
            }

            var countText = startInfo.visible === startInfo.total
                ? String(startInfo.total)
                : (startInfo.visible + "/" + startInfo.total);
            var typeEl = label.querySelector(".pb-type-group-name");
            var groupCountEl = label.querySelector(".pb-type-group-count");

            if (typeEl && typeEl.textContent !== startInfo.type) {
                typeEl.textContent = startInfo.type;
            }

            if (groupCountEl && groupCountEl.textContent !== countText + pbUiText(" 种"," prod.")) {
                groupCountEl.textContent = countText + pbUiText(" 种"," prod.");
            }
        });

        if (!container.classList.contains("pb-type-grouped")) container.classList.add("pb-type-grouped");
        pbFollowNewCartLine(container, lines);
    }

    function pbGetFirstVisualSearchHit(container) {
        var hits = Array.from(
            container.querySelectorAll(".orderline.pb-inline-search-hit")
        );

        hits.sort(function(a, b) {
            var orderA = parseInt(a.style.order || "0", 10) || 0;
            var orderB = parseInt(b.style.order || "0", 10) || 0;
            return orderA - orderB;
        });

        return hits[0] || null;
    }

    function pbApplySearch(container, input, countEl) {
        if (!container || !input || !countEl) return;

        var query = pbNormalizeText(input.value || "");
        var terms = query ? query.split(" ").filter(Boolean) : [];

        var lines = container.querySelectorAll(".orderline");
        var total = 0;
        var matched = 0;

        lines.forEach(function(line) {
            total++;

            var ok = true;
            if (terms.length) {
                var lineText = pbNormalizeText(line.textContent || "");
                for (var i = 0; i < terms.length; i++) {
                    if (lineText.indexOf(terms[i]) === -1) {
                        ok = false;
                        break;
                    }
                }
            }

            if (ok) matched++;

            const hidden = Boolean(query && !ok);
            const hit = Boolean(query && ok);
            if (line.classList.contains("pb-inline-search-hidden") !== hidden)
                line.classList.toggle("pb-inline-search-hidden", hidden);
            if (line.classList.contains("pb-inline-search-hit") !== hit)
                line.classList.toggle("pb-inline-search-hit", hit);
        });

        var countText = query ? (matched + '/' + total) : (total + pbUiText(" 种"," prod."));
        if (countEl.textContent !== countText) countEl.textContent = countText;
        pbApplyTypeGrouping(container);
        pbRenderCartImages(container);
    }

    function pbClearSearchBar(bar) {
        if (!bar) return;

        var targetId = bar.getAttribute("data-target-container");
        var container = document.querySelector('.order-container[data-pb-inline-search-id="' + targetId + '"]');
        var input = bar.querySelector("input");
        var countEl = bar.querySelector(".pb-inline-search-count");

        if (input) input.value = "";

        if (container && input && countEl) {
            pbApplySearch(container, input, countEl);
        }
    }

    function pbClearAllSearches() {
        document.querySelectorAll(".pb-inline-order-search").forEach(function(bar) {
            pbClearSearchBar(bar);
        });
    }

    function pbCreateSearchBarForContainer(container) {
        if (!container || !container.parentNode) return;
        if (!container.querySelector(".orderline")) return;

        var searchId = container.getAttribute("data-pb-inline-search-id");

        if (!searchId) {
            searchId = "pb-inline-search-" + (pbSearchSeq++);
            container.setAttribute("data-pb-inline-search-id", searchId);
        }

        var existingBar = document.querySelector('.pb-inline-order-search[data-target-container="' + searchId + '"]');

        if (!existingBar) {
            var bar = document.createElement("div");
            bar.className = "pb-inline-order-search";
            bar.setAttribute("data-target-container", searchId);

            bar.innerHTML =
                '<span class="pb-inline-search-icon">🔎</span>' +
                '<input type="text" placeholder="' + pbUiText("搜索商品 / SKU / 颜色","Buscar producto / SKU / color") + '" autocomplete="off">' +
                '<span class="pb-inline-search-count">0 prod.</span>' +
                '<button type="button" class="pb-inline-search-clear" title="' + pbUiText("清除搜索","Limpiar búsqueda") + '">×</button>';

            container.parentNode.insertBefore(bar, container);

            var input = bar.querySelector("input");
            var clearBtn = bar.querySelector(".pb-inline-search-clear");
            var countEl = bar.querySelector(".pb-inline-search-count");
            pbEnsureCartPreviewSizeSelect(bar);
            pbEnsureTypeGroupingToggle(bar);

            [
                "click",
                "mousedown",
                "mouseup",
                "pointerdown",
                "pointerup",
                "keyup",
                "keypress",
                "input",
                "beforeinput",
                "compositionstart",
                "compositionend",
                "focus"
            ].forEach(function(evtName) {
                input.addEventListener(evtName, pbStopEvent, true);
            });

            input.addEventListener("input", function(e) {
                e.stopPropagation();
                pbApplySearch(container, input, countEl);
            }, true);

            input.addEventListener("keydown", function(e) {
                e.stopPropagation();

                // ESC：清空搜索
                if (e.key === "Escape" || e.key === "Esc") {
                    input.value = "";
                    pbApplySearch(container, input, countEl);
                    pbReleaseInlineSearchFocus(bar);
                    e.preventDefault();
                    return false;
                }

                // Enter：跳到第一个匹配商品
                if (e.key === "Enter") {
                    var firstHit = pbGetFirstVisualSearchHit(container);

                    if (firstHit) {
                        firstHit.scrollIntoView({
                            block: "center",
                            behavior: "smooth"
                        });
                    }

                    e.preventDefault();
                    return false;
                }
            }, true);

            clearBtn.addEventListener("click", function(e) {
                e.preventDefault();
                e.stopPropagation();

                input.value = "";
                pbApplySearch(container, input, countEl);
                pbReleaseInlineSearchFocus(bar);
            }, true);

            pbApplySearch(container, input, countEl);
        } else {
            var input2 = existingBar.querySelector("input");
            var countEl2 = existingBar.querySelector(".pb-inline-search-count");
            pbEnsureCartPreviewSizeSelect(existingBar);
            pbEnsureTypeGroupingToggle(existingBar);

            if (existingBar.nextElementSibling !== container) {
                container.parentNode.insertBefore(existingBar, container);
            }

            pbApplySearch(container, input2, countEl2);
        }
    }

    function pbCleanOrphanBars() {
        document.querySelectorAll(".pb-inline-order-search").forEach(function(bar) {
            var targetId = bar.getAttribute("data-target-container");
            var container = document.querySelector('.order-container[data-pb-inline-search-id="' + targetId + '"]');

            if (!container || !document.body.contains(container)) {
                bar.remove();
            }
        });
    }

    function pbProcessInlineSearchBars() {
        pbInjectStyle();

        var containers = document.querySelectorAll(".order-container");

        containers.forEach(function(container) {
            if (container.querySelector(".orderline")) {
                pbCreateSearchBarForContainer(container);
            }
        });

        pbCleanOrphanBars();
    }

    function pbNodeHasCartStructure(node) {
        if (!node || node.nodeType !== 1) return false;

        if (
            typeof node.matches === "function" &&
            node.matches(".orderline, .order-container")
        ) {
            return true;
        }

        return Boolean(
            typeof node.querySelector === "function" &&
            node.querySelector(".orderline, .order-container")
        );
    }

    function pbMutationNeedsCartRefresh(mutation) {
        if (
            !mutation ||
            (mutation.type !== "childList" && mutation.type !== "characterData")
        ) {
            return false;
        }

        var addon = '.pos-mini-stock-display,.pb-seq-num,.pb-type-group-label,.pb-cart-product-image,.pb-cart-unit-toolbar';
        var owner = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
        if (owner && owner.closest(addon)) return false;
        var changedNodes = Array.from(mutation.addedNodes || []).concat(
            Array.from(mutation.removedNodes || [])
        );

        if (changedNodes.length && changedNodes.every(function(node) { return node.nodeType === 1 && node.matches(addon); })) return false;
        if (changedNodes.some(pbNodeHasCartStructure)) return true;

        // Odoo有时先插入一个空orderline，再逐步把产品名称、价格等内容
        // 写入其内部。此时新增节点本身不是orderline，需要检查变更位置的祖先。
        var target = mutation.target;

        if (target && target.nodeType !== 1) {
            target = target.parentElement;
        }

        return Boolean(
            target &&
            typeof target.closest === "function" &&
            target.closest(".orderline, .order-container")
        );
    }

    var pbCartRefreshFrame = null;
    function pbScheduleCartRefresh() {
        if (pbCartRefreshFrame !== null || document.hidden) return;
        // Odoo may add rows inside its own animation-frame callback. Waiting
        // for another frame paints the raw flex order first. Coalesce within
        // the same microtask checkpoint so grouping is ready before paint.
        pbCartRefreshFrame = true;
        queueMicrotask(function() {
            pbCartRefreshFrame = null;
            if (pbCartMutationRefreshRunning) return;
            pbCartMutationRefreshRunning = true;
            try { pbProcessInlineSearchBars(); }
            catch (error) { console.warn('[PB Inline Search] Falló la actualización del carrito', error); }
            finally { pbCartMutationRefreshRunning = false; }
        });
    }
    function pbStartCartMutationObserver() {
        if (pbCartDomObserver || !document.body || typeof MutationObserver !== 'function') return;
        pbCartDomObserver = new MutationObserver(function(mutations) {
            pbForgetDetachedCartImages(mutations);
            pbDismissCartPreviewIfInactive();
            if (mutations.some(pbMutationNeedsCartRefresh)) pbScheduleCartRefresh();
        });
        pbCartDomObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
        document.addEventListener('visibilitychange', function() { if (!document.hidden) pbScheduleCartRefresh(); });
    }

    function pbWaitForPosThenStart() {
        if (pbSearchStarted) return;

        var hasPosLoaded =
            document.querySelector(".pos") ||
            document.querySelector(".pos-content") ||
            document.querySelector(".product-screen") ||
            document.querySelector(".ticket-screen") ||
            document.querySelector(".order-container");

        if (!hasPosLoaded) {
            setTimeout(pbWaitForPosThenStart, 500);
            return;
        }

        pbSearchStarted = true;

        setTimeout(function() {
            try {
                pbProcessInlineSearchBars();
                pbStartCartMutationObserver();

                setInterval(function() {
                    try {
                        pbDismissCartPreviewIfInactive();
                        // The observer handles cart changes. This timer only repairs a missing bar.
                        var missingBar = Array.from(document.querySelectorAll('.order-container')).some(function(container) {
                            return container.querySelector('.orderline') &&
                                (!container.dataset.pbInlineSearchId ||
                                 !document.querySelector('.pb-inline-order-search[data-target-container="' + container.dataset.pbInlineSearchId + '"]'));
                        });
                        if (missingBar) pbScheduleCartRefresh();
                    } catch (e) {
                        console.warn("[PB Inline Search] Falló la ejecución; se omitió:", e);
                    }
                }, 3000);

            } catch (err) {
                console.warn("[PB Inline Search] Falló la inicialización; se omitió:", err);
            }
        }, 800);
    }

    // Ctrl + F：聚焦第一个搜索框
    document.addEventListener("keydown", function(e) {
        var key = String(e.key || "").toLowerCase();

        if (key === "escape") {
            pbHideCartImagePreview();
        }

        if ((e.ctrlKey || e.metaKey) && key === "f") {
            var input = document.querySelector(".pb-inline-order-search input");

            if (input) {
                e.preventDefault();
                e.stopPropagation();
                input.focus();
                input.select();
                return false;
            }
        }
    }, true);

    // 点击付款、验证或页面内任何控件时，立即关闭悬浮预览。
    // pointerdown发生在Odoo切换页面之前，因此即使原图片节点马上被移除也不会残留。
    document.addEventListener("pointerdown", pbHideCartImagePreview, true);
    document.addEventListener("mousedown", pbHideCartImagePreview, true);
    document.addEventListener("touchstart", pbHideCartImagePreview, true);

    window.addEventListener("blur", pbHideCartImagePreview);
    window.addEventListener("pagehide", pbHideCartImagePreview);
    document.addEventListener("visibilitychange", function() {
        if (document.hidden) pbHideCartImagePreview();
    });

    // 点一键全单退款前，自动清空搜索，避免隐藏行影响退款模拟点击
    document.addEventListener("click", function(e) {
        if (e.target.closest("#pb-refund-all-btn")) {
            pbClearAllSearches();
        }
    }, true);

    PBUI.subscribe(() => {
        document.querySelectorAll(".pb-inline-order-search").forEach(bar => {
            const input=bar.querySelector("input"),clear=bar.querySelector(".pb-inline-search-clear");
            if(input) input.placeholder=pbUiText("搜索商品 / SKU / 颜色","Buscar producto / SKU / color");
            if(clear) clear.title=pbUiText("清除搜索","Limpiar búsqueda");
            const select=bar.querySelector(".pb-cart-preview-size");
            if(select) {
                select.title=pbUiText("选择图片预览大小","Elegir tamaño de ampliación de imagen");
                select.setAttribute("aria-label",select.title);
                const labels={normal:pbUiText("预览：普通","Ampliar: normal"),large:pbUiText("预览：大","Ampliar: grande"),xlarge:pbUiText("预览：特大","Ampliar: extra grande")};
                for(const option of select.options) option.textContent=labels[option.value]||option.textContent;
            }
        });
        pbSyncTypeGroupingToggles();
        pbProcessInlineSearchBars();
    });
    if (document.readyState === "complete") {
        setTimeout(pbWaitForPosThenStart, 1000);
    } else {
        window.addEventListener("load", function() {
            setTimeout(pbWaitForPosThenStart, 1000);
        });
    }
})();
})();
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once:true}); else start();
}

{
const start = () => {
(function () {
// Versión de interfaz es-MX preparada para Playbox. No active a la vez esta versión y la versión china de la misma función.

(function() {
    'use strict';

    // =========================================================================
    // 第一部分：全局 CSS 视效注入
    // =========================================================================
    const style = document.createElement('style');
    style.innerHTML = `
        .orderline {
            border-bottom: 1px solid #f1f5f9 !important;
            border-left: none !important;
            box-shadow: none !important;
            transition: background-color 0.15s ease;
        }
        .orderline::before {
            display: none !important;
        }
        .orderline.selected {
            background-color: #e8f2ff !important;
            border-left: none !important;
            box-shadow: none !important;
        }
        .orderline.selected .product-name,
        .orderline.selected .product-price,
        .orderline.selected .qty {
            color: #0f172a !important;
            font-weight: 700 !important;
        }
        .pos-mini-stock-display {
            font-size: 12px !important;
            margin-top: 5px;
            margin-left: 18px;
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            font-weight: 500 !important;
            line-height: 1.3 !important;
            width: 96%;
            -webkit-font-smoothing: antialiased;
            text-rendering: optimizeLegibility;
        }
        /* 自动序号的独特排版 */
        .pb-seq-num {
            color: #334155 !important;
            background: #f1f5f9 !important;
            border: 1px solid #cbd5e1 !important;
            font-weight: 800 !important;
            font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif !important;
            font-variant-numeric: tabular-nums !important;
            font-size: 11.5px !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            height: 20px !important;
            min-width: 34px !important;
            padding: 1px 6px !important;
            border-radius: 6px !important;
            margin-right: 6px !important;
            flex-shrink: 0 !important;
            user-select: none !important;
        }
        .orderline.selected .pb-seq-num {
            color: #ffffff !important;
            background: #2563eb !important;
            border-color: #1d4ed8 !important;
        }
    `;
    document.head.appendChild(style);

    // =========================================================================
    // 第二部分：数据字典与映射表
    // =========================================================================
    var FULL_NAME_MAP = {
        "PLAYBOX ELECTRONICS PEDIDO 31": "PD31", "PEDIDO 31": "PD31",
        "PLAYBOX ELECTRONICS 12 TOTAL": "PB12", "PLAYBOX ELECTRONICS 12": "PB12", "PB12": "PB12",
        "PLAYBOX ELECTRONICS BODEGA 12": "BP12", "BODEGA 12": "BP12", "BP12": "BP12",
        "PLAYBOX ELECTRONICS 1HORA BODEGA 27": "BP27", "1HORA BODEGA 27": "BP27", "BODEGA 27": "BP27", "BP27": "BP27",
        "PLAYBOX ELECTRONICS 1HORA 27": "HR27", "1HORA 27": "HR27", "HR27": "HR27",
        "PLAYBOX ELECTRONICS 14": "PB14", "PB14": "PB14",
        "PLAYBOX ELECTRONICS 1HORA 31": "HR31", "1HORA 31": "HR31", "HR31": "HR31",
        "PLAYBOX ELECTRONICS BODEGA 31": "BG31P", "BODEGA 31": "BG31P", "BG31P": "BG31P",
        "PLAYBOX ELECTRONICS CUBA 63": "CB63", "CUBA 63": "CB63", "CB63": "CB63"
    };

    var FULL_COLOR_MAP = {
        "PD31": "#7F8C8D", "PB12": "#27AE60", "BP12": "#2ECC71",
        "HR27": "#8E44AD", "BP27": "#9B59B6", "PB14": "#2980B9",
        "HR31": "#BA4A00", "BG31P": "#E74C3C", "CB63": "#E67E22"
    };

    var CART_TARGET_LIST = ["HR27", "BP27", "BG31P", "CB63"];

    const VARIANT_COLOR_MAP = {
        'AZUL CLARO':    { color: '#00a8ff', weight: 'bolder' }, '浅蓝色':     { color: '#00a8ff', weight: 'bolder' },
        'AZUL':          { color: '#0055ff', weight: 'bolder' }, '蓝色':       { color: '#0055ff', weight: 'bolder' },
        'MARINO':        { color: '#0033aa', weight: 'bolder' }, '深蓝色':     { color: '#0033aa', weight: 'bolder' },
        'LILA MORADO':   { color: '#8c11f7', weight: 'bold' },   '紫色':       { color: '#8c11f7', weight: 'bold' },
        'MORADO PASTEL': { color: '#cca7ee', weight: 'bold' },   '浅紫色':     { color: '#cca7ee', weight: 'bold' },
        'MAGENTA':       { color: '#e056fd', weight: 'bold' },   '玫红色':     { color: '#e056fd', weight: 'bold' },
        'BLANCO':        { color: '#444444', bg: '#f1f2f6', border: '1px solid #ced6e0', padding: '1px 5px', radius: '4px', weight: 'bold' },
        '白色':           { color: '#444444', bg: '#f1f2f6', border: '1px solid #ced6e0', padding: '1px 5px', radius: '4px', weight: 'bold' },
        'VERDE':         { color: '#2ed573', weight: 'bold' },   '绿色':       { color: '#2ed573', weight: 'bold' },
        'ORO':           { color: '#c59b27', weight: 'bold' },   '金色':       { color: '#c59b27', weight: 'bold' },
        'NEGRO':         { color: '#000000', weight: 'bolder' }, '黑色':       { color: '#000000', weight: 'bolder' },
        'GRIS':          { color: '#747d8c', weight: 'bold' },   '灰色':       { color: '#747d8c', weight: 'bold' },
        'ROJO':          { color: '#ff4757', weight: 'bolder' }, '红色':       { color: '#ff4757', weight: 'bolder' },
        'ROSA':          { color: '#ff6b81', weight: 'bold' },   '粉色':       { color: '#ff6b81', weight: 'bold' }
    };

    // =========================================================================
    // 第三部分：底层通讯与缓存控制
    // =========================================================================
    var stockRpcCache = {};
    var specRpcCache = {};
    var fetchingIds = {};
    var activeOrderUid = null;

    async function callOdoo(model, method, args, kwargs, signal) {
        args = args || []; kwargs = kwargs || {};
        let csrf = "";
        if (typeof odoo !== 'undefined' && odoo.csrf_token) { csrf = odoo.csrf_token; }
        else { var metaEl = document.querySelector('meta[name="csrf_token"]'); if (metaEl) csrf = metaEl.getAttribute("content"); }
        var payload = { jsonrpc: "2.0", method: "call", params: { model: model, method: method, args: args, kwargs: kwargs }, id: Date.now() };
        var resp = await fetch('/web/dataset/call_kw/' + model + '/' + method, {
            method: "POST", headers: { "Content-Type": "application/json", "X-CSRFToken": csrf },
            body: JSON.stringify(payload), credentials: "same-origin", signal: signal
        });
        var json = await resp.json();
        if (json.error) throw new Error("RPC Error");
        return json.result;
    }

    function getCurrentOrderKey() {
        var pos = window.posmodel || window.pos;
        if (!pos) return null;
        var order = (typeof pos.get_order === 'function') ? pos.get_order() : pos.selectedOrder;
        if (!order) return null;
        return order.uid || order.name || order.uuid || null;
    }

    function checkOrderLifecycle() {
        var currentKey = getCurrentOrderKey();
        if (currentKey && activeOrderUid !== null && currentKey !== activeOrderUid) {
            stockRpcCache = {}; fetchingIds = {}; cartCacheEpoch++; cartRetryAfter.clear();
        }
        if (currentKey) activeOrderUid = currentKey;
    }

    document.addEventListener('click', function(e) {
        var btn = e.target.closest('button, .button, .btn');
        if (!btn) return;
        var text = btn.textContent || "";
        var textNorm = String(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        var shouldClearCache =
            btn.classList.contains('validation') ||
            btn.classList.contains('next') ||
            btn.classList.contains('neworder-button') ||
            text.indexOf('下一') !== -1 ||
            text.indexOf('新订单') !== -1 ||
            text.indexOf('验证') !== -1 ||
            text.indexOf('付款') !== -1 ||
            text.indexOf('支付') !== -1 ||
            textNorm.indexOf('validate') !== -1 ||
            textNorm.indexOf('validation') !== -1 ||
            textNorm.indexOf('next') !== -1 ||
            textNorm.indexOf('new order') !== -1 ||
            textNorm.indexOf('payment') !== -1 ||
            textNorm.indexOf('pay') !== -1 ||
            textNorm.indexOf('validar') !== -1 ||
            textNorm.indexOf('validacion') !== -1 ||
            textNorm.indexOf('siguiente') !== -1 ||
            textNorm.indexOf('nuevo pedido') !== -1 ||
            textNorm.indexOf('nueva orden') !== -1 ||
            textNorm.indexOf('nuevo') !== -1 ||
            textNorm.indexOf('pago') !== -1 ||
            textNorm.indexOf('pagar') !== -1 ||
            textNorm.indexOf('cobrar') !== -1;

        if (shouldClearCache) {
            stockRpcCache = {};
            fetchingIds = {};
            cartCacheEpoch++; cartRetryAfter.clear();
        }
    }, true);

    function normalizeLocationName(name) { return String(name || "").toUpperCase().replace(/\s+/g, " ").replace(/\//g, " ").replace(/-/g, " ").trim(); }
    function detectWarehouseCode(locName) {
        var name = normalizeLocationName(locName);
        if (name.includes("1HORA") && name.includes("BODEGA") && name.includes("27")) return "BP27";
        if (name.includes("BODEGA") && name.includes("31")) return "BG31P";
        if (name.includes("CUBA") && name.includes("63")) return "CB63";
        if (name.includes("PEDIDO") && name.includes("31")) return "PD31";
        if (name.includes("BODEGA") && name.includes("12")) return "BP12";
        if (name.includes("1HORA") && name.includes("27")) return "HR27";
        if (name.includes("1HORA") && name.includes("31")) return "HR31";
        if (name.includes("14")) return "PB14";
        if (name.includes("12")) return "PB12";
        var mapKeys = Object.keys(FULL_NAME_MAP).sort(function(a, b) { return b.length - a.length; });
        for (var i = 0; i < mapKeys.length; i++) {
            var key = normalizeLocationName(mapKeys[i]);
            if (name.includes(key)) return FULL_NAME_MAP[mapKeys[i]];
        }
        return null;
    }

    function parseQuantsToDict(quants) {
        var res = {};
        quants.forEach(function(q) {
            var locName = (q.location_id && q.location_id[1]) ? q.location_id[1] : "";
            var qty = (q.available_quantity !== undefined) ? q.available_quantity : q.quantity;
            var code = detectWarehouseCode(locName);
            if (code) res[code] = (res[code] || 0) + qty;
        });
        return res;
    }

    async function fetchProductSpecByPid(pid) {
        if (specRpcCache[pid] !== undefined) return specRpcCache[pid];
        try {
            var prod = await callOdoo("product.product", "read", [[pid], ["uom_ids"]]);
            if (!prod || !prod.length || !prod[0].uom_ids || !prod[0].uom_ids.length) { specRpcCache[pid] = ""; return ""; }
            var uoms = await callOdoo("uom.uom", "read", [prod[0].uom_ids, ["name"]]);
            var names = (uoms || []).map(function(u) { return u.name; }).filter(Boolean);
            var resultStr = names.join(" / ");
            specRpcCache[pid] = resultStr;
            return resultStr;
        } catch(e) { specRpcCache[pid] = ""; return ""; }
    }

    function renderCartBadges(mainColEl, stockDict, specText) {
        // The unit module creates the final shared metadata row before stock
        // requests finish. Render there immediately so the badge is never
        // painted on a lower row and then reparented beside the unit control.
        var metadata = mainColEl.querySelector(':scope > .pb-cart-unit-meta');
        var host = metadata || mainColEl;
        var container = mainColEl.querySelector('.pos-mini-stock-display');
        if (!container) {
            container = document.createElement('div');
            container.className = "pos-mini-stock-display";
            host.appendChild(container);
        } else if (metadata && container.parentElement !== metadata) {
            metadata.appendChild(container);
        }
        var html = "";
        if (specText) {
            var specStyle = "color: #2563EB !important; font-size: 11.5px !important; font-family: -apple-system, BlinkMacSystemFont, sans-serif !important; padding: 1px 6px; border: 1px solid #2563EB44; border-radius: 4px; background: #2563EB14; display: inline-flex; align-items: center; font-weight: normal;";
            html += '<span style="' + specStyle + '">' + specText + '</span>';
        }
        CART_TARGET_LIST.forEach(function(code) {
            var qty = (stockDict[code] !== undefined) ? Math.round(stockDict[code]) : 0;
            if (qty === 0) return;
            var color = FULL_COLOR_MAP[code] || "#7F8C8D";
            var boxStyle = "color: " + color + " !important; font-size: 12px !important; font-family: -apple-system, BlinkMacSystemFont, sans-serif !important; padding: 1px 6px; border: 1px solid " + color + "44; border-radius: 4px; background: " + color + "14; display: inline-flex; align-items: baseline; letter-spacing: 0.2px;";
            var numStyle = "font-weight: normal !important; margin-left: 3px; font-size: 12.5px !important; font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif !important; letter-spacing: 1px;";
            html += '<span style="' + boxStyle + '">' + code + ':<b style="' + numStyle + '">' + qty + '</b></span>';
        });
        if (container.innerHTML !== html) container.innerHTML = html;
    }

    var globalPidMap = {}; var fetchingPidLocks = {};
    async function resolvePidAsync(nameSpan) {
        var clone = nameSpan.cloneNode(true);
        var smallText = "";
        clone.querySelectorAll('small').forEach(function(s) { smallText += s.textContent.replace(/^-/, '').trim(); s.remove(); });
        var searchBase = clone.textContent.replace(/<br>/g, '').trim().toUpperCase().replace(/\s+/g, '');
        var searchVar = smallText.toUpperCase().replace(/\s+/g, '');
        var cacheKey = searchBase + "|||" + searchVar;
        if (globalPidMap[cacheKey] !== undefined) return globalPidMap[cacheKey];
        if (fetchingPidLocks[cacheKey]) return null;
        fetchingPidLocks[cacheKey] = true;
        var pos = window.posmodel || window.pos;
        function isMatch(dbName, dbDisp) {
            var dName = (dbName || "").toUpperCase().replace(/\s+/g, '');
            var dDisp = (dbDisp || "").toUpperCase().replace(/\[.*?\]\s*/g, '').replace(/\s+/g, '');
            if (dName === searchBase || dDisp.indexOf(searchBase) !== -1) {
                if (searchVar) return dDisp.indexOf(searchVar) !== -1;
                return true;
            }
            return false;
        }
        if (pos && pos.db && pos.db.product_by_id) {
            for (var id in pos.db.product_by_id) {
                if (isMatch(pos.db.product_by_id[id].name, pos.db.product_by_id[id].display_name)) {
                    globalPidMap[cacheKey] = parseInt(id); fetchingPidLocks[cacheKey] = false; return parseInt(id);
                }
            }
        }
        try {
            var domain = ["|", ["name", "ilike", clone.textContent.replace(/<br>/g, '').trim()], ["default_code", "ilike", clone.textContent.replace(/<br>/g, '').trim()]];
            var prods = await callOdoo("product.product", "search_read", [domain, ["id", "name", "display_name"]]);
            if (Array.isArray(prods)) {
                for (var i = 0; i < prods.length; i++) {
                    if (isMatch(prods[i].name, prods[i].display_name)) {
                        globalPidMap[cacheKey] = prods[i].id; fetchingPidLocks[cacheKey] = false; return prods[i].id;
                    }
                }
            }
        } catch (e) {}
        globalPidMap[cacheKey] = null; fetchingPidLocks[cacheKey] = false; return null;
    }

    var cartExactProducts = new Map();
    var cartProductsByLineUuid = new Map();
    var cartCacheEpoch = 0;
    var cartBatchBusy = false;
    var cartBatchRerun = false;
    var cartRetryAfter = new Map();
    var cartStockFrame = null;
    var cartResolvedRows = new WeakMap();
    function scheduleCartStockRefresh() {
        if (cartStockFrame !== null || document.hidden) return;
        cartStockFrame = requestAnimationFrame(function() { cartStockFrame = null; updateCartStocks(); });
    }
    function indexCartProducts() {
        cartExactProducts = new Map();
        cartProductsByLineUuid = new Map();
        var pos = window.posmodel || window.pos;
        var order = pos && (typeof pos.get_order === 'function' ? pos.get_order() : pos.selectedOrder);
        var lines = order && (typeof order.get_orderlines === 'function' ? order.get_orderlines() : order.lines) || [];
        Array.from(lines).forEach(function(line) {
            var p = line.get_product ? line.get_product() : line.product_id;
            if (!p || !p.id) return;
            if (line.uuid) cartProductsByLineUuid.set(String(line.uuid), p.id);
            [p.name, p.display_name].filter(Boolean).forEach(function(name) {
                if (!cartExactProducts.has(name)) cartExactProducts.set(name, new Set());
                cartExactProducts.get(name).add(p.id);
            });
        });
    }
    function getPidByDomRow(lineEl, cleanName) {
        // Unit module attaches native order-line UUID classes. Prefer that
        // identity over fuzzy name matching, especially for color variants.
        if (!lineEl.closest('.ticket-screen')) {
            var uuidClass = Array.from(lineEl.classList).find(function(name) { return name.startsWith('pbcu-'); });
            var identified = uuidClass && cartProductsByLineUuid.get(uuidClass.slice(5));
            if (identified) return identified;
        }
        var exact = cartExactProducts.get(cleanName);
        if (!lineEl.closest('.ticket-screen') && exact && exact.size === 1) return exact.values().next().value;
        var pos = window.posmodel || window.pos;
        if (!pos) return null;
        var order = (typeof pos.get_order === 'function') ? pos.get_order() : pos.selectedOrder;
        if (order) {
            var lines = (typeof order.get_orderlines === 'function') ? order.get_orderlines() : (order.lines || []);
            var rowFullText = lineEl.textContent || "";
            var fallbackId = null;
            for (var i = 0; i < lines.length; i++) {
                var p = lines[i].get_product ? lines[i].get_product() : lines[i].product_id;
                if (!p) continue;
                var baseName = p.name || "";
                var dispName = p.display_name || baseName;
                if (baseName === cleanName || dispName.indexOf(cleanName) !== -1 || cleanName.indexOf(baseName) !== -1) {
                    var variantMatch = dispName.match(/\((.*?)\)/);
                    if (variantMatch && variantMatch[1]) {
                        if (rowFullText.indexOf(variantMatch[1].trim()) !== -1) { return p.id; }
                    } else { return p.id; }
                    if (!fallbackId) fallbackId = p.id;
                }
            }
            if (fallbackId) return fallbackId;
        }
        var dbP = (pos.db && pos.db.product_by_id) ? pos.db.product_by_id : {};
        for (var id in dbP) {
            if (dbP[id].display_name === cleanName || dbP[id].name === cleanName) { return parseInt(id); }
        }
        return null;
    }

    async function cartReadRpc(model, method, args) {
        var controller = new AbortController();
        var timeout = setTimeout(function() { controller.abort(); }, 12000);
        try { return await callOdoo(model, method, args, {}, controller.signal); }
        finally { clearTimeout(timeout); }
    }
    async function readCartSpecs(ids) {
        if (!ids.length) return new Map();
        var products = await cartReadRpc('product.product', 'read', [ids, ['id', 'uom_ids']]);
        var unitIds = Array.from(new Set(products.flatMap(function(p) { return p.uom_ids || []; })));
        var units = unitIds.length ? await cartReadRpc('uom.uom', 'read', [unitIds, ['id', 'name']]) : [];
        var names = new Map(units.map(function(unit) { return [unit.id, unit.name]; }));
        var result = new Map(ids.map(function(id) { return [id, '']; }));
        products.forEach(function(p) { result.set(p.id, (p.uom_ids || []).map(function(id) { return names.get(id); }).filter(Boolean).join(' / ')); });
        return result;
    }
    async function loadCartBatches(pending, stockWanted, epoch) {
        try {
            for (var offset = 0; offset < pending.length && epoch === cartCacheEpoch; offset += 40) {
                var ids = pending.slice(offset, offset + 40);
                var stockIds = ids.filter(function(id) { return stockWanted.has(id) && (!stockRpcCache[id] || Date.now() - stockRpcCache[id].time >= 30000); });
                var specIds = ids.filter(function(id) { return specRpcCache[id] === undefined; });
                ids.forEach(function(id) { fetchingIds[id] = true; });
                var results = await Promise.allSettled([
                    stockIds.length ? cartReadRpc('stock.quant', 'search_read', [[['product_id', 'in', stockIds], ['location_id.usage', '=', 'internal']], ['product_id', 'location_id', 'quantity', 'available_quantity']]) : Promise.resolve(null),
                    readCartSpecs(specIds)
                ]);
                if (epoch !== cartCacheEpoch) break;
                if (results[0].status === 'fulfilled' && results[0].value !== null) {
                    var quants = new Map(stockIds.map(function(id) { return [id, []]; }));
                    results[0].value.forEach(function(q) { var id = Array.isArray(q.product_id) ? q.product_id[0] : q.product_id; if (quants.has(id)) quants.get(id).push(q); });
                    quants.forEach(function(rows, id) { stockRpcCache[id] = { data: parseQuantsToDict(rows), time: Date.now() }; });
                }
                if (results[1].status === 'fulfilled') results[1].value.forEach(function(text, id) { specRpcCache[id] = text; });
                var failed = results.some(function(result) { return result.status === 'rejected'; });
                ids.forEach(function(id) { delete fetchingIds[id]; if (failed) cartRetryAfter.set(id, Date.now() + 5000); else cartRetryAfter.delete(id); });
                scheduleCartStockRefresh();
            }
        } finally {
            cartBatchBusy = false;
            if (cartBatchRerun || epoch !== cartCacheEpoch) { cartBatchRerun = false; scheduleCartStockRefresh(); }
        }
    }
    function updateCartStocks() {
        if (document.hidden) return;
        indexCartProducts();
        var pending = new Set();
        var stockWanted = new Set();
        document.querySelectorAll('.order-container .orderline').forEach(function(lineEl) {
            var mainColEl = lineEl.querySelector('.d-flex.flex-column');
            var nameSpan = lineEl.querySelector('.product-name .text-wrap');
            if (!mainColEl || !nameSpan) return;
            var cleanName = nameSpan.textContent.split('\n')[0].replace(/<br>/g, '').trim();
            if (!cleanName) return;
            var pid = getPidByDomRow(lineEl, cleanName);
            var prior = cartResolvedRows.get(lineEl);
            if (!pid && prior && prior.name === cleanName && prior.epoch === cartCacheEpoch) pid = prior.id;
            if (!pid) {
                var lookupEpoch = cartCacheEpoch;
                resolvePidAsync(nameSpan).then(function(id) {
                    if (id && lineEl.isConnected && lookupEpoch === cartCacheEpoch && nameSpan.textContent.split('\n')[0].replace(/<br>/g, '').trim() === cleanName) {
                        cartResolvedRows.set(lineEl, { id: id, name: cleanName, epoch: lookupEpoch }); scheduleCartStockRefresh();
                    }
                });
                return;
            }
            var history = Boolean(lineEl.closest('.ticket-screen'));
            var stock = stockRpcCache[pid];
            var hasSpec = specRpcCache[pid] !== undefined;
            // Retain the last successful badge while refreshing; a network failure is not zero stock.
            if (history || stock || hasSpec) renderCartBadges(mainColEl, history ? {} : (stock ? stock.data : {}), hasSpec ? specRpcCache[pid] : '');
            var needsStock = !history && (!stock || Date.now() - stock.time >= 30000);
            if ((needsStock || !hasSpec) && Date.now() >= (cartRetryAfter.get(pid) || 0)) { pending.add(pid); if (needsStock) stockWanted.add(pid); }
        });
        if (!pending.size) return;
        if (cartBatchBusy) { cartBatchRerun = true; return; }
        cartBatchBusy = true;
        loadCartBatches(Array.from(pending), stockWanted, cartCacheEpoch).catch(function(error) { console.warn('[PB Stock] No se pudo actualizar el lote', error); });
    }

    function updateRowSequences() {
        document.querySelectorAll('.order-container').forEach(container => {
            let index = 1;
            container.querySelectorAll('.orderline').forEach(line => {
                let nameContainer = line.querySelector('.product-name');
                if (!nameContainer) return;
                let seqEl = nameContainer.querySelector('.pb-seq-num');
                if (!seqEl) {
                    seqEl = document.createElement('span');
                    seqEl.className = 'pb-seq-num';
                    nameContainer.insertBefore(seqEl, nameContainer.firstChild);
                }
                let targetText = String(index).padStart(2, "0") + " ";
                if (seqEl.textContent !== targetText) { seqEl.textContent = targetText; }
                index++;
            });
        });
    }

    const variantColorKeys = Object.keys(VARIANT_COLOR_MAP).sort((a, b) => b.length - a.length);
    function renderVariantColors() {
        const elements = document.querySelectorAll('.attribute-line.fst-italic');
        // Live Odoo attributes are plain single-line text. Keep innerText for
        // nested/whitespace-sensitive structures; never globally replace it.
        const texts = Array.from(elements, el => {
            const raw = el.textContent || "";
            const simple = el.childElementCount === 0 && !/[\t\r\n]| {2}/.test(raw);
            return [el, (simple ? raw : el.innerText).toUpperCase()];
        });
        texts.forEach(([el, text]) => {
            if (el.getAttribute('data-color-rendered') === text) return;
            el.style = "";
            for (let key of variantColorKeys) {
                if (text.includes(key)) {
                    const cfg = VARIANT_COLOR_MAP[key];
                    el.style.color = cfg.color;
                    if (cfg.bg) el.style.backgroundColor = cfg.bg;
                    if (cfg.border) el.style.border = cfg.border;
                    if (cfg.padding) el.style.padding = cfg.padding;
                    if (cfg.radius) el.style.borderRadius = cfg.radius;
                    if (cfg.weight) el.style.fontWeight = cfg.weight;
                    el.style.display = 'inline-block';
                    break;
                }
            }
            el.setAttribute('data-color-rendered', text);
        });
    }

    // =========================================================================
    // 💡 升级版详细库存处理：染色 + 文字精确替换（完美搞定详细库存里的 disponible/可用）
    // =========================================================================
    function processInventoryPopups() {
        var rows = document.querySelectorAll('.section-inventory-body > div, .accordion-content .d-flex.gap-2');
        rows.forEach(function(row) {
            if (row.getAttribute('data-colors-done') === '1') return;
            var nameDiv = row.querySelector('div:first-child');
            if (!nameDiv) return;

            // 1. 遍历该行下面所有的字块（保留数字 span 标签的同时替换文字）
            row.childNodes.forEach(function(child) {
                if (child.nodeType !== 1) return; // 确保是元素节点
                let html = child.innerHTML || "";
                let changed = false;

                if (html.indexOf('pronosticado') !== -1 && html.indexOf('Pieza') === -1) {
                    html = html.replace(/pronosticado/g, 'Pieza pronosticado');
                    changed = true;
                }
                // Preserve native quantity labels: available stock is not on-hand stock.

                if (changed) {
                    child.innerHTML = html;
                }
            });

            // 2. 识别仓库代码并上色
            var rawName = nameDiv.textContent.replace(':', '').trim();
            var shortName = detectWarehouseCode(rawName);
            if (shortName) {
                var color = FULL_COLOR_MAP[shortName] || "#7F8C8D";
                nameDiv.textContent = shortName + " : ";
                row.style.cssText = "color: " + color + " !important; font-weight: normal !important; white-space: normal !important; word-break: break-word !important;";
                row.querySelectorAll('span').forEach(function(span) {
                    span.style.color = color + " !important";
                    span.style.fontSize = "15px !important";
                    span.style.fontWeight = "normal !important";
                });
            }

            // 3. 终极锁：处理过一次立刻锁死，绝对不引发卡死死循环！
            row.setAttribute('data-colors-done', '1');
        });
    }

    // =========================================================================
    // 💡 顶部大字修复：专注解决顶部摘要行里的 “Disponible / 可用”
    // =========================================================================
    // =========================================================================
    // 第六部分：监听器与定时线程驱动
    // =========================================================================
    var inventoryDomFrame = null;
    var INVENTORY_ADDON_SELECTOR = '.pos-mini-stock-display,.pb-seq-num,.pb-type-group-label,.pb-cart-product-image,.pb-inline-order-search,.pb-cart-unit-toolbar';
    function inventoryOwnMutation(mutation) {
        var target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
        if (target && target.closest(INVENTORY_ADDON_SELECTOR)) return true;
        var nodes = Array.from(mutation.addedNodes || []).concat(Array.from(mutation.removedNodes || []));
        return nodes.length > 0 && nodes.every(function(node) { return node.nodeType === 1 && node.matches(INVENTORY_ADDON_SELECTOR); });
    }
    function scheduleInventoryDomRefresh() {
        if (inventoryDomFrame !== null || document.hidden) return;
        inventoryDomFrame = requestAnimationFrame(function() {
            inventoryDomFrame = null;
            checkOrderLifecycle();
            document.querySelectorAll('.orderline').forEach(function(lineEl) {
                var nameSpan = lineEl.querySelector('.product-name .text-wrap');
                if (!nameSpan) return;
                var text = nameSpan.textContent.trim();
                if (lineEl.dataset.lastCheckedText !== text) {
                    var badge = lineEl.querySelector('.pos-mini-stock-display'); if (badge) badge.remove();
                    lineEl.dataset.lastCheckedText = text;
                }
            });
            renderVariantColors(); processInventoryPopups(); updateRowSequences();
            updateCartStocks();
        });
    }
    const domObserver = new MutationObserver(function(records) {
        if (records.some(function(record) { return !inventoryOwnMutation(record); })) scheduleInventoryDomRefresh();
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
    // MutationObserver owns DOM decoration. The timer only maintains
    // order lifecycle and the existing 30-second stock freshness policy.
    setInterval(function() {
        if (document.hidden) return;
        checkOrderLifecycle();
    }, 1000);
    // New rows refresh through the observer; a five-second check keeps cached
    // stock within 30-35 seconds without scanning the whole cart each second.
    setInterval(function() { if (!document.hidden) updateCartStocks(); }, 5000);
    document.addEventListener('visibilitychange', function() { if (!document.hidden) scheduleInventoryDomRefresh(); });
    scheduleInventoryDomRefresh();

    console.log('--- Asistente Odoo POS v7.11 activado ---');
})();
})();
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once:true}); else start();
}

{
const start = () => {
(function () {
(function () {
"use strict";
  // =========================
  // 全局状态控制
  // =========================
  let isSyncing = false;
  let lastPricelistName = null;

  // =========================
  // UI 核心代码
  // =========================
  let pbModalRoot = null;
  let pbCurrentModal = null;
  let pbModalResolve = null;
  let pbLoadingRoot = null;
  let pbLoadingCount = 0;

  function ensureModalDom() {
    if (pbModalRoot) return pbModalRoot;

    if (!document.getElementById("pb-pos-style")) {
      const style = document.createElement("style");
      style.id = "pb-pos-style";
      style.textContent = `
      :root {
        --pb-font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", Roboto, sans-serif;
        --pb-mono: "JetBrains Mono", "SF Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
        --pb-modal-bg: #0f172a;
        --pb-modal-surface: #1e293b;
        --pb-modal-border: rgba(148, 163, 184, 0.24);
        --pb-shadow: 0 24px 60px -12px rgba(2, 6, 23, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.08);
        --pb-text-main: #f8fafc;
        --pb-text-muted: #94a3b8;
        --pb-text-header: #cbd5e1;
        --pb-primary: #2563eb;
        --pb-primary-hover: #1d4ed8;
        --pb-success-text: #34d399;
        --pb-danger-text: #fb7185;
      }
      .control-buttons { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .control-buttons > .more-btn { order: 99 !important; }
      #pb-cash-btn, #pb-pricelist-label { order: 2 !important; }

      #pb-pricelist-label {
          flex-shrink: 0 !important;
          min-width: fit-content !important;
          margin-left: 8px;
          font-family: var(--pb-font);
          font-size: 13px;
          font-weight: 700;
          padding: 7px 12px;
          border-radius: 8px;
          background: #eef2ff;
          color: #3730a3;
          border: 1px solid #c7d2fe;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          height: fit-content;
          align-self: center;
          white-space: nowrap;
          cursor: default;
      }
      #pb-pricelist-label:empty { display: none !important; }
      #pb-pricelist-icon { font-size: 13px; color: #4f46e5; }

      .pb-modal-overlay {
          position: fixed; inset: 0;
          background: rgba(15, 23, 42, 0.68);
          backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
          z-index: 999999;
          font-family: var(--pb-font);
          opacity: 0; visibility: hidden;
          transition: opacity 0.22s ease, visibility 0.22s ease;
      }
      .pb-modal-overlay.pb-visible { opacity: 1; visibility: visible; }
      .pb-modal-box {
          background: var(--pb-modal-bg);
          border: 1px solid var(--pb-modal-border);
          box-shadow: var(--pb-shadow);
          border-radius: 18px;
          width: 540px; max-width: 95vw;
          display: flex; flex-direction: column;
          transform: translateY(8px) scale(0.96);
          transition: transform 0.26s cubic-bezier(0.16, 1, 0.3, 1);
          overflow: hidden; max-height: 86vh;
          color: var(--pb-text-main);
      }
      .pb-modal-overlay.pb-visible .pb-modal-box { transform: translateY(0) scale(1); }
      .pb-modal-header {
          padding: 18px 24px 14px;
          display: flex; justify-content: space-between; align-items: center;
          border-bottom: 1px solid rgba(148, 163, 184, 0.16);
          background: #0f172a;
      }
      .pb-modal-title { font-size: 18px; font-weight: 700; color: #ffffff; letter-spacing: 0.2px; }
      .pb-modal-close {
          width: 34px; height: 34px;
          border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          font-family: Arial, sans-serif; font-size: 22px; line-height: 1;
          color: #94a3b8; background: rgba(255, 255, 255, 0.06);
          cursor: pointer;
          transition: background 0.18s ease, color 0.18s ease;
      }
      .pb-modal-close:hover { color: #ffffff; background: rgba(255, 255, 255, 0.14); }
      .pb-modal-body {
          padding: 0;
          font-size: 15px; font-weight: 500; line-height: 1.6;
          color: #f1f5f9;
          overflow-y: auto;
          scrollbar-width: thin;
      }
      .pb-message-content { padding: 22px 24px; color: #f1f5f9; font-size: 15px; font-weight: 500; white-space: pre-wrap; line-height: 1.65; }
      .pb-modal-footer {
          padding: 14px 24px 18px;
          display: flex; justify-content: flex-end; gap: 10px;
          border-top: 1px solid rgba(148, 163, 184, 0.14);
          background: #0f172a;
      }
      .pb-modal-btn {
          min-height: 40px; padding: 8px 20px;
          font-size: 14px; font-weight: 700;
          border-radius: 10px; cursor: pointer;
          border: 1px solid transparent;
          transition: all 0.18s ease;
          letter-spacing: 0.2px;
      }
      .pb-modal-btn:active { transform: scale(0.97); }
      .pb-modal-btn-primary {
          background: var(--pb-primary);
          color: #ffffff;
          border-color: var(--pb-primary);
      }
      .pb-modal-btn-primary:hover {
          background: var(--pb-primary-hover);
      }
      .pb-modal-btn-secondary {
          background: rgba(255, 255, 255, 0.08);
          color: #e2e8f0;
          border: 1px solid rgba(148, 163, 184, 0.28);
          font-weight: 600;
      }
      .pb-modal-btn-secondary:hover { background: rgba(255, 255, 255, 0.15); color: #ffffff; }
      .pb-loading-overlay {
          position: fixed; inset: 0;
          background: rgba(15, 23, 42, 0.62);
          backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          z-index: 1000000; opacity: 0; transition: opacity 0.2s ease; visibility: hidden;
      }
      .pb-loading-overlay.pb-visible { opacity: 1; visibility: visible; }
      .pb-loading-box {
          background: #0f172a;
          border: 1px solid rgba(148, 163, 184, 0.25);
          padding: 24px 36px; border-radius: 16px;
          box-shadow: 0 20px 45px rgba(0, 0, 0, 0.45);
          display: flex; flex-direction: column; align-items: center; gap: 14px;
          color: #f8fafc; font-weight: 600; font-size: 14px;
      }
      .pb-spinner {
          width: 32px; height: 32px; border-radius: 50%;
          border: 3px solid rgba(148, 163, 184, 0.22);
          border-top-color: #60a5fa;
          animation: pb-spin 0.75s infinite linear;
      }
      @keyframes pb-spin { to { transform: rotate(1turn); } }

      .pb-table-container { margin: 0; }
      .pb-table { width: 100%; border-collapse: collapse; font-size: 13.5px; font-weight: 400; text-align: left; }
      .pb-table th {
          padding: 11px 22px;
          color: var(--pb-text-header);
          font-weight: 700; font-size: 12px;
          text-transform: uppercase; letter-spacing: 0.4px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.22);
          position: sticky; top: 0; z-index: 10;
          background: #0f172a;
      }
      .pb-table td {
          padding: 11px 22px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.10);
          color: #f1f5f9; vertical-align: middle;
      }
      .pb-table tbody tr:nth-child(even) td { background: rgba(255, 255, 255, 0.02); }
      .pb-table tbody tr:hover td { background: rgba(59, 130, 246, 0.12); }
      .pb-col-date { white-space: nowrap; color: #94a3b8; font-family: var(--pb-mono); font-size: 12.5px; font-variant-numeric: tabular-nums; }
      .pb-amount-in {
          color: var(--pb-success-text) !important;
          font-weight: 700; font-family: var(--pb-mono);
          font-variant-numeric: tabular-nums;
          text-align: right;
      }
      .pb-amount-out {
          color: var(--pb-danger-text) !important;
          font-weight: 700; font-family: var(--pb-mono);
          font-variant-numeric: tabular-nums;
          text-align: right;
      }
      .pb-empty-state { text-align: center; padding: 42px 24px; color: #94a3b8; font-size: 14px; }

      #pb-cash-btn i { margin-right: 5px; }
      #pb-cash-btn.pb-floating {
          position: fixed; top: 8px; right: 300px; z-index: 9999;
          background: #ffffff;
          border: 1px solid #cbd5e1; color: #1e293b;
          padding: 6px 14px; border-radius: 999px; cursor: pointer;
          font-weight: 700; font-size: 12px;
          box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
          transition: all 0.2s ease; display: flex; align-items: center; gap: 6px;
      }
      #pb-cash-btn.pb-integrated i { margin-right: 5px; }
      `;
      document.head.appendChild(style);
    }

    pbModalRoot = document.createElement("div");
    pbModalRoot.className = "pb-modal-overlay";
    pbModalRoot.innerHTML = `
      <div class="pb-modal-box">
        <div class="pb-modal-header">
          <div class="pb-modal-title"></div>
          <div class="pb-modal-close" title="${pbUiText("关闭","Cerrar")}" aria-label="${pbUiText("关闭","Cerrar")}" role="button" tabindex="0">&times;</div>
        </div>
        <div class="pb-modal-body"></div>
        <div class="pb-modal-footer"></div>
      </div>
    `;
    document.body.appendChild(pbModalRoot);

    const closeBtn = pbModalRoot.querySelector(".pb-modal-close");
    const overlay = pbModalRoot;
    closeBtn.onclick = () => closeModal(null);
    closeBtn.onkeydown = event => {
      if(event.key==="Enter" || event.key===" ") { event.preventDefault();event.stopPropagation();closeModal(null); }
    };
    overlay.onclick = (e) => { if(e.target === overlay) closeModal(null); };
    overlay.addEventListener('keydown', event => {
      if (!overlay.classList.contains('pb-visible') || event.isComposing || event.keyCode === 229) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      if (event.key === 'Enter' && event.target?.matches?.('textarea,select,[contenteditable=true]')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.key === 'Escape') { closeModal(null); return; }
      const focused = event.target?.closest?.('button, .pb-modal-close');
      const button = focused && overlay.contains(focused) ? focused :
        overlay.querySelector('.pb-modal-footer .pb-modal-btn-primary');
      if (button && !button.disabled && !button.classList.contains('disabled')) button.click();
    }, true);
    for (const type of ['keyup', 'keypress']) overlay.addEventListener(type, event => {
      if (!event.isComposing && (event.key === 'Enter' || event.key === 'Escape')) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);

    return pbModalRoot;
  }

  function ensureLoadingDom() {
    if (pbLoadingRoot) return pbLoadingRoot;
    pbLoadingRoot = document.createElement("div");
    pbLoadingRoot.className = "pb-loading-overlay";
    pbLoadingRoot.innerHTML = `<div class="pb-loading-box"><div class="pb-spinner"></div><div>${pbUiText("处理中…","Procesando…")}</div></div>`;
    document.body.appendChild(pbLoadingRoot);
    return pbLoadingRoot;
  }

  PBUI.subscribe(() => {
    if(pbLoadingRoot) pbLoadingRoot.querySelector(".pb-loading-box > div:last-child").textContent=pbUiText("处理中…","Procesando…");
    if(!pbModalRoot) return;
    const close=pbModalRoot.querySelector(".pb-modal-close");
    close.title=pbUiText("关闭","Cerrar");close.setAttribute("aria-label",close.title);
    if(!pbCurrentModal) return;
    const {options,buttons}=pbCurrentModal;
    pbModalRoot.querySelector(".pb-modal-title").textContent=options.title||pbUiText("提示","Aviso");
    const message=pbModalRoot.querySelector(".pb-message-content");
    if(message) message.innerText=options.message||"";
    pbModalRoot.querySelectorAll(".pb-modal-footer button").forEach((button,index)=>{if(buttons[index])button.textContent=buttons[index].label;});
    pbModalRoot.querySelectorAll("[data-pb-static-zh]").forEach(node=>{node.textContent=pbUiText(node.getAttribute("data-pb-static-zh"),node.getAttribute("data-pb-static-es"));});
  });
  function showLoading() {
    const root = ensureLoadingDom();
    pbLoadingCount++;
    root.classList.add("pb-visible");
  }

  function hideLoading() {
    if (!pbLoadingRoot) return;
    pbLoadingCount = Math.max(0, pbLoadingCount - 1);
    if (pbLoadingCount === 0) {
      pbLoadingRoot.classList.remove("pb-visible");
    }
  }

  function closeModal(result) {
    if (!pbModalRoot) return;
    pbModalRoot.classList.remove("pb-visible");
    setTimeout(() => {
        if (pbModalResolve) {
          const r = pbModalResolve;
          pbModalResolve = null;
          r(result);
        }
    }, 300);
  }

  function showModal(options) {
    if (pbLoadingRoot) {
        pbLoadingCount = 0;
        pbLoadingRoot.classList.remove("pb-visible");
    }
    const root = ensureModalDom();
    root.querySelector(".pb-modal-title").textContent = options.title || pbUiPair("提示","Aviso");
    const bodyEl = root.querySelector(".pb-modal-body");
    bodyEl.innerHTML = '';

    if (options.html) {
        const container = document.createElement('div');
        container.className = 'pb-table-container';
        container.innerHTML = options.html;
        bodyEl.appendChild(container);
    } else {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'pb-message-content';
        msgDiv.innerText = options.message || "";
        bodyEl.appendChild(msgDiv);
    }

    const box = root.querySelector('.pb-modal-box');
    if (options.width) box.style.width = options.width;
    else box.style.width = '520px';

    const footerEl = root.querySelector(".pb-modal-footer");
    footerEl.innerHTML = "";
    const buttons = options.buttons || [{ label: pbUiPair("确定","Aceptar"), value: true, primary: true }];

    if (buttons.length === 1 && buttons[0].primary === undefined && buttons[0].danger === undefined) {
        buttons[0].primary = true;
    }

    pbCurrentModal = {options,buttons};
    buttons.forEach((btn) => {
      const b = document.createElement("button");
      b.type = "button";
      let btnClass = "pb-modal-btn";
      if (btn.danger) btnClass += " pb-modal-btn-danger";
      else if (btn.primary) btnClass += " pb-modal-btn-primary";
      else btnClass += " pb-modal-btn-secondary";
      b.className = btnClass;
      b.textContent = btn.label;
      b.onclick = () => closeModal(btn.value);
      footerEl.appendChild(b);
    });
    requestAnimationFrame(() => {
      root.classList.add("pb-visible");
      const focusTarget = root.querySelector('.pb-modal-footer .pb-modal-btn-primary') ||
        root.querySelector('.pb-modal-footer button') || root.querySelector('.pb-modal-close');
      focusTarget?.focus({ preventScroll: true });
    });
    return new Promise((resolve) => { pbModalResolve = resolve; });
  }

  function showAlert(message, title) { return showModal({ title: title || pbUiPair("系统提示","Aviso del sistema"), message, buttons: [{ label: pbUiPair("知道了","Entendido"), value: true, primary: true }] }); }
  function showConfirm(message, { title, confirmText, cancelText } = {}) { return showModal({ title: title || pbUiPair("请确认","Confirma"), message, buttons: [ { label: cancelText || pbUiPair("取消","Cancelar"), value: false }, { label: confirmText || pbUiPair("确定","Aceptar"), value: true, primary: true }, ], }); }
  function showChoice(message, choices, title) { return showModal({ title: title || pbUiPair("请选择操作","Elige una acción"), message, buttons: choices }); }

  async function callOdoo(model, method, args = [], kwargs = {}) {
    let csrf = typeof odoo !== 'undefined' && odoo.csrf_token ? odoo.csrf_token : "";
    if (!csrf) {
        const meta = document.querySelector('meta[name="csrf_token"]');
        if (meta) csrf = meta.getAttribute("content");
    }
    const payload = { jsonrpc: "2.0", method: "call", params: { model, method, args, kwargs }, id: Date.now() };
    const resp = await fetch(`/web/dataset/call_kw/${model}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-CSRFToken": csrf },
      body: JSON.stringify(payload), credentials: "same-origin",
    });
    const json = await resp.json();
    if (json.error) throw new Error(json.error.data?.message || JSON.stringify(json.error));
    return json.result;
  }

  async function withLoading(fn) {
    showLoading();
    try { return await fn(); } finally { hideLoading(); }
  }

  function isPosUiProductPage() {
      return /^\/pos\/ui/.test(window.location.pathname);
  }

  function isPaymentPage() {
      if (window.location.href.includes('/payment')) return true;
      if (document.querySelector('.payment-screen') && !document.querySelector('.payment-screen.oe_hidden')) return true;
      return false;
  }

  function getCurrentPricelistName() {
      try {
          const pos = window.posmodel;
          if (!pos) return "";
          let order = null;
          if (typeof pos.get_order === "function") order = pos.get_order();
          if (!order && pos.selectedOrder) order = pos.selectedOrder;
          if (!order) return "";
          const pl = order.pricelist_id;
          if (!pl) return "";
          return (pl.name || pl.display_name || "").toString().trim();
      } catch (e) { return ""; }
  }

  function updatePricelistLabel() {
      const container = document.querySelector(".control-buttons");
      if (!container) return;
      let tag = document.getElementById("pb-pricelist-label");
      let forceUpdate = false;
      if (!tag) {
          tag = document.createElement("span");
          tag.id = "pb-pricelist-label";
          const cashBtn = document.getElementById("pb-cash-btn");
          if (cashBtn) cashBtn.insertAdjacentElement("afterend", tag);
          else container.appendChild(tag);
          forceUpdate = true;
      } else if (tag.parentNode !== container) {
          container.appendChild(tag);
          forceUpdate = true;
      }
      const name = getCurrentPricelistName();
      if (!forceUpdate && name === lastPricelistName) {
          if (!name && tag.style.display !== "none") tag.style.display = "none";
          if (name && tag.style.display === "none") tag.style.display = "inline-flex";
          return;
      }
      lastPricelistName = name;
      if (name) {
          tag.innerHTML = `<i class="fa fa-tag" id="pb-pricelist-icon"></i> <span>${name}</span>`;
          tag.style.display = "inline-flex";
      } else {
          tag.innerHTML = "";
          tag.style.display = "none";
      }
  }

  // [核心修改] 增强清洗函数，专门处理空数组 []
  function getProductKeyFromModal(modal) {
    const titleEl = modal.querySelector("header.modal-header h3.section-title") || modal.querySelector("header.modal-header .modal-title");
    if (!titleEl) return null;
    const full = titleEl.textContent.replace(/\s+/g, " ").trim();
    if (!full) return null;
    const m = full.match(/\[([^\]]+)]/);
    if (m && m[1]) return { type: "code", value: m[1].trim() };
    const firstPart = full.split("|")[0];
    const name = firstPart ? firstPart.trim() : null;
    if (name) return { type: "name", value: name };
    return null;
  }

  const uomCache = {};

  async function getUomNamesByKey(keyInfo) {
    if (!keyInfo) return [];
    const cacheKey = keyInfo.type + ":" + keyInfo.value;
    if (uomCache[cacheKey]) return uomCache[cacheKey];
    let domain;
    if (keyInfo.type === "code") domain = [["default_code", "=", keyInfo.value]];
    else domain = ["|", "|", ["default_code", "=", keyInfo.value], ["name", "=", keyInfo.value], ["display_name", "=", keyInfo.value]];

    const products = await callOdoo("product.product", "search_read", [domain, ["id", "uom_ids"]], { limit: 1 });
    if (!products || !products.length) { uomCache[cacheKey] = []; return []; }
    const uids = products[0].uom_ids || [];
    if (!uids.length) { uomCache[cacheKey] = []; return []; }
    const uoms = await callOdoo("uom.uom", "read", [uids, ["name"]]);
    const names = (uoms || []).map((u) => u.name).filter(Boolean);
    uomCache[cacheKey] = names;
    return names;
  }

  async function injectSpec(modal) {
    if (!modal) return;
    if (modal.dataset.pbSpecDone === "1") return;
    modal.dataset.pbSpecDone = "1";
    const keyInfo = getProductKeyFromModal(modal);
    if (!keyInfo) return;
    let names;
    try { names = await getUomNamesByKey(keyInfo); } catch (e) { return; }
    if (!names || !names.length) return;
    const labelText = pbUiPair("规格","Presentaciones");
    const joined = names.join(" / ");
    const titleEl = modal.querySelector("header.modal-header h3.section-title") || modal.querySelector("header.modal-header .modal-title");
    if (titleEl) {
      const originalText = titleEl.getAttribute("data-pb-original-title") || titleEl.textContent.replace(/\s+/g, " ").trim();
      if (!titleEl.getAttribute("data-pb-original-title")) titleEl.setAttribute("data-pb-original-title", originalText);
      titleEl.dataset.pbSpecNames = joined;
      titleEl.textContent = `${originalText} | ${labelText}: ${joined}`;
    }
  }

  PBUI.subscribe(()=>{
    document.querySelectorAll("[data-pb-original-title][data-pb-spec-names]").forEach(node=>{
        node.textContent = node.getAttribute("data-pb-original-title")+" | "+pbUiText("规格","Presentaciones")+": "+node.dataset.pbSpecNames;
    });
  });
  const specObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches(".modal-content")) {
          const hasTitle = node.querySelector("header.modal-header h3.section-title") || node.querySelector("header.modal-header .modal-title");
          if (hasTitle) injectSpec(node);
        }
        if (node.querySelector) {
          const modals = node.querySelectorAll(".modal-content");
          modals.forEach((modal) => {
            const hasTitle = modal.querySelector("header.modal-header h3.section-title") || modal.querySelector("header.modal-header .modal-title");
            if (hasTitle) injectSpec(modal);
          });
        }
      }
    }
  });

  try {
      if(document.body) specObserver.observe(document.body, { childList: true, subtree: true });
      else window.addEventListener("DOMContentLoaded", () => { specObserver.observe(document.body, { childList: true, subtree: true }); });
      console.log("📦 商品规格标题栏展示已启用（双重保障模式）");
  } catch (e) { console.warn("规格监听启动失败:", e); }


  const displayTick = () => { if (!document.hidden) { ensureModalDom(); updatePricelistLabel(); } };
  setInterval(displayTick, 1000); displayTick();

})();

})();
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once:true}); else start();
}

})();

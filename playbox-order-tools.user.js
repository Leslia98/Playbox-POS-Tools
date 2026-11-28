// ==UserScript==
// @name         Playbox Odoo - 订单工具
// @namespace    https://playboxelectronics1.odoo.com/playbox-suite
// @version      1.0.17
// @description  订单工具；定向修复候选，已通过本地回归，待安装后组合验收。
// @author       Playbox
// @run-at       document-start
// @match        https://*.odoo.com/pos/ui*
// @grant        none
// ==/UserScript==

(function () {
'use strict';

if (location.protocol !== "https:" || !/(^|\.)odoo\.com$/i.test(location.hostname)) return;

if (!/^\/pos\/ui(?:\/|$)/.test(location.pathname)) return;

if (document.documentElement?.hasAttribute("data-pb-suite-orders")) return;
document.documentElement?.setAttribute("data-pb-suite-orders","1.0.17");

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

  function cleanNoteText(rawNote) {
      let clean = rawNote;
      try {
          if (clean && typeof clean === 'string' && (clean.startsWith('[') || clean.startsWith('{'))) {
               const parsed = JSON.parse(clean);
               // 处理数组: [{"text":...}] 或 []
               if (Array.isArray(parsed)) {
                   if (parsed.length > 0 && parsed[0].text) {
                       clean = parsed[0].text;
                   } else {
                       clean = ""; // 空数组或无 text 属性 -> 视为空
                   }
               }
               // 处理对象: {"text":...}
               else if (typeof parsed === 'object') {
                   if (parsed.text) {
                       clean = parsed.text;
                   } else {
                       clean = ""; // 无 text 属性 -> 视为空
                   }
               }
          }
      } catch (e) {
          // 解析失败，保持原样（可能是普通字符串）
      }

      // 最终清洗：转字符串 -> 去除两端空格 -> 再次检查是否为残留的 "[]"
      if (typeof clean !== 'string') return "";
      clean = clean.trim();
      if (clean === "[]") return ""; // 强制过滤残留的空数组字符串

      return clean;
  }

  function getOrderGlobalNote(order) {
      let rawNote = "";
      try {
          if (typeof order.get_note === "function") rawNote = order.get_note();
          if (!rawNote && order.note) rawNote = order.note;
          if (!rawNote && typeof order.export_as_JSON === "function") {
              const json = order.export_as_JSON();
              if (json && json.note) rawNote = json.note;
          }
      } catch (e) {}
      return cleanNoteText(rawNote);
  }

function createSaleWriteJournal(storage, makeId, now = Date.now) {
    const key = uuid => {
        if(typeof uuid!=="string" || !/^[a-zA-Z0-9_-]+$/.test(uuid)) throw new Error("Invalid POS order identity");
        return "pb-suite:sale-write:v1:"+uuid;
    };
    function read(uuid) {
        const raw=storage.getItem(key(uuid));
        if(raw===null) return null;
        const record=JSON.parse(raw);
        if(record?.schema!==1 || record.orderUuid!==uuid || typeof record.operationId!=="string" ||
           !["prepared","unknown","confirmed","reviewed"].includes(record.status) ||
           !["create","write"].includes(record.method)) throw new Error("Invalid sales write journal; original data preserved");
        return record;
    }
    function save(record) {
        const destination=key(record.orderUuid),payload=JSON.stringify(record);
        storage.setItem(destination,payload);
        if(storage.getItem(destination)!==payload) throw new Error("Sales write journal readback failed");
        return record;
    }
    function update(record,changes) {
        const current=read(record.orderUuid);
        if(!current || current.operationId!==record.operationId) throw new Error("Sales write journal changed");
        return save({...current,...changes});
    }
    return {
        read,
        unresolved:record=>record && ["prepared","unknown"].includes(record.status),
        begin(uuid,method,serverId=null) {
            const prior=read(uuid);
            if(prior && ["prepared","unknown"].includes(prior.status)) throw new Error("Previous sales write needs review");
            if(!["create","write"].includes(method)) throw new Error("Unsupported sales mutation");
            return save({schema:1,orderUuid:uuid,operationId:makeId(),method,serverId,status:"prepared",createdAt:now()});
        },
        confirm:(record,serverId)=>update(record,{status:"confirmed",serverId,confirmedAt:now()}),
        uncertain:(record,serverId=null)=>update(record,{status:"unknown",serverId:serverId||record.serverId,failedAt:now()}),
        acknowledge:record=>update(record,{status:"reviewed",reviewedAt:now()})
    };
}

    const pbSaleWrites = createSaleWriteJournal(localStorage, () => crypto.randomUUID());
    async function pbCanStartSaleWrite(order, origin) {
        let journal;
        try { journal=pbSaleWrites.read(order.uuid); }
        catch(error) {
            await showAlert(pbUiText(
                "本机销售单写入记录无法读取，已停止提交。请保留浏览器数据和备份后检查。",
                "No se puede leer el registro local de envío. Se bloqueó el envío. Conserva los datos y la copia para revisarlos."
            )); return false;
        }
        if(!pbSaleWrites.unresolved(journal)) return true;
        let records=[];
        if(journal.serverId) records=[{id:journal.serverId,name:"#"+journal.serverId}];
        else {
            try { records=await callOdoo("sale.order","search_read",[[["origin","=",origin]],["id","name","state"]],{limit:10,order:"id desc"}); }
            catch(error) { console.error("[Playbox] Sales reconciliation lookup failed",error); }
        }
        const action=await showChoice(pbUiText(
            "上次提交结果未确认，已停止重复发送。请先查看服务器销售单。没有查到记录也不代表上次提交一定失败。",
            "El resultado del envío anterior no está confirmado. No se reenviará. Revisa los pedidos del servidor; que no aparezcan aún no prueba que falló."
        ),[
            ...records.map(record=>({label:pbUiText("查看 ","Ver ")+record.name,value:"view:"+record.id,secondary:true})),
            {label:pbUiText("我已人工核对，解除本机保护","Ya revisé: desbloquear envío"),value:"reviewed",danger:true},
            {label:pbUiText("关闭并保留记录","Cerrar y conservar registro"),value:"close",secondary:true}
        ],pbUiText("需要核对上次提交","Revisar envío anterior"));
        if(typeof action==="string" && action.startsWith("view:")) {
            const id=Number(action.slice(5));
            if(Number.isSafeInteger(id)&&id>0) window.open(`/web#id=${id}&model=sale.order&view_type=form`,"_blank","noopener");
        } else if(action==="reviewed") {
            const confirmed=await showConfirm(pbUiText(
                "仅在已人工核对服务器记录后解除。此操作不会重新提交；下一次 F11 仍需重新选择操作。",
                "Desbloquea solo después de revisar el servidor. Esto no reenvía nada; al pulsar F11 debes elegir de nuevo."
            ));
            if(confirmed) pbSaleWrites.acknowledge(journal);
        }
        return false;
    }
    async function pbCommitSaleWrite(order,method,args,expectedVersion) {
        if(!navigator.locks?.request) throw new Error(pbUiText(
            "浏览器无法锁定本次销售单写入，已停止提交。","El navegador no puede bloquear este envío; no se enviaron cambios."));
        return navigator.locks.request("pb-suite:sale-write:"+order.uuid,async()=>{
            const latest=pbSaleWrites.read(order.uuid);
            if((latest?.operationId||null)!==expectedVersion || order.finalized || (order.state && order.state!=="draft"))
                throw new Error(pbUiText("订单或提交记录已变化，请重新核对后操作。","Cambió el pedido o el registro de envío. Revísalo de nuevo."));
            const knownId=method==="write"?Number(args[0]?.[0]):null;
            let journal;
            try { journal=pbSaleWrites.begin(order.uuid,method,knownId); }
            catch(error) { throw new Error(pbUiText("无法保存提交记录或上次提交仍待核对，本次未发送。","No se guardó el registro o hay un envío pendiente de revisión. No se envió nada.")); }
            let serverId=knownId;
            try {
                const result=await callOdoo("sale.order",method,args);
                if(method==="write" && result!==true) throw new Error("Sales write was not acknowledged");
                if(method==="create") serverId=Number(result);
                if(!Number.isSafeInteger(serverId)||serverId<=0) throw new Error("Invalid sales mutation response");
                pbSaleWrites.confirm(journal,serverId);
                return result;
            } catch(error) {
                console.error("[Playbox] Sales mutation outcome requires review",error);
                try { pbSaleWrites.uncertain(journal,serverId); }
                catch(storageError) { console.error("[Playbox] Keep prepared sales journal for recovery",storageError); }
                throw new Error(pbUiText(
                    "销售单提交结果尚未完全确认，已保留本机记录；不会自动重发。再次按 F11 可查看核对入口。",
                    "No se confirmó completamente el envío. Se conservó el registro local y no se reenviará automáticamente. Pulsa F11 para revisar."
                ));
            }
        });
    }

  async function syncLogic() {
    if (typeof window.posmodel === 'undefined') return showAlert(pbUiPair("未检测到 posmodel 对象。\n页面可能未加载完成。","El POS aún no está listo. Espera a que termine de cargar."), pbUiPair("错误","Error"));
    if (!posmodel.selectedOrder) return showAlert(pbUiPair("未找到 POS 订单。","No se encontró el pedido del POS."), pbUiPair("未就绪","Aún no está listo"));

    const o = posmodel.selectedOrder;
    // 固定本次操作的订单对象；异步返回不得改写后来选中的订单。
    if (o.finalized || (o.state && o.state !== "draft")) {
        return showAlert(pbUiPair("当前订单已完成或不可编辑，不能同步覆盖。","El pedido está terminado o no se puede editar; no se sobrescribirá."), pbUiPair("无法同步","No se puede sincronizar"));
    }
    const originValue = o.uuid ? `POS-UUID:${o.uuid}` : (o.name || "POS");

    if (!await pbCanStartSaleWrite(o, originValue)) return;
    const pbSaleBaseline = pbSaleWrites.read(o.uuid);
    if (pbSaleWrites.unresolved(pbSaleBaseline)) { await pbCanStartSaleWrite(o, originValue); return; }
    const pbExpectedSaleVersion = pbSaleBaseline?.operationId || null;
    const globalNote = getOrderGlobalNote(o);
    let internalNoteRaw = "";
    if (o.internal_note) internalNoteRaw = o.internal_note;
    const cleanInternalNote = cleanNoteText(internalNoteRaw);

    let notesToPost = [];
    if (globalNote) notesToPost.push(globalNote);
    if (cleanInternalNote) notesToPost.push(`[内部备注]: ${cleanInternalNote}`);

    const orderLines = o.lines.map(l => {
        if (!l.product_id?.id) return null;
        const lineVals = { product_id: l.product_id.id, product_uom_qty: l.qty, price_unit: l.price_unit, discount: Number(l.discount || 0) };

        let rawLineNote = l.note || "";
        if (!rawLineNote && typeof l.export_as_JSON === "function") {
            const lJson = l.export_as_JSON();
            if (lJson && lJson.note) rawLineNote = lJson.note;
        }

        // [调用增强后的清洗函数]
        const cleanLineNote = cleanNoteText(rawLineNote);

        // [严格判断] 只有当 cleanLineNote 有真实内容时，才进行处理
        if (cleanLineNote) {
             let prodName = l.product_id.display_name || l.product_id.name;
             if (typeof l.export_as_JSON === "function") {
                 const json = l.export_as_JSON();
                 if (json && json.full_product_name) prodName = json.full_product_name;
             }

             // 1. 消息墙：保留产品名 + 备注
             const formattedForChatter = `${prodName}: ${cleanLineNote}`;
             notesToPost.push(formattedForChatter);

             // 2. 订单行：纯备注 (无产品名)
             lineVals.name = cleanLineNote;
        }
        // 如果 else (备注为空)，则 lineVals.name 不被赋值，Odoo 会自动使用默认产品描述

        return [0, 0, lineVals];
    }).filter(Boolean);

    if (!orderLines.length) return showAlert(pbUiPair("当前订单为空。","El pedido está vacío."), pbUiPair("提示","Aviso"));

    const baseVals = { partner_id: o.partner_id?.id || 53, origin: originValue };
    if (o.pricelist_id?.id) baseVals.pricelist_id = o.pricelist_id.id;

    const existed = await withLoading(() => callOdoo("sale.order", "search_read", [[["origin", "=", originValue]], ["name", "id", "state"]], { limit: 1, order: "id desc" }));

    let finalSoId;
    if (existed && existed.length > 0) {
      const so = existed[0];
      const state = so.state || "draft";
      if (state === "cancel") {
        const createNew = await showConfirm(pbUiPair(`销售单 ${so.name} 已被取消。\n是否创建新单？`,`El pedido ${so.name} está cancelado.\n¿Deseas crear otro?`), { title: pbUiPair("订单已取消","Pedido cancelado"), confirmText: pbUiPair("创建新单","Crear otro pedido"), cancelText: pbUiPair("查看旧单","Ver pedido anterior") });
        if (createNew === null) return;
        if (createNew === false) { window.open(`/web#id=${so.id}&model=sale.order&view_type=form`, "_blank"); return; }
        finalSoId = await withLoading(() => pbCommitSaleWrite(o, "create", [{ ...baseVals, order_line: orderLines }], pbExpectedSaleVersion));
      } else if (!["draft", "sent"].includes(state)) {
        const openIt = await showConfirm(pbUiPair(`销售单 ${so.name} 状态为已确认。\n是否打开？`,`El pedido ${so.name} está confirmado.\n¿Deseas abrirlo?`), { title: pbUiPair("无法修改","No se puede modificar"), confirmText: pbUiPair("打开订单","Abrir pedido"), cancelText: pbUiPair("关闭","Cerrar") });
        if (openIt) window.open(`/web#id=${so.id}&model=sale.order&view_type=form`, "_blank");
        return;
      } else {
        const action = await showChoice(pbUiPair(`发现关联销售单：${so.name} (草稿)\n请选择操作：`,`Pedido vinculado: ${so.name} (borrador).\nElige una acción:`), [ { label: pbUiPair("仅查看","Solo ver"), value: "3", secondary: true }, { label: pbUiPair("新建销售单","Crear pedido de venta"), value: "2", secondary: true }, { label: pbUiPair("覆盖当前单","Reemplazar pedido"), value: "1", danger: true }, ], pbUiPair("重复订单","Pedido existente"));
        if (!action) return;
        if (action === "3") { window.open(`/web#id=${so.id}&model=sale.order&view_type=form`, "_blank"); return; }
        finalSoId = await withLoading(async () => {
            if (action === "2") return await pbCommitSaleWrite(o, "create", [{ ...baseVals, order_line: orderLines }], pbExpectedSaleVersion);
            else if (action === "1") { await pbCommitSaleWrite(o, "write", [[so.id], { ...baseVals, order_line: [[5, 0, 0], ...orderLines] }], pbExpectedSaleVersion); return so.id; }
        });
      }
    } else {
      const ok = await showConfirm(pbUiPair("未找到关联销售单。\n是否立即创建？","No hay un pedido de venta vinculado.\n¿Deseas crearlo?"), { title: pbUiPair("新建销售单","Crear pedido de venta"), confirmText: pbUiPair("立即创建","Crear ahora"), cancelText: pbUiPair("取消","Cancelar") });
      if (!ok) return;
      finalSoId = await withLoading(() => pbCommitSaleWrite(o, "create", [{ ...baseVals, order_line: orderLines }], pbExpectedSaleVersion));
    }

    if (!finalSoId) return;

    let notesUnverified = false;
    if (notesToPost.length > 0) {
        await withLoading(async () => {
            for (const msg of notesToPost) {
                 try {
                     await callOdoo("sale.order", "message_post", [finalSoId], { body: msg, message_type: "comment", subtype_xmlid: "mail.mt_note" });
                 } catch (error) {
                     // A network failure may follow a committed post. Never retry it blindly.
                     notesUnverified = true;
                     console.error("[POS Sync] Note result unverified; inspect the sales order", error);
                     break;
                 }
            }
        });
    }

    await withLoading(async () => {
        const soInfo = await callOdoo("sale.order", "read", [[finalSoId], ["name"]]);
        const soName = soInfo[0].name;

        try {
            if (!o.finalized && (!o.state || o.state === "draft")) {
                if (typeof o.set_client_order_ref === "function") o.set_client_order_ref(soName);
                o.name = soName;
                console.log("[POS Sync] 已更新发起同步的 POS 订单引用");
            }
        } catch(e) { console.error("反向绑定失败", e); }

        const msg = pbUiPair(`销售单已保存。\n单号：${soName}${notesUnverified ? "\n部分备注结果未确认，请查看销售单消息记录；未自动重发。" : ""}`,`Pedido guardado: ${soName}${notesUnverified ? "\nHay notas sin confirmar. Revisa los mensajes del pedido; no se reenviaron." : ""}`);
        const shouldOpen = await showModal({ title: pbUiPair("完成","Terminado"), message: msg, buttons: [{ label: pbUiPair("查看订单","Ver pedido"), value: true, primary: true }] });
        if (shouldOpen) window.open(`/web#id=${finalSoId}&model=sale.order&view_type=form`, "_blank");
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "F11" && !e.repeat && !e.isComposing && !e.ctrlKey && !e.altKey && !e.metaKey) {
       e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
       if (isPaymentPage()) return;
       if (!isPosUiProductPage()) return;
       if (isSyncing) return;
       isSyncing = true;
       syncLogic().catch(err => { hideLoading(); showAlert(err.message, pbUiPair("系统错误","Error del sistema")); }).finally(() => { isSyncing = false; hideLoading(); });
    }
    if (e.key === "Escape") {
       if (pbModalRoot && pbModalRoot.classList.contains("pb-visible")) { e.preventDefault(); closeModal(null); }
    }
  });


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
    const copyStyle=document.createElement('style');
    copyStyle.textContent=`        #pb-copy-paid-order-btn {
            background: #059669 !important;
            border: 1px solid #047857 !important;
            color: #ffffff !important;
            font-weight: 800 !important;
            border-radius: 8px !important;
            white-space: nowrap !important;
            transition: background 0.16s ease !important;
        }
        #pb-copy-paid-order-btn:hover:not(:disabled) {
            background: #047857 !important;
        }
        #pb-copy-paid-order-btn:disabled {
            opacity: 0.6 !important;
            cursor: wait !important;
        }
        #pb-order-copy-toast {
            position: fixed !important;
            top: 68px !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            z-index: 1000000 !important;
            max-width: min(560px, 92vw) !important;
            padding: 12px 22px !important;
            border-radius: 10px !important;
            color: #ffffff !important;
            background: #059669 !important;
            border: 1px solid rgba(255, 255, 255, 0.22) !important;
            box-shadow: 0 12px 32px rgba(15, 23, 42, 0.28) !important;
            font-size: 15px !important;
            font-weight: 800 !important;
            text-align: center !important;
            pointer-events: none !important;
        }
        #pb-order-copy-toast.pb-copy-error {
            background: #e11d48 !important;
        }
`;
    document.head.appendChild(copyStyle);
    function simulateClick(element) {
        if (!element) return;
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evtType => {
            element.dispatchEvent(new MouseEvent(evtType, { bubbles: true, cancelable: true, view: window }));
        });
    }

/* Fill native refund selections only. Does not create, pay or validate a refund. */
function createVerifiedRefundFill({getScreen,getPaidOrder,getPos,message}) {
    let busy=false,pending=null;
    function fail(zh,es){throw Error(message(zh,es));}
    function verifyNativeList(screen,order,targets) {
        if(!order.finalized || screen.getSelectedOrder()!==order)
            fail('退款前订单已变化，请重新选择原单核对。','El pedido cambió antes de devolver; seleccione de nuevo el original.');
        for(const target of targets) {
            if(Number(target.line.qty)-Number(target.line.refundedQty||0)!==target.remaining)
                fail('原单可退数量已变化，请重新核对。','Cambió la cantidad disponible; revise de nuevo.');
            const detail=order.uiState.lineToRefund[target.line.uuid];
            const actual=Number(detail?.qty);
            if(!Number.isFinite(actual)||Math.abs(actual-target.remaining)>1e-8*Math.max(1,target.remaining))
                fail('部分商品退款数量未通过核对，已停止提交；请逐行检查。','No se verificaron todas las cantidades; se detuvo la devolución. Revise cada línea.');
        }
        // The native refund action consumes this filtered list, not the raw map.
        const native=screen._getRefundableDetails(order.getPartner?.() || null,order);
        if(!Array.isArray(native)||native.length!==targets.length || targets.some(target=>{
            const matches=native.filter(detail=>detail.line?.uuid===target.line.uuid);
            return matches.length!==1 || matches[0]!==order.uiState.lineToRefund[target.line.uuid] ||
                Math.abs(Number(matches[0].qty)-target.remaining)>1e-8*Math.max(1,target.remaining);
        })) fail('Odoo 最终退款清单与商品不一致，已停止提交；请逐行核对。',
            'La lista final de devolución no coincide con los productos; se detuvo la devolución. Revise cada línea.');
    }
    function verifyPending(screen) {
        if(!pending)return false;
        const selected=screen.getSelectedOrder();
        if(selected?.uuid!==pending.order.uuid)return false;
        if(selected!==pending.order)
            fail('原订单已重新载入，请重新执行整单退款核对。','Se volvió a cargar el pedido original; revise de nuevo la devolución completa.');
        verifyNativeList(screen,pending.order,pending.targets);
        return true;
    }
    function fill() {
        if(busy)fail('正在核对退款数量，请稍候。','Se están verificando las cantidades. Espera.');
        busy=true;pending=null;
        let screen,order,before,selected;
        try {
            screen=getScreen();const pos=getPos();
            if(!screen || typeof screen.getSelectedOrder!=='function')
                fail('退款页面尚未初始化，请重新打开订单列表后再试。','La pantalla de devolución no se ha iniciado. Abre de nuevo la lista de pedidos.');
            order=getPaidOrder(pos,screen);
            if(!order || !order.finalized || screen.getSelectedOrder()!==order)
                fail('请先在左侧选择已付款订单，再执行整单退款。','Selecciona primero un pedido pagado de la lista.');
            if(typeof screen._onUpdateSelectedOrderline!=='function' || typeof screen.getToRefundDetail!=='function' ||
                typeof screen._getRefundableDetails!=='function' || typeof screen.onClickOrderline!=='function' ||
                typeof screen.getSelectedOrderlineId!=='function' || typeof screen.numberBuffer?.capture!=='function' ||
                typeof screen.numberBuffer?.reset!=='function' || !screen.state?.selectedOrderlineIds ||
                !order.uiState?.lineToRefund || !order.lines)
                fail('此 POS 版本的退款控件结构已变化，请人工逐行核对退款。','Cambió la estructura de devolución de esta versión de POS. Revisa cada línea manualmente.');
            screen.numberBuffer.capture();screen.numberBuffer.reset();
            const details=order.uiState.lineToRefund;
            before=new Map(Object.entries(details).map(([key,ref])=>[key,{ref,qty:ref.qty,refundableQty:ref.refundableQty,hadRefundableQty:Object.hasOwn(ref,'refundableQty')}]));
            selected=screen.state.selectedOrderlineIds[order.id];
            const lines=Array.from(order.lines),targets=[],skipped=[];
            // Native pos_discount disallows editing its adjustment line. Filling
            // only merchandise would refund the gross amount, not the paid net.
            if(lines.some(line=>(line.isDiscountLine || line.product_id?.id===pos.config?.discount_product_id?.id) && Number(line.price_unit)!==0))
                fail('原单含整单折扣，不能只按商品原价整单退款；请核对原实收和折扣后手工处理。未自动填写。','El pedido incluye un descuento global. Revisa el total cobrado y el descuento antes de devolver; no se llenaron cantidades automáticamente.');
            for(const line of lines) {
                const remaining=Number(line.qty)-Number(line.refundedQty||0);
                if(!Number.isFinite(remaining))fail('原单可退数量异常，请人工核对。','La cantidad disponible para devolución es inválida. Revísala.');
                if(remaining<=0 || line.isDiscountLine || line.product_id?.id===pos.config?.discount_product_id?.id ||
                    screen._isEWalletGiftCard?.(line)) { skipped.push(line.uuid);continue; }
                const detail=details[line.uuid];
                if(detail?.destinationOrder || detail?.destination_order_uuid)
                    fail('原单已有正在处理的退款，请先核对原退款。','El pedido ya tiene una devolución en proceso. Revísala primero.');
                targets.push({line,remaining});
            }
            if(!targets.length)fail('没有可填写的退款商品。','No hay productos disponibles para devolver.');
            for(const target of targets) {
                if(target.line.combo_parent_id)continue; // The native parent update fills its children.
                if(screen.getSelectedOrder()!==order)fail('订单已切换，已停止填写。','Cambió el pedido. Se detuvo el llenado.');
                screen.onClickOrderline(target.line);
                if(screen.getSelectedOrderlineId()!==target.line.id)
                    fail('未能选中目标商品，已停止填写并恢复原数量。','No se seleccionó el producto correcto; se restauraron las cantidades anteriores.');
                const result=screen._onUpdateSelectedOrderline({key:null,buffer:String(target.remaining)});
                if(result&&typeof result.then==='function')fail('Odoo 要求人工处理此商品，已停止自动填写。','Odoo requiere revisar este producto. Se detuvo el llenado automático.');
            }
            verifyNativeList(screen,order,targets);
            pending={order,targets};
            return {verified:targets.length,skipped:skipped.length,orderUuid:order.uuid};
        } catch(error) {
            if(before&&order) {
                const details=order.uiState.lineToRefund;
                for(const key of Object.keys(details))if(!before.has(key))delete details[key];
                for(const [key,item]of before){details[key]=item.ref;item.ref.qty=item.qty;if(item.hadRefundableQty)item.ref.refundableQty=item.refundableQty;else delete item.ref.refundableQty;}
            }
            throw error;
        } finally {
            if(screen&&order&&before){
                screen.numberBuffer.reset();
                if(selected===undefined)delete screen.state.selectedOrderlineIds[order.id];
                else screen.state.selectedOrderlineIds[order.id]=selected;
            }
            busy=false;
        }
    }
    return {fill,verifyPending};
}

    let pbRefundScreen=null;
    function pbInstallRefundCapture() {
        const Screen=window.odoo?.loader?.modules?.get("@point_of_sale/app/screens/ticket_screen/ticket_screen")?.TicketScreen;
        if(!Screen)return false;
        const proto=Screen.prototype;
        if(proto.__pbVerifiedRefundCapture)return true;
        for(const key of ["onMounted","onClickOrder","onClickOrderline","_onUpdateSelectedOrderline","onClickRefund"]) {
            const original=proto[key];
            if(typeof original!=="function")continue;
            proto[key]=function(...args){pbRefundScreen=this;return original.apply(this,args);};
        }
        // The userscript may start after TicketScreen has mounted. Its selected
        // order getter runs again when the refund pane renders or changes.
        const originalSelected=proto.getSelectedOrder;
        if(typeof originalSelected==='function')proto.getSelectedOrder=function(...args){
            const order=originalSelected.apply(this,args);
            if(document.querySelector('.ticket-screen') && order)pbRefundScreen=this;
            return order;
        };
        const originalRefund=proto.onDoRefund;
        if(typeof originalRefund==='function')proto.onDoRefund=function(...args){
            pbRefundScreen=this;
            try { pbVerifiedRefund.verifyPending(this); }
            catch(error){ pbShowOrderCopyToast(error.message,true);return Promise.resolve(); }
            return originalRefund.apply(this,args);
        };
        Object.defineProperty(proto,"__pbVerifiedRefundCapture",{value:true,configurable:true});
        return true;
    }
    const pbVerifiedRefund=createVerifiedRefundFill({
        getScreen:()=>pbRefundScreen,
        getPaidOrder:(pos,screen)=>screen?.getSelectedOrder(),getPos:()=>pbGetPosStore(),message:pbUiText
    });
    async function pbFillAllRefundQuantities() {
        const result=pbVerifiedRefund.fill();
        pbShowOrderCopyToast(pbUiPair(`已核对 ${result.verified} 行可退商品；跳过 ${result.skipped} 行不可退商品。`,
            `Se verificaron ${result.verified} líneas; se omitieron ${result.skipped} líneas no reembolsables.`),false);
        return result;
    }
    pbInstallRefundCapture();
    function processRefundButton() {
        pbInstallRefundCapture();
        const refundHeader = document.querySelector('.ticket-screen .highlight.text-danger');
        if (refundHeader && !refundHeader.querySelector('#pb-refund-all-btn')) {
            refundHeader.style.display = 'flex';
            refundHeader.style.justifyContent = 'space-between';
            refundHeader.style.alignItems = 'center';
            refundHeader.style.padding = '8px 16px';
            const btn = document.createElement('button');
            btn.id = 'pb-refund-all-btn';
            btn.className = 'btn btn-danger btn-sm';
            btn.style.cssText = 'font-weight: bold; border-radius: 6px; padding: 6px 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.15); margin-left: 10px; border: 2px solid white;';
            pbActionLabel(btn,"fa fa-reply-all","整单退款","Reembolsar pedido completo");
            btn.onclick = async function(e) {
                e.stopPropagation();
                btn.disabled = true;
                pbActionLabel(btn,"fa fa-spinner fa-spin","正在填写退款数量…","Llenando reembolso…");
                try {
                    await pbFillAllRefundQuantities();
                    pbActionLabel(btn,"fa fa-check","退款数量已填入","Cantidades completadas");
                    btn.classList.replace('btn-danger', 'btn-success');
                } catch (err) {
                    console.error("[POS Debug] Falló el reembolso automático:", err);
                    pbShowOrderCopyToast(err.message,true);
                    pbActionLabel(btn,"fa fa-exclamation-triangle","操作失败","Ocurrió un error");
                } finally {
                    setTimeout(() => {
                        if (document.getElementById('pb-refund-all-btn')) {
                            btn.disabled = false;
                            pbActionLabel(btn,"fa fa-reply-all","整单退款","Reembolsar pedido completo");
                            btn.classList.replace('btn-success', 'btn-danger');
                        }
                    }, 3000);
                }
            };
            refundHeader.appendChild(btn);
        }
    }

    // =========================================================================
    // 已付订单复制：复制商品资料到全新的未付款订单，不复制付款和退款关系
    // =========================================================================
    var pbCopyOrderBusy = false;
    var pbCopyToastTimer = null;

    function pbGetPosStore() {
        return window.posmodel || window.pos || null;
    }

    function pbGetSelectedPaidOrder(pos) {
        if (!pos || !pos.models || !pos.models["pos.order"]) return null;

        var row = document.querySelector(
            '.ticket-screen .order-row.highlight.active[orderuuid], ' +
            '.ticket-screen .order-row.highlight[orderuuid], ' +
            '.ticket-screen .order-row.active[orderuuid]'
        );
        var uuid = row ? row.getAttribute('orderuuid') : '';

        if (!uuid) return null;

        var orderModel = pos.models["pos.order"];
        var order = null;

        if (typeof orderModel.getBy === 'function') {
            order = orderModel.getBy('uuid', uuid);
        }
        if (!order && typeof orderModel.find === 'function') {
            order = orderModel.find(function(item) { return item.uuid === uuid; });
        }

        return order && order.finalized ? order : null;
    }

    function pbGetPositiveOrderLines(order) {
        if (!order) return [];

        var lines = typeof order.getOrderlines === 'function'
            ? order.getOrderlines()
            : (typeof order.get_orderlines === 'function'
                ? order.get_orderlines()
                : (order.lines || []));

        return Array.from(lines || []).filter(function(line) {
            var qty = typeof line.getQuantity === 'function'
                ? line.getQuantity()
                : (typeof line.get_quantity === 'function' ? line.get_quantity() : line.qty);
            return Number.isFinite(Number(qty)) && Number(qty) > 0 && line.product_id;
        });
    }

    function pbLinkRecords(records) {
        return Array.from(records || []).filter(Boolean).map(function(record) {
            return ['link', record];
        });
    }

    function pbCopyCustomAttributes(records) {
        return Array.from(records || []).filter(Boolean).map(function(record) {
            return ['create', {
                custom_product_template_attribute_value_id:
                    record.custom_product_template_attribute_value_id,
                custom_value: record.custom_value || ''
            }];
        });
    }

    function pbCopyLots(records) {
        return Array.from(records || []).filter(function(record) {
            return record && record.lot_name;
        }).map(function(record) {
            return ['create', { lot_name: record.lot_name }];
        });
    }

    function pbActionLabel(node,icon,zh,es) {
        node.dataset.pbActionLabel="1";node.pbActionIcon=icon;node.pbActionPair=pbUiPair(zh,es);
        node.innerHTML='<i class="'+icon+'"></i> '+String(node.pbActionPair);
    }
    PBUI.subscribe(()=>{
        document.querySelectorAll("[data-pb-action-label]").forEach(node=>{
            if(node.pbActionPair)node.innerHTML='<i class="'+node.pbActionIcon+'"></i> '+String(node.pbActionPair);
        });
        const toast=document.getElementById("pb-order-copy-toast");
        if(toast?.pbMessage)toast.textContent=toast.pbMessage;
        const copy=document.getElementById("pb-copy-paid-order-btn");
        if(copy)copy.title=pbUiText("将选中的已付款订单复制为新的未付款订单","Copiar el pedido pagado seleccionado a un pedido nuevo sin pagar");
    });
    function pbShowOrderCopyToast(message, isError) {
        var toast = document.getElementById('pb-order-copy-toast');

        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'pb-order-copy-toast';
            toast.setAttribute('role', 'status');
            document.body.appendChild(toast);
        }

        toast.classList.toggle('pb-copy-error', Boolean(isError));
        toast.pbMessage = message;
        toast.textContent = message;
        toast.style.display = 'block';

        if (pbCopyToastTimer) clearTimeout(pbCopyToastTimer);
        pbCopyToastTimer = setTimeout(function() {
            if (toast) toast.style.display = 'none';
        }, isError ? 5000 : 3500);
    }

    const pbCopyBuilding = new Set();
    const PB_COPY_JOURNAL = "pb_copy_recovery_v1";
    function pbCopyReadJournal() {
        const value = JSON.parse(localStorage.getItem(PB_COPY_JOURNAL) || "{}");
        if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("COPY_RECOVERY_INVALID");
        return value;
    }
    function pbCopyWriteJournal(records) {
        const text = JSON.stringify(records);
        localStorage.setItem(PB_COPY_JOURNAL, text);
        if (localStorage.getItem(PB_COPY_JOURNAL) !== text) throw new Error("COPY_RECOVERY_NOT_SAVED");
    }
    function pbCopyMark(order, phase) {
        const records = pbCopyReadJournal();
        if (!order?.uuid) throw new Error("COPY_UUID_MISSING");
        records[String(order.uuid)] = {...records[String(order.uuid)],uuid:String(order.uuid),phase,at:new Date().toISOString(),name:order.name || ""};
        pbCopyWriteJournal(records);
    }
    function pbCopyIsQuarantined(order, allowBuilding = true) {
        if (!order?.uuid || (allowBuilding && pbCopyBuilding.has(String(order.uuid)))) return false;
        const record = pbCopyReadJournal()[String(order.uuid)];
        return Boolean((record && !["completed","removed"].includes(record.phase)) || order.pb_copy_incomplete || String(order.internal_note || "").includes("[PB COPY INCOMPLETE]"));
    }
    function pbAssertCopyComplete(order, allowBuilding = true) {
        if (pbCopyIsQuarantined(order, allowBuilding)) throw new Error(pbUiPair("此草稿复制未完成，请通过“复制失败恢复”删除后重试。", "Copia incompleta. Use Recuperar copia para eliminar el borrador antes de reintentar."));
    }
    function pbInstallCopyRecovery() {
        const modules = window.odoo?.loader?.modules;
        const Order = modules?.get("@point_of_sale/app/models/pos_order")?.PosOrder;
        if (Order?.prototype?.assertEditable && !Order.prototype.assertEditable.__pbCopyRecovery) {
            const original = Order.prototype.assertEditable;
            const guard = function(...args) { pbAssertCopyComplete(this); return original.apply(this,args); };
            guard.__pbCopyRecovery = true;
            Order.prototype.assertEditable = guard;
        }
        const Payment = modules?.get("@point_of_sale/app/screens/payment_screen/payment_screen")?.PaymentScreen;
        const Line = modules?.get("@point_of_sale/app/models/pos_order_line")?.PosOrderline;
        for (const name of ["setQuantity", "setUnitPrice", "setDiscount"]) {
            const original = Line?.prototype?.[name];
            if (typeof original !== "function" || original.__pbCopyRecovery) continue;
            const guard = function(...args) { pbAssertCopyComplete(this.order_id); return original.apply(this,args); };
            guard.__pbCopyRecovery = true;
            Line.prototype[name] = guard;
        }
        // Odoo's default export uses Symbol.for("default"). Guard the validation
        // service as well as the screen: an already mounted screen may retain
        // its old bound method, but still calls this service at payment time.
        const Validation = modules?.get("@point_of_sale/app/utils/order_payment_validation")?.[Symbol.for("default")];
        for (const name of ["validateOrder", "finalizeValidation"]) {
            const original = Validation?.prototype?.[name];
            if (typeof original !== "function" || original.__pbCopyRecovery) continue;
            const guard = function(...args) { pbAssertCopyComplete(this.order, false); return original.apply(this,args); };
            guard.__pbCopyRecovery = true;
            Validation.prototype[name] = guard;
        }
        if (Payment?.prototype?.validateOrder && !Payment.prototype.validateOrder.__pbCopyRecovery) {
            const original = Payment.prototype.validateOrder;
            const guard = function(...args) {
                try { pbAssertCopyComplete(this.currentOrder || this.pos?.getOrder?.(), false); }
                catch (error) { pbShowOrderCopyToast(error.message,true); return Promise.resolve(); }
                return original.apply(this,args);
            };
            guard.__pbCopyRecovery = true;
            Payment.prototype.validateOrder = guard;
        }
        const pos = pbGetPosStore();
        for (const order of pos?.getOpenOrders?.() || []) pbRepairLegacyCopyNote(order);
        for (const name of ["addLineToCurrentOrder", "addLineToOrder"]) {
            const original = pos?.[name];
            if (typeof original !== "function" || original.__pbCopyRecovery) continue;
            const guard = function(...args) {
                pbAssertCopyComplete(name === "addLineToOrder" ? args[1] : this.getOrder?.());
                return original.apply(this,args);
            };
            Object.assign(guard, original); // Keep the scanner guard idempotent too.
            guard.__pbCopyRecovery = true;
            pos[name] = guard;
        }
        const incomplete = (pos?.getOpenOrders?.() || []).filter(order => pbCopyIsQuarantined(order));
        let button = document.getElementById("pb-copy-recovery");
        if (!incomplete.length) { button?.remove(); return; }
        if (!button) {
            button = document.createElement("button"); button.id = "pb-copy-recovery";
            button.style.cssText = "position:fixed;bottom:110px;right:12px;z-index:100050;padding:10px;background:#fff3cd;color:#664d03";
            button.addEventListener("click", async () => {
                if (pbCopyOrderBusy) return;
                const store = pbGetPosStore();
                const drafts = (store?.getOpenOrders?.() || []).filter(order => pbCopyIsQuarantined(order));
                if (!drafts.length) return pbInstallCopyRecovery();
                if (!window.confirm(pbUiPair("以下复制失败草稿不能付款。确认仅删除这些草稿？原已付款订单不变。\n", "Estos borradores incompletos no pueden pagarse. ¿Eliminar solo estos borradores?\n") + drafts.map(o=>`${o.name || ""} · ${o.uuid}`).join("\n"))) return;
                pbCopyOrderBusy = true;
                try {
                    for (const draft of drafts) {
                        if (draft.finalized || draft.state !== "draft") throw new Error("COPY_RECOVERY_NOT_DRAFT");
                        const result = await pbDiscardFailedCopy(store,draft,null);
                        if (!result.removed) throw result.error;
                    }
                    pbInstallCopyRecovery();
                } catch (error) { pbShowOrderCopyToast(error.message,true); }
                finally { pbCopyOrderBusy = false; }
            });
            document.body.appendChild(button);
        }
        const label = pbUiPair("复制失败恢复", "Recuperar copia") + ` (${incomplete.length})`;
        if (button.textContent !== label) button.textContent = label;
    }


    function pbRepairLegacyCopyNote(order) {
        const prefix = "[PB COPY INCOMPLETE] ";
        if (!order?.uuid || order.state !== "draft" || order.finalized ||
            typeof order.internal_note !== "string" || !order.internal_note.startsWith(prefix)) return;
        const raw = order.internal_note;
        let restored = raw;
        while (restored.startsWith(prefix)) restored = restored.slice(prefix.length);
        let valid = restored === "";
        if (!valid) {
            try {
                const tags = JSON.parse(restored);
                valid = Array.isArray(tags) && tags.every(tag => tag && typeof tag === "object" &&
                    !Array.isArray(tag) && typeof tag.text === "string");
            } catch (_) { /* Unknown original content is never discarded. */ }
        }
        try {
            const records = pbCopyReadJournal(), id = String(order.uuid);
            records[id] = {...records[id], uuid:id, phase:"failed", name:order.name || "",
                at:new Date().toISOString(), legacyNoteOriginal:records[id]?.legacyNoteOriginal ?? raw,
                legacyNoteStatus:valid ? "restored" : "needs-review"};
            pbCopyWriteJournal(records); // Exact readback must succeed before touching business data.
            if (valid && order.internal_note === raw) order.internal_note = restored;
        } catch (_) { /* Keep original prefix and quarantine when persistence is uncertain. */ }
    }

    // Store-scoped and transient: never persist a navigation lock across reloads.
    const pbCopyDeleting = new WeakMap();
    function pbCopyBeginDelete(pos, order) {
        let pending = pbCopyDeleting.get(pos);
        if (!pending) { pending = new Set(); pbCopyDeleting.set(pos, pending); }
        const uuid = String(order.uuid);
        if (pending.has(uuid)) throw new Error("COPY_DELETE_ALREADY_PENDING");
        const blocked = value => pending.has(String(value || ""));
        const notice = () => {
            pbShowOrderCopyToast(pbUiPair("该草稿正在删除，请稍候；其他订单可继续操作。",
                "Este borrador se está eliminando. Espere un momento; puede continuar con otros pedidos."), true);
            return false;
        };
        const wrap = (owner, name, target) => {
            const original = owner?.[name];
            if (typeof original !== "function" || original.__pbCopyDeleteGuard) return;
            const guarded = function(...args) {
                if (blocked(target.apply(this, args))) return notice();
                return original.apply(this, args);
            };
            Object.assign(guarded, original);
            guarded.__pbCopyDeleteGuard = true;
            owner[name] = guarded;
        };
        wrap(pos, "setOrder", order => order?.uuid);
        wrap(pos, "navigateToOrderScreen", order => order?.uuid);
        wrap(pos, "pay", function() { return this.getOrder?.()?.uuid; });
        const routeTarget = (name, params = {}) => params.orderUuid ||
            (name === "PaymentScreen" ? pos.getOrder?.()?.uuid : "");
        wrap(pos, "navigate", routeTarget);
        wrap(pos.router, "navigate", routeTarget);
        // popstate calls matchURL before the Store callback. Reject the URL
        // before reactive route params can mount a component for this UUID.
        const router = pos.router;
        if (typeof router?.matchURL === "function" && !router.matchURL.__pbCopyDeleteGuard) {
            const original = router.matchURL;
            let safeUrl = window.location.href;
            const guarded = function(...args) {
                if (pending.size) {
                    for (const {regex, paramSpecs} of Object.values(this.registeredRoutes)) {
                        const match = this.path.match(regex);
                        if (!match) continue;
                        const index = paramSpecs.findIndex(spec => spec.name === "orderUuid");
                        if (index >= 0 && blocked(match[index + 1])) {
                            window.history.replaceState(window.history.state, "", safeUrl);
                            this.path = window.location.pathname;
                            notice();
                            return;
                        }
                        break;
                    }
                }
                const result = original.apply(this, args);
                safeUrl = window.location.href;
                return result;
            };
            Object.assign(guarded, original);
            guarded.__pbCopyDeleteGuard = true;
            router.matchURL = guarded;
        }
        pending.add(uuid);
        return () => pending.delete(uuid);
    }

    async function pbDiscardFailedCopy(pos, targetOrder, previousOrder) {
        if (!targetOrder) return { removed: true };
        let releaseDelete;
        try {
            releaseDelete = pbCopyBeginDelete(pos, targetOrder);
            if (previousOrder && previousOrder !== targetOrder && typeof pos.setOrder === "function") pos.setOrder(previousOrder);
            if (typeof pos.deleteOrders !== "function") throw new Error("DELETE_API_UNAVAILABLE");
            if (typeof pos.getOpenOrders !== "function") throw new Error("COPY_DELETE_VERIFICATION_UNAVAILABLE");
            // A mounted PaymentScreen can render during deleteOrders' await,
            // before post-delete repair runs. Move its reference while the old
            // order still exists, and let the screen unmount before removal.
            if (pos.router?.state?.current === "PaymentScreen" &&
                String(pos.router.state.params?.orderUuid) === String(targetOrder.uuid)) {
                let safeOrder = pos.getOpenOrders().find(order =>
                    String(order.uuid) !== String(targetOrder.uuid) && !pbCopyIsQuarantined(order));
                if (!safeOrder) {
                    if (typeof pos.addNewOrder !== "function") throw new Error("COPY_DELETE_SELECTION_API_UNAVAILABLE");
                    safeOrder = pos.addNewOrder();
                }
                if (!safeOrder?.uuid || typeof pos.setOrder !== "function" || typeof pos.navigate !== "function") throw new Error("COPY_DELETE_ROUTE_API_UNAVAILABLE");
                pos.setOrder(safeOrder);
                pos.navigate("ProductScreen", {orderUuid:safeOrder.uuid});
                await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
                if (String(pos.router.state.params?.orderUuid) === String(targetOrder.uuid) ||
                    document.querySelector(".payment-screen")) throw new Error("COPY_DELETE_SCREEN_NOT_RELEASED");
            }
            await pos.deleteOrders([targetOrder], []);
            const remaining = typeof pos.getOpenOrders === "function"
                ? pos.getOpenOrders().some(order => String(order?.uuid || "") === String(targetOrder.uuid || ""))
                : false;
            if (remaining) throw new Error("COPY_DRAFT_STILL_PRESENT");
            if (!pos.getOrder?.() || String(pos.getOrder()?.uuid) === String(targetOrder.uuid)) {
                if (typeof pos.afterOrderDeletion !== "function") throw new Error("COPY_DELETE_SELECTION_API_UNAVAILABLE");
                await pos.afterOrderDeletion();
                if (!pos.getOrder?.() || String(pos.getOrder()?.uuid) === String(targetOrder.uuid)) throw new Error("COPY_DELETE_SELECTION_NOT_RESTORED");
            }
            // Native afterOrderDeletion only navigates from ProductScreen.
            // Re-read the live route after awaits: never replace another order's page.
            if (String(pos.router?.state?.params?.orderUuid || "") === String(targetOrder.uuid)) {
                const selected = pos.getOrder?.();
                if (!selected || String(selected.uuid) === String(targetOrder.uuid) ||
                    !pos.getOpenOrders().some(order => String(order.uuid) === String(selected.uuid))) throw new Error("COPY_DELETE_SELECTION_NOT_RESTORED");
                if (typeof pos.navigate !== "function") throw new Error("COPY_DELETE_ROUTE_API_UNAVAILABLE");
                pos.navigate("ProductScreen", {orderUuid:selected.uuid});
                if (pos.router.state.current !== "ProductScreen" || String(pos.router.state.params?.orderUuid) !== String(selected.uuid)) throw new Error("COPY_DELETE_ROUTE_NOT_RESTORED");
            }
            pbCopyMark(targetOrder, "removed");
            return { removed: true };
        } catch (cleanupError) {
            try { pbCopyMark(targetOrder, "failed"); } catch (_) { /* Existing write-ahead building record remains. */ }
            targetOrder.pb_copy_incomplete = true;
            targetOrder.assertEditable = function () {
                throw Object.assign(new Error("PB_COPY_INCOMPLETE"), { code: "PB_COPY_INCOMPLETE" });
            };
            return { removed: false, error: cleanupError };
        } finally {
            releaseDelete?.();
        }
    }

    async function pbCreateCopiedOrder(pos, sourceOrder) {
        var sourceLines = pbGetPositiveOrderLines(sourceOrder);
        const unresolvedCopy = typeof pos?.getOpenOrders === "function"
            ? pos.getOpenOrders().find(order => pbCopyIsQuarantined(order))
            : null;
        if (unresolvedCopy) {
            throw new Error(pbUiPair("存在上次复制失败的未完成草稿，请先删除它再重试。", "Existe un borrador incompleto de una copia anterior. Elimínalo antes de reintentar."));
        }

        if (!sourceLines.length) {
            throw new Error(pbUiPair("原订单没有可复制的正数商品行。","Este pedido pagado no tiene productos con cantidad positiva para copiar"));
        }
        if (!pos || typeof pos.addNewOrder !== 'function') {
            throw new Error(pbUiPair("当前 Odoo 未提供可用的新建订单接口。","Esta versión de Odoo no ofrece la función para crear un pedido nuevo"));
        }
        if (
            !pos.models ||
            !pos.models["pos.order.line"] ||
            typeof pos.models["pos.order.line"].create !== 'function'
        ) {
            throw new Error(pbUiPair("当前 Odoo 未提供可用的商品复制接口。","Esta versión de Odoo no ofrece la función para copiar productos del pedido"));
        }

        sourceLines.forEach(function(line) {
            if (!line.product_id || !line.product_id.product_tmpl_id) {
                throw new Error(pbUiPair("原订单有不完整商品，请重新打开后再试。","Hay productos incompletos en el pedido original; vuelve a abrirlo e inténtalo de nuevo"));
            }
        });

        // Validate the complete dependency graph before creating a draft.
        sourceLines.forEach(function(line) {
            var qty = typeof line.getQuantity === "function" ? line.getQuantity() : line.qty;
            if (!Number.isFinite(Number(qty)) || Number(qty) <= 0 ||
                !Number.isFinite(Number(line.price_unit || 0)) || !Number.isFinite(Number(line.discount || 0))) {
                throw new Error(pbUiPair("原订单包含无效的数量、价格或折扣。", "El pedido original contiene cantidad, precio o descuento no válido."));
            }
            if (line.combo_parent_id && sourceLines.indexOf(line.combo_parent_id) === -1) {
                throw new Error(pbUiPair("组合商品父行不完整，未创建新订单。", "La relación del combo está incompleta; no se creó un pedido."));
            }
        });
        var previousOrder = typeof pos.getOrder === "function" ? pos.getOrder() : null;
        var partner = typeof sourceOrder.getPartner === 'function'
            ? sourceOrder.getPartner()
            : sourceOrder.partner_id;
        var targetOrder = null;
        try {
        pbCopyWriteJournal(pbCopyReadJournal()); // Verify persistence before creating any draft.
        targetOrder = pos.addNewOrder();
        pbCopyMark(targetOrder, "building");
        pbCopyBuilding.add(String(targetOrder.uuid));

        if (partner && typeof targetOrder.setPartner === 'function') {
            targetOrder.setPartner(partner);
        } else if (partner) {
            targetOrder.partner_id = partner;
        }

        if (sourceOrder.pricelist_id) {
            if (typeof targetOrder.setPricelist === 'function') {
                targetOrder.setPricelist(sourceOrder.pricelist_id);
            } else {
                targetOrder.pricelist_id = sourceOrder.pricelist_id;
            }
        }

        targetOrder.fiscal_position_id = sourceOrder.fiscal_position_id || false;
        targetOrder.general_customer_note = sourceOrder.general_customer_note || '';
        targetOrder.internal_note = sourceOrder.internal_note || '';

        if (typeof targetOrder.setToInvoice === 'function') {
            targetOrder.setToInvoice(Boolean(sourceOrder.to_invoice));
        } else {
            targetOrder.to_invoice = Boolean(sourceOrder.to_invoice);
        }

        var lineModel = pos.models["pos.order.line"];
        var copiedBySource = new Map();
        var pending = sourceLines.slice();
        var copiedLines = [];

        // 先复制普通行/组合父行，再复制组合子行，确保父子关系指向新订单。
        while (pending.length) {
            var progress = false;
            var nextPending = [];

            for (var i = 0; i < pending.length; i++) {
                var sourceLine = pending[i];
                var sourceParent = sourceLine.combo_parent_id;

                if (sourceParent && sourceLines.indexOf(sourceParent) !== -1 && !copiedBySource.has(sourceParent)) {
                    nextPending.push(sourceLine);
                    continue;
                }

                var qty = typeof sourceLine.getQuantity === 'function'
                    ? sourceLine.getQuantity()
                    : sourceLine.qty;
                var copiedLine = lineModel.create({
                    qty: Number(qty),
                    price_unit: Number(sourceLine.price_unit || 0),
                    price_subtotal_incl: sourceLine.price_subtotal_incl,
                    product_id: sourceLine.product_id,
                    product_tmpl_id: sourceLine.product_id.product_tmpl_id,
                    order_id: targetOrder,
                    discount: Number(sourceLine.discount || 0),
                    tax_ids: pbLinkRecords(sourceLine.tax_ids),
                    attribute_value_ids: pbLinkRecords(sourceLine.attribute_value_ids),
                    custom_attribute_value_ids: pbCopyCustomAttributes(
                        sourceLine.custom_attribute_value_ids
                    ),
                    pack_lot_ids: pbCopyLots(sourceLine.pack_lot_ids),
                    combo_parent_id: sourceParent ? copiedBySource.get(sourceParent) : false,
                    combo_item_id: sourceLine.combo_item_id || false,
                    note: sourceLine.note || '[]',
                    customer_note: sourceLine.customer_note || '',
                    price_extra: Number(sourceLine.price_extra || 0),
                    price_type: 'manual'
                });

                copiedBySource.set(sourceLine, copiedLine);
                copiedLines.push(copiedLine);
                progress = true;
            }

            pending = nextPending;

            if (!progress) {
                throw new Error(pbUiPair("无法复制原组合商品的关联关系。","No se pudo copiar la relación de productos del combo original"));
            }
        }

        sourceLines.forEach(function(sourceLine) {
            var copiedParent = copiedBySource.get(sourceLine);
            var copiedChildren = Array.from(sourceLine.combo_line_ids || [])
                .map(function(child) { return copiedBySource.get(child); })
                .filter(Boolean);

            if (copiedParent && copiedChildren.length) {
                copiedParent.combo_line_ids = [['link'].concat(copiedChildren)];
            }
        });

        if (copiedLines.length && typeof targetOrder.selectOrderline === 'function') {
            targetOrder.selectOrderline(copiedLines[copiedLines.length - 1]);
        }

        if (typeof pos.addPendingOrder === 'function') {
            pos.addPendingOrder([targetOrder.id]);
        }

        pbCopyMark(targetOrder, "completed");
        pbCopyBuilding.delete(String(targetOrder.uuid));
        return {
            order: targetOrder,
            lineCount: copiedLines.length,
            totalQty: sourceLines.reduce(function(total, line) {
                var qty = typeof line.getQuantity === 'function' ? line.getQuantity() : line.qty;
                return total + Number(qty || 0);
            }, 0)
        };
        } catch (error) {
            pbCopyBuilding.delete(String(targetOrder?.uuid || ""));
            const cleanup = await pbDiscardFailedCopy(pos, targetOrder, previousOrder);
            if (!cleanup.removed) {
                error.message += String(pbUiPair("；未完成草稿无法自动删除，已明确标记，请先删除后再重试。", "; no se pudo eliminar el borrador incompleto. Elimínalo antes de reintentar."));
            }
            throw error;
        }
    }

    async function pbCopySelectedPaidOrder(button) {
        if (pbCopyOrderBusy) return;

        var pos = pbGetPosStore();
        var sourceOrder = pbGetSelectedPaidOrder(pos);

        if (!sourceOrder) {
            pbShowOrderCopyToast(pbUiPair("请先在左侧选择已付款订单。","Selecciona primero un pedido pagado en la lista de la izquierda"), true);
            return;
        }

        pbCopyOrderBusy = true;
        button.disabled = true;
        pbActionLabel(button,"fa fa-spinner fa-spin me-1","正在复制…","Copiando…");

        try {
            var copied = await pbCreateCopiedOrder(pos, sourceOrder);
            var targetOrder = copied.order;

            if (typeof pos.setOrder === 'function') pos.setOrder(targetOrder);
            pos.ticket_screen_mobile_pane = 'left';

            if (typeof pos.navigate === 'function') {
                pos.navigate('ProductScreen', { orderUuid: targetOrder.uuid });
            } else if (typeof pos.showScreen === 'function') {
                pos.showScreen('ProductScreen');
            }

            pbShowOrderCopyToast(
                pbUiPair(`已复制 ${copied.lineCount} 行、${copied.totalQty} 件到新订单。`,`Se copiaron ${copied.lineCount} líneas, con ${copied.totalQty} piezas, a un pedido nuevo`),
                false
            );
        } catch (error) {
            console.error('[POS Copy Paid Order] Error al copiar:', error);
            pbShowOrderCopyToast(pbUiPair("复制失败：" + (error.message || "未知错误"),"Error al copiar: " + (error.message || "Error desconocido")), true);
        } finally {
            pbCopyOrderBusy = false;
            if (button && document.body.contains(button)) {
                button.disabled = false;
                pbActionLabel(button,"fa fa-copy me-1","复制订单","Copiar pedido");
            }
        }
    }

    function processCopyOrderButton() {
        pbInstallCopyRecovery();
        var controls = document.querySelector('.ticket-screen .pads .control-buttons');

        if (!controls) return;

        var button = controls.querySelector('#pb-copy-paid-order-btn');

        if (!button) {
            button = document.createElement('button');
            button.id = 'pb-copy-paid-order-btn';
            button.type = 'button';
            button.className =
                'control-button btn btn-success btn-lg lh-lg flex-grow-1 flex-shrink-1';
            button.title = pbUiPair("将选中的已付款订单复制为新的未付款订单","Copiar el pedido pagado seleccionado a un pedido nuevo sin pagar");
            pbActionLabel(button,"fa fa-copy me-1","复制订单","Copiar pedido");
            button.addEventListener('click', function(event) {
                event.preventDefault();
                event.stopPropagation();
                pbCopySelectedPaidOrder(button);
            }, true);
            controls.insertBefore(button, controls.firstChild);
        }

        var sourceOrder = pbGetSelectedPaidOrder(pbGetPosStore());
        button.style.display = sourceOrder && pbGetPositiveOrderLines(sourceOrder).length
            ? ''
            : 'none';
    }


  let orderToolsFrame = 0;
  function refreshOrderTools() {
    if (orderToolsFrame || document.hidden) return;
    orderToolsFrame = requestAnimationFrame(() => {
      orderToolsFrame = 0; processRefundButton(); processCopyOrderButton();
    });
  }
  new MutationObserver(refreshOrderTools).observe(document.body, { childList:true, subtree:true });
  refreshOrderTools();

})();

})();
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once:true}); else start();
}

})();

// ==UserScript==
// @name         Playbox Odoo - 现金明细
// @namespace    https://playboxelectronics1.odoo.com/playbox-suite
// @version      1.0.17
// @description  现金明细；定向修复候选，已通过本地回归，待安装后组合验收。
// @author       Playbox
// @run-at       document-start
// @match        https://*.odoo.com/pos/ui*
// @grant        none
// ==/UserScript==

(function () {
'use strict';

if (location.protocol !== "https:" || !/(^|\.)odoo\.com$/i.test(location.hostname)) return;

if (!/^\/pos\/ui(?:\/|$)/.test(location.pathname)) return;

if (document.documentElement?.hasAttribute("data-pb-suite-cash")) return;
document.documentElement?.setAttribute("data-pb-suite-cash","1.0.17");

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

    if (!document.getElementById("pb-cash-style")) {
      const style = document.createElement("style");
      style.id = "pb-cash-style";
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

  async function getActiveSessionId() {
    const pos = window.posmodel;
    const session = pos?.session || pos?.pos_session || pos?.config?.current_session_id;
    const id = Number(session?.id || (Array.isArray(session) ? session[0] : 0));
    if (Number.isInteger(id) && id > 0) return id;
    const configId = Number(pos?.config?.id);
    if (Number.isInteger(configId) && configId > 0) {
        const sessions = await callOdoo("pos.session", "search_read",
            [[["config_id", "=", configId], ["state", "in", ["opened", "opening_control", "closing_control"]]]],
            { fields: ["id"], order: "id desc", limit: 2 });
        if (sessions.length === 1) return sessions[0].id;
    }
    throw new Error(pbUiPair("无法唯一确定当前 POS 会话，已停止查询其他收银机的数据。","No se pudo identificar una única sesión de este POS. No se consultaron otras cajas."));
  }

  function escapeCashText(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  async function openCashLog() {
    try {
        await withLoading(async () => {
            const sessionId = await getActiveSessionId();
            const lines = await callOdoo('account.bank.statement.line', 'search_read', [[['pos_session_id', '=', sessionId]]], { fields: ['date', 'payment_ref', 'amount'], order: 'id desc' });

            let html = '';
            if (!lines.length) {
                html = '<div class="pb-empty-state" data-pb-static-zh="当前会话暂无现金记录" data-pb-static-es="No hay movimientos de efectivo en esta sesión">'+pbUiText("当前会话暂无现金记录","No hay movimientos de efectivo en esta sesión")+'</div>';
            } else {
                html = `<table class="pb-table">
                  <thead><tr><th style="width:110px" data-pb-static-zh="日期" data-pb-static-es="Fecha">${pbUiText("日期","Fecha")}</th><th data-pb-static-zh="原因 / 备注" data-pb-static-es="Motivo / nota">${pbUiText("原因 / 备注","Motivo / nota")}</th><th style="width:120px;text-align:right" data-pb-static-zh="金额" data-pb-static-es="Importe">${pbUiText("金额","Importe")}</th></tr></thead>
                  <tbody>`;
                lines.forEach(l => {
                    const amount = parseFloat(l.amount);
                    const isPositive = amount >= 0;
                    const amountClass = isPositive ? 'pb-amount-in' : 'pb-amount-out';
                    const sign = isPositive ? '+' : '';
                    let labelText = l.payment_ref || pbUiText('无备注','Sin nota');
                    labelText = labelText.replace(/PLAYBOX ELECTRONICS\s+[\w]+\/\d+-/gi, '');
                    labelText = labelText.replace(/在-/g, '收入: ').replace(/out-/g, '支出: ');
                    const dateStr = l.date.split(" ")[0];
                    html += `<tr>
                        <td class="pb-col-date">${escapeCashText(dateStr)}</td>
                        <td><div style="font-weight:500; word-break: break-word;">${escapeCashText(labelText)}</div></td>
                        <td class="${amountClass}" style="text-align:right">${sign}${amount.toFixed(2)}</td>
                    </tr>`;
                });
                html += '</tbody></table>';
            }
            await showModal({ title: pbUiPair("现金进出明细","Movimientos de efectivo"), html: html, width: '520px', buttons: [{ label: pbUiPair("关闭","Cerrar"), value: true, primary: true }] });
        });
    } catch (e) {
        let msg = e.message;
        if (/Access Error|Access Denied/i.test(msg)) msg = pbUiPair("权限不足 (Access Error)\n\n账号无法读取 account.bank.statement.line。\n请联系管理员给 'POS/User' 组添加读取权限。","No tienes permiso para consultar movimientos de efectivo. Pide al administrador que revise los permisos de tu cuenta.");
        showAlert(msg, pbUiPair("查询失败","Error de consulta"));
    }
  }

  function addIntegratedButton() {
    if (document.getElementById("pb-cash-btn")) return;
    const container = document.querySelector('.control-buttons');
    if (!container) return;
    const btn = document.createElement("button");
    btn.id = "pb-cash-btn";
    btn.className = "btn btn-secondary btn-lg lh-lg flex-shrink-0";
    btn.style.fontWeight = "600";
    btn.textContent = pbUiText("现金明细","E/S Efect");
    btn.onclick = openCashLog;
    const moreBtn = container.querySelector('.more-btn');
    if (moreBtn) container.insertBefore(btn, moreBtn);
    else container.appendChild(btn);
  }


  PBUI.subscribe(()=>{
    const button=document.getElementById("pb-cash-btn");
    if(button) button.textContent=pbUiText("现金明细","E/S Efect");
  });
  let cashFrame = 0;
  const cashObserver = new MutationObserver(() => {
    if (cashFrame || document.hidden) return;
    cashFrame = requestAnimationFrame(() => { cashFrame = 0; addIntegratedButton(); });
  });
  ensureModalDom(); addIntegratedButton();
  cashObserver.observe(document.body, { childList: true, subtree: true });

})();

})();
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once:true}); else start();
}

})();

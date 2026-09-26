/* 模块-组件-弹层-dialog.js · 契约 C5（签名照《开发计划》7.2 逐字）
 *   confirm({title, message, confirmText, danger})  →  Promise<boolean>
 *   toast(message, type)                            //  'success' | 'error' | 'info'，约 2.5s 自动消失
 * 依赖：无（最先加载）。渲染进 index.html 的 #dialog-root。
 * 约束：同一时刻只允许一个 confirm；Esc 视为 false；danger=true 时确认按钮红色（.btn-danger）。
 * 安全：文案一律 textContent 写入，不拼接 innerHTML。
 */
const Dialog = (function () {
  'use strict';

  var confirmLayer = null; // 承载 .dialog-overlay 的持久层
  var toastLayer = null;   // 承载 .toast 的持久层（与 confirm 互不影响）
  var activeConfirm = null; // { settle } 当前在场 confirm，保证同时只有一个

  function getRoot() {
    var el = document.getElementById('dialog-root');
    if (!el) {
      // 骨架缺失时兜底创建，保证不抛错
      el = document.createElement('div');
      el.id = 'dialog-root';
      document.body.appendChild(el);
    }
    return el;
  }

  function ensureLayer(cached, className) {
    if (cached && cached.isConnected) return cached;
    var el = document.createElement('div');
    el.className = className;
    getRoot().appendChild(el);
    return el;
  }

  function confirm(options) {
    options = options || {};
    // 同一时刻只允许一个 confirm：旧的先以 false 结掉
    if (activeConfirm) {
      try { activeConfirm.settle(false); } catch (e) { /* ignore */ }
    }

    return new Promise(function (resolve) {
      confirmLayer = ensureLayer(confirmLayer, 'dialog-confirm-layer');

      var overlay = document.createElement('div');
      overlay.className = 'dialog-overlay';

      var card = document.createElement('div');
      card.className = 'dialog-card';
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');

      var titleEl = document.createElement('h3');
      titleEl.className = 'dialog-title';
      titleEl.textContent = options.title || '确认操作';

      var msgEl = document.createElement('p');
      msgEl.className = 'dialog-message';
      msgEl.textContent = options.message || '';

      var actions = document.createElement('div');
      actions.className = 'dialog-actions';

      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-ghost';
      cancelBtn.textContent = '取消';

      var okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'btn ' + (options.danger ? 'btn-danger' : 'btn-primary');
      okBtn.textContent = options.confirmText || '确定';

      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);
      card.appendChild(titleEl);
      card.appendChild(msgEl);
      card.appendChild(actions);
      overlay.appendChild(card);
      confirmLayer.appendChild(overlay);

      var settled = false;

      function settle(result) {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey, true);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (activeConfirm && activeConfirm.settle === settle) activeConfirm = null;
        resolve(result);
      }

      function onKey(ev) {
        if (ev.key === 'Escape' || ev.keyCode === 27) {
          ev.preventDefault();
          ev.stopPropagation();
          settle(false);
        }
      }

      cancelBtn.addEventListener('click', function () { settle(false); });
      okBtn.addEventListener('click', function () { settle(true); });
      overlay.addEventListener('click', function (ev) {
        // 点击遮罩空白处视为取消（卡片内部点击不关闭）
        if (ev.target === overlay) settle(false);
      });
      document.addEventListener('keydown', onKey, true);

      activeConfirm = { settle: settle };
      // 焦点落到确认按钮，便于键盘操作
      try { okBtn.focus(); } catch (e) { /* ignore */ }
    });
  }

  function toast(message, type, duration) {
    type = type || 'info';
    if (typeof duration !== 'number') duration = 2500;

    toastLayer = ensureLayer(toastLayer, 'dialog-toast-wrap');

    var item = document.createElement('div');
    item.className = 'toast toast-' + type;
    item.setAttribute('role', type === 'error' ? 'alert' : 'status');
    item.textContent = message == null ? '' : String(message);

    toastLayer.appendChild(item);
    // 下一帧加入 .toast-in 触发入场过渡
    requestAnimationFrame(function () { item.classList.add('toast-in'); });

    var timer = setTimeout(function () {
      item.classList.remove('toast-in');
      item.classList.add('toast-out');
      setTimeout(function () {
        if (item.parentNode) item.parentNode.removeChild(item);
      }, 240);
    }, duration);

    // 点击可提前关闭
    item.addEventListener('click', function () {
      clearTimeout(timer);
      if (item.parentNode) item.parentNode.removeChild(item);
    });
  }

  return { confirm: confirm, toast: toast };
})();

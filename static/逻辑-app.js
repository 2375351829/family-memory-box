/* 逻辑-app.js · 契约 C3（签名照《开发计划》7.2 逐字）
 *   const routes = { home, members, draw, story, memoir };
 *   navigate(viewId, params)   // 切换视图；hash 形如 #/draw、#/story?topic=7&member=1（解析 query）
 *   init()                     // DOMContentLoaded：Store.loadAll() → navigate('home')
 * 依赖：Store / API / Dialog（均由前置脚本提供），以及 A4/A5 的视图渲染函数（可能为占位未定义）。
 *
 * 视图渲染函数约定（本单派生的契约，已在工单中与 A4/A5 对齐）：
 *   home    → renderHome(el)
 *   members → renderMembers(el)
 *   draw    → renderDraw(el)
 *   story   → renderStory(el, topic, member)
 *   memoir  → renderMemoir(el, view)
 * 用 typeof 探测存在性（占位文件未定义时安全回落，不抛错）。
 */
const routes = {
  home: 'view-home',
  members: 'view-members',
  draw: 'view-draw',
  story: 'view-story',
  memoir: 'view-memoir',
};

const DEFAULT_VIEW = 'home';
const VIEW_LABELS = {
  home: '首页',
  members: '家人设置',
  draw: '抽题盒子',
  story: '讲故事',
  memoir: '回忆录',
};

// hash 序列化：#/draw 、#/story?topic=7&member=1
function buildHash(viewId, params) {
  var hash = '#/' + viewId;
  if (params) {
    var parts = [];
    for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
      var v = params[k];
      if (v === undefined || v === null || v === '') continue;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
    if (parts.length) hash += '?' + parts.join('&');
  }
  return hash;
}

// hash 解析：→ { view, params }；无 hash 时返回 null
function parseHash() {
  var raw = window.location.hash || '';
  if (raw.charAt(0) === '#') raw = raw.slice(1);
  if (raw.charAt(0) === '/') raw = raw.slice(1);
  if (!raw) return null;

  var qIdx = raw.indexOf('?');
  var path = qIdx === -1 ? raw : raw.slice(0, qIdx);
  var query = qIdx === -1 ? '' : raw.slice(qIdx + 1);

  var params = {};
  if (query) {
    var pairs = query.split('&');
    for (var i = 0; i < pairs.length; i++) {
      if (!pairs[i]) continue;
      var eq = pairs[i].indexOf('=');
      var key = eq === -1 ? pairs[i] : pairs[i].slice(0, eq);
      var val = eq === -1 ? '' : pairs[i].slice(eq + 1);
      try {
        key = decodeURIComponent(key);
        val = decodeURIComponent(val.replace(/\+/g, ' '));
      } catch (e) { /* 保留原始值 */ }
      params[key] = val;
    }
  }
  return { view: path, params: params };
}

function setHash(viewId, params) {
  var hash = buildHash(viewId, params);
  if (window.location.hash === hash) return false;
  window.location.hash = hash;
  return true;
}

// 切换视图：写 hash；hash 未变则直接渲染（hashchange 不会触发）
function navigate(viewId, params) {
  if (!Object.prototype.hasOwnProperty.call(routes, viewId)) viewId = DEFAULT_VIEW;
  if (!setHash(viewId, params)) render();
}

// 激活目标视图容器 + 导航高亮 + 首页氛围类
function activateView(viewId) {
  var ids = Object.keys(routes);
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(routes[ids[i]]);
    if (el) el.classList.toggle('is-active', ids[i] === viewId);
  }

  var nav = document.getElementById('app-nav');
  if (nav) {
    var items = nav.querySelectorAll('[data-nav]');
    for (var j = 0; j < items.length; j++) {
      items[j].classList.toggle('is-active', items[j].getAttribute('data-nav') === viewId);
    }
  }

  document.body.classList.toggle('is-home', viewId === 'home');
}

// 占位容错：视图渲染函数未定义时，显示「模块开发中」卡片（复用 .empty-state）
function renderPlaceholder(el, viewId) {
  clearEl(el);
  var box = document.createElement('div');
  box.className = 'empty-state';

  var title = document.createElement('p');
  title.className = 'empty-title';
  title.textContent = VIEW_LABELS[viewId] ? (VIEW_LABELS[viewId] + '模块开发中') : '模块开发中';

  var text = document.createElement('p');
  text.className = 'empty-text';
  text.textContent = '该视图将由后续工单实现，敬请期待。';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-primary';
  btn.textContent = '返回首页';
  btn.addEventListener('click', function () { navigate('home'); });

  box.appendChild(title);
  box.appendChild(text);
  box.appendChild(btn);
  el.appendChild(box);
}

// 加载失败引导（不白屏）
function renderLoadError(message) {
  var el = document.getElementById(routes[DEFAULT_VIEW]);
  if (!el) return;
  clearEl(el);
  var box = document.createElement('div');
  box.className = 'empty-state';

  var title = document.createElement('p');
  title.className = 'empty-title';
  title.textContent = '加载失败';

  var text = document.createElement('p');
  text.className = 'empty-text';
  text.textContent = message || '无法连接后端服务，请确认服务已启动后重试。';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-primary';
  btn.textContent = '重试';
  btn.addEventListener('click', function () { bootstrap(); });

  box.appendChild(title);
  box.appendChild(text);
  box.appendChild(btn);
  el.appendChild(box);
}

function clearEl(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// 调用视图渲染函数；未定义或抛错时回落到占位卡片
function callRenderer(el, viewId, fn, args) {
  if (typeof fn !== 'function') {
    renderPlaceholder(el, viewId);
    return;
  }
  try {
    fn.apply(null, args);
  } catch (e) {
    if (window.console) console.error('[app] 视图渲染异常：' + viewId, e);
    renderPlaceholder(el, viewId);
  }
}

// 视图调度：按 viewId 解析上下文参数并分派
function dispatch(viewId, params) {
  var el = document.getElementById(routes[viewId]);
  if (!el) return;

  switch (viewId) {
    case 'home':
      callRenderer(el, viewId, typeof renderHome === 'function' ? renderHome : null, [el]);
      break;
    case 'members':
      callRenderer(el, viewId, typeof renderMembers === 'function' ? renderMembers : null, [el]);
      break;
    case 'draw':
      callRenderer(el, viewId, typeof renderDraw === 'function' ? renderDraw : null, [el]);
      break;
    case 'story':
      callRenderer(
        el, viewId,
        typeof renderStory === 'function' ? renderStory : null,
        [el, Store.getTopic(params.topic), Store.getMember(params.member)]
      );
      break;
    case 'memoir':
      callRenderer(
        el, viewId,
        typeof renderMemoir === 'function' ? renderMemoir : null,
        [el, params.view || 'timeline']
      );
      break;
    default:
      renderPlaceholder(el, viewId);
  }
}

// 渲染当前 hash 对应视图；非法 hash 回落 #/home
function render() {
  var parsed = parseHash();
  if (!parsed || !Object.prototype.hasOwnProperty.call(routes, parsed.view)) {
    if (window.location.hash !== '#/home') {
      // 用 replaceState 修正，不产生额外历史、不触发 hashchange（避免递归）
      try { window.history.replaceState(null, '', '#/home'); } catch (e) { window.location.hash = '#/home'; }
    }
    parsed = { view: DEFAULT_VIEW, params: {} };
  }
  activateView(parsed.view);
  dispatch(parsed.view, parsed.params);
}

// 启动：拉全量 → notify() 触发 render
async function bootstrap() {
  try {
    await Store.loadAll();
  } catch (e) {
    renderLoadError(e && e.message);
  }
}

function bindNav() {
  var nav = document.getElementById('app-nav');
  if (!nav) return;
  nav.addEventListener('click', function (ev) {
    var node = ev.target;
    while (node && node !== nav) {
      if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute('data-nav')) {
        navigate(node.getAttribute('data-nav'));
        return;
      }
      node = node.parentNode;
    }
  });
}

// DOMContentLoaded：初始化订阅/监听 → Store.loadAll() → 渲染当前 hash（默认 home）
function init() {
  Store.subscribe(function () { render(); });
  window.addEventListener('hashchange', render);
  bindNav();
  // 修正空/非法 hash 后再拉数据
  var parsed = parseHash();
  if (!parsed || !Object.prototype.hasOwnProperty.call(routes, parsed.view)) {
    try { window.history.replaceState(null, '', buildHash(DEFAULT_VIEW)); } catch (e) { /* ignore */ }
  }
  bootstrap();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

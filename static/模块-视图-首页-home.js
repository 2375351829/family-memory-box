/* 模块-视图-首页-home.js · 工单 A5（F14 双节视觉 / 统计卡 / F17 倒计时与到期提醒）
 * 职责：首页入口——双节氛围（月亮升起 + 灯笼摇曳）→ 三统计卡 → 主按钮「开始抽题」
 *       + 下个中秋倒计时（固定日期表，超范围显式提示）+ 时间胶囊列表与到期提醒。
 * 契约（顶层函数声明，供 逻辑-app.js 用 typeof 探测 / 工单 §4 追加签名）：
 *   renderHome(el)
 * 消费：C1 API.openCapsule；C3 navigate；C4 Store.stats/getMember/upsertCapsule/state；
 *       C5 Dialog.confirm/toast；C6 复用 A3 的 #festive-decor 容器与 .anim-* 动效类，
 *       专属类前缀 .view-home-。
 * 安全：胶囊标题、正文、成员称谓等一律 textContent / createElement 写入，不拼接标记字符串。
 * 关键设计：Store.notify() 会整视图重渲染，故倒计时定时器与「已提醒胶囊」标记落在模块级变量，
 *           重渲染时清理旧定时器、避免重复弹层；视图失活时定时器自停，避免泄漏。
 */

// ── 模块级状态（跨重渲染恢复 / 需清理）──────────────────────────
var _homeTimer = null;        // 倒计时刷新定时器
var _homeCountdownEl = null;  // 倒计时文案节点（定时器目标）
var _homeReminded = {};       // 已弹过到期提醒的胶囊 id（本会话去重）
var _homeFormOpen = false;    // 创建表单展开态（Store.notify 重渲染后据此恢复）
var _homeCalOpen = false;     // 节日日历是否展开全年（同上，跨重渲染恢复）
var _homeLanUrl = null;       // localhost 场景检测到的本机局域网地址（如 http://10.5.80.99:5080）

// 固定中秋日期表（8.5，覆盖至 2030；超出须显式提示，禁止猜测计算）
var MID_AUTUMN_DATES = ['2026-09-25', '2027-09-15', '2028-10-03', '2029-09-22', '2030-09-12'];

// 节日进站提示的去重键（sessionStorage：同一会话内同一节日只提示一次）
var FESTIVAL_TIP_KEY = 'fmb-festival-tip';

// 小工具：创建元素并写入纯文本
function _homeEl(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// 今天（本地时区）零点的 Date
function _homeToday() {
  var d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// 今天（本地时区）的 YYYY-MM-DD 字符串，用于与胶囊 open_date 直接比较
function _homeTodayStr() {
  var d = new Date();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

// 解析 YYYY-MM-DD 为本地零点 Date；非法返回 null
function _homeParseDate(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  var p = dateStr.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

// 距指定日期的剩余天数（可为 0 / 负）；非法日期返回 null
function _homeDaysUntil(dateStr) {
  var d = _homeParseDate(dateStr);
  if (!d) return null;
  return Math.round((d.getTime() - _homeToday().getTime()) / 86400000);
}

// 下个中秋：日期表就近未来匹配；全部已过 → 标记过期（8.5）
function _homeCountdown() {
  var today = _homeToday().getTime();
  for (var i = 0; i < MID_AUTUMN_DATES.length; i++) {
    var d = _homeParseDate(MID_AUTUMN_DATES[i]);
    if (d && d.getTime() >= today) {
      return { expired: false, days: Math.round((d.getTime() - today) / 86400000) };
    }
  }
  return { expired: true, days: null };
}

// 倒计时文案（过期时显式提示，不静默给错天数）
function _homeCountdownText(info) {
  if (info.expired) return '中秋日期表已过期，请更新';
  if (info.days === 0) return '今天就是中秋节！';
  return '距离下个中秋还有 ' + info.days + ' 天';
}

// ── 视图入口 ──────────────────────────────────────────────
function renderHome(el) {
  if (!el) return;
  _homeClearTimer();              // 重渲染前先清理旧定时器
  _homeMountDecor();              // 填充常驻的双节氛围容器（#festive-decor 在视图之外）

  el.textContent = '';
  el.appendChild(_homeHero());
  el.appendChild(_homeStats());
  el.appendChild(_homePrimary());
  el.appendChild(_homeCalendar());
  el.appendChild(_homeCapsules());
  el.appendChild(_homeAccess());

  _homeStartTimer();              // 启动倒计时刷新
  _homeMaybeRemind();             // 到期胶囊自动提醒
  _homeMaybeFestivalTip();        // 节日当天进站提示（本会话按节日去重）
}

// ── 节日（由 模块-主题-节日-festival-theme.js 提供）────────────
// 取当前生效的节日条目（引擎已在首帧前加载；异常时静默回落为无节日）
function _homeFestival() {
  try {
    if (window.FestivalTheme && typeof window.FestivalTheme.currentFestival === 'function') {
      return window.FestivalTheme.currentFestival();
    }
  } catch (e) { /* 引擎不可用时按无节日处理 */ }
  return null;
}

// 节日徽标：图标取自当日节日的纹样遮罩，配色随 [data-festival] 落地
// 手动预览时前缀改为「预览」，避免误认为今天真的过节
function _homeFestivalBadge(fest) {
  var badge = _homeEl('div', 'view-home-festival');
  var ico = _homeEl('span', 'view-home-festival-ico');
  ico.setAttribute('aria-hidden', 'true');
  badge.appendChild(ico);
  var prefix = _homePreviewKey() ? '预览 · ' : '今日 · ';
  badge.appendChild(_homeEl('span', 'view-home-festival-text', prefix + fest.name));
  return badge;
}

// 节日当天首次进入：一条 info toast 提示（不当弹层打断操作），同一天同一节日只提示一次
// 注意：手动预览时**不提示**——否则会把「预览万圣节」说成「今天是万圣节」，误导用户
function _homeMaybeFestivalTip() {
  if (_homePreviewKey()) return;
  var fest = _homeFestival();
  if (!fest) return;
  var key = _homeTodayStr() + '|' + fest.key;
  try {
    if (window.sessionStorage.getItem(FESTIVAL_TIP_KEY) === key) return;
    window.sessionStorage.setItem(FESTIVAL_TIP_KEY, key);
  } catch (e) { /* 隐私模式下 sessionStorage 不可用：退化为每次进入都提示 */ }
  var greet = (fest.el && fest.el.greeting) ? fest.el.greeting : '节日快乐';
  Dialog.toast('今天是' + fest.name + ' · ' + greet, 'info');
}

// ── 节日日历（全年 27 个节日；默认只展开最近 4 个）──────────────
// 数据来自 window.FestivalTheme.yearList()：农历 9 + 公历 18，公历含"N 个星期几"规则。
// 折叠态默认展开最近 4 个未过节日，避免首页被 27 行撑得过长。
function _homeCalList() {
  try {
    if (window.FestivalTheme && typeof window.FestivalTheme.yearList === 'function') {
      return window.FestivalTheme.yearList(new Date().getFullYear());
    }
  } catch (e) { /* 引擎不可用时该卡显示提示 */ }
  return null;
}

function _homeCalendar() {
  var sec = _homeEl('section', 'view-home-panel view-home-calendar');
  var year = new Date().getFullYear();
  var list = _homeCalList();
  var previewing = _homePreviewKey();

  var head = _homeEl('div', 'view-home-panel-head');
  head.appendChild(_homeEl('h3', 'view-home-panel-title', '节日日历 · ' + year));
  head.appendChild(_homeEl('span', 'view-home-panel-meta', list ? (list.length + ' 个节日') : '—'));
  sec.appendChild(head);

  if (!list) {
    sec.appendChild(_homeEl('p', 'view-home-dim', '节日引擎未就绪，暂时无法显示节日日历。'));
    return sec;
  }
  if (!list[0].lunarCovered) {
    sec.appendChild(_homeEl('p', 'view-home-dim', '农历节日日期表覆盖 2025–2030，本年仅显示公历节日。'));
  }

  // 预览态提示条：明确「这是手动预览、不是今天真的过节」，并给一键回到自动
  if (previewing) {
    var bar = _homeEl('div', 'view-home-cal-bar');
    bar.appendChild(_homeEl('span', 'view-home-cal-bar-text',
      '正在预览「' + _homeCalName(previewing) + '」主题（仅本页预览，刷新即回到自动）'));
    var reset = _homeEl('button', 'btn btn-ghost view-home-cal-reset', '回到自动');
    reset.type = 'button';
    reset.addEventListener('click', function () { _homePreviewFestival(null); });
    bar.appendChild(reset);
    sec.appendChild(bar);
  } else {
    // 自动态：只有真的在节日窗口内才提示，避免误以为天天过节
    var fest = _homeFestival();
    if (fest) {
      sec.appendChild(_homeEl('p', 'view-home-cal-now', '今天是' + fest.name + '（节日主题已启用）'));
    } else {
      sec.appendChild(_homeEl('p', 'view-home-dim', '点下面任意节日即可切换查看该节日的主题效果。'));
    }
  }

  if (_homeCalOpen) {
    // 展开：按月分组列出全年
    var months = _homeEl('div', 'view-home-cal-months');
    var curMonth = 0;
    var group = null;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (it.month !== curMonth) {
        curMonth = it.month;
        group = _homeEl('div', 'view-home-cal-month');
        group.appendChild(_homeEl('p', 'view-home-cal-month-title', curMonth + ' 月'));
        months.appendChild(group);
      }
      group.appendChild(_homeCalRow(it));
    }
    sec.appendChild(months);
  } else {
    // 折叠：最近 4 个「今天及以后」的节日（若都在今年之前则退回前 4 个）
    var upcoming = [];
    for (var k = 0; k < list.length; k++) {
      if (list[k].daysUntil >= 0) upcoming.push(list[k]);
      if (upcoming.length === 4) break;
    }
    if (!upcoming.length) upcoming = list.slice(-4);
    var wrap = _homeEl('div', 'view-home-cal-list');
    for (var m = 0; m < upcoming.length; m++) wrap.appendChild(_homeCalRow(upcoming[m]));
    sec.appendChild(wrap);
  }

  var toggle = _homeEl('button', 'btn btn-ghost view-home-cal-toggle',
    _homeCalOpen ? '收起全年节日' : ('查看全年 ' + list.length + ' 个节日'));
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', _homeCalOpen ? 'true' : 'false');
  toggle.addEventListener('click', function () {
    _homeCalOpen = !_homeCalOpen;
    Store.notify();   // 重渲染后由 _homeCalOpen 恢复展开态
  });
  sec.appendChild(toggle);
  return sec;
}

// 当前预览的节日 key（引擎未就绪时为 null）
function _homePreviewKey() {
  try {
    if (window.FestivalTheme && typeof window.FestivalTheme.previewKey === 'function') {
      return window.FestivalTheme.previewKey();
    }
  } catch (e) { /* 引擎不可用按未预览处理 */ }
  return null;
}

function _homeCalName(key) {
  try {
    var e = window.FestivalTheme && window.FestivalTheme.byKey(key);
    return e ? e.name : key;
  } catch (err) { return key; }
}

// 切换预览：key 为空表示「回到自动」
function _homePreviewFestival(key) {
  try {
    if (!window.FestivalTheme) return;
    if (key) window.FestivalTheme.applyFestival(key);
    else window.FestivalTheme.clearPreview();
    Store.notify();   // 重渲染首页：徽标/提示条/行高亮跟随切换
    Dialog.toast(key
      ? ('已切换到「' + _homeCalName(key) + '」主题，点「回到自动」或刷新可恢复')
      : '已回到按当天自动切换', 'info');
  } catch (e) { /* 引擎异常时不阻断界面 */ }
}

// 单个节日行：整行可点即切换预览（用 button 以获得键盘可达性）
function _homeCalRow(it) {
  var previewing = _homePreviewKey();
  var isPrev = previewing === it.key;
  var row = document.createElement('button');
  row.type = 'button';
  row.className = 'view-home-cal-row' + (it.isToday ? ' is-today' : '') +
    (it.daysUntil < 0 && !isPrev ? ' is-past' : '') + (isPrev ? ' is-preview' : '');
  row.setAttribute('aria-pressed', isPrev ? 'true' : 'false');
  row.title = '查看' + it.name + '的节日主题';

  var ico = _homeEl('span', 'view-home-cal-ico');
  ico.setAttribute('aria-hidden', 'true');
  ico.setAttribute('data-festival', it.key);   // CSS 依此取该节日的纹样遮罩与主色
  row.appendChild(ico);

  row.appendChild(_homeEl('span', 'view-home-cal-date', it.month + '/' + it.day));
  row.appendChild(_homeEl('span', 'view-home-cal-name', it.name));
  row.appendChild(_homeEl('span', 'view-home-cal-when', _homeCalWhenText(it)));
  row.appendChild(_homeEl('span', 'view-home-cal-go', isPrev ? '预览中' : '切换'));

  row.addEventListener('click', function () {
    // 再点同一行 = 取消预览，回到自动（无需另找「回到自动」按钮）
    _homePreviewFestival(isPrev ? null : it.key);
  });
  return row;
}

function _homeCalWhenText(it) {
  if (it.isToday) return '今天';
  if (it.daysUntil > 0) return '还有 ' + it.daysUntil + ' 天';
  return '已过';
}

// ── 手机上看（三端同一份数据：地址 + 二维码 + 连接信息）──────────
// 三端（PC/平板/手机）访问同一后端即同一份 SQLite 数据，无需同步码。
// 若当前是用 localhost/127.0.0.1 打开的，后端 /api/health 会返回本机局域网地址 lan_urls，
// 前端自动与之对齐（地址/二维码/复制按钮/提示文案全部同步为真实局域网地址），
// 而不是写死示例 IP —— 端口也保持一致（如 http://192.168.x.x:5080）。
function _homeAccess() {
  var sec = _homeEl('section', 'view-home-panel view-home-access');
  var origin = window.location.origin;
  var isLocal = /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
  // localhost 场景下已检测到的局域网地址（模块级缓存）：二次渲染直接用，避免异步竞态
  var share = (isLocal && _homeLanUrl) ? _homeLanUrl : origin;

  var head = _homeEl('div', 'view-home-panel-head');
  head.appendChild(_homeEl('h3', 'view-home-panel-title', '手机上看'));
  sec.appendChild(head);

  var body = _homeEl('div', 'view-home-access-body');

  var left = _homeEl('div', 'view-home-access-info');
  left.appendChild(_homeEl('p', 'view-home-access-label', isLocal && _homeLanUrl ? '手机用这个地址' : '当前访问地址'));
  var url = _homeEl('p', 'view-home-access-url', share);
  left.appendChild(url);

  // localhost 提示位（占位，检测到真实局域网地址后原地更新文案）
  var warn = null;
  if (isLocal) {
    warn = _homeEl('p', 'view-home-access-warn', _homeLanUrl
      ? '当前是 localhost，手机打不开。已自动找到本机局域网地址，手机扫右侧二维码即可打开同一份数据。'
      : '当前是 localhost，手机打不开。正在检测本机局域网地址…');
    left.appendChild(warn);
  }

  var s = Store.stats();
  left.appendChild(_homeEl('p', 'view-home-access-stats',
    '已连同一份数据：' + s.memberCount + ' 位家人 / ' + s.storyCount + ' 个故事 / ' +
    s.photoCount + ' 张照片 / ' + (Store.state.capsules || []).length + ' 个时间胶囊'));

  var copy = _homeEl('button', 'btn btn-ghost view-home-access-copy', '复制地址');
  copy.type = 'button';
  copy.addEventListener('click', function () { _homeCopyOrigin(url.textContent); });
  left.appendChild(copy);

  body.appendChild(left);

  // 二维码框（localhost 场景优先用局域网地址；检测到后重绘）
  var qrBox = _homeEl('div', 'view-home-access-qrbox');
  body.appendChild(qrBox);
  _homeDrawQR(qrBox, share);

  sec.appendChild(body);
  sec.appendChild(_homeEl('p', 'view-home-access-note',
    'PC / 平板 / 手机只要打开同一个地址，看到的就是同一份家人与故事，不需要同步码或账号。'));

  // localhost 且尚未检测过：向后端要真实局域网地址并同步 UI
  if (isLocal && !_homeLanUrl) {
    _homeSyncLanAddress(url, warn, qrBox);
  }
  return sec;
}

// 用 /api/health 返回的 lan_urls 与当前 origin 对齐（同协议同端口），更新地址/提示/二维码
function _homeSyncLanAddress(urlEl, warnEl, qrBox) {
  var curPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
  var curProto = window.location.protocol;
  try {
    // 注意：api.js 用的是 `const API = ...`（经典脚本的全局词法绑定），不在 window 上，必须裸名引用
    if (typeof API !== 'undefined' && typeof API.health === 'function') {
      API.health().then(function (data) {
        var lan = (data && data.lan_urls) || [];
        // 只挑与当前协议、端口一致的那条（浏览器可能有多网卡，多条取第一条）
        var matched = null;
        for (var i = 0; i < lan.length; i++) {
          var u = lan[i];
          var m = /^(https?):\/\/([^:/]+):(\d+)$/.exec(u);
          if (m && (m[1] + ':') === curProto && m[3] === curPort) { matched = u; break; }
        }
        if (!matched && lan.length) {
          // 协议端口对不上也兜底：取第一条真实局域网地址，并把它修正为当前协议端口
          var mm = /^https?:\/\/([^:/]+)(?::\d+)?$/.exec(lan[0]);
          matched = mm ? curProto + '//' + mm[1] + ':' + curPort : null;
        }
        if (matched) {
          _homeLanUrl = matched;                 // 缓存：后续重渲染直接用
          urlEl.textContent = matched;
          if (urlEl.previousSibling) urlEl.previousSibling.textContent = '手机用这个地址';
          if (warnEl) warnEl.textContent =
            '当前是 localhost，手机打不开。已自动找到本机局域网地址，手机扫右侧二维码即可打开同一份数据。';
          _homeDrawQR(qrBox, matched);
        } else {
          if (warnEl) warnEl.textContent =
            '当前是 localhost，手机打不开。请用电脑/NAS 的局域网 IP 访问（端口 ' + curPort + '）后，再用二维码。';
        }
      }).catch(function () {
        if (warnEl) warnEl.textContent =
          '当前是 localhost，手机打不开。请用电脑/NAS 的局域网 IP 访问（端口 ' + curPort + '）后，再用二维码。';
      });
      return;
    }
  } catch (e) { /* 引擎不可用走兜底 */ }
  if (warnEl) warnEl.textContent =
    '当前是 localhost，手机打不开。请用电脑/NAS 的局域网 IP 访问（端口 ' + curPort + '）后，再用二维码。';
}

// 用 qrcode-generator 生成二维码（离线可用）；库缺失/异常时降级为纯文本提示
function _homeDrawQR(qrBox, address) {
  qrBox.textContent = '';
  try {
    if (typeof window.qrcode === 'function') {
      var qr = window.qrcode(0, 'M');
      qr.addData(address);
      qr.make();
      var img = document.createElement('img');
      img.className = 'view-home-access-qr';
      img.alt = '扫码在手机打开 ' + address;
      img.src = qr.createDataURL(6, 12);
      qrBox.appendChild(img);
      qrBox.appendChild(_homeEl('p', 'view-home-access-qrhint', '手机扫码打开同一份数据'));
      return;
    }
  } catch (e) { /* 库异常走降级 */ }
  qrBox.appendChild(_homeEl('p', 'view-home-access-qrhint', '二维码组件未加载，请在手机浏览器手动输入上方地址。'));
}

// 复制当前地址：优先 Clipboard API，失败回退到选中文本框提示
function _homeCopyOrigin(origin) {
  var done = function () { Dialog.toast('地址已复制，发给家人即可', 'success'); };
  var fallback = function () {
    Dialog.toast('复制失败，请手动长按选中地址：' + origin, 'warn');
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(origin).then(done).catch(fallback);
      return;
    }
  } catch (e) { /* 非安全上下文（http 局域网）无 Clipboard API，走回退 */ }
  fallback();
}

// ── 双节氛围（月亮 + 两侧灯笼，仅在容器为空时挂载一次）────────
function _homeMountDecor() {
  var deco = document.getElementById('festive-decor');
  if (!deco || deco.childElementCount > 0) return;

  var moon = _homeEl('div', 'festive-moon anim-moon-rise');
  moon.setAttribute('aria-hidden', 'true');
  deco.appendChild(moon);

  var left = _homeEl('div', 'festive-lantern anim-lantern view-home-lantern-l');
  left.setAttribute('aria-hidden', 'true');
  deco.appendChild(left);

  var right = _homeEl('div', 'festive-lantern anim-lantern view-home-lantern-r');
  right.setAttribute('aria-hidden', 'true');
  deco.appendChild(right);
}

// ── 顶部标题 + 节日徽标 + 倒计时 ───────────────────────────
// 标题与引导语逐节不同（节日专属文案取自引擎 el.title / el.greeting）；
// 无节日时按季节取文案池（按日期轮换，三端一致、当天固定），不再是一句写死的通用标题。
function _homeHero() {
  var fest = _homeFestival();
  var hero = _homeEl('section', 'view-home-hero');

  if (fest) hero.appendChild(_homeFestivalBadge(fest));

  hero.appendChild(_homeEl('h2', 'page-title view-home-title', _homeHeroTitle(fest)));
  hero.appendChild(_homeEl('p', 'view-home-lead', _homeHeroLead(fest)));

  var info = _homeCountdown();
  _homeCountdownEl = _homeEl('p', 'view-home-countdown', _homeCountdownText(info));
  hero.appendChild(_homeCountdownEl);
  return hero;
}

// 无节日时的季节文案（引擎未就绪返回 null，由调用处兜底）
function _homeSeasonalCopy() {
  try {
    if (window.FestivalTheme && typeof window.FestivalTheme.seasonalCopy === 'function') {
      return window.FestivalTheme.seasonalCopy(new Date());
    }
  } catch (e) { /* 引擎不可用走兜底 */ }
  return null;
}

function _homeHeroTitle(fest) {
  if (fest && fest.el && fest.el.title) return fest.el.title;
  var copy = _homeSeasonalCopy();
  return copy ? copy.title : '家的故事，从一题开始';
}

function _homeHeroLead(fest) {
  if (fest && fest.el && fest.el.greeting) return fest.el.greeting;
  var copy = _homeSeasonalCopy();
  return copy ? copy.lead : '抽个话题，听长辈讲讲那些越来越远的记忆';
}

// ── 三统计卡 ──────────────────────────────────────────────
function _homeStats() {
  var s = Store.stats();
  var wrap = _homeEl('section', 'view-home-stats');
  wrap.appendChild(_homeStatCard(String(s.storyCount), '个故事'));
  wrap.appendChild(_homeStatCard(String(s.memberCount), '位家人'));
  wrap.appendChild(_homeStatCard(String(s.photoCount), '张老照片'));
  return wrap;
}

function _homeStatCard(num, label) {
  var card = _homeEl('div', 'view-home-stat');
  card.appendChild(_homeEl('span', 'view-home-stat-num', num));
  card.appendChild(_homeEl('span', 'view-home-stat-label', label));
  return card;
}

// ── 主按钮 ────────────────────────────────────────────────
function _homePrimary() {
  var wrap = _homeEl('div', 'view-home-actions');
  var btn = _homeEl('button', 'btn btn-primary view-home-start', '开始抽题');
  btn.type = 'button';
  btn.addEventListener('click', function () { navigate('draw'); });
  wrap.appendChild(btn);
  return wrap;
}

// ── 时间胶囊 ──────────────────────────────────────────────
function _homeCapsules() {
  var sec = _homeEl('section', 'view-home-capsules');
  sec.appendChild(_homeEl('h3', 'view-home-section-title', '时间胶囊'));

  var list = Store.state.capsules || [];
  if (!list.length) {
    // 空态只追加提示，不得提前 return，否则会跳过下方创建入口
    sec.appendChild(_homeEl('p', 'view-home-dim',
      '还没有时间胶囊——写下此刻想对未来说的话，到期再一起打开。'));
  } else {
    for (var i = 0; i < list.length; i++) sec.appendChild(_homeCapsuleCard(list[i]));
  }

  // 创建入口：列表之后追加，空/非空列表都显示
  var addBtn = _homeEl('button', 'btn btn-ghost view-home-capsule-add', '封存一个时间胶囊');
  addBtn.type = 'button';
  addBtn.addEventListener('click', function () {
    _homeFormOpen = !_homeFormOpen;
    Store.notify();   // 重渲染后由 _homeFormOpen 恢复展开态
  });
  sec.appendChild(addBtn);

  // 展开态：追加内联创建表单
  if (_homeFormOpen) sec.appendChild(_homeCapsuleForm());
  return sec;
}

// ── 创建胶囊内联表单（F17 创建入口）────────────────────────
// 字段容器：label 文本在上、控件在下
function _homeCapsuleField(labelText, control) {
  var field = _homeEl('label', 'view-home-capsule-field');
  field.appendChild(_homeEl('span', null, labelText));
  field.appendChild(control);
  return field;
}

function _homeCapsuleForm() {
  var form = _homeEl('form', 'view-home-capsule-form');

  var titleInput = _homeEl('input', 'view-home-capsule-input');
  titleInput.type = 'text';
  titleInput.maxLength = 60;
  form.appendChild(_homeCapsuleField('标题', titleInput));

  var contentInput = _homeEl('textarea', 'view-home-capsule-textarea');
  contentInput.rows = 4;
  contentInput.maxLength = 1000;
  form.appendChild(_homeCapsuleField('正文（可空）', contentInput));

  var dateInput = _homeEl('input', 'view-home-capsule-input');
  dateInput.type = 'date';
  form.appendChild(_homeCapsuleField('开启日期', dateInput));

  // 封存者：首项「全家」value=""，其后按成员生成选项
  var memberSelect = _homeEl('select', 'view-home-capsule-select');
  var optAll = _homeEl('option', null, '全家');
  optAll.value = '';
  memberSelect.appendChild(optAll);
  var members = Store.state.members || [];
  for (var i = 0; i < members.length; i++) {
    var opt = _homeEl('option', null, _homeAuthorText(members[i]));
    opt.value = String(members[i].id);
    memberSelect.appendChild(opt);
  }
  form.appendChild(_homeCapsuleField('封存者', memberSelect));

  // 内联错误提示（默认隐藏；校验失败时写入文案并展开，不弹 toast）
  var error = _homeEl('p', 'view-home-capsule-error');
  error.hidden = true;
  form.appendChild(error);

  var actions = _homeEl('div', 'view-home-capsule-form-actions');
  var submitBtn = _homeEl('button', 'btn btn-primary', '封存');
  submitBtn.type = 'submit';
  var cancelBtn = _homeEl('button', 'btn btn-ghost', '取消');
  cancelBtn.type = 'button';
  cancelBtn.addEventListener('click', function () {
    _homeFormOpen = false;
    Store.notify();   // 收起表单（重渲染后清空输入）
  });
  actions.appendChild(submitBtn);
  actions.appendChild(cancelBtn);
  form.appendChild(actions);

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    _homeCreateCapsule({
      title: titleInput.value,
      content: contentInput.value,
      openDate: dateInput.value,
      memberId: memberSelect.value,
      error: error,
    });
  });
  return form;
}

// 提交创建：前端校验 → API.createCapsule → 成功重载列表
async function _homeCreateCapsule(input) {
  var title = (input.title || '').trim();
  var openDate = input.openDate || '';
  var error = input.error;

  // 前端校验（后端不校验日期是否晚于今天）——不通过只做内联提示，不发请求、不弹 toast
  if (!title) { error.textContent = '请填写标题'; error.hidden = false; return; }
  if (!openDate) { error.textContent = '请选择开启日期'; error.hidden = false; return; }
  if (openDate <= _homeTodayStr()) {
    error.textContent = '开启日期必须晚于今天';
    error.hidden = false;
    return;
  }
  error.hidden = true;

  // member_id 为空串时必须传 null（后端校验 isinstance(int)，传 "" 会返回 NOT_FOUND）
  var payload = {
    title: title,
    content: input.content,
    open_date: openDate,
    member_id: input.memberId === '' ? null : Number(input.memberId),
  };

  try {
    await API.createCapsule(payload);
    _homeFormOpen = false;
    await Store.loadAll();   // notify 触发重渲染，胶囊列表自动多出新卡片
    Dialog.toast('时间胶囊已封存', 'success');
  } catch (e) {
    // 失败文案已由 api.js 统一弹出；此处仅内联提示，且不重渲染以保留用户输入
    error.textContent = '封存失败，请稍后重试';
    error.hidden = false;
  }
}

function _homeCapsuleCard(c) {
  var card = _homeEl('article', 'view-home-capsule');
  card.appendChild(_homeEl('h4', 'view-home-capsule-title', c.title || '未命名胶囊'));

  // 作者：成员色点 + 称谓；member_id 为空显示「全家」
  var member = c.member_id == null ? null : Store.getMember(c.member_id);
  var author = _homeEl('div', 'view-home-capsule-author');
  var dot = _homeEl('span', 'view-home-capsule-dot');
  dot.style.backgroundColor = (member && member.avatar_color) ? member.avatar_color : '#D4A24C';
  author.appendChild(dot);
  author.appendChild(_homeEl('span', 'view-home-capsule-author-name', _homeAuthorText(member)));
  card.appendChild(author);

  card.appendChild(_homeEl('p', 'view-home-dim', '开启日期：' + (c.open_date || '—')));
  card.appendChild(_homeCapsuleBody(c));
  return card;
}

function _homeAuthorText(member) {
  if (!member) return '全家';
  var rel = member.relation || '';
  var nm = member.name || '';
  if (rel && nm) return rel + ' · ' + nm;
  return rel || nm || '全家';
}

function _homeCapsuleBody(c) {
  // 已开启：直接展示内容
  if (c.is_opened) {
    var content = c.content == null ? '' : String(c.content);
    return _homeEl('p', 'view-home-capsule-content story-text', content || '（胶囊内容为空）');
  }
  // 已到期：提供开启入口
  var todayStr = _homeTodayStr();
  if (c.open_date && c.open_date <= todayStr) {
    var wrap = _homeEl('div', 'view-home-capsule-action');
    var btn = _homeEl('button', 'btn btn-ok', '开启胶囊');
    btn.type = 'button';
    btn.addEventListener('click', (function (id) {
      return function () { _homeOpenCapsule(id); };
    })(c.id));
    wrap.appendChild(btn);
    return wrap;
  }
  // 未到期：显示剩余天数
  var days = _homeDaysUntil(c.open_date);
  var txt = (days != null && days > 0) ? ('还有 ' + days + ' 天可开启') : '暂不可开启';
  return _homeEl('p', 'view-home-capsule-locked', txt);
}

// 开启胶囊：成功后同步本地并重渲染
async function _homeOpenCapsule(id) {
  try {
    var capsule = await API.openCapsule(id);
    Store.upsertCapsule(capsule);
    Store.notify();
    Dialog.toast('胶囊已开启，慢慢读吧', 'success');
  } catch (e) {
    // 失败文案由 api.js 统一提供（后端 message 已含开启日期），此处不再重复弹 toast
  }
}

// ── 到期提醒（进入首页自动弹层，本会话按胶囊去重）────────────
function _homeMaybeRemind() {
  var list = Store.state.capsules || [];
  var todayStr = _homeTodayStr();
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (!c || c.is_opened || !c.open_date) continue;
    if (c.open_date > todayStr) continue;
    var key = String(c.id);
    if (_homeReminded[key]) continue;
    _homeReminded[key] = true;
    _homeShowReminder(c);
    return;   // 一次只提醒一个，避免弹层堆叠
  }
}

async function _homeShowReminder(c) {
  var open = await Dialog.confirm({
    title: '时间胶囊可以开启啦',
    message: '《' + (c.title || '未命名胶囊') + '》到了约定的开启日期，现在就打开看看吗？',
    confirmText: '去开启',
  });
  if (!open) return;
  _homeOpenCapsule(c.id);
}

// ── 倒计时定时器（视图卸载 / 重渲染时清理）────────────────────
function _homeStartTimer() {
  _homeClearTimer();
  _homeTimer = setInterval(function () {
    var host = document.getElementById('view-home');
    if (!host || !host.classList.contains('is-active')) { _homeClearTimer(); return; }
    if (!_homeCountdownEl || !_homeCountdownEl.isConnected) return;
    var text = _homeCountdownText(_homeCountdown());
    if (_homeCountdownEl.textContent !== text) _homeCountdownEl.textContent = text;
  }, 60000);
}

function _homeClearTimer() {
  if (_homeTimer !== null) {
    clearInterval(_homeTimer);
    _homeTimer = null;
  }
}

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

// 固定中秋日期表（8.5，覆盖至 2030；超出须显式提示，禁止猜测计算）
var MID_AUTUMN_DATES = ['2026-09-25', '2027-09-15', '2028-10-03', '2029-09-22', '2030-09-12'];

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
  el.appendChild(_homeCapsules());

  _homeStartTimer();              // 启动倒计时刷新
  _homeMaybeRemind();             // 到期胶囊自动提醒
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

// ── 顶部标题 + 倒计时 ─────────────────────────────────────
function _homeHero() {
  var hero = _homeEl('section', 'view-home-hero');
  hero.appendChild(_homeEl('h2', 'page-title view-home-title', '中秋 · 国庆 双节快乐'));
  hero.appendChild(_homeEl('p', 'view-home-lead',
    '抽个话题，听长辈讲讲那些越来越远的记忆'));

  var info = _homeCountdown();
  _homeCountdownEl = _homeEl('p', 'view-home-countdown', _homeCountdownText(info));
  hero.appendChild(_homeCountdownEl);
  return hero;
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

/* 模块-视图-抽题-draw.js · 工单 A4（F2/F3/F4 抽题盒子视图）
 * 职责：渲染抽题视图——抽签筒摇动 → 抽卡翻转入场 → 展示话题 + 追问链；
 *       分类筛选（仅影响下次候选集）、换一题、自定义话题入口与删除、「本轮轮到谁」。
 * 契约（顶层函数声明，供 逻辑-app.js 用 typeof 探测）：
 *   renderDraw(el) / onDrawClick() / renderTopicCard(topic,{animate}) / onReroll()
 *   filterByCategory(cat) / currentSpeaker()
 * 消费：
 *   C1 API.draw(memberId,category) / createTopic(payload) / deleteTopic(id)（失败已由 api.js 统一 toast）
 *   C3 navigate('story',{topic,member})
 *   C4 Store.state.topics / getMember / storiesOfMember / followupsOf / upsertTopic / removeTopic / notify
 *   C5 Dialog.confirm({confirmText,danger}) / Dialog.toast(message,type)
 *   C6 复用 A3 基础类（.card/.topic-card/.topic-card-text/.btn/…）与动效类（.anim-tumbler/.anim-card-flip），
 *      专属类前缀 .view-draw-
 * 依赖：dialog / store / api 脚本已先行加载（index.html 中 defer 顺序）。
 * 安全：话题文本、分类、追问、按钮文案一律 textContent / createElement 写入 DOM，不拼接标记字符串。
 */

// ── 模块级状态（必须跨 renderDraw 重渲染恢复，故不放局部变量）──
var _drawTopic = null;       // 当前已抽到并展示的话题对象
var _drawRound = null;       // 当前轮次（API.draw 返回的 round_no）
var _drawCategory = '';      // 分类筛选，'' 表示「全部」（仅影响下次候选集）
var _drawSpeakerId = null;   // 抽题时使用的成员 id（「开始讲」据此归属故事）
var _drawBusy = false;       // 抽题进行中（防连点）
var _drawCustomOpen = false; // 自定义话题面板是否展开
var _drawChipEls = [];       // 当前渲染出的分类 chip 引用，供 filterByCategory 原地更新选中态

// 成员排序：sort_order 升序，缺失时回退 id（与家人视图口径一致）
function _drawMemberCompare(a, b) {
  var ao = a.sort_order == null ? a.id : a.sort_order;
  var bo = b.sort_order == null ? b.id : b.sort_order;
  if (ao !== bo) return ao - bo;
  return (a.id || 0) - (b.id || 0);
}

// 「本轮轮到谁」：取已讲故事数最少的成员；并列时按 sort_order（缺失按 id）靠前者优先。
// 无成员返回 null。前提：Store 无 draws 数据，仅以故事数近似「谁还没被轮到」。
function currentSpeaker() {
  var members = (Store.state.members || []).slice();
  if (!members.length) return null;
  members.sort(_drawMemberCompare);
  var best = null;
  var min = Infinity;
  for (var i = 0; i < members.length; i++) {
    var count = Store.storiesOfMember(members[i].id).length;
    if (count < min) { min = count; best = members[i]; }
  }
  return best;
}

// 分类去重（保持话题库首次出现顺序），不硬编码
function _drawCategories() {
  var seen = {};
  var out = [];
  var topics = Store.state.topics || [];
  for (var i = 0; i < topics.length; i++) {
    var c = topics[i].category;
    if (c && !seen[c]) { seen[c] = 1; out.push(c); }
  }
  return out;
}

// 取话题追问链：优先话题对象内嵌 follow_ups，兜底 Store.followupsOf
function _drawFollowupsOf(topic) {
  if (topic && topic.follow_ups && topic.follow_ups.length) return topic.follow_ups;
  return (topic && Store.followupsOf(topic.id)) || [];
}

// 小工具：创建元素并写入纯文本
function _drawEl(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// ── 视图渲染 ──────────────────────────────────────────────
function renderDraw(el) {
  el.textContent = '';
  _drawChipEls = [];

  el.appendChild(_drawEl('h2', 'page-title', '抽题盒子'));

  if (!(Store.state.members || []).length) {
    el.appendChild(_drawBuildEmpty());
    return;
  }

  // 本轮轮到：X
  var sp = currentSpeaker();
  el.appendChild(_drawEl('p', 'view-draw-speaker',
    sp ? ('本轮轮到：' + (sp.relation || sp.name)) : '本轮轮到：—'));

  // 抽签筒（视觉主体，纯装饰）
  var stage = _drawEl('div', 'view-draw-stage');
  var tumbler = _drawEl('div', 'view-draw-tumbler');
  tumbler.setAttribute('aria-hidden', 'true');
  stage.appendChild(tumbler);
  el.appendChild(stage);

  // 分类 chips：全部（默认）+ 各分类 + ＋自定义话题
  el.appendChild(_drawBuildChips(el));

  // 大按钮：抽一题
  var drawBtn = _drawEl('button', 'btn btn-primary view-draw-action', '抽一题');
  drawBtn.type = 'button';
  drawBtn.addEventListener('click', function () { onDrawClick(); });
  el.appendChild(drawBtn);

  // 自定义话题面板（F4）
  if (_drawCustomOpen) el.appendChild(_drawBuildCustom(el));

  // 话题卡槽（重渲染时恢复上次抽到的卡片，不丢状态）
  var slot = _drawEl('div', 'view-draw-cardslot');
  el.appendChild(slot);
  if (_drawTopic) slot.appendChild(renderTopicCard(_drawTopic, { animate: false }));
}

// 无成员：引导去添加家人（7.0-4）
function _drawBuildEmpty() {
  var box = _drawEl('div', 'empty-state');
  box.appendChild(_drawEl('p', 'empty-title', '还没有家人'));
  box.appendChild(_drawEl('p', 'empty-text', '先添加家人，才能按顺序轮流抽题。'));

  var go = _drawEl('button', 'btn btn-primary', '去添加家人');
  go.type = 'button';
  go.addEventListener('click', function () { navigate('members'); });
  box.appendChild(go);
  return box;
}

// ── 分类 chips ────────────────────────────────────────────
function _drawBuildChips(el) {
  var wrap = _drawEl('div', 'view-draw-chips');
  _drawAddChip(wrap, '', '全部');

  var cats = _drawCategories();
  for (var i = 0; i < cats.length; i++) _drawAddChip(wrap, cats[i], cats[i]);

  var more = _drawEl('button', 'btn btn-ghost view-draw-chip view-draw-chip-add', '＋ 自定义话题');
  more.type = 'button';
  more.setAttribute('aria-expanded', _drawCustomOpen ? 'true' : 'false');
  more.addEventListener('click', function () {
    _drawCustomOpen = !_drawCustomOpen;
    renderDraw(el);
  });
  wrap.appendChild(more);
  return wrap;
}

function _drawAddChip(wrap, value, label) {
  var selected = _drawCategory === value;
  var b = _drawEl('button', 'btn btn-ghost view-draw-chip' + (selected ? ' is-selected' : ''), label);
  b.type = 'button';
  b.setAttribute('aria-pressed', selected ? 'true' : 'false');
  b.addEventListener('click', function () { filterByCategory(value); });
  _drawChipEls.push({ btn: b, value: value });
  wrap.appendChild(b);
}

// 分类筛选：仅改下次候选集，不重抽；原地更新 chips 选中态
function filterByCategory(cat) {
  _drawCategory = cat || '';
  for (var i = 0; i < _drawChipEls.length; i++) {
    var sel = _drawChipEls[i].value === _drawCategory;
    _drawChipEls[i].btn.classList.toggle('is-selected', sel);
    _drawChipEls[i].btn.setAttribute('aria-pressed', sel ? 'true' : 'false');
  }
}

// ── 抽题 ──────────────────────────────────────────────────
// 抽题：并行(抽签筒摇动 400ms + API.draw) → 卡片翻转入场 → is_new_round 提示
async function onDrawClick() {
  if (_drawBusy) return;
  var el = document.getElementById('view-draw');
  if (!el) return;

  var sp = currentSpeaker();
  if (!sp) {
    Dialog.toast('还没有家人，先去添加吧', 'info');
    return;
  }

  _drawBusy = true;
  var drawBtn = el.querySelector('.view-draw-action');
  if (drawBtn) drawBtn.disabled = true;

  // 触发抽签筒摇动：先移除类 + 强制重排 + 再加类，保证连续抽题也能重放动画
  var tumbler = el.querySelector('.view-draw-tumbler');
  if (tumbler) {
    tumbler.classList.remove('anim-tumbler');
    void tumbler.offsetWidth;
    tumbler.classList.add('anim-tumbler');
  }

  try {
    var res = await API.draw(sp.id, _drawCategory || undefined);
    _drawSpeakerId = sp.id;
    _drawRound = res.round_no;
    _drawTopic = res.topic;
    if (res.is_new_round === true) {
      Dialog.toast('本轮已抽完，进入第 ' + res.round_no + ' 轮', 'info');
    }
    _drawRenderCard(el, true);
  } catch (e) {
    // 失败已由 api.js 统一 toast，此处仅吞掉拒绝
  } finally {
    _drawBusy = false;
    if (drawBtn) drawBtn.disabled = false;
  }
}

// 换一题：重新走一次抽题
function onReroll() {
  onDrawClick();
}

// 把当前 _drawTopic 渲染进卡片槽（animate=true 时播翻转入场）
function _drawRenderCard(el, animate) {
  var slot = el.querySelector('.view-draw-cardslot');
  if (!slot) return;
  slot.textContent = '';
  if (!_drawTopic) return;
  slot.appendChild(renderTopicCard(_drawTopic, { animate: animate }));
}

// ── 话题卡 ────────────────────────────────────────────────
function renderTopicCard(topic, opts) {
  opts = opts || {};
  var card = _drawEl('div', 'card topic-card view-draw-card');

  card.appendChild(_drawEl('p', 'topic-card-text', topic.text || ''));

  var fus = _drawFollowupsOf(topic);
  if (fus.length) card.appendChild(_drawBuildFollowups(fus));

  var actions = _drawEl('div', 'view-draw-card-actions');

  var reroll = _drawEl('button', 'btn btn-ghost', '换一题');
  reroll.type = 'button';
  reroll.addEventListener('click', function () { onReroll(); });
  actions.appendChild(reroll);

  var start = _drawEl('button', 'btn btn-primary', '开始讲');
  start.type = 'button';
  start.addEventListener('click', function () {
    var mid = _drawSpeakerId;
    if (mid == null) {
      var s = currentSpeaker();
      mid = s ? s.id : null;
    }
    navigate('story', { topic: topic.id, member: mid });
  });
  actions.appendChild(start);

  card.appendChild(actions);

  if (opts.animate) {
    card.classList.add('anim-card-flip');
    // 翻转动画为 both 填充，终态会停在镜像 + 上移：结束即移除类，恢复自然位置
    card.addEventListener('animationend', function (ev) {
      if (ev.target !== card) return;
      card.classList.remove('anim-card-flip');
    });
  }
  return card;
}

// 追问链折叠条：「追问 · N 条」，展开显示各条（F15 呈现端）
function _drawBuildFollowups(fus) {
  var box = _drawEl('div', 'view-draw-followups');

  var toggle = _drawEl('button', 'view-draw-followups-toggle', '追问 · ' + fus.length + ' 条');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');

  var list = _drawEl('div', 'view-draw-followups-list');
  for (var i = 0; i < fus.length; i++) {
    list.appendChild(_drawEl('p', 'view-draw-followup', fus[i]));
  }

  toggle.addEventListener('click', function () {
    var open = list.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  box.appendChild(toggle);
  box.appendChild(list);
  return box;
}

// ── F4 自定义话题 ─────────────────────────────────────────
function _drawBuildCustom(el) {
  var box = _drawEl('div', 'card view-draw-custom');
  box.appendChild(_drawEl('h3', 'view-draw-custom-title', '自定义话题'));

  var cats = _drawCategories();
  if (cats.length) {
    var form = _drawEl('div', 'view-draw-custom-form');

    var sel = _drawEl('select', 'view-draw-select');
    sel.setAttribute('aria-label', '话题分类');
    for (var i = 0; i < cats.length; i++) {
      var opt = _drawEl('option', null, cats[i]);
      opt.value = cats[i];
      sel.appendChild(opt);
    }

    var input = _drawEl('input', 'view-draw-input');
    input.type = 'text';
    input.maxLength = 60;
    input.placeholder = '如：小时候最怕什么？';
    input.setAttribute('aria-label', '话题内容');

    var addBtn = _drawEl('button', 'btn btn-primary', '添加');
    addBtn.type = 'button';
    addBtn.addEventListener('click', function () { _drawCreateTopic(sel.value, input, addBtn); });

    form.appendChild(sel);
    form.appendChild(input);
    form.appendChild(addBtn);
    box.appendChild(form);
  } else {
    box.appendChild(_drawEl('p', 'muted', '暂无分类，无法添加自定义话题。'));
  }

  // 已有自定义话题列表（内置话题不在此列出，故内置话题无删除入口）
  var customs = (Store.state.topics || []).filter(function (t) { return !t.is_builtin; });
  if (customs.length) {
    var list = _drawEl('div', 'view-draw-custom-list');
    for (var k = 0; k < customs.length; k++) {
      list.appendChild(_drawBuildCustomItem(customs[k]));
    }
    box.appendChild(list);
  }
  return box;
}

function _drawBuildCustomItem(topic) {
  var item = _drawEl('div', 'view-draw-custom-item');

  var main = _drawEl('div', 'view-draw-custom-item-main');
  main.appendChild(_drawEl('span', 'view-draw-tag', topic.category || '未分类'));
  main.appendChild(_drawEl('div', 'view-draw-custom-item-text', topic.text || ''));
  item.appendChild(main);

  var del = _drawEl('button', 'btn btn-danger', '删除');
  del.type = 'button';
  del.addEventListener('click', function () { _drawDeleteTopic(topic); });
  item.appendChild(del);

  return item;
}

// 新增自定义话题：成功 upsert + 局部重渲染（面板保持展开）
async function _drawCreateTopic(category, input, btn) {
  var text = (input.value || '').trim();
  if (text.length < 1 || text.length > 60) {
    Dialog.toast('话题内容需为 1–60 字', 'error');
    return;
  }
  if (!category) {
    Dialog.toast('请选择话题分类', 'error');
    return;
  }
  btn.disabled = true;
  try {
    var saved = await API.createTopic({ category: category, text: text });
    Store.upsertTopic(saved);
    _drawCustomOpen = true;
    Store.notify();
    Dialog.toast('已添加自定义话题', 'success');
  } catch (e) {
    // 失败已由 api.js 统一 toast
  } finally {
    btn.disabled = false;
  }
}

// 删除自定义话题：danger 二次确认通过后才发请求
async function _drawDeleteTopic(topic) {
  var okDel = await Dialog.confirm({
    title: '删除话题',
    message: '将同时删除该话题下的全部故事与照片，且不可恢复。',
    confirmText: '删除',
    danger: true,
  });
  if (!okDel) return;

  try {
    await API.deleteTopic(topic.id);
    Store.removeTopic(topic.id);
    if (_drawTopic && _drawTopic.id === topic.id) _drawTopic = null;
    Store.notify();
    Dialog.toast('已删除话题', 'success');
  } catch (e) {
    // 失败已由 api.js 统一 toast
  }
}

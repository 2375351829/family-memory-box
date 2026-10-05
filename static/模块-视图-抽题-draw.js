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
 *   C6 复用 A3 基础类（.card/.topic-card/.topic-card-text/.btn/…）与动效类（.anim-tumbler），
 *      专属类前缀 .view-draw-
 * 依赖：dialog / store / api 脚本已先行加载（index.html 中 defer 顺序）。
 * 安全：话题文本、分类、追问、按钮文案一律 textContent / createElement 写入 DOM，不拼接标记字符串。
 */

// ── 模块级状态（必须跨 renderDraw 重渲染恢复，故不放局部变量）──
var _drawTopic = null;       // 当前已抽到并展示的话题对象
var _drawRound = null;       // 当前轮次（API.draw 返回的 round_no）
var _drawCategory = '';      // 分类筛选，'' 表示「全部」（仅影响下次候选集）
var _drawSpeakerId = null;   // 抽题时使用的成员 id（「开始讲」据此归属故事）
var _drawSpeakerName = '';   // 该成员称谓（卡片内标注「由谁讲这一题」）
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

// 「本轮轮到谁」：取「最久没轮到」的人 —— 从未抽过者最优先，其次 last_draw_id 最小者；
// 并列时让「讲故事最少」的人先开口（沿用原产品意图），再并列按 sort_order（缺失按 id）。
// last_draw_id 来自 /api/state（后端按 draws 表分人取最近一次记录 id）→ 三端与刷新后一致。
// 修复历程：① 原用「故事数最少」——全家人故事数并列时永远只轮到第一人；
//          ② 试过「累计抽题数最少」——历史累计（如某人早先被抽过 38 次）会把人永久排在队尾；
//          ③ 试过「最近抽题时间」——秒级精度会打平，刚抽过的人又被选中，轮转卡住；
//          ④ 定为「自增抽题序号最小」——严格单调、无并列，与历史累计无关，人人依次轮转。
function _drawStoryCount(memberId) {
  return Store.storiesOfMember(memberId).length;
}

// 轮转键：从未抽过 → -1（最优先）；否则用自增抽题序号（越小越久没轮到）
function _drawTurnKey(member) {
  return typeof member.last_draw_id === 'number' ? member.last_draw_id : -1;
}

function currentSpeaker() {
  var members = (Store.state.members || []).slice();
  if (!members.length) return null;
  members.sort(_drawMemberCompare);          // 基准顺序：sort_order → id（保证并列时结果稳定可预期）
  var best = members[0];
  var bestKey = _drawTurnKey(best);
  var bestStory = _drawStoryCount(best.id);
  for (var i = 1; i < members.length; i++) {
    var m = members[i];
    var k = _drawTurnKey(m);
    var sc = _drawStoryCount(m.id);
    if (k < bestKey || (k === bestKey && sc < bestStory)) {
      best = m;
      bestKey = k;
      bestStory = sc;
    }
  }
  return best;
}

// 抽到题后本地同步推进轮转：把该成员的轮转键置为「严格大于全家最大值」，
// 保证抽过的人绝不会因并列又被选中（后端已在 draws 表记账，此处只是让界面立即反映、无需重拉 state）
function _drawBumpLastDraw(memberId) {
  var m = Store.getMember(memberId);
  if (!m) return;
  var list = Store.state.members || [];
  var max = 0;
  for (var i = 0; i < list.length; i++) {
    var v = list[i].last_draw_id;
    if (typeof v === 'number' && v > max) max = v;
  }
  m.last_draw_id = max + 1;
  m.draw_count = (m.draw_count == null ? 0 : m.draw_count) + 1;
}

function _drawSpeakerLabel(member) {
  if (!member) return '—';
  return member.relation || member.name || '—';
}

// 顶栏文案：还没抽到卡 → 「本轮轮到：X」；已抽到卡 → 「下一次轮到：X」（卡片内会标明这一题由谁讲）
function _drawUpdateSpeakerLine(el) {
  var line = el.querySelector('.view-draw-speaker');
  if (!line) return;
  var sp = currentSpeaker();
  line.textContent = (_drawTopic ? '下一次轮到：' : '本轮轮到：') + _drawSpeakerLabel(sp);
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

// 各节日的抽题提示文案（必须与 static/素材-assets/抽题道具-props/ 里那件道具的动作对得上，
// 否则会出现「图上是福袋、文案叫人拆红包」的错位）
// 无节日 / 未列出时回落通用提示；道具仍是该节日的图形（CSS 依 data-festival 落地）。
var DRAW_PROP_HINTS = {
  chuxi: '拆开福袋，看看抽到哪一段',
  chunjie: '拆开红包，把这段往事请出来',
  zhongqiu: '掀开月饼盒，取一块“故事月饼”',
  guoqing: '转动五星转盘，指针停在哪一题',
  duanwu: '解开粽绳，剥开这一只',
  yuanxiao: '拉下宫灯，摘一张灯谜条',
  qixi: '提起同心结，牵一段旧事',
  chongyang: '端起菊花酒，登高说旧事',
  laba: '端起腊八粥，聊聊那年冬天',
  qingming: '放飞纸鸢，线断处就是那段记忆',
  kuannian: '摇一摇许愿瓶，看看冒出哪一题',
  yuandan: '翻开新历，看看开年第一题',
  pinganye: '咬一口平安果，说段平安旧事',
  shengdanjie: '抖一抖圣诞袜，拆出今天的礼物',
  qingrenjie: '打开心形盒，取一枚甜签',
  funvjie: '捧一束康乃馨，敬家里的女神',
  zhishujie: '扶一扶小树苗，说说往下扎根的事',
  yurenjie: '举起笑脸面具，说段玩笑话',
  laodongjie: '抄起锤子扳手，讲段当年的活计',
  qingnianjie: '举起火炬，说说当年的热血',
  muqinjie: '端起花盒，取一枚暖签',
  ertongjie: '放飞纸飞机，蹦出今天的题',
  fuqinjie: '端起茶盏，陪爸爸聊聊',
  jiandangjie: '扬起红旗，读一段老党员的故事',
  jianjunjie: '吹响军号，讲讲军营旧事',
  jiaoshijie: '翻开书册，抽一页当年的课',
  wanshengjie: '伸手进南瓜灯，掏出今晚的故事'
};

function _drawPropHint() {
  var key = '';
  try { key = document.documentElement.getAttribute('data-festival') || ''; } catch (e) { key = ''; }
  return DRAW_PROP_HINTS[key] || '点「抽一题」，从签筒里摇出一条';
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

  // 本轮轮到：X（抽到卡后改为「下一次轮到：X」，由 _drawUpdateSpeakerLine 统一写文案）
  el.appendChild(_drawEl('p', 'view-draw-speaker', ''));
  _drawUpdateSpeakerLine(el);

  // 签筒 / 节日道具（视觉主体，纯装饰：道具图形与抽题手势由 CSS 依 data-festival 落地）
  var stage = _drawEl('div', 'view-draw-stage');
  var tumbler = _drawEl('div', 'view-draw-tumbler');
  tumbler.setAttribute('aria-hidden', 'true');
  // 可旋转子层：仅国庆转盘用得上（盘面单独转，指针与底座留在外层不转）；
  // 其余节日该层无背景，等价于零成本的空元素。
  tumbler.appendChild(_drawEl('span', 'view-draw-prop-disc'));
  stage.appendChild(tumbler);
  // 该节日的抽题提示（说明这一下「抽」在做什么：拆红包 / 掀月饼盒 / 转盘 …）
  stage.appendChild(_drawEl('p', 'view-draw-prop-hint view-draw-prop-hint-stage', _drawPropHint()));
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
  if (_drawTopic) {
    slot.appendChild(renderTopicCard(_drawTopic, { animate: false }));
  } else {
    // 未抽题：给一块引导卡占位，避免宽屏（PC 双栏）下右栏空白、版面失衡
    slot.appendChild(_drawBuildHint());
  }
}

// 未抽题时的引导卡（纯展示，无交互；抽到题后即被话题卡替换）
function _drawBuildHint() {
  var card = _drawEl('div', 'card view-draw-hint');
  card.appendChild(_drawEl('p', 'view-draw-hint-mark', '签'));
  card.appendChild(_drawEl('p', 'view-draw-hint-title', '还没有抽到话题'));
  card.appendChild(_drawEl('p', 'view-draw-hint-text',
    '点一下「抽一题」，从签筒里摇出今天要讲的那段回忆。'));
  return card;
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
// memberIdOverride：换一题时传当前讲者的 id —— 同一人的「换一题」不换人（换人只在点「抽一题」时发生）
async function onDrawClick(memberIdOverride) {
  if (_drawBusy) return;
  var el = document.getElementById('view-draw');
  if (!el) return;

  var sp = (memberIdOverride == null) ? currentSpeaker() : Store.getMember(memberIdOverride);
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
    _drawSpeakerName = _drawSpeakerLabel(sp);
    _drawBumpLastDraw(sp.id);             // 本地推进轮转（后端已同步记账）
    _drawRound = res.round_no;
    _drawTopic = res.topic;
    if (res.is_new_round === true) {
      Dialog.toast('本轮已抽完，进入第 ' + res.round_no + ' 轮', 'info');
    }
    _drawRenderCard(el);                  // 原地换题面文字（不重建卡片）
    _drawUpdateSpeakerLine(el);           // 顶栏推进到下一位
  } catch (e) {
    // 失败已由 api.js 统一 toast，此处仅吞掉拒绝
  } finally {
    _drawBusy = false;
    if (drawBtn) drawBtn.disabled = false;
  }
}

// 换一题：仍由当前讲者重抽（_drawSpeakerId 为空时才回退到「本轮轮到」）
function onReroll() {
  onDrawClick(_drawSpeakerId);
}

// 把当前 _drawTopic 写进卡片槽。
// 契约：首次抽题建卡；之后每次抽题/换一题只在原卡上换文字（「由谁讲」+ 题面 + 追问），
//       卡片外壳、追问折叠态、两个按钮都不重建、不重播整卡入场 —— 点一下只有文字在变。
function _drawRenderCard(el) {
  var slot = el.querySelector('.view-draw-cardslot');
  if (!slot || !_drawTopic) return;

  var card = slot.querySelector('.view-draw-card');
  if (!card) {
    slot.textContent = '';                                  // 首次：替掉「还没抽到话题」引导卡
    card = renderTopicCard(_drawTopic, { swap: true });
    slot.appendChild(card);
    return;
  }
  _drawFillCard(card, _drawTopic);
  _drawPlaySwap(card);
}

// 原地填卡：只改文本节点；追问条数变化时才重建追问列表（保留展开态）
function _drawFillCard(card, topic) {
  var who = _drawSpeakerName;
  if (!who && _drawSpeakerId != null) who = _drawSpeakerLabel(Store.getMember(_drawSpeakerId));

  var whoEl = card.querySelector('.view-draw-card-who');
  if (who) {
    if (!whoEl) {
      whoEl = _drawEl('p', 'view-draw-card-who');
      card.insertBefore(whoEl, card.firstChild);
    }
    whoEl.textContent = '由「' + who + '」讲这一题';
  } else if (whoEl) {
    whoEl.remove();
  }

  var textEl = card.querySelector('.topic-card-text');
  if (textEl) textEl.textContent = topic.text || '';

  _drawFillFollowups(card, _drawFollowupsOf(topic));
}

function _drawFillFollowups(card, fus) {
  var box = card.querySelector('.view-draw-followups');
  if (!fus.length) {
    if (box) box.remove();
    return;
  }
  if (!box) {
    // 该话题首次带上追问：插在按钮区之前，位置与建卡时一致
    card.insertBefore(_drawBuildFollowups(fus), card.querySelector('.view-draw-card-actions'));
    return;
  }
  var list = box.querySelector('.view-draw-followups-list');
  var items = list.querySelectorAll('.view-draw-followup');
  if (items.length !== fus.length) {
    var open = list.classList.contains('is-open');
    list.textContent = '';
    for (var i = 0; i < fus.length; i++) list.appendChild(_drawEl('p', 'view-draw-followup', fus[i]));
    list.classList.toggle('is-open', open);
  } else {
    for (var j = 0; j < fus.length; j++) items[j].textContent = fus[j];
  }
  box.querySelector('.view-draw-followups-toggle').textContent = '追问 · ' + fus.length + ' 条';
}

// 题面切换：只给文字一层 220ms 轻移淡入（卡片外壳不动，避免「整块刷新」的观感）
// 移除类 + 强制重排 + 再加类：连续抽题也能重放同一段动画
function _drawPlaySwap(card) {
  card.classList.remove('is-swap');
  void card.offsetWidth;
  card.classList.add('is-swap');
}

// ── 话题卡 ────────────────────────────────────────────────
function renderTopicCard(topic, opts) {
  opts = opts || {};
  var card = _drawEl('div', 'card topic-card view-draw-card');

  // 这一题由谁讲：明确标注，避免「顶栏已推进到下一位」时产生「这题算谁的」歧义
  var who = _drawSpeakerName;
  if (!who && _drawSpeakerId != null) who = _drawSpeakerLabel(Store.getMember(_drawSpeakerId));
  if (who) card.appendChild(_drawEl('p', 'view-draw-card-who', '由「' + who + '」讲这一题'));

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

  if (opts.swap) card.classList.add('is-swap');   // 首次建卡时文字也走同一段轻移淡入
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

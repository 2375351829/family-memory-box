/* 模块-视图-回忆录-memoir.js · 工单 A5（F7 三视图 / 照片墙 / 编辑删除入口）
 * 职责：回忆录展示出口——时间轴 / 按家人 / 按话题 三视图（分组数据一律取后端 API.getMemoir）+
 *       照片墙瀑布流 + 故事编辑 / 删除入口 + 导出（PDF / JSON / 长图）入口。
 * 契约（顶层函数声明，供 逻辑-app.js 用 typeof 探测 / 工单 §4 逐字）：
 *   renderMemoir(el, view) / switchView(view)
 *   renderTimeline(groups) / renderByMember(groups) / renderByTopic(groups) / renderPhotoWall()
 *   editStory(id) / removeStory(id)
 * 消费：C1 API.getMemoir/deleteStory；C3 navigate；C4 Store.stats/getMember/removeStory/notify；
 *       C5 Dialog.confirm/toast；C6 复用 A3 基础类（.card/.btn/.empty-state/.story-card 等），
 *       专属类前缀 .view-memoir- / .photo-wall。
 * 依赖：export.js 的 exportPdf/exportJson/importJson/exportLongImage（运行时点击才解析，加载顺序安全）。
 * 安全：话题文本、讲述人、正文、照片说明等一律 textContent / createElement 写入，不拼接标记字符串。
 * 关键设计：Store.notify() 会整视图重渲染，故当前视图与分组缓存落在模块级变量；
 *           分组请求带自增序号，回包时校验视图与宿主仍有效，避免竞态覆盖。
 */

// ── 模块级状态（必须跨重渲染恢复）──────────────────────────────
var _memoirView = 'timeline';                                  // 当前视图
var _memoirCache = { timeline: null, member: null, topic: null }; // 分组缓存（按视图）
var _memoirReqId = 0;                                          // 分组请求序号（竞态保护）

// 仅接受 timeline / member / topic，其余回落 timeline
function _memoirValidView(v) {
  return (v === 'member' || v === 'topic') ? v : 'timeline';
}

// 小工具：创建元素并写入纯文本
function _memoirEl(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// 组元信息文案
function _memoirMetaText(meta) {
  var m = meta || {};
  return (m.count || 0) + ' 个故事 · ' + (m.photoCount || 0) + ' 张照片';
}

// 讲述人显示名：关系 · 姓名
function _memoirSpeaker(story) {
  var rel = story.relation || '';
  var nm = story.name || '';
  if (rel && nm) return '讲述人：' + rel + ' · ' + nm;
  return '讲述人：' + (rel || nm || '—');
}

// ── 视图入口 ──────────────────────────────────────────────
function renderMemoir(el, view) {
  if (!el) return;
  _memoirView = _memoirValidView(view);

  el.textContent = '';
  el.appendChild(_memoirEl('h2', 'page-title', '家庭回忆录'));

  // 无故事：仍保留工具栏（备份导入/导出在空库时同样需要），内容区给引导
  if (Store.stats().storyCount === 0) {
    el.appendChild(_memoirBuildToolbar());
    el.appendChild(_memoirBuildEmpty());
    return;
  }

  el.appendChild(_memoirBuildTabs());
  el.appendChild(_memoirBuildToolbar());

  var host = _memoirEl('div', 'view-memoir-content');
  el.appendChild(host);

  var cached = _memoirCache[_memoirView];
  if (cached) _memoirFill(host, _memoirView, cached);
  else host.appendChild(_memoirBuildLoading());

  _memoirFetch(host, _memoirView);

  // 照片墙：始终位于分组内容之下
  el.appendChild(renderPhotoWall());
}

// 切换视图：写回 hash（A3 会据此重渲染并再次进入本函数）
function switchView(view) {
  var v = _memoirValidView(view);
  _memoirView = v;
  navigate('memoir', { view: v });
}

// 请求分组数据（单一事实源：后端 API.getMemoir）；成功写缓存并重绘宿主
function _memoirFetch(host, view) {
  _memoirReqId++;
  var myId = _memoirReqId;
  API.getMemoir(view).then(function (data) {
    var groups = (data && data.groups) || [];
    _memoirCache[view] = groups;
    if (myId !== _memoirReqId || _memoirView !== view || !host.isConnected) return;
    _memoirFill(host, view, groups);
  }).catch(function () {
    // 错误已由 api.js 统一 toast；此处只做视图内状态恢复（有旧数据则保留，不白屏）
    if (myId !== _memoirReqId || _memoirView !== view || !host.isConnected) return;
    if (_memoirCache[view]) return;
    host.textContent = '';
    host.appendChild(_memoirBuildError());
  });
}

// 把分组填进宿主容器（按视图选择渲染器）
function _memoirFill(host, view, groups) {
  host.textContent = '';
  if (!groups || !groups.length) {
    host.appendChild(_memoirBuildEmptyGroups());
    return;
  }
  var node = view === 'member' ? renderByMember(groups)
    : view === 'topic' ? renderByTopic(groups)
      : renderTimeline(groups);
  host.appendChild(node);
}

// ── 视图切换 tabs ─────────────────────────────────────────
function _memoirBuildTabs() {
  var wrap = _memoirEl('div', 'view-memoir-tabs no-print');
  var defs = [['timeline', '时间轴'], ['member', '按家人'], ['topic', '按话题']];
  for (var i = 0; i < defs.length; i++) {
    var v = defs[i][0];
    var active = v === _memoirView;
    var btn = _memoirEl('button',
      'view-memoir-tab' + (active ? ' is-active' : ''), defs[i][1]);
    btn.type = 'button';
    btn.setAttribute('data-view', v);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.addEventListener('click', (function (view) {
      return function () { switchView(view); };
    })(v));
    wrap.appendChild(btn);
  }
  return wrap;
}

// ── 导出 / 导入工具栏 ─────────────────────────────────────
function _memoirBuildToolbar() {
  var wrap = _memoirEl('div', 'view-memoir-toolbar no-print');

  var pdf = _memoirEl('button', 'btn btn-primary view-memoir-tool-pdf', '导出 PDF');
  pdf.type = 'button';
  pdf.addEventListener('click', function () { exportPdf(); });
  wrap.appendChild(pdf);

  var img = _memoirEl('button', 'btn btn-ghost view-memoir-tool-image', '生成长图');
  img.type = 'button';
  img.addEventListener('click', function () {
    exportLongImage(document.getElementById('view-memoir'));
  });
  wrap.appendChild(img);

  var jsonFull = _memoirEl('button', 'btn btn-ghost view-memoir-tool-json', '导出备份');
  jsonFull.type = 'button';
  jsonFull.addEventListener('click', function () { exportJson(true); });
  wrap.appendChild(jsonFull);

  var jsonText = _memoirEl('button', 'btn btn-ghost view-memoir-tool-json-text', '仅文字备份');
  jsonText.type = 'button';
  jsonText.addEventListener('click', function () { exportJson(false); });
  wrap.appendChild(jsonText);

  var file = document.createElement('input');
  file.type = 'file';
  file.className = 'view-memoir-file';
  file.accept = '.json,application/json';
  file.setAttribute('aria-label', '选择备份文件');
  file.addEventListener('change', function () {
    var f = file.files && file.files[0];
    file.value = '';   // 允许再次选择同一文件
    if (f) importJson(f);
  });
  wrap.appendChild(file);

  var imp = _memoirEl('button', 'btn btn-ghost view-memoir-tool-import', '导入备份');
  imp.type = 'button';
  imp.addEventListener('click', function () { file.click(); });
  wrap.appendChild(imp);

  return wrap;
}

// ── 三视图渲染器（返回节点，由调用方挂载）──────────────────
function renderTimeline(groups) {
  var wrap = _memoirEl('div', 'view-memoir-timeline');
  for (var i = 0; i < groups.length; i++) {
    var g = groups[i];
    var sec = _memoirEl('section', 'view-memoir-tl-group');
    sec.appendChild(_memoirEl('h3', 'view-memoir-tl-year', g.label || '年份未详'));
    sec.appendChild(_memoirEl('p', 'view-memoir-group-meta muted', _memoirMetaText(g.meta)));
    sec.appendChild(_memoirGroupBody(g.items));
    wrap.appendChild(sec);
  }
  return wrap;
}

function renderByMember(groups) {
  var wrap = _memoirEl('div', 'view-memoir-member-groups');
  for (var i = 0; i < groups.length; i++) {
    var g = groups[i];
    var member = Store.getMember(g.key);
    var color = (member && member.avatar_color) ? member.avatar_color : '#D4A24C';
    var head = _memoirEl('div', 'view-memoir-group-head');
    var dot = _memoirEl('span', 'view-memoir-avatar');
    dot.style.backgroundColor = color;
    head.appendChild(dot);
    head.appendChild(_memoirEl('h3', 'view-memoir-group-title',
      member ? ((member.relation ? member.relation + ' · ' : '') + (member.name || '')) : g.label));
    head.appendChild(_memoirEl('p', 'view-memoir-group-meta muted', _memoirMetaText(g.meta)));
    var sec = _memoirEl('section', 'view-memoir-group');
    sec.appendChild(head);
    sec.appendChild(_memoirGroupBody(g.items));
    wrap.appendChild(sec);
  }
  return wrap;
}

function renderByTopic(groups) {
  var wrap = _memoirEl('div', 'view-memoir-topic-groups');
  for (var i = 0; i < groups.length; i++) {
    var g = groups[i];
    var head = _memoirEl('div', 'view-memoir-group-head');
    head.appendChild(_memoirEl('h3', 'view-memoir-group-title', g.label || ''));
    head.appendChild(_memoirEl('p', 'view-memoir-group-meta muted', _memoirMetaText(g.meta)));
    var sec = _memoirEl('section', 'view-memoir-group');
    sec.appendChild(head);
    sec.appendChild(_memoirGroupBody(g.items));
    wrap.appendChild(sec);
  }
  return wrap;
}

// 组内故事列表
function _memoirGroupBody(items) {
  var body = _memoirEl('div', 'view-memoir-group-body');
  var list = items || [];
  for (var i = 0; i < list.length; i++) body.appendChild(_memoirStoryCard(list[i]));
  return body;
}

// ── 故事卡 ────────────────────────────────────────────────
function _memoirStoryCard(story) {
  if (!story) return _memoirEl('div', 'view-memoir-story-empty');
  var card = _memoirEl('article', 'card story-card view-memoir-story');

  card.appendChild(_memoirEl('p', 'view-memoir-story-topic',
    story.topic_text || '（未知话题）'));
  card.appendChild(_memoirEl('p', 'view-memoir-story-speaker', _memoirSpeaker(story)));

  var content = (story.content == null ? '' : String(story.content));
  if (content) {
    card.appendChild(_memoirEl('p', 'view-memoir-story-content story-text', content));
  } else {
    card.appendChild(_memoirEl('p', 'view-memoir-story-content muted', '（未填写正文）'));
  }

  // 追问链：仅展示有问有答的条目（F15 回忆录可见）
  var fus = story.followups || [];
  var hasFu = false;
  var fuBox = _memoirEl('div', 'view-memoir-story-followups');
  for (var i = 0; i < fus.length; i++) {
    var fu = fus[i];
    if (!fu || !fu.q || fu.a == null || String(fu.a) === '') continue;
    hasFu = true;
    var row = _memoirEl('div', 'view-memoir-story-followup');
    row.appendChild(_memoirEl('p', 'view-memoir-story-q', fu.q));
    row.appendChild(_memoirEl('p', 'view-memoir-story-a', String(fu.a)));
    fuBox.appendChild(row);
  }
  if (hasFu) card.appendChild(fuBox);

  if (story.story_date) {
    card.appendChild(_memoirEl('p', 'view-memoir-story-date muted', '故事日期：' + story.story_date));
  }

  // 照片缩略图
  var photos = story.photos || [];
  if (photos.length) {
    var strip = _memoirEl('div', 'view-memoir-story-photos');
    for (var j = 0; j < photos.length; j++) strip.appendChild(_memoirBuildThumb(photos[j]));
    card.appendChild(strip);
  }

  // 操作：编辑 / 删除
  var actions = _memoirEl('div', 'view-memoir-story-actions no-print');
  var edit = _memoirEl('button', 'btn btn-ghost view-memoir-story-edit', '编辑');
  edit.type = 'button';
  edit.addEventListener('click', (function (id) {
    return function () { editStory(id); };
  })(story.id));
  actions.appendChild(edit);

  var del = _memoirEl('button', 'btn btn-danger view-memoir-story-del', '删除');
  del.type = 'button';
  del.addEventListener('click', (function (id) {
    return function () { removeStory(id); };
  })(story.id));
  actions.appendChild(del);

  card.appendChild(actions);
  return card;
}

// 单张缩略图（lazy / async，无破图占位）
function _memoirBuildThumb(photo) {
  var img = document.createElement('img');
  img.className = 'view-memoir-thumb';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = photo && photo.caption ? photo.caption : '家庭老照片';
  img.src = API.photoUrl(photo.filename);
  return img;
}

// ── 照片墙（CSS columns 瀑布流）────────────────────────────
function renderPhotoWall() {
  var section = _memoirEl('section', 'view-memoir-photowall');
  section.appendChild(_memoirEl('h3', 'view-memoir-section-title', '照片墙'));

  var photos = Store.state.photos || [];
  var wall = _memoirEl('div', 'photo-wall');
  if (!photos.length) {
    wall.appendChild(_memoirEl('p', 'view-memoir-empty-hint muted',
      '还没有老照片——讲故事时上传照片，就会出现在这里。'));
  } else {
    for (var i = 0; i < photos.length; i++) {
      var p = photos[i];
      var item = _memoirEl('figure', 'view-memoir-photo-item');
      var img = document.createElement('img');
      img.className = 'view-memoir-photo-img';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = p.caption ? p.caption : '家庭老照片';
      img.src = API.photoUrl(p.filename);
      item.appendChild(img);
      if (p.caption) item.appendChild(_memoirEl('figcaption', 'view-memoir-photo-caption', p.caption));
      wall.appendChild(item);
    }
  }
  section.appendChild(wall);
  return section;
}

// ── 编辑 / 删除入口 ───────────────────────────────────────
// 编辑：直接调用 A4-3 提供的契约外扩展全局函数 renderStoryForEdit（A3 的 story 路由不传编辑参数）
function editStory(id) {
  if (typeof renderStoryForEdit === 'function') {
    renderStoryForEdit(id);
  } else {
    Dialog.toast('当前版本不支持编辑，请刷新后重试', 'error');
  }
}

// 删除：danger 二次确认 → API.deleteStory → 本地同步 → 重渲染（api.js 失败已 toast）
async function removeStory(id) {
  var okDel = await Dialog.confirm({
    title: '删除故事',
    message: '删除后不可恢复，确定删除这条故事吗？',
    confirmText: '删除',
    danger: true,
  });
  if (!okDel) return;

  try {
    await API.deleteStory(id);
    _memoirInvalidate();          // 丢弃分组缓存，强制重新拉取
    Store.removeStory(id);        // 级联清理本地 photos 缓存
    Store.notify();               // 整视图重渲染，照片墙随 Store 同步
    Dialog.toast('已删除故事', 'success');
  } catch (e) {
    // 失败已由 api.js 统一 toast
  }
}

// 丢弃全部视图的分组缓存
function _memoirInvalidate() {
  _memoirCache.timeline = null;
  _memoirCache.member = null;
  _memoirCache.topic = null;
}

// ── 视图内状态块 ──────────────────────────────────────────
function _memoirBuildLoading() {
  return _memoirEl('div', 'view-memoir-loading muted', '回忆录加载中…');
}

function _memoirBuildError() {
  var box = _memoirEl('div', 'empty-state view-memoir-error');
  box.appendChild(_memoirEl('p', 'empty-title', '回忆录加载失败'));
  box.appendChild(_memoirEl('p', 'empty-text', '无法获取回忆录数据，请检查网络后重试。'));
  var retry = _memoirEl('button', 'btn btn-primary', '重试');
  retry.type = 'button';
  retry.addEventListener('click', function () {
    renderMemoir(document.getElementById('view-memoir'), _memoirView);
  });
  box.appendChild(retry);
  return box;
}

function _memoirBuildEmptyGroups() {
  return _memoirEl('p', 'view-memoir-empty-hint muted', '这个视图暂时还没有可展示的故事。');
}

function _memoirBuildEmpty() {
  var box = _memoirEl('div', 'empty-state view-memoir-empty');
  box.appendChild(_memoirEl('p', 'empty-title', '还没有回忆'));
  box.appendChild(_memoirEl('p', 'empty-text', '去抽一题，讲第一个故事，它会自动收进这里。'));
  var go = _memoirEl('button', 'btn btn-primary', '去抽一题');
  go.type = 'button';
  go.addEventListener('click', function () { navigate('draw'); });
  box.appendChild(go);
  return box;
}

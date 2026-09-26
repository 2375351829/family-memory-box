/* 模块-视图-讲故事-story.js · 工单 A4（F5/F6/F15 讲故事视图）
 * 职责：渲染讲故事记录表单——上下文回显（话题 + 讲述人）→ 正文录入（19px 级长文体验）
 *       → 追问链折叠作答 → 故事日期（文本输入）→ 照片（预检 + 压缩 + 本地预览 + 保存时上传）
 *       → 🎤 语音输入 / 🔊 朗读话题 → 一键保存并跳转回忆录。
 * 契约（顶层函数声明，供 逻辑-app.js / A5 用 typeof 探测）：
 *   renderStory(el, topic, member) / toggleFollowup(idx) / onVoiceToggle() / onReadAloud()
 *   onPickDate(value) / onUploadPhotos(fileList) / saveStory() / renderStoryForEdit(storyId)
 * 消费：
 *   C1 API.createStory(payload) / updateStory(id,payload) / uploadPhotos(storyId,fileList,caption)
 *      / deletePhoto(id) / photoUrl(filename)（失败已由 api.js 统一 toast 并 reject）
 *   C3 navigate(viewId, params)
 *   C4 Store.getStory/getTopic/getMember/photosOfStory/followupsOf/upsertStory/addPhotos
 *      /removePhoto/notify
 *   C5 Dialog.confirm({title,message,confirmText,danger}) / Dialog.toast(message,type)
 *   C6 复用 A3 基础类（.card/.btn/.btn-ok/.empty-state/.page-title），专属类前缀 .view-story-
 *   C7 ImageKit.isAllowed(file) / compress(file)（预检失败已自动 toast；compress 返回 File）
 *   C8 Voice.isRecognitionSupported/isSynthesisSupported/startRecognition/stopRecognition/speak
 * 依赖：dialog / store / api / image / voice 脚本已先行加载（index.html 中 defer 顺序）。
 * 安全：话题文本、讲述人、追问、作答、说明、按钮文案一律 textContent / createElement /
 *       .value / .setAttribute 写入 DOM，不拼接任何标记字符串。
 * 关键设计（避坑）：
 *   1) Store.notify() 会触发整视图重渲染，故表单内容全部落在本模块级变量，input 事件实时回填；
 *      _storyFormKey 为上下文键，仅当上下文变化时才重置表单，保证「重渲染不丢字」。
 *   2) 照片延迟上传：选择时只预检 + 压缩 + 本地预览，真正上传放在 saveStory（此时已有 storyId）。
 *      任何一步抛错都停留在当前页且表单内容不丢。
 *   3) ObjectURL 与 revokeObjectURL 严格配对，移除预览 / 重置表单 / 保存成功后均释放。
 */

// ── 模块级状态（必须跨重渲染恢复）──────────────────────────────
var _storyEditingId = null;      // 编辑模式目标故事 id；null 表示新建
var _storyFormKey = null;        // 当前表单上下文键；变化时才重置表单
var _storyId = null;             // 当前故事 id（新建未保存为 null）
var _storyTopicId = null;        // 当前话题 id
var _storyMemberId = null;       // 当前讲述人 id
var _storyTopicText = '';        // 当前话题文本（朗读与回显用）
var _storyContent = '';          // 正文（实时同步）
var _storyDate = '';             // 故事日期（文本）
var _storyFollowupTexts = [];    // 追问问题文本快照（最多 2 条）
var _storyFollowupAnswers = [];  // 与 _storyFollowupTexts 一一对应的作答
var _storyFollowupsOpen = [false, false]; // 各追问作答区折叠态（默认收起）
var _storyPending = [];          // 待上传照片 File 列表
var _storyPendingUrls = [];      // 与 _storyPending 一一对应的预览 ObjectURL
var _storyCaption = '';          // 照片说明（本次待上传照片共用）
var _storyVoiceOn = false;       // 语音识别进行中
var _storySaving = false;        // 保存进行中（防连点）

// 小工具：创建元素并写入纯文本
function _storyEl(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// 释放全部待上传预览 ObjectURL（与 createObjectURL 严格配对）
function _storyReleasePending() {
  for (var i = 0; i < _storyPendingUrls.length; i++) {
    if (_storyPendingUrls[i]) URL.revokeObjectURL(_storyPendingUrls[i]);
  }
  _storyPendingUrls = [];
}

// 复位表单全部字段（切换上下文 / 保存成功后调用）
function _storyClearForm() {
  _storyId = null;
  _storyTopicId = null;
  _storyMemberId = null;
  _storyTopicText = '';
  _storyContent = '';
  _storyDate = '';
  _storyFollowupTexts = [];
  _storyFollowupAnswers = [];
  _storyFollowupsOpen = [false, false];
  _storyReleasePending();
  _storyPending = [];
  _storyCaption = '';
  _storyVoiceOn = false;
  _storySaving = false;
}

// 话题追问链文本（最多 2 条）：优先话题内嵌 follow_ups，兜底 Store.followupsOf；
// 编辑模式下若话题已改动，用故事内已存 followups[].q 补齐（不重复）
function _storyFollowupTextsFor(topicObj, editing) {
  var out = [];
  var fus = [];
  if (topicObj && topicObj.follow_ups && topicObj.follow_ups.length) {
    fus = topicObj.follow_ups;
  } else if (topicObj) {
    fus = Store.followupsOf(topicObj.id) || [];
  }
  for (var i = 0; i < fus.length && out.length < 2; i++) {
    if (fus[i]) out.push(fus[i]);
  }
  if (editing && editing.followups && editing.followups.length) {
    for (var j = 0; j < editing.followups.length && out.length < 2; j++) {
      var fu = editing.followups[j];
      var q = fu && fu.q;
      if (q && out.indexOf(q) === -1) out.push(q);
    }
  }
  return out;
}

// 编辑模式回填作答：先按问题文本精确匹配，再按位置兜底
function _storyFollowupPrefill(texts, editing) {
  var out = [];
  for (var i = 0; i < texts.length; i++) out.push('');
  if (!editing || !editing.followups || !editing.followups.length) return out;

  var used = {};
  for (var k = 0; k < editing.followups.length; k++) {
    var fu = editing.followups[k];
    if (!fu) continue;
    var q = fu.q || '';
    var idx = -1;
    for (var m = 0; m < texts.length; m++) {
      if (!used[m] && texts[m] === q) { idx = m; break; }
    }
    if (idx === -1 && k < texts.length && !used[k]) idx = k;
    if (idx !== -1) {
      out[idx] = fu.a == null ? '' : String(fu.a);
      used[idx] = true;
    }
  }
  return out;
}

// 按上下文装载表单初值
function _storyResetForm(topicId, memberId, topicObj, editing) {
  _storyId = editing ? editing.id : null;
  _storyTopicId = topicId;
  _storyMemberId = memberId;
  _storyTopicText = (topicObj && topicObj.text) || (editing && editing.topic_text) || '';
  _storyFollowupTexts = _storyFollowupTextsFor(topicObj, editing);
  _storyFollowupsOpen = [false, false];
  _storyVoiceOn = false;
  _storySaving = false;
  _storyCaption = '';
  _storyReleasePending();
  _storyPending = [];

  if (editing) {
    _storyContent = editing.content == null ? '' : String(editing.content);
    _storyDate = editing.story_date == null ? '' : String(editing.story_date);
    _storyFollowupAnswers = _storyFollowupPrefill(_storyFollowupTexts, editing);
  } else {
    _storyContent = '';
    _storyDate = '';
    _storyFollowupAnswers = _storyFollowupPrefill(_storyFollowupTexts, null);
  }
}

// 讲述人显示名：优先「关系 · 姓名」
function _storySpeakerLabel(memberObj) {
  if (!memberObj) return '—';
  var rel = memberObj.relation || '';
  var nm = memberObj.name || '';
  if (rel && nm) return rel + ' · ' + nm;
  return rel || nm || '—';
}

// ── 视图渲染 ──────────────────────────────────────────────
function renderStory(el, topic, member) {
  if (!el) return;

  // 编辑模式解析：目标故事须存在，且当前上下文与之匹配，否则退出编辑模式
  var editing = null;
  if (_storyEditingId != null) {
    var target = Store.getStory(_storyEditingId);
    if (!target) {
      _storyEditingId = null;
    } else if (topic && member &&
      (String(target.topic_id) !== String(topic.id) ||
       String(target.member_id) !== String(member.id))) {
      _storyEditingId = null;   // 进入了不同上下文 → 按新建处理
    } else {
      editing = target;
    }
  }

  // 上下文缺失：引导先去抽题
  if (!editing && (!topic || !member)) {
    _storyFormKey = null;
    el.textContent = '';
    el.appendChild(_storyBuildEmpty());
    return;
  }

  var topicId = editing ? editing.topic_id : topic.id;
  var memberId = editing ? editing.member_id : member.id;
  var topicObj = Store.getTopic(topicId) ||
    (editing ? { id: topicId, text: editing.topic_text || '', follow_ups: [] } : topic);
  var memberObj = Store.getMember(memberId) ||
    (editing ? { id: memberId, relation: editing.relation, name: editing.name } : member);

  // 上下文键：变化时才重置表单（否则沿用模块级变量，实现重渲染不丢字）
  var key = String(topicId) + ':' + String(memberId) + ':' + (editing ? 'e' + editing.id : 'new');
  if (key !== _storyFormKey) {
    _storyFormKey = key;
    _storyResetForm(topicId, memberId, topicObj, editing);
  }

  el.textContent = '';
  el.appendChild(_storyEl('h2', 'page-title', editing ? '编辑故事' : '讲故事'));
  el.appendChild(_storyBuildContext(topicObj, memberObj));
  el.appendChild(_storyBuildForm());
}

// 无上下文引导（复用 A3 .empty-state）
function _storyBuildEmpty() {
  var box = _storyEl('div', 'empty-state');
  box.appendChild(_storyEl('p', 'empty-title', '还没有选好话题'));
  box.appendChild(_storyEl('p', 'empty-text', '先到抽题盒子抽一个话题，再回来把故事记下来。'));

  var go = _storyEl('button', 'btn btn-primary', '去抽一题');
  go.type = 'button';
  go.addEventListener('click', function () { navigate('draw'); });
  box.appendChild(go);
  return box;
}

// 上下文卡：话题回显 + 讲述人 + 语音工具
function _storyBuildContext(topicObj, memberObj) {
  var card = _storyEl('div', 'card view-story-context');
  card.appendChild(_storyEl('p', 'view-story-topic', (topicObj && topicObj.text) || _storyTopicText || ''));
  card.appendChild(_storyEl('p', 'view-story-speaker', '讲述人：' + _storySpeakerLabel(memberObj)));
  card.appendChild(_storyBuildVoice());
  return card;
}

// 语音区：按支持能力渲染 🎤 / 🔊
function _storyBuildVoice() {
  var wrap = _storyEl('div', 'view-story-voice');

  if (Voice.isRecognitionSupported()) {
    var mic = _storyEl('button', 'btn btn-ghost view-story-voice-btn view-story-voice-mic',
      _storyVoiceOn ? '🎤 识别中…点击停止' : '🎤 语音输入');
    mic.type = 'button';
    mic.setAttribute('aria-pressed', _storyVoiceOn ? 'true' : 'false');
    mic.addEventListener('click', function () { onVoiceToggle(); });
    wrap.appendChild(mic);
  } else {
    wrap.appendChild(_storyEl('p', 'view-story-voice-hint', '当前浏览器不支持语音，请手动输入'));
  }

  if (Voice.isSynthesisSupported()) {
    var read = _storyEl('button', 'btn btn-ghost view-story-voice-btn view-story-voice-read', '🔊 朗读话题');
    read.type = 'button';
    read.addEventListener('click', function () { onReadAloud(); });
    wrap.appendChild(read);
  }

  return wrap;
}

// 表单主体
function _storyBuildForm() {
  var form = _storyEl('div', 'view-story-form');

  // 正文
  var contentField = _storyEl('div', 'view-story-field');
  var contentLabel = _storyEl('label', 'view-story-label', '讲述正文');
  contentField.appendChild(contentLabel);
  var ta = document.createElement('textarea');
  ta.className = 'view-story-textarea';
  ta.rows = 8;
  ta.value = _storyContent;
  ta.placeholder = '把长辈讲的故事记下来……（可留空先保存，之后再补）';
  ta.setAttribute('aria-label', '讲述正文');
  ta.addEventListener('input', function () { _storyContent = ta.value; });
  contentField.appendChild(ta);
  form.appendChild(contentField);

  // 追问链
  if (_storyFollowupTexts.length) form.appendChild(_storyBuildFollowups());

  // 故事日期（文本输入，不使用浏览器日期控件）
  var dateField = _storyEl('div', 'view-story-field');
  dateField.appendChild(_storyEl('label', 'view-story-label', '故事发生日期（可选）'));
  var dateInput = document.createElement('input');
  dateInput.type = 'text';
  dateInput.className = 'view-story-date';
  dateInput.value = _storyDate;
  dateInput.placeholder = '如 1985 或 1985-06-01';
  dateInput.setAttribute('inputmode', 'numeric');
  dateInput.setAttribute('aria-label', '故事发生日期');
  dateInput.addEventListener('input', function () { onPickDate(dateInput.value); });
  dateField.appendChild(dateInput);
  dateField.appendChild(_storyEl('p', 'view-story-hint', '可只填年份（如 1985），也可填完整日期（如 1985-06-01）。'));
  form.appendChild(dateField);

  // 照片
  var photoField = _storyEl('div', 'view-story-field');
  photoField.appendChild(_storyEl('label', 'view-story-label', '照片（可选）'));
  photoField.appendChild(_storyBuildPhotos());
  form.appendChild(photoField);

  // 保存
  var actions = _storyEl('div', 'view-story-actions');
  var save = _storyEl('button', 'btn btn-ok view-story-save', _storyId == null ? '保存到回忆录' : '保存修改');
  save.type = 'button';
  save.addEventListener('click', function () { saveStory(); });
  actions.appendChild(save);
  form.appendChild(actions);

  return form;
}

// ── 追问链（最多 2 条，默认收起，用 .is-open 类切换）──────────
function _storyBuildFollowups() {
  var box = _storyEl('div', 'view-story-followups');
  box.appendChild(_storyEl('p', 'view-story-label', '追问（展开后作答，可留空）'));
  for (var i = 0; i < _storyFollowupTexts.length; i++) {
    box.appendChild(_storyBuildFollowupBlock(i));
  }
  return box;
}

function _storyBuildFollowupBlock(idx) {
  var open = !!_storyFollowupsOpen[idx];
  var block = _storyEl('div', 'view-story-followup' + (open ? ' is-open' : ''));
  block.setAttribute('data-followup', String(idx));

  var toggle = _storyEl('button',
    'view-story-followup-toggle' + (open ? ' is-open' : ''),
    '追问 ' + (idx + 1) + '：' + _storyFollowupTexts[idx]);
  toggle.type = 'button';
  toggle.setAttribute('data-followup', String(idx));
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  toggle.addEventListener('click', function () { toggleFollowup(idx); });
  block.appendChild(toggle);

  var body = _storyEl('div', 'view-story-followup-body');

  var input = document.createElement('textarea');
  input.className = 'view-story-followup-input';
  input.rows = 3;
  input.value = _storyFollowupAnswers[idx] || '';
  input.placeholder = '写下这一问的回答……';
  input.setAttribute('aria-label', '追问回答 ' + (idx + 1));
  input.addEventListener('input', function () { _storyFollowupAnswers[idx] = input.value; });
  body.appendChild(input);

  block.appendChild(body);
  return block;
}

// 展开 / 收起第 idx 条追问作答区
function toggleFollowup(idx) {
  if (idx < 0 || idx >= _storyFollowupTexts.length) return;
  _storyFollowupsOpen[idx] = !_storyFollowupsOpen[idx];

  var block = document.querySelector('.view-story-followup[data-followup="' + idx + '"]');
  if (block) block.classList.toggle('is-open', _storyFollowupsOpen[idx]);

  var toggle = document.querySelector('.view-story-followup-toggle[data-followup="' + idx + '"]');
  if (toggle) {
    toggle.classList.toggle('is-open', _storyFollowupsOpen[idx]);
    toggle.setAttribute('aria-expanded', _storyFollowupsOpen[idx] ? 'true' : 'false');
  }
}

// ── 照片区 ────────────────────────────────────────────────
function _storyBuildPhotos() {
  var wrap = _storyEl('div', 'view-story-photos');
  var grid = _storyEl('div', 'view-story-photos-grid');

  // 已保存照片（编辑模式）
  if (_storyId != null) {
    var saved = Store.photosOfStory(_storyId);
    for (var i = 0; i < saved.length; i++) grid.appendChild(_storyBuildSavedPhoto(saved[i]));
  }
  // 待上传照片（本地预览）
  for (var j = 0; j < _storyPending.length; j++) {
    grid.appendChild(_storyBuildPendingPhoto(j));
  }
  wrap.appendChild(grid);

  // 控制区：添加按钮 + 隐藏 file 输入 + 共用说明
  var controls = _storyEl('div', 'view-story-photos-controls');

  var file = document.createElement('input');
  file.type = 'file';
  file.className = 'view-story-file';
  file.accept = 'image/*';
  file.multiple = true;
  file.setAttribute('aria-label', '选择照片');
  file.addEventListener('change', function () {
    onUploadPhotos(file.files);
    file.value = '';   // 允许再次选择同一文件
  });
  controls.appendChild(file);

  var addBtn = _storyEl('button', 'btn btn-ghost view-story-photo-add', '＋ 添加照片');
  addBtn.type = 'button';
  addBtn.addEventListener('click', function () { file.click(); });
  controls.appendChild(addBtn);

  var caption = document.createElement('input');
  caption.type = 'text';
  caption.className = 'view-story-caption';
  caption.maxLength = 80;
  caption.value = _storyCaption;
  caption.placeholder = '给这些照片加一句说明（可选）';
  caption.setAttribute('aria-label', '照片说明');
  caption.addEventListener('input', function () { _storyCaption = caption.value; });
  controls.appendChild(caption);

  wrap.appendChild(controls);
  return wrap;
}

function _storyBuildSavedPhoto(photo) {
  var item = _storyEl('div', 'view-story-photo-item');

  var img = document.createElement('img');
  img.className = 'view-story-photo-img';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = photo.caption || '故事照片';
  img.src = API.photoUrl(photo.filename);
  item.appendChild(img);

  var row = _storyEl('div', 'view-story-photo-row');
  row.appendChild(_storyEl('span', 'view-story-photo-caption', photo.caption || ''));
  var del = _storyEl('button', 'btn btn-danger view-story-photo-del', '删除');
  del.type = 'button';
  del.addEventListener('click', function () { _storyDeletePhoto(photo); });
  row.appendChild(del);
  item.appendChild(row);

  return item;
}

function _storyBuildPendingPhoto(index) {
  var item = _storyEl('div', 'view-story-photo-item');

  var img = document.createElement('img');
  img.className = 'view-story-photo-img';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = '待上传照片预览';
  img.src = _storyPendingUrls[index];
  item.appendChild(img);

  var row = _storyEl('div', 'view-story-photo-row');
  row.appendChild(_storyEl('span', 'view-story-photo-caption', '待上传'));
  var del = _storyEl('button', 'btn btn-danger view-story-photo-del', '删除');
  del.type = 'button';
  del.addEventListener('click', function () { _storyRemovePending(index); });
  row.appendChild(del);
  item.appendChild(row);

  return item;
}

// 原地重建照片区（避免整体重渲染导致正文失焦）
function _storyRenderPhotos() {
  var view = document.getElementById('view-story');
  if (!view) return;
  var host = view.querySelector('.view-story-photos');
  if (!host || !host.parentNode) return;
  host.parentNode.replaceChild(_storyBuildPhotos(), host);
}

// 选择照片：预检 → 逐张串行压缩 → 本地预览（此时不上传）
async function onUploadPhotos(fileList) {
  var files = [];
  if (fileList) {
    for (var i = 0; i < fileList.length; i++) files.push(fileList[i]);
  }
  if (!files.length) return;

  for (var k = 0; k < files.length; k++) {
    var f = files[k];
    if (!ImageKit.isAllowed(f)) continue;   // 预检失败已由 ImageKit 内部 toast
    var out = f;
    try {
      out = await ImageKit.compress(f);
    } catch (e) {
      out = f;   // 压缩异常 → 回退原图（后端魔数/大小兜底）
    }
    if (!out) continue;
    _storyPending.push(out);
    _storyPendingUrls.push(URL.createObjectURL(out));
  }

  _storyRenderPhotos();
}

// 移除待上传照片（二次确认）
async function _storyRemovePending(index) {
  if (index < 0 || index >= _storyPending.length) return;
  var okDel = await Dialog.confirm({
    title: '移除照片',
    message: '确定移除这张待上传的照片吗？',
    confirmText: '移除',
    danger: true,
  });
  if (!okDel) return;

  var url = _storyPendingUrls[index];
  if (url) URL.revokeObjectURL(url);
  _storyPending.splice(index, 1);
  _storyPendingUrls.splice(index, 1);
  _storyRenderPhotos();
}

// 删除已保存照片（二次确认 → 调接口 → 本地同步）
async function _storyDeletePhoto(photo) {
  var okDel = await Dialog.confirm({
    title: '删除照片',
    message: '删除后不可恢复，确定删除这张照片吗？',
    confirmText: '删除',
    danger: true,
  });
  if (!okDel) return;

  try {
    await API.deletePhoto(photo.id);
    Store.removePhoto(photo.id);
    Store.notify();   // 触发重渲染；编辑态由 _storyFormKey 维持，表单内容不丢
    Dialog.toast('已删除照片', 'success');
  } catch (e) {
    // 失败已由 api.js 统一 toast
  }
}

// ── 日期 ──────────────────────────────────────────────────
function onPickDate(value) {
  _storyDate = value == null ? '' : String(value);
}

// ── 语音 ──────────────────────────────────────────────────
function onVoiceToggle() {
  if (!Voice.isRecognitionSupported()) {
    Dialog.toast('当前浏览器不支持语音，请手动输入', 'info');
    return;
  }

  if (_storyVoiceOn) {
    Voice.stopRecognition();   // 触发 onend → Promise resolve → 复位按钮
    return;
  }

  _storyVoiceOn = true;
  _storyUpdateVoiceButton();

  Voice.startRecognition(
    function (interimText) { _storyShowInterim(interimText); },
    function (finalText) { _storyAppendContent(finalText); }
  ).then(function () {
    // 会话自然结束 / 出错 / 主动停止统一在此复位，避免按钮卡在「识别中」
    _storyVoiceOn = false;
    _storyUpdateVoiceButton();
  });
}

function onReadAloud() {
  if (!Voice.isSynthesisSupported()) {
    Dialog.toast('当前浏览器不支持朗读', 'info');
    return;
  }
  if (!_storyTopicText) {
    Dialog.toast('暂无话题可朗读', 'info');
    return;
  }
  Voice.speak(_storyTopicText);
}

// 语音按钮状态复位（按类名查找当前 DOM，避免持有过期引用）
function _storyUpdateVoiceButton() {
  var mic = document.querySelector('.view-story-voice-mic');
  if (!mic) return;
  mic.textContent = _storyVoiceOn ? '🎤 识别中…点击停止' : '🎤 语音输入';
  mic.setAttribute('aria-pressed', _storyVoiceOn ? 'true' : 'false');
}

// 识别中：临时结果仅回填输入框，不写入正文
function _storyShowInterim(text) {
  var ta = document.querySelector('.view-story-textarea');
  if (!ta) return;
  var interim = text == null ? '' : String(text);
  ta.value = _storyContent + interim;
}

// 识别定稿：追加到正文并同步输入框
function _storyAppendContent(text) {
  var finalText = text == null ? '' : String(text);
  if (!finalText) return;
  _storyContent = _storyContent ? (_storyContent + finalText) : finalText;
  var ta = document.querySelector('.view-story-textarea');
  if (ta) ta.value = _storyContent;
}

// ── 保存 ──────────────────────────────────────────────────
// 组装追问链 payload：仅收录「有问且有答」的条目，q 为话题追问快照
function _storyBuildFollowupsPayload() {
  var out = [];
  for (var i = 0; i < _storyFollowupTexts.length; i++) {
    var q = _storyFollowupTexts[i];
    var a = _storyFollowupAnswers[i] || '';
    if (!q || !a.trim()) continue;
    out.push({ q: q, a: a.trim() });
  }
  return out;
}

async function saveStory() {
  if (_storySaving) return;
  if (_storyTopicId == null || _storyMemberId == null) {
    Dialog.toast('缺少话题或讲述人，无法保存', 'error');
    return;
  }

  _storySaving = true;
  var btn = document.querySelector('.view-story-save');
  if (btn) btn.disabled = true;

  try {
    // 1) 组装 payload（story_date 始终随请求发送，空串由后端落 NULL，支持编辑时清空日期）
    var payload = {
      topic_id: _storyTopicId,
      member_id: _storyMemberId,
      content: _storyContent,
      story_date: _storyDate,
      followups: _storyBuildFollowupsPayload(),
    };

    // 2) 新建或更新故事（每次显式发送全部可写字段）
    var story = (_storyId == null)
      ? await API.createStory(payload)
      : await API.updateStory(_storyId, payload);

    if (story && story.id != null) _storyId = story.id;
    Store.upsertStory(story);

    // 3) 延迟到来的照片：此时 storyId 已确定，统一上传
    if (_storyPending.length > 0) {
      var photos = await API.uploadPhotos(_storyId, _storyPending, _storyCaption);
      Store.addPhotos(photos || []);
      _storyReleasePending();
      _storyPending = [];
    }

    // 4) 成功：清理表单状态并跳转回忆录
    Dialog.toast('已收进回忆录', 'success');
    _storyFormKey = null;
    _storyEditingId = null;
    _storyClearForm();
    navigate('memoir');
  } catch (e) {
    // 任何一步失败：停留当前页，表单内容与待上传照片全部保留（错误已由 api.js 统一 toast）
  } finally {
    _storySaving = false;
    if (btn) btn.disabled = false;
  }
}

// ── 编辑入口（契约外扩展，供 A5 回忆录调用）──────────────
// 顶层全局函数：定位故事 → 标记编辑态 → 携上下文跳转讲故事视图
function renderStoryForEdit(storyId) {
  var s = Store.getStory(storyId);
  if (!s) {
    Dialog.toast('未找到这条故事', 'error');
    return;
  }
  _storyEditingId = s.id;
  navigate('story', { topic: s.topic_id, member: s.member_id });
}

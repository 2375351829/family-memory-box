/* 模块-视图-家人-members.js · 工单 A4（F1 家人设置视图）
 * 职责：渲染家人设置视图——成员卡片列表、内联添加/编辑表单、一键预设 5 位家人、删除二次确认、空状态引导。
 * 契约（顶层函数声明，供 逻辑-app.js 用 typeof 探测）：
 *   renderMembers(el)  // 把家人设置视图渲染到容器 el 内
 * 消费：
 *   C1 API.createMember/updateMember/deleteMember（失败已由 api.js 统一 toast）
 *   C4 Store.state.members / getMember / upsertMember / removeMember / notify（不调用 loadAll）
 *   C5 Dialog.confirm({confirmText,danger}) / Dialog.toast(message,type)
 *   C6 样式复用 A3 基础类，专属类前缀 .view-members-
 * 依赖：dialog / store / api 脚本已先行加载（index.html 中 defer 顺序）。
 * 安全：姓名、称谓等用户内容一律 textContent / createElement 写入 DOM，不拼接 HTML。
 */

// token 配色色板（与《开发计划》9.1 一致，作为成员头像可选色）
var MEMBERS_COLORS = ['#C0392B', '#D4A24C', '#3E8E5A', '#101A33', '#D9822B', '#6B6355'];

// 一键预设：称谓 = 姓名（用户可再编辑），各配不同默认头像色
var MEMBERS_PRESET = [
  { relation: '爷爷', name: '爷爷', color: '#101A33' },
  { relation: '奶奶', name: '奶奶', color: '#C0392B' },
  { relation: '爸爸', name: '爸爸', color: '#D4A24C' },
  { relation: '妈妈', name: '妈妈', color: '#3E8E5A' },
  { relation: '我', name: '我', color: '#D9822B' },
];

// 模块级状态：当前正在编辑的成员 id（null 表示新增态）
var _membersEditingId = null;

// 成员排序：sort_order 升序，缺失时回退 id
function _membersSortCompare(a, b) {
  var ao = a.sort_order == null ? a.id : a.sort_order;
  var bo = b.sort_order == null ? b.id : b.sort_order;
  if (ao !== bo) return ao - bo;
  return (a.id || 0) - (b.id || 0);
}

// 从 Store 取排序后的成员快照（每次渲染都重新读取，不依赖上次 DOM）
function _membersSorted() {
  var arr = (Store.state.members || []).slice();
  arr.sort(_membersSortCompare);
  return arr;
}

// 头像色块内显示的字：优先称谓首字，回退姓名首字
function _membersInitial(m) {
  var s = m.relation && m.relation.length ? m.relation : (m.name || '');
  return s ? s.charAt(0) : '?';
}

// 只读渲染入口
function renderMembers(el) {
  el.textContent = '';

  var title = document.createElement('h2');
  title.className = 'page-title';
  title.textContent = '家人设置';
  el.appendChild(title);

  var members = _membersSorted();

  if (!members.length) {
    el.appendChild(_membersBuildEmpty());
  } else {
    el.appendChild(_membersBuildToolbar());
    var list = document.createElement('div');
    list.className = 'view-members-list';
    for (var i = 0; i < members.length; i++) {
      list.appendChild(_membersBuildCard(members[i], el));
    }
    el.appendChild(list);
  }

  el.appendChild(_membersBuildForm(el));
}

// 顶部工具条：一键预设
function _membersBuildToolbar() {
  var bar = document.createElement('div');
  bar.className = 'view-members-toolbar';

  var preset = document.createElement('button');
  preset.type = 'button';
  preset.className = 'btn btn-ghost';
  preset.textContent = '一键预设 5 位家人';
  preset.addEventListener('click', function () { _membersPreset(preset); });

  bar.appendChild(preset);
  return bar;
}

// 空状态：引导文案 + 一键预设行动按钮
function _membersBuildEmpty() {
  var box = document.createElement('div');
  box.className = 'empty-state';

  var t = document.createElement('p');
  t.className = 'empty-title';
  t.textContent = '还没有家人';

  var x = document.createElement('p');
  x.className = 'empty-text';
  x.textContent = '先添加家人，才能开始抽题、讲故事。可以一键预设，也可以在下方手动添加。';

  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-primary';
  b.textContent = '一键预设 5 位家人';
  b.addEventListener('click', function () { _membersPreset(b); });

  box.appendChild(t);
  box.appendChild(x);
  box.appendChild(b);
  return box;
}

// 单个成员卡片：头像色块 + 称谓大字 + 姓名 + 编辑/删除
function _membersBuildCard(m, el) {
  var card = document.createElement('div');
  card.className = 'card view-members-card';

  var avatar = document.createElement('div');
  avatar.className = 'view-members-avatar';
  avatar.style.background = m.avatar_color || '#C0392B';
  avatar.textContent = _membersInitial(m);

  var info = document.createElement('div');
  info.className = 'view-members-info';

  var relation = document.createElement('div');
  relation.className = 'view-members-relation';
  relation.textContent = m.relation || '';

  var name = document.createElement('div');
  name.className = 'view-members-name';
  name.textContent = m.name || '';

  info.appendChild(relation);
  info.appendChild(name);

  var actions = document.createElement('div');
  actions.className = 'view-members-actions';

  var editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn btn-ghost';
  editBtn.textContent = '编辑';
  editBtn.addEventListener('click', function () {
    // 进入编辑态：仅切模块级标记 + 局部重渲染，不发请求
    _membersEditingId = m.id;
    renderMembers(el);
    var form = el.querySelector('.view-members-form');
    if (form && form.scrollIntoView) form.scrollIntoView({ block: 'nearest' });
  });

  var delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-danger';
  delBtn.textContent = '删除';
  delBtn.addEventListener('click', function () { _membersDelete(m, el); });

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  card.appendChild(avatar);
  card.appendChild(info);
  card.appendChild(actions);
  return card;
}

// 内联添加/编辑表单（不使用 dialog 表单）
function _membersBuildForm(el) {
  var editing = _membersEditingId != null ? Store.getMember(_membersEditingId) : null;
  if (_membersEditingId != null && !editing) _membersEditingId = null; // 成员已被删：退出编辑态

  var form = document.createElement('div');
  form.className = 'card view-members-form';

  var h = document.createElement('h3');
  h.className = 'view-members-form-title';
  h.textContent = editing ? '编辑家人' : '添加家人';
  form.appendChild(h);

  // 姓名（1–20 字）
  var nameInput = _membersBuildInput('姓名', '如：李桂英', 20, editing ? (editing.name || '') : '');
  form.appendChild(nameInput.field);

  // 称谓（1–10 字）
  var relationInput = _membersBuildInput('称谓', '如：奶奶', 10, editing ? (editing.relation || '') : '');
  form.appendChild(relationInput.field);

  // 头像色选择（色板基于 token 配色）
  var selectedColor = editing && editing.avatar_color && MEMBERS_COLORS.indexOf(editing.avatar_color) !== -1
    ? editing.avatar_color
    : MEMBERS_COLORS[0];

  var colorField = document.createElement('div');
  colorField.className = 'view-members-field';

  var colorLabel = document.createElement('span');
  colorLabel.className = 'view-members-label';
  colorLabel.textContent = '头像色';
  colorField.appendChild(colorLabel);

  var swatches = document.createElement('div');
  swatches.className = 'view-members-swatches';
  var swatchBtns = [];

  for (var i = 0; i < MEMBERS_COLORS.length; i++) {
    (function (color) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'view-members-swatch' + (color === selectedColor ? ' is-selected' : '');
      b.style.background = color; // 固定 token 色，非用户输入
      b.setAttribute('aria-label', '头像色 ' + color);
      b.setAttribute('aria-pressed', color === selectedColor ? 'true' : 'false');
      b.addEventListener('click', function () {
        selectedColor = color;
        for (var k = 0; k < swatchBtns.length; k++) {
          var sel = swatchBtns[k].color === color;
          swatchBtns[k].btn.classList.toggle('is-selected', sel);
          swatchBtns[k].btn.setAttribute('aria-pressed', sel ? 'true' : 'false');
        }
      });
      swatchBtns.push({ btn: b, color: color });
      swatches.appendChild(b);
    })(MEMBERS_COLORS[i]);
  }
  colorField.appendChild(swatches);
  form.appendChild(colorField);

  // 提交/取消
  var actions = document.createElement('div');
  actions.className = 'view-members-form-actions';

  var submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'btn btn-primary';
  submit.textContent = editing ? '保存修改' : '添加';
  submit.addEventListener('click', function () {
    _membersSubmit(el, editing, nameInput.input, relationInput.input, function () { return selectedColor; }, submit);
  });
  actions.appendChild(submit);

  if (editing) {
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-ghost';
    cancel.textContent = '取消编辑';
    cancel.addEventListener('click', function () {
      _membersEditingId = null;
      renderMembers(el);
    });
    actions.appendChild(cancel);
  }

  form.appendChild(actions);
  return form;
}

// 构造「标签 + 输入框」字段
function _membersBuildInput(labelText, placeholder, maxLen, value) {
  var field = document.createElement('div');
  field.className = 'view-members-field';

  var label = document.createElement('label');
  label.className = 'view-members-label';
  label.textContent = labelText;

  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'view-members-input';
  input.maxLength = maxLen;
  input.placeholder = placeholder;
  input.value = value || '';
  label.appendChild(input);

  field.appendChild(label);
  return { field: field, input: input };
}

// 提交：先做长度校验（超限不发请求），成功走 create / update
async function _membersSubmit(el, editing, nameInput, relationInput, getColor, submitBtn) {
  var name = (nameInput.value || '').trim();
  var relation = (relationInput.value || '').trim();

  if (name.length < 1 || name.length > 20) {
    Dialog.toast('姓名需为 1–20 字', 'error');
    return;
  }
  if (relation.length < 1 || relation.length > 10) {
    Dialog.toast('称谓需为 1–10 字', 'error');
    return;
  }

  var payload = { name: name, relation: relation, avatar_color: getColor() };
  submitBtn.disabled = true;
  try {
    var saved = editing
      ? await API.updateMember(editing.id, payload)
      : await API.createMember(payload);
    Store.upsertMember(saved);
    _membersEditingId = null;
    Store.notify();
    Dialog.toast(editing ? '已保存修改' : '已添加家人', 'success');
  } catch (e) {
    // api.js 已在 request 内统一 toast，此处仅吞掉拒绝，避免未捕获
  } finally {
    submitBtn.disabled = false;
  }
}

// 删除：danger 二次确认通过后才发请求
async function _membersDelete(m, el) {
  var okDel = await Dialog.confirm({
    title: '删除家人',
    message: '将同时删除其全部故事与照片，且不可恢复。',
    confirmText: '删除',
    danger: true,
  });
  if (!okDel) return;

  try {
    await API.deleteMember(m.id);
    Store.removeMember(m.id);
    if (_membersEditingId === m.id) _membersEditingId = null;
    Store.notify();
    Dialog.toast('已删除', 'success');
  } catch (e) {
    // 失败已由 api.js toast
  }
}

// 一键预设：并行创建 5 位；用 allSettled 兼容部分成功（失败项已由 api.js 逐条 toast）
async function _membersPreset(btn) {
  if (btn) btn.disabled = true;
  try {
    var results = await Promise.allSettled(MEMBERS_PRESET.map(function (p) {
      return API.createMember({ name: p.name, relation: p.relation, avatar_color: p.color });
    }));
    var added = 0;
    for (var i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled' && results[i].value) {
        Store.upsertMember(results[i].value);
        added++;
      }
    }
    if (added > 0) {
      Store.notify();
      Dialog.toast('已添加 ' + added + ' 位家人', 'success');
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

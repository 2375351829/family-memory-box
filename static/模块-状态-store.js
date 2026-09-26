/* 模块-状态-store.js · 契约 C4（签名照《开发计划》7.2 逐字）
 *   state / subscribe(fn) / notify() / async loadAll()
 *   getMember(id) / getTopic(id) / getStory(id)
 *   storiesOfMember(memberId) / storiesOfTopic(topicId) / photosOfStory(storyId)
 *   stats()  → {storyCount, memberCount, photoCount}
 * 另提供局部更新辅助（方法名可增，已列签名不变），供 A4/A5 在 API 成功后同步 state。
 * 依赖：API（运行时调用 API.getState）。
 */
const Store = {
  state: {
    members: [],
    topics: [],
    followups: {},
    stories: [],
    photos: [],
    capsules: [],
  },

  _subs: [],

  // 注册渲染回调；返回取消订阅函数（额外能力，不影响签名）
  subscribe(fn) {
    if (typeof fn === 'function' && this._subs.indexOf(fn) === -1) {
      this._subs.push(fn);
    }
    var self = this;
    return function unsubscribe() {
      var i = self._subs.indexOf(fn);
      if (i !== -1) self._subs.splice(i, 1);
    };
  },

  // 触发重渲染；单个回调异常不阻断其它视图
  notify() {
    for (var i = 0; i < this._subs.length; i++) {
      try {
        this._subs[i](this.state);
      } catch (e) {
        if (window.console) console.error('[Store] 订阅回调异常：', e);
      }
    }
  },

  // 调 API.getState() 整体替换 state 后 notify()
  async loadAll() {
    var data = await API.getState();
    this.state.members = data.members || [];
    this.state.topics = data.topics || [];
    this.state.followups = data.followups || {};
    this.state.stories = data.stories || [];
    this.state.photos = data.photos || [];
    this.state.capsules = data.capsules || [];
    this.notify();
    return this.state;
  },

  // ── 查询 ───────────────────────────────────────────────
  getMember(id) { return this._findById(this.state.members, id); },
  getTopic(id) { return this._findById(this.state.topics, id); },
  getStory(id) { return this._findById(this.state.stories, id); },

  storiesOfMember(memberId) {
    var key = this._key(memberId);
    return this.state.stories.filter(function (s) { return String(s.member_id) === key; });
  },
  storiesOfTopic(topicId) {
    var key = this._key(topicId);
    return this.state.stories.filter(function (s) { return String(s.topic_id) === key; });
  },
  photosOfStory(storyId) {
    var key = this._key(storyId);
    return this.state.photos.filter(function (p) { return String(p.story_id) === key; });
  },
  followupsOf(topicId) {
    return this.state.followups[this._key(topicId)] || [];
  },

  stats() {
    return {
      storyCount: this.state.stories.length,
      memberCount: this.state.members.length,
      photoCount: this.state.photos.length,
    };
  },

  // ── 局部更新辅助（供 A4/A5 在 API 成功后调用）────────────
  upsertMember(member) { this._upsert(this.state.members, member); },
  removeMember(id) { this._removeById(this.state.members, id); },

  upsertTopic(topic) { this._upsert(this.state.topics, topic); },
  removeTopic(id) { this._removeById(this.state.topics, id); },

  upsertStory(story) { this._upsert(this.state.stories, story); },
  removeStory(id) {
    this._removeById(this.state.stories, id);
    // 级联清理本地照片缓存
    var key = this._key(id);
    this.state.photos = this.state.photos.filter(function (p) {
      return String(p.story_id) !== key;
    });
  },

  addPhotos(list) {
    var arr = list || [];
    for (var i = 0; i < arr.length; i++) this._upsert(this.state.photos, arr[i]);
  },
  removePhoto(id) { this._removeById(this.state.photos, id); },

  upsertCapsule(capsule) { this._upsert(this.state.capsules, capsule); },
  removeCapsule(id) { this._removeById(this.state.capsules, id); },

  // ── 内部工具 ───────────────────────────────────────────
  _key(id) { return id == null ? '' : String(id); },

  _findById(list, id) {
    var key = this._key(id);
    for (var i = 0; i < list.length; i++) {
      if (this._key(list[i].id) === key) return list[i];
    }
    return null;
  },

  _upsert(list, item) {
    if (!item || item.id == null) return;
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (this._key(list[i].id) === this._key(item.id)) { idx = i; break; }
    }
    if (idx === -1) list.push(item);
    else list[idx] = item;
  },

  _removeById(list, id) {
    var key = this._key(id);
    for (var i = 0; i < list.length; i++) {
      if (this._key(list[i].id) === key) { list.splice(i, 1); return; }
    }
  },
};

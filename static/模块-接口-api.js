/* 模块-接口-api.js · 契约 C1 消费端（方法名照《开发计划》7.2 逐字，22 端点全覆盖）
 *   getState() / listMembers() / createMember(payload) / updateMember(id, payload) / deleteMember(id)
 *   listTopics(category) / createTopic(payload) / deleteTopic(id)
 *   draw(memberId, category) → {topic, round_no, is_new_round}
 *   createStory(payload) / updateStory(id, payload) / deleteStory(id)
 *   uploadPhotos(storyId, fileList, caption)  // FormData
 *   deletePhoto(id)
 *   getMemoir(view)                            // 'timeline' | 'member' | 'topic'
 *   exportJsonUrl(withPhotos = true)           // 返回下载 URL
 *   importJson(file)                           // FormData
 *   listCapsules() / createCapsule(payload) / openCapsule(id)
 * 内部 request(method, url, body)：统一处理 ok/error；失败 → Dialog.toast(message,'error') 并 reject。
 * 另提供 health() / photoUrl(filename) 覆盖端点 #1、#16（方法名可增，已列签名不变）。
 * 依赖：Dialog（运行时调用 Dialog.toast）。
 * 说明：uploadPhotos / importJson 用 FormData；不设超时拦截（家庭局域网）。
 */
const API = (function () {
  'use strict';

  /**
   * 统一请求封装。
   * @param {string} method HTTP 方法
   * @param {string} url    相对路径（同源）
   * @param {*}      body   JSON 对象（自动序列化）或 FormData（原样提交）
   * @param {{silent?:boolean}} opts silent=true 时不弹 toast（仅 reject）
   * @returns {Promise<*>} 成功时 resolve 后端 data 字段
   */
  async function request(method, url, body, opts) {
    opts = opts || {};
    var init = { method: method, headers: {} };

    if (body instanceof FormData) {
      init.body = body; // 不手动设 Content-Type，交给浏览器带 boundary
    } else if (body !== undefined && body !== null) {
      init.headers['Content-Type'] = 'application/json; charset=utf-8';
      init.body = JSON.stringify(body);
    }

    var resp;
    try {
      resp = await fetch(url, init);
    } catch (netErr) {
      var netMsg = '网络连接失败，请确认服务已启动';
      if (!opts.silent) Dialog.toast(netMsg, 'error');
      var ne = new Error(netMsg);
      ne.code = 'NETWORK';
      throw ne;
    }

    var data = null;
    var ct = resp.headers.get('content-type') || '';
    if (ct.indexOf('application/json') !== -1) {
      try { data = await resp.json(); } catch (parseErr) { data = null; }
    }

    if (!resp.ok || !data || data.ok !== true) {
      var errObj = (data && data.error) || {};
      var message = errObj.message || ('请求失败（HTTP ' + resp.status + '）');
      var code = errObj.code || ('HTTP_' + resp.status);
      if (!opts.silent) Dialog.toast(message, 'error');
      var e = new Error(message);
      e.code = code;
      e.status = resp.status;
      throw e;
    }
    return data.data;
  }

  function idPath(base, id) {
    return base + '/' + encodeURIComponent(id);
  }

  return {
    // 内部工具（供 A4/A5 复用，如需自定义请求）
    request: request,

    // 端点 #1（辅助，覆盖 healthcheck）
    health() { return request('GET', '/api/health'); },

    // 端点 #2
    getState() { return request('GET', '/api/state'); },

    // 端点 #3–#6 家庭成员
    listMembers() { return request('GET', '/api/members'); },
    createMember(payload) { return request('POST', '/api/members', payload); },
    updateMember(id, payload) { return request('PUT', idPath('/api/members', id), payload); },
    deleteMember(id) { return request('DELETE', idPath('/api/members', id)); },

    // 端点 #7–#9 话题
    listTopics(category) {
      var q = category ? '?category=' + encodeURIComponent(category) : '';
      return request('GET', '/api/topics' + q);
    },
    createTopic(payload) { return request('POST', '/api/topics', payload); },
    deleteTopic(id) { return request('DELETE', idPath('/api/topics', id)); },

    // 端点 #10 抽题
    draw(memberId, category) {
      var payload = { member_id: memberId };
      if (category) payload.category = category;
      return request('POST', '/api/draw', payload);
    },

    // 端点 #11–#13 故事
    createStory(payload) { return request('POST', '/api/stories', payload); },
    updateStory(id, payload) { return request('PUT', idPath('/api/stories', id), payload); },
    deleteStory(id) { return request('DELETE', idPath('/api/stories', id)); },

    // 端点 #14–#15 照片
    uploadPhotos(storyId, fileList, caption) {
      var fd = new FormData();
      var files = fileList || [];
      for (var i = 0; i < files.length; i++) fd.append('files[]', files[i]);
      if (caption != null && caption !== '') fd.append('caption', caption);
      return request('POST', idPath('/api/stories', storyId) + '/photos', fd);
    },
    deletePhoto(id) { return request('DELETE', idPath('/api/photos', id)); },

    // 端点 #16（辅助，返回图片可访问 URL）
    photoUrl(filename) { return '/uploads/' + encodeURIComponent(filename); },

    // 端点 #17 回忆录
    getMemoir(view) {
      return request('GET', '/api/memoir?view=' + encodeURIComponent(view || 'timeline'));
    },

    // 端点 #18 导出 JSON（返回下载 URL，供 A5 <a download> / location 使用）
    exportJsonUrl(withPhotos = true) {
      return '/api/export/json?with_photos=' + (withPhotos ? '1' : '0');
    },

    // 端点 #19 导入 JSON（覆盖式，调用方须先二次确认）
    importJson(file) {
      var fd = new FormData();
      fd.append('file', file);
      return request('POST', '/api/import/json', fd);
    },

    // 端点 #20–#22 时间胶囊
    listCapsules() { return request('GET', '/api/capsules'); },
    createCapsule(payload) { return request('POST', '/api/capsules', payload); },
    openCapsule(id) { return request('POST', idPath('/api/capsules', id) + '/open'); },
  };
})();

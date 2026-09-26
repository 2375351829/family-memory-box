/* 模块-组件-图片-image.js · 契约 C7（签名照《开发计划》7.2 逐字）
 *   async compress(file, maxEdge = 1600, quality = 0.82)  // canvas 压缩 → Blob；已是最小图则原样返回
 *   guessExt(file)      // 白名单：jpg/jpeg/png/webp/gif（白名单外/缺失返回 ''）
 *   isAllowed(file)     // 大小 ≤10MB + 类型白名单预检；失败提前 toast（省一次无效上传）
 * 依赖：Dialog（运行时调用 Dialog.toast）。消费端：讲故事视图 onUploadPhotos 的「预检 → 压缩 → 上传」链路。
 * 降级（开发计划 3.4）：canvas 不可用/失败（旧 Safari / 低端机 OOM / 解码失败）→ 回退原图直传，
 *   交服务端 §8.3 三重校验兜底（扩展名白名单 + 单文件 10MB + 魔数）。
 * 服务端兜底（后端服务-app.py / §8.3）：扩展名白名单 {jpg,jpeg,png,webp,gif}、单文件 10MB、读前 12 字节魔数。
 * 约束：不注入 HTML 字符串、不写入页面 DOM（仅建离屏 canvas 与 Image）；只返回数据，供调用方上传。
 */
const ImageKit = (function () {
  'use strict';

  var MAX_SIZE = 10 * 1024 * 1024;                 // 与后端 PHOTO_MAX_SIZE 一致：单文件 10MB
  var WHITELIST = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

  // 取白名单内的小写扩展名；缺失或白名单外（含 HEIC/HEIF）返回 ''
  function guessExt(file) {
    var name = (file && file.name) || '';
    var dot = name.lastIndexOf('.');
    if (dot === -1 || dot === name.length - 1) return '';
    var ext = name.slice(dot + 1).toLowerCase();
    return WHITELIST.indexOf(ext) === -1 ? '' : ext;
  }

  // 上传前预检：白名单外 / 超 10MB 直接拦截并提示，不发起无效上传
  function isAllowed(file) {
    if (!file) {
      Dialog.toast('请先选择图片文件', 'error');
      return false;
    }
    if (!guessExt(file)) {
      Dialog.toast('不支持的图片格式，请先转为 JPG（支持 jpg/png/webp/gif）', 'error');
      return false;
    }
    if (file.size > MAX_SIZE) {
      Dialog.toast('图片超过 10MB 上限，请压缩或更换后重试', 'error');
      return false;
    }
    return true;
  }

  // <img> + ObjectURL 解码（createImageBitmap 不可用时的兜底）
  function loadImageElement(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('图片解码失败')); };
      img.src = url;
    });
  }

  // canvas.toBlob 的 Promise 包装；不支持时 resolve(null)，由上层回退原图
  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      if (typeof canvas.toBlob !== 'function') { resolve(null); return; }
      try {
        canvas.toBlob(function (blob) { resolve(blob || null); }, type, quality);
      } catch (e) {
        resolve(null);
      }
    });
  }

  // 由实际输出 MIME 反推扩展名，保证文件名扩展名与内容一致（后端 §8.3 魔数校验）
  function extForMime(mime) {
    if (mime === 'image/png') return 'png';
    if (mime === 'image/webp') return 'webp';
    return 'jpg';
  }

  /**
   * canvas 预压缩：最长边超过 maxEdge 才重编码，否则原样返回（不做无意义二次编码）。
   * @param {File|Blob} file
   * @param {number} maxEdge 最长边上限（默认 1600）
   * @param {number} quality JPEG/WebP 质量（默认 0.82）
   * @returns {Promise<File|Blob>} 压缩结果；任一环节失败 → 返回原文件（原图直传）
   */
  async function compress(file, maxEdge = 1600, quality = 0.82) {
    if (!file) return file;
    // gif 不重编码：canvas 只取首帧（动画丢失），且多数浏览器 toBlob 不支持 image/gif，直接原样上传
    if (guessExt(file) === 'gif') return file;

    var bitmap = null;
    var objectUrl = null;
    try {
      // 优先 createImageBitmap（更快、可 close 释放）；不支持则 <img> + ObjectURL 兜底
      if (typeof createImageBitmap === 'function') {
        bitmap = await createImageBitmap(file);
      } else {
        objectUrl = URL.createObjectURL(file);
        bitmap = await loadImageElement(objectUrl);
      }

      var w = bitmap.naturalWidth || bitmap.width;
      var h = bitmap.naturalHeight || bitmap.height;
      if (!w || !h) throw new Error('图片尺寸未知');

      // 已是最小图（最长边不超过阈值）→ 原样返回
      if (Math.max(w, h) <= maxEdge) return file;

      var scale = maxEdge / Math.max(w, h);
      var tw = Math.max(1, Math.round(w * scale));
      var th = Math.max(1, Math.round(h * scale));

      var canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      var ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas 2d 上下文不可用');
      ctx.drawImage(bitmap, 0, 0, tw, th);

      // 输出 MIME：优先沿用原类型；缺失/异常时按扩展名推断，避免产出内容与扩展名不符
      var outMime = file.type;
      if (outMime !== 'image/jpeg' && outMime !== 'image/png' && outMime !== 'image/webp') {
        var ext = guessExt(file);
        outMime = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');
      }

      var blob = await canvasToBlob(canvas, outMime, quality);
      if (!blob) throw new Error('canvas 导出失败');
      // 压缩后反而更大（本就是高度优化的小图）→ 保留原图
      if (blob.size >= file.size) return file;

      // 返回 File（Blob 子类）：携带扩展名正确的文件名，供 FormData 上传通过后端白名单
      var name = file.name || 'photo';
      var dot = name.lastIndexOf('.');
      if (dot > 0) name = name.slice(0, dot);
      return new File(
        [blob],
        name + '.' + extForMime(blob.type || outMime),
        { type: blob.type || outMime, lastModified: file.lastModified || Date.now() }
      );
    } catch (e) {
      // canvas 失败（旧 Safari / 低端机 OOM / 解码失败）→ 回退原图直传，服务端 §8.3 兜底
      return file;
    } finally {
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  return { compress: compress, guessExt: guessExt, isAllowed: isAllowed };
})();

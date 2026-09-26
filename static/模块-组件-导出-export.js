/* 模块-组件-导出-export.js · 工单 A5（F8 PDF / F13 JSON 备份 / F16 长图）
 * 职责：导出组件——打印导出 PDF（打印封面 + 打印类开关）、JSON 备份下载 / 覆盖式导入、
 *       html2canvas 生成长图（照片墙临时切 grid，避免 columns 瀑布流渲染错版）。
 * 契约（顶层函数声明，逐字照《开发计划》7.2）：
 *   exportPdf() / exportJson(withPhotos) / importJson(file) / exportLongImage(el)
 * 消费：C1 API.exportJsonUrl/importJson；C3 navigate；C4 Store.loadAll；C5 Dialog；C6 打印样式与 A5 分区。
 * 安全：封面文案为固定文案，一律 textContent / createElement 写入，不拼接标记字符串。
 * 关键设计：html2canvas 动态注入（index.html 未引入）并带超时保护；
 *           exportLongImage 严格四步：加 exporting → await html2canvas → finally 移除 exporting → toBlob 下载。
 *           importJson 成功后须「先调用 _memoirInvalidate() 失效分组缓存、再 Store.loadAll()」，
 *           否则 loadAll() 内 notify 触发的重渲染会先用旧缓存渲染一帧（顺序不可颠倒）。
 */

// html2canvas 的动态加载 Promise（首次调用注入，失败后允许重试）
var _h2cPromise = null;

// ── 导出 PDF（依赖 A3 已预置的打印样式 + 打印封面）──────────
async function exportPdf() {
  var host = document.getElementById('view-memoir');
  if (!host) {
    Dialog.toast('导出失败：找不到回忆录视图', 'error');
    return;
  }
  // 确保当前处于回忆录视图，否则切过去并等待渲染
  if (!host.classList.contains('is-active')) {
    navigate('memoir');
    await _exportWaitActive(host);
  }

  _exportBuildCover(host);

  var done = false;
  function cleanup() {
    if (done) return;
    done = true;
    var cover = host.querySelector('.print-cover');
    if (cover && cover.parentNode) cover.parentNode.removeChild(cover);
    window.removeEventListener('afterprint', cleanup);
  }

  window.addEventListener('afterprint', cleanup);
  window.print();
  cleanup();   // 主流浏览器 print() 阻塞至对话框关闭；此行为兜底
}

// 等目标视图激活且已渲染出内容（最多约 3s，避免卡死）
function _exportWaitActive(host) {
  return new Promise(function (resolve) {
    var tries = 0;
    (function check() {
      if (host.classList.contains('is-active') && host.childElementCount > 0) { resolve(); return; }
      tries++;
      if (tries > 60) { resolve(); return; }
      setTimeout(check, 50);
    })();
  });
}

// 生成打印封面（非打印态由 .print-cover{display:none} 隐藏）
function _exportBuildCover(host) {
  var old = host.querySelector('.print-cover');
  if (old && old.parentNode) old.parentNode.removeChild(old);

  var cover = document.createElement('div');
  cover.className = 'print-cover view-memoir-cover';

  var moon = document.createElement('div');
  moon.className = 'view-memoir-cover-moon';
  moon.setAttribute('aria-hidden', 'true');
  cover.appendChild(moon);

  var title = document.createElement('h1');
  title.className = 'view-memoir-cover-title';
  title.textContent = '我们的家庭回忆录';
  cover.appendChild(title);

  var family = document.createElement('p');
  family.className = 'view-memoir-cover-family';
  family.textContent = '家庭童年回忆话题盒子';
  cover.appendChild(family);

  var date = document.createElement('p');
  date.className = 'view-memoir-cover-date';
  date.textContent = '生成日期：' + _exportTodayStr();
  cover.appendChild(date);

  if (host.firstChild) host.insertBefore(cover, host.firstChild);
  else host.appendChild(cover);
}

// ── 导出 JSON 备份（直接跳转下载 URL，服务端带 Content-Disposition）──
function exportJson(withPhotos) {
  var url = API.exportJsonUrl(withPhotos !== false);
  window.location = url;
  Dialog.toast('备份文件开始下载', 'success');
}

// ── 导入 JSON 备份（覆盖式，二次确认）─────────────────────────
async function importJson(file) {
  if (!file) return;
  var okImp = await Dialog.confirm({
    title: '导入备份',
    message: '这是覆盖式导入，当前全部数据将被替换且不可撤销。确定继续吗？',
    confirmText: '覆盖导入',
    danger: true,
  });
  if (!okImp) return;

  try {
    await API.importJson(file);
    // 先失效回忆录分组缓存，避免 loadAll() 的 notify 重渲染时先用旧数据渲染一帧
    if (typeof _memoirInvalidate === 'function') _memoirInvalidate();
    await Store.loadAll();   // 全量重载并 notify 重渲染
    Dialog.toast('备份导入完成，数据已刷新', 'success');
  } catch (e) {
    // 失败文案由 api.js 统一提供（后端 message 已含版本号）；此处仅吞掉 reject，避免未捕获 Promise
  }
}

// ── 生成回忆录长图（F16，严格四步，禁止调换）─────────────────
async function exportLongImage(el) {
  if (!el) {
    Dialog.toast('长图生成失败', 'error');
    return;
  }

  el.classList.add('exporting');   // ① 照片墙临时切 grid 三列
  var canvas = null;
  try {
    await _exportLoadHtml2canvas();
    canvas = await html2canvas(el, {  // ② 截图
      backgroundColor: '#FBF6EC',
      scale: 2,
      useCORS: true,
      logging: false,
      windowWidth: el.scrollWidth,
    });
  } catch (e) {
    Dialog.toast('长图生成失败', 'error');
  } finally {
    el.classList.remove('exporting'); // ③ 无论如何还原瀑布流
  }

  if (!canvas) return;
  canvas.toBlob(function (blob) {   // ④ 下载 PNG
    if (!blob) {
      Dialog.toast('长图生成失败', 'error');
      return;
    }
    _exportDownload(blob, '家庭回忆录-' + _exportDateStamp() + '.png');
    Dialog.toast('长图已生成，正在下载', 'success');
  }, 'image/png');
}

// 动态注入 html2canvas（带 onload 与超时保护）
function _exportLoadHtml2canvas() {
  if (typeof html2canvas === 'function') return Promise.resolve();
  if (_h2cPromise) return _h2cPromise;

  _h2cPromise = new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      reject(new Error('html2canvas 加载超时'));
    }, 15000);

    var script = document.createElement('script');
    script.src = '/static/vendor/html2canvas.min.js';
    script.async = true;
    script.onload = function () {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof html2canvas === 'function') resolve();
      else reject(new Error('html2canvas 未就绪'));
    };
    script.onerror = function () {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('html2canvas 加载失败'));
    };
    document.head.appendChild(script);
  });

  // 失败后置空，允许下次重试
  _h2cPromise.catch(function () { _h2cPromise = null; });
  return _h2cPromise;
}

// 触发浏览器下载
function _exportDownload(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
}

// 文件名用日期戳 YYYYMMDD
function _exportDateStamp() {
  var d = new Date();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return '' + d.getFullYear() + (m < 10 ? '0' + m : m) + (day < 10 ? '0' + day : day);
}

// 封面生成日期 YYYY-MM-DD
function _exportTodayStr() {
  var d = new Date();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

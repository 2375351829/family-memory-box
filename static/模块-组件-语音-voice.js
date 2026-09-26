/* 模块-组件-语音-voice.js · 契约 C8（签名照《开发计划》7.2 逐字）
 *   isRecognitionSupported()                     // 'webkitSpeechRecognition' in window
 *   isSynthesisSupported()                       // 'speechSynthesis' in window
 *   startRecognition(onInterim, onFinal, lang = 'zh-CN')
 *   stopRecognition()
 *   speak(text)                                  // SpeechSynthesis 朗读
 * 依赖：Dialog（onerror 分支运行时调用 Dialog.toast）。消费端：讲故事视图（🎤 语音输入 / 🔊 朗读话题）。
 * 降级（开发计划 8.4）：识别不支持 → 消费端隐藏 🎤 并提示「当前浏览器不支持语音，请手动输入」；
 *   合成不支持 → 隐藏 🔊。注意 http://<NAS-IP> 非安全上下文下识别不可用属**预期行为**（浏览器安全限制），
 *   按钮隐藏不是缺陷。
 * 说明：startRecognition 返回 Promise，于识别会话结束（onend / onerror / stop）时 resolve，
 *   供消费端据此复位按钮状态，避免自动结束或出错后按钮卡在「识别中」。
 * 约束：不注入 HTML 字符串、不写入页面 DOM；仅操作 Web Speech API 与回调。
 */
const Voice = (function () {
  'use strict';

  var recognition = null;   // 当前 SpeechRecognition 实例（单例复用，避免重复 start 报 InvalidStateError）

  // 取可用构造器：标准 SpeechRecognition 或 webkit 前缀版；均不可用返回 null
  function getRecognitionCtor() {
    if (typeof window === 'undefined') return null;
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function isRecognitionSupported() {
    return !!getRecognitionCtor();
  }

  function isSynthesisSupported() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  /**
   * 启动语音识别。
   * @param {(interimText:string)=>void} onInterim 临时结果实时回调（消费端回填输入框）
   * @param {(finalText:string)=>void}   onFinal   最终结果回调（消费端追加到正文）
   * @param {string} lang 识别语言，默认 'zh-CN'
   * @returns {Promise<void>} 会话结束（onend / onerror / stop）时 resolve
   */
  function startRecognition(onInterim, onFinal, lang = 'zh-CN') {
    var Ctor = getRecognitionCtor();
    if (!Ctor) {
      Dialog.toast('当前浏览器不支持语音，请手动输入', 'info');
      return Promise.resolve();
    }
    // 互斥：先停掉上一次会话，避免 InvalidStateError
    stopRecognition();

    return new Promise(function (resolve) {
      var rec = new Ctor();
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = true;

      var settled = false;
      // 统一收尾：复位内部状态并 resolve，保证按钮不卡死
      function finish() {
        if (settled) return;
        settled = true;
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        if (recognition === rec) recognition = null;
        resolve();
      }

      rec.onresult = function (event) {
        if (!event) return;
        var results = event.results || [];
        var startIdx = event.resultIndex || 0;
        var interimText = '';
        var finalText = '';
        for (var i = startIdx; i < results.length; i++) {
          var res = results[i];
          var seg = (res[0] && res[0].transcript) || '';
          if (res.isFinal) finalText += seg;
          else interimText += seg;
        }
        if (interimText && typeof onInterim === 'function') onInterim(interimText);
        if (finalText && typeof onFinal === 'function') onFinal(finalText);
      };

      rec.onerror = function (event) {
        var code = (event && event.error) || '';
        if (code === 'no-speech') {
          Dialog.toast('没有听清，请再说一次', 'info');
        } else if (code === 'not-allowed' || code === 'service-not-allowed') {
          Dialog.toast('麦克风未授权，请在浏览器设置中允许后重试', 'error');
        } else if (code === 'network') {
          Dialog.toast('语音识别网络异常，请检查网络后重试', 'error');
        } else {
          Dialog.toast('语音识别出错，请手动输入', 'error');
        }
        // 出错后 onend 可能不再触发，这里直接收尾
        finish();
      };

      // 识别自然结束 / 被中断 → 收尾复位（消费端据 Promise resolve 复位按钮）
      rec.onend = function () { finish(); };

      recognition = rec;
      try {
        rec.start();
      } catch (e) {
        Dialog.toast('无法启动语音识别，请手动输入', 'error');
        finish();
      }
    });
  }

  function stopRecognition() {
    if (!recognition) return;
    try {
      recognition.stop();   // 停止后浏览器会触发 onend → finish() 收尾
    } catch (e) { /* 未在运行，忽略 */ }
  }

  function speak(text) {
    if (!isSynthesisSupported()) return;  // 合成不支持时按钮应已隐藏，这里静默兜底
    var content = text == null ? '' : String(text).trim();
    if (!content) return;
    try {
      window.speechSynthesis.cancel(); // 打断上一次朗读，避免排队叠加
      var utter = new SpeechSynthesisUtterance(content);
      utter.lang = 'zh-CN';
      window.speechSynthesis.speak(utter);
    } catch (e) {
      Dialog.toast('朗读失败，请重试', 'error');
    }
  }

  return {
    isRecognitionSupported: isRecognitionSupported,
    isSynthesisSupported: isSynthesisSupported,
    startRecognition: startRecognition,
    stopRecognition: stopRecognition,
    speak: speak,
  };
})();

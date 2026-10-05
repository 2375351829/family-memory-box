// 脚本-生成截图-screenshots.mjs
// 用途：把 docs/截图-screenshots/ 下的 10 张 PNG 与 3 张 GIF 按「当前界面」重新生成一遍。
// 做法：
//   ① 复制 data/ → tmp-截图-shots/，用该目录在 5081 端口另起一个 Node 服务；
//      录制过程中保存故事等写入都落在副本里，演示库 data/ 不受影响（结束后删副本）。
//      注意：目录名不能以点开头 —— Express 的 send 默认 dotfiles:'ignore'，
//      数据目录若含 .xxx 这类点目录，/uploads/<照片> 会一律 404（截图会拍成空白条）；
//   ② Playwright + 系统 Edge 逐场景截图：桌面 1920×1080、手机 390×844（DSF 2）；
//   ③ 动效 GIF 用连续帧 + ffmpeg（palettegen/paletteuse）合成；
//   ④ 手机合成图：两张手机截图拼到 1600×900 画布（DSF 2 → 3200×1800）。
// 运行：node 脚本-生成截图-screenshots.mjs
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'docs', '截图-screenshots');
const TMP_DATA = path.join(ROOT, 'tmp-截图-shots');
const TMP_FRAMES = path.join(ROOT, 'tmp-截图-frames');
const PORT = 5081;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── ① 起独立服务（数据目录为副本）──
fs.rmSync(TMP_DATA, { recursive: true, force: true });
fs.rmSync(TMP_FRAMES, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'data'), TMP_DATA, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const server = spawn('node', ['后端服务-node.mjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: TMP_DATA },
  stdio: 'ignore',
});
async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('服务未能在 15s 内就绪');
}
await waitReady();
// 自检：照片必须能取到（取不到说明数据目录/静态路由有问题，照片截图会拍成空白条）
const probe = await fetch(`${BASE}/api/state`).then((r) => r.json());
const firstPhoto = (probe.data.photos || [])[0];
if (firstPhoto) {
  const pr = await fetch(`${BASE}/uploads/${firstPhoto.filename}`);
  if (!pr.ok) throw new Error(`/uploads/${firstPhoto.filename} 返回 ${pr.status}，照片无法显示，请检查数据目录命名`);
}
console.log(`[1/4] 截图服务已就绪：${BASE}（数据目录 ${path.relative(ROOT, TMP_DATA)}，照片自检通过）`);

const browser = await chromium.launch({ channel: 'msedge' });

// 桌面上下文：1920×1080（与既有截图同尺寸）
const desktop = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
// 打印导出场景要拦掉 window.print（否则会卡住），并允许我们用应用自己的封面函数
await desktop.addInitScript(() => { window.print = function () {}; });
const page = await desktop.newPage();
page.on('pageerror', (e) => console.log('  [页面异常]', e.message));

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, name) });
  console.log(`  ✓ ${name}`);
};

// 关掉可能存在的弹层：演示数据集含 1 个「当日到期」的时间胶囊（《截图计划》2.1），
// 每次打开首页都会自动弹「时间胶囊可以开启啦」提醒，遮罩会挡住后续点击、也会拍进截图。
// 点「取消」关掉即可（取消不会开启胶囊，数据不受影响）。
async function dismissDialogs(p) {
  for (let i = 0; i < 4; i++) {
    const overlays = p.locator('.dialog-overlay');
    if ((await overlays.count()) === 0) return;
    const cancel = p.locator('.dialog-overlay .dialog-actions button', { hasText: '取消' });
    if (await cancel.count()) await cancel.first().click();
    else await overlays.first().click({ position: { x: 4, y: 4 } });   // 点遮罩空白处 = 取消
    await sleep(250);
  }
}

// ── ② 逐场景截图 ──
console.log('[2/4] 桌面场景截图…');

// 01 首页开场
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await sleep(1100);
await dismissDialogs(page);   // 先关掉到期提醒弹层，否则会被拍进画面
await sleep(300);
await shot('01-首页开场-home.png');

// 02 家人设置
await page.click('[data-nav="members"]');
await sleep(700);
await shot('02-家人设置-members.png');

// 03 抽题盒子（未抽题）
await page.click('[data-nav="draw"]');
await sleep(800);
await shot('03-抽题盒子-topic-box.png');

// 04 抽题结果（抽一题后：道具手势 + 卡片）
await page.click('.view-draw-action');
await sleep(1100);
await shot('04-抽题结果-topic-card.png');

// 05 讲故事（语音输入工具条 + 已填正文）
await page.click('.view-draw-card-actions .btn-primary');
await page.waitForSelector('.view-story-textarea');
await page.fill('.view-story-textarea', '那年中秋，父亲把单位发的月饼切成八瓣，一人一小块，谁都说甜。');
await page.fill('.view-story-date', '2019-09-13');   // 演示数据故事日期一律 2003 年及以后（《截图计划》2.1）
await page.locator('.view-story-followup-toggle').first().click();   // 展开第一条追问
await page.evaluate(() => window.scrollTo(0, 60));                   // 回到顶部：话题回显 + 讲述人 + 语音工具条
await sleep(700);
await shot('05-讲故事-语音输入-story-voice.png');

// 07 回忆录时间轴（先拍，后面 06 要进入编辑态）
await page.click('[data-nav="memoir"]');
await page.waitForSelector('.view-memoir-story');
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(800);
await shot('07-回忆录时间轴-memoir-timeline.png');

// 06 老照片上传（回忆录 → 挑一条「带照片」的故事进编辑 → 照片区）
const photoCardIdx = await page.evaluate(() =>
  [...document.querySelectorAll('.view-memoir-story')].findIndex((c) => c.querySelector('.view-memoir-story-photos img')));
await page.locator('.view-memoir-story').nth(photoCardIdx < 0 ? 0 : photoCardIdx)
  .locator('.view-memoir-story-edit').click();
await page.waitForSelector('.view-story-photos');
await page.evaluate(() => {   // 先滚到照片区：缩略图是懒加载，不滚进视口永远不会开始下载
  const label = [...document.querySelectorAll('.view-story-label')].find((el) => el.textContent.indexOf('照片') === 0);
  (label ? label.closest('.view-story-field') : document.querySelector('.view-story-photos'))
    .scrollIntoView({ block: 'center' });
});
await page.waitForFunction(() => {   // 再等缩略图解码完（原图 1700×2220，未解码会拍成空白条）
  const imgs = [...document.querySelectorAll('.view-story-photos img')];
  return imgs.length === 0 || imgs.every((i) => i.complete && i.naturalWidth > 0);
}, null, { timeout: 30000 });
await sleep(600);
await shot('06-老照片上传-photo-upload.png');

// 08 回忆录照片墙（回到时间轴，等照片解码完再滚到照片墙）
await page.click('[data-nav="memoir"]');
await page.waitForSelector('.view-memoir-section-title');
await page.evaluate(() => {   // 先滚到照片墙（同样要先把懒加载图片带进视口）
  const h = [...document.querySelectorAll('.view-memoir-section-title')].find((el) => el.textContent === '照片墙');
  if (h) h.scrollIntoView({ block: 'start' });
});
await page.waitForFunction(() => {
  const imgs = [...document.querySelectorAll('.view-memoir-photo-item img')];
  return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
}, null, { timeout: 30000 });
await page.evaluate(() => {
  const h = [...document.querySelectorAll('.view-memoir-section-title')].find((el) => el.textContent === '照片墙');
  if (h) h.scrollIntoView({ block: 'start' });
});
await sleep(700);
await shot('08-回忆录照片墙-memoir-photowall.png');

// 09 导出 PDF（打印媒体：封面 + 白底回忆录）
await page.goto(`${BASE}/#/memoir`, { waitUntil: 'networkidle' });
await dismissDialogs(page);
await page.waitForSelector('.view-memoir-story');
await page.emulateMedia({ media: 'print' });
await page.evaluate(() => {
  window.scrollTo(0, 0);
  if (typeof window._exportBuildCover === 'function') window._exportBuildCover(document.getElementById('view-memoir'));
});
await sleep(500);
await shot('09-导出PDF-export-pdf.png');
await page.emulateMedia({ media: 'screen' });

// ── ③ 动效 GIF（Playwright 录屏 webm → ffmpeg 抽帧调色板 → GIF）──
// 不用「连拍截图」：截图受 PNG 编码拖累只能到 2–4 fps，动作会被压快；
// 录屏是浏览器侧 ~25fps，时长即真实时长，转 GIF 时再降到 10fps 控体积。
console.log('[3/4] 录制动效 GIF…');

/** 录一段交互视频：返回 { video, start, end }（start/end 为相对录屏起点的秒数，用于裁掉多余头尾） */
async function recordVideo(viewport, scriptFn) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, recordVideo: { dir: TMP_FRAMES, size: viewport } });
  const p = await ctx.newPage();
  const t0 = Date.now();
  const marks = await scriptFn(p, () => (Date.now() - t0) / 1000);
  await ctx.close();                       // 关闭上下文才会落盘视频
  const video = await p.video().path();
  return { video, ...marks };
}

/** webm → GIF（裁窗 + 8fps + 96 色 bayer 抖动：夜色渐变页面用满色会到 10MB，够看且能进文档） */
function toGif(rec, outName, width) {
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-ss', rec.start.toFixed(2), '-to', rec.end.toFixed(2), '-i', rec.video,
    '-vf', `fps=8,scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`,
    '-loop', '0', path.join(OUT, outName),
  ], { stdio: 'inherit' });
  const kb = Math.round(fs.statSync(path.join(OUT, outName)).size / 1024);
  console.log(`  ✓ ${outName}（${width}px 宽，${(rec.end - rec.start).toFixed(1)}s，${Math.round(kb / 1024 * 10) / 10} MB）`);
}

// g1 抽题动效（1200×750）
let rec = await recordVideo({ width: 1200, height: 750 }, async (p, now) => {
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await dismissDialogs(p);   // 这段在裁切起点之前，不会进 GIF
  await p.click('[data-nav="draw"]');
  await sleep(900);
  const start = Math.max(0, now() - 0.4);
  await p.click('.view-draw-action');                     // 抽一题：道具手势 + 题面切换
  await sleep(2600);
  await p.click('.view-draw-card-actions .btn-ghost');    // 换一题：只换题面文字
  await sleep(1600);
  return { start, end: now() };
});
toGif(rec, 'g1-抽题动效-draw.gif', 1200);

// g2 讲述到回忆录（960×600）
rec = await recordVideo({ width: 960, height: 600 }, async (p, now) => {
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await dismissDialogs(p);
  await p.click('[data-nav="draw"]');
  await sleep(700);
  const start = Math.max(0, now() - 0.3);
  await p.click('.view-draw-action');
  await sleep(1200);
  await p.click('.view-draw-card-actions .btn-primary');  // 开始讲
  await p.waitForSelector('.view-story-textarea');
  await sleep(400);
  await p.type('.view-story-textarea', '2019 年中秋，父亲把月饼切成八瓣，一人一小块。', { delay: 55 });
  await p.fill('.view-story-date', '2019-09-13');
  await sleep(500);
  await p.click('.view-story-save');                      // 保存到回忆录
  await p.waitForSelector('.view-memoir-story');
  await sleep(2000);
  return { start, end: now() };
});
toGif(rec, 'g2-讲述到回忆录-story-to-memoir.gif', 960);

// g3 一键导出（960×600）：点「导出 PDF」→ 打印媒体白底封面
rec = await recordVideo({ width: 960, height: 600 }, async (p, now) => {
  await p.addInitScript(() => { window.print = function () {}; });
  await p.goto(`${BASE}/#/memoir`, { waitUntil: 'networkidle' });
  await dismissDialogs(p);
  await p.waitForSelector('.view-memoir-tool-pdf');
  await sleep(800);
  const start = Math.max(0, now() - 0.4);
  await p.click('.view-memoir-tool-pdf');
  await sleep(300);
  await p.emulateMedia({ media: 'print' });                // 打印样式：白底 + 封面
  await p.evaluate(() => {
    if (typeof window._exportBuildCover === 'function') window._exportBuildCover(document.getElementById('view-memoir'));
  });
  await sleep(2600);
  return { start, end: now() };
});
toGif(rec, 'g3-一键导出-export.gif', 960);

// ── ④ 手机截图 + 手机合成图 ──
console.log('[4/4] 手机端截图与合成图…');
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const mp = await mobile.newPage();
await mp.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await dismissDialogs(mp);
await mp.click('[data-nav="draw"]');
await mp.waitForSelector('.view-draw-tumbler');
await sleep(500);
await mp.click('.view-draw-action');
await sleep(1200);
await mp.evaluate(() => document.querySelector('.view-draw-tumbler').scrollIntoView({ block: 'center' }));
await sleep(400);
const phoneDraw = path.join(TMP_FRAMES, 'phone-draw.png');
await mp.screenshot({ path: phoneDraw });

await mp.click('[data-nav="memoir"]');
await mp.waitForSelector('.view-memoir-story');
await sleep(800);
await mp.evaluate(() => window.scrollTo(0, 320));   // 略过封面区，直接看故事卡
await sleep(300);
const phoneMemoir = path.join(TMP_FRAMES, 'phone-memoir.png');
await mp.screenshot({ path: phoneMemoir });
await mobile.close();

const b64 = (p) => fs.readFileSync(p).toString('base64');
const compose = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const cp = await compose.newPage();
await cp.setContent(`<style>
  *{box-sizing:border-box}
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;gap:56px;
       font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#F6E7B4;
       background:
         radial-gradient(ellipse 70% 46% at 50% -8%, rgba(255,217,125,.22), rgba(255,217,125,0) 62%),
         radial-gradient(ellipse 50% 40% at 4% 96%, rgba(192,57,43,.20), rgba(192,57,43,0) 62%),
         radial-gradient(ellipse 52% 40% at 96% 92%, rgba(47,92,138,.24), rgba(47,92,138,0) 60%),
         linear-gradient(180deg,#091124 0%,#13233F 40%,#0B1628 74%,#060C18 100%);}
  .col{display:flex;flex-direction:column;align-items:center;gap:14px}
  .phone{width:330px;border-radius:34px;padding:10px;background:linear-gradient(158deg,rgba(255,252,245,.16),rgba(212,162,76,.10));
         border:1.5px solid rgba(212,162,76,.55);box-shadow:0 28px 60px rgba(3,8,20,.6), inset 0 1px 0 rgba(255,255,255,.28)}
  .phone img{width:100%;display:block;border-radius:26px}
  .cap{font-size:15px;color:rgba(246,231,180,.85);letter-spacing:.04em}
  .copy{max-width:430px}
  .copy h1{margin:0 0 20px;font-family:STKaiti,KaiTi,serif;font-size:40px;line-height:1.35;letter-spacing:.03em;color:#F6E7B4;
           text-shadow:0 2px 18px rgba(0,0,0,.5)}
  .copy p{margin:0 0 12px;font-size:17px;line-height:1.75;color:rgba(246,231,180,.8)}
  .copy .k{color:#FFD97D}
  .rule{width:96px;height:3px;margin:22px 0 0;border-radius:2px;
        background:linear-gradient(90deg,#D4A24C,rgba(212,162,76,0))}
</style>
<div class="col"><div class="phone"><img src="data:image/png;base64,${b64(phoneDraw)}"></div><div class="cap">抽题 · 节日专属道具与题面</div></div>
<div class="copy">
  <h1>一家人传着手机<br>就能玩</h1>
  <p>话题字号 <span class="k">28px</span> 起，长辈也看得清</p>
  <p><span class="k">390 × 844</span> 移动端适配，无横向滚动</p>
  <p>底部通栏四图标导航，单手可点</p>
  <div class="rule"></div>
</div>
<div class="col"><div class="phone"><img src="data:image/png;base64,${b64(phoneMemoir)}"></div><div class="cap">回忆录 · 讲述内容即时报存</div></div>`);
await cp.waitForTimeout(700);
await cp.screenshot({ path: path.join(OUT, '10-移动端-mobile.png') });
console.log('  ✓ 10-移动端-mobile.png（3200×1800）');
await compose.close();

// ── 收尾 ──
await browser.close();
server.kill();
await sleep(400);
fs.rmSync(TMP_DATA, { recursive: true, force: true });
fs.rmSync(TMP_FRAMES, { recursive: true, force: true });

console.log('\n生成完成 →', path.relative(ROOT, OUT));
for (const f of fs.readdirSync(OUT).sort()) {
  console.log(`  ${f}  ${Math.round(fs.statSync(path.join(OUT, f)).size / 1024)} KB`);
}
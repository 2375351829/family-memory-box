/* 模块-主题-节日-festival-theme.js · 主题层（节日引擎 v3）
 * 职责：节日自动检测与主题应用 —— 配色 token、纹样、粒子、节日元素包、节日徽标数据。
 * 形态：经典全局脚本 IIFE（项目无 ESM），暴露 window.FestivalTheme。
 *
 * 契约：window.FestivalTheme = {
 *   TABLE, resolve, apply, current, refresh,        // v2 原有：签名与语义不变
 *   today, currentFestival, byKey, keys             // v3 新增
 * }
 *   TABLE             —— { lunar:[], solar:[] }：农历 9 + 公历 18，共 27 个节日
 *   resolve(date)     -> 'midnight'|'spring'|'yuanxiao'|'dragon'|'qixi'|'qingming'
 *                        |'national'|'christmas'|'winter'|'halloween'（配色主题 key）
 *   today(date)       -> 条目 | null：纯按日期判定当天命中的节日
 *   currentFestival() -> 条目 | null：当前实际生效的节日（含 ?festival= 调试覆盖）
 *   yearList(year)    -> 全年节日清单（按日期升序；供首页「节日日历」卡渲染）
 *   applyFestival(key)-> 手动预览某节日主题（会话级，不落 localStorage；供日历点行切换）
 *   clearPreview()    -> 退出预览，回到「按当天自动检测」
 *   previewKey()      -> 当前预览的节日 key（未预览为 null）
 *   byKey(key)        -> 条目 | null
 *   apply(key)        -> 强制应用某配色主题（旧行为），返回最终 theme key
 *   current()         -> 当前配色主题 key
 *   refresh()         -> 依「?festival= > ?theme= > localStorage > 自动」重算并应用
 *
 * 覆盖链：?festival=xxx（调试，最高；none 表示强制无节日）> ?theme=xxx（调试）
 *         > localStorage['fmb-theme'] > 自动检测
 *
 * 节日元素包（每条节日自带 el）：
 *   motif    —— 纹样 key：纹样层与徽标图标共用（图形定义在 样式-主题-theme.css 的 --mask-*）
 *   p        —— 粒子预设 key（见下方 P 表），仅动画 transform/opacity
 *   accent   —— 该节日专属主色（CSS 经 html[data-festival] 落地为 --fest-a/--fest-b/--fest-glow）
 *   greeting —— 节庆文案（首页 hero 替代常规引导语 + 进站提示）
 *   title    —— 节庆首页标题（逐节不同，替代原来「XX · 说说那些年的故事」的同一句式）
 * JS 只负责挂 data-festival / data-theme 与渲染粒子；配色与纹样由 CSS 依 data-festival 落地。
 *
 * 挂载：<head> 内非 defer 引入（首帧前给 <html> 打类，消除节日闪烁）；
 *       DOMContentLoaded 后镜像到 body、挂载 #theme-texture/#theme-particles、绑定刷新与方向检测。
 * 性能：装饰层 fixed + inset:0 + overflow:hidden + pointer-events:none + contain:strict；粒子 ≤20 节点。
 * 安全：全部 DOM 用 createElement/setAttribute 构建，不拼 innerHTML；图形为静态 data-uri。
 */
(function () {
  'use strict';

  // ── 常量 ───────────────────────────────────────────────
  var THEME_KEYS = ['midnight', 'spring', 'yuanxiao', 'dragon', 'qixi', 'qingming', 'national', 'christmas', 'winter', 'halloween'];
  var META_COLOR = {
    midnight: '#101A33', spring: '#241013', yuanxiao: '#2B1220', dragon: '#0F2430',
    qixi: '#16142E', qingming: '#14251E', national: '#23100F', christmas: '#0D2118',
    winter: '#101A33', halloween: '#241436',
  };
  var STORE_KEY = 'fmb-theme';
  var YEAR_MIN = 2025;
  var YEAR_MAX = 2030;
  var REFRESH_MS = 10 * 60 * 1000;   // 每 10min
  var NAV_ORDER = ['home', 'members', 'draw', 'memoir'];

  // ── 粒子预设（每节日取一；type 为动画范式，cls 为造型类）──────────
  var P = {
    goldFall:       { type: 'p-fall',    cls: 'p-dot',      count: 12, size: [3, 6],   dur: [9, 16],  place: 'fall' },
    petalFall:      { type: 'p-fall',    cls: 'p-petal',    count: 14, size: [9, 15],  dur: [8, 15],  place: 'fall' },
    leafFall:       { type: 'p-fall',    cls: 'p-leaf',     count: 12, size: [10, 16], dur: [8, 14],  place: 'fall' },
    chrysFall:      { type: 'p-fall',    cls: 'p-chrys',    count: 12, size: [10, 16], dur: [9, 15],  place: 'fall' },
    snowFall:       { type: 'p-fall',    cls: 'p-snow',     count: 18, size: [7, 12],  dur: [7, 13],  place: 'fall' },
    confettiFall:   { type: 'p-fall',    cls: 'p-confetti', count: 16, size: [5, 9],   dur: [7, 12],  place: 'fall' },
    pumpkinFall:    { type: 'p-fall',    cls: 'p-pumpkin',  count: 9,  size: [13, 19], dur: [9, 15],  place: 'fall' },
    rainFall:       { type: 'p-rain',    cls: 'p-rain',     count: 18, size: [0, 0],   dur: [2, 4],   place: 'fall' },
    moonRise:       { type: 'p-rise',    cls: 'p-moon',     count: 10, size: [7, 13],  dur: [8, 14],  place: 'rise' },
    heartRise:      { type: 'p-rise',    cls: 'p-heart',    count: 10, size: [9, 15],  dur: [9, 15],  place: 'rise' },
    bubbleRise:     { type: 'p-rise',    cls: 'p-bubble',   count: 12, size: [9, 17],  dur: [8, 14],  place: 'rise' },
    starTwinkle:    { type: 'p-twinkle', cls: 'p-star',     count: 14, size: [6, 10],  dur: [3, 7],   place: 'scatter' },
    starRed:        { type: 'p-twinkle', cls: 'p-star p-red', count: 12, size: [7, 11], dur: [3, 6],  place: 'scatter' },
    fireworkTwinkle:{ type: 'p-twinkle', cls: 'p-firework', count: 12, size: [12, 18], dur: [2.6, 5], place: 'scatter' },
    birdDrift:      { type: 'p-drift',   cls: 'p-bird',     count: 8,  size: [11, 17], dur: [10, 18], place: 'drift' },
    waveDrift:      { type: 'p-drift',   cls: 'p-wave',     count: 8,  size: [0, 0],   dur: [10, 18], place: 'drift' },
    lanternDrift:   { type: 'p-drift',   cls: 'p-lantern',  count: 6,  size: [15, 21], dur: [12, 20], place: 'drift' },
    bookFall:       { type: 'p-fall',    cls: 'p-book',     count: 11, size: [10, 15], dur: [9, 15],  place: 'fall' },
    ribbonDrift:    { type: 'p-drift',   cls: 'p-ribbon',   count: 8,  size: [12, 18], dur: [10, 17], place: 'drift' },
  };

  // ── 农历节日（每年一项；中秋列必须与 home.js 的 MID_AUTUMN_DATES 逐值一致，boot 时断言）──
  // win：生效窗口半径（天），默认 1；大节给 2–3 天做「节前预热」
  // el.title：该节日的专属首页标题（逐节不同句式与意象，不要都用同一句模板）
  var LUNAR = [
    { key: 'chuxi',     name: '除夕',  theme: 'spring',   priority: 1,  win: 2, el: { motif: 'lantern', p: 'lanternDrift',  accent: '#FFD97D', title: '年夜饭桌上，谁的筷子先落下', greeting: '除夕团圆，讲讲家里那顿年夜饭' },
      dates: { 2025: '2025-01-28', 2026: '2026-02-16', 2027: '2027-02-05', 2028: '2028-01-25', 2029: '2029-02-12', 2030: '2030-02-02' } },
    { key: 'chunjie',   name: '春节',  theme: 'spring',   priority: 2,  win: 3, el: { motif: 'plum',    p: 'goldFall',      accent: '#FFC94D', title: '炮竹声里，藏着谁的年少', greeting: '春节好，说说小时候是怎么过年的' },
      dates: { 2025: '2025-01-29', 2026: '2026-02-17', 2027: '2027-02-06', 2028: '2028-01-26', 2029: '2029-02-13', 2030: '2030-02-03' } },
    { key: 'zhongqiu',  name: '中秋',  theme: 'midnight', priority: 3,  win: 3, el: { motif: 'moon',    p: 'moonRise',      accent: '#FFD97D', title: '月圆了，想听你说说从前', greeting: '中秋团圆，一起赏月讲讲往事' },
      dates: { 2025: '2025-10-06', 2026: '2026-09-25', 2027: '2027-09-15', 2028: '2028-10-03', 2029: '2029-09-22', 2030: '2030-09-12' } },
    { key: 'duanwu',    name: '端午',  theme: 'dragon',   priority: 5,  win: 2, el: { motif: 'bamboo',  p: 'waveDrift',     accent: '#A8D8A0', title: '粽叶香一开，旧事就上了桌', greeting: '端午安康，讲讲包粽子的手艺' },
      dates: { 2025: '2025-05-31', 2026: '2026-06-19', 2027: '2027-06-09', 2028: '2028-05-28', 2029: '2029-06-16', 2030: '2030-06-05' } },
    { key: 'yuanxiao',  name: '元宵',  theme: 'yuanxiao', priority: 6,  el: { motif: 'bubble',  p: 'moonRise',      accent: '#FFC78A', title: '花灯底下，猜猜谁的心事', greeting: '元宵节，猜个灯谜再讲段故事' },
      dates: { 2025: '2025-02-12', 2026: '2026-03-03', 2027: '2027-02-20', 2028: '2028-02-09', 2029: '2029-02-27', 2030: '2030-02-17' } },
    { key: 'qixi',      name: '七夕',  theme: 'qixi',     priority: 7,  el: { motif: 'heart',   p: 'starTwinkle',   accent: '#CBB8FF', title: '那年的喜欢，是什么样子', greeting: '七夕，讲讲你和家人初见的那天' },
      dates: { 2025: '2025-08-29', 2026: '2026-08-19', 2027: '2027-08-08', 2028: '2028-08-26', 2029: '2029-08-16', 2030: '2030-08-05' } },
    { key: 'chongyang', name: '重阳',  theme: 'winter',   priority: 8,  el: { motif: 'chrys',   p: 'chrysFall',     accent: '#E8C069', title: '登高望远，正好听长辈讲当年', greeting: '重阳敬老，听听长辈年轻时的故事' },
      dates: { 2025: '2025-10-29', 2026: '2026-10-18', 2027: '2027-10-08', 2028: '2028-10-26', 2029: '2029-10-16', 2030: '2030-10-05' } },
    { key: 'laba',      name: '腊八',  theme: 'winter',   priority: 9,  el: { motif: 'bubble',  p: 'goldFall',      accent: '#E0B45A', title: '一碗腊八粥，熬着几代人的甜', greeting: '腊八，说说那碗腊八粥的味道' },
      dates: { 2025: '2025-01-07', 2026: '2026-01-26', 2027: '2027-01-15', 2028: '2028-01-04', 2029: '2029-01-22', 2030: '2030-01-12' } },
    { key: 'qingming',  name: '清明',  theme: 'qingming', priority: 10, el: { motif: 'willow',  p: 'rainFall',      accent: '#B9DCB0', title: '雨落这天，忽然想起那个人', greeting: '清明，说说记忆里的那位亲人' },
      dates: { 2025: '2025-04-04', 2026: '2026-04-05', 2027: '2027-04-05', 2028: '2028-04-04', 2029: '2029-04-04', 2030: '2030-04-05' } },
  ];

  // ── 公历节日 ───────────────────────────────────────────
  // span  ：日期区间（国庆 10-01..10-07）
  // rule  ：第 n 个星期几 [n, weekday]（0=周日）——母亲节 5 月第 2 个周日、父亲节 6 月第 3 个周日
  // win   ：生效窗口半径（天），默认 1；0 表示仅当天（如跨年 12-31、平安夜 12-24）
  var SOLAR = [
    { key: 'guoqing',    name: '国庆',   theme: 'national',  priority: 4,  month: 10, day: 1, span: [1, 7], el: { motif: 'star',    p: 'starRed',          accent: '#FFC94D', title: '满城红旗里，你的国庆记忆', greeting: '国庆节，讲讲你记忆里的那个国庆' } },
    { key: 'kuannian',   name: '跨年',   theme: 'winter',    priority: 11, month: 12, day: 31, win: 0,       el: { motif: 'firework', p: 'fireworkTwinkle', accent: '#FFC94D', title: '旧年最后一夜，故事还热着', greeting: '跨年了，写下明年的心愿' } },
    { key: 'yuandan',    name: '元旦',   theme: 'winter',    priority: 12, month: 1,  day: 1,  win: 3,       el: { motif: 'firework', p: 'fireworkTwinkle', accent: '#FFD27A', title: '新的一年，从一段老故事开始', greeting: '元旦伊始，写下新一年的愿望' } },
    { key: 'pinganye',   name: '平安夜', theme: 'christmas', priority: 13, month: 12, day: 24, win: 0,       el: { motif: 'snow',    p: 'snowFall',         accent: '#B9E3C6', title: '雪落无声，愿你我都平安', greeting: '平安夜，愿你我都平安' } },
    { key: 'shengdanjie',name: '圣诞节', theme: 'christmas', priority: 14, month: 12, day: 25, win: 2,       el: { motif: 'snow',    p: 'snowFall',         accent: '#E06A5A', title: '拆过最难忘的那份礼物', greeting: '圣诞快乐，说说童年收到的礼物' } },
    { key: 'qingrenjie', name: '情人节', theme: 'yuanxiao',  priority: 15, month: 2,  day: 14,              el: { motif: 'heart',   p: 'heartRise',        accent: '#F07A9B', title: '初见那天，你说了什么', greeting: '情人节，讲讲你们相识的那天' } },
    { key: 'funvjie',    name: '妇女节', theme: 'yuanxiao',  priority: 16, month: 3,  day: 8,               el: { motif: 'plum',    p: 'petalFall',        accent: '#E88BB0', title: '家里的女神，也有少女时代', greeting: '祝家里的女神节日快乐' } },
    { key: 'zhishujie',  name: '植树节', theme: 'dragon',    priority: 17, month: 3,  day: 12,              el: { motif: 'leaf',    p: 'leafFall',         accent: '#7FBF6A', title: '你种下的那棵树，如今多高了', greeting: '植树节，说说你种下的第一棵树' } },
    { key: 'yurenjie',   name: '愚人节', theme: 'winter',    priority: 18, month: 4,  day: 1,               el: { motif: 'bubble',  p: 'bubbleRise',       accent: '#7ED0C4', title: '小时候的恶作剧，笑到今天', greeting: '愚人节，讲讲小时候的恶作剧' } },
    { key: 'laodongjie', name: '劳动节', theme: 'national',  priority: 19, month: 5,  day: 1,               el: { motif: 'star',    p: 'starTwinkle',      accent: '#E0A34A', title: '第一份活计，你还记得多少', greeting: '劳动节，说说你干过的第一份活' } },
    { key: 'qingnianjie',name: '青年节', theme: 'dragon',    priority: 20, month: 5,  day: 4,               el: { motif: 'ribbon',  p: 'birdDrift',        accent: '#5FA8D3', title: '年轻时的热血，凉了没有', greeting: '青年节，聊聊你年轻时的热血事' } },
    { key: 'muqinjie',   name: '母亲节', theme: 'yuanxiao',  priority: 21, month: 5,  rule: [2, 0],         el: { motif: 'heart',   p: 'petalFall',        accent: '#F2A0B4', title: '妈妈那道拿手菜，学会了没', greeting: '母亲节，说说妈妈最拿手的那道菜' } },
    { key: 'ertongjie',  name: '儿童节', theme: 'winter',    priority: 22, month: 6,  day: 1,               el: { motif: 'bubble',  p: 'bubbleRise',       accent: '#FFC24D', title: '你的童年游戏，现在还玩吗', greeting: '儿童节，讲讲你的童年游戏' } },
    { key: 'fuqinjie',   name: '父亲节', theme: 'midnight',  priority: 23, month: 6,  rule: [3, 0],         el: { motif: 'star',    p: 'starTwinkle',      accent: '#8FA7C8', title: '爸爸教过的本事，还在用吗', greeting: '父亲节，说说爸爸教过你的本事' } },
    { key: 'jiandangjie',name: '建党节', theme: 'national',  priority: 24, month: 7,  day: 1,               el: { motif: 'star',    p: 'starRed',          accent: '#E5B84B', title: '家里老党员的那段岁月', greeting: '建党节，讲讲家里老党员的故事' } },
    { key: 'jianjunjie', name: '建军节', theme: 'dragon',    priority: 25, month: 8,  day: 1,               el: { motif: 'star',    p: 'starTwinkle',      accent: '#C8B96A', title: '家里当过兵的人，讲讲军营', greeting: '建军节，聊聊家里当过兵的人' } },
    { key: 'jiaoshijie', name: '教师节', theme: 'winter',    priority: 26, month: 9,  day: 10,              el: { motif: 'book',    p: 'bookFall',         accent: '#D9C6A0', title: '那位老师，改变了你什么', greeting: '教师节，说说影响过你的那位老师' } },
    { key: 'wanshengjie',name: '万圣节', theme: 'halloween', priority: 27, month: 10, day: 31, win: 0,       el: { motif: 'pumpkin', p: 'pumpkinFall',      accent: '#FF8A3D', title: '南瓜灯亮着，讲个小时候的怪谈', greeting: '万圣节，讲讲小时候听过的怪谈' } },
  ];

  var TABLE = { lunar: LUNAR, solar: SOLAR };
  var ALL = LUNAR.concat(SOLAR);

  // 默认（无节日当天）回落：中秋夜色 + 金色祥云
  var FALLBACK = { key: 'none', name: '', theme: 'midnight', el: { motif: 'cloud', p: 'goldFall', accent: '#D4A24C', title: '', greeting: '' } };

  // ── 无节日时的四季文案池（按日期取，故三端一致、当天固定）──
  // 每个季节两组，按「当天是单数还是双数日」轮换，避免天天看到同一句。
  var SEASON_COPY = {
    spring: [
      { title: '春风翻旧页，故事正当时', lead: '抽个话题，听长辈讲讲那些越来越远的记忆' },
      { title: '趁着春光，翻翻家里的老时光', lead: '一题一个年份，把家里的旧事问出来' },
    ],
    summer: [
      { title: '夏夜长，正好听一段往事', lead: '抽个话题，让长辈慢慢讲、慢慢回忆' },
      { title: '蝉声里，藏着谁的少年时', lead: '问一句「还记得吗」，一句话就是一段故事' },
    ],
    autumn: [
      { title: '秋凉了，家里的故事也该翻出来', lead: '抽个话题，听长辈讲讲那些越来越远的记忆' },
      { title: '落叶一片，旧事一桩', lead: '坐在院子里，问问长辈小时候的样子' },
    ],
    winter: [
      { title: '天冷了，围炉讲点旧事', lead: '抽个话题，把家里的老故事一桩桩问出来' },
      { title: '一年将尽，先把故事收好', lead: '一问一答，都是一家人自己的历史' },
    ],
  };

  // 按日期取季节文案：3–5 春 / 6–8 夏 / 9–11 秋 / 12–2 冬（气象季节）
  function seasonalCopy(date) {
    var d = date || new Date();
    var m = d.getMonth() + 1;
    var season = (m >= 3 && m <= 5) ? 'spring' : (m >= 6 && m <= 8) ? 'summer' : (m >= 9 && m <= 11) ? 'autumn' : 'winter';
    var pool = SEASON_COPY[season];
    return pool[d.getDate() % pool.length];
  }

  // ── 模块级状态 ─────────────────────────────────────────
  var _current = 'midnight';
  var _currentFestival = null;
  var _previewKey = null;      // 手动预览的节日 key（会话级；null 表示按当天自动）
  var _warned = false;
  var _textureHost = null;
  var _particlesHost = null;
  var _knotObserver = null;
  var _scanScheduled = false;
  var _refreshTimer = null;
  var _navDirTimer = null;
  var _navBound = false;
  var _booted = false;

  // ── 日期工具 ───────────────────────────────────────────
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function normDate(date) {
    if (date instanceof Date && !isNaN(date.getTime())) {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function todayMidnight() { return normDate(null); }

  function parseYmd(s) {
    var p = String(s).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function dayDiff(a, b) {
    return Math.round((a.getTime() - b.getTime()) / 86400000);
  }

  // 某年某月的第 n 个星期几（weekday：0=周日）
  function nthWeekday(year, month, n, weekday) {
    var first = new Date(year, month - 1, 1);
    var offset = (weekday - first.getDay() + 7) % 7;
    return new Date(year, month - 1, 1 + offset + (n - 1) * 7);
  }

  // ── 检测：返回命中的节日条目（无则 null）──────────────────
  function pick(date) {
    var d = normDate(date);
    var year = d.getFullYear();
    var best = null;
    var i;

    // 农历节日：仅在日期表覆盖年份内判定（超范围禁猜算，回落公历/默认）
    var inRange = year >= YEAR_MIN && year <= YEAR_MAX;
    if (!inRange && !_warned) {
      _warned = true;
      if (window.console) console.warn('节日日期表已过期');
    }
    if (inRange) {
      for (i = 0; i < LUNAR.length; i++) {
        var s = LUNAR[i].dates[year];
        if (!s) continue;
        var w = LUNAR[i].win == null ? 1 : LUNAR[i].win;
        if (Math.abs(dayDiff(d, parseYmd(s))) <= w) {
          if (!best || LUNAR[i].priority < best.priority) best = LUNAR[i];
        }
      }
    }

    // 公历节日：区间 / 第 n 个星期几 / 固定日 ± win
    for (i = 0; i < SOLAR.length; i++) {
      var f = SOLAR[i];
      var w2 = f.win == null ? 1 : f.win;
      var hit;
      if (f.span) {
        var a = new Date(year, f.month - 1, f.span[0]);
        var b = new Date(year, f.month - 1, f.span[1]);
        hit = d.getTime() >= a.getTime() && d.getTime() <= b.getTime();
      } else {
        var day = f.rule ? nthWeekday(year, f.month, f.rule[0], f.rule[1]).getDate() : f.day;
        hit = Math.abs(dayDiff(d, new Date(year, f.month - 1, day))) <= w2;
      }
      if (hit && (!best || f.priority < best.priority)) best = f;
    }
    return best;
  }

  function byKey(key) {
    for (var i = 0; i < ALL.length; i++) { if (ALL[i].key === key) return ALL[i]; }
    return null;
  }

  function today(date) { return pick(date); }

  // ── 全年节日清单（供首页「节日日历」卡使用）──────────────
  // 返回按日期升序的数组：{ key,name,theme,ymd,month,day,daysUntil,isToday,lunarCovered }
  // 农历项仅在日期表覆盖年份（YEAR_MIN–YEAR_MAX）内产出；公历项按固定日 / 区间起点 / 第 n 个星期几实时推算。
  function _solarDateOf(f, year) {
    if (f.rule) return nthWeekday(year, f.month, f.rule[0], f.rule[1]);
    if (f.span) return new Date(year, f.month - 1, f.span[0]);
    return new Date(year, f.month - 1, f.day);
  }

  function yearList(year) {
    var y = year || new Date().getFullYear();
    var covered = y >= YEAR_MIN && y <= YEAR_MAX;
    var base = todayMidnight();
    var raw = [];
    var i;

    if (covered) {
      for (i = 0; i < LUNAR.length; i++) {
        var s = LUNAR[i].dates[y];
        if (!s) continue;
        raw.push({ key: LUNAR[i].key, name: LUNAR[i].name, theme: LUNAR[i].theme, date: parseYmd(s) });
      }
    }
    for (i = 0; i < SOLAR.length; i++) {
      raw.push({ key: SOLAR[i].key, name: SOLAR[i].name, theme: SOLAR[i].theme, date: _solarDateOf(SOLAR[i], y) });
    }

    raw.sort(function (a, b) { return a.date.getTime() - b.date.getTime(); });
    return raw.map(function (e) {
      var d = e.date;
      var diff = dayDiff(d, base);
      return {
        key: e.key,
        name: e.name,
        theme: e.theme,
        ymd: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
        month: d.getMonth() + 1,
        day: d.getDate(),
        daysUntil: diff,
        isToday: diff === 0,
        lunarCovered: covered,
      };
    });
  }

  // 兼容 v2：仅返回配色主题 key
  function resolve(date) {
    var e = pick(date);
    return e ? e.theme : 'midnight';
  }

  // ── 应用（<html> 打类 + body 镜像 + meta theme-color + data-festival + 粒子重绘）──
  function applyEntry(entry, themeOverride) {
    var theme = themeOverride || (entry ? entry.theme : 'midnight');
    if (THEME_KEYS.indexOf(theme) === -1) theme = 'midnight';

    var root = document.documentElement;
    var body = document.body;
    for (var i = 0; i < THEME_KEYS.length; i++) {
      root.classList.remove('theme-' + THEME_KEYS[i]);
      if (body) body.classList.remove('theme-' + THEME_KEYS[i]);
    }
    // 默认（中秋夜色）＝ 基底 token，不加类
    if (theme !== 'midnight') {
      root.classList.add('theme-' + theme);
      if (body) body.classList.add('theme-' + theme);
    }
    root.setAttribute('data-theme', theme);
    // data-festival 是节日元素的唯一 CSS 钩子：配色/纹样/徽标色均由它落地
    root.setAttribute('data-festival', entry ? entry.key : 'none');
    if (body) body.setAttribute('data-festival', entry ? entry.key : 'none');

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', META_COLOR[theme] || META_COLOR.midnight);

    _current = theme;
    _currentFestival = entry || null;
    _renderParticles(entry);
    return theme;
  }

  // 兼容 v2：apply(key) —— 以「当天节日」为基础，强制指定配色主题
  function apply(key) {
    return applyEntry(pick(new Date()), key);
  }

  function current() { return _current; }
  function currentFestival() { return _currentFestival; }

  // ── 覆盖链 ─────────────────────────────────────────────
  function queryTheme() {
    try {
      var m = /[?&]theme=([^&#]+)/.exec(window.location.search);
      if (!m) return null;
      var v = decodeURIComponent(m[1]).toLowerCase();
      if (v === 'auto') return null;
      if (THEME_KEYS.indexOf(v) === -1) {
        if (window.console) console.warn('[FestivalTheme] 未知主题：' + v + '，回落到自动检测');
        return null;
      }
      return v;
    } catch (e) { return null; }
  }

  // 调试：?festival=chunjie 强制某节日；?festival=none 强制无节日
  function queryFestival() {
    try {
      var m = /[?&]festival=([^&#]+)/.exec(window.location.search);
      if (!m) return null;
      var v = decodeURIComponent(m[1]).toLowerCase();
      if (v === 'none' || v === 'auto') return v === 'none' ? 'none' : null;
      if (!byKey(v)) {
        if (window.console) console.warn('[FestivalTheme] 未知节日：' + v + '，回落到自动检测');
        return null;
      }
      return v;
    } catch (e) { return null; }
  }

  function storedTheme() {
    try {
      var v = window.localStorage.getItem(STORE_KEY);
      if (!v) return null;
      v = String(v).toLowerCase();
      return THEME_KEYS.indexOf(v) === -1 ? null : v;
    } catch (e) { return null; }
  }

  function refresh() {
    // 手动预览优先：预览期间不写 localStorage / URL，刷新页面即回到自动检测
    if (_previewKey) {
      var pv = byKey(_previewKey);
      if (pv) return applyEntry(pv, queryTheme() || storedTheme());
      _previewKey = null;
    }
    var fk = queryFestival();
    var entry;
    if (fk === 'none') entry = null;
    else if (fk) entry = byKey(fk);
    else entry = pick(new Date());
    return applyEntry(entry, queryTheme() || storedTheme());
  }

  // ── 手动预览（会话级）─────────────────────────────────────
  // 供首页「节日日历」点行切换：立即把该节日主题应用到整站（配色/纹样/粒子/文案），
  // 仅内存态、不落 localStorage，刷新或点「回到自动」即恢复按当天自动检测。
  function applyFestival(key) {
    var entry = key ? byKey(key) : null;
    if (key && !entry) return null;
    _previewKey = entry ? entry.key : null;
    return applyEntry(entry, queryTheme() || storedTheme());
  }

  function clearPreview() {
    _previewKey = null;
    return refresh();
  }

  function previewKey() { return _previewKey; }

  // ── 粒子 ───────────────────────────────────────────────
  function _renderParticles(entry) {
    if (!_particlesHost) return;
    while (_particlesHost.firstChild) _particlesHost.removeChild(_particlesHost.firstChild);

    var preset = entry && entry.el ? P[entry.el.p] : null;
    var spec = preset || P.goldFall;
    var n = Math.min(spec.count, 20);

    for (var i = 0; i < n; i++) {
      var p = document.createElement('span');
      p.className = 'theme-particle ' + spec.type + ' ' + spec.cls;
      p.setAttribute('aria-hidden', 'true');

      var s = spec.size[0] + Math.random() * (spec.size[1] - spec.size[0]);
      if (s > 0) {
        p.style.width = s.toFixed(1) + 'px';
        p.style.height = s.toFixed(1) + 'px';
      }

      // 定位范式：fall/rain 只随机水平；drift 只随机纵向；scatter/rise 随机水平（scatter 另随机纵向）
      if (spec.place === 'drift') {
        p.style.top = (Math.random() * 80).toFixed(2) + '%';
      } else {
        p.style.left = (Math.random() * 100).toFixed(2) + '%';
        if (spec.place === 'scatter') p.style.top = (Math.random() * 70).toFixed(2) + '%';
      }

      p.style.animationDelay = (-Math.random() * 8).toFixed(2) + 's';
      p.style.animationDuration = (spec.dur[0] + Math.random() * (spec.dur[1] - spec.dur[0])).toFixed(2) + 's';

      _particlesHost.appendChild(p);
    }
  }

  // ── 装饰层挂载 ─────────────────────────────────────────
  // #theme-texture 内再挂一层 .theme-motif：纹样用 mask-image 上色（随 --fest-a 变色），
  // 必须放在子元素上，否则遮罩会连带把 #theme-texture 的 ::before 氤氲与 ::after 远山一起裁掉。
  function _mountLayers() {
    if (!document.body) return;
    if (!_textureHost) {
      _textureHost = document.createElement('div');
      _textureHost.id = 'theme-texture';
      _textureHost.className = 'no-print';
      _textureHost.setAttribute('aria-hidden', 'true');
      var motif = document.createElement('div');
      motif.className = 'theme-motif';
      motif.setAttribute('aria-hidden', 'true');
      _textureHost.appendChild(motif);
      document.body.insertBefore(_textureHost, document.body.firstChild);
    }
    if (!_particlesHost) {
      _particlesHost = document.createElement('div');
      _particlesHost.id = 'theme-particles';
      _particlesHost.className = 'no-print';
      _particlesHost.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(_particlesHost, _textureHost.nextSibling);
    }
    _renderParticles(_currentFestival);
  }

  // ── 盘长结（DOM 内联 SVG；aria-hidden + no-print）──────
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function _svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) el.setAttribute(k, attrs[k]);
    }
    return el;
  }

  function _buildKnot(className) {
    var svg = _svgEl('svg', {
      viewBox: '0 0 64 96',
      width: '64',
      height: '96',
      class: className,
      'aria-hidden': 'true',
      focusable: 'false',
    });
    svg.appendChild(_svgEl('path', {
      d: 'M32 30C22 24 22 8 32 4c10 4 10 20 0 26z',
      fill: 'none', stroke: '#C0392B', 'stroke-width': '2.6', 'stroke-linejoin': 'round',
    }));
    svg.appendChild(_svgEl('path', {
      d: 'M32 30 58 50 32 70 6 50z',
      fill: 'none', stroke: '#C0392B', 'stroke-width': '3.2', 'stroke-linejoin': 'round',
    }));
    svg.appendChild(_svgEl('path', {
      d: 'M32 38 50 50 32 62 14 50z',
      fill: 'none', stroke: '#D4A24C', 'stroke-width': '2.4', 'stroke-linejoin': 'round',
    }));
    svg.appendChild(_svgEl('path', {
      d: 'M32 30v8M58 50h-8M32 70v-8M6 50h8',
      fill: 'none', stroke: '#C0392B', 'stroke-width': '2.6', 'stroke-linecap': 'round',
    }));
    svg.appendChild(_svgEl('circle', { cx: '32', cy: '50', r: '4', fill: '#D4A24C' }));
    svg.appendChild(_svgEl('path', {
      d: 'M32 70v6', fill: 'none', stroke: '#C0392B', 'stroke-width': '2.4', 'stroke-linecap': 'round',
    }));
    svg.appendChild(_svgEl('circle', { cx: '32', cy: '79', r: '4', fill: '#D4A24C' }));
    svg.appendChild(_svgEl('path', { d: 'M25 83h14l-2.6 9h-8.8z', fill: '#C0392B' }));
    var tas = _svgEl('g', { fill: 'none', stroke: '#C0392B', 'stroke-width': '2', 'stroke-linecap': 'round' });
    tas.appendChild(_svgEl('path', { d: 'M27 92v4M32 92v6M37 92v4' }));
    svg.appendChild(tas);
    return svg;
  }

  function _scanKnots() {
    var hero = document.querySelector('.view-home-hero');
    if (hero && !hero.querySelector('.theme-knot')) {
      hero.appendChild(_buildKnot('theme-knot theme-knot-hero no-print'));
    }
    var cards = document.querySelectorAll('.dialog-card');
    for (var i = 0; i < cards.length; i++) {
      if (!cards[i].querySelector('.theme-knot')) {
        cards[i].appendChild(_buildKnot('theme-knot theme-knot-dialog no-print'));
      }
    }
  }

  function _scheduleScan() {
    if (_scanScheduled) return;
    _scanScheduled = true;
    var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    raf(function () { _scanScheduled = false; _scanKnots(); });
  }

  function _mountKnots() {
    _scanKnots();
    if (typeof MutationObserver !== 'function') return;
    _knotObserver = new MutationObserver(_scheduleScan);
    var main = document.getElementById('app-main');
    var dlg = document.getElementById('dialog-root');
    _knotObserver.observe(main || document.body, { childList: true, subtree: true });
    if (dlg && dlg !== (main || document.body)) {
      _knotObserver.observe(dlg, { childList: true, subtree: true });
    }
  }

  // ── 视图方向感（捕获阶段监听 #app-nav，先于 app.js 的冒泡处理）──
  function _bindNavDir() {
    if (_navBound) return;
    var nav = document.getElementById('app-nav');
    if (!nav) return;
    _navBound = true;

    nav.addEventListener('click', function (ev) {
      var node = ev.target;
      while (node && node !== nav) {
        if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute('data-nav')) {
          var to = NAV_ORDER.indexOf(node.getAttribute('data-nav'));
          var act = nav.querySelector('.nav-item.is-active');
          var from = act ? NAV_ORDER.indexOf(act.getAttribute('data-nav')) : -1;
          if (to !== -1 && from !== -1 && to !== from) {
            document.documentElement.setAttribute('data-nav-dir', to > from ? 'fwd' : 'back');
            if (_navDirTimer) clearTimeout(_navDirTimer);
            _navDirTimer = setTimeout(function () {
              document.documentElement.removeAttribute('data-nav-dir');
            }, 480);
          }
          return;
        }
        node = node.parentNode;
      }
    }, true);
  }

  // ── 与 home.js 的 MID_AUTUMN_DATES 一致性断言（冲突时以 home.js 为准）──
  function _assertMidAutumn() {
    var home = window.MID_AUTUMN_DATES;
    if (!home || !home.length) return;
    var zq = null;
    for (var i = 0; i < LUNAR.length; i++) { if (LUNAR[i].key === 'zhongqiu') { zq = LUNAR[i]; break; } }
    if (!zq) return;

    var mismatch = false;
    for (var j = 0; j < home.length; j++) {
      var y = String(home[j]).slice(0, 4);
      if (zq.dates[y] && zq.dates[y] !== home[j]) {
        mismatch = true;
        zq.dates[y] = home[j];
      }
    }
    if (mismatch && window.console) {
      console.error('[FestivalTheme] 中秋日期与 home.js MID_AUTUMN_DATES 不一致，已以 home.js 为准');
    }
  }

  // ── 刷新定时器 ─────────────────────────────────────────
  function _startRefresh() {
    if (_refreshTimer !== null) clearInterval(_refreshTimer);
    _refreshTimer = setInterval(function () { refresh(); }, REFRESH_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refresh();
    });
  }

  // ── 启动 ───────────────────────────────────────────────
  function boot() {
    if (_booted) return;
    _booted = true;
    _assertMidAutumn();   // defer 脚本已执行，window.MID_AUTUMN_DATES 可用
    refresh();            // 重新解析并镜像到 body
    _mountLayers();
    _mountKnots();
    _bindNavDir();
    _startRefresh();
  }

  // 首帧前：head 内非 defer 执行 —— 仅 html 已存在，先打主题类消除闪烁
  (function () {
    var fk = queryFestival();
    var entry = fk === 'none' ? null : (fk ? byKey(fk) : pick(new Date()));
    applyEntry(entry, queryTheme() || storedTheme());
  })();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.FestivalTheme = {
    TABLE: TABLE,
    resolve: resolve,
    apply: apply,
    current: current,
    refresh: refresh,
    today: today,
    currentFestival: currentFestival,
    yearList: yearList,
    seasonalCopy: seasonalCopy,
    applyFestival: applyFestival,
    clearPreview: clearPreview,
    previewKey: previewKey,
    byKey: byKey,
    keys: THEME_KEYS,
  };
})();

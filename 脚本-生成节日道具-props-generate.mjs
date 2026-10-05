// 脚本-生成节日道具-props-generate.mjs
// 用途：按站内「朱红 · 描金 · 夜色宣纸」体系重绘 27 件节日抽题道具（国庆转盘为盘面/底座两层）。
//       与 static/素材-assets/抽签筒-tumbler.svg 同一套美术语言：月晕 → 星芒 → 主体（描金线 + 高光/暗部）
//       → 回纹/祥云/流苏等国风元素 → 地面投影 + 金辉。
// 统一规范（27 件必须一致，避免大小风格参差）：
//       画布 220×260；主体水平居中 cx=110、底边 y=208、最大宽 140、最大高 174；
//       描金线宽 1.6–2.6、透明度 .3–.7；配色只用站内 token（见下方 PALETTE）；
//       地面投影 cy=212 / 金辉 cy=211；星芒位置固定。
// 运行：node 脚本-生成节日道具-props-generate.mjs
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'static', '素材-assets', '抽题道具-props');

// ── 站内色（与 样式-style.css 9.1 token / v3 追加 token 一致）──
const P = {
  G1: '#FFF0C4', G2: '#E2B75E', G3: '#A97C2C', G4: '#D4A24C', // 描金
  R1: '#E85B40', R2: '#C0392B', R3: '#96201A', R4: '#B7281C', R5: '#7C140F', // 朱红
  P1: '#FFFDF8', P2: '#F3E7CE', P3: '#E6DCC8', // 宣纸
  W1: '#B87F31', W2: '#96621F', W3: '#5F3A12', // 竹木
  N1: '#2F5C8A', N2: '#1B3A5C', // 夜蓝
  OK: '#3E8E5A', INK: '#3A2A16', SH: '#04070F',
  MOON: '#FFD97D',
  ORANGE: '#D9822B', // 暖橘（站内 --c-warn；仅供南瓜灯等节令暖光件）
};

// ── 共用 defs（描金/朱红/纸色/竹木/夜蓝渐变 + 月晕 + 星芒）──
const DEFS = `<defs>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.G1}"/><stop offset=".45" stop-color="${P.G2}"/><stop offset="1" stop-color="${P.G3}"/>
    </linearGradient>
    <linearGradient id="goldX" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${P.G3}"/><stop offset=".4" stop-color="${P.G1}"/><stop offset="1" stop-color="${P.G2}"/>
    </linearGradient>
    <linearGradient id="red" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.R1}"/><stop offset=".5" stop-color="${P.R2}"/><stop offset="1" stop-color="${P.R3}"/>
    </linearGradient>
    <linearGradient id="redX" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${P.R3}"/><stop offset=".38" stop-color="${P.R1}"/><stop offset="1" stop-color="${P.R5}"/>
    </linearGradient>
    <linearGradient id="deep" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.R4}"/><stop offset="1" stop-color="${P.R5}"/>
    </linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.P1}"/><stop offset="1" stop-color="${P.P2}"/>
    </linearGradient>
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${P.W3}"/><stop offset=".3" stop-color="${P.W1}"/><stop offset=".62" stop-color="${P.G2}"/><stop offset="1" stop-color="${P.W2}"/>
    </linearGradient>
    <linearGradient id="night" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.N1}"/><stop offset="1" stop-color="${P.N2}"/>
    </linearGradient>
    <linearGradient id="leaf" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5FA96F"/><stop offset="1" stop-color="${P.OK}"/>
    </linearGradient>
    <linearGradient id="pump" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#E8933A"/><stop offset=".45" stop-color="${P.ORANGE}"/><stop offset="1" stop-color="#A8531A"/>
    </linearGradient>
    <radialGradient id="halo" cx="50%" cy="46%" r="52%">
      <stop offset="0" stop-color="${P.MOON}" stop-opacity=".42"/>
      <stop offset=".55" stop-color="${P.MOON}" stop-opacity=".13"/>
      <stop offset="1" stop-color="${P.MOON}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="warm" cx="50%" cy="52%" r="50%">
      <stop offset="0" stop-color="#FFE9A8" stop-opacity=".85"/>
      <stop offset=".5" stop-color="${P.MOON}" stop-opacity=".35"/>
      <stop offset="1" stop-color="${P.MOON}" stop-opacity="0"/>
    </radialGradient>
    <path id="spark" d="M0 -6 L1.7 -1.7 L6 0 L1.7 1.7 L0 6 L-1.7 1.7 L-6 0 L-1.7 -1.7 Z" fill="${P.MOON}"/>
  </defs>`;

// ── 国风零件 ──────────────────────────────────────────────
const S = {
  // 月晕（主体背后的柔和金光）
  halo: (r = 104) => `<circle cx="110" cy="132" r="${r}" fill="url(#halo)"/>`,
  // 星芒点缀（位置固定，27 件一致）
  sparks: (o = 1) => `<g opacity="${o}">
    <use href="#spark" transform="translate(38 86) scale(.8)" opacity=".62"/>
    <use href="#spark" transform="translate(184 74) scale(.58)" opacity=".5"/>
    <use href="#spark" transform="translate(30 168) scale(.5)" opacity=".42"/>
    <use href="#spark" transform="translate(190 172) scale(.72)" opacity=".55"/>
    <use href="#spark" transform="translate(62 232) scale(.46)" opacity=".36"/>
    <use href="#spark" transform="translate(162 230) scale(.5)" opacity=".42"/>
  </g>`,
  // 地面：投影 + 金辉（投影收一点、淡一点，避免在舞台上糊成一块黑饼）
  ground: (rx = 62) => `<ellipse cx="110" cy="212" rx="${Math.round(rx * 0.9)}" ry="9" fill="${P.SH}" opacity=".42"/>
  <ellipse cx="110" cy="211" rx="${Math.round(rx * 0.68)}" ry="6" fill="${P.MOON}" opacity=".18"/>`,
  // 回纹带（描金平铺，可横可竖）
  fret: (x, y, n, step = 20, op = .5) => {
    let d = '';
    for (let i = 0; i < n; i++) d += `<path d="M${x + i * step} ${y}V${y - 14}h12v7h-7v-4"/>`;
    return `<g fill="none" stroke="${P.G1}" stroke-opacity="${op}" stroke-width="2" stroke-linecap="square">${d}</g>`;
  },
  // 祥云线（描金，可缩放）
  cloud: (cx, cy, s = 1, op = .55) => `<g transform="translate(${cx} ${cy}) scale(${s})" fill="none"
    stroke="${P.G1}" stroke-opacity="${op}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M-26 10c-9 0-16-6-16-14s7-14 16-14c3-10 13-17 24-17 13 0 24 9 27 21 3-1 6-3 10-3 10 0 18 7 18 16 0 8-7 15-16 15z" transform="scale(.72)"/>
    <path d="M-14 2c0-5 4-9 9-9M4 -8c5 0 9 4 9 9" transform="scale(.72)"/>
  </g>`,
  // 流苏（垂坠，红绸 + 金箍）
  tassel: (x, y, len = 34) => `<g transform="translate(${x} ${y})">
    <path d="M-6 -6 C-2 0 2 0 6 -6" fill="none" stroke="${P.G2}" stroke-width="2" stroke-linecap="round"/>
    <rect x="-7" y="0" width="14" height="4.6" rx="2.3" fill="url(#gold)"/>
    <path d="M-6 4.6 h12 l-2.4 ${len} h-7.2 Z" fill="url(#red)"/>
    <g stroke="${P.R4}" stroke-width="1.6" stroke-linecap="round" opacity=".9">
      <path d="M-3.4 ${len * 0.5 + 6} v${len * 0.42}"/><path d="M0 ${len * 0.5 + 6} v${len * 0.52}"/>
      <path d="M3.4 ${len * 0.5 + 6} v${len * 0.44}"/>
    </g>
  </g>`,
  // 五角星（描金/朱红）
  star: (cx, cy, r, fill = 'url(#gold)') => {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const ang = (Math.PI / 5) * i - Math.PI / 2;
      const rr = i % 2 ? r * 0.42 : r;
      pts.push(`${(cx + Math.cos(ang) * rr).toFixed(1)} ${(cy + Math.sin(ang) * rr).toFixed(1)}`);
    }
    return `<path d="M${pts.join('L')}Z" fill="${fill}" stroke="${P.G1}" stroke-opacity=".55" stroke-width="1"/>`;
  },
  // 雪花（六芒，描金）
  flake: (cx, cy, r, op = .75) => `<g transform="translate(${cx} ${cy})" stroke="${P.G1}" stroke-opacity="${op}" stroke-width="1.8" stroke-linecap="round" fill="none">
    ${[0, 60, 120].map((a) => `<path d="M${-Math.cos((a * Math.PI) / 180) * r} ${-Math.sin((a * Math.PI) / 180) * r}L${Math.cos((a * Math.PI) / 180) * r} ${Math.sin((a * Math.PI) / 180) * r}"/>`).join('')}
  </g>`,
  // 花（花瓣数 n，两轮，用于菊花/康乃馨/金桂）
  flower: (cx, cy, r, n, fill, core = P.G1) => {
    let d = '';
    for (let i = 0; i < n; i++) {
      const a = ((360 / n) * i * Math.PI) / 180;
      d += `<ellipse cx="${(Math.cos(a) * r * 0.55).toFixed(1)}" cy="${(Math.sin(a) * r * 0.55).toFixed(1)}" rx="${(r * 0.42).toFixed(1)}" ry="${(r * 0.24).toFixed(1)}" transform="rotate(${(360 / n) * i} ${(Math.cos(a) * r * 0.55).toFixed(1)} ${(Math.sin(a) * r * 0.55).toFixed(1)})" fill="${fill}" opacity=".92"/>`;
    }
    return `<g transform="translate(${cx} ${cy})">${d}<circle r="${(r * 0.3).toFixed(1)}" fill="${core}"/></g>`;
  },
  // 绸带蝴蝶结
  bow: (cx, cy, s = 1) => `<g transform="translate(${cx} ${cy}) scale(${s})">
    <path d="M0 0 C-14 -12 -30 -8 -28 4 C-26 14 -12 14 -2 4 Z" fill="url(#red)" stroke="${P.G2}" stroke-opacity=".5" stroke-width="1.4"/>
    <path d="M0 0 C14 -12 30 -8 28 4 C26 14 12 14 2 4 Z" fill="url(#red)" stroke="${P.G2}" stroke-opacity=".5" stroke-width="1.4"/>
    <circle r="5.4" fill="url(#gold)"/>
  </g>`,
  // 描金内边（卡片式描边）
  inner: (x, y, w, h, r = 8, op = .45) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="${P.G1}" stroke-opacity="${op}" stroke-width="1.6"/>`,
};

// 统一外框：月晕 → 星芒 → 主体 → 地面
const wrap = (label, subject, { halo = 104, ground = 62, sparks = true } = {}) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 260" width="220" height="260" role="img" aria-label="${label}">
  <!-- ${label}（手绘 SVG · 站内「朱红·描金·夜色」体系：月晕 → 星芒 → 主体 → 地面投影+金辉） -->
  ${DEFS}
  ${S.halo(halo)}
  ${sparks ? S.sparks() : ''}
  ${subject}
  ${S.ground(ground)}
</svg>`;

// ── 27 件主体 ─────────────────────────────────────────────
const SUBJECTS = {
  // 除夕 · 福袋（朱红绸袋 + 描金束口 + 福纹）
  chuxi: () => wrap('除夕抽题福袋', `
  <path d="M76 118 C72 152 84 190 110 204 C136 190 148 152 144 118 C142 106 128 98 110 98 C92 98 78 106 76 118 Z" fill="url(#red)"/>
  <path d="M76 118 C72 152 84 190 110 204 C136 190 148 152 144 118 C142 106 128 98 110 98 C92 98 78 106 76 118 Z" fill="none" stroke="${P.G2}" stroke-opacity=".55" stroke-width="2"/>
  <path d="M86 122 C84 152 90 180 100 194" fill="none" stroke="${P.G1}" stroke-opacity=".3" stroke-width="8" stroke-linecap="round"/>
  <path d="M138 122 C140 152 134 178 124 192" fill="none" stroke="${P.W3}" stroke-opacity=".3" stroke-width="9" stroke-linecap="round"/>
  ${S.cloud(110, 142, .95, .6)}
  ${S.fret(84, 188, 3, 20, .42)}
  <path d="M94 100 C100 90 120 90 126 100" fill="none" stroke="url(#goldX)" stroke-width="4" stroke-linecap="round"/>
  <path d="M92 96 C98 84 122 84 128 96 C124 88 96 88 92 96" fill="${P.G3}" opacity=".6"/>
  <ellipse cx="110" cy="98" rx="17" ry="7" fill="none" stroke="${P.G2}" stroke-opacity=".7" stroke-width="2.6"/>
  ${S.bow(110, 80, .6)}
  ${S.tassel(146, 148, 26)}`, { ground: 64 }),

  // 春节 · 压岁红包（竖式红包 + 描金封口 + 方孔钱纹）
  chunjie: () => wrap('春节抽题红包', `
  <rect x="64" y="60" width="92" height="146" rx="10" fill="url(#deep)"/>
  <rect x="64" y="60" width="92" height="146" rx="10" fill="none" stroke="${P.G2}" stroke-opacity=".6" stroke-width="2"/>
  <path d="M64 106 C64 84 84 66 110 66 C136 66 156 84 156 106 Z" fill="url(#red)"/>
  <path d="M64 106 C84 116 136 116 156 106" fill="none" stroke="${P.G2}" stroke-opacity=".85" stroke-width="2.6"/>
  <path d="M64 106 H156" stroke="${P.R5}" stroke-opacity=".45" stroke-width="2"/>
  <path d="M78 122 C82 152 84 176 84 190" fill="none" stroke="${P.G1}" stroke-opacity=".22" stroke-width="6" stroke-linecap="round"/>
  <g transform="translate(110 150)">
    <circle r="24" fill="none" stroke="url(#goldX)" stroke-width="4"/>
    <circle r="17" fill="none" stroke="${P.G1}" stroke-opacity=".55" stroke-width="1.6"/>
    <circle r="11" fill="${P.R2}" opacity=".35"/>
    <rect x="-6" y="-6" width="12" height="12" rx="2" fill="none" stroke="${P.G1}" stroke-opacity=".85" stroke-width="2.4"/>
  </g>
  ${S.cloud(110, 192, .72, .5)}
  ${S.fret(72, 200, 4, 20, .38)}`, { ground: 58 }),

  // 中秋 · 月饼盒（盒 + 描金月饼 + 金桂）
  zhongqiu: () => wrap('中秋抽题月饼盒', `
  <rect x="62" y="126" width="96" height="72" rx="9" fill="url(#red)"/>
  <rect x="62" y="126" width="96" height="72" rx="9" fill="none" stroke="${P.G2}" stroke-opacity=".55" stroke-width="2"/>
  <path d="M70 134 C74 172 76 190 76 196" fill="none" stroke="${P.G1}" stroke-opacity=".22" stroke-width="6" stroke-linecap="round"/>
  ${S.fret(74, 192, 4, 20, .4)}
  <ellipse cx="110" cy="126" rx="48" ry="12" fill="${P.R5}" opacity=".9"/>
  <ellipse cx="110" cy="124" rx="48" ry="12" fill="none" stroke="url(#goldX)" stroke-width="4"/>
  <g transform="translate(110 96)">
    <circle r="30" fill="url(#gold)"/>
    <circle r="30" fill="none" stroke="${P.G1}" stroke-opacity=".7" stroke-width="2"/>
    <circle r="21" fill="none" stroke="${P.R3}" stroke-opacity=".45" stroke-width="1.8"/>
    ${S.fret(-20, 8, 2, 20, .5)}
    <circle r="6" fill="${P.R2}" opacity=".8"/>
  </g>
  ${S.flower(160, 196, 22, 5, P.G1, P.G2)}
  <path d="M150 200 C160 176 168 160 176 148" fill="none" stroke="${P.OK}" stroke-opacity=".7" stroke-width="2.4" stroke-linecap="round"/>
  ${S.flower(176, 148, 11, 4, '#5FA96F', P.G1)}`, { ground: 64 }),

  // 端午 · 粽子（箬叶 + 描金捆绳 + 艾草）
  duanwu: () => wrap('端午抽题粽子', `
  <path d="M110 66 L176 178 C178 192 152 208 110 208 C68 208 42 192 44 178 Z" fill="url(#leaf)"/>
  <path d="M110 66 L176 178 C178 192 152 208 110 208 C68 208 42 192 44 178 Z" fill="none" stroke="${P.G2}" stroke-opacity=".55" stroke-width="2.2"/>
  <path d="M84 206 C78 162 88 112 108 74" fill="none" stroke="${P.P1}" stroke-opacity=".32" stroke-width="4" stroke-linecap="round"/>
  <path d="M110 66 C102 128 98 172 98 206" fill="none" stroke="${P.W3}" stroke-opacity=".26" stroke-width="3" stroke-linecap="round"/>
  <g stroke="url(#goldX)" stroke-width="4.6" fill="none" stroke-linecap="round">
    <path d="M62 146 C88 156 132 156 158 146"/>
    <path d="M66 170 C90 180 129 180 153 170"/>
  </g>
  <g stroke="${P.G1}" stroke-opacity=".55" stroke-width="1.6" fill="none" stroke-linecap="round">
    <path d="M62 143 C88 153 132 153 158 143"/><path d="M66 167 C90 177 129 177 153 167"/>
  </g>
  <path d="M62 146 C48 138 40 126 40 112" fill="none" stroke="url(#goldX)" stroke-width="4.2" stroke-linecap="round"/>
  <path d="M40 112 C33 120 32 130 36 136 C45 133 48 122 40 112 Z" fill="url(#gold)"/>
  <path d="M152 84 C164 64 176 52 190 44" fill="none" stroke="${P.OK}" stroke-opacity=".8" stroke-width="2.6" stroke-linecap="round"/>
  ${S.flower(192, 42, 15, 6, '#5FA96F', P.G1)}
  ${S.flower(170, 66, 11, 5, '#5FA96F', P.G1)}`, { ground: 70 }),

  // 元宵 · 宫灯（六角灯身 + 描金回纹 + 灯谜条 + 流苏）
  yuanxiao: () => wrap('元宵抽题宫灯', `
  <path d="M110 40 V56" stroke="${P.G2}" stroke-width="2.6"/>
  <rect x="74" y="56" width="72" height="14" rx="6" fill="url(#gold)"/>
  <path d="M78 70 C64 96 64 148 78 174 L142 174 C156 148 156 96 142 70 Z" fill="url(#red)"/>
  <path d="M78 70 C64 96 64 148 78 174 L142 174 C156 148 156 96 142 70 Z" fill="none" stroke="${P.G2}" stroke-opacity=".6" stroke-width="2"/>
  <g stroke="${P.G1}" stroke-opacity=".4" stroke-width="1.6" fill="none">
    <path d="M88 72 C80 98 80 146 88 172"/><path d="M110 70 V174"/><path d="M132 72 C140 98 140 146 132 172"/>
  </g>
  <path d="M86 96 C82 124 82 150 86 168" fill="none" stroke="${P.G1}" stroke-opacity=".22" stroke-width="6" stroke-linecap="round"/>
  ${S.fret(88, 152, 2, 20, .5)}
  <rect x="74" y="174" width="72" height="13" rx="6" fill="url(#gold)"/>
  <path d="M88 187 C96 196 124 196 132 187" fill="none" stroke="${P.G2}" stroke-width="2.4"/>
  ${S.tassel(110, 194, 26)}
  <g transform="translate(160 128)">
    <rect x="-4" y="0" width="20" height="30" rx="3" fill="url(#paper)" stroke="${P.G2}" stroke-opacity=".6" stroke-width="1.4"/>
    <g stroke="${P.INK}" stroke-opacity=".5" stroke-width="1.4" stroke-linecap="round">
      <path d="M2 8h8"/><path d="M2 14h8"/><path d="M2 20h8"/>
    </g>
    <path d="M6 0 V-8" stroke="${P.G2}" stroke-width="1.6"/>
  </g>`, { ground: 58 }),

  // 七夕 · 同心结（双环描金结 + 红绳 + 双星）
  qixi: () => wrap('七夕抽题同心结', `
  <g transform="translate(110 132)">
    <circle cx="-22" cy="0" r="26" fill="none" stroke="url(#goldX)" stroke-width="5"/>
    <circle cx="22" cy="0" r="26" fill="none" stroke="url(#goldX)" stroke-width="5"/>
    <circle cx="-22" cy="0" r="26" fill="none" stroke="${P.G1}" stroke-opacity=".35" stroke-width="1.6"/>
    <circle cx="22" cy="0" r="26" fill="none" stroke="${P.G1}" stroke-opacity=".35" stroke-width="1.6"/>
    <path d="M-22 0 H22" stroke="${P.G1}" stroke-opacity=".5" stroke-width="1.6" stroke-dasharray="3 4"/>
  </g>
  <path d="M84 108 C88 74 100 56 110 46 C120 56 132 74 136 108" fill="none" stroke="url(#red)" stroke-width="4" stroke-linecap="round"/>
  <path d="M76 116 C74 148 60 168 48 180" fill="none" stroke="${P.R2}" stroke-width="3" stroke-linecap="round"/>
  <path d="M144 116 C146 148 160 168 172 180" fill="none" stroke="${P.R2}" stroke-width="3" stroke-linecap="round"/>
  ${S.tassel(110, 164, 30)}
  ${S.star(64, 62, 9)}
  ${S.star(158, 52, 7)}`, { ground: 62 }),

  // 重阳 · 菊花酒（描金酒盏 + 菊花 + 茱萸）
  chongyang: () => wrap('重阳抽题菊花酒', `
  <path d="M74 152 C74 190 90 206 110 206 C130 206 146 190 146 152 Z" fill="url(#gold)"/>
  <path d="M74 152 C74 190 90 206 110 206 C130 206 146 190 146 152 Z" fill="none" stroke="${P.G1}" stroke-opacity=".6" stroke-width="2"/>
  <ellipse cx="110" cy="152" rx="44" ry="11" fill="${P.R5}" opacity=".85"/>
  <ellipse cx="110" cy="150" rx="44" ry="11" fill="none" stroke="url(#goldX)" stroke-width="4"/>
  <path d="M88 158 C84 178 88 192 96 200" fill="none" stroke="${P.P1}" stroke-opacity=".3" stroke-width="6" stroke-linecap="round"/>
  ${S.fret(90, 198, 2, 20, .5)}
  ${S.flower(110, 104, 44, 10, P.G2, P.G1)}
  ${S.flower(110, 104, 26, 8, P.G1, P.R2)}
  <path d="M110 104 C96 128 84 140 70 146" fill="none" stroke="${P.OK}" stroke-opacity=".6" stroke-width="2.2" stroke-linecap="round"/>
  ${S.flower(70, 146, 10, 4, '#5FA96F', P.G1)}`, { ground: 60 }),

  // 腊八 · 腊八粥（描金碗 + 八宝 + 热气）
  laba: () => wrap('腊八抽题粥碗', `
  <path d="M70 148 C70 190 88 208 110 208 C132 208 150 190 150 148 Z" fill="url(#night)"/>
  <path d="M70 148 C70 190 88 208 110 208 C132 208 150 190 150 148 Z" fill="none" stroke="${P.G2}" stroke-opacity=".6" stroke-width="2"/>
  <path d="M86 156 C82 180 86 196 96 204" fill="none" stroke="${P.G1}" stroke-opacity=".26" stroke-width="6" stroke-linecap="round"/>
  ${S.fret(88, 200, 2, 20, .48)}
  <ellipse cx="110" cy="148" rx="46" ry="13" fill="${P.P2}"/>
  <ellipse cx="110" cy="148" rx="46" ry="13" fill="none" stroke="url(#goldX)" stroke-width="4"/>
  <g>
    <circle cx="92" cy="146" r="7" fill="${P.R2}"/><circle cx="112" cy="142" r="6" fill="${P.G3}"/>
    <circle cx="128" cy="150" r="6.6" fill="${P.P1}"/><circle cx="102" cy="152" r="5" fill="${P.R4}"/>
    <circle cx="120" cy="140" r="4.4" fill="${P.OK}"/>
  </g>
  <g fill="none" stroke="${P.G1}" stroke-opacity=".38" stroke-width="2.4" stroke-linecap="round">
    <path d="M96 132 C92 118 100 108 96 92"/><path d="M114 128 C110 112 118 102 114 84"/>
  </g>
  <path d="M142 116 L170 104" stroke="${P.W1}" stroke-width="5" stroke-linecap="round"/>
  <ellipse cx="170" cy="104" rx="10" ry="7" fill="url(#wood)"/>`, { ground: 64 }),

  // 清明 · 纸鸢（菱形风筝 + 祥云纹 + 飘带尾巴）
  qingming: () => wrap('清明抽题纸鸢', `
  <g transform="translate(106 116) rotate(-8)">
    <path d="M0 -68 L54 0 L0 64 L-54 0 Z" fill="url(#paper)" stroke="${P.G2}" stroke-opacity=".6" stroke-width="2"/>
    <path d="M0 -68 L0 64M-54 0 H54" stroke="${P.G2}" stroke-opacity=".7" stroke-width="2"/>
    ${S.cloud(0, -4, .98, .6)}
    <path d="M-30 -36 L30 36M30 -36 L-30 36" stroke="${P.R2}" stroke-opacity=".45" stroke-width="1.6"/>
    <path d="M-44 -12 C-30 -22 -18 -20 -8 -10" fill="none" stroke="${P.G1}" stroke-opacity=".45" stroke-width="2"/>
    <path d="M8 10 C18 20 30 22 44 12" fill="none" stroke="${P.G1}" stroke-opacity=".45" stroke-width="2"/>
  </g>
  <path d="M122 168 C138 182 150 192 160 202" fill="none" stroke="${P.G2}" stroke-opacity=".7" stroke-width="1.8"/>
  <g fill="url(#red)" stroke="${P.G1}" stroke-opacity=".35" stroke-width="1">
    <g transform="translate(130 174) scale(.6)"><path d="M0 0C-8 -8 -18 -6 -18 0 -18 6 -8 8 0 2 8 8 18 6 18 0 18 -6 8 -8 0 0Z"/></g>
    <g transform="translate(144 188) scale(.52)"><path d="M0 0C-8 -8 -18 -6 -18 0 -18 6 -8 8 0 2 8 8 18 6 18 0 18 -6 8 -8 0 0Z"/></g>
    <g transform="translate(158 202) scale(.44)"><path d="M0 0C-8 -8 -18 -6 -18 0 -18 6 -8 8 0 2 8 8 18 6 18 0 18 -6 8 -8 0 0Z"/></g>
  </g>
  <g transform="translate(110 40)" opacity=".8">${S.flake(0, 0, 9, .6)}</g>`, { ground: 58 }),

  // 跨年 · 许愿瓶（玻璃瓶 + 星光 + 木塞）
  kuannian: () => wrap('跨年抽题许愿瓶', `
  <path d="M96 58 h28 v18 c18 10 30 32 30 58 0 34-19 60-44 60 s-44-26-44-60 c0-26 12-48 30-58 Z" fill="${P.P1}" opacity=".16"/>
  <path d="M96 58 h28 v18 c18 10 30 32 30 58 0 34-19 60-44 60 s-44-26-44-60 c0-26 12-48 30-58 Z" fill="none" stroke="${P.G2}" stroke-opacity=".7" stroke-width="2.2"/>
  <path d="M82 130 c-6 16-8 32-6 46" fill="none" stroke="${P.G1}" stroke-opacity=".35" stroke-width="5" stroke-linecap="round"/>
  <rect x="92" y="40" width="36" height="20" rx="5" fill="url(#wood)"/>
  <rect x="92" y="40" width="36" height="20" rx="5" fill="none" stroke="${P.G2}" stroke-opacity=".5" stroke-width="1.6"/>
  <ellipse cx="110" cy="188" rx="38" ry="10" fill="${P.G3}" opacity=".35"/>
  <g opacity=".95">
    <use href="#spark" transform="translate(98 152) scale(.7)"/>
    <use href="#spark" transform="translate(124 168) scale(.5)"/>
    <use href="#spark" transform="translate(106 178) scale(.42)"/>
    <use href="#spark" transform="translate(130 138) scale(.38)"/>
  </g>
  <path d="M110 96 C104 116 116 126 110 146" fill="none" stroke="${P.G1}" stroke-opacity=".4" stroke-width="1.8" stroke-dasharray="4 5"/>`, { ground: 64 }),

  // 元旦 · 新历卷轴（描金轴头 + 日期条）
  yuandan: () => wrap('元旦抽题新历卷轴', `
  <rect x="60" y="64" width="100" height="140" rx="8" fill="url(#paper)" stroke="${P.G2}" stroke-opacity=".6" stroke-width="2"/>
  ${S.inner(68, 72, 84, 124, 6, .5)}
  <rect x="52" y="54" width="116" height="14" rx="7" fill="url(#wood)"/>
  <rect x="52" y="200" width="116" height="14" rx="7" fill="url(#wood)"/>
  <g stroke="${P.INK}" stroke-opacity=".42" stroke-width="2" stroke-linecap="round">
    <path d="M80 96h60M80 116h60M80 136h60"/>
  </g>
  <circle cx="140" cy="96" r="6" fill="${P.R2}"/>
  ${S.fret(72, 182, 4, 20, .45)}
  ${S.cloud(110, 160, .6, .45)}
  <path d="M110 54 V38" stroke="${P.G2}" stroke-width="2.4"/>
  <circle cx="110" cy="34" r="5" fill="none" stroke="url(#goldX)" stroke-width="2.4"/>`, { ground: 64 }),

  // 平安夜 · 平安果（朱红苹果 + 描金叶 + 雪星）
  pinganye: () => wrap('平安夜抽题平安果', `
  <path d="M110 92 C86 76 52 86 50 124 C48 166 78 204 110 204 C142 204 172 166 170 124 C168 86 134 76 110 92 Z" fill="url(#redX)"/>
  <path d="M110 92 C86 76 52 86 50 124 C48 166 78 204 110 204 C142 204 172 166 170 124 C168 86 134 76 110 92 Z" fill="none" stroke="${P.G2}" stroke-opacity=".5" stroke-width="2"/>
  <path d="M76 118 C66 142 70 172 84 190" fill="none" stroke="${P.G1}" stroke-opacity=".3" stroke-width="9" stroke-linecap="round"/>
  <path d="M141 106 C154 128 154 158 143 182" fill="none" stroke="${P.W3}" stroke-opacity=".28" stroke-width="10" stroke-linecap="round"/>
  <path d="M110 92 C110 76 112 64 118 54" stroke="${P.W2}" stroke-width="3.4" stroke-linecap="round"/>
  <path d="M116 62 C130 50 148 52 158 60 C146 76 128 76 116 62 Z" fill="${P.OK}" opacity=".9"/>
  <path d="M116 62 C130 50 148 52 158 60" fill="none" stroke="${P.G1}" stroke-opacity=".5" stroke-width="1.6"/>
  ${S.cloud(110, 150, .78, .4)}
  <g opacity=".85">${S.flake(58, 96, 10, .6)}${S.flake(166, 176, 8, .5)}</g>`, { ground: 66 }),

  // 圣诞节 · 圣诞袜（朱红袜 + 描金回纹 + 雪松）
  shengdanjie: () => wrap('圣诞节抽题圣诞袜', `
  <path d="M84 70 h52 v66 c0 24 12 34 12 52 0 16-14 26-34 26 -22 0-36-12-36-30 0-16 6-24 6-40 Z" fill="url(#red)"/>
  <path d="M84 70 h52 v66 c0 24 12 34 12 52 0 16-14 26-34 26 -22 0-36-12-36-30 0-16 6-24 6-40 Z" fill="none" stroke="${P.G2}" stroke-opacity=".55" stroke-width="2"/>
  <rect x="80" y="58" width="60" height="22" rx="8" fill="url(#paper)" stroke="${P.G2}" stroke-opacity=".6" stroke-width="1.8"/>
  ${S.fret(92, 74, 2, 20, .5)}
  <path d="M92 92 C88 128 84 152 80 172" fill="none" stroke="${P.G1}" stroke-opacity=".26" stroke-width="6" stroke-linecap="round"/>
  <g transform="translate(128 140) rotate(-6)">
    <rect x="-18" y="-18" width="36" height="36" rx="5" fill="url(#paper)" stroke="${P.G2}" stroke-opacity=".6" stroke-width="1.6"/>
    <path d="M-18 0 h36M0 -18 v36" stroke="${P.R2}" stroke-opacity=".85" stroke-width="5"/>
  </g>
  ${S.flake(60, 106, 11, .7)}
  <path d="M170 92 C160 108 152 128 150 148" fill="none" stroke="${P.OK}" stroke-opacity=".8" stroke-width="2.6" stroke-linecap="round"/>`, { ground: 62 }),

  // 情人节 · 心形盒（朱红心盒 + 描金边 + 绸结）
  qingrenjie: () => wrap('情人节抽题心形盒', `
  <path d="M110 206 C110 206 56 172 56 128 C56 100 78 82 100 88 C106 90 110 94 110 100 C110 94 114 90 120 88 C142 82 164 100 164 128 C164 172 110 206 110 206 Z" fill="url(#red)"/>
  <path d="M110 206 C110 206 56 172 56 128 C56 100 78 82 100 88 C106 90 110 94 110 100 C110 94 114 90 120 88 C142 82 164 100 164 128 C164 172 110 206 110 206 Z" fill="none" stroke="${P.G2}" stroke-opacity=".6" stroke-width="2.2"/>
  <path d="M74 124 C66 146 74 172 92 188" fill="none" stroke="${P.G1}" stroke-opacity=".28" stroke-width="8" stroke-linecap="round"/>
  <path d="M56 122 C74 132 146 132 164 122" fill="none" stroke="${P.G2}" stroke-opacity=".6" stroke-width="2"/>
  ${S.bow(110, 116, .78)}
  ${S.tassel(150, 160, 26)}`, { ground: 62 }),

  // 妇女节 · 康乃馨花束（描金包纸 + 花 + 丝带）
  funvjie: () => wrap('妇女节抽题康乃馨', `
  <path d="M80 138 L140 138 L124 206 L96 206 Z" fill="url(#paper)" stroke="${P.G2}" stroke-opacity=".55" stroke-width="2"/>
  <path d="M86 144 L96 200M134 144 L124 200" stroke="${P.G2}" stroke-opacity=".35" stroke-width="1.6"/>
  ${S.fret(98, 200, 2, 20, .4)}
  <g stroke="${P.OK}" stroke-opacity=".75" stroke-width="2.6" fill="none" stroke-linecap="round">
    <path d="M108 140 C96 110 88 94 78 80"/><path d="M110 140 C114 108 118 90 122 72"/><path d="M112 140 C126 112 138 98 150 86"/>
  </g>
  ${S.flower(76, 74, 32, 8, P.R1, P.G1)}
  ${S.flower(122, 64, 30, 8, P.R2, P.G1)}
  ${S.flower(152, 80, 27, 8, P.R1, P.G1)}
  ${S.bow(110, 146, .66)}
  ${S.tassel(110, 156, 22)}`, { ground: 62 }),

  // 植树节 · 树苗与铁锹（描金树 + 土堆）
  zhishujie: () => wrap('植树节抽题树苗', `
  <ellipse cx="110" cy="204" rx="58" ry="14" fill="${P.W2}" opacity=".5"/>
  <ellipse cx="110" cy="200" rx="50" ry="11" fill="url(#wood)" opacity=".85"/>
  <path d="M110 200 V120" stroke="${P.W2}" stroke-width="7" stroke-linecap="round"/>
  <path d="M110 200 V120" stroke="${P.G2}" stroke-opacity=".45" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M110 152 C94 140 78 136 62 138 C70 156 90 166 110 160 Z" fill="url(#leaf)" opacity=".92"/>
  <path d="M110 130 C126 118 144 116 160 120 C150 138 130 146 110 138 Z" fill="url(#leaf)" opacity=".92"/>
  <path d="M110 112 C104 84 100 64 102 44 C124 56 136 82 132 110 Z" fill="url(#leaf)" opacity=".92"/>
  <path d="M110 152 C94 140 78 136 62 138M110 130 C126 118 144 116 160 120" fill="none" stroke="${P.G1}" stroke-opacity=".4" stroke-width="1.6"/>
  <g transform="translate(158 176) rotate(20)">
    <path d="M0 0 h34" stroke="${P.W1}" stroke-width="6" stroke-linecap="round"/>
    <path d="M34 -14 C48 -12 52 0 48 12 C38 16 30 10 30 0 Z" fill="url(#gold)"/>
  </g>
  ${S.fret(70, 196, 3, 20, .38)}`, { ground: 66 }),

  // 愚人节 · 笑脸面具（描金纸面具 + 笑眼 + 红颊）
  yurenjie: () => wrap('愚人节抽题面具', `
  <path d="M110 60 C150 60 170 88 168 128 C166 168 146 204 110 204 C74 204 54 168 52 128 C50 88 70 60 110 60 Z" fill="url(#paper)" stroke="${P.G2}" stroke-opacity=".6" stroke-width="2.2"/>
  <path d="M110 60 C92 60 76 72 68 92" fill="none" stroke="${P.G1}" stroke-opacity=".5" stroke-width="2.4" stroke-linecap="round"/>
  <g fill="none" stroke="${P.INK}" stroke-opacity=".62" stroke-width="3" stroke-linecap="round">
    <path d="M78 118 C84 108 94 108 100 118"/><path d="M120 118 C126 108 136 108 142 118"/>
  </g>
  <circle cx="72" cy="146" r="11" fill="${P.R2}" opacity=".38"/>
  <circle cx="148" cy="146" r="11" fill="${P.R2}" opacity=".38"/>
  <path d="M92 164 C102 178 118 178 128 164" fill="none" stroke="${P.INK}" stroke-opacity=".62" stroke-width="3.4" stroke-linecap="round"/>
  ${S.cloud(110, 100, .5, .4)}
  <path d="M64 76 C56 66 50 54 50 42M156 76 C164 66 170 54 170 42" fill="none" stroke="${P.G2}" stroke-opacity=".6" stroke-width="2.4" stroke-linecap="round"/>
  ${S.flower(50, 40, 12, 5, P.G1, P.R2)}
  ${S.flower(170, 40, 12, 5, P.G1, P.R2)}`, { ground: 60 }),

  // 劳动节 · 锤子扳手（描金工具 + 红绸带）：不做交叉 X（交叉后两件都读不出），改为并立两支
  laodongjie: () => wrap('劳动节抽题工具', `
  <!-- 扳手（右）：柄 + 开口钳嘴 -->
  <g transform="translate(140 132) rotate(12)">
    <rect x="-7" y="-56" width="14" height="104" rx="7" fill="url(#gold)"/>
    <path d="M-16 -78 C-16 -92 -6 -100 0 -100 C6 -100 16 -92 16 -78 L9 -62 C6 -70 -6 -70 -9 -62 Z" fill="url(#gold)" stroke="${P.G1}" stroke-opacity=".5" stroke-width="1.6"/>
    <path d="M-6 -78 C-4 -86 4 -86 6 -78" fill="none" stroke="${P.W3}" stroke-opacity=".6" stroke-width="3"/>
    <path d="M-5 -50 h10M-5 -30 h10M-5 -10 h10" stroke="${P.G3}" stroke-opacity=".5" stroke-width="1.6"/>
    <path d="M-4 -44 C-4 20 -2 40 0 46" fill="none" stroke="${P.G1}" stroke-opacity=".45" stroke-width="3" stroke-linecap="round"/>
  </g>
  <!-- 锤子（左）：木柄 + 描金锤头 -->
  <g transform="translate(82 136) rotate(-12)">
    <rect x="-6" y="-44" width="12" height="96" rx="6" fill="url(#wood)"/>
    <rect x="-6" y="-44" width="12" height="96" rx="6" fill="none" stroke="${P.G1}" stroke-opacity=".3" stroke-width="1.4"/>
    <path d="M-30 -58 h60 c6 0 8 4 8 9 v12 c0 5-2 9-8 9 h-60 Z" fill="url(#gold)" stroke="${P.G1}" stroke-opacity=".5" stroke-width="1.8"/>
    <path d="M-30 -49 h60" stroke="${P.G3}" stroke-opacity=".45" stroke-width="2"/>
    <path d="M22 -58 C30 -54 32 -44 30 -38" fill="none" stroke="${P.G1}" stroke-opacity=".5" stroke-width="2"/>
  </g>
  ${S.bow(110, 66, .72)}
  <path d="M110 76 C104 96 100 116 100 132" fill="none" stroke="${P.R2}" stroke-opacity=".8" stroke-width="2.6" stroke-linecap="round"/>
  ${S.fret(78, 198, 4, 20, .4)}`, { ground: 66 }),

  // 青年节 · 火炬（描金炬柄 + 朱红火焰）
  qingnianjie: () => wrap('青年节抽题火炬', `
  <ellipse cx="110" cy="96" rx="60" ry="62" fill="url(#warm)" opacity=".75"/>
  <path d="M104 74 C96 92 84 98 88 118 C92 134 104 142 110 146 C116 142 128 134 132 118 C136 98 124 92 116 74 C114 82 108 84 104 74 Z" fill="url(#red)"/>
  <path d="M110 92 C104 104 100 114 104 124 C108 132 114 134 118 128 C124 118 118 104 110 92 Z" fill="${P.MOON}" opacity=".9"/>
  <path d="M64 148 h92 l-8 14 h-76 Z" fill="url(#gold)"/>
  <path d="M66 162 h88 l-6 10 h-76 Z" fill="${P.G3}" opacity=".75"/>
  <rect x="100" y="172" width="20" height="34" rx="6" fill="url(#wood)"/>
  ${S.fret(102, 200, 1, 20, .5)}
  <g stroke="${P.G1}" stroke-opacity=".6" stroke-width="2" stroke-linecap="round">
    <path d="M84 130 C74 122 70 110 72 98"/><path d="M136 130 C146 122 150 110 148 98"/>
  </g>`, { ground: 58 }),

  // 母亲节 · 花盒（描金花盒 + 康乃馨）
  muqinjie: () => wrap('母亲节抽题花盒', `
  <rect x="64" y="140" width="92" height="60" rx="8" fill="url(#red)"/>
  <rect x="64" y="140" width="92" height="60" rx="8" fill="none" stroke="${P.G2}" stroke-opacity=".55" stroke-width="2"/>
  <path d="M72 148 C76 172 78 186 78 192" fill="none" stroke="${P.G1}" stroke-opacity=".22" stroke-width="6" stroke-linecap="round"/>
  ${S.fret(74, 190, 4, 20, .4)}
  <ellipse cx="110" cy="140" rx="46" ry="11" fill="${P.P2}"/>
  <ellipse cx="110" cy="140" rx="46" ry="11" fill="none" stroke="url(#goldX)" stroke-width="3.6"/>
  <g stroke="${P.OK}" stroke-opacity=".7" stroke-width="2.4" fill="none" stroke-linecap="round">
    <path d="M96 136 C92 118 86 106 78 96"/><path d="M110 136 C110 116 110 100 112 88"/><path d="M124 136 C130 118 138 106 146 98"/>
  </g>
  ${S.flower(78, 92, 24, 7, P.R1, P.G1)}
  ${S.flower(112, 84, 26, 7, P.R2, P.G1)}
  ${S.flower(146, 94, 22, 7, P.R1, P.G1)}
  ${S.bow(110, 132, .5)}`, { ground: 62 }),

  // 儿童节 · 纸飞机（宣纸飞机 + 折线 + 云）
  ertongjie: () => wrap('儿童节抽题纸飞机', `
  <g transform="translate(112 130) rotate(-14)">
    <path d="M-64 6 L58 -34 L18 26 L4 12 Z" fill="url(#paper)" stroke="${P.G2}" stroke-opacity=".6" stroke-width="2"/>
    <path d="M-64 6 L58 -34 L4 12 Z" fill="${P.P2}" opacity=".8"/>
    <path d="M4 12 L18 26 L14 34 L-2 22 Z" fill="${P.P3}"/>
    <path d="M-64 6 L58 -34M4 12 L8 44" fill="none" stroke="${P.G2}" stroke-opacity=".7" stroke-width="1.8"/>
    <path d="M-40 -6 L34 -28" stroke="${P.R2}" stroke-opacity=".55" stroke-width="2.4" stroke-linecap="round"/>
  </g>
  ${S.cloud(58, 190, .8, .5)}
  <g stroke="${P.G1}" stroke-opacity=".5" stroke-width="2" fill="none" stroke-linecap="round">
    <path d="M150 168 C164 166 176 172 182 182"/><path d="M154 186 C166 186 176 192 180 200"/>
  </g>`, { ground: 58 }),

  // 父亲节 · 茶盏（描金瓷盏 + 茶烟 + 竹叶）
  fuqinjie: () => wrap('父亲节抽题茶盏', `
  <path d="M72 128 C72 176 90 200 110 200 C130 200 148 176 148 128 Z" fill="url(#paper)" stroke="${P.G2}" stroke-opacity=".6" stroke-width="2"/>
  <path d="M78 134 C76 168 84 188 94 196" fill="none" stroke="${P.G1}" stroke-opacity=".5" stroke-width="5" stroke-linecap="round"/>
  <ellipse cx="110" cy="128" rx="38" ry="10" fill="${P.W2}" opacity=".55"/>
  <ellipse cx="110" cy="128" rx="38" ry="10" fill="none" stroke="url(#goldX)" stroke-width="4"/>
  <ellipse cx="110" cy="128" rx="30" ry="7" fill="#6B4423" opacity=".7"/>
  ${S.fret(88, 192, 2, 20, .45)}
  <ellipse cx="110" cy="208" rx="44" ry="9" fill="url(#wood)"/>
  <ellipse cx="110" cy="206" rx="44" ry="9" fill="none" stroke="${P.G1}" stroke-opacity=".35" stroke-width="1.6"/>
  <g fill="none" stroke="${P.G1}" stroke-opacity=".4" stroke-width="2.4" stroke-linecap="round">
    <path d="M100 110 C96 94 104 84 100 66"/><path d="M122 108 C118 92 126 82 122 64"/>
  </g>
  <path d="M56 116 C60 96 76 84 96 78 C92 100 76 116 56 116 Z" fill="url(#leaf)" opacity=".92"/>
  <path d="M58 114 C72 102 84 90 94 80" fill="none" stroke="${P.G1}" stroke-opacity=".5" stroke-width="1.6"/>
  <path d="M56 118 C66 122 76 122 84 118" fill="none" stroke="${P.W2}" stroke-width="2.2" stroke-linecap="round"/>`, { ground: 60 }),

  // 建党节 · 红旗（朱红旗面 + 描金旗杆 + 镰锤）
  jiandangjie: () => wrap('建党节抽题红旗', `
  <path d="M86 44 V210" stroke="${P.W1}" stroke-width="6" stroke-linecap="round"/>
  <path d="M86 44 V210" stroke="${P.G1}" stroke-opacity=".4" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="86" cy="40" r="7" fill="url(#gold)"/>
  <path d="M86 54 C110 46 130 62 152 54 C162 50 170 52 176 58 V152 C170 146 162 144 152 148 C130 156 110 140 86 148 Z" fill="url(#red)"/>
  <path d="M86 54 C110 46 130 62 152 54 C162 50 170 52 176 58 V152 C170 146 162 144 152 148 C130 156 110 140 86 148 Z" fill="none" stroke="${P.G2}" stroke-opacity=".6" stroke-width="2"/>
  <g transform="translate(128 96) scale(.92)">
    <!-- 镰刀：月牙刃（左） + 柄（斜向右下） -->
    <path d="M-36 8 C-36 -18 -14 -36 14 -34 C-2 -26 -14 -14 -18 0 C-21 10 -20 22 -16 30 C-28 26 -36 18 -36 8 Z" fill="url(#gold)"/>
    <path d="M-16 30 L20 16" stroke="url(#gold)" stroke-width="7.5" stroke-linecap="round"/>
    <path d="M-16 30 L20 16" stroke="${P.G1}" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/>
    <!-- 锤子：锤头（右上） + 柄（斜向左下） -->
    <path d="M8 -34 h32 l-5 13 h-32 Z" fill="url(#gold)" stroke="${P.G1}" stroke-opacity=".35" stroke-width="1.2"/>
    <path d="M12 8 L30 -24" stroke="url(#gold)" stroke-width="8" stroke-linecap="round"/>
    <path d="M12 8 L30 -24" stroke="${P.G1}" stroke-opacity=".35" stroke-width="2.4" stroke-linecap="round"/>
  </g>
  <path d="M96 126 C112 132 140 130 162 122" fill="none" stroke="${P.G1}" stroke-opacity=".28" stroke-width="2.4"/>`, { ground: 60 }),

  // 建军节 · 军号与红星（描金军号 + 红绸 + 星）
  jianjunjie: () => wrap('建军节抽题军号', `
  <g transform="translate(104 150) rotate(-10)">
    <!-- 号管（左细右粗） -->
    <path d="M-70 -6 C-56 -14 -34 -18 -8 -19 L-8 13 C-34 12 -56 8 -70 2 Z" fill="url(#gold)"/>
    <path d="M-70 -6 C-56 -14 -34 -18 -8 -19" fill="none" stroke="${P.G1}" stroke-opacity=".6" stroke-width="1.8"/>
    <!-- 号口（喇叭，开口向右上） -->
    <path d="M-8 -19 C14 -24 44 -34 66 -50 C82 -30 82 4 64 22 C42 8 14 -2 -8 13 Z" fill="url(#gold)"/>
    <path d="M-8 -19 C14 -24 44 -34 66 -50" fill="none" stroke="${P.G1}" stroke-opacity=".6" stroke-width="2"/>
    <path d="M64 22 C74 6 74 -18 66 -50" fill="none" stroke="${P.G3}" stroke-opacity=".55" stroke-width="2.4"/>
    <ellipse cx="66" cy="-15" rx="7" ry="34" fill="${P.W3}" opacity=".35" transform="rotate(24 66 -15)"/>
    <!-- 号嘴 -->
    <rect x="-88" y="-12" width="20" height="20" rx="9" fill="url(#gold)" stroke="${P.G1}" stroke-opacity=".5" stroke-width="1.6"/>
    <!-- 活塞与握把 -->
    <path d="M-40 -16 v-14M-22 -18 v-18" stroke="url(#gold)" stroke-width="6" stroke-linecap="round"/>
    <path d="M-32 -30 h22" stroke="url(#gold)" stroke-width="5" stroke-linecap="round"/>
    <path d="M-56 6 C-46 16 -30 22 -14 22" fill="none" stroke="${P.G1}" stroke-opacity=".45" stroke-width="2"/>
  </g>
  <path d="M60 176 C76 184 100 182 116 172" fill="none" stroke="url(#red)" stroke-width="4.2" stroke-linecap="round"/>
  ${S.tassel(58, 138, 22)}
  <g transform="translate(168 92)">
    <path d="M-22 0 C-18 -15 -5 -24 0 -24 C5 -24 18 -15 22 0 C16 13 5 19 0 19 C-5 19 -16 13 -22 0 Z" fill="none" stroke="${P.G2}" stroke-opacity=".5" stroke-width="2"/>
    <g transform="translate(0 -5)">${S.star(0, 0, 19)}</g>
  </g>
  ${S.fret(78, 198, 4, 20, .4)}`, { ground: 64 }),

  // 教师节 · 书册与毛笔（描金书 + 朱红书签 + 笔）
  jiaoshijie: () => wrap('教师节抽题书册', `
  <rect x="56" y="120" width="108" height="82" rx="6" fill="url(#red)"/>
  <rect x="56" y="120" width="108" height="82" rx="6" fill="none" stroke="${P.G2}" stroke-opacity=".55" stroke-width="2"/>
  <rect x="66" y="112" width="98" height="72" rx="5" fill="url(#paper)" stroke="${P.G2}" stroke-opacity=".6" stroke-width="1.8"/>
  ${S.inner(74, 120, 82, 56, 4, .45)}
  ${S.fret(66, 194, 4, 20, .4)}
  <g stroke="${P.INK}" stroke-opacity=".4" stroke-width="2" stroke-linecap="round">
    <path d="M84 136h62M84 148h54M84 160h44"/>
  </g>
  <path d="M148 112 V168 L140 158 L132 168 V112 Z" fill="url(#gold)"/>
  <g transform="translate(70 92) rotate(-24)">
    <rect x="0" y="-8" width="66" height="12" rx="6" fill="url(#wood)"/>
    <rect x="0" y="-8" width="66" height="12" rx="6" fill="none" stroke="${P.G1}" stroke-opacity=".35" stroke-width="1.4"/>
    <path d="M0 -8 C-8 -6 -14 0 -16 8 C-8 14 -2 12 2 4 Z" fill="${P.INK}" opacity=".85"/>
  </g>
  <path d="M92 106 C88 122 82 134 72 142" fill="none" stroke="${P.G1}" stroke-opacity=".3" stroke-width="2"/>`, { ground: 64 }),

  // 万圣节 · 南瓜灯（暖橘南瓜 + 烛光笑脸）
  wanshengjie: () => wrap('万圣节抽题南瓜灯', `
  <ellipse cx="110" cy="148" rx="68" ry="60" fill="url(#warm)" opacity=".85"/>
  <path d="M64 148 C64 104 84 78 110 78 C136 78 156 104 156 148 C156 186 136 206 110 206 C84 206 64 186 64 148 Z" fill="url(#pump)"/>
  <path d="M88 82 C76 108 70 132 72 160 C73 180 79 194 88 202" fill="none" stroke="#8A3F12" stroke-opacity=".5" stroke-width="2.8"/>
  <path d="M132 82 C144 108 150 132 148 160 C147 180 141 194 132 202" fill="none" stroke="#8A3F12" stroke-opacity=".5" stroke-width="2.8"/>
  <path d="M70 92 C64 120 66 156 78 184" fill="none" stroke="${P.G1}" stroke-opacity=".3" stroke-width="7" stroke-linecap="round"/>
  <path d="M110 78 C110 66 112 58 116 50" stroke="${P.OK}" stroke-width="4.4" stroke-linecap="round"/>
  <path d="M116 52 C130 42 146 44 154 54 C142 66 126 64 116 52 Z" fill="url(#leaf)" opacity=".92"/>
  <ellipse cx="110" cy="158" rx="34" ry="26" fill="${P.MOON}" opacity=".22"/>
  <g fill="${P.MOON}">
    <path d="M84 124 L106 140 L84 152 Z"/><path d="M136 124 L114 140 L136 152 Z"/>
    <path d="M90 166 L98 158 L104 168 L110 158 L116 168 L122 158 L130 166 L126 180 C116 184 100 184 94 180 Z"/>
  </g>
  <path d="M110 78 V206" stroke="#8A3F12" stroke-opacity=".35" stroke-width="2"/>
  ${S.fret(76, 198, 4, 20, .4)}`, { ground: 70 }),

  // 国庆 · 盘面（可旋转层：12 扇格 + 描金外圈 + 中心五角星）
  // 几何必须与底座一致：圆心 (110,132)、半径 86；CSS .view-draw-prop-disc 的旋转轴 50% 53% 依赖此圆心
  guoqingDisc: () => {
    const CX = 110, CY = 132, R = 86;
    const seg = [];
    for (let i = 0; i < 12; i++) {
      const a0 = (i * Math.PI) / 6, a1 = ((i + 1) * Math.PI) / 6;
      const x0 = (Math.cos(a0) * R).toFixed(1), y0 = (Math.sin(a0) * R).toFixed(1);
      const x1 = (Math.cos(a1) * R).toFixed(1), y1 = (Math.sin(a1) * R).toFixed(1);
      seg.push(`<path d="M0 0L${x0} ${y0}A${R} ${R} 0 0 1 ${x1} ${y1}Z" fill="${i % 2 ? P.R4 : P.G2}" fill-opacity="${i % 2 ? '.92' : '.28'}" stroke="${P.G1}" stroke-opacity=".22" stroke-width="1.2"/>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 260" width="220" height="260" role="img" aria-label="国庆抽题转盘盘面">
  <!-- 国庆转盘·旋转层（只转这一层；指针与底座在另一张图） -->
  ${DEFS}
  <g transform="translate(${CX} ${CY})">
    ${seg.join('')}
    <circle r="${R}" fill="none" stroke="url(#goldX)" stroke-width="6"/>
    <circle r="${R - 13}" fill="none" stroke="${P.G1}" stroke-opacity=".35" stroke-width="1.6"/>
    ${S.fret(-40, -R + 26, 4, 20, .35)}
    <circle r="25" fill="url(#red)" stroke="${P.G2}" stroke-opacity=".7" stroke-width="2.6"/>
    <g transform="translate(0 -1) scale(1.3)">${S.star(0, 0, 20, 'url(#gold)')}</g>
    <g transform="translate(0 ${-R + 17}) scale(.5)">${S.star(0, 0, 20)}</g>
    <g transform="translate(0 ${R - 17}) scale(.5)">${S.star(0, 0, 20)}</g>
  </g>
</svg>`;
  },

  // 国庆 · 底座（静止层：顶部星形指针 + 立柱 + 底座 + 月晕/地面）
  guoqingBase: () => {
    const CX = 110, CY = 132, R = 86;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 260" width="220" height="260" role="img" aria-label="国庆抽题转盘指针与底座">
  <!-- 国庆转盘·静止层（指针与底座不随盘面转动） -->
  ${DEFS}
  ${S.halo(112)}
  ${S.sparks(.9)}
  <g transform="translate(${CX} ${CY})">
    <!-- 立柱与底座落在盘面下缘之外（盘面 r=86，底缘 y=218），故从 +88 起画，保证可见 -->
    <path d="M-14 88 h28 v14 h-28 Z" fill="url(#gold)"/>
    <path d="M-14 88 h28" stroke="${P.G1}" stroke-opacity=".55" stroke-width="2"/>
    <rect x="-34" y="102" width="68" height="15" rx="7" fill="url(#gold)"/>
    <rect x="-34" y="102" width="68" height="15" rx="7" fill="none" stroke="${P.G1}" stroke-opacity=".5" stroke-width="1.8"/>
    <ellipse cy="122" rx="42" ry="9" fill="${P.SH}" opacity=".45"/>
    ${S.fret(-30, 114, 3, 20, .45)}
    <!-- 顶部星形指针（尖端朝下指向盘面） -->
    <g transform="translate(0 ${-R - 12})">
      <path d="M0 26l-24-52h48z" fill="url(#red)" stroke="${P.G2}" stroke-opacity=".75" stroke-width="2.6" stroke-linejoin="round"/>
      <g transform="translate(0 -28) scale(1.25)">${S.star(0, 0, 20)}</g>
    </g>
  </g>
  ${S.ground(62)}
</svg>`;
  },
};

// ── 文件名 ↔ 主体 键（必须与 样式-主题-theme.css 的 url 完全一致）──
const FILES = {
  chuxi: '除夕-chuxi', chunjie: '春节-chunjie', zhongqiu: '中秋-zhongqiu', duanwu: '端午-duanwu',
  yuanxiao: '元宵-yuanxiao', qixi: '七夕-qixi', chongyang: '重阳-chongyang', laba: '腊八-laba',
  qingming: '清明-qingming', kuannian: '跨年-kuannian', yuandan: '元旦-yuandan', pinganye: '平安夜-pinganye',
  shengdanjie: '圣诞节-shengdanjie', qingrenjie: '情人节-qingrenjie', funvjie: '妇女节-funvjie',
  zhishujie: '植树节-zhishujie', yurenjie: '愚人节-yurenjie', laodongjie: '劳动节-laodongjie',
  qingnianjie: '青年节-qingnianjie', muqinjie: '母亲节-muqinjie', ertongjie: '儿童节-ertongjie',
  fuqinjie: '父亲节-fuqinjie', jiandangjie: '建党节-jiandangjie', jianjunjie: '建军节-jianjunjie',
  jiaoshijie: '教师节-jiaoshijie', wanshengjie: '万圣节-wanshengjie',
  guoqingDisc: '国庆-转盘面-guoqing-disc', guoqingBase: '国庆-转盘座-guoqing-base',
};

let n = 0;
for (const [key, name] of Object.entries(FILES)) {
  const svg = SUBJECTS[key]();
  fs.writeFileSync(path.join(OUT, `${name}.svg`), svg, 'utf8');
  n++;
}
console.log(`已重绘 ${n} 件道具 → ${OUT}`);
console.log(`目录现有 ${fs.readdirSync(OUT).filter((f) => f.endsWith('.svg')).length} 个 SVG`);
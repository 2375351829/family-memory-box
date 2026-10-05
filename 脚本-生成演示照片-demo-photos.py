# -*- coding: utf-8 -*-
"""脚本-生成演示照片-demo-photos.py · 家庭回忆话题盒子

用途：为扩充版演示数据集生成 8 张老照片素材，输出到项目内 演示照片-demo-photos/
     （该目录已在 .gitignore 中忽略，属可再生资产；由 演示数据集-demo-dataset.py 读取灌库）。
规格：长边 ≥ 2000px、2–5MB jpg；泛化场景，**不出现真人面部**（隐私风险最低）。

两条产出通道：
  1) 在线通道（默认）：调用 text_to_image 异步生成——首次请求返回占位图，
     需轮询重取同一 URL 直到字节数变化；每张时限 --wait 秒，超时则对该张改用离线兜底。
  2) 离线兜底（--offline 全部走此通道）：本地 PIL 合成做旧质感卡（渐变底 + 做旧噪点/暗角 +
     白边印刷框 + 中文说明），保证断网或接口不可用时也能产出 8 张可用素材。

用法：
  python 脚本-生成演示照片-demo-photos.py              # 在线优先，逐张超时兜底
  python 脚本-生成演示照片-demo-photos.py --offline     # 全部离线生成
"""
import argparse
import json
import os
import time
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '演示照片-demo-photos')
API = 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt={p}&image_size={s}'

# (源文件名, image_size, 提示词, 离线兜底卡中文说明)
PHOTOS = [
    ('demo-first-computer.jpg', 'landscape_4_3',
     'early 2000s Chinese home desk with an old beige desktop computer and CRT monitor, a framed family photo beside it, warm indoor light, nostalgic photograph, no people',
     '家里第一台电脑 · 2005'),
    ('demo-2008-dinner.jpg', 'landscape_4_3',
     'Chinese family Mid-Autumn reunion dinner table at home, home-cooked dishes, mooncakes and tea, warm lamp light in an old apartment, nostalgic film photograph, no people',
     '2008 年中秋的一桌菜'),
    ('demo-harbin-snow.jpg', 'landscape_4_3',
     'Harbin residential street in heavy winter snow, thick fresh snow, footprints, red lanterns on poles, cold blue morning light, photograph, no people',
     '2009 年哈尔滨的雪'),
    ('demo-sewing-machine.jpg', 'portrait_4_3',
     'vintage Chinese Butterfly brand treadle sewing machine in a living room corner with a potted plant on top, warm afternoon light, nostalgic photograph, no people',
     '那台蝴蝶牌缝纫机'),
    ('demo-expo-2010.jpg', 'landscape_4_3',
     'Shanghai World Expo China Pavilion, huge red inverted pyramid architecture, sunny blue sky, blurred crowd in the distance, vivid travel photograph',
     '上海世博会的中国馆 · 2010'),
    ('demo-taro-pork.jpg', 'landscape_4_3',
     'Chinese braised pork with taro in a black ceramic bowl, steam rising, wooden dining table, warm light, appetizing close-up food photography',
     '奶奶做的芋头扣肉'),
    ('demo-old-kitchen.jpg', 'portrait_4_3',
     'old Chinese farmhouse kitchen with a south-facing window, enamel basin and bamboo cutting board on the counter, sunlight streaming in with dust motes, documentary photograph, no people',
     '老房子厨房的那扇窗'),
    ('demo-photo-wall.jpg', 'portrait_4_3',
     'wall covered with old framed family photographs in a Chinese living room, warm afternoon light, faded paper and wooden frames, nostalgic, no people',
     '金婚那天挂起来的老照片 · 2024'),
]

# 离线兜底卡配色（做旧暖调，逐张轮换）
PALETTES = [
    ((214, 195, 165), (166, 140, 106)),
    ((206, 190, 158), (150, 128, 96)),
    ((198, 205, 212), (140, 152, 162)),
    ((212, 196, 172), (158, 136, 104)),
    ((216, 186, 158), (168, 132, 100)),
    ((208, 178, 142), (152, 116, 84)),
    ((210, 198, 174), (154, 138, 108)),
    ((206, 188, 164), (148, 126, 98)),
]

FONT_CANDIDATES = [
    r'C:\Windows\Fonts\msyh.ttc',
    r'C:\Windows\Fonts\msyhbd.ttc',
    r'C:\Windows\Fonts\simhei.ttf',
    r'C:\Windows\Fonts\simsun.ttc',
]


def fetch(url, timeout=90):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def gen_until_ready(url, label, max_wait, interval=10):
    """触发生成并轮询重取；相同 image_size 下占位图字节数恒定，长度变化即视为成图。
    超时返回 None（由调用方改用离线兜底），不抛异常。"""
    blob = fetch(url)
    placeholder_len = len(blob)
    deadline = time.time() + max_wait
    while time.time() < deadline:
        time.sleep(interval)
        blob = fetch(url)
        if len(blob) != placeholder_len:
            return blob
        print('  %s: 仍在生成（占位图 %dB），等待中...' % (label, placeholder_len), flush=True)
    print('  %s: 在线生成超时（%ds），改用离线兜底' % (label, max_wait), flush=True)
    return None


def save_sized_jpg(raw_bytes, dst_path, min_edge=2000, lo=2 * 1024 * 1024, hi=5 * 1024 * 1024):
    tmp = dst_path + '.raw'
    with open(tmp, 'wb') as fh:
        fh.write(raw_bytes)
    im = Image.open(tmp).convert('RGB')
    w, h = im.size
    scale = max(min_edge / max(w, h), 1.0)
    im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    chosen = None
    for q in (95, 93, 91, 89, 87, 85):
        im.save(dst_path, 'JPEG', quality=q, optimize=True)
        size = os.path.getsize(dst_path)
        chosen = (size, im.size, q)
        if lo <= size <= hi or size < lo:
            break
    os.remove(tmp)
    return chosen


def _font(size):
    for p in FONT_CANDIDATES:
        if os.path.isfile(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def make_offline_card(dst_path, caption, portrait, idx, noise_level):
    """离线兜底：渐变底 + 柔光斑 + 白边印刷框 + 中文说明 + 做旧噪点/暗角"""
    w, h = (1500, 2000) if portrait else (2000, 1500)
    c1, c2 = PALETTES[idx % len(PALETTES)]
    im = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(im)
    # 1) 竖向渐变底
    for y in range(h):
        t = y / (h - 1)
        d.line([(0, y), (w, y)],
               fill=tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)))
    # 2) 柔光斑：制造「有画面」的错觉
    glow = Image.new('L', (w, h), 0)
    gd = ImageDraw.Draw(glow)
    gd.ellipse([w * 0.08, h * 0.10, w * 0.62, h * 0.52], fill=70)
    gd.ellipse([w * 0.44, h * 0.48, w * 0.96, h * 0.92], fill=52)
    glow = glow.filter(ImageFilter.GaussianBlur(min(w, h) // 5))
    im = Image.composite(Image.new('RGB', (w, h), (255, 250, 238)), im, glow)
    d = ImageDraw.Draw(im)
    # 3) 白边印刷框
    m = max(24, w // 40)
    d.rectangle([m, m, w - m, h - m], outline=(246, 241, 231), width=max(6, w // 150))
    # 4) 中文说明（居中，过长自动降字号）
    cap = caption
    size = int(h / 11)
    while size > 20:
        f = _font(size)
        box = d.textbbox((0, 0), cap, font=f)
        if box[2] - box[0] <= w * 0.78:
            break
        size -= 6
    f = _font(size)
    box = d.textbbox((0, 0), cap, font=f)
    d.text(((w - (box[2] - box[0])) / 2, (h - (box[3] - box[1])) / 2 - h * 0.03),
           cap, font=f, fill=(74, 60, 44))
    # 5) 角标：明确标注为演示数据（不冒充真实照片）
    fs = _font(int(h / 34))
    d.text((m * 1.6, h - m * 1.6 - int(h / 34)), '演示数据 · demo photo', font=fs, fill=(112, 96, 76))
    # 6) 做旧：噪点 + 暗角
    noise = Image.effect_noise((w, h), 20).convert('L')
    im = Image.blend(im, Image.merge('RGB', (noise, noise, noise)), noise_level)
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).ellipse([-w * 0.22, -h * 0.22, w * 1.22, h * 1.22], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(min(w, h) // 6))
    im = Image.composite(im, im.point(lambda v: int(v * 0.86)), mask)
    for q in (95, 92, 90, 88, 86):
        im.save(dst_path, 'JPEG', quality=q, optimize=True)
        if os.path.getsize(dst_path) >= 2 * 1024 * 1024:
            break
    return os.path.getsize(dst_path), im.size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--offline', action='store_true', help='跳过在线接口，全部离线生成')
    ap.add_argument('--wait', type=int, default=120, help='单张在线生成最长等待秒数')
    ap.add_argument('--force', action='store_true', help='已存在的文件也重新生成')
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    report = []
    for idx, (name, size_key, prompt, caption) in enumerate(PHOTOS):
        dst = os.path.join(OUT_DIR, name)
        if os.path.isfile(dst) and not args.force:
            print('已存在，跳过：%s' % name, flush=True)
            continue
        portrait = size_key.startswith('portrait')
        blob = None
        if not args.offline:
            url = API.format(p=urllib.parse.quote(prompt), s=size_key)
            try:
                fetch(url)                     # 触发
                blob = gen_until_ready(url, name, args.wait)
            except Exception as e:
                print('  %s: 在线通道异常（%s），改用离线兜底' % (name, e), flush=True)
        if blob is not None:
            size, dims, q = save_sized_jpg(blob, dst)
            src = '在线 text_to_image'
            report.append({'file': name, 'source': src, 'final_bytes': size,
                           'dims': '%dx%d' % dims, 'quality': q})
        else:
            size, dims = make_offline_card(dst, caption, portrait, idx, 0.07)
            src = '离线兜底'
            report.append({'file': name, 'source': src, 'final_bytes': size,
                           'dims': '%dx%d' % dims})
        print(json.dumps(report[-1], ensure_ascii=False), flush=True)
    print('DONE', flush=True)
    print(json.dumps(report, ensure_ascii=False, indent=1), flush=True)


if __name__ == '__main__':
    main()

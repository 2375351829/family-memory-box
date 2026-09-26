# -*- coding: utf-8 -*-
"""演示数据集灌数脚本 · 家庭回忆话题盒子

用途：把《截图计划》2.1 演示数据集（4 位家人 + 8 条故事 + 4 张老照片 + 1 条时间胶囊）
     通过备份导入接口一次性灌入，供 D4 拍摄共用（同一套数据，禁为拍照临时改数据）。
用法：python 演示数据集-demo-dataset.py [--photo-dir <目录>] [--api <base_url>]
说明：走 POST /api/import/json 覆盖式导入（含版本校验）；话题库 48 条内置话题与
     96 条追问从 l2-safenet 备份 JSON 原样保留，仅替换 members/stories/photos/capsules。
"""
import argparse
import base64
import json
import os
import urllib.request
import uuid

SAFENET = r'C:\Users\ZXYQQ\AppData\Local\Temp\l2-safenet-20260926-191411.json'
DEFAULT_PHOTO_DIR = r'C:\Users\ZXYQQ\AppData\Local\Temp\g3-photos'
DEFAULT_API = 'http://127.0.0.1:5000'

TS0 = '2026-09-26 20:30:00'   # 演示数据统一时间戳基线（逐条 +1 分钟，保证顺序稳定）
NEXT_MIDAUTUMN = '2027-09-15'  # 下一个中秋（2027-09-15，见开发计划 8.5 固定日期表）


def ts(i):
    # 分钟递增（13 条记录 i ≤ 12，分钟 30–42 不越界），保证 created_at 顺序稳定
    return '2026-09-26 20:%02d:00' % (30 + i)


# ── 演示数据集（截图计划 2.1）────────────────────────────────
MEMBERS = [
    {'id': 1, 'name': '李长海', 'relation': '爷爷', 'avatar_color': '#8E6B3E', 'sort_order': 0},
    {'id': 2, 'name': '李桂英', 'relation': '奶奶', 'avatar_color': '#C0392B', 'sort_order': 1},
    {'id': 3, 'name': '王秀兰', 'relation': '妈妈', 'avatar_color': '#B5739B', 'sort_order': 2},
    {'id': 4, 'name': '李念', 'relation': '我', 'avatar_color': '#3E8E5A', 'sort_order': 3},
]

# 8 条故事：讲述人 / 话题文本（按 text 精确匹配 topics）/ 内容 / 日期 / 追问作答（a 文案）/ 照片数
STORIES_SPEC = [
    {
        'member': 2, 'topic_text': '你小时候最怕谁？', 'date': '1965', 'photos': 3,
        'content': '最怕我爸。他跟别人家爹不一样，从来不吼也不打，就一句话不说地瞪着你，瞪得我心里直发毛，比挨打还吓人。有一回我偷摘了生产队的瓜，他知道了，晚饭一句话没说，我扒了两口饭眼泪就掉下来了。',
        'answers': ['他为什么不说话的时候最可怕？', '答：不知道他要怎么罚你，心里没底。不说话的时候，脑子里能把所有后果都想一遍。', '现在还怕他吗？', '答：不恨，是想他。他走的那年我五十岁，才明白他那双眼睛里装的是什么。'],
    },
    {
        'member': 1, 'topic_text': '第一次拿到零花钱买了什么？', 'date': '1962', 'photos': 0,
        'content': '两分钱。攥在手心里都出汗了，跑到供销社买了三颗水果糖，橘子味儿的。自己一颗都没舍得吃，全给了妹妹，看她鼓着腮帮子的样子，比自己吃了还甜。',
        'answers': [],
    },
    {
        'member': 3, 'topic_text': '小时候过中秋，和现在最大的不同是什么？', 'date': '1988', 'photos': 1,
        'content': '那时候一块月饼切八瓣，一家人分，我总抢到带冰糖的那一角。院子里摆一张小桌，月光先敬过，才轮到我们。现在月饼多了，什么样的都有，人反而凑不齐了。',
        'answers': ['那年中秋印象最深的一个细节？', '答：我爸把月饼渣也倒在手心舔干净，说糟蹋粮食月圆不了。'],
    },
    {
        'member': 2, 'topic_text': '哪道菜一吃就想起小时候？', 'date': '1968', 'photos': 0,
        'content': '外婆做的猪油拌饭。一勺猪油一勺酱油，趁热拌开，米粒都亮晶晶的。家里来客才舍得放猪油，我端着碗躲到门槛上吃，香得能记一辈子。',
        'answers': [],
    },
    {
        'member': 4, 'topic_text': '有没有一件小时候很想要，但一直没得到的东西？', 'date': '2003', 'photos': 0,
        'content': '一台四驱车。同桌有一辆「跃动冲锋」，全班都围着他转。我攒了半年零花钱，都快凑够了，最后在文具店看见一条妈妈一直舍不得买的围巾，鬼使神差就给妈妈买了当生日礼物。四驱车到现在也没买，围巾她戴了很多年。',
        'answers': [],
    },
    {
        'member': 1, 'topic_text': '家里那件老物件是什么来历？', 'date': '1975', 'photos': 0,
        'content': '那台蝴蝶牌缝纫机，是你太奶奶用一对银镯子嫁妆换来的。踩了一辈子，裤脚、书包带、过年的新褂子都是从那台机器上出来的。现在还能踩得动，就是线轴早就不配套了。',
        'answers': [],
    },
    {
        'member': 3, 'topic_text': '有没有一件到现在还后悔的事？', 'date': '1999', 'photos': 0,
        'content': '那年外婆病重，我赶上月底加班没回去，想着忙完这周就回。结果周四夜里接到电话。这世上很多事可以补，唯独「最后一程」没有补的机会。现在每年清明我都多烧一份纸。',
        'answers': [],
    },
    {
        'member': 4, 'topic_text': '小时候做过最调皮的一件事是什么？', 'date': '2001', 'photos': 0,
        'content': '把爸爸的剃须泡挤了一浴缸，堆成一座雪山，说是给他做云朵泡澡。他在门口站着看了半天，最后憋出一句「还挺像」，然后让我把浴缸刷了三遍。',
        'answers': [],
    },
]

# 4 张照片：与截图计划 2.1 照片分布一致（故事 1 挂 3 张、故事 3 挂 1 张）
# 元组：(源文件名, original_name, caption)；按 STORIES_SPEC 顺序依次消费
PHOTO_FILES = [
    ('story-1-a.jpg', '奶奶十八岁.jpg', '奶奶十八岁'),
    ('story-1-b.jpg', '奶奶与外婆.jpg', '奶奶与外婆'),
    ('story-1-c.jpg', '老屋门前.jpg', '老屋门前'),
    ('story-3-a.jpg', '老院子赏月.jpg', '老院子赏月'),
]

CAPSULE = {
    'id': 1, 'member_id': None, 'title': '写给明年的中秋',
    'content': '明年中秋，希望奶奶的老花镜还找得到，希望爷爷还记得这些故事讲到哪儿了。我们把今年的月亮存进这里，明年到期，一起打开。',
    'open_date': NEXT_MIDAUTUMN, 'is_opened': 0,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--photo-dir', default=DEFAULT_PHOTO_DIR)
    ap.add_argument('--api', default=DEFAULT_API)
    args = ap.parse_args()

    with open(SAFENET, encoding='utf-8') as fh:
        base = json.load(fh)
    topics = base['topics']
    followups = base['topic_followups']

    # 话题文本 → id 映射（找不到即中止，防错位）
    tmap = {t['text']: t['id'] for t in topics}
    fu_by_topic = {}
    for r in followups:
        fu_by_topic.setdefault(r['topic_id'], []).append(r)

    photos, stories = [], []
    photo_files = {}
    sid = 0
    ts_i = 0
    pid = 0
    for spec in STORIES_SPEC:
        sid += 1
        tid = tmap.get(spec['topic_text'])
        if tid is None:
            raise SystemExit('话题未找到：%s' % spec['topic_text'])
        # 追问作答：把答案对拆成 {q, a}；q 用话题库真实追问文本（快照进故事）
        fu = []
        ans = spec['answers']
        bank = fu_by_topic.get(tid, [])
        if ans:
            for k in range(0, len(ans), 2):
                q_text = ans[k]
                a_text = ans[k + 1] if k + 1 < len(ans) else ''
                # 若库内存在语义一致的追问文本则用它（保证 G1/G2 分镜「展开 2 条追问」与库一致）
                for cand in bank:
                    if q_text[:6] in cand['text'] or cand['text'][:6] in q_text:
                        q_text = cand['text']
                        break
                fu.append({'q': q_text, 'a': a_text})
        stories.append({
            'id': sid, 'topic_id': tid, 'member_id': spec['member'],
            'content': spec['content'], 'story_date': spec['date'],
            'followups': json.dumps(fu, ensure_ascii=False),
            'created_at': ts(ts_i), 'updated_at': ts(ts_i),
        })
        ts_i += 1
        for _ in range(spec['photos']):
            pid += 1
            src_name, orig, cap = PHOTO_FILES[pid - 1]
            path = os.path.join(args.photo_dir, src_name)
            if not os.path.isfile(path):
                raise SystemExit('照片缺失：%s（先运行 gen_photos.py）' % path)
            fname = uuid.uuid4().hex + '.jpg'
            with open(path, 'rb') as fh:
                photo_files[fname] = base64.b64encode(fh.read()).decode('ascii')
            photos.append({
                'id': pid, 'story_id': sid, 'filename': fname,
                'original_name': orig, 'caption': cap,
                'created_at': ts(ts_i),
            })
            ts_i += 1

    members = []
    for m in MEMBERS:
        mm = dict(m)
        mm['created_at'] = ts(0)
        members.append(mm)

    backup = {
        'meta': {'schema_version': '1', 'exported_at': '2026-09-26 20:30:00'},
        'members': members,
        'topics': topics,
        'topic_followups': followups,
        'draws': [],
        'stories': stories,
        'photos': photos,
        'time_capsules': [dict(CAPSULE, created_at=ts(ts_i))],
        'photo_files': photo_files,
    }

    # 写出备份 JSON（供检视/复用），再走 import 接口灌入
    out_path = os.path.join(args.photo_dir, '演示数据集-demo-dataset.json')
    with open(out_path, 'w', encoding='utf-8') as fh:
        json.dump(backup, fh, ensure_ascii=False)
    print('备份已写出：%s（%.1f MB）' % (out_path, os.path.getsize(out_path) / 1048576))

    # multipart 上传
    boundary = '----G3DemoBoundary%s' % uuid.uuid4().hex[:8]
    body = []
    body.append(('--%s\r\nContent-Disposition: form-data; name="file"; '
                 'filename="demo.json"\r\nContent-Type: application/json\r\n\r\n'
                 % boundary).encode())
    body.append(json.dumps(backup, ensure_ascii=False).encode('utf-8'))
    body.append(('\r\n--%s--\r\n' % boundary).encode())
    req = urllib.request.Request(
        args.api + '/api/import/json',
        data=b''.join(body),
        headers={'Content-Type': 'multipart/form-data; boundary=' + boundary},
        method='POST')
    with urllib.request.urlopen(req, timeout=120) as resp:
        print('import =', resp.read().decode('utf-8'))
    with urllib.request.urlopen(args.api + '/api/health', timeout=10) as resp:
        print('health =', resp.read().decode('utf-8'))


if __name__ == '__main__':
    main()

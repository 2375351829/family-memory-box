# -*- coding: utf-8 -*-
"""演示数据集灌数脚本（扩充版 v2）· 家庭回忆话题盒子

用途：把扩充版演示数据集（6 位家人 + 22 条故事 + 8 张老照片 + 3 个时间胶囊 + 22 条抽题记录）
     通过备份导入接口一次性灌入，供演示 / 截图 / 体验共用（同一套数据，禁为拍照临时改数据）。
用法：python 演示数据集-demo-dataset.py [--photo-dir <目录>] [--api <base_url>]

关键约束（本版新增）：
  - 故事发生日期 story_date 全部落在 2003 年及以后（1958 行脚本第 41–44 行：写死校验，越界即中止）。
  - 话题库 48 条内置话题 + 96 条追问从项目内 数据-话题库-topics.json 生成（不再依赖外部临时快照），
    仅替换 members / stories / photos / time_capsules / draws。
  - 老照片素材默认取项目内 演示照片-demo-photos/（AI 生成的泛化场景，不含真人面部）。

说明：走 POST /api/import/json 覆盖式导入（含 schema_version 校验）；导入会清空并重灌上述表。
"""
import argparse
import base64
import json
import os
import sys
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
TOPICS_JSON = os.path.join(HERE, '数据-话题库-topics.json')
DEFAULT_PHOTO_DIR = os.path.join(HERE, '演示照片-demo-photos')
DEFAULT_API = 'http://127.0.0.1:5080'

BASE_TS = '2026-09-30 09:'  # 演示数据统一时间戳基线（逐条 +1 分钟，保证顺序稳定）
MIN_STORY_YEAR = 2003      # 故事发生日期下限（本版硬约束）


def ts(i):
    # 分钟递增（本条数据集记录数 ≤ 60，分钟 00–59 不越界），保证 created_at 顺序稳定
    if i > 59:
        raise SystemExit('演示数据集记录数超过 60，ts() 分钟位会越界，需改基线')
    return '%s%02d:00' % (BASE_TS, i)


# ── 家人（6 位）────────────────────────────────────────────
MEMBERS = [
    {'id': 1, 'name': '李长海', 'relation': '爷爷', 'avatar_color': '#8E6B3E', 'sort_order': 0},
    {'id': 2, 'name': '李桂英', 'relation': '奶奶', 'avatar_color': '#C0392B', 'sort_order': 1},
    {'id': 3, 'name': '李建国', 'relation': '爸爸', 'avatar_color': '#4C6EF5', 'sort_order': 2},
    {'id': 4, 'name': '王秀兰', 'relation': '妈妈', 'avatar_color': '#B5739B', 'sort_order': 3},
    {'id': 5, 'name': '李念', 'relation': '我', 'avatar_color': '#3E8E5A', 'sort_order': 4},
    {'id': 6, 'name': '李知微', 'relation': '妹妹', 'avatar_color': '#E8A33D', 'sort_order': 5},
]

# ── 故事（22 条，按发生日期升序；每条 story_date ≥ 2003）──────
# member 为家人 id；topic_text 按 text 精确匹配话题库；answers 为 [追问, 作答, 追问, 作答…]
# photos 为 (源文件, original_name, caption)；源文件位于 --photo-dir
STORIES_SPEC = [
    {
        'member': 1, 'topic_text': '有没有一个再也没见到的朋友？', 'date': '2003-04-05', 'photos': [],
        'content': '2003 年春天，非典，哪儿都不让去。我那位老战友老周，我们约好了等疫情过去一起回趟老部队。那年五月他走了，不是因为这个病，是心梗，走得特别快。后来我一个人回去过一趟，营房还在，门口那棵槐树粗了一圈。我在树下站了一下午，替他把那支烟点上了。',
        'answers': [
            '你们最后一次见面是什么时候？在哪儿？',
            '答：2002 年冬天，在他家，包了顿饺子。他还说等开春了，一起去河边钓鱼。',
            '如果还能再见，你最想问他什么？',
            '答：想问他还记不记得新兵连那年的第一场雪。那年我们俩都没带棉鞋。',
        ],
    },
    {
        'member': 1, 'topic_text': '小时候最想去但没去过的地方？', 'date': '2005-08-12', 'photos': [],
        'content': '我这辈子最想去的地方是海。小时候在画报上见过，蓝得像一块没洗过的布，我那时候想，海得有多大啊。真正见到海是五十六岁那年，儿子单位组织去北戴河，我本来不肯去，说一把年纪了折腾啥。真站在海边，才知道天和地原来能连成一条线。我脱了鞋下去，海水凉，可心里热。',
        'answers': [
            '从哪儿知道这个地方的？想象过它什么样吗？',
            '答：从画报上知道的。我那时候以为海是安静的，谁知道它一直在响。',
            '后来去过吗？和当年想的一样吗？',
            '答：去过了。比画报上大得多，也吵得多。浪一响，人一下子就变小了。',
        ],
    },
    {
        'member': 3, 'topic_text': '家里第一台电器是什么？', 'date': '2005-11-06',
        'photos': [('demo-first-computer.jpg', '家里第一台电脑.jpg', '家里第一台电脑')],
        'content': '我们家第一台电脑是 2005 年买的，台式机，五千八，占了半张写字台。装好那天，一家人围着看开机，我媳妇说这玩意儿能干啥，结果那个月全家的第一张数码照、第一封电子邮件，都是从这台机器上发出去的。',
        'answers': [
            '花了多少钱买的？买回来全家什么反应？',
            '答：五千八。我妈最紧张，怕按坏了，开机都得我在旁边站着；我闺女最积极，趴在前面看，说黑屏幕能亮起来真神奇。',
            '现在家里电器换了一茬又一茬，还有哪台让你惦记？',
            '答：就是这台。现在还搁在储藏间，舍不得扔。',
        ],
    },
    {
        'member': 5, 'topic_text': '第一次上台表演是什么？', 'date': '2006-06-01', 'photos': [],
        'content': '幼儿园六一，我演一棵树。台词就一句「大树说：夏天到啦」，我练了半个月。上台太紧张，把词说成了「大树说：开饭啦」，全场家长都笑了，我妈笑得眼泪都出来了。老师后来说，这是她见过最自信的一棵树。',
        'answers': [
            '表演的什么节目？台下坐了谁？',
            '答：童话剧《小树的夏天》，我演树。台下第一排坐着我妈和我爸，我爸还举着一台刚买的家用摄像机。',
            '现在再让你上台，还敢吗？',
            '答：敢，但会先看一眼稿子。那一次让我知道，说错了天也不会塌。',
        ],
    },
    {
        'member': 4, 'topic_text': '有没有一个节日因为某件事变得特别？', 'date': '2007-10-01', 'photos': [],
        'content': '那年国庆，妹妹出生。产房窗外刚好在放烟花，护士拉开窗帘说，你听，外面在给你女儿放炮。别人家过国庆是看阅兵，我们家从那年以后，过国庆是给妹妹过生日。',
        'answers': [
            '那一年发生了什么？和往年有什么不一样？',
            '答：原计划是全家去广场看灯光秀，结果凌晨我就被送进了医院，一家人是在医院走廊上看的阅兵直播。',
            '从那以后，这个节日在你心里的分量变了吗？',
            '答：变了。现在一到国庆，我第一个念头不是放假，是她又长大一岁了。',
        ],
    },
    {
        'member': 3, 'topic_text': '过节时家里谁最忙？', 'date': '2008-09-14',
        'photos': [('demo-2008-dinner.jpg', '2008年中秋的一桌菜.jpg', '2008 年中秋的一桌菜')],
        'content': '2008 年中秋，家里最忙的是我妈。那年刚把老家的房子翻修完，又赶上奥运，她一个人从早忙到晚：上午炖肉，下午包月饼，晚上还得把我们从电视机前喊起来吃饭。她自己一口月饼没吃，说不爱吃甜的。后来我才知道，她不是不爱吃，是那盒月饼要留到第二天招待客人。',
        'answers': [
            '他/她从几天前就开始准备了？都忙些什么？',
            '答：提前三天。买菜、发面、把院子扫两遍，连灯笼都擦了一遍。',
            '当年你搭过手吗？现在想对那个人说什么？',
            '答：没搭手，净顾着看比赛。现在想跟她说一句，妈，你歇会儿吧。',
        ],
    },
    {
        'member': 5, 'topic_text': '第一次见到大海/下雪是什么时候？', 'date': '2009-01-28',
        'photos': [('demo-harbin-snow.jpg', '2009年哈尔滨的雪.jpg', '2009 年哈尔滨的雪')],
        'content': '我第一次看见雪是 2009 年冬天，那年我们一家去哈尔滨。我在酒店楼下站了很久，不敢动，怕一动脚印就没了。妹妹才两岁，被我爸整个抱起来放进雪里，她张嘴就去接雪花，凉得一激灵就哭了，哭完又笑。',
        'answers': [
            '当时的场景还记得吗？雪有多厚？',
            '答：到膝盖。我堆了一个很丑的雪人，插了两根树枝当手，谁路过都说像。',
            '现在再看雪，还有当年那种激动吗？',
            '答：有，但只在照片里。真冷起来还是想钻被窝。',
        ],
    },
    {
        'member': 2, 'topic_text': '家里那件老物件是什么来历？', 'date': '2009-05-10',
        'photos': [('demo-sewing-machine.jpg', '蝴蝶牌缝纫机.jpg', '那台蝴蝶牌缝纫机')],
        'content': '那台蝴蝶牌缝纫机，是我妈用一对银镯子嫁妆换来的。踩了一辈子，裤脚、书包带、过年的新褂子，都是从那台机器上出来的。现在它摆在客厅一角，上面搁了一盆绿萝，我说这样它就不生锈，还以为自己在干活。',
        'answers': [
            '它现在放在哪儿？用了多少年了？',
            '答：摆在客厅角落，五十来年了。前些年还踩得动，就是线轴早就不配套了。',
            '如果哪天它坏了、没了，你会舍不得吗？',
            '答：舍不得。它踩出来的那些针脚，一针都没白缝。',
        ],
    },
    {
        'member': 4, 'topic_text': '第一次离家出远门是去哪？', 'date': '2010-07-20',
        'photos': [('demo-expo-2010.jpg', '上海世博会的中国馆.jpg', '上海世博会的中国馆')],
        'content': '我第一次出远门是去上海看世博会，带着两个孩子。中国馆排了四个钟头，我闺女问我，妈你累不累，我说不累，其实脚都站麻了。那天我记得最清楚的不是哪个馆，是晚上回旅馆，两个孩子一边一个睡在我胳膊上，一动都不能动。',
        'answers': [
            '坐的什么车？行李里装了些什么？',
            '答：坐的动车。行李里一半是给孩子准备的水和小面包，我自己的东西一个包都没装满。',
            '现在还记得离家那一刻的心情吗？',
            '答：又怕又高兴。怕带不好他俩，高兴的是终于能带他们去看看外面的世界。',
        ],
    },
    {
        'member': 1, 'topic_text': '有没有一件留到现在的旧东西？', 'date': '2011-04-02', 'photos': [],
        'content': '我有一块上海牌手表，是结婚那年买的，到现在五十多年了，走得慢一点，但我一直戴着。表带换过三回，表盘上有道长划痕，是当年抱儿子时磕的。我不修，修好了那道印子就没了，那是我抱过他的证据。',
        'answers': [
            '它是什么？现在收在哪儿？',
            '答：一块上海牌手表，就戴在手上。孙子孙女小时候都抢着玩，说里面有个小虫子会动。',
            '如果孙子孙女问起它的故事，你会怎么讲？',
            '答：就说它慢，但它从没停过。过日子也一样。',
        ],
    },
    {
        'member': 5, 'topic_text': '第一次学会骑车/游泳是几岁？', 'date': '2012-07-15', 'photos': [],
        'content': '我学会骑车是十岁。我爸在后面扶着，一圈又一圈，我说你松手没有，他说没松。我一回头，他站在二十米外叉着腰笑。我骂他骗人，可他笑的那个样子，我到现在还记得清清楚楚。',
        'answers': [
            '谁扶的车/带的水？摔过几次？',
            '答：我爸扶的。摔了两次，膝盖磕破了皮，回家我妈一边给我上药一边骂我爸。',
            '学会那一刻是不是特别得意？后来这股胆子还在吗？',
            '答：得意极了，当天晚饭都没回家吃，绕着小区骑了三圈。胆子还在，就是现在骑的是共享单车。',
        ],
    },
    {
        'member': 2, 'topic_text': '家里过节必做的一道菜？', 'date': '2013-09-19',
        'photos': [('demo-taro-pork.jpg', '奶奶做的芋头扣肉.jpg', '奶奶做的芋头扣肉')],
        'content': '我们家过节必做的是芋头扣肉。芋头要选粉的，一片芋头一片肉码进碗里，蒸足两个钟头。老伴牙口不好，我就把肉切得薄一点。这道菜是你太外婆教我的，她说，扣肉扣肉，把一家人扣在一起。',
        'answers': [
            '这道菜谁做？用什么锅、什么做法？',
            '答：我做。用那口用了三十年的黑陶大碗，底下垫芋头，上锅隔水蒸，蒸到筷子一戳就透。',
            '现在家里还有人会做这道菜吗？',
            '答：我儿媳妇学了七成，味道差一点点，但那一点点她自己会补上。',
        ],
    },
    {
        'member': 2, 'topic_text': '老房子最让你记得的是哪个角落？', 'date': '2014-03-16',
        'photos': [('demo-old-kitchen.jpg', '老房子厨房的那扇窗.jpg', '老房子厨房的那扇窗')],
        'content': '老房子最让我记得的，是厨房那扇朝南的小窗。我在那窗下做了一辈子的饭，冬天的太阳照进来，案板上的面粉都是亮的。搬走那天我没哭，就是站在那扇窗前，把窗帘拉上去又拉下来，来回弄了三遍。',
        'answers': [
            '那个角落有什么？你通常在那儿干什么？',
            '答：一个搪瓷盆，一块竹案板，窗台上摆着几头蒜。我择菜、和面、给孩子缝扣子，都在那窗下。',
            '老房子拆掉/搬走的时候，你回去看过最后一眼吗？',
            '答：看过。我在门外站了会儿，没进去，怕进去了就舍不下了。',
        ],
    },
    {
        'member': 3, 'topic_text': '第一次自己做饭做了什么？', 'date': '2015-10-01', 'photos': [],
        'content': '我第一次正经做饭是 2015 年国庆，那年孩子他妈出差，我一个人带俩孩子。我给他们做了西红柿炒蛋，蛋煎糊了一半，西红柿又放多了水，最后成了一锅汤。我儿子一边吃一边说，爸，这个可以叫西红柿蛋汤，挺好喝的。就这一句，我后来学做了一桌子菜。',
        'answers': [
            '做的什么？做出来能吃吗？',
            '答：西红柿炒蛋，能吃，就是卖相差。两个孩子都吃完了，还说比外头买的香——我知道他们是哄我。',
            '从那以后，你觉得自己做饭的手艺是跟谁学的？',
            '答：跟着手机学的。现在我做红烧肉，我闺女说能吃出我妈的味道了。',
        ],
    },
    {
        'member': 6, 'topic_text': '有没有一件小时候很想要，但一直没得到的东西？', 'date': '2016-12-24', 'photos': [],
        'content': '我小时候特别想要一双会发光的鞋。班里跑得最快的女生有一双，一踩地就亮蓝光，我羡慕了整整一个学期。我妈说太贵，我就每次路过商场都趴在橱窗上看。后来生日那天，我哥用他攒的钱给我买了一双——不是那双，是另一双更贵的。但他不知道，我其实只是想要有人陪我一起趴在橱窗那儿看。',
        'answers': [
            '那是什么？当时离拥有它差多远？',
            '答：一双会发光的运动鞋。差我妈点一次头。她后来说，那年家里刚换房，一分钱都要算着花。',
            '现在自己买得起了，反而还想要吗？',
            '答：不想要了。但那张橱窗的照片我存着，提醒自己以后别让孩子等太久。',
        ],
    },
    {
        'member': 6, 'topic_text': '小时候最想成为什么样的人？', 'date': '2017-06-01', 'photos': [],
        'content': '我小时候最想当兽医。因为我养的小乌龟生病死掉了，我一直觉得是我没本事。我跟我哥说，以后我要当那种什么动物都能治好的医生。他没笑我，还给我找来一本《动物百科》。到现在那本书还在我书架上。',
        'answers': [
            '这个念头从哪儿来的？是哪本书、哪部电影？',
            '答：从那只小乌龟来的。它走的那天我哭了一晚上，我妈陪我一直到天亮。',
            '现在回头看，你活成当年想要的样子了吗？',
            '答：没当成兽医，但还在学生物。算是绕了一圈，又回到原地。',
        ],
    },
    {
        'member': 3, 'topic_text': '有没有一件放弃了的爱好？', 'date': '2018-09-22', 'photos': [],
        'content': '我年轻时候弹吉他，大学时在楼道里弹给人家听，后来工作了就搁下了，一搁二十年。2018 年搬家，从箱子底翻出那把琴，弦都锈了，我随手拨了一下，音是哑的。那天下午我去琴行换了套弦，现在偶尔还弹，弹得不好，但我闺女说，爸你一弹琴就不像平时那个爸了。',
        'answers': [
            '当年玩到什么水平？为什么放下的？',
            '答：弹得算能听，能弹整首《同桌的你》。放下是因为加班，回家只想躺着。',
            '现在还有心思把它捡起来吗？',
            '答：有。现在每周弹两次，不给人听，给自己听。',
        ],
    },
    {
        'member': 4, 'topic_text': '记忆里最香的一次饭是什么？', 'date': '2020-02-08', 'photos': [],
        'content': '2020 年元宵，小区封着，哪儿也去不了。我把家里能找出来的东西都翻出来，凑了一桌，连速冻汤圆都煮了。一家人围着桌子吃饭，窗外特别静，静得能听见彼此吃饭的声音。那顿饭不算好吃，可是我记到今天——每一张脸都在。',
        'answers': [
            '那顿饭吃的什么？为什么那么香？',
            '答：一锅炖菜、一盘饺子、八个汤圆。香是因为人齐，谁也没缺席。',
            '后来还有哪顿饭，能排第二？',
            '答：就是现在这顿。又被你问出来了。',
        ],
    },
    {
        'member': 4, 'topic_text': '哪道菜一吃就想起小时候？', 'date': '2022-09-10', 'photos': [],
        'content': '有一道菜我一吃就想起小时候——雪里蕻炒肉丝。我妈每年秋天腌一缸雪里蕻，下饭下粥都香。2022 年中秋我一个人在家，翻出冰箱最后一小把雪里蕻，炒了一盘，咸得发苦，可我还是一口一口吃完了，吃着吃着就想起我妈站在厨房门口喊我吃饭的样子。',
        'answers': [
            '这味道是谁做的？大概是个什么味儿？',
            '答：我妈做的。咸香里带一点酸，是腌菜特有的那种「过日子的味道」。',
            '现在还会自己动手做一次吗？',
            '答：会。每年秋天我腌一小坛，量不多，够想起她就行。',
        ],
    },
    {
        'member': 1, 'topic_text': '过节最难忘的一次是哪次？', 'date': '2024-09-17',
        'photos': [('demo-photo-wall.jpg', '金婚那天挂起来的老照片.jpg', '金婚那天挂起来的老照片')],
        'content': '最难忘的是 2024 年中秋，我和你奶奶结婚五十年。孩子们偷偷订了饭店，还把我们年轻时候的照片放大了挂在墙上。我敬酒的时候说了一句「这辈子我做得最对的事，就是把你们奶奶娶回家」，你奶奶眼睛就红了，转过身去擦了半天。中秋的月亮年年有，那一年的最圆。',
        'answers': [
            '那一年都有谁在场？发生了什么？',
            '答：儿子儿媳、孙子孙女，一桌九个人，连你妹妹都把男朋友带回来了。',
            '为什么偏偏是那一次，记到了今天？',
            '答：因为那是头一回，一家人把话说到了明面上。',
        ],
    },
    {
        'member': 5, 'topic_text': '第一份工作是什么？', 'date': '2025-07-01', 'photos': [],
        'content': '我的第一份工作是毕业以后进的设计院，第一个月工资到手六千二。我给全家各买了一份礼物：给我爷一副老花镜，给我奶奶一个按摩靠垫，给我妹一套她惦记很久的画笔，给我爸妈各一双鞋。给自己的那份，是一碗加了两个蛋的牛肉面。',
        'answers': [
            '一个月挣多少钱？第一天上班都干了什么？',
            '答：六千二。第一天啥也没干成，跟着师傅看了一整天的图纸，他说先看会，再动手。',
            '那份工作教会你的最重要一课是什么？',
            '答：慢一点。图纸上差一毫米，工地上就差一堵墙。',
        ],
    },
    {
        'member': 5, 'topic_text': '如果能回到小时候，最想改变什么？', 'date': '2026-09-25', 'photos': [],
        'content': '今年中秋，一家人又坐到了一起，还是那张老桌子，还是奶奶做的那道菜。爷爷问我，如果能回到小时候，你最想改变什么。我想了半天，说，什么都不想改。改掉哪一件，今天这桌人就少一个。奶奶听了，把最后一个汤圆推到我碗里，说，这话你爷爷年轻时候可说不出。',
        'answers': [
            '想回到哪一年？那个节点上发生了什么？',
            '答：真要说，是 2014 年搬家那一年。可也正是那年搬完，我们才第一次全家在新房里过了个中秋。',
            '其实要是改了，你舍得现在的一切吗？',
            '答：舍不得。一样都舍不得。',
        ],
    },
]

# ── 时间胶囊（3 个：2 个未到期 + 1 个当日到期可开启）──────────
CAPSULES = [
    {
        'id': 1, 'member_id': None, 'title': '写给明年的中秋',
        'content': '明年中秋，希望奶奶的老花镜还找得到，希望爷爷还记得这些故事讲到哪儿了。我们把今年的月亮存进这里，明年到期，一起打开。',
        'open_date': '2027-09-15', 'is_opened': 0,
    },
    {
        'id': 2, 'member_id': 5, 'title': '给十年后的妹妹',
        'content': '知微，写这个的时候你刚上高中。十年后你要是快忘了今天想要什么，就打开看看——你说过想当能治好所有小动物的医生，我记着呢，一直替你记着。',
        'open_date': '2035-06-01', 'is_opened': 0,
    },
    {
        'id': 3, 'member_id': 1, 'title': '金婚纪念日，再说一次',
        'content': '今天到期了。五十年前我说娶你是我这辈子最对的事，五十年后我还是这一句。往后要是有谁问起来，你就把我这两句原话念给他听。',
        'open_date': '2026-10-01', 'is_opened': 0,
    },
]


def load_topics():
    """从项目内 数据-话题库-topics.json 生成 topics / topic_followups（id 按文件顺序 1..48）。"""
    with open(TOPICS_JSON, encoding='utf-8') as fh:
        seed = json.load(fh)
    topics, followups = [], []
    tid = fid = 0
    for cat in seed['categories']:
        for t in cat['topics']:
            tid += 1
            topics.append({
                'id': tid, 'category': cat['name'], 'text': t['text'],
                'is_builtin': 1, 'created_at': '2026-09-26 16:16:28',
            })
            for order_no, fu in enumerate(t.get('follow_ups', []), start=1):
                fid += 1
                followups.append({'id': fid, 'topic_id': tid, 'order_no': order_no, 'text': fu})
    return topics, followups


def build(photo_dir):
    topics, followups = load_topics()
    tmap = {t['text']: t['id'] for t in topics}
    fu_by_topic = {}
    for r in followups:
        fu_by_topic.setdefault(r['topic_id'], []).append(r)

    # 硬约束：故事发生日期不得早于 2003
    for spec in STORIES_SPEC:
        year = int(str(spec['date'])[:4])
        if year < MIN_STORY_YEAR:
            raise SystemExit('故事发生日期 %s 早于 %d：%s' % (spec['date'], MIN_STORY_YEAR, spec['topic_text']))

    stories, photos, draws = [], [], []
    photo_files = {}
    ts_i = 1
    for sid, spec in enumerate(STORIES_SPEC, start=1):
        tid = tmap.get(spec['topic_text'])
        if tid is None:
            raise SystemExit('话题未找到：%s' % spec['topic_text'])
        # 追问作答：q 优先取话题库真实追问文本（快照进故事），匹配不到则用脚本内文本
        fu = []
        ans = spec.get('answers') or []
        bank = fu_by_topic.get(tid, [])
        for k in range(0, len(ans), 2):
            q_text = ans[k]
            a_text = ans[k + 1] if k + 1 < len(ans) else ''
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
        draws.append({
            'id': sid, 'member_id': spec['member'], 'topic_id': tid,
            'round_no': 1, 'drawn_at': ts(ts_i),
        })
        ts_i += 1
        for pid, (src_name, orig, cap) in enumerate(spec.get('photos') or [], start=1):
            path = os.path.join(photo_dir, src_name)
            if not os.path.isfile(path):
                raise SystemExit('照片缺失：%s（请先运行 fmb-demo-photos/gen.py 生成）' % path)
            fname = uuid.uuid4().hex + '.jpg'
            with open(path, 'rb') as fh:
                photo_files[fname] = base64.b64encode(fh.read()).decode('ascii')
            photos.append({
                'id': len(photos) + 1, 'story_id': sid, 'filename': fname,
                'original_name': orig, 'caption': cap, 'created_at': ts(ts_i),
            })
            ts_i += 1

    members = []
    for m in MEMBERS:
        mm = dict(m)
        mm['created_at'] = ts(0)
        members.append(mm)

    capsules = []
    for i, c in enumerate(CAPSULES):
        capsules.append(dict(c, created_at=ts(ts_i + i)))

    return {
        'meta': {'schema_version': '1', 'exported_at': '2026-09-30 09:00:00'},
        'members': members,
        'topics': topics,
        'topic_followups': followups,
        'draws': draws,
        'stories': stories,
        'photos': photos,
        'time_capsules': capsules,
        'photo_files': photo_files,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--photo-dir', default=DEFAULT_PHOTO_DIR)
    ap.add_argument('--api', default=DEFAULT_API)
    args = ap.parse_args()

    backup = build(args.photo_dir)

    n_photos = len(backup['photos'])
    print('家人 %d / 故事 %d / 照片 %d / 胶囊 %d / 抽题 %d / 话题 %d / 追问 %d'
          % (len(backup['members']), len(backup['stories']), n_photos,
             len(backup['time_capsules']), len(backup['draws']),
             len(backup['topics']), len(backup['topic_followups'])))
    years = sorted(int(s['story_date'][:4]) for s in backup['stories'])
    print('故事发生年份：%s（最早 %d，全部 ≥ %d）' % (', '.join(map(str, years)), years[0], MIN_STORY_YEAR))

    # multipart 上传
    boundary = '----FmbDemoBoundary%s' % uuid.uuid4().hex[:8]
    payload = json.dumps(backup, ensure_ascii=False).encode('utf-8')
    body = (
        ('--%s\r\nContent-Disposition: form-data; name="file"; '
         'filename="demo.json"\r\nContent-Type: application/json\r\n\r\n' % boundary).encode()
        + payload + ('\r\n--%s--\r\n' % boundary).encode()
    )
    req = urllib.request.Request(
        args.api + '/api/import/json', data=body,
        headers={'Content-Type': 'multipart/form-data; boundary=' + boundary},
        method='POST')
    with urllib.request.urlopen(req, timeout=180) as resp:
        print('import =', resp.read().decode('utf-8'))
    with urllib.request.urlopen(args.api + '/api/health', timeout=10) as resp:
        print('health =', resp.read().decode('utf-8'))


if __name__ == '__main__':
    try:
        main()
    except urllib.error.URLError as e:
        print('导入失败：无法连接后端 %s（请先启动 后端服务-app.py，PORT=5080）' % e, file=sys.stderr)
        sys.exit(1)

# -*- coding: utf-8 -*-
"""
测试-抽题-draw-test.py
8.1 抽题算法（draw_topic 纯函数）单元测试：不连 Flask、不起服务，直连临时 SQLite 临时库。

通过 importlib 按文件路径加载 后端服务-app.py（文件名含中文连字符，无法常规 import），
复用其中的 get_conn / init_db / draw_topic，测试库指向临时目录，不污染开发数据。

运行：python 测试-抽题-draw-test.py
"""

import importlib.util
import os
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))

# ── 按路径加载后端模块（仅加载定义，不触发 __main__ 启动逻辑） ──
_spec = importlib.util.spec_from_file_location("backend_app", os.path.join(HERE, "后端服务-app.py"))
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)

# ── 指向独立临时库（get_conn 是全项目唯一 sqlite3.connect 入口，测试脚本自身不建连接） ──
mod.DATA_DIR = tempfile.mkdtemp(prefix="draw-test-")
mod.DB_PATH = os.path.join(mod.DATA_DIR, "test.db")
mod.UPLOAD_DIR = os.path.join(mod.DATA_DIR, "uploads")
mod.init_db()

_results = []  # (用例名, 是否通过, 说明)


def check(name, fn):
    try:
        detail = fn()
        _results.append((name, True, detail or ''))
        print(f'[PASS] {name}' + (f' —— {detail}' if detail else ''))
    except AssertionError as e:
        _results.append((name, False, str(e)))
        print(f'[FAIL] {name} —— {e}')
    except Exception as e:  # 意外异常也记为失败，不让单测中途崩掉
        _results.append((name, False, f'异常：{type(e).__name__}: {e}'))
        print(f'[FAIL] {name} —— 异常：{type(e).__name__}: {e}')


def add_member(name):
    """测试夹具：经 get_conn 建一名成员，返回 id"""
    conn = mod.get_conn()
    try:
        cur = conn.execute("INSERT INTO members(name, relation) VALUES (?, ?)", (name, '测试'))
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def topic_count():
    conn = mod.get_conn()
    try:
        return conn.execute("SELECT COUNT(*) AS c FROM topics").fetchone()['c']
    finally:
        conn.close()


# ── 用例 1：同轮不重复（抽 8 次，round 恒 1、无重复、均非新一轮） ──
def t1_same_round_no_repeat():
    mid = add_member('甲')
    conn = mod.get_conn()
    try:
        ids, rounds, news = [], [], []
        for _ in range(8):
            topic, rnd, is_new = mod.draw_topic(conn, mid, None)
            ids.append(topic['id'])
            rounds.append(rnd)
            news.append(is_new)
        assert len(set(ids)) == 8, f'同轮出现重复话题：{ids}'
        assert set(rounds) == {1}, f'轮次应恒为 1，实际 {rounds}'
        assert not any(news), f'不应出现新一轮标记：{news}'
        # 话题需附 follow_ups（48 条内置话题每条 2 条追问）
        assert len(topic['follow_ups']) == 2, f'返回话题缺少 2 条追问：{topic["follow_ups"]}'
        return f'8 次抽题 id={ids}'
    finally:
        conn.close()


# ── 用例 2：抽完自动进下一轮（48 条抽满后第 49 次 is_new_round=True 且 round=2） ──
def t2_next_round_when_exhausted():
    total = topic_count()
    mid = add_member('乙')
    conn = mod.get_conn()
    try:
        first_round_ids = []
        for _ in range(total):
            topic, rnd, is_new = mod.draw_topic(conn, mid, None)
            assert rnd == 1 and not is_new, f'前 {total} 次应全在第 1 轮，实际 round={rnd}, new={is_new}'
            first_round_ids.append(topic['id'])
        assert len(set(first_round_ids)) == total, '第 1 轮 48 次抽题应覆盖全部话题且不重复'
        topic, rnd, is_new = mod.draw_topic(conn, mid, None)
        assert is_new is True, f'第 {total + 1} 次应进入新一轮（is_new_round=True）'
        assert rnd == 2, f'第 {total + 1} 次轮次应为 2，实际 {rnd}'
        assert topic['id'] in first_round_ids, '第 2 轮应从已抽过的话题中重新抽取'
        return f'{total} 次抽满 → 第 {total + 1} 次进入第 2 轮'
    finally:
        conn.close()


# ── 用例 3：分类过滤后仍不重复（节日记忆 8 条抽满 → 第 9 次进下一轮） ──
def t3_category_filter_no_repeat():
    mid = add_member('丙')
    conn = mod.get_conn()
    try:
        ids = []
        for _ in range(8):
            topic, rnd, is_new = mod.draw_topic(conn, mid, '节日记忆')
            assert topic['category'] == '节日记忆', f'应只抽中「节日记忆」，实际 {topic["category"]}'
            assert rnd == 1 and not is_new
            ids.append(topic['id'])
        assert len(set(ids)) == 8, f'分类过滤下同轮出现重复：{ids}'
        topic, rnd, is_new = mod.draw_topic(conn, mid, '节日记忆')
        assert is_new is True and rnd == 2, '该分类抽满后应进入第 2 轮'
        return f'8 次分类抽题 id={ids}，第 9 次进入第 2 轮'
    finally:
        conn.close()


# ── 用例 4：空分类过滤不崩（抛 PoolEmptyError，由路由转 400） ──
def t4_empty_category_no_crash():
    mid = add_member('丁')
    conn = mod.get_conn()
    try:
        try:
            mod.draw_topic(conn, mid, '不存在的分类')
        except mod.PoolEmptyError:
            return '空分类抛 PoolEmptyError（接口层将转为 400 BAD_REQUEST），未崩溃'
        raise AssertionError('空分类应抛 PoolEmptyError，实际未抛出')
    finally:
        conn.close()


# ── 用例 5（加分）：模拟并发两次 draw 不命中同题（两连接同时抽，BEGIN IMMEDIATE 串行化） ──
def t5_concurrent_draw_no_conflict():
    mid = add_member('戊')
    results, errors = [], []
    barrier = threading.Barrier(2)  # 两线程就绪后同时放行，制造真实竞争

    def worker():
        try:
            conn = mod.get_conn()  # 每线程独立连接（模拟两台设备）
            barrier.wait()
            topic, rnd, _ = mod.draw_topic(conn, mid, None)
            results.append((topic['id'], rnd))
            conn.close()
        except Exception as e:  # noqa: BLE001
            errors.append(f'{type(e).__name__}: {e}')

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors, f'并发抽题出错：{errors}'
    assert len(results) == 2, f'应完成 2 次抽题，实际 {len(results)}'
    assert results[0] != results[1], f'并发两次抽题命中了同一题同一轮：{results}'
    same_round = results[0][1] == results[1][1]
    return (f'两连接并发抽题 (topic_id, round)={results}，'
            + ('同轮不同题，互斥生效' if same_round else '分属不同轮'))


# ── 用例 6：抽题写入 draws 落库（支撑不重复的记录真实存在） ──
def t6_draws_persisted():
    mid = add_member('己')
    conn = mod.get_conn()
    try:
        for _ in range(3):
            mod.draw_topic(conn, mid, None)
        n = conn.execute("SELECT COUNT(*) AS c FROM draws WHERE member_id=?", (mid,)).fetchone()['c']
        assert n == 3, f'draws 表应有 3 条记录，实际 {n}'
        return '3 次抽题均在 draws 表留痕'
    finally:
        conn.close()


check('同轮不重复（抽 8 次无重复、round=1）', t1_same_round_no_repeat)
check('抽完自动进下一轮（48 抽满后 is_new_round=True）', t2_next_round_when_exhausted)
check('分类过滤后仍不重复（节日记忆 8 条）', t3_category_filter_no_repeat)
check('空分类过滤不崩（PoolEmptyError）', t4_empty_category_no_crash)
check('（加分）并发两次 draw 不命中同题', t5_concurrent_draw_no_conflict)
check('抽题记录落库（draws 表留痕）', t6_draws_persisted)

# ── 汇总 ──
passed = sum(1 for _, ok_, _ in _results if ok_)
failed = len(_results) - passed
print(f'\n===== 抽题算法单测：{passed} 通过 / {failed} 失败 =====')
sys.exit(0 if failed == 0 else 1)

// 模块-node-查询-query.mjs
// 查询与序列化：成员/话题字典、故事全量视图、公开故事裁剪、回忆录三视图
// （对照 app.py _member_dict/_topic_dict/_stories_full/_story_by_id/_public_story/_group/_sort_by_created_desc/api_memoir）

// Story 对外字段（§6.1 契约冻结，顺序即 JSON 键序）
export const STORY_PUBLIC_KEYS = [
  'id', 'topic_id', 'member_id', 'topic_text', 'relation', 'name',
  'content', 'story_date', 'followups', 'photos', 'created_at', 'updated_at',
];

/** Member 响应对象（对照 _member_dict，键序固定） */
export function memberDict(row) {
  return {
    id: row.id,
    name: row.name,
    relation: row.relation,
    avatar_color: row.avatar_color,
    sort_order: row.sort_order,
    created_at: row.created_at,
  };
}

/** Topic 响应对象（对照 _topic_dict，含按 order_no 升序的追问链） */
export function topicDict(conn, row) {
  const followUps = conn
    .prepare('SELECT text FROM topic_followups WHERE topic_id=? ORDER BY order_no')
    .all(row.id)
    .map((r) => r.text);
  return {
    id: row.id,
    category: row.category,
    text: row.text,
    is_builtin: row.is_builtin,
    follow_ups: followUps,
  };
}

/** 故事全量视图：JOIN 话题/成员 + 附带照片列表（对照 _stories_full） */
export function storiesFull(conn, whereSql = '', params = []) {
  const rows = conn
    .prepare(
      `SELECT s.*,
              t.text AS topic_text, t.category AS topic_category,
              m.name AS name, m.relation AS relation, m.sort_order AS member_sort_order
       FROM stories s
       JOIN topics t  ON t.id = s.topic_id
       JOIN members m ON m.id = s.member_id
       ${whereSql}
       ORDER BY s.created_at DESC, s.id DESC`
    )
    .all(...params);
  const photosByStory = {};
  for (const p of conn.prepare('SELECT * FROM photos ORDER BY id').all()) {
    if (!photosByStory[p.story_id]) photosByStory[p.story_id] = [];
    photosByStory[p.story_id].push({ ...p });
  }
  return rows.map((r) => ({ ...r, photos: photosByStory[r.id] || [] }));
}

export function storyById(conn, storyId) {
  const rows = storiesFull(conn, 'WHERE s.id=?', [storyId]);
  return rows.length ? rows[0] : null;
}

/** 裁剪为 §6.1 契约字段，并解析 followups JSON（非法则 []）（对照 _public_story） */
export function publicStory(d) {
  const out = {};
  for (const k of STORY_PUBLIC_KEYS) if (k in d) out[k] = d[k];
  let fu = null;
  try {
    fu = JSON.parse(d.followups || '[]');
  } catch {
    fu = null;
  }
  out.followups = Array.isArray(fu) ? fu : [];
  return out;
}

function group(key, label, items) {
  return {
    key: String(key),
    label,
    meta: {
      count: items.length,
      photoCount: items.reduce((n, s) => n + s.photos.length, 0),
    },
    items: items.map(publicStory),
  };
}

function sortByCreatedDesc(items) {
  return [...items].sort((a, b) =>
    a.created_at !== b.created_at ? (a.created_at < b.created_at ? 1 : -1) : b.id - a.id
  );
}

/** 回忆录三视图（对照 api_memoir）：timeline / member / topic */
export function memoirGroups(conn, view, categoryOrder) {
  const stories = storiesFull(conn);
  const groups = [];
  if (view === 'timeline') {
    const byYear = new Map();
    for (const s of stories) {
      const key = s.story_date ? s.story_date.slice(0, 4) : '年份未详';
      if (!byYear.has(key)) byYear.set(key, []);
      byYear.get(key).push(s);
    }
    const keys = [...byYear.keys()].sort((a, b) => {
      if (a === '年份未详' && b === '年份未详') return 0;
      if (a === '年份未详') return 1;
      if (b === '年份未详') return -1;
      return Number(a) - Number(b);
    });
    for (const key of keys) groups.push(group(key, key, sortByCreatedDesc(byYear.get(key))));
  } else if (view === 'member') {
    const byMember = new Map();
    for (const s of stories) {
      if (!byMember.has(s.member_id)) byMember.set(s.member_id, []);
      byMember.get(s.member_id).push(s);
    }
    const ids = [...byMember.keys()].sort((a, b) => {
      const ma = byMember.get(a)[0].member_sort_order;
      const mb = byMember.get(b)[0].member_sort_order;
      return ma - mb || a - b;
    });
    for (const mid of ids) {
      const items = byMember.get(mid);
      groups.push(group(mid, items[0].name, sortByCreatedDesc(items)));
    }
  } else {
    const byTopic = new Map();
    for (const s of stories) {
      if (!byTopic.has(s.topic_id)) byTopic.set(s.topic_id, []);
      byTopic.get(s.topic_id).push(s);
    }
    const rank = new Map(categoryOrder.map((n, i) => [n, i]));
    const ids = [...byTopic.keys()].sort((a, b) => {
      const ca = byTopic.get(a)[0].topic_category;
      const cb = byTopic.get(b)[0].topic_category;
      const ra = rank.has(ca) ? rank.get(ca) : categoryOrder.length;
      const rb = rank.has(cb) ? rank.get(cb) : categoryOrder.length;
      return ra - rb || a - b;
    });
    for (const tid of ids) {
      const items = byTopic.get(tid);
      const label = `${items[0].topic_category} · ${items[0].topic_text}`;
      groups.push(group(tid, label, sortByCreatedDesc(items)));
    }
  }
  return { groups };
}
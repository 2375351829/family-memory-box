// 模块-node-校验-validate.mjs
// 通用校验与序列化辅助（对照 app.py _json_body/_clean_str/_validate_member_fields/
// _validate_topic_fields/_validate_story_fields/_validate_capsule_fields/_magic_ok 及整数判定约定）
import { ApiError, pyDump } from './模块-node-响应-response.mjs';

/**
 * 请求体取值（对照 _json_body）：解析由 app.mjs 的 JSON 中间件完成并存入 req.body；
 * 非对象（含未解析/数组/null）→ 400「请求体须为 JSON 对象」。
 */
export function jsonBody(req) {
  const data = req.body;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ApiError('BAD_REQUEST', '请求体须为 JSON 对象');
  }
  return data;
}

/** 去空白；非字符串返回 null（对照 _clean_str） */
export function cleanStr(v) {
  return typeof v === 'string' ? v.trim() : null;
}

/** 按 Unicode 码点计数（等价 Python len()，对照任务书 30 条） */
export function codePointLength(s) {
  return [...String(s)].length;
}

/** 整数判定：等价 Python isinstance(x, int)（注意 Python 中 bool 也是 int，布尔值应通过） */
export function pyInt(x) {
  return typeof x === 'number' && Number.isInteger(x) || typeof x === 'boolean';
}

/** 绑定值转换：bool → 1/0，使布尔能作为 INTEGER 绑定（node:sqlite 拒收布尔） */
export function pyIntBind(x) {
  return x === true ? 1 : x === false ? 0 : x;
}

/**
 * 校验 members 请求字段（对照 _validate_member_fields）。
 * partial=true 仅校验出现的字段（PUT）；否则 name/relation 必填（POST）。
 */
export function validateMemberFields(payload, partial) {
  const out = {};
  if (!partial || 'name' in payload) {
    const name = cleanStr(payload.name) || '';
    if (!(codePointLength(name) >= 1 && codePointLength(name) <= 20)) {
      throw new ApiError('BAD_REQUEST', 'name 长度须为 1–20');
    }
    out.name = name;
  }
  if (!partial || 'relation' in payload) {
    const relation = cleanStr(payload.relation) || '';
    if (!(codePointLength(relation) >= 1 && codePointLength(relation) <= 10)) {
      throw new ApiError('BAD_REQUEST', 'relation 长度须为 1–10');
    }
    out.relation = relation;
  }
  if ('avatar_color' in payload) {
    const color = cleanStr(payload.avatar_color);
    out.avatar_color = color || '#C0392B';
  }
  return out;
}

/** 校验 topics 请求字段（对照 api_topics_create 内联校验） */
export function validateTopicFields(payload) {
  const category = cleanStr(payload.category);
  if (!category) throw new ApiError('BAD_REQUEST', 'category 必填');
  const text = cleanStr(payload.text);
  if (text === null || !(codePointLength(text) >= 1 && codePointLength(text) <= 60)) {
    throw new ApiError('BAD_REQUEST', 'text 长度须为 1–60');
  }
  const fu = payload.follow_ups;
  let fuList = [];
  if (fu !== null && fu !== undefined) {
    if (!Array.isArray(fu) || !fu.every((x) => typeof x === 'string')) {
      throw new ApiError('BAD_REQUEST', 'follow_ups 须为字符串数组');
    }
    fuList = fu.map((x) => x.trim()).filter((x) => x);
  }
  return { category, text, follow_ups: fuList };
}

const STORY_DATE_RE = /^(\d{4}|\d{4}-\d{2}-\d{2})$/;

/**
 * 校验 stories 请求字段（对照 _validate_story_fields）。
 * is_create=true 时 topic_id/member_id/content 必填。
 * followups 序列化为 JSON 字符串存储（pyDump，与 Python json.dumps 分隔符风格一致）。
 */
export function validateStoryFields(payload, conn, isCreate) {
  const out = {};
  if (isCreate || 'topic_id' in payload) {
    const tid = payload.topic_id;
    if (!pyInt(tid) || !conn.prepare('SELECT 1 FROM topics WHERE id=?').get(pyIntBind(tid))) {
      throw new ApiError('NOT_FOUND', `topic_id=${fmtV(tid)} 不存在`, 404);
    }
    out.topic_id = pyIntBind(tid);
  }
  if (isCreate || 'member_id' in payload) {
    const mid = payload.member_id;
    if (!pyInt(mid) || !conn.prepare('SELECT 1 FROM members WHERE id=?').get(pyIntBind(mid))) {
      throw new ApiError('NOT_FOUND', `member_id=${fmtV(mid)} 不存在`, 404);
    }
    out.member_id = pyIntBind(mid);
  }
  if (isCreate || 'content' in payload) {
    const content = payload.content;
    if (content == null && isCreate) throw new ApiError('BAD_REQUEST', 'content 必填（可为空串占位）');
    out.content = typeof content === 'string' ? content.trim() : '';
  }
  if ('story_date' in payload || (isCreate && payload.story_date !== null && payload.story_date !== undefined)) {
    const sd = payload.story_date;
    if (sd === null || (typeof sd === 'string' && !sd.trim())) {
      out.story_date = null;
    } else if (typeof sd === 'string' && STORY_DATE_RE.test(sd.trim())) {
      out.story_date = sd.trim();
    } else {
      throw new ApiError('BAD_REQUEST', 'story_date 格式须为 YYYY 或 YYYY-MM-DD');
    }
  }
  if ('followups' in payload || (isCreate && payload.followups !== null && payload.followups !== undefined)) {
    const fu = payload.followups;
    if (fu === null) {
      out.followups = '[]';
    } else {
      if (!Array.isArray(fu)) throw new ApiError('BAD_REQUEST', 'followups 须为 [{"q":...,"a":...}] 数组');
      const cleaned = [];
      for (const item of fu) {
        if (typeof item !== 'object' || item === null || typeof item.q !== 'string') {
          throw new ApiError('BAD_REQUEST', 'followups 每项须为含 q/a 字符串的对象');
        }
        cleaned.push({ q: item.q, a: typeof item.a === 'string' ? item.a : '' });
      }
      // 存储格式与 Python json.dumps(ensure_ascii=False) 一致（含 ", " / ": " 分隔空格）
      out.followups = pyDump(cleaned);
    }
  }
  return out;
}

/** f-string 风格值展示（用于 404 文案） */
function fmtV(v) {
  if (v === undefined || v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  return String(v);
}

const CAPSULE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 纯字符串解析 YYYY-MM-DD → Date（本地时区，避免时区偏差）；非法返回 null */
export function parseLocalDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

/** 本地日期字符串 YYYY-MM-DD */
export function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** 校验 capsules 请求字段（对照 api_capsules_create 内联校验） */
export function validateCapsuleFields(payload, conn) {
  const title = cleanStr(payload.title);
  if (!title) throw new ApiError('BAD_REQUEST', 'title 必填');
  const content = typeof payload.content === 'string' ? payload.content : '';
  const openDate = cleanStr(payload.open_date);
  if (!openDate || !CAPSULE_DATE_RE.test(openDate)) {
    throw new ApiError('BAD_REQUEST', 'open_date 必填且格式须为 YYYY-MM-DD');
  }
  if (!parseLocalDate(openDate)) throw new ApiError('BAD_REQUEST', 'open_date 不是合法日期');
  const memberId = payload.member_id; // 可空 = 家庭共享胶囊
  if (memberId !== null && memberId !== undefined) {
    if (!pyInt(memberId) || !conn.prepare('SELECT 1 FROM members WHERE id=?').get(pyIntBind(memberId))) {
      throw new ApiError('NOT_FOUND', `member_id=${fmtV(memberId)} 不存在`, 404);
    }
    return { member_id: pyIntBind(memberId), title, content, open_date: openDate };
  }
  return { member_id: null, title, content, open_date: openDate };
}

/**
 * 魔数校验：读文件前 12 字节与扩展名比对（对照 _magic_ok）。
 * head 须为 >= 12 字节的 Buffer；短于 12 字节的 Buffer 传入时由调用方保证补零。
 */
export function magicOk(ext, head) {
  const b = head.subarray(0, 12);
  if (ext === 'jpg' || ext === 'jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (ext === 'png') return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (ext === 'gif') {
    const head6 = b.subarray(0, 6).toString('latin1');
    return head6 === 'GIF87a' || head6 === 'GIF89a';
  }
  if (ext === 'webp') return b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
  return false;
}

/**
 * multer 中文文件名修复：multer 按 latin1 解码 multipart 的 UTF-8 文件名，
 * 还原为原始 UTF-8 字节（对照探测：b'中文照片.jpg' → 'ä¸­æç§ç.jpg'）。
 */
export function fixOriginalname(name) {
  if (typeof name !== 'string') return name || '';
  return Buffer.from(name, 'latin1').toString('utf8');
}
// 模块-node-响应-response.mjs
// 统一响应与错误体系（对照 app.py jresp/ok/err、_HTTP_CODE_MAP、ApiError）
// 关键等价点：序列化采用 Python json.dumps(ensure_ascii=False) 的默认分隔符风格
// （即 ", " / ": " 带空格、中文不转义），从而与 Flask 版输出逐字节一致。

/** 业务类异常：统一转为 {"ok":false,"error":{...}} 响应 */
export class ApiError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.message = message;
    this.status = status;
  }
}

// HTTPException 状态码 → 错误码表映射（对照 app.py _HTTP_CODE_MAP，405 映射为 BAD_REQUEST）
export const HTTP_CODE_MAP = {
  400: 'BAD_REQUEST',
  404: 'NOT_FOUND',
  405: 'BAD_REQUEST',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_TYPE',
};

// Werkzeug 原文文案（未匹配路由 / 方法不匹配）
export const WERKZEUG_404 =
  'The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again.';
export const WERKZEUG_405 = 'The method is not allowed for the requested URL.';

const NEED_ESCAPE_RE = /[\\"\u0000-\u001f]/;

/** JSON 字符串转义：与 Python json.dumps(ensure_ascii=False) 一致（不转义非 ASCII，\b/\f 用短写） */
function pyStr(s) {
  if (!NEED_ESCAPE_RE.test(s)) return '"' + s + '"';
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (c < 0x20) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

/**
 * 序列化为 Python json.dumps(obj, ensure_ascii=False) 的等价文本。
 * 用于统一响应体与 export 备份体，避免与 Flask 版出现空格差异。
 */
export function pyDump(v) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'string') return pyStr(v);
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (t === 'bigint') return String(v);
  if (Array.isArray(v)) return '[' + v.map(pyDump).join(', ') + ']';
  if (t === 'object') {
    const keys = Object.keys(v);
    return '{' + keys.map((k) => pyStr(k) + ': ' + pyDump(v[k])).join(', ') + '}';
  }
  return 'null';
}

/** Python 风格值展示（用于错误文案里的 f-string 插值） */
export function fmtPy(v) {
  if (v === undefined || v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  return String(v);
}

/** 统一 JSON 响应：Content-Type 带 charset，中文不转义，body 末尾追加 \n */
export function jresp(res, payload, status = 200) {
  const body = pyDump(payload) + '\n';
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.status(status).send(body);
}

export function ok(res, data, status = 200) {
  return jresp(res, { ok: true, data }, status);
}

export function err(res, code, message, status = 400) {
  return jresp(res, { ok: false, error: { code, message } }, status);
}

/** 未匹配路由：404 + Werkzeug 原文 */
export function notFound(res) {
  return err(res, 'NOT_FOUND', WERKZEUG_404, 404);
}

/** 方法不匹配：405（错误码映射为 BAD_REQUEST）+ Werkzeug 原文 */
export function methodNotAllowed(res) {
  return err(res, 'BAD_REQUEST', WERKZEUG_405, 405);
}

/** 整数路径参数校验：非 \d+ 视同路由未匹配（对照 Flask <int:xxx> 转换器） */
export function requireIntId(req, res, next) {
  if (!/^\d+$/.test(req.params.id)) return notFound(res);
  req.intId = Number(req.params.id);
  next();
}
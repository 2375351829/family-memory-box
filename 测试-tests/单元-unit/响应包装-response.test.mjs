// 统一响应包装单元测试（对照 app.py jresp/ok/err、_HTTP_CODE_MAP、Werkzeug 文案）
import { describe, it, expect } from 'vitest';
import {
  pyDump,
  jresp,
  ok,
  err,
  notFound,
  methodNotAllowed,
  ApiError,
  HTTP_CODE_MAP,
  WERKZEUG_404,
  WERKZEUG_405,
} from '../../模块-node-响应-response.mjs';

// 伪造 express res，仅捕获 set / status / send
function fakeRes() {
  const r = {
    statusCode: null,
    headers: {},
    body: null,
    set(k, v) {
      this.headers[k] = v;
      return this;
    },
    status(s) {
      this.statusCode = s;
      return this;
    },
    send(b) {
      this.body = b;
      return this;
    },
  };
  return r;
}

describe('pyDump 序列化（Python json.dumps 风格）', () => {
  it('分隔符含 ", " 与 ": "，中文不转义', () => {
    expect(pyDump({ a: 1, b: '中' })).toBe('{"a": 1, "b": "中"}');
    expect(pyDump([1, 2, 3])).toBe('[1, 2, 3]');
    expect(pyDump([{ q: '问', a: '答' }])).toBe('[{"q": "问", "a": "答"}]');
  });

  it('特殊字符转义与布尔/null', () => {
    expect(pyDump('a\nb')).toBe('"a\\nb"');
    expect(pyDump(true)).toBe('true');
    expect(pyDump(null)).toBe('null');
  });

  it('pyDump 输出本身无末尾换行（导出端点直接使用）', () => {
    expect(pyDump({ x: 1 }).endsWith('\n')).toBe(false);
  });
});

describe('jresp / ok / err 响应结构', () => {
  it('ok → {ok:true,data} + Content-Type 带 charset + body 末尾 \\n', () => {
    const res = fakeRes();
    ok(res, { n: 1 }, 200);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(res.headers['Content-Type']).toContain('charset');
    expect(res.body.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(res.body);
    expect(parsed).toEqual({ ok: true, data: { n: 1 } });
  });

  it('err → {ok:false,error:{code,message}} + body 末尾 \\n', () => {
    const res = fakeRes();
    err(res, 'BAD_REQUEST', '出错了', 400);
    expect(res.statusCode).toBe(400);
    expect(res.body.endsWith('\n')).toBe(true);
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: '出错了' } });
  });

  it('jresp 自定义状态码透传', () => {
    const res = fakeRes();
    jresp(res, { ok: true, data: null }, 201);
    expect(res.statusCode).toBe(201);
  });
});

describe('HTTP 状态码 → 错误码映射（5 条，405 映射为 BAD_REQUEST）', () => {
  it('映射表逐条一致', () => {
    expect(HTTP_CODE_MAP[400]).toBe('BAD_REQUEST');
    expect(HTTP_CODE_MAP[404]).toBe('NOT_FOUND');
    expect(HTTP_CODE_MAP[405]).toBe('BAD_REQUEST');
    expect(HTTP_CODE_MAP[413]).toBe('PAYLOAD_TOO_LARGE');
    expect(HTTP_CODE_MAP[415]).toBe('UNSUPPORTED_TYPE');
    expect(Object.keys(HTTP_CODE_MAP).length).toBe(5);
  });
});

describe('框架级 404 / 405 文案与 ApiError', () => {
  it('notFound → 404 NOT_FOUND + Werkzeug 原文', () => {
    const res = fakeRes();
    notFound(res);
    const parsed = JSON.parse(res.body);
    expect(res.statusCode).toBe(404);
    expect(parsed.error.code).toBe('NOT_FOUND');
    expect(parsed.error.message).toBe(WERKZEUG_404);
  });

  it('methodNotAllowed → 405 且 code=BAD_REQUEST + Werkzeug 原文', () => {
    const res = fakeRes();
    methodNotAllowed(res);
    const parsed = JSON.parse(res.body);
    expect(res.statusCode).toBe(405);
    expect(parsed.error.code).toBe('BAD_REQUEST');
    expect(parsed.error.message).toBe(WERKZEUG_405);
  });

  it('ApiError 携带 code/message/status', () => {
    const e = new ApiError('NOT_FOUND', '不存在', 404);
    expect(e.code).toBe('NOT_FOUND');
    expect(e.message).toBe('不存在');
    expect(e.status).toBe(404);
  });
});
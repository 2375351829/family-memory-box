// 集成测试 #10 · 框架级兜底（404/405/尾斜杠/超大体/静态入口）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { setupTestEnv, rmrf } from './辅助-夹具-helpers.mjs';
import { WERKZEUG_404, WERKZEUG_405 } from '../../模块-node-响应-response.mjs';

let env;
beforeAll(() => { env = setupTestEnv(); });
afterAll(() => { rmrf(env.tmp); });

// 分块（Transfer-Encoding: chunked）发送超大体：此时无 Content-Length，全局头检查跳过，
// 由 jsonBodyParser 累积超限后回 413 并 req.resume() 排空请求体，连接不会 RST，
// 响应可被完整读取（相比声明 Content-Length 的路径更确定，避免 TCP RST 丢弃响应）。
function chunkedPost(app, path, chunkCount, chunkSize) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; server.close(); resolve(r); } };
    server.on('listening', () => {
      const port = server.address().port;
      const req = http.request(
        { host: '127.0.0.1', port, method: 'POST', path, headers: { 'Content-Type': 'application/json; charset=utf-8' }, agent: false },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (c) => { data += c; });
          res.on('end', () => finish({ status: res.statusCode, text: data }));
          res.on('close', () => finish({ status: res.statusCode, text: data }));
        }
      );
      req.on('error', (e) => { if (!settled) { settled = true; server.close(); reject(e); } });
      const chunk = 'a'.repeat(chunkSize);
      for (let i = 0; i < chunkCount; i += 1) req.write(chunk);
      req.end();
    });
  });
}

describe('404 / 405 兜底', () => {
  it('未匹配路由 → 404 NOT_FOUND + Werkzeug 原文', async () => {
    const res = await env.api.get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe(WERKZEUG_404);
    expect(res.text.endsWith('\n')).toBe(true);
  });

  it('方法不匹配（POST /api/health）→ 405 且 code=BAD_REQUEST + Werkzeug 原文', async () => {
    const res = await env.api.post('/api/health');
    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.message).toBe(WERKZEUG_405);
  });

  it('DELETE /api/export/json（已定义路径方法不符）→ 405', async () => {
    const res = await env.api.delete('/api/export/json');
    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('/api/members/abc（非整数 id）→ 404（等价 Flask <int:> 转换器未匹配）', async () => {
    const res = await env.api.get('/api/members/abc');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('/api/members/（尾斜杠，strict routing）→ 404', async () => {
    const res = await env.api.get('/api/members/');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('请求体上限', () => {
  it('>16MB JSON body → 413「请求体超过 16MB 上限」', async () => {
    // 18 × 1MB = 18MB > 16MB
    const res = await chunkedPost(env.app, '/api/members', 18, 1024 * 1024);
    expect(res.status).toBe(413);
    const parsed = JSON.parse(res.text);
    expect(parsed.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(parsed.error.message).toBe('请求体超过 16MB 上限');
  });
});

describe('静态入口', () => {
  it('GET / → 返回 index.html（text/html）', async () => {
    const res = await env.api.get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('家庭童年回忆话题盒子');
  });

  it('GET /static/<中文资源> → 200 且返回 JS', async () => {
    const res = await env.api.get('/static/模块-接口-api.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('exportJsonUrl');
  });
});
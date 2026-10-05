// 模块-node-应用-app.mjs
// createApp(options) 工厂：请求级 DB 连接、body 限制、路由注册、404/405 兜底、错误处理
// options = { dataDir, uploadDir, dbPath, staticDir, topicsJsonPath, logLevel }
import express from 'express';
import { normalizeConfig, BODY_LIMIT } from './模块-node-配置-config.mjs';
import { openDb, categoryOrderOf } from './模块-node-数据库-db.mjs';
import { ApiError, HTTP_CODE_MAP, err, notFound, methodNotAllowed } from './模块-node-响应-response.mjs';
import { registerCoreRoutes } from './模块-node-路由-核心-core.mjs';
import { registerStoryRoutes } from './模块-node-路由-故事-stories.mjs';
import { registerBackupRoutes } from './模块-node-路由-备份-backup.mjs';
import { registerCapsuleRoutes } from './模块-node-路由-胶囊-capsules.mjs';
import { registerStaticRoutes } from './模块-node-路由-静态-static.mjs';

// 已定义路由的「路径 → 允许方法」表，用于方法不匹配时返回 405（对照 Flask 行为）
const ROUTE_PATTERNS = [
  /^\/api\/health$/,
  /^\/api\/state$/,
  /^\/api\/members$/,
  /^\/api\/members\/\d+$/,
  /^\/api\/topics$/,
  /^\/api\/topics\/\d+$/,
  /^\/api\/draw$/,
  /^\/api\/stories$/,
  /^\/api\/stories\/\d+$/,
  /^\/api\/stories\/\d+\/photos$/,
  /^\/api\/photos\/\d+$/,
  /^\/uploads\/[^/]+$/,
  /^\/api\/memoir$/,
  /^\/api\/export\/json$/,
  /^\/api\/import\/json$/,
  /^\/api\/capsules$/,
  /^\/api\/capsules\/\d+\/open$/,
  /^\/static\/.+$/,
  /^\/$/,
];

/** 每请求一个数据库连接（懒加载；请求结束关闭）；PRAGMA 由 openDb 统一开启 */
function dbMiddleware(dbPath) {
  return (req, res, next) => {
    let conn = null;
    Object.defineProperty(req, 'db', {
      configurable: true,
      get() {
        if (conn === null) conn = openDb(dbPath);
        return conn;
      },
    });
    const close = () => {
      if (conn) {
        try {
          conn.close();
        } catch {
          /* 已关闭 */
        }
        conn = null;
      }
    };
    res.on('finish', close);
    res.on('close', close);
    next();
  };
}

/** JSON 请求体解析：仅 application/json 与 application/*+json；失败/空 → req.body=undefined */
function jsonBodyParser(req, res, next) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  const mime = ct.split(';')[0].trim();
  if (!(mime === 'application/json' || mime.endsWith('+json'))) return next();
  const chunks = [];
  let size = 0;
  let done = false;
  req.on('data', (chunk) => {
    if (done) return;
    size += chunk.length;
    if (size > BODY_LIMIT) {
      done = true;
      err(res, 'PAYLOAD_TOO_LARGE', '请求体超过 16MB 上限', 413);
      req.resume();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (done) return;
    done = true;
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw.trim()) {
      req.body = undefined;
      return next();
    }
    try {
      req.body = JSON.parse(raw);
    } catch {
      req.body = undefined;
    }
    return next();
  });
  req.on('error', (e) => {
    if (done) return;
    done = true;
    next(e);
  });
  return undefined;
}

/** 全局错误处理：ApiError / HTTPException / 未处理异常（不暴露堆栈） */
function errorHandler(e, req, res, next) {
  if (res.headersSent) return next(e);
  if (e instanceof ApiError) return err(res, e.code, e.message, e.status);
  if (e && e.name === 'MulterError') {
    const status = e.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return err(res, status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST', e.message, status);
  }
  const status = e && (e.status || e.statusCode);
  if (status && HTTP_CODE_MAP[status]) {
    return err(res, HTTP_CODE_MAP[status], e.description || e.message || '', status);
  }
  // 事务内异常已由调用点 ROLLBACK；此处仅兜底
  console.error('未处理异常：', e);
  return err(res, 'INTERNAL', '服务器内部错误', 500);
}

export function createApp(options = {}) {
  const config = normalizeConfig(options);
  const categoryOrder = categoryOrderOf(config.topicsJsonPath);

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.set('strict routing', true);
  app.set('case sensitive routing', true);
  app.set('query parser', 'simple');

  const ctx = { config, categoryOrder };

  // 请求级 DB 连接
  app.use(dbMiddleware(config.dbPath));

  // 普通接口统一 16MB 上限；导入路由（/api/import/json）豁免，路由内自查 512MB
  app.use((req, res, next) => {
    if (req.path === '/api/import/json') return next();
    const cl = Number(req.headers['content-length']);
    if (Number.isFinite(cl) && cl > BODY_LIMIT) {
      return err(res, 'PAYLOAD_TOO_LARGE', '请求体超过 16MB 上限', 413);
    }
    return next();
  });

  // JSON 请求体解析
  app.use(jsonBodyParser);

  // 路由注册
  registerStaticRoutes(app, ctx);
  registerCoreRoutes(app, ctx);
  registerStoryRoutes(app, ctx);
  registerBackupRoutes(app, ctx);
  registerCapsuleRoutes(app, ctx);

  // 404 / 405 兜底（方法不匹配 → 405 BAD_REQUEST；未匹配 → 404 NOT_FOUND）
  app.use((req, res) => {
    const p = req.path;
    for (const re of ROUTE_PATTERNS) {
      if (re.test(p)) return methodNotAllowed(res);
    }
    return notFound(res);
  });

  // 错误处理
  app.use(errorHandler);

  return app;
}
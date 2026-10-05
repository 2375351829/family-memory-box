// 模块-node-路由-静态-static.mjs
// 前端入口：GET / → static/index.html；/static/* 静态资源（含中文文件名）
import path from 'node:path';
import express from 'express';

export function registerStaticRoutes(app, ctx) {
  const { staticDir } = ctx.config;

  // GET / → static/index.html（对照 app.py index()）
  app.get('/', (req, res, next) => {
    res.sendFile(path.join(staticDir, 'index.html'), (e) => {
      if (e && !res.headersSent) next(e);
    });
  });

  // /static/* 静态服务（index:false 以对齐 Flask 静态路由不提供目录索引的行为）
  app.use('/static', express.static(staticDir, { index: false }));
}
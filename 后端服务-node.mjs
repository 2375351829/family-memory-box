// 后端服务-node.mjs
// Node.js 后端入口（与 Python Flask 版 后端服务-app.py 功能等价，双实现共存）
// 流程：loadConfig → initDb → createApp → listen
import { loadConfig } from './模块-node-配置-config.mjs';
import { initDb } from './模块-node-数据库-db.mjs';
import { createApp } from './模块-node-应用-app.mjs';

const config = loadConfig(process.env);

// 启动初始化：建表 + 写 schema_version + 导入种子 + 预建上传目录
initDb(config);

const app = createApp(config);

app.listen(config.port, config.host, () => {
  console.log(
    `家庭回忆话题盒子 · 后端已启动：http://${config.host}:${config.port} （数据目录：${config.dataDir}）`
  );
});
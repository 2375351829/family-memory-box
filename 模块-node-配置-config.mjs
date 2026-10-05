// 模块-node-配置-config.mjs
// PROJECT_ROOT 由 import.meta.url 推导，不受启动目录影响（对照 app.py 的 os.path.dirname(os.path.abspath(__file__))）
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
// 本文件位于项目根目录，取其所在目录即 PROJECT_ROOT
export const PROJECT_ROOT = path.dirname(__filename);

// 请求体上限：普通接口 16MB（全局兜底）；导入接口单独 512MB（备份含照片 base64）
export const BODY_LIMIT = 16 * 1024 * 1024;
export const IMPORT_LIMIT = 512 * 1024 * 1024;

// 上传照片：白名单扩展名 + 单文件大小上限
export const PHOTO_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
export const PHOTO_MAX_SIZE = 10 * 1024 * 1024;

// 数据库 schema 版本（meta.schema_version）
export const SCHEMA_VERSION = '1';

// 话题种子与静态目录（文件名含连字符不可 import，只能运行时读取）
export const DEFAULT_TOPICS_JSON = path.join(PROJECT_ROOT, '数据-话题库-topics.json');
export const DEFAULT_STATIC_DIR = path.join(PROJECT_ROOT, 'static');

/**
 * 归一化配置：把可选传入项补默认值并解析为绝对路径。
 * 供 createApp(options) 与 initDb(options) 共用，保证测试可注入独立目录。
 */
export function normalizeConfig(options = {}) {
  const dataDir = path.resolve(options.dataDir ?? './data');
  return {
    dataDir,
    uploadDir: options.uploadDir ? path.resolve(options.uploadDir) : path.join(dataDir, 'uploads'),
    dbPath: options.dbPath ? path.resolve(options.dbPath) : path.join(dataDir, 'family_memory.db'),
    staticDir: options.staticDir ? path.resolve(options.staticDir) : DEFAULT_STATIC_DIR,
    topicsJsonPath: options.topicsJsonPath ? path.resolve(options.topicsJsonPath) : DEFAULT_TOPICS_JSON,
    logLevel: options.logLevel ?? 'info',
  };
}

/** 从环境变量读取配置（DATA_DIR 默认 ./data，与 app.py 一致） */
export function loadConfig(env = process.env) {
  const base = normalizeConfig({
    dataDir: env.DATA_DIR,
    staticDir: env.STATIC_DIR,
    topicsJsonPath: env.TOPICS_JSON,
    logLevel: env.LOG_LEVEL,
  });
  return {
    ...base,
    port: Number(env.PORT ?? 5000),
    host: env.HOST ?? '0.0.0.0',
  };
}
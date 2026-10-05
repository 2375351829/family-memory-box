# 家庭回忆话题盒子 · Node.js 版 运行与测试说明

> 本文档为 **Node.js 版**（新增，与 Python Flask 版共存）的本地开发、部署与测试指南。
> Python 版部署仍以根目录 `README.md` 为准，两者互不影响、可同时运行。
> 相关方案：《家庭回忆话题盒子-Node双实现与自动化测试方案》（`.trae/documents/`）。

## 一、架构一句话

Python 版（`后端服务-app.py`，端口 5000/宿主 8080）与 Node.js 版（`后端服务-node.mjs`，端口 5000/宿主 8088）**功能等价、共享同一套前端与 SQLite 数据库**；Node 版通过 23 端点集成测试 + E2E 全流程验证等价性。测试报告由 Vitest 与 Playwright 生成至 `测试-tests/报告-reports/`。

## 二、环境要求

| 项 | 要求 |
|----|------|
| Node.js | ≥ 24（本项目在 v25.9.0 开发验证；SQLite 走内置 `node:sqlite`，无需编译原生模块） |
| Docker | 容器部署需要（可选；本机未装时 `docker:*` 命令会显式提示跳过） |
| 浏览器 | E2E 复用系统 Microsoft Edge（无需下载浏览器） |

## 三、本地直跑（开发与使用）

```bash
npm install            # 首次
npm start              # 生产启动 http://127.0.0.1:5000
npm run dev            # 开发热重载（--watch）
```

- 未创建 `.env` 时全部走默认值（数据目录 `./data`、端口 5000），开箱即用。
- 与 Python 版直跑（固定 5000）并行时：复制 `.env.example` 为 `.env` 并设 `PORT=5001`。
- 环境变量模板与解释见 `.env.example`（分区注释）。

## 四、容器化部署

```bash
npm run docker:up      # 等价 docker compose -f docker-compose.node.yml up -d --build
                       # 访问 http://<主机>:8088
npm run docker:down
```

- 与 Python 版容器（宿主 8080）**并存不冲突**：服务名/容器名/镜像/端口全隔离，共享 `./data`。
- 数据卷必须本机磁盘（WAL 依赖共享内存，禁用 SMB/CIFS/NFS）。
- 健康检查：`docker ps` 显示 `family-memory-box-node (healthy)`（探针打容器内 `/api/health`）。
- 镜像多阶段：`prod` 生产 / `test` 测试（含 devDependencies 与测试目录）。
- 本机无 Docker 时执行 `docker:*` 会**显式提示跳过**并给出等价本地验证命令，不会静默假装成功。

## 五、自动化测试

| 命令 | 层级 | 说明 |
|------|------|------|
| `npm run test:unit` | 单元 | 抽题算法（对照 Python 版单测移植）、字段校验、响应包装、时间格式。37 例 |
| `npm run test:integration` | 集成 | 23 端点全覆盖 + 边界（413/415/魔数/称谓唯一 409/VERSION_MISMATCH/级联删文件/胶囊到期/405/404）。79 例 |
| `npm run test:e2e` | 端到端 | Playwright：完整流程 + 390px 移动端 + 导入导出往返。3 例（桌面/移动两 project） |
| `npm run test:all` | 全量 | 三条依次执行 |

- **报告**：`测试-tests/报告-reports/`（Vitest JSON ×2 + Playwright HTML/JSON）。
- **隔离**：集成测试用系统临时目录建独立库；E2E 用 `.env.e2e` 指向 `.tmp-e2e/`；**不触碰 `data/`**。
- **容器模式**（需 Docker，端口 8088）：
  - `npm run test:integration:docker` — 容器内执行集成测试（临时数据目录，报告写回宿主机）
  - `npm run test:e2e:docker` — 宿主机 Playwright 对容器服务执行 E2E
  - 两命令内部均做 Docker 环境预检（无 Docker 则显式跳过）

## 六、一致性说明

- 两版对**同一数据文件**的读写格式一致：`stories.followups` 存储文本与 Python `json.dumps` 输出逐字相同。
- Node 版 18 项读路径与 Python 版做过双实现对照验收，零差异（含 404/405/400 错误路径与 export 结构）。
- 响应体序列化复刻 Python `json.dumps` 风格（`, ` / `: ` 分隔空格 + 中文不转义），实测与 Python 版逐字节一致。

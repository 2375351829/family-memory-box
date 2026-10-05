// 脚本-docker预检-docker-guard.mjs
// Docker 环境预检 + 命令委托：所有容器相关的 npm scripts 统一经本脚本执行。
// 设计原则：Docker 不可用时【显式提示跳过】，绝不静默通过、绝不假装成功（exit 0 表示"已显式跳过"）。
//
// 用法（由 package.json scripts 调用）：
//   node 脚本-docker预检-docker-guard.mjs up                → docker compose up -d --build（生产容器）
//   node 脚本-docker预检-docker-guard.mjs down              → docker compose down
//   node 脚本-docker预检-docker-guard.mjs test:integration  → 容器内执行集成测试（--profile test run node-tests）
//   node 脚本-docker预检-docker-guard.mjs test:e2e          → 宿主机 Playwright 对容器服务执行 E2E（PW_BASE_URL）
import { spawnSync } from 'node:child_process';

const COMPOSE_FILE = 'docker-compose.node.yml';
const COMPOSE = ['compose', '-f', COMPOSE_FILE];
const CONTAINER_BASE_URL = process.env.NODE_GUARD_BASE_URL || 'http://127.0.0.1:8088';
const KNOWN = ['up', 'down', 'test:integration', 'test:e2e'];

/** Docker 可用性预检：docker version 能返回服务端版本即视为可用 */
function dockerAvailable() {
  const r = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    stdio: 'pipe',
    encoding: 'utf8',
  });
  return r.status === 0;
}

/** 透传式执行（继承 stdio，Windows 下 shell:false 避免中文路径被 cmd 破坏） */
function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...extraEnv },
  });
  return r.status ?? 1;
}

function printSkipNotice() {
  console.log('');
  console.log('============================================================');
  console.log('⚠️  Docker 不可用（docker version 执行失败）——已跳过容器操作，未执行任何命令。');
  console.log('');
  console.log('   原因：本机未安装 Docker / Docker Desktop，或 docker 不在 PATH 中。');
  console.log('   安装 Docker Desktop（Windows 需 WSL2）后重跑本命令即可完成容器验证。');
  console.log('');
  console.log('   本轮请使用本地等价验证：');
  console.log('     npm start                  # Node 直跑（http://127.0.0.1:5000）');
  console.log('     npm run test:unit          # 单元测试');
  console.log('     npm run test:integration   # 集成测试（进程内 supertest）');
  console.log('     npm run test:e2e           # E2E（自动拉起本地服务）');
  console.log('');
  console.log('   环境具备后的容器验证：');
  console.log('     npm run docker:up          # 构建并启动容器（宿主 8088）');
  console.log('     npm run test:integration:docker   # 容器内跑集成测试');
  console.log('     npm run test:e2e:docker           # 对容器服务跑 E2E');
  console.log('============================================================');
  console.log('');
}

const action = process.argv[2];
if (!KNOWN.includes(action)) {
  console.error(`用法：node 脚本-docker预检-docker-guard.mjs <${KNOWN.join(' | ')}>`);
  process.exit(2);
}

if (!dockerAvailable()) {
  printSkipNotice();
  process.exit(0); // 显式跳过：环境不具备 ≠ 测试失败；提示已醒目输出，不静默
}

let code = 1;
switch (action) {
  case 'up':
    code = run('docker', [...COMPOSE, 'up', '-d', '--build']);
    break;
  case 'down':
    code = run('docker', [...COMPOSE, 'down']);
    break;
  case 'test:integration':
    // --profile test 激活测试服务；run 只启动该服务，不影响已运行的 app 容器
    code = run('docker', [...COMPOSE, '--profile', 'test', 'run', '--rm', '--build', 'node-tests']);
    break;
  case 'test:e2e':
    console.log(`提示：E2E 将对容器服务 ${CONTAINER_BASE_URL} 执行。`);
    console.log(`      前置条件：已执行 npm run docker:up 且容器 healthy（docker ps 可查）。`);
    code = run(process.execPath, ['node_modules/@playwright/test/cli.js', 'test'], {
      PW_BASE_URL: CONTAINER_BASE_URL,
    });
    break;
}

if (code !== 0) {
  console.error(`❌ 容器操作失败（exit=${code}）：${action}（compose 文件：${COMPOSE_FILE}）`);
} else {
  console.log(`✅ 容器操作完成：${action}`);
}
process.exit(code);
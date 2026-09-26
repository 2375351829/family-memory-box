# 家庭回忆话题盒子 · NAS 部署与运维手册

面向家庭 NAS 用户的部署、备份、升级与故障排查说明。无需懂编程，按步骤照做即可。

- **应用**：Flask + SQLite（Python 3.12）家庭回忆话题盒子
- **访问方式**：同网段手机 / 平板 / 电脑浏览器打开 `http://<NAS-IP>:8080`
- **数据位置**：全部数据（故事、照片、家庭成员、时间胶囊）都在宿主机的 `data/` 目录里，与代码分离
- **隐私提示**：本应用**仅供家庭内网使用，请勿直接暴露到公网**（如需公网访问，请自行在反代层加访问口令）

---

## 一、环境要求

- NAS 支持 Docker / Docker Compose（群晖、fnOS 等均可，x86 或 ARM 均可）
- NAS 上能通过 SSH 或 Docker 套件的「终端」执行 `docker compose` 命令
- 建议为应用预留至少 1GB 空间（照片会持续增长）

---

## 二、部署（5 步）

> 下面命令中的 `/vol1/1000/family-memory-box` 请替换为你 NAS 上的实际路径。

### 第 1 步：上传项目目录到 NAS

把整个 `家庭回忆话题盒子-family-memory-box` 目录上传到 NAS，例如放到 `/vol1/1000/family-memory-box`。

### 第 2 步：把卷路径改为 NAS 本地绝对路径

编辑目录里的 `docker-compose.yml`，把

```yaml
volumes: ["./data:/data"]
```

改成 NAS 上的**本地绝对路径**（示例）：

```yaml
volumes: ["/vol1/1000/family-memory-box/data:/data"]
```

> ⚠️ 该路径必须是 NAS **本机磁盘**上的目录，**严禁**填 SMB / CIFS / NFS 网络挂载点。原因见「五、WAL 与卷路径警告」。

### 第 3 步：修正数据目录属主（首次部署必做）

在 NAS 上执行（群晖等可能需要在命令前加 `sudo`）：

```sh
cd /vol1/1000/family-memory-box
mkdir -p data/uploads
chown -R 1000:1000 data
```

> 原因见「六、常见故障排查 · 4」：若跳过此步，`data/` 可能被 Docker 以 root:root 创建，容器内 uid 1000 无权写入会启动失败。

### 第 4 步：构建并启动

```sh
cd /vol1/1000/family-memory-box
docker compose up -d --build
```

首次构建需下载基础镜像并安装依赖，耗时几分钟属正常。

### 第 5 步：访问与验证

1. 浏览器打开 `http://<NAS-IP>:8080`，能看到首页即部署成功。
2. 命令行验证健康状态（可选）：

   ```sh
   docker ps                 # 状态列应显示 (healthy)
   curl http://<NAS-IP>:8080/api/health
   ```

   `/api/health` 返回 `{"ok":true,...,"status":"ok"}` 即正常。

---

## 三、备份（两种方式，任选其一，建议都做）

### 方式一：页面导出 JSON（推荐日常使用）

在应用页面内点击「导出备份」，会下载一个 `family-memory-backup-YYYYMMDD.json` 文件，**包含全部文字数据与照片（base64 内嵌）**，单独一个文件即可完整还原。

> 也可直接访问 `http://<NAS-IP>:8080/api/export/json` 下载。恢复时在页面内「导入备份」上传该文件即可（导入为**覆盖式**，会清空当前数据后灌入备份）。

### 方式二：整体拷贝 `data/` 目录（最彻底）

停止容器后，把数据目录整个复制走即可：

```sh
docker compose stop
cp -r /vol1/1000/family-memory-box/data /volume1/backup/family-memory-box-data-$(date +%Y%m%d)
docker compose start
```

> `data/` 内包含 `family_memory.db`（SQLite 库）与 `uploads/`（照片原图）。拷走它等于拷走全部数据。

---

## 四、升级

数据与代码是分离的：**数据只在 `data/` 目录里**，替换代码不会影响数据。

1. 用新版本代码替换项目目录内的代码文件（`后端服务-app.py`、`static/` 等），**保留 `data/` 目录不动**；
2. 执行：

   ```sh
   cd /vol1/1000/family-memory-box
   docker compose up -d --build
   ```

3. 刷新页面，数据照旧。

---

## 五、危险操作与 WAL 警告（务必阅读）

### 1. `docker compose down -v` 会删除数据卷

`-v` 参数会删除容器关联的数据卷，**`data/` 内全部故事与照片将丢失且不可恢复**。

- 正常停服请用 `docker compose stop` 或 `docker compose down`（**不带 `-v`**）；
- 若确实要执行 `docker compose down -v`，**执行前必须先完成一次备份**（见第三节）；
- 万一误删：只能从最近一次的 JSON 备份导入还原，或在「方式二」的目录副本中找回。

### 2. 卷必须映射 NAS 本地路径，禁止网络挂载点

SQLite 使用 **WAL 日志模式**，它依赖共享内存（`-shm` 文件）实现多线程并发写。**SMB / CIFS / NFS 等网络文件系统上 WAL 不可用**，会导致并发写失败甚至数据库损坏。

- ✅ 正确：`/vol1/1000/family-memory-box/data`（NAS 本机磁盘）
- ❌ 错误：`/mnt/smb-share/...`、`/volume1/网络挂载/...` 等任何网络映射路径

### 3. 不要删除镜像内 `LANG=C.UTF-8` 环境变量

镜像入口文件名含中文（`后端服务-app.py`），依赖 `LANG=C.UTF-8` 才能正确解析；删除会导致构建或启动失败。该变量已在 `Dockerfile` 中设置，请勿删改。

---

## 六、常见故障排查

### 1. 端口 8080 被占用（启动报 `port is already allocated` / 打不开）

8080 是 NAS 上的常见占用端口。编辑 `docker-compose.yml`，把映射改成其他宿主端口（例如 8081）：

```yaml
ports: ["8081:5000"]     # 冒号右边是容器内端口，不要改
```

改完执行 `docker compose up -d --build`，然后访问 `http://<NAS-IP>:8081`。

### 2. NAS 用户 uid 不是 1000（页面能开但无法保存 / 上传报错）

不同 NAS 的用户 uid 不同（群晖常见 1026，fnOS 常见 1000）。先在 NAS 上执行 `id` 查看当前用户 uid:gid，然后把 `docker-compose.yml` 里的

```yaml
user: "1000:1000"
```

改成实际的 `uid:gid`，并同步修正宿主机数据目录属主：

```sh
chown -R <你的uid>:<你的gid> /vol1/1000/family-memory-box/data
```

最后 `docker compose up -d --build`。

### 3. 容器一直 unhealthy / 反复重启

查看日志定位原因：

```sh
docker compose logs --tail=100
```

- 若提示 **权限拒绝（Permission denied）** → 见本节第 4 条（数据目录属主问题）；
- 若提示 **端口占用 / 数据库被锁** → 检查是否同时启动了多个实例；
- 冷启动首次健康检查失败属正常（`start_period` 已留 10 秒余量），持续 unhealthy 再看日志。

### 4. 数据目录属主为 root，容器无写权限（首次部署最常见）

若首次部署时**没做**「二、部署 · 第 3 步」的 `chown`，Docker 可能把宿主 `data/` 目录创建成 `root:root`，导致容器内 uid 1000 无权写入，表现为：页面能打开但一保存/上传就报错，或容器直接启动失败。

修正（群晖等可能需 `sudo`）：

```sh
cd /vol1/1000/family-memory-box
docker compose down
mkdir -p data/uploads
chown -R 1000:1000 data
docker compose up -d --build
```

> 若你的 NAS 用户 uid 不是 1000，请把上面 `chown` 的 `1000:1000` 和第 2 条一起改成实际 `uid:gid`。

---

## 附：目录与文件说明

| 路径 | 说明 |
|------|------|
| `Dockerfile` | 镜像构建文件（含时区数据、中文环境变量、非 root 用户） |
| `docker-compose.yml` | 编排配置（端口 8080→5000、卷映射、日志轮转、健康检查） |
| `.dockerignore` | 构建时排除 `data/` 等，避免把演示数据打进镜像 |
| `data/` | **你的全部数据**（SQLite 库 + 上传照片），备份就备它 |
| `后端服务-app.py` | 应用入口 |

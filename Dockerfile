FROM python:3.12-slim

# tzdata 必须装：slim 镜像无时区数据，SQLite datetime('now','localtime') 会退化为 UTC（见 3.2）
# LANG=C.UTF-8：入口文件名含中文（后端服务-app.py），避免 C locale 下编码问题
ENV TZ=Asia/Shanghai \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 数据目录预建并授权给 1000:1000（与 compose 的 user 一致）
RUN mkdir -p /data/uploads && chown -R 1000:1000 /data /app

USER 1000:1000
EXPOSE 5000
CMD ["python", "后端服务-app.py"]

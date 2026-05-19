# PetPal 部署到阿里云 ECS（学生算力包）

## 准备

阿里云 ECS 已开通：
- 规格：2C 4G u2a（推荐）/ 4C 8G u2a
- 系统：Ubuntu 22.04 64 位
- 安全组：开放 22 (SSH) + 80 (HTTP) + 8000 (备用)
- 公网 IP：`<YOUR_IP>`

本地准备：
- `.env` 文件（含 `OPENROUTER_API_KEY` / `AMAP_KEY` 等）
- git clone 完整代码

---

## Step 1: SSH 上 ECS

```bash
ssh root@<YOUR_IP>
# 输入控制台设置的密码
```

## Step 2: 装 Docker（一次性）

```bash
# 用阿里云镜像装 docker（国内速度快）
curl -fsSL https://get.docker.com | bash -s docker --mirror Aliyun

# 启动 + 开机自启
systemctl enable docker
systemctl start docker

# 验证
docker --version
docker compose version
```

## Step 3: 拷代码上 ECS

**方案 A（推荐）：git clone**

```bash
mkdir -p /opt/petpal
cd /opt/petpal
git clone <你的仓库地址> .
# 如果没 push 到 GitHub：用 scp 从本地传
```

**方案 B：scp 从本地（Windows PowerShell）**

```powershell
# 本地打包
cd C:\Users\90968\Desktop\pet
tar --exclude='.venv' --exclude='node_modules' --exclude='data/chroma' --exclude='web/dist' -czf petpal.tar.gz .

# 上传
scp petpal.tar.gz root@<YOUR_IP>:/opt/

# ECS 上解压
ssh root@<YOUR_IP>
mkdir -p /opt/petpal
cd /opt/petpal
tar -xzf /opt/petpal.tar.gz
```

## Step 4: 配 .env

```bash
cd /opt/petpal
cat > .env <<'EOF'
OPENROUTER_API_KEY=sk-or-v1-xxx
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
VLM_MODEL=openai/gpt-4o-mini
LLM_MODEL=openai/gpt-4o-mini

AMAP_KEY=你的高德 key

# Email 留空 → dry-run 模式
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
ALERT_TO=

APP_ENV=production
PETPAL_DEV_MODE=0
EOF

chmod 600 .env
```

## Step 5: 启动

```bash
cd /opt/petpal
docker compose up -d --build

# 看日志（首次启动会下载 BGE 模型 ~200MB，ingest KB 约 1-2 分钟）
docker compose logs -f backend
# Ctrl+C 退出日志（容器还在跑）

# 验证
curl http://localhost/api/health
# 应返回 {"ok":true,"service":"petpal",...}
```

## Step 6: 浏览器访问

```
http://<YOUR_IP>/
```

应该能看到 PetPal 主页。

---

## 持续更新流程

本地改完代码 → push GitHub → ECS 上：

```bash
cd /opt/petpal
git pull
docker compose up -d --build
```

约 30-60 秒，零停机（depends_on healthcheck 等 backend 起来才切 frontend）。

---

## 故障排查

### 容器没起来
```bash
docker compose ps
docker compose logs backend
docker compose logs frontend
```

### 端口冲突
```bash
# 看 80 端口被谁占了
lsof -i :80
# 通常是系统默认 nginx，关掉：
systemctl stop nginx
systemctl disable nginx
```

### 内存不够（OOM）
```bash
# 看内存
free -h
# 看容器占用
docker stats --no-stream
# 如果 2G 不够，加 swap：
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 重新 ingest KB
```bash
docker compose down
rm -rf data/chroma/
docker compose up -d --build
```

---

## 后续：备案 + HTTPS（可选，备案完成后做）

1. 域名解析 A 记录指到 ECS IP
2. 改 `docker-compose.yml`，frontend 容器 ports 加 `"443:443"`
3. 改 `nginx.conf` 加 SSL 证书路径 + Let's Encrypt certbot 自动续期
4. 备案号需要在前端页面 footer 显示（管局要求）

我们到时再写。

---

## 关机省钱

阿里云 ECS 按量付费（学生算力包抵）：
```bash
# 在控制台「停机」（保留实例，停 vCPU+内存计费，但系统盘+IP 保留费照算）
# 想用时再「启动」
```

不想用了直接「释放实例」彻底停。

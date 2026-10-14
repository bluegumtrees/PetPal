# PetPal 部署到 Oracle Cloud Always Free（海外机房）

和 [DEPLOY.md](DEPLOY.md)（阿里云）同一套 Docker Compose，差异只有三处：机器是 ARM、网络全部直连官方源、防火墙有两层。
本文记录 2026-10 从阿里云 ECS 迁到 Oracle 大阪区域的实际步骤。

## 机器规格

| 项目 | 值 |
|---|---|
| 区域 | Japan Central (Osaka)，家庭区域，只有 AD-1 |
| 机型 | VM.Standard.A1.Flex（Ampere ARM，Always Free） |
| 规格 | 2 OCPU / 8 GB（2026-06-15 起免费上限 2 OCPU / 12 GB） |
| 镜像 | Canonical Ubuntu 22.04 aarch64 |
| 引导盘 | 默认 47 GB（免费额度共 200 GB） |
| 登录 | `ssh -i <私钥> ubuntu@<公网IP>`，用户名是 ubuntu 不是 root |

内存故意不开满 12 GB：纯免费账号连续 7 天 CPU、网络、内存利用率都低于 20% 会被 Oracle 回收闲置实例，
后端常驻 2 到 3 GB 在 8 GB 上超过 20%，光这一条就不会被判闲置。

## 开机

大阪免费池经常 `Out of host capacity`。控制台点不出来就用 [scripts/oci_retry_launch.py](scripts/oci_retry_launch.py)
每分钟自动重试（需要先在控制台 My profile → API keys 生成密钥并写到 `~/.oci/config`）：

```bash
pip install oci
python scripts/oci_retry_launch.py --ssh-key ~/.ssh/oracle.key
```

升级到 Pay As You Go 后容量明显好拿，升级本身不收费，但点 Upgrade 时必须关掉 VPN，否则报
"masking one's location or identity"。

## 防火墙（两层都要开）

1. **VCN 安全组**：Networking → VCN → 子网 → Default Security List → Add Ingress Rules，
   `0.0.0.0/0` TCP 80 和 443。
2. **系统 iptables**：Oracle 的 Ubuntu 镜像默认只放行 22，安全组开了也没用：

```bash
sudo iptables -I INPUT 5 -p tcp -m state --state NEW -m tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 5 -p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT
sudo iptables -D FORWARD -j REJECT --reject-with icmp-host-prohibited   # Docker 转发需要
sudo netfilter-persistent save
```

## 装 Docker + 拉代码

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu          # 重新登录生效
sudo timedatectl set-timezone Asia/Shanghai   # 提醒系统按中国时间
sudo mkdir -p /opt/petpal && sudo chown ubuntu:ubuntu /opt/petpal
git clone https://github.com/bluegumtrees/PetPal.git /opt/petpal
```

## .env

海外机房 **不要** 设任何镜像源变量，`docker-compose.yml` 默认就是官方源。
必填项和阿里云一样：`OPENROUTER_API_KEY`、`AMAP_KEY`、`PETPAL_JWT_SECRET`（`openssl rand -hex 32`）。
首次启动 `HF_HUB_OFFLINE` 必须是 0（默认），容器要联网下 BGE 模型，从日本直连 HuggingFace 只要几十秒。

## 启动与灌数据

```bash
cd /opt/petpal
docker compose up -d --build            # ARM 原生构建，首次约 10 到 15 分钟（torch 最慢）
docker compose logs -f backend          # 看到 "KB ingest complete" + uvicorn 起来即可

# 黄金演示账号（迁移后数据库是空的，必须跑）
docker compose exec backend python scripts/seed_demo.py
docker compose exec backend python scripts/build_health_summaries.py
docker compose restart backend          # 让 APScheduler 重新注册未来提醒
```

验证：`curl http://<公网IP>/api/health` 返回 `{"ok":true,...}`，浏览器打开 `http://<公网IP>/login?demo=1`。

## 域名 + HTTPS（Caddy 自动证书）

海外机房不用备案。在域名的 DNS 里加两条 A 记录（`@` 和 `www`）指向公网 IP，然后 compose 里的 `caddy` 服务
会自动向 Let's Encrypt 申请证书并续期，HTTP 自动 308 跳 HTTPS，纯 IP 访问保留 HTTP 给旧链接过渡。
域名写在仓库根目录的 [Caddyfile](Caddyfile) 里，换域名改那一行再 `docker compose up -d caddy` 即可。
证书存在 `caddy_data` 卷里，`docker compose down -v` 会把它删掉（会重新申请，但 Let's Encrypt 有频率限制，别频繁删）。

当前线上：https://petpal-ai.top ，演示入口 https://petpal-ai.top/login?demo=1 。

## 后续更新

和阿里云一样：本地 push → 服务器 `git pull && docker compose up -d --build`。

## 和阿里云部署的差异一览

| | 阿里云 ECS（杭州） | Oracle（大阪） |
|---|---|---|
| 架构 | x86_64 | aarch64，基础镜像和 pip 轮子都是多架构，不用改代码 |
| Docker Hub / PyPI / HF | 要配镜像加速 | 直连，`.env` 不填镜像变量 |
| 登录用户 | root + 密码 | ubuntu + 私钥 |
| 防火墙 | 只有安全组 | 安全组 + 系统 iptables |
| 备案 | 要 | 不要，可直接上域名 + HTTPS |
| LLM 延迟 | 出境绕路 | OpenRouter 70 ms 可达 |

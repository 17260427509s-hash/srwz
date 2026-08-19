#!/usr/bin/env bash

# 生日祝福生成器：Ubuntu 22.04/24.04 一键部署脚本
# 功能：安装 Node.js 20、Nginx，配置 systemd，并保留独立的 SQLite 数据目录。

set -Eeuo pipefail

APP_DIR="/opt/birthday-blessing"
DATA_DIR="/var/lib/birthday-blessing"
REPOSITORY_URL="https://github.com/17260427509s-hash/srwz.git"
SERVICE_NAME="birthday-blessing"

if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 sudo 运行此脚本。" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "[1/7] 安装系统依赖..."
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg git nginx build-essential python3

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(`.`)[0]' 2>/dev/null || echo 0)" -lt 20 ]]; then
  echo "[2/7] 安装 Node.js 20..."
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y --no-install-recommends nodejs
else
  echo "[2/7] Node.js $(node --version) 已安装。"
fi

echo "[3/7] 获取项目代码..."
if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" fetch --depth 1 origin main
  git -C "${APP_DIR}" reset --hard origin/main
else
  rm -rf "${APP_DIR}"
  git clone --depth 1 --branch main "${REPOSITORY_URL}" "${APP_DIR}"
fi

echo "[4/7] 安装生产依赖..."
cd "${APP_DIR}"
npm ci --omit=dev --no-audit --no-fund
# 部分轻量服务器 CPU 与 npm 的预编译 SQLite 二进制不兼容；在目标机重新编译可避免 SIGSEGV。
npm rebuild better-sqlite3 --build-from-source
chown -R root:root "${APP_DIR}"
chmod -R a+rX "${APP_DIR}"
install -d -o www-data -g www-data -m 0750 "${DATA_DIR}"

echo "[5/7] 配置系统服务..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Birthday Blessing Generator
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=DATA_DIR=${DATA_DIR}
Environment=TRUST_PROXY=1
ExecStart=/usr/bin/node ${APP_DIR}/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"

echo "[6/7] 配置 Nginx..."
cat > "/etc/nginx/sites-available/${SERVICE_NAME}" <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 8m;

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "microphone=(self)" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sfn "/etc/nginx/sites-available/${SERVICE_NAME}" "/etc/nginx/sites-enabled/${SERVICE_NAME}"
nginx -t
systemctl enable --now nginx
systemctl reload nginx

if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null || true
  ufw allow 'Nginx Full' >/dev/null || true
fi

echo "[7/7] 验证服务..."
for attempt in {1..20}; do
  if curl -fsS http://127.0.0.1:3000/ >/dev/null; then
    break
  fi
  if [[ "${attempt}" -eq 20 ]]; then
    systemctl --no-pager --full status "${SERVICE_NAME}" || true
    journalctl -u "${SERVICE_NAME}" -n 80 --no-pager || true
    exit 1
  fi
  sleep 1
done

curl -fsS http://127.0.0.1/ >/dev/null

echo
echo "DEPLOY_OK"
echo "网站服务已启动，SQLite 数据目录：${DATA_DIR}"
echo "下一步：绑定域名并配置 HTTPS。"

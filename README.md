# 生日祝福生成器

一个使用原生 HTML/CSS/JavaScript、Express 和 SQLite 构建的生日祝福小工具。Express 同时提供静态网页和 API；祝福数据保存在服务器的 SQLite 文件中，因此分享链接可以跨设备打开。

## 本地运行

需要 Node.js 22 或更高版本。

```bash
npm install
node server.js
```

浏览器打开：

```text
http://localhost:3000
```

### 用手机验证跨设备分享

`localhost` 在每台设备上都指向设备自身，所以不要把包含 `localhost` 的链接直接发给手机。电脑和手机连接同一个局域网后：

1. 在 Windows 运行 `ipconfig`，找到电脑的 IPv4 地址，例如 `192.168.1.20`。
2. 确认 Windows 防火墙允许 TCP 3000 入站访问。
3. 在电脑或手机上通过 `http://192.168.1.20:3000` 打开生成页。
4. 从这个地址生成的分享链接会自动包含 `192.168.1.20:3000`，同一网络中的其他设备即可打开。

如果要发给互联网中的其他人，需要把项目部署到有公网域名或公网 IP 的服务器，并使用 HTTPS。

修改端口：

```bash
# Linux / macOS
PORT=8080 node server.js

# Windows PowerShell
$env:PORT=8080; node server.js
```

开发时也可以运行 `npm run dev`，Node 会在文件变化后自动重启服务。

## API

### `POST /api/blessings`

接收页面一的祝福记录，服务器校验数据、生成 12 位随机 ID 并写入 SQLite。成功返回：

```json
{ "id": "Abc123_xYz90" }
```

### `GET /api/blessings/:id`

返回对应的完整祝福记录；不存在时返回 HTTP 404。

当前版本会把压缩后的图片和不超过 60 秒的语音以 Data URL 直接保存到 SQLite。服务端限制 JSON 请求体为 6 MB、清洗后的单条记录为 5 MB、图片和音频各自不超过约 2.5 MB。这适合个人项目和小流量使用；如果以后访问量或媒体数量增加，建议把图片/音频迁移到 S3、Cloudflare R2、阿里云 OSS 等对象存储，SQLite 中只保存文件 URL。

## 数据库与备份

默认数据库位置：

```text
data/birthday.sqlite
```

可以使用环境变量覆盖：

```bash
DATABASE_PATH=/var/lib/birthday-blessing/birthday.sqlite node server.js
```

备份时复制 `birthday.sqlite` 即可；如果服务正在写入，建议先停止服务，或同时保留 `-wal` 和 `-shm` 文件。

## 使用 PM2 常驻运行

```bash
npm ci --omit=dev
npm install -g pm2
PORT=3000 NODE_ENV=production pm2 start server.js --name birthday-blessing
pm2 save
pm2 startup
```

`pm2 startup` 会输出一条需要管理员权限执行的命令，按提示执行即可。查看日志：

```bash
pm2 logs birthday-blessing
```

更新代码后：

```bash
pm2 restart birthday-blessing --update-env
```

## 使用 systemd 常驻运行

假设项目部署在 `/opt/birthday-blessing`，Node 位于 `/usr/bin/node`：

```ini
# /etc/systemd/system/birthday-blessing.service
[Unit]
Description=Birthday Blessing Web Service
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/birthday-blessing
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=0.0.0.0
ExecStart=/usr/bin/node /opt/birthday-blessing/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

确保服务用户能写数据库目录，然后启动：

```bash
sudo mkdir -p /opt/birthday-blessing/data
sudo chown -R www-data:www-data /opt/birthday-blessing/data
sudo systemctl daemon-reload
sudo systemctl enable --now birthday-blessing
sudo systemctl status birthday-blessing
```

## 端口与反向代理

默认监听 `0.0.0.0:3000`。如果直接访问服务器，需要在防火墙和云安全组中开放 TCP `3000`：

```bash
sudo ufw allow 3000/tcp
```

正式部署更推荐使用 Nginx/Caddy 将 HTTPS 的 `443` 端口反向代理到本机 `127.0.0.1:3000`。这种情况下不需要把 3000 暴露到公网，只开放 80/443，并把 `HOST` 设置为 `127.0.0.1`。若反向代理需要将真实客户端 IP 传给速率限制，可设置 `TRUST_PROXY=1`。

## 安全与限制

- API 对每个 IP 设置了 15 分钟 120 次的总请求限制；创建祝福额外限制为 15 分钟 20 次。
- 服务端会重新校验文字长度、日期、邮箱、主题、媒体类型和数据大小。
- 静态服务采用白名单，不会公开 `server.js`、数据库和部署文件。
- 当前没有账户和管理后台，知道链接的人都可以查看对应祝福，请不要填写敏感隐私信息。

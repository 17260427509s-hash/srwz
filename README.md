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

接收页面一的祝福记录，服务器校验数据、生成 12 位随机 ID 并写入 SQLite。可选的 `templateId` 支持 `birthday-party`、`bouquet`、`cute-animals`，不选择时传 `null`。成功返回：

```json
{ "id": "Abc123_xYz90" }
```

### `GET /api/blessings/:id`

返回对应的完整祝福记录；不存在时返回 HTTP 404。

图片与可选的语音以 Data URL 保存到 SQLite。最多 7 张照片；JSON 请求体限制为 6 MB，单条记录限制为 5 MB，单张图片不超过约 2.5 MB。新增语音统一转成单声道 64 kbps MP3，沿用 `audio_json`，不迁移数据库，旧记录保持兼容。这适合个人项目和小流量使用；后续可迁移到对象存储，SQLite 中只保存文件 URL。

## 语音留言：安装与验证

- 表单支持一段不超过 60 秒、2.5 MiB 的录音或音频文件（MP3、M4A/MP4、WebM、Ogg、WAV）。失败的替换操作保留原语音；返回修改也会保留。
- 直接录音必须使用 HTTPS 或本机 localhost。局域网 HTTP / 公网 IP HTTP 不具备录音所需安全上下文，但仍能上传文件。iOS 微信仅提供上传入口，提示用 Safari 或系统录音文件。
- 麦克风只在点击开始时申请。权限请求可取消；录制接近 60 秒自动停止（预留编码尾帧），切后台或离开页面释放麦克风。
- 结尾页可试听、暂停、拖动进度、重新播放；语音与背景音乐互斥，不改变已保存的静音选择。
- `audio` 数据格式仍为 `{ mimeType, dataUrl, durationMs }` / `null`。服务器不信任客户端时长，实际解码验证；含视频流（包括内嵌视频封面）的文件会拒绝，超时长不截断。

服务器需安装系统 FFmpeg（包含 ffprobe 与 libmp3lame 编码器）：

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
ffmpeg -version
ffprobe -version
```

Windows 本地开发请安装 FFmpeg 并将其 bin 目录加入 PATH，或者在启动 Node 前指定可信二进制路径：

```powershell
$env:FFMPEG_PATH = 'C:\tools\ffmpeg\bin\ffmpeg.exe'
$env:FFPROBE_PATH = 'C:\tools\ffmpeg\bin\ffprobe.exe'
node server.js
```

转码采用独立临时目录、参数数组（不经过 shell）、仅本地文件协议、总计 30 秒超时、每个 Node 进程最多两个并发任务；结束即清理临时文件。请使用单个 Node 进程部署以保持全站两个并发任务上限。缺少转码工具时语音请求会返回明确的 503，纯文字和照片仍可生成。请求在转码前后都会执行 5 MB 总量检查。

维护参考：[MediaRecorder 文档](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)、[FFmpeg 命令行文档](https://ffmpeg.org/ffmpeg.html)。以上仅为文档链接，网页录音和播放不请求这些网站。

本地验收：在 `http://localhost:3000` 录制或上传短语音 → 试听 → 生成 → 打开分享链接 → 进入结尾 → 播放/拖动/暂停语音，检查背景音乐互斥与“再看一次”归零。使用临时 `DATABASE_PATH` 测试，不要操作生产祝福数据。iPhone Safari、微信、真实麦克风需要真机验收，桌面模拟不能代替。

上线前先安装 FFmpeg，然后停止服务并备份数据库（包括已有 WAL/SHM 文件，或使用 SQLite 在线备份），再更新代码、重启服务。`deploy.sh` 已包含 FFmpeg 安装步骤，但不自动替代数据库备份。上线后用明确命名的“语音上线测试”祝福验证录音、上传、跨设备打开和播放；本次代码修改不会自动部署。

详情页图片按“用户上传照片 → 旧记录中的预制模板 → 对应位置的本地故事素材图”逐个位置降级。7 张故事素材保存在 `assets/story/`；预制 SVG 全部保存在 `assets/templates/`，来自 OpenMoji，遵循 CC BY-SA 4.0 协议，继续用于兼容旧记录。

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

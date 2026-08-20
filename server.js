"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const Database = require("better-sqlite3");

const app = express();
const ROOT_DIR = __dirname;
const PORT = readPort(process.env.PORT, 3000);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_STORED_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 7;
const ID_PATTERN = /^[A-Za-z0-9_-]{12}$/;
const TEMPLATE_IDS = new Set(["birthday-party", "bouquet", "cute-animals"]);

const THEMES = {
  cherry: { key: "cherry", label: "樱桃粉", color: "#ef5b78", softColor: "#fde8ec" },
  sky: { key: "sky", label: "天空蓝", color: "#68b9ec", softColor: "#e5f4fd" },
  china: { key: "china", label: "中国红", color: "#e34643", softColor: "#fde8e7" },
  tiffany: { key: "tiffany", label: "蒂芙尼蓝", color: "#49c2bc", softColor: "#e3f7f5" },
  avocado: { key: "avocado", label: "牛油果绿", color: "#9fc55a", softColor: "#f0f6e3" },
  rose: { key: "rose", label: "玫瑰紫", color: "#a86ed0", softColor: "#f3e9fa" },
  cream: { key: "cream", label: "奶油橙", color: "#f1a158", softColor: "#fff0e1" },
};

const dataDir = path.resolve(process.env.DATA_DIR || path.join(ROOT_DIR, "data"));
fs.mkdirSync(dataDir, { recursive: true });
const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(dataDir, "birthday.sqlite"));
const database = new Database(databasePath);

database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");
database.pragma("busy_timeout = 5000");
database.exec(`
  CREATE TABLE IF NOT EXISTS blessings (
    id TEXT PRIMARY KEY,
    recipient_name TEXT NOT NULL,
    birthday TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    theme_json TEXT NOT NULL,
    message TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    template_id TEXT,
    images_json TEXT NOT NULL DEFAULT '[]',
    audio_json TEXT,
    created_at TEXT NOT NULL,
    likes INTEGER NOT NULL DEFAULT 0 CHECK (likes >= 0)
  );
  CREATE INDEX IF NOT EXISTS idx_blessings_created_at ON blessings(created_at);
`);

// 为旧版 SQLite 数据库补充模板字段，保留已经生成的祝福记录。
const blessingColumns = database.pragma("table_info(blessings)");
if (!blessingColumns.some((column) => column.name === "template_id")) {
  database.exec("ALTER TABLE blessings ADD COLUMN template_id TEXT");
}

const insertBlessing = database.prepare(`
  INSERT INTO blessings (
    id, recipient_name, birthday, sender_name, theme_json,
    message, email, template_id, images_json, audio_json, created_at, likes
  ) VALUES (
    @id, @recipientName, @birthday, @senderName, @themeJson,
    @message, @email, @templateId, @imagesJson, @audioJson, @createdAt, 0
  )
`);

const findBlessing = database.prepare(`
  SELECT id, recipient_name, birthday, sender_name, theme_json,
         message, email, template_id, images_json, audio_json, created_at, likes
  FROM blessings
  WHERE id = ?
`);

if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
  next();
});

app.use("/api", createRateLimiter({ windowMs: 15 * 60 * 1000, max: 120 }));
app.use("/api/blessings", express.json({ limit: "6mb", strict: true, type: "application/json" }));

app.post(
  "/api/blessings",
  createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 }),
  (req, res, next) => {
    try {
      const blessing = validateBlessing(req.body);
      const serializedSize = Buffer.byteLength(JSON.stringify(blessing), "utf8");
      if (serializedSize > MAX_STORED_BYTES) {
        return res.status(413).json({ error: "祝福数据过大，请减少图片或录音后重试" });
      }

      const id = createUniqueId();
      const createdAt = new Date().toISOString();
      insertBlessing.run({
        id,
        recipientName: blessing.recipientName,
        birthday: blessing.birthday,
        senderName: blessing.senderName,
        themeJson: JSON.stringify(blessing.theme),
        message: blessing.message,
        email: blessing.email,
        templateId: blessing.templateId,
        imagesJson: JSON.stringify(blessing.images),
        audioJson: blessing.audio ? JSON.stringify(blessing.audio) : null,
        createdAt,
      });

      res.status(201).json({ id });
    } catch (error) {
      if (error instanceof ValidationError) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  }
);

app.get("/api/blessings/:id", (req, res, next) => {
  try {
    if (!ID_PATTERN.test(req.params.id)) {
      return res.status(400).json({ error: "无效的祝福编号" });
    }

    const row = findBlessing.get(req.params.id);
    if (!row) return res.status(404).json({ error: "没有找到这份祝福" });

    res.setHeader("Cache-Control", "no-store");
    res.json({
      version: 1,
      id: row.id,
      recipientName: row.recipient_name,
      birthday: row.birthday,
      senderName: row.sender_name,
      theme: JSON.parse(row.theme_json),
      message: row.message,
      email: row.email,
      templateId: row.template_id || null,
      images: JSON.parse(row.images_json),
      audio: row.audio_json ? JSON.parse(row.audio_json) : null,
      createdAt: row.created_at,
      likes: row.likes,
    });
  } catch (error) {
    next(error);
  }
});

const STATIC_FILES = new Set([
  "index.html", "detail.html", "styles.css", "detail.css", "script.js", "detail.js",
]);

app.use("/assets", express.static(path.join(ROOT_DIR, "assets"), {
  dotfiles: "deny",
  etag: true,
  fallthrough: true,
  maxAge: process.env.NODE_ENV === "production" ? "7d" : 0,
}));

app.get("/", (_req, res) => res.sendFile(path.join(ROOT_DIR, "index.html")));
app.get("/:file", (req, res, next) => {
  if (!STATIC_FILES.has(req.params.file)) return next();
  res.sendFile(path.join(ROOT_DIR, req.params.file));
});

app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
app.use((_req, res) => res.status(404).type("text").send("404 Not Found"));

app.use((error, _req, res, _next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "请求数据过大，请减少图片或录音后重试" });
  }
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "请求内容不是有效的 JSON" });
  }
  console.error(error);
  res.status(500).json({ error: "服务器暂时无法处理请求" });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Birthday blessing server: http://localhost:${PORT}`);
  console.log(`SQLite database: ${databasePath}`);
});

function validateBlessing(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("请求内容不能为空");
  }

  const recipientName = requiredText(input.recipientName, "寿星昵称", 20);
  const senderName = requiredText(input.senderName, "发送人昵称", 20);
  const message = requiredText(input.message, "祝福语", 240);
  const birthday = validateDate(input.birthday);
  const email = optionalText(input.email, "寿星邮箱", 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError("寿星邮箱格式不正确");
  }

  const themeKey = typeof input.theme?.key === "string" ? input.theme.key : "";
  if (!THEMES[themeKey]) throw new ValidationError("请选择有效的主题色");

  const images = validateImages(input.images);
  const templateId = validateTemplateId(input.templateId);
  const audio = validateAudio(input.audio);
  return { recipientName, birthday, senderName, theme: THEMES[themeKey], message, email, templateId, images, audio };
}

function validateTemplateId(templateId) {
  if (templateId == null || templateId === "") return null;
  if (typeof templateId !== "string" || !TEMPLATE_IDS.has(templateId)) {
    throw new ValidationError("请选择有效的预制插画模板");
  }
  return templateId;
}

function validateImages(images) {
  if (images == null) return [];
  if (!Array.isArray(images) || images.length > MAX_IMAGES) {
    throw new ValidationError(`照片最多上传 ${MAX_IMAGES} 张`);
  }
  return images.map((image, index) => {
    if (!image || typeof image !== "object") throw new ValidationError(`第 ${index + 1} 张照片无效`);
    const name = optionalText(image.name, "照片名称", 255) || `photo-${index + 1}.jpg`;
    const type = typeof image.type === "string" ? image.type.toLowerCase() : "";
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(type)) {
      throw new ValidationError(`第 ${index + 1} 张照片格式不支持`);
    }
    validateDataUrl(image.dataUrl, type, 2.5 * 1024 * 1024, `第 ${index + 1} 张照片`);
    return { name, type, dataUrl: image.dataUrl };
  });
}

function validateAudio(audio) {
  if (audio == null) return null;
  if (typeof audio !== "object" || Array.isArray(audio)) throw new ValidationError("语音留言无效");
  const mimeType = typeof audio.mimeType === "string" ? audio.mimeType.toLowerCase() : "";
  const baseType = mimeType.split(";")[0];
  if (!new Set(["audio/mp4", "audio/webm", "audio/ogg"]).has(baseType)) {
    throw new ValidationError("语音格式不支持");
  }
  validateDataUrl(audio.dataUrl, baseType, 2.5 * 1024 * 1024, "语音留言");
  const durationMs = Number(audio.durationMs);
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 61_000) {
    throw new ValidationError("语音时长无效");
  }
  return { mimeType, dataUrl: audio.dataUrl, durationMs: Math.round(durationMs) };
}

function validateDataUrl(value, expectedType, maxBytes, label) {
  if (typeof value !== "string") throw new ValidationError(`${label}数据无效`);
  const escapedType = expectedType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value.match(new RegExp(`^data:${escapedType}(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$`, "i"));
  if (!match) throw new ValidationError(`${label}数据格式无效`);
  const estimatedBytes = Math.floor(match[1].length * 0.75);
  if (estimatedBytes > maxBytes) throw new ValidationError(`${label}过大`);
}

function requiredText(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim()) throw new ValidationError(`请填写${label}`);
  const text = value.trim();
  if (Array.from(text).length > maxLength) throw new ValidationError(`${label}不能超过 ${maxLength} 个字`);
  return text;
}

function optionalText(value, label, maxLength) {
  if (value == null) return "";
  if (typeof value !== "string") throw new ValidationError(`${label}格式不正确`);
  const text = value.trim();
  if (Array.from(text).length > maxLength) throw new ValidationError(`${label}不能超过 ${maxLength} 个字`);
  return text;
}

function validateDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError("生日日期格式不正确");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ValidationError("生日日期无效");
  }
  return value;
}

function createUniqueId() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = crypto.randomBytes(9).toString("base64url");
    if (!findBlessing.get(id)) return id;
  }
  throw new Error("无法生成唯一祝福编号");
}

function createRateLimiter({ windowMs, max }) {
  const clients = new Map();
  let requestsSinceCleanup = 0;
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    let entry = clients.get(key);
    if (!entry || now - entry.startedAt >= windowMs) {
      entry = { startedAt: now, count: 0 };
      clients.set(key, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil((entry.startedAt + windowMs) / 1000)));
    if (entry.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((entry.startedAt + windowMs - now) / 1000)));
      return res.status(429).json({ error: "请求过于频繁，请稍后再试" });
    }
    requestsSinceCleanup += 1;
    if (requestsSinceCleanup >= 250) {
      requestsSinceCleanup = 0;
      for (const [clientKey, clientEntry] of clients) {
        if (now - clientEntry.startedAt >= windowMs) clients.delete(clientKey);
      }
    }
    next();
  };
}

function readPort(value, fallback) {
  const port = Number(value || fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fallback;
  return port;
}

class ValidationError extends Error {}

function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close(() => {
    database.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

"use strict";

// 用户上传的是不可信文件：仅允许本地音频容器，真实解码后再保存，不信任 MIME 或客户端时长。
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
let activeJobs = 0;
const INPUT_OPTIONS = ["-protocol_whitelist", "file,pipe", "-format_whitelist", "mp3,mov,matroska,webm,ogg,wav"];

class AudioProcessingError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function run(binary, args, deadline) {
  const timeout = deadline - Date.now();
  if (timeout <= 0) return Promise.reject(new AudioProcessingError("语音处理超时，请换一个文件或稍后重试", 504));
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout, killSignal: "SIGKILL", maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (!error) return resolve(stdout);
      if (error.code === "ENOENT") return reject(new AudioProcessingError("服务器尚未安装 FFmpeg/ffprobe，暂时无法保存语音；可删除语音后生成", 503));
      if (error.killed) return reject(new AudioProcessingError("语音处理超时，请换一个文件或稍后重试", 504));
      reject(new AudioProcessingError("音频损坏、格式不支持或转码失败，请换一个录音文件重试"));
    });
  });
}

async function normalizeAudio(audio) {
  if (!audio) return null;
  if (activeJobs >= 2) throw new AudioProcessingError("语音处理繁忙，请稍后重试", 503);
  activeJobs += 1;
  let directory;
  const deadline = Date.now() + 30_000;
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "birthday-audio-"));
    const input = path.join(directory, "input.audio");
    const pcm = path.join(directory, "decoded.pcm");
    const output = path.join(directory, "voice.mp3");
    await fs.writeFile(input, Buffer.from(audio.dataUrl.slice(audio.dataUrl.indexOf(",") + 1), "base64"));
    const metadata = JSON.parse(await run(ffprobe, ["-v", "error", ...INPUT_OPTIONS, "-show_streams", "-show_format", "-of", "json", input], deadline));
    const streams = metadata.streams || [];
    if (streams.some((stream) => stream.codec_type === "video")) {
      throw new AudioProcessingError("仅支持纯音频文件，请勿上传视频或带视频封面的文件");
    }
    if (!streams.some((stream) => stream.codec_type === "audio")) throw new AudioProcessingError("文件中没有可用的音频");

    // MediaRecorder WebM 可能没有 duration 元数据。解码到固定采样率 PCM 后以样本数校验。
    // 最多解码 61 秒以限制资源；超过 60 秒一律拒绝，绝不保存截断后的音频。
    await run(ffmpeg, ["-nostdin", "-v", "error", "-xerror", "-threads", "1", ...INPUT_OPTIONS,
      "-i", input, "-map", "0:a:0", "-t", "61", "-vn", "-sn", "-dn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-y", pcm], deadline);
    const durationMs = (await fs.stat(pcm)).size / 32;
    if (durationMs > 60_000) throw new AudioProcessingError("语音最长 60 秒，请缩短后重新上传");
    if (durationMs < 100) throw new AudioProcessingError("录音内容过短或为空，请重新录制");
    await run(ffmpeg, ["-nostdin", "-v", "error", "-f", "s16le", "-ar", "16000", "-ac", "1", "-i", pcm,
      "-map_metadata", "-1", "-c:a", "libmp3lame", "-threads", "1", "-b:a", "64k", "-y", output], deadline);
    const result = await fs.readFile(output);
    return { mimeType: "audio/mpeg", dataUrl: `data:audio/mpeg;base64,${result.toString("base64")}`, durationMs: Math.round(durationMs) };
  } finally {
    try { if (directory) await fs.rm(directory, { recursive: true, force: true }); }
    finally { activeJobs -= 1; }
  }
}

module.exports = { normalizeAudio, AudioProcessingError };

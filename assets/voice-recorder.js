"use strict";

// 独立管理录音生命周期。仅在用户点击按钮后申请麦克风；替换失败保留原语音。
window.BirthdayVoiceRecorder = class BirthdayVoiceRecorder {
  constructor(onBusyChange) {
    this.audio = null;
    this.busy = false;
    this.locked = false;
    this.operation = 0;
    this.onBusyChange = onBusyChange;
    this.ui = {};
    ["voiceRecord", "voiceStop", "voiceUpload", "voiceFile", "voiceDelete", "voicePreview", "voiceSaved", "voiceStatus", "voiceError", "voiceHint", "voiceTimer"]
      .forEach((id) => { this.ui[id] = document.getElementById(id); });
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    this.iosWechat = ios && /MicroMessenger/i.test(navigator.userAgent);
    const formats = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
    this.mime = formats.find((type) => window.MediaRecorder?.isTypeSupported?.(type));
    this.supported = Boolean(!this.iosWechat && window.isSecureContext && navigator.mediaDevices?.getUserMedia && this.mime);
    if (!this.supported) this.unsupported();
    this.ui.voiceRecord.addEventListener("click", () => this.start());
    this.ui.voiceStop.addEventListener("click", () => this.stop());
    this.ui.voiceUpload.addEventListener("click", () => this.ui.voiceFile.click());
    this.ui.voiceFile.addEventListener("change", () => this.upload());
    this.ui.voiceDelete.addEventListener("click", () => {
      if (this.busy || this.locked) return;
      this.audio = null;
      this.ui.voicePreview.pause();
      this.ui.voicePreview.removeAttribute("src");
      this.ui.voicePreview.load();
      this.ui.voiceSaved.hidden = true;
      this.ui.voiceError.textContent = "";
      this.ui.voiceStatus.textContent = "语音已删除，可重新录制或上传。";
      this.update();
    });
    this.ui.voicePreview.addEventListener("error", () => {
      if (this.audio) this.ui.voiceError.textContent = "当前浏览器无法试听此格式，生成时服务器会校验并转为 MP3；也可换一个文件。";
    });
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.suspend(); });
    window.addEventListener("pagehide", () => this.suspend());
    this.update();
  }

  unsupported() {
    this.supported = false;
    this.ui.voiceRecord.hidden = true;
    this.ui.voiceHint.textContent = this.iosWechat
      ? "微信内暂不支持直接录音，请点击右上角用 Safari 打开录制，或上传系统录音文件。"
      : "当前浏览器不支持直接录音，请用 HTTPS 页面及系统浏览器打开，或上传系统录音文件。";
  }

  update() {
    const { ui } = this;
    ui.voiceRecord.disabled = this.busy || this.locked;
    ui.voiceRecord.textContent = this.audio ? "重新录制" : "开始录音";
    ui.voiceUpload.disabled = this.busy || this.locked;
    ui.voiceFile.disabled = this.busy || this.locked;
    ui.voiceDelete.disabled = this.busy || this.locked;
    ui.voiceStop.hidden = !(this.phase === "requesting" || this.phase === "recording");
    ui.voiceStop.textContent = this.phase === "requesting" ? "取消申请" : "停止录音";
    this.onBusyChange(this.busy);
  }

  setLocked(value) { this.locked = value; if (value) this.ui.voicePreview.pause(); this.update(); }
  setPhase(phase) { this.phase = phase; this.busy = Boolean(phase); this.update(); }
  release() {
    clearInterval(this.tick);
    clearTimeout(this.deadline);
    clearTimeout(this.permissionTimer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  cancel(message = "录音已取消，原语音保持不变。") {
    this.operation += 1; // 让迟到的权限/文件读取结果失效。
    clearTimeout(this.stopTimer);
    this.processingAbort?.abort();
    this.processingAbort = null;
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder?.state !== "inactive" && recorder) { try { recorder.stop(); } catch { /* 已停止 */ } }
    this.release();
    this.setPhase("");
    this.ui.voiceStatus.textContent = message;
  }

  suspend() {
    this.ui.voicePreview.pause();
    if (this.phase === "recording") this.stop();
    else if (this.busy) this.cancel("已离开录音页面，操作取消；原语音保持不变。");
  }

  async start() {
    if (!this.supported || this.busy || this.locked) return;
    const token = ++this.operation;
    this.ui.voiceError.textContent = "";
    this.ui.voicePreview.pause();
    this.ui.voiceStatus.textContent = "请允许麦克风权限…";
    this.setPhase("requesting");
    this.permissionTimer = setTimeout(() => {
      if (token === this.operation) this.cancel("麦克风授权等待超时，请允许权限后重试，或上传录音文件。");
    }, 20_000);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (token !== this.operation || document.hidden) {
        stream.getTracks().forEach((track) => track.stop());
        if (token === this.operation) this.cancel();
        return;
      }
      clearTimeout(this.permissionTimer);
      this.stream = stream;
      const recorder = new MediaRecorder(stream, { mimeType: this.mime, audioBitsPerSecond: 64000 });
      this.recorder = recorder;
      const chunks = [];
      let bytes = 0;
      recorder.ondataavailable = (event) => {
        if (token !== this.operation || !event.data.size) return;
        chunks.push(event.data);
        bytes += event.data.size;
        if (bytes > 2.5 * 1024 * 1024) this.fail(new Error("录音超过 2.5 MiB，请缩短录音后重试。"), token);
      };
      recorder.onerror = (event) => this.fail(event.error || new Error("录音失败，请重试或上传系统录音文件。"), token);
      recorder.onstop = async () => {
        if (token !== this.operation) return;
        clearTimeout(this.stopTimer);
        const elapsed = Math.min(60000, performance.now() - this.startedAt);
        this.release();
        this.recorder = null;
        this.setPhase("processing");
        this.ui.voiceStatus.textContent = "正在处理录音…";
        try {
          await this.acceptBlob(new Blob(chunks, { type: recorder.mimeType || this.mime }), token, elapsed);
        } catch (error) { this.fail(error, token); }
      };
      stream.getAudioTracks().forEach((track) => track.addEventListener("ended", () => {
        if (token === this.operation && this.phase === "recording") this.stop();
      }));
      recorder.start(250);
      this.startedAt = performance.now();
      this.setPhase("recording");
      this.ui.voiceStatus.textContent = "正在录音，最长 60 秒；停止后可以试听。";
      this.ui.voiceTimer.textContent = "00:00 / 01:00";
      this.tick = setInterval(() => {
        const seconds = Math.min(60, Math.floor((performance.now() - this.startedAt) / 1000));
        this.ui.voiceTimer.textContent = `${seconds === 60 ? "01:00" : `00:${String(seconds).padStart(2, "0")}`} / 01:00`;
      }, 200);
      // 留出浏览器编码的尾帧余量；服务器仍严格检查真实时长不超过 60 秒。
      this.deadline = setTimeout(() => this.stop(), 59_800);
    } catch (error) { this.fail(error, token); }
  }

  stop() {
    if (this.phase === "requesting") return this.cancel();
    if (this.phase !== "recording") return;
    this.setPhase("processing");
    this.ui.voiceStatus.textContent = "正在保存录音…";
    const token = this.operation;
    this.stopTimer = setTimeout(() => {
      this.fail(new Error("浏览器未能完成录音，请重试或上传系统录音文件。"), token);
    }, 8000);
    try { this.recorder?.stop(); }
    catch (error) { this.fail(error, this.operation); }
    finally { this.release(); }
  }

  fail(error, token) {
    if (token !== this.operation) return;
    this.cancel("");
    const messages = {
      NotAllowedError: "未获得麦克风权限，请在浏览器设置中允许后重试，或上传录音文件。",
      NotFoundError: "没有找到麦克风，请连接麦克风，或上传录音文件。",
      NotReadableError: "麦克风可能被其他应用占用，请关闭占用它的应用后重试。",
      NotSupportedError: "此浏览器无法录音，请使用系统浏览器或上传录音文件。",
      SecurityError: "浏览器禁止了录音，请使用 HTTPS 和系统浏览器，或上传录音文件。",
    };
    if (["NotSupportedError", "SecurityError"].includes(error.name)) this.unsupported();
    this.ui.voiceError.textContent = messages[error.name] || error.message || "语音处理失败，请重新选择文件。";
  }

  async upload() {
    const file = this.ui.voiceFile.files[0];
    this.ui.voiceFile.value = "";
    if (!file || this.busy || this.locked) return;
    const token = ++this.operation;
    this.ui.voicePreview.pause();
    this.ui.voiceError.textContent = "";
    this.setPhase("processing");
    this.ui.voiceStatus.textContent = "正在读取音频…";
    try {
      const types = { mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", webm: "audio/webm", ogg: "audio/ogg", wav: "audio/wav" };
      const mime = types[file.name.split(".").pop().toLowerCase()];
      if (!mime) throw new Error("请选择 MP3、M4A/MP4、WebM、Ogg 或 WAV 音频文件。");
      if (file.size > 2.5 * 1024 * 1024) throw new Error("音频不能超过 2.5 MiB，请选择更小的文件。");
      await this.acceptBlob(file.slice(0, file.size, mime), token);
    } catch (error) { this.fail(error, token); }
  }

  async acceptBlob(blob, token, recordedDuration = 0) {
    if (!blob.size) throw new Error("录音内容为空，请重新录制。");
    if (blob.size > 2.5 * 1024 * 1024) throw new Error("音频不能超过 2.5 MiB，请缩短后重试。");
    this.processingAbort = new AbortController();
    const signal = this.processingAbort.signal;
    const measured = await this.measure(blob, signal);
    if (token !== this.operation) return;
    // 无 duration 的 WebM 和本机不支持的格式交给服务端真实解码，不依赖伪造元数据。
    if (measured > 60) throw new Error("语音最长 60 秒，请缩短后重新上传。");
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      const cancelRead = () => reader.abort();
      const cleanup = () => signal.removeEventListener("abort", cancelRead);
      reader.onload = () => { cleanup(); resolve(reader.result); };
      reader.onerror = () => { cleanup(); reject(new Error("音频读取失败，请重新选择文件。")); };
      reader.onabort = () => { cleanup(); reject(new Error("音频处理已取消。")); };
      signal.addEventListener("abort", cancelRead, { once: true });
      reader.readAsDataURL(blob);
    });
    if (token !== this.operation) return;
    this.processingAbort = null;
    this.audio = { mimeType: blob.type, dataUrl, durationMs: measured ? Math.round(measured * 1000) : Math.round(recordedDuration) };
    this.ui.voicePreview.src = dataUrl;
    this.ui.voiceSaved.hidden = false;
    this.ui.voiceTimer.textContent = "";
    this.ui.voiceStatus.textContent = this.audio.durationMs
      ? `已选语音 · ${(this.audio.durationMs / 1000).toFixed(1)} 秒 · ${(blob.size / 1024).toFixed(0)} KiB`
      : "已选语音，生成时将由服务器校验时长并转为 MP3。";
    this.setPhase("");
  }

  measure(blob, signal) {
    return new Promise((resolve) => {
      const audio = new Audio();
      const url = URL.createObjectURL(blob);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        audio.onloadedmetadata = audio.onerror = null;
        audio.removeAttribute("src");
        audio.load();
        URL.revokeObjectURL(url);
        resolve(duration);
      };
      const timer = setTimeout(finish, 5000);
      audio.preload = "metadata";
      audio.onloadedmetadata = audio.onerror = finish;
      signal.addEventListener("abort", finish, { once: true });
      audio.src = url;
    });
  }
};

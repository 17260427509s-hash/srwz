"use strict";

const MAX_API_RECORD_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES = 3;
const MAX_RECORDING_MS = 60_000;

const THEMES = {
  cherry: { key: "cherry", label: "樱桃粉", color: "#ef5b78", softColor: "#fde8ec" },
  sky: { key: "sky", label: "天空蓝", color: "#68b9ec", softColor: "#e5f4fd" },
  china: { key: "china", label: "中国红", color: "#e34643", softColor: "#fde8e7" },
  tiffany: { key: "tiffany", label: "蒂芙尼蓝", color: "#49c2bc", softColor: "#e3f7f5" },
  avocado: { key: "avocado", label: "牛油果绿", color: "#9fc55a", softColor: "#f0f6e3" },
  rose: { key: "rose", label: "玫瑰紫", color: "#a86ed0", softColor: "#f3e9fa" },
  cream: { key: "cream", label: "奶油橙", color: "#f1a158", softColor: "#fff0e1" },
};

const BLESSINGS = [
  "愿你新的一岁，眼里有光，心中有爱，所愿皆所得。",
  "愿所有美好都如期而至，往后的每一天都闪闪发亮。",
  "新的一岁，愿你自由、热烈，永远奔赴在自己的热爱里。",
  "愿你三冬暖，愿你春不寒，愿你一路有良人相伴。",
  "愿快乐不止生日这一天，也住进你往后的每一个清晨。",
  "愿你被这个世界温柔以待，也永远保有温柔世界的勇气。",
  "岁岁常欢愉，年年皆胜意，生日快乐，我最珍贵的人。",
  "愿新一岁的你，平安喜乐，万事胜意，生活明朗可爱。",
  "愿你永远有做梦的勇气，也有把每个梦想变成真的底气。",
  "这一岁要找到生活中最温柔的光，也成为自己的那束光。",
  "愿你的日子像奶油蛋糕一样甜，惊喜和好运永远不会缺席。",
  "愿每一岁的奔赴都有意义，愿每一次成长都带着欢喜。",
];

const state = {
  theme: THEMES.cherry,
  images: [],
  audio: null,
  currentId: null,
  recorder: null,
  stream: null,
  chunks: [],
  timerId: null,
  recordStartedAt: 0,
  chosenMimeType: "",
  toastTimer: null,
};

const dom = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  bindEvents();
  updateMessageCounter();
  setupRecordingCapability();
});

function cacheDom() {
  [
    "formView", "resultView", "blessingForm", "recipientName", "birthday", "senderName",
    "message", "messageCounter", "email", "themePicker", "shuffleMessage", "photoInput",
    "photoPreviews", "photoCount", "photoError", "audioControls", "audioUnsupported",
    "audioStatus", "recordButton", "recordButtonText", "recordTimer", "audioPreview",
    "audioPlayer", "deleteAudio", "storageWarning", "generateButton", "cardTemplate",
    "cardRecipient", "cardDate", "cardMessage", "cardSender", "generatedCardImage",
    "cardImageButton", "shareLink", "copyLinkButton", "downloadCardButton", "backToEdit",
    "imageModal", "modalCardImage", "closeImageModal", "toast", "toastText",
  ].forEach((id) => {
    dom[id] = document.getElementById(id);
  });
}

function bindEvents() {
  dom.themePicker.addEventListener("click", handleThemeChange);
  dom.shuffleMessage.addEventListener("click", shuffleBlessing);
  dom.message.addEventListener("input", updateMessageCounter);
  dom.photoInput.addEventListener("change", handlePhotoSelection);
  dom.photoPreviews.addEventListener("click", handlePhotoRemoval);
  dom.recordButton.addEventListener("click", toggleRecording);
  dom.deleteAudio.addEventListener("click", deleteRecording);
  dom.blessingForm.addEventListener("submit", handleGenerate);
  dom.copyLinkButton.addEventListener("click", copyShareLink);
  dom.shareLink.addEventListener("click", () => dom.shareLink.select());
  dom.backToEdit.addEventListener("click", showFormView);
  dom.cardImageButton.addEventListener("click", openImageModal);
  dom.closeImageModal.addEventListener("click", closeImageModal);
  dom.imageModal.addEventListener("click", (event) => {
    if (event.target === dom.imageModal) closeImageModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dom.imageModal.hidden) closeImageModal();
  });
}

function handleThemeChange(event) {
  const button = event.target.closest(".theme-option");
  if (!button) return;

  const nextTheme = THEMES[button.dataset.theme];
  if (!nextTheme) return;

  state.theme = nextTheme;
  document.documentElement.style.setProperty("--accent", nextTheme.color);
  document.documentElement.style.setProperty("--accent-deep", nextTheme.color);
  document.documentElement.style.setProperty("--accent-soft", nextTheme.softColor);

  dom.themePicker.querySelectorAll(".theme-option").forEach((option) => {
    const selected = option === button;
    option.classList.toggle("is-selected", selected);
    option.setAttribute("aria-pressed", String(selected));
  });
}

function shuffleBlessing() {
  const current = dom.message.value.trim();
  const candidates = BLESSINGS.filter((item) => item !== current);
  dom.message.value = candidates[Math.floor(Math.random() * candidates.length)];
  updateMessageCounter();
  dom.message.focus();
}

function updateMessageCounter() {
  dom.messageCounter.textContent = `${dom.message.value.length} / 240`;
  dom.message.setCustomValidity(dom.message.value.trim() ? "" : "请填写祝福语");
}

async function handlePhotoSelection(event) {
  dom.photoError.textContent = "";
  const files = Array.from(event.target.files || []);
  const availableSlots = MAX_IMAGES - state.images.length;

  if (!availableSlots) {
    dom.photoError.textContent = "最多只能上传 3 张照片，请先删除已有照片。";
    event.target.value = "";
    return;
  }

  if (files.length > availableSlots) {
    dom.photoError.textContent = `还能上传 ${availableSlots} 张，已忽略多余照片。`;
  }

  for (const file of files.slice(0, availableSlots)) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      dom.photoError.textContent = "仅支持 JPG、PNG 或 WebP 图片。";
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      dom.photoError.textContent = `“${file.name}”超过 10 MB，请选择更小的图片。`;
      continue;
    }

    try {
      const compressed = await compressImage(file);
      state.images.push({ name: file.name, type: "image/jpeg", dataUrl: compressed });
    } catch (error) {
      console.error(error);
      dom.photoError.textContent = `“${file.name}”处理失败，请换一张照片重试。`;
    }
  }

  event.target.value = "";
  renderPhotoPreviews();
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取图片"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("无法解析图片"));
      image.onload = () => {
        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { alpha: false });
        canvas.width = width;
        canvas.height = height;
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function renderPhotoPreviews() {
  dom.photoPreviews.replaceChildren();
  state.images.forEach((image, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "photo-thumb";

    const img = document.createElement("img");
    img.src = image.dataUrl;
    img.alt = `已选择的第 ${index + 1} 张照片`;

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.index = String(index);
    button.setAttribute("aria-label", `删除第 ${index + 1} 张照片`);
    button.textContent = "×";

    wrapper.append(img, button);
    dom.photoPreviews.append(wrapper);
  });
  dom.photoCount.textContent = `${state.images.length} / 3`;
}

function handlePhotoRemoval(event) {
  const button = event.target.closest("button[data-index]");
  if (!button) return;
  state.images.splice(Number(button.dataset.index), 1);
  dom.photoError.textContent = "";
  renderPhotoPreviews();
}

function getEnvironment() {
  const ua = navigator.userAgent;
  const isWeChat = /MicroMessenger/i.test(ua);
  const isIOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = isIOS || (/Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua));
  const host = window.location.hostname;
  const isLocalhost = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  const secureEnough = window.isSecureContext || window.location.protocol === "https:" || isLocalhost;
  return { isWeChat, isIOS, isSafari, secureEnough };
}

function setupRecordingCapability() {
  const env = getEnvironment();
  if (env.isIOS && env.isWeChat) {
    disableRecording("当前浏览器不支持录音，建议点击右上角选择用Safari浏览器打开");
    return;
  }

  if (!env.secureEnough || !navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === "undefined") {
    disableRecording("当前浏览器不支持录音，建议使用系统浏览器打开");
    return;
  }

  const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  state.chosenMimeType = candidates.find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  }) || "";

  if (!state.chosenMimeType) {
    disableRecording("当前浏览器不支持录音，建议使用系统浏览器打开");
    return;
  }

  dom.audioUnsupported.hidden = true;
  dom.audioControls.hidden = false;
}

function disableRecording(message) {
  cleanupMediaStream();
  dom.audioControls.hidden = true;
  dom.audioPreview.hidden = true;
  dom.audioStatus.textContent = "";
  dom.audioUnsupported.textContent = message;
  dom.audioUnsupported.hidden = false;
}

async function toggleRecording() {
  if (state.recorder?.state === "recording") {
    state.recorder.stop();
    return;
  }

  dom.audioStatus.textContent = "";
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    state.chunks = [];
    state.recorder = createMediaRecorder(state.stream, state.chosenMimeType);

    state.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) state.chunks.push(event.data);
    });
    state.recorder.addEventListener("stop", finishRecording, { once: true });
    state.recorder.addEventListener("error", () => {
      dom.audioStatus.textContent = "录音过程中出现错误，请重试。";
      resetRecorderUi();
      cleanupMediaStream();
    }, { once: true });

    state.recorder.start(1000);
    state.recordStartedAt = Date.now();
    state.audio = null;
    dom.audioPreview.hidden = true;
    dom.recordButton.classList.add("is-recording");
    dom.recordButtonText.textContent = "停止录音";
    updateRecordTimer();
    state.timerId = window.setInterval(updateRecordTimer, 250);
  } catch (error) {
    cleanupMediaStream();
    if (error?.name === "NotAllowedError") {
      dom.audioStatus.textContent = "未获得麦克风权限，可在浏览器设置中允许后重试";
      return;
    }
    if (["NotSupportedError", "SecurityError"].includes(error?.name)) {
      const { isIOS } = getEnvironment();
      disableRecording(isIOS
        ? "当前浏览器不支持录音，建议点击右上角选择用Safari浏览器打开"
        : "当前浏览器不支持录音，建议使用系统浏览器打开");
      return;
    }
    dom.audioStatus.textContent = "暂时无法启动录音，请稍后再试。";
  }
}

function updateRecordTimer() {
  const elapsed = Math.min(Date.now() - state.recordStartedAt, MAX_RECORDING_MS);
  dom.recordTimer.textContent = `${formatDuration(elapsed)} / 01:00`;
  dom.recordTimer.dateTime = `PT${Math.floor(elapsed / 1000)}S`;
  if (elapsed >= MAX_RECORDING_MS && state.recorder?.state === "recording") {
    state.recorder.stop();
  }
}

async function finishRecording() {
  const durationMs = Math.min(Date.now() - state.recordStartedAt, MAX_RECORDING_MS);
  const mimeType = state.recorder?.mimeType || state.chosenMimeType;
  const blob = new Blob(state.chunks, { type: mimeType });
  resetRecorderUi();
  cleanupMediaStream();

  if (!blob.size) {
    dom.audioStatus.textContent = "没有录到声音，请重新录制。";
    return;
  }

  try {
    const dataUrl = await blobToDataUrl(blob);
    state.audio = { mimeType, dataUrl, durationMs };
    dom.audioPlayer.src = dataUrl;
    dom.audioPreview.hidden = false;
    dom.recordButtonText.textContent = "重新录音";
    dom.audioStatus.textContent = `录音完成，共 ${formatDuration(durationMs)}`;
  } catch {
    dom.audioStatus.textContent = "录音处理失败，请重新录制。";
  }
}

function resetRecorderUi() {
  if (state.timerId) window.clearInterval(state.timerId);
  state.timerId = null;
  dom.recordButton.classList.remove("is-recording");
  dom.recordButtonText.textContent = state.audio ? "重新录音" : "开始录音";
  dom.recordTimer.textContent = "00:00 / 01:00";
  dom.recordTimer.dateTime = "PT0S";
}

function cleanupMediaStream() {
  if (state.timerId) window.clearInterval(state.timerId);
  state.timerId = null;
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
}

function deleteRecording() {
  state.audio = null;
  dom.audioPlayer.removeAttribute("src");
  dom.audioPlayer.load();
  dom.audioPreview.hidden = true;
  dom.audioStatus.textContent = "录音已删除。";
  resetRecorderUi();
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function createMediaRecorder(stream, mimeType) {
  try {
    return new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 });
  } catch {
    try {
      return new MediaRecorder(stream, { mimeType });
    } catch {
      return new MediaRecorder(stream);
    }
  }
}

async function handleGenerate(event) {
  event.preventDefault();
  updateMessageCounter();

  if (!dom.blessingForm.reportValidity()) return;
  if (state.recorder?.state === "recording") {
    showToast("请先结束录音", true);
    return;
  }

  dom.storageWarning.hidden = true;
  dom.storageWarning.textContent = "";
  dom.generateButton.disabled = true;
  dom.generateButton.textContent = "正在生成…";

  const record = buildRecord();
  const serialized = JSON.stringify(record);

  if (new Blob([serialized]).size >= MAX_API_RECORD_BYTES) {
    showGenerateWarning("祝福数据接近 5 MB，请删除部分图片或录音后重试");
    restoreGenerateButton();
    return;
  }

  try {
    await renderCardImage(record);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 20_000);
    let response;
    try {
      response = await fetch("/api/blessings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: serialized,
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = response.status === 429
        ? "操作太频繁，请稍后再试"
        : result.error || "祝福保存失败，请稍后重试";
      throw new ApiError(message, response.status);
    }
    if (typeof result.id !== "string" || !result.id) throw new ApiError("服务器没有返回祝福编号", 500);

    state.currentId = result.id;
    const shareUrl = new URL(`detail.html?id=${encodeURIComponent(state.currentId)}`, window.location.href).href;
    dom.shareLink.value = shareUrl;
    dom.downloadCardButton.download = `${safeFileName(record.recipientName)}-生日贺卡.png`;
    dom.formView.hidden = true;
    dom.resultView.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    console.error(error);
    if (error?.name === "AbortError") {
      showGenerateWarning("连接服务器超时，请检查网络后重试");
    } else if (error instanceof ApiError) {
      showGenerateWarning(error.message);
    } else if (error instanceof TypeError) {
      showGenerateWarning("连接不到后端服务，请确认已使用 node server.js 启动项目");
    } else {
      showGenerateWarning("贺卡生成失败，请稍后重试");
    }
  } finally {
    restoreGenerateButton();
  }
}

function buildRecord() {
  return {
    version: 1,
    recipientName: dom.recipientName.value.trim(),
    birthday: dom.birthday.value,
    senderName: dom.senderName.value.trim(),
    theme: { ...state.theme },
    message: dom.message.value.trim(),
    email: dom.email.value.trim(),
    images: state.images.map((image) => ({ ...image })),
    audio: state.audio ? { ...state.audio } : null,
  };
}

async function renderCardImage(record) {
  if (typeof window.html2canvas !== "function") {
    throw new Error("html2canvas 未加载");
  }

  dom.cardTemplate.style.setProperty("--card-accent", record.theme.color);
  dom.cardTemplate.style.setProperty("--card-soft", record.theme.softColor);
  dom.cardTemplate.style.setProperty("--card-dot", hexToRgba(record.theme.color, 0.25));
  dom.cardTemplate.style.setProperty("--card-pale", mixHexWithWhite(record.theme.color, 0.58));
  dom.cardTemplate.style.setProperty("--card-tape-color", mixHexWithWhite(record.theme.color, 0.5));
  dom.cardTemplate.style.setProperty("--card-sprig-color", mixHex(record.theme.color, "#8c776e", 0.68));
  dom.cardTemplate.style.setProperty("--card-line", mixHexWithWhite(record.theme.color, 0.68));
  dom.cardRecipient.textContent = record.recipientName;
  dom.cardDate.textContent = record.birthday.replaceAll("-", ".");
  dom.cardDate.dateTime = record.birthday;
  dom.cardMessage.textContent = record.message;
  dom.cardSender.textContent = `— 来自${record.senderName}`;

  if (document.fonts?.ready) await document.fonts.ready;
  await Promise.all(Array.from(dom.cardTemplate.querySelectorAll("img")).map(async (image) => {
    if (!image.complete) {
      await new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      });
    }
    if (typeof image.decode === "function") {
      try { await image.decode(); } catch { /* html2canvas will use the loaded fallback state */ }
    }
  }));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const canvas = await window.html2canvas(dom.cardTemplate, {
    scale: 2,
    backgroundColor: null,
    useCORS: true,
    logging: false,
    width: 720,
    height: 900,
  });
  const dataUrl = canvas.toDataURL("image/png");
  dom.generatedCardImage.src = dataUrl;
  dom.modalCardImage.src = dataUrl;
  dom.downloadCardButton.href = dataUrl;
}

function restoreGenerateButton() {
  dom.generateButton.disabled = false;
  dom.generateButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h16v11H4zM12 10v11M2 7h20v3H2zM12 7H7.5a2.5 2.5 0 1 1 2.5-2.5C10 6 12 7 12 7Zm0 0h4.5A2.5 2.5 0 1 0 14 4.5C14 6 12 7 12 7Z" /></svg>立即生成`;
}

function showGenerateWarning(message) {
  dom.storageWarning.textContent = message;
  dom.storageWarning.hidden = false;
  dom.storageWarning.scrollIntoView({ behavior: "smooth", block: "center" });
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function safeFileName(value) {
  return value.replace(/[\\/:*?"<>|]/g, "-").slice(0, 40) || "生日祝福";
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mixHex(colorA, colorB, weightA) {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  const weightB = 1 - weightA;
  const toHex = (value) => Math.round(value).toString(16).padStart(2, "0");
  return `#${toHex(a.r * weightA + b.r * weightB)}${toHex(a.g * weightA + b.g * weightB)}${toHex(a.b * weightA + b.b * weightB)}`;
}

function mixHexWithWhite(color, weight) {
  return mixHex(color, "#ffffff", weight);
}

async function copyShareLink() {
  const text = dom.shareLink.value;
  let copied = false;

  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      copied = false;
    }
  }

  if (!copied) copied = fallbackCopy(text);
  showToast(copied ? "复制成功" : "复制失败，请手动选择链接", !copied);
}

function fallbackCopy(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let success = false;
  try {
    success = document.execCommand("copy");
  } catch {
    success = false;
  }
  textarea.remove();
  return success;
}

function showToast(message, isError = false) {
  if (state.toastTimer) window.clearTimeout(state.toastTimer);
  dom.toastText.textContent = message;
  dom.toast.querySelector("span").textContent = isError ? "!" : "✓";
  dom.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    dom.toast.hidden = true;
  }, 2600);
}

function showFormView() {
  dom.resultView.hidden = true;
  dom.formView.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openImageModal() {
  dom.imageModal.hidden = false;
  document.body.style.overflow = "hidden";
  dom.closeImageModal.focus();
}

function closeImageModal() {
  dom.imageModal.hidden = true;
  document.body.style.overflow = "";
  dom.cardImageButton.focus();
}

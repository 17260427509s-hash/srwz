"use strict";

const DEFAULT_IMAGES = [
  "assets/default-cake.webp",
  "assets/default-balloons.webp",
  "assets/default-toast.webp",
];

const state = {
  id: "",
  record: null,
  activeScreen: 0,
  finalCelebrated: false,
  liked: false,
};

const dom = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheDom();
  const params = new URLSearchParams(window.location.search);
  state.id = params.get("id")?.trim() || "";

  if (!state.id) {
    showError("链接里缺少祝福编号", "请从完整的分享链接重新打开。");
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
    let response;
    try {
      response = await fetch(`/api/blessings/${encodeURIComponent(state.id)}`, {
        headers: { "Accept": "application/json" },
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }

    const result = await response.json().catch(() => ({}));
    if (response.status === 404) {
      showError("没有找到这份祝福", "请确认分享链接完整无误，或请发送人重新生成一份祝福。");
      return;
    }
    if (!response.ok) {
      showError("祝福暂时无法读取", result.error || "服务器暂时无法处理请求，请稍后重试。");
      return;
    }
    state.record = result;
  } catch (error) {
    console.error(error);
    showError(
      "祝福暂时无法读取",
      error?.name === "AbortError"
        ? "连接服务器超时，请稍后重试。"
        : "连接不到后端服务，请确认网站服务正在运行。"
    );
    return;
  }

  if (!isValidRecord(state.record)) {
    showError("这份祝福数据不完整", "请回到生成页面重新制作一份祝福。");
    return;
  }

  applyTheme(state.record.theme);
  populateStory(state.record);
  buildLetterReveal("Happy Birthday");
  bindEvents();
  createFloatingDecorations();
  setupObserver();
  restoreLikedState();

  dom.loadingView.hidden = true;
  dom.coverView.hidden = false;
  document.title = `送给${state.record.recipientName}的生日祝福`;
}

function cacheDom() {
  [
    "loadingView", "errorView", "errorTitle", "errorMessage", "coverView", "coverRecipient",
    "enterButton", "storyView", "storyScroller", "progressBar", "screenDots", "birthdayDate",
    "heroTitle", "heroSubtitle", "heroRecipient", "storyImage1", "storyImage2", "storyImage3",
    "finalMessage", "finalSender", "likeButton", "likeCount", "replayButton", "floatingLayer",
    "heartBurst",
  ].forEach((id) => { dom[id] = document.getElementById(id); });
}

function isValidRecord(record) {
  return Boolean(
    record && record.version === 1 && record.id === state.id &&
    typeof record.recipientName === "string" && typeof record.senderName === "string" &&
    typeof record.message === "string" && record.theme && typeof record.theme.color === "string"
  );
}

function showError(title, message) {
  dom.loadingView.hidden = true;
  dom.coverView.hidden = true;
  dom.storyView.hidden = true;
  dom.errorTitle.textContent = title;
  dom.errorMessage.textContent = message;
  dom.errorView.hidden = false;
}

function applyTheme(theme) {
  const color = isHexColor(theme.color) ? theme.color : "#ef5b78";
  const soft = isHexColor(theme.softColor) ? theme.softColor : mixWithWhite(color, 0.82);
  const rgb = hexToRgb(color);
  document.documentElement.style.setProperty("--accent", color);
  document.documentElement.style.setProperty("--accent-soft", soft);
  document.documentElement.style.setProperty("--accent-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", soft);
}

function populateStory(record) {
  dom.coverRecipient.textContent = `${record.recipientName}，准备好拆开惊喜了吗？`;
  dom.heroRecipient.textContent = record.recipientName;
  dom.birthdayDate.textContent = formatBirthday(record.birthday);
  dom.finalMessage.textContent = record.message;
  dom.finalSender.textContent = record.senderName;

  const uploadedImages = Array.isArray(record.images)
    ? record.images.filter((item) => typeof item?.dataUrl === "string" && item.dataUrl.startsWith("data:image/"))
    : [];
  const images = [0, 1, 2].map((index) => uploadedImages[index]?.dataUrl || DEFAULT_IMAGES[index]);
  [dom.storyImage1, dom.storyImage2, dom.storyImage3].forEach((image, index) => {
    image.src = images[index];
    image.addEventListener("error", () => {
      if (!image.src.endsWith(DEFAULT_IMAGES[index])) image.src = DEFAULT_IMAGES[index];
    }, { once: true });
  });

  const likes = Number.isFinite(Number(record.likes)) ? Math.max(0, Number(record.likes)) : 0;
  state.record.likes = likes;
  updateLikeCount();
}

function buildLetterReveal(text) {
  dom.heroTitle.textContent = "";
  let letterIndex = 0;
  text.split(" ").forEach((word) => {
    const wordSpan = document.createElement("span");
    wordSpan.className = "reveal-word";
    wordSpan.setAttribute("aria-hidden", "true");
    Array.from(word).forEach((character) => {
      const letter = document.createElement("span");
      letter.className = "reveal-letter";
      letter.textContent = character;
      letter.style.setProperty("--delay", `${letterIndex * 0.13}s`);
      wordSpan.appendChild(letter);
      letterIndex += 1;
    });
    dom.heroTitle.appendChild(wordSpan);
  });
}

function bindEvents() {
  dom.enterButton.addEventListener("click", enterStory);
  dom.storyScroller.querySelectorAll(".next-button").forEach((button) => {
    button.addEventListener("click", () => {
      const current = button.closest(".story-screen");
      current?.nextElementSibling?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  dom.likeButton.addEventListener("click", handleLike);
  dom.replayButton.addEventListener("click", replayStory);
}

function enterStory() {
  dom.enterButton.disabled = true;
  dom.coverView.classList.add("is-leaving");
  celebrate(0.9);
  window.setTimeout(() => {
    dom.coverView.hidden = true;
    dom.storyView.hidden = false;
    document.body.classList.add("has-entered");
    dom.storyScroller.focus({ preventScroll: true });
    dom.storyScroller.scrollTo({ top: 0 });
    const first = dom.storyScroller.querySelector(".story-screen");
    first?.classList.add("is-active");
  }, prefersReducedMotion() ? 0 : 560);
}

function setupObserver() {
  const screens = Array.from(document.querySelectorAll(".story-screen"));
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.56) return;
      const index = Number(entry.target.dataset.screen);
      state.activeScreen = index;
      entry.target.classList.add("is-active");
      updateProgress(index, screens.length);
      if (index === screens.length - 1 && !state.finalCelebrated) {
        state.finalCelebrated = true;
        celebrate(1.2);
      }
    });
  }, { root: dom.storyScroller, threshold: [0.56, 0.78] });
  screens.forEach((screen) => observer.observe(screen));
}

function updateProgress(index, total) {
  dom.progressBar.style.width = `${((index + 1) / total) * 100}%`;
  Array.from(dom.screenDots.children).forEach((dot, dotIndex) => {
    dot.classList.toggle("is-active", dotIndex === index);
  });
}

function replayStory() {
  state.finalCelebrated = false;
  dom.storyScroller.scrollTo({ top: 0, behavior: "smooth" });
}

function handleLike() {
  dom.likeButton.classList.remove("is-popping");
  void dom.likeButton.offsetWidth;
  dom.likeButton.classList.add("is-popping");
  burstHeartsFromButton();

  if (!state.liked) {
    state.liked = true;
    state.record.likes += 1;
    dom.likeButton.classList.add("is-liked");
    dom.likeButton.setAttribute("aria-pressed", "true");
    try {
      localStorage.setItem(`birthdayBlessing:liked:${state.id}`, "1");
    } catch (error) {
      console.warn("点赞已显示，但无法写入本地存储。", error);
    }
    updateLikeCount();
  }
}

function restoreLikedState() {
  try { state.liked = localStorage.getItem(`birthdayBlessing:liked:${state.id}`) === "1"; } catch { state.liked = false; }
  if (state.liked) state.record.likes += 1;
  dom.likeButton.classList.toggle("is-liked", state.liked);
  dom.likeButton.setAttribute("aria-pressed", String(state.liked));
  updateLikeCount();
}

function updateLikeCount() {
  dom.likeCount.textContent = state.record.likes > 0 ? String(state.record.likes) : "";
}

function burstHeartsFromButton() {
  const rect = dom.likeButton.getBoundingClientRect();
  for (let index = 0; index < 7; index += 1) {
    const heart = document.createElement("span");
    heart.className = "burst-heart";
    heart.textContent = index % 3 === 0 ? "💕" : "♥";
    heart.style.left = `${rect.left + rect.width / 2}px`;
    heart.style.top = `${rect.top + rect.height / 2}px`;
    heart.style.setProperty("--size", `${15 + Math.random() * 14}px`);
    heart.style.setProperty("--x", `${-75 + Math.random() * 150}px`);
    heart.style.setProperty("--y", `${75 + Math.random() * 120}px`);
    heart.style.setProperty("--r", `${-35 + Math.random() * 70}deg`);
    dom.heartBurst.appendChild(heart);
    heart.addEventListener("animationend", () => heart.remove(), { once: true });
  }
}

function createFloatingDecorations() {
  if (prefersReducedMotion()) return;
  const symbols = ["♡", "♥", "🎈", "✦", "🎉"];
  for (let index = 0; index < 22; index += 1) {
    const item = document.createElement("span");
    item.className = "float-item";
    item.textContent = symbols[index % symbols.length];
    item.style.left = `${2 + Math.random() * 96}%`;
    item.style.setProperty("--size", `${12 + Math.random() * 18}px`);
    item.style.setProperty("--duration", `${12 + Math.random() * 13}s`);
    item.style.setProperty("--delay", `${-Math.random() * 22}s`);
    item.style.setProperty("--drift", `${-60 + Math.random() * 120}px`);
    dom.floatingLayer.appendChild(item);
  }
}

function celebrate(intensity = 1) {
  if (prefersReducedMotion()) return;
  const color = state.record?.theme?.color || "#ef5b78";
  const palette = [color, mixWithWhite(color, 0.38), "#f4b96c", "#fff7f0", "#e98fa2"];

  if (typeof window.confetti === "function") {
    window.confetti({
      particleCount: Math.round(75 * intensity),
      spread: 82,
      startVelocity: 34,
      gravity: 0.82,
      scalar: 0.9,
      origin: { y: 0.04 },
      colors: palette,
      disableForReducedMotion: true,
    });
    window.setTimeout(() => window.confetti({
      particleCount: Math.round(35 * intensity),
      angle: 60,
      spread: 62,
      origin: { x: 0, y: 0.35 },
      colors: palette,
    }), 170);
    window.setTimeout(() => window.confetti({
      particleCount: Math.round(35 * intensity),
      angle: 120,
      spread: 62,
      origin: { x: 1, y: 0.35 },
      colors: palette,
    }), 250);
  }
}

function formatBirthday(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "";
  const [, month, day] = value.split("-");
  return `${month} · ${day}`;
}

function isHexColor(value) { return /^#[\da-f]{6}$/i.test(value || ""); }

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return { r: parseInt(value.slice(0, 2), 16), g: parseInt(value.slice(2, 4), 16), b: parseInt(value.slice(4, 6), 16) };
}

function mixWithWhite(hex, ratio) {
  const rgb = hexToRgb(hex);
  const channel = (value) => Math.round(value + (255 - value) * ratio).toString(16).padStart(2, "0");
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

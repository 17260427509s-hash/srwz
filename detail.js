"use strict";

const DEFAULT_IMAGES = [
  "assets/story/story-01.webp",
  "assets/story/story-02.webp",
  "assets/story/story-03.webp",
  "assets/story/story-04.webp",
  "assets/story/story-05.webp",
  "assets/story/story-06.webp",
  "assets/story/story-07.webp",
];

const TEMPLATE_IMAGES = {
  "birthday-party": [
    "assets/templates/birthday-party/cake.svg",
    "assets/templates/birthday-party/balloon.svg",
    "assets/templates/birthday-party/party-popper.svg",
  ],
  bouquet: [
    "assets/templates/bouquet/bouquet.svg",
    "assets/templates/bouquet/cherry-blossom.svg",
    "assets/templates/bouquet/sunflower.svg",
  ],
  "cute-animals": [
    "assets/templates/cute-animals/cat.svg",
    "assets/templates/cute-animals/rabbit.svg",
    "assets/templates/cute-animals/bear.svg",
  ],
};

const MUSIC_MUTED_KEY = "birthdayBlessing:musicMuted";
const DEFAULT_MUSIC_VOLUME = 0.55;

const state = {
  id: "",
  record: null,
  activeScreen: 0,
  finalCelebrated: false,
  liked: false,
  introPlaying: false,
  introTimers: [],
  musicAvailable: true,
  musicMuted: false,
  musicPlaying: false,
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
  setupBackgroundMusic();
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
    "enterButton", "backgroundMusic", "musicToggle", "musicStatus", "introView", "skipIntroButton", "introAnnouncement", "introRecipient",
    "introGreeting", "introToday", "introCountdown", "countdownNumber", "introCake",
    "introFinale", "introFinalRecipient", "storyView", "storyScroller", "progressBar", "screenDots", "birthdayDate",
    "heroTitle", "heroSubtitle", "heroRecipient", "storyImage1", "storyImage2", "storyImage3",
    "storyImage4", "storyImage5", "storyImage6", "storyImage7",
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
  clearIntroTimers();
  dom.loadingView.hidden = true;
  dom.coverView.hidden = true;
  dom.introView.hidden = true;
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
  dom.introRecipient.textContent = record.recipientName;
  dom.introFinalRecipient.textContent = record.recipientName;
  dom.heroRecipient.textContent = record.recipientName;
  applyRecipientLengthClasses(record.recipientName);
  dom.birthdayDate.textContent = formatBirthday(record.birthday);
  dom.finalMessage.textContent = record.message;
  dom.finalSender.textContent = record.senderName;
  applyFinalMessageLengthClasses(record.message);

  const uploadedImages = Array.isArray(record.images)
    ? record.images.filter((item) => typeof item?.dataUrl === "string" && item.dataUrl.startsWith("data:image/"))
    : [];
  const templateImages = TEMPLATE_IMAGES[record.templateId] || [];
  [
    dom.storyImage1, dom.storyImage2, dom.storyImage3, dom.storyImage4,
    dom.storyImage5, dom.storyImage6, dom.storyImage7,
  ].forEach((image, index) => {
    const candidates = [uploadedImages[index]?.dataUrl, templateImages[index], DEFAULT_IMAGES[index]]
      .filter((value, candidateIndex, values) => typeof value === "string" && value && values.indexOf(value) === candidateIndex);
    let candidateIndex = 0;
    const applyCandidate = () => {
      image.classList.toggle("is-template-image", candidates[candidateIndex] === templateImages[index]);
      image.src = candidates[candidateIndex];
    };
    const useNextCandidate = () => {
      candidateIndex += 1;
      if (candidateIndex < candidates.length) applyCandidate();
      else image.removeEventListener("error", useNextCandidate);
    };
    image.addEventListener("error", useNextCandidate);
    applyCandidate();
  });

  const likes = Number.isFinite(Number(record.likes)) ? Math.max(0, Number(record.likes)) : 0;
  state.record.likes = likes;
  updateLikeCount();
}

// 长祝福在结尾屏采用紧凑排版，完整展示正文和发送人，避免手机端出现嵌套滚动。
function applyFinalMessageLengthClasses(message) {
  const length = Array.from(message.trim()).length;
  const finalContent = dom.finalMessage.closest(".final-content");
  finalContent?.classList.toggle("is-long-copy", length > 110);
  finalContent?.classList.toggle("is-max-copy", length > 190);
}

// 长昵称在手机端采用分级字号，避免片头、首屏署名被撑出视口。
function applyRecipientLengthClasses(name) {
  const length = Array.from(name.trim()).length;
  const nameElements = [dom.coverRecipient, dom.introRecipient, dom.introFinalRecipient, dom.heroRecipient];

  nameElements.forEach((element) => {
    element.classList.toggle("is-long-name", length > 8);
    element.classList.toggle("is-extra-long-name", length > 14);
  });
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
  dom.musicToggle.addEventListener("click", toggleBackgroundMusic);
  dom.skipIntroButton.addEventListener("click", skipCinematicIntro);
  window.addEventListener("pagehide", clearIntroTimers);
  document.addEventListener("visibilitychange", handleMusicVisibilityChange);
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
  // 必须在用户点击事件内立即调用 play，才能通过微信、Safari 等浏览器的自动播放限制。
  void startBackgroundMusic();
  window.setTimeout(() => {
    dom.coverView.hidden = true;
    if (prefersReducedMotion()) {
      revealStory();
      return;
    }
    startCinematicIntro();
  }, prefersReducedMotion() ? 0 : 560);
}

// 约 8.75 秒的电影式片头：问候 → 专属文案 → 倒计时 → 蛋糕 → 标题。
function startCinematicIntro() {
  clearIntroTimers();
  state.introPlaying = true;
  document.body.classList.add("is-intro-playing");
  dom.musicToggle.hidden = !state.musicAvailable;
  dom.introView.hidden = false;
  dom.introView.classList.remove("is-leaving");
  resetIntroScenes();

  window.requestAnimationFrame(() => {
    dom.introView.classList.add("is-playing");
    activateIntroScene(dom.introGreeting, `HI，${state.record.recipientName}`);
    dom.skipIntroButton.focus({ preventScroll: true });
  });

  scheduleIntro(() => activateIntroScene(dom.introToday, "今天，属于你"), 1500);
  scheduleIntro(() => showCountdownNumber("3"), 2900);
  scheduleIntro(() => showCountdownNumber("2"), 3650);
  scheduleIntro(() => showCountdownNumber("1"), 4400);
  scheduleIntro(() => activateIntroScene(dom.introCake, "蛋糕点亮，愿望正在发光"), 5200);
  scheduleIntro(() => {
    activateIntroScene(dom.introFinale, `Happy Birthday，送给${state.record.recipientName}`);
    celebrate(0.8);
  }, 6750);
  scheduleIntro(() => revealStory(), 8750);
}

function scheduleIntro(callback, delay) {
  state.introTimers.push(window.setTimeout(callback, delay));
}

function clearIntroTimers() {
  state.introTimers.forEach((timerId) => window.clearTimeout(timerId));
  state.introTimers = [];
}

function resetIntroScenes() {
  dom.introView.classList.remove("is-playing");
  dom.introView.querySelectorAll(".intro-scene").forEach((scene) => {
    scene.classList.remove("is-active");
    scene.setAttribute("aria-hidden", "true");
  });
  dom.countdownNumber.textContent = "3";
  dom.countdownNumber.classList.remove("is-changing");
  dom.introAnnouncement.textContent = "";
}

function activateIntroScene(scene, announcement) {
  dom.introView.querySelectorAll(".intro-scene").forEach((item) => {
    const active = item === scene;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-hidden", String(!active));
  });
  dom.introAnnouncement.textContent = announcement;
}

function showCountdownNumber(number) {
  activateIntroScene(dom.introCountdown, `倒计时，${number}`);
  dom.countdownNumber.textContent = number;
  dom.countdownNumber.classList.remove("is-changing");
  void dom.countdownNumber.offsetWidth;
  dom.countdownNumber.classList.add("is-changing");
}

function skipCinematicIntro() {
  if (!state.introPlaying) return;
  revealStory(true);
}

function revealStory(celebrateOnEnter = false) {
  clearIntroTimers();
  state.introPlaying = false;
  document.body.classList.remove("is-intro-playing");
  dom.musicToggle.hidden = !state.musicAvailable;
  dom.introView.classList.remove("is-playing");
  dom.introView.classList.add("is-leaving");

  window.setTimeout(() => {
    dom.introView.hidden = true;
    dom.introView.classList.remove("is-leaving");
    dom.storyView.hidden = false;
    document.body.classList.add("has-entered");
    dom.storyScroller.focus({ preventScroll: true });
    dom.storyScroller.scrollTo({ top: 0 });
    const first = dom.storyScroller.querySelector(".story-screen");
    first?.classList.add("is-active");
    if (celebrateOnEnter) celebrate(0.65);
  }, prefersReducedMotion() ? 0 : 360);
}

function setupBackgroundMusic() {
  dom.backgroundMusic.volume = DEFAULT_MUSIC_VOLUME;
  try {
    state.musicMuted = localStorage.getItem(MUSIC_MUTED_KEY) === "1";
  } catch {
    state.musicMuted = false;
  }

  dom.backgroundMusic.addEventListener("play", () => {
    state.musicPlaying = true;
    updateMusicControl();
  });
  dom.backgroundMusic.addEventListener("pause", () => {
    state.musicPlaying = false;
    updateMusicControl();
  });
  dom.backgroundMusic.addEventListener("error", () => {
    state.musicAvailable = false;
    state.musicPlaying = false;
    dom.musicToggle.hidden = true;
    announceMusicStatus("背景音乐暂时无法加载");
  });
  updateMusicControl();
}

async function startBackgroundMusic() {
  if (!state.musicAvailable || state.musicMuted || !dom.backgroundMusic.paused) return;
  try {
    await dom.backgroundMusic.play();
  } catch (error) {
    state.musicPlaying = false;
    updateMusicControl();
    if (error?.name !== "AbortError") {
      announceMusicStatus("点击右上角音乐按钮即可播放");
    }
  }
}

function toggleBackgroundMusic() {
  if (!state.musicAvailable) return;
  if (!dom.backgroundMusic.paused) {
    state.musicMuted = true;
    dom.backgroundMusic.pause();
    persistMusicPreference();
    announceMusicStatus("背景音乐已关闭");
    return;
  }

  state.musicMuted = false;
  persistMusicPreference();
  announceMusicStatus("背景音乐已开启");
  void startBackgroundMusic();
}

function updateMusicControl() {
  const isPlaying = state.musicPlaying && !state.musicMuted;
  dom.musicToggle.classList.toggle("is-playing", isPlaying);
  dom.musicToggle.classList.toggle("is-muted", !isPlaying);
  dom.musicToggle.setAttribute("aria-pressed", String(isPlaying));
  const label = isPlaying ? "暂停背景音乐" : "播放背景音乐";
  dom.musicToggle.setAttribute("aria-label", label);
  dom.musicToggle.title = label;
}

function persistMusicPreference() {
  try {
    localStorage.setItem(MUSIC_MUTED_KEY, state.musicMuted ? "1" : "0");
  } catch (error) {
    console.warn("音乐开关状态无法保存到本地存储。", error);
  }
  updateMusicControl();
}

function announceMusicStatus(message) {
  dom.musicStatus.textContent = "";
  window.setTimeout(() => { dom.musicStatus.textContent = message; }, 10);
}

function handleMusicVisibilityChange() {
  if (!document.hidden && !dom.musicToggle.hidden && !state.musicMuted) {
    void startBackgroundMusic();
  }
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

"use strict";

// 与背景音乐共享播放时机，但不写入用户的静音偏好。
window.BirthdayVoicePlayer = class BirthdayVoicePlayer {
  constructor(record, { music, isMuted, resumeMusic }) {
    this.music = music;
    this.isMuted = isMuted;
    this.resumeMusic = resumeMusic;
    this.active = false;
    this.shouldResume = false;
    this.operation = 0;
    this.player = document.getElementById("blessingVoice");
    this.button = document.getElementById("voicePlayButton");
    this.error = document.getElementById("voicePlaybackError");
    const wrapper = document.getElementById("blessingVoiceSection");
    if (!record?.dataUrl?.startsWith("data:audio/")) return;
    wrapper.hidden = false;
    wrapper.closest(".final-screen").classList.add("has-voice");
    this.player.src = record.dataUrl;
    this.button.addEventListener("click", () => {
      if (this.active || !this.player.paused) this.stop(false, true);
      else void this.play();
    });
    this.player.addEventListener("play", () => { this.holdMusic(); this.button.textContent = "暂停语音祝福"; });
    this.player.addEventListener("pause", () => { this.operation += 1; this.releaseMusic(); });
    this.player.addEventListener("ended", () => this.releaseMusic());
    this.player.addEventListener("error", () => {
      this.releaseMusic();
      this.error.textContent = "语音暂时无法播放，请点击重试；旧录音可尝试在系统浏览器打开。";
      this.button.textContent = "重试播放语音";
    });
  }

  holdMusic() {
    if (!this.active) this.shouldResume = !this.music.paused && !this.isMuted();
    this.active = true;
    this.music.pause();
  }

  releaseMusic(restore = true) {
    const resume = this.active && this.shouldResume;
    this.active = false;
    this.shouldResume = false;
    this.button.textContent = this.player.ended ? "再听一次祝福" : "听听我的祝福";
    if (restore && resume && !this.isMuted() && !document.hidden) void this.resumeMusic();
  }

  async play() {
    const token = ++this.operation;
    this.error.textContent = "";
    if (this.player.error) this.player.load();
    if (this.player.ended) this.player.currentTime = 0;
    this.holdMusic();
    this.button.textContent = "正在播放…";
    try { await this.player.play(); }
    catch {
      if (token !== this.operation) return;
      this.releaseMusic();
      this.error.textContent = "播放未成功，请再次点击播放，或用系统浏览器打开。";
      this.button.textContent = "重试播放语音";
    }
  }

  stop(reset = false, restore = true) {
    this.operation += 1;
    this.releaseMusic(restore); // 在异步 pause 事件到达前先清理，避免重复恢复音乐。
    this.player.pause();
    if (reset && this.player.readyState) this.player.currentTime = 0;
  }
};

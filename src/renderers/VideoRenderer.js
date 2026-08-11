import { clamp } from "../utils/common.js";

export class VideoRenderer {
  constructor(runtime, source, config) {
    this.runtime = runtime;
    this.source = source;
    this.config = config;

    this.video = null;
    this.reverseVideo = null;
    this.activeVideo = null;
    this.activeDirection = 1;
    this.usingReverseAsset = false;

    this.ready = false;
    this.reverseReady = false;
    // `ready` means metadata/range is usable. `visualReady` is stricter: at
    // least one decodable video frame is available for compositing. Scrub mode
    // gates first overlay exposure on the latter to prevent full-screen black.
    this.visualReady = false;

    this.nativeEndResolver = null;
    this.nativePlaying = false;
    this.nativeDirection = 1;
    this.nativeWatchId = null;
    this.nativeWatchKind = null;
    this.nativeStart = 0;
    this.nativeEnd = 0;

    this.prepareCancels = new Set();
    this.timelineSwitchToken = 0;
    this.pendingTimelineVideo = null;
  }

  get videoMode() {
    const configured = this.config.playback.videoMode || "auto";
    if (configured !== "auto") return configured;
    const mode = this.runtime.normalizedScrollMode?.() || this.config.scroll.mode;
    return mode === "takeover" ? "native" : "timeline";
  }

  createVideo(src, { reverse = false } = {}) {
    const video = document.createElement("video");
    video.className = reverse ? "st-video st-video--reverse" : "st-video st-video--forward";
    video.src = src;
    video.preload = this.source.preload || "auto";
    video.muted = this.source.muted !== false;
    video.playsInline = true;
    video.controls = false;
    video.loop = false;
    video.style.position = "absolute";
    video.style.inset = "0";
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = this.config.render.fit;
    video.style.objectPosition = this.config.render.position;
    video.style.visibility = reverse ? "hidden" : "visible";

    const crossOrigin = reverse
      ? (this.source.reverseCrossOrigin || this.source.crossOrigin)
      : this.source.crossOrigin;
    if (crossOrigin) video.crossOrigin = crossOrigin;

    video.addEventListener("ended", () => {
      if (video === this.activeVideo) this.finishNativePlayback(true);
    });

    const notifyVisual = () => {
      if (video === this.activeVideo && video.readyState >= 2 && !video.seeking) {
        this.visualReady = true;
      }
      this.runtime.requestRender?.();
    };
    video.addEventListener("loadeddata", notifyVisual);
    video.addEventListener("canplay", notifyVisual);
    video.addEventListener("seeked", notifyVisual);

    return video;
  }

  prepareElement(video, src, rangeResolver) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = Math.max(1000, Number(this.config.loading?.timeout) || 8000);
      let timer = 0;

      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onError);
        this.prepareCancels.delete(cancel);
      };

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };

      const onLoaded = () => {
        if (this.runtime.destroyed) {
          finish(reject, new Error("Video preparation cancelled"));
          return;
        }
        try {
          rangeResolver();
          finish(resolve, true);
        } catch (error) {
          finish(reject, error);
        }
      };

      const onError = () => finish(reject, new Error(`Could not load video ${src}`));
      const cancel = () => finish(reject, new Error("Video preparation cancelled"));
      this.prepareCancels.add(cancel);

      video.addEventListener("loadedmetadata", onLoaded);
      video.addEventListener("error", onError);
      timer = setTimeout(() => {
        finish(reject, new Error(`Timed out loading video metadata ${src}`));
      }, timeout);

      video.load();
    });
  }

  async prepare() {
    if (this.ready) return true;

    this.video = this.createVideo(this.source.src);
    this.activeVideo = this.video;
    if (!this.video.isConnected) this.runtime.stage.appendChild(this.video);

    let reversePromise = null;
    const shouldPrepareReverse = !!this.source.reverseSrc &&
      this.config.scroll.reversible !== false;
    if (shouldPrepareReverse) {
      this.reverseVideo = this.createVideo(this.source.reverseSrc, { reverse: true });
      if (!this.reverseVideo.isConnected) this.runtime.stage.appendChild(this.reverseVideo);
      // Start reverse metadata loading immediately so it is ready long before a
      // user reaches the reverse boundary.
      reversePromise = this.prepareElement(
        this.reverseVideo,
        this.source.reverseSrc,
        () => this.reverseMediaRange()
      ).then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error })
      );
    }

    try {
      await this.prepareElement(this.video, this.source.src, () => this.forwardMediaRange());
      this.ready = true;
    } catch (error) {
      this.cleanupVideoElement(this.video);
      this.cleanupVideoElement(this.reverseVideo);
      this.video = null;
      this.reverseVideo = null;
      this.activeVideo = null;
      throw error;
    }

    if (reversePromise) {
      const reverseResult = await reversePromise;
      if (reverseResult.ok) {
        this.reverseReady = true;
      } else {
        // A broken optional reverse asset must never disable forward navigation.
        // Fall back to legacy timeline seeking and report the limitation in debug.
        this.reverseReady = false;
        this.runtime.debug(
          "reverseSrc could not be prepared; reverse playback will fall back to timeline seeking",
          reverseResult.error
        );
        this.cleanupVideoElement(this.reverseVideo);
        this.reverseVideo = null;
      }
    }

    return true;
  }

  /** Resolve a trimmed + normalized media window for one encoded file. */
  mediaRangeFor(video, trim = {}, normalizedRange = { start: 0, end: 1 }, src = "video") {
    const duration = Number(video?.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`Video duration is not seekable for ${src}`);
    }

    const epsilon = Math.min(0.001, duration / 1000);
    const safeEnd = Math.max(0, duration - epsilon);
    const trimStart = clamp(Number.isFinite(trim?.start) ? trim.start : 0, 0, safeEnd);
    const requestedEnd = trim?.end == null ? safeEnd : Number(trim.end);
    const trimEnd = clamp(requestedEnd, 0, safeEnd);

    if (trimEnd <= trimStart + epsilon) {
      throw new Error(
        `Video trim resolves to an empty range for ${src}: ${trimStart}s → ${trimEnd}s`
      );
    }

    const rangeStart = clamp(Number(normalizedRange?.start ?? 0));
    const rangeEnd = clamp(Number(normalizedRange?.end ?? 1));
    const span = trimEnd - trimStart;
    const start = trimStart + span * rangeStart;
    const end = trimStart + span * rangeEnd;

    if (end <= start + epsilon) {
      throw new Error(
        `Playback range resolves to an empty video range for ${src}: ${start}s → ${end}s`
      );
    }

    return { start, end, duration: end - start, trimStart, trimEnd };
  }

  forwardMediaRange() {
    return this.mediaRangeFor(
      this.video,
      this.source.trim || {},
      this.config.playback?.range || { start: 0, end: 1 },
      this.source.src
    );
  }

  reverseMediaRange() {
    return this.mediaRangeFor(
      this.reverseVideo,
      this.source.reverseTrim || {},
      this.config.playback?.reverseRange || { start: 0, end: 1 },
      this.source.reverseSrc || "reverse video"
    );
  }

  // Backward-compatible public helper used by existing integrations/tests.
  mediaRange() {
    return this.forwardMediaRange();
  }

  setActiveVideo(video, { reverseAsset = false, direction = 1 } = {}) {
    this.activeVideo = video || this.video;
    this.activeDirection = direction;
    this.usingReverseAsset = !!reverseAsset;
    this.visualReady = !!(this.activeVideo?.readyState >= 2 && !this.activeVideo?.seeking);

    if (this.video) this.video.style.visibility = this.activeVideo === this.video ? "visible" : "hidden";
    if (this.reverseVideo) {
      this.reverseVideo.style.visibility = this.activeVideo === this.reverseVideo ? "visible" : "hidden";
    }
  }

  /**
   * Select and pre-position the encoded file before the overlay becomes visible.
   * With reverseSrc, reverse navigation starts at time 0 of the pre-reversed file
   * and can therefore use normal forward decoding/playback.
   */
  prepareForDirection(direction) {
    this.cancelNativePlayback();

    const useReverse = direction < 0 && this.reverseReady && this.reverseVideo;
    const desiredVideo = useReverse ? this.reverseVideo : this.video;
    const desiredReverse = !!useReverse;

    // Takeover/native playback selects the encoded file before the full-screen
    // stage appears, so immediate visibility switching is safe and desirable.
    if (this.videoMode === "native") {
      this.pendingTimelineVideo = null;
      this.timelineSwitchToken += 1;
      this.setActiveVideo(desiredVideo, { reverseAsset: desiredReverse, direction });
      try {
        const range = desiredReverse ? this.reverseMediaRange() : this.forwardMediaRange();
        desiredVideo.pause?.();
        desiredVideo.currentTime = desiredReverse
          ? range.start
          : (direction > 0 ? range.start : range.end);
      } catch (_) {}
      return direction > 0 || desiredReverse;
    }

    // Scroll-linked video can reverse direction at any progress. Switching a
    // dual-encoded source immediately would briefly expose time=0 while the new
    // file seeks. Keep the currently composited frame visible, pre-seek the
    // desired encoded file to the equivalent logical progress, then atomically
    // swap visibility on seeked/loadeddata. This avoids both backward GOP
    // decoding and the one-frame reverseSrc flash.
    if (desiredVideo && desiredVideo !== this.activeVideo) {
      const token = ++this.timelineSwitchToken;
      this.pendingTimelineVideo = desiredVideo;
      const progress = clamp(this.runtime.progress);
      let target = null;
      try {
        const range = desiredReverse ? this.reverseMediaRange() : this.forwardMediaRange();
        const local = desiredReverse ? 1 - progress : progress;
        target = range.start + local * range.duration;
        desiredVideo.pause?.();
        if (Math.abs(Number(desiredVideo.currentTime) - target) > 0.025) {
          desiredVideo.currentTime = target;
        }
      } catch (_) {}

      const commit = () => {
        if (token !== this.timelineSwitchToken || this.runtime.destroyed) return;
        if (Number.isFinite(target) && (desiredVideo.seeking || desiredVideo.readyState < 2)) return;
        this.pendingTimelineVideo = null;
        this.setActiveVideo(desiredVideo, { reverseAsset: desiredReverse, direction });
        this.runtime.requestRender?.();
      };

      if (!Number.isFinite(target) || (desiredVideo.readyState >= 2 && !desiredVideo.seeking)) {
        commit();
      } else {
        desiredVideo.addEventListener("seeked", commit, { once: true });
        desiredVideo.addEventListener("loadeddata", commit, { once: true });
      }
      return direction > 0 || desiredReverse;
    }

    this.activeDirection = direction;
    this.usingReverseAsset = desiredReverse && desiredVideo === this.reverseVideo;
    return direction > 0 || this.usingReverseAsset;
  }

  targetTimeForProgress(progress) {
    const video = this.activeVideo || this.video;
    if (!this.ready || !video?.duration) return null;

    let windowRange;
    let localProgress;
    if (this.usingReverseAsset && video === this.reverseVideo) {
      windowRange = this.reverseMediaRange();
      localProgress = 1 - clamp(progress);
    } else {
      windowRange = this.forwardMediaRange();
      localProgress = clamp(progress);
    }
    return windowRange.start + localProgress * windowRange.duration;
  }

  prime() {
    // Video metadata preparation already started network loading. A scrub update
    // will render/seek on the manager RAF; event listeners request another frame
    // when `loadeddata`/`seeked` makes that media frame drawable.
    try {
      if (this.activeVideo?.networkState === 0) this.activeVideo.load?.();
    } catch (_) {}
  }

  hasDrawableFrame(progress = this.runtime.progress, { exact = false } = {}) {
    const video = this.activeVideo || this.video;
    if (!this.ready || !video || video.readyState < 2 || video.seeking) return false;
    if (!exact) return true;

    try {
      const target = this.targetTimeForProgress(progress);
      if (!Number.isFinite(target)) return false;
      return Math.abs(Number(video.currentTime) - target) <= 0.04;
    } catch (_) {
      return false;
    }
  }

  render(progress) {
    const video = this.activeVideo || this.video;
    if (!this.ready || !video?.duration) return;
    if (this.videoMode === "native" && this.nativePlaying) return;
    if (this.pendingTimelineVideo) return;

    let target;
    try { target = this.targetTimeForProgress(progress); } catch (_) { return; }
    if (!Number.isFinite(target)) return;

    if (Math.abs(video.currentTime - target) > 0.025) {
      // Keep the old decoded frame composited while seeking. ScrubDriver only
      // requires exact readiness before the *first* exposure, not on every frame.
      try { video.currentTime = target; } catch (_) {}
    } else if (video.readyState >= 2 && !video.seeking) {
      this.visualReady = true;
    }
  }

  setAlignmentTransform(transform = {}) {
    const scale = Number.isFinite(transform.scale) ? transform.scale : 1;
    const x = Number.isFinite(transform.x) ? transform.x : 0;
    const y = Number.isFinite(transform.y) ? transform.y : 0;
    for (const video of [this.video, this.reverseVideo]) {
      if (!video) continue;
      video.style.transformOrigin = transform.origin || "center center";
      video.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    }
  }

  clearAlignmentTransform() {
    for (const video of [this.video, this.reverseVideo]) {
      if (!video) continue;
      video.style.transform = "";
      video.style.transformOrigin = "";
    }
  }

  readiness() {
    return {
      loaded: this.ready ? 1 : 0,
      total: 1,
      ratio: this.ready ? 1 : 0,
      cacheSize: 0,
      failed: this.ready ? 0 : 1,
      reverseConfigured: !!this.source.reverseSrc,
      reverseReady: !!this.reverseReady,
      reverseStrategy: this.reverseReady ? "reverseSrc" : "timeline-seek"
    };
  }

  async ensureReady() {
    return this.ready;
  }

  scheduleNativeWatch(callback) {
    if (typeof requestAnimationFrame === "function") {
      this.nativeWatchKind = "raf";
      this.nativeWatchId = requestAnimationFrame(callback);
    } else {
      this.nativeWatchKind = "timeout";
      this.nativeWatchId = setTimeout(() => callback(performance.now()), 16);
    }
  }

  cancelNativeWatch() {
    if (this.nativeWatchId == null) return;
    if (this.nativeWatchKind === "raf" && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.nativeWatchId);
    } else {
      clearTimeout(this.nativeWatchId);
    }
    this.nativeWatchId = null;
    this.nativeWatchKind = null;
  }

  watchNativeProgress() {
    this.cancelNativeWatch();

    const check = () => {
      this.nativeWatchId = null;
      const video = this.activeVideo || this.video;
      if (!this.nativePlaying || !video || this.runtime.destroyed) return;

      const span = Math.max(0.001, this.nativeEnd - this.nativeStart);
      const localProgress = clamp((video.currentTime - this.nativeStart) / span);
      const runtimeProgress = this.nativeDirection > 0
        ? localProgress
        : 1 - localProgress;
      this.runtime.setProgress(runtimeProgress);

      if (video.currentTime >= this.nativeEnd - 0.016 || video.ended) {
        try { video.pause(); } catch (_) {}
        try { video.currentTime = this.nativeEnd; } catch (_) {}
        this.runtime.setProgress(this.nativeDirection > 0 ? 1 : 0);
        this.finishNativePlayback(true);
        return;
      }

      this.scheduleNativeWatch(check);
    };

    this.scheduleNativeWatch(check);
  }

  finishNativePlayback(completed) {
    if (!this.nativePlaying && !this.nativeEndResolver) return;
    this.cancelNativeWatch();
    this.nativePlaying = false;
    if (this.nativeEndResolver) {
      const resolver = this.nativeEndResolver;
      this.nativeEndResolver = null;
      resolver(completed === true);
    }
  }

  async playNative(direction) {
    if (this.runtime.destroyed) return false;

    if (direction < 0 && !(this.reverseReady && this.reverseVideo)) {
      // Negative playbackRate is not interoperable. Without reverseSrc, the
      // driver must fall back to timeline seeking on the forward file.
      this.runtime.debug(
        "Smooth native reverse requires source.reverseSrc; using timeline-seek fallback"
      );
      return false;
    }

    this.prepareForDirection(direction);
    const video = this.activeVideo;
    if (!video?.duration) return false;

    let range;
    try {
      range = direction > 0 ? this.forwardMediaRange() : this.reverseMediaRange();
    } catch (error) {
      this.runtime.debug("Native video range is invalid; falling back to timeline", error);
      return false;
    }

    this.nativeStart = range.start;
    this.nativeEnd = range.end;
    this.nativeDirection = direction;
    try { video.currentTime = range.start; } catch (_) {}

    const configuredRate = direction < 0
      ? (this.source.reversePlaybackRate ?? this.source.playbackRate)
      : this.source.playbackRate;
    video.playbackRate = Math.max(0.25, Number(configuredRate) || 1);

    try {
      await video.play();
    } catch (error) {
      this.runtime.debug("Native video play failed; falling back to timeline", error);
      return false;
    }

    if (this.runtime.destroyed) return false;

    this.nativePlaying = true;
    this.runtime.setProgress(direction > 0 ? 0 : 1);
    this.watchNativeProgress();
    const completed = await new Promise((resolve) => {
      this.nativeEndResolver = resolve;
    });
    return completed === true;
  }

  cancelNativePlayback() {
    this.cancelNativeWatch();
    this.nativePlaying = false;
    if (this.nativeEndResolver) {
      const resolver = this.nativeEndResolver;
      this.nativeEndResolver = null;
      resolver(false);
    }
    try { this.video?.pause(); } catch (_) {}
    try { this.reverseVideo?.pause(); } catch (_) {}
  }

  pause() {
    try { this.activeVideo?.pause(); } catch (_) {}
  }

  resume() {
    if (this.nativePlaying && this.activeVideo?.paused) {
      this.activeVideo.play().catch((error) => {
        this.runtime.reportError(error, { phase: "video-resume" });
      });
    }
  }

  renderReducedMotion() {
    this.setActiveVideo(this.video, { reverseAsset: false, direction: 1 });
    this.render(1);
  }

  cleanupVideoElement(video) {
    if (!video) return;
    try { video.pause(); } catch (_) {}
    try { video.removeAttribute("src"); } catch (_) {}
    try { video.load(); } catch (_) {}
    try { video.remove(); } catch (_) {}
  }


  getVisualElement() {
    const video = this.activeVideo || this.video;
    return video && video.readyState >= 2 ? video : null;
  }

  destroy() {
    for (const cancel of [...this.prepareCancels]) {
      try { cancel(); } catch (_) {}
    }
    this.prepareCancels.clear();
    this.cancelNativePlayback();
    this.timelineSwitchToken += 1;
    this.pendingTimelineVideo = null;
    this.clearAlignmentTransform();
    this.ready = false;
    this.reverseReady = false;
    this.visualReady = false;
    this.cleanupVideoElement(this.video);
    this.cleanupVideoElement(this.reverseVideo);
    this.video = null;
    this.reverseVideo = null;
    this.activeVideo = null;
  }
}

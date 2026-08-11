import { AssetManager } from "../assets/AssetManager.js";
import { clamp } from "../utils/common.js";

function parsePosition(position) {
  const [x = "center", y = "center"] = String(position || "center center").split(/\s+/);
  return { x, y };
}

function offset(container, content, align) {
  if (align === "left" || align === "top") return 0;
  if (align === "right" || align === "bottom") return container - content;
  return (container - content) / 2;
}

export class SequenceRenderer {
  constructor(runtime, source, config) {
    this.runtime = runtime;
    this.source = source;
    this.config = config;
    this.assetManager = new AssetManager(source, config, {
      debug: (...args) => runtime.debug(...args),
      onFrameLoaded: () => runtime.requestRender(),
      onFrameError: (error, details) =>
        runtime.reportError(error, { phase: "asset-load", ...details })
    });

    this.canvas = null;
    this.ctx = null;
    this.lastIndex = -1;
    this.paintedIndex = -1;
    this.hasPaintedFrame = false;
    this.lastDraw = 0;
    this.preloadPromise = null;
    this.throttleTimer = 0;
    this.motion = {
      direction: 1,
      velocity: 0,
      projectedProgress: 0,
      tier: 0,
      step: 1
    };
    this.lastPrimeSignature = "";
  }

  async prepare(options = {}) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "st-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    // A blank alpha:false canvas is opaque black in several browsers. Keep the
    // surface non-composited until a real frame has been drawn. ScrubDriver has
    // a second readiness gate at stage level, so this is defense in depth.
    this.canvas.style.visibility = "hidden";
    this.runtime.stage.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d", { alpha: !!this.runtime.sceneManaged });

    this.resize();

    if (options.deferAssets) {
      // Canvas/stage is ready, but large media loading waits until the
      // transition approaches the viewport via IntersectionObserver.
      return false;
    }

    return await this.startPreload();
  }

  startPreload() {
    if (this.preloadPromise) return this.preloadPromise;

    const timeoutMs = Math.max(1000, Number(this.config.loading?.timeout) || 8000);
    const critical = this.assetManager.prepareCritical();
    const timeout = new Promise((resolve) => {
      setTimeout(() => resolve(false), timeoutMs);
    });

    const strategy = this.config.preload.strategy;
    critical.then((ready) => {
      if (
        ready &&
        !this.runtime.destroyed &&
        (strategy === "all" || strategy === "progressive")
      ) {
        this.assetManager.progressivePreload();
      }
    }).catch(() => {});

    this.preloadPromise = Promise.race([critical, timeout]).then((ready) => {
      if (this.runtime.destroyed) return false;
      return !!ready;
    });

    return this.preloadPromise;
  }

  frameIndex(progress) {
    const range = this.config.playback?.range || { start: 0, end: 1 };
    const mediaProgress = clamp(range.start + clamp(progress) * (range.end - range.start));
    return Math.round(mediaProgress * (this.source.count - 1));
  }

  motionConfig() {
    return this.config.preload?.motion || {};
  }

  motionTier(velocity = this.motion.velocity) {
    return this.assetManager.motionTier(velocity);
  }

  adaptiveStep(velocity = this.motion.velocity) {
    const cfg = this.motionConfig();
    if (cfg.enabled === false || cfg.adaptiveFrames === false) return 1;
    const tier = this.motionTier(velocity);
    const maxStep = Math.max(1, Math.round(Number(cfg.maxStep) || 4));
    if (tier <= 0) return 1;
    if (tier === 1) return Math.min(maxStep, 2);
    if (tier === 2) return Math.min(maxStep, 3);
    return maxStep;
  }

  displayIndex(progress) {
    const exact = this.frameIndex(progress);
    const range = this.config.playback?.range || { start: 0, end: 1 };
    const first = Math.round(clamp(range.start) * (this.source.count - 1));
    const last = Math.round(clamp(range.end) * (this.source.count - 1));
    if (exact <= first || exact >= last) return exact; // endpoints are always exact

    const step = this.adaptiveStep();
    if (step <= 1) return exact;
    const quantized = first + Math.round((exact - first) / step) * step;
    return clamp(quantized, first, last);
  }

  updateMotion(motion = {}) {
    const direction = Number(motion.direction) < 0 ? -1 : 1;
    const velocity = Number(motion.velocity) || 0;
    const projectedProgress = clamp(
      Number.isFinite(motion.projectedProgress) ? motion.projectedProgress : this.runtime.progress
    );
    this.motion = {
      direction,
      velocity,
      projectedProgress,
      tier: this.motionTier(velocity),
      step: this.adaptiveStep(velocity)
    };
  }

  /**
   * Cheap scrub arming: request only the exact frame needed at the current
   * boundary/progress. AssetManager deduplicates concurrent requests. Full
   * nearby/critical preloading remains governed by the existing preload policy.
   */
  prime(progress, motion = {}) {
    if (this.runtime.destroyed) return;
    this.updateMotion({ ...motion, projectedProgress: motion.projectedProgress ?? progress });
    const index = this.displayIndex(progress);
    const projectedIndex = this.displayIndex(this.motion.projectedProgress);
    const signature = `${index}:${projectedIndex}:${this.motion.direction}:${this.motion.tier}`;
    if (signature === this.lastPrimeSignature && this.assetManager.inflight.has(index)) return;
    this.lastPrimeSignature = signature;
    this.assetManager.scheduleMotion(index, {
      direction: this.motion.direction,
      velocity: this.motion.velocity,
      projectedIndex
    });
  }

  /**
   * Scrub overlays use exact=true only for their first exposure. Once visible,
   * the last valid frame remains on screen while later frames decode.
   */
  hasDrawableFrame(progress = this.runtime.progress, { exact = false } = {}) {
    if (!this.hasPaintedFrame || !this.canvas || !this.ctx) return false;
    if (!exact) return true;
    return this.paintedIndex === this.displayIndex(progress);
  }

  resize() {
    if (!this.canvas) return;
    const maxDpr = Math.max(1, this.config.render.maxDpr || 2);
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);

    // The CSS box must always follow the transition stage itself. On mobile,
    // `100dvh` / fixed-inset geometry can update while browser chrome is
    // collapsing before `window.innerHeight` catches up. Pixel-locking the
    // canvas to innerHeight exposes the stage background as a temporary strip.
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";

    const stageRect = this.runtime.stage?.getBoundingClientRect?.();
    const viewport = window.visualViewport;
    const cssWidth = Math.max(
      1,
      Number(stageRect?.width) || Number(viewport?.width) || Number(window.innerWidth) || 1
    );
    const cssHeight = Math.max(
      1,
      Number(stageRect?.height) || Number(viewport?.height) || Number(window.innerHeight) || 1
    );
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));

    if (this.canvas.width === w && this.canvas.height === h) return;

    // Assigning canvas.width/height clears the backing store immediately. Keep
    // the currently displayed decoded frame alive across the resize and redraw
    // it synchronously in the same JS task. The compositor therefore never sees
    // an empty black canvas during mobile toolbar/visualViewport changes.
    const previousIndex = this.paintedIndex;
    const preserved = previousIndex >= 0 ? this.assetManager.cache.get(previousIndex) : null;

    // If the displayed decoded frame has already been evicted, snapshot the
    // current backing store before resizing. This updates DPR/geometry now while
    // preserving visible pixels, instead of leaving a stale backing resolution
    // indefinitely until another frame happens to decode.
    let visualSnapshot = null;
    if (this.hasPaintedFrame && !preserved && typeof document !== "undefined") {
      try {
        visualSnapshot = document.createElement("canvas");
        visualSnapshot.width = Math.max(1, this.canvas.width || 1);
        visualSnapshot.height = Math.max(1, this.canvas.height || 1);
        visualSnapshot.getContext("2d", { alpha: true })?.drawImage(this.canvas, 0, 0);
      } catch (_) {
        visualSnapshot = null;
      }
    }

    // If snapshotting is unavailable, retain the old backing store rather than
    // exposing an empty surface. A later render/resize can try again.
    if (this.runtime.driver?.overlayActive && this.hasPaintedFrame && !preserved && !visualSnapshot) {
      this.runtime.requestRender();
      return;
    }

    this.canvas.width = w;
    this.canvas.height = h;
    this.hasPaintedFrame = false;
    this.paintedIndex = -1;
    this.canvas.style.visibility = "hidden";

    if (preserved) {
      this.draw(preserved, previousIndex);
      this.lastIndex = previousIndex;
    } else if (visualSnapshot && this.ctx) {
      try {
        this.ctx.clearRect?.(0, 0, w, h);
        this.ctx.drawImage(visualSnapshot, 0, 0, w, h);
        this.hasPaintedFrame = true;
        this.paintedIndex = previousIndex;
        this.canvas.style.visibility = "visible";
        // Force the exact decoded frame to replace this temporary raster as soon
        // as it is available; do not let the render fast-path treat it as final.
        this.lastIndex = -1;
      } catch (_) {
        this.hasPaintedFrame = false;
        this.paintedIndex = -1;
        this.lastIndex = -1;
      }
      this.runtime.requestRender();
    } else {
      this.lastIndex = -1;
      this.runtime.requestRender();
    }
  }

  draw(frame, index = null) {
    if (!frame || !this.ctx) return false;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const mw = frame.width;
    const mh = frame.height;
    if (!mw || !mh || !cw || !ch) return false;

    const scale = this.config.render.fit === "contain"
      ? Math.min(cw / mw, ch / mh)
      : Math.max(cw / mw, ch / mh);

    const dw = mw * scale;
    const dh = mh * scale;
    const pos = parsePosition(this.config.render.position);
    const dx = offset(cw, dw, pos.x);
    const dy = offset(ch, dh, pos.y);

    this.ctx.save();
    if (this.runtime.sceneManaged) {
      // Scene scrub keeps the persistent static scene canvas underneath this
      // transition surface. Clear to alpha rather than black so contain/crop
      // gaps expose the owned scene background, never an artificial color.
      this.ctx.clearRect(0, 0, cw, ch);
    } else {
      this.ctx.fillStyle = this.config.render.background || "#000";
      this.ctx.fillRect(0, 0, cw, ch);
    }
    this.ctx.drawImage(frame, dx, dy, dw, dh);
    this.ctx.restore();

    this.hasPaintedFrame = true;
    if (Number.isInteger(index)) this.paintedIndex = index;
    this.canvas.style.visibility = "visible";
    return true;
  }

  scheduleAfterThrottle(delay) {
    if (this.throttleTimer || this.runtime.destroyed) return;
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = 0;
      if (!this.runtime.destroyed) this.runtime.requestRender();
    }, Math.max(0, delay));
  }

  render(progress, timestamp) {
    if (this.runtime.destroyed || !this.canvas || !this.ctx) return;
    const maxFps = Math.max(1, this.config.playback.maxFps || 60);
    const minInterval = 1000 / maxFps;
    const elapsed = timestamp - this.lastDraw;
    if (this.hasPaintedFrame && elapsed < minInterval) {
      // A frame may have finished decoding after scrolling stopped. Do not drop
      // that final render because of the FPS limiter; schedule the earliest legal
      // repaint so scrub arming can complete without another scroll event.
      this.scheduleAfterThrottle(minInterval - elapsed);
      return;
    }

    const index = this.displayIndex(progress);
    const projectedIndex = this.displayIndex(this.motion.projectedProgress);
    this.assetManager.scheduleMotion(index, {
      direction: this.motion.direction,
      velocity: this.motion.velocity,
      projectedIndex
    });

    if (index === this.lastIndex && this.hasPaintedFrame && this.paintedIndex === index) return;

    const cached = this.assetManager.cache.get(index);
    if (cached) {
      if (this.draw(cached, index)) {
        this.lastIndex = index;
        this.lastDraw = timestamp;
      }
      return;
    }

    // Never blank an already-visible transition while waiting. Draw the nearest
    // available frame, then request the exact frame asynchronously. During first
    // scrub activation ScrubDriver still requires an exact painted frame.
    const nearest = this.assetManager.bestCached(index, {
      direction: this.motion.direction,
      preferMovement: this.motion.tier >= 2,
      paintedIndex: this.paintedIndex,
      maxLead: Math.max(4, this.motion.step * 3)
    });
    if (nearest && nearest.index !== this.lastIndex) {
      if (this.draw(nearest.frame, nearest.index)) {
        this.lastIndex = nearest.index;
        this.lastDraw = timestamp;
      }
    }

    this.assetManager.get(index)
      .then((frame) => {
        if (frame && !this.runtime.destroyed) this.runtime.requestRender();
      })
      .catch(() => {});
  }

  readiness() {
    return this.assetManager.readiness();
  }

  async ensureReady(timeoutMs = 8000) {
    this.startPreload().catch(() => {});
    const started = performance.now();

    while (performance.now() - started < timeoutMs) {
      const r = this.readiness();
      if (r.ratio >= 1) return true;
      await new Promise((r) => setTimeout(r, 50));
    }

    return this.readiness().ratio >= 0.5;
  }

  setAlignmentTransform(transform = {}) {
    if (!this.canvas) return;
    const scale = Number.isFinite(transform.scale) ? transform.scale : 1;
    const x = Number.isFinite(transform.x) ? transform.x : 0;
    const y = Number.isFinite(transform.y) ? transform.y : 0;
    this.canvas.style.transformOrigin = transform.origin || "center center";
    this.canvas.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
  }

  clearAlignmentTransform() {
    if (!this.canvas) return;
    this.canvas.style.transform = "";
    this.canvas.style.transformOrigin = "";
  }


  getVisualElement() {
    return this.hasPaintedFrame ? this.canvas : null;
  }

  renderReducedMotion() {
    const range = this.config.playback?.range || { start: 0, end: 1 };
    const index = Math.round(clamp(range.end) * (this.source.count - 1));
    return this.assetManager.get(index).then((frame) => this.draw(frame, index)).catch(() => {});
  }

  destroy() {
    this.clearAlignmentTransform();
    if (this.throttleTimer) clearTimeout(this.throttleTimer);
    this.throttleTimer = 0;
    this.assetManager.destroy();
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
    this.hasPaintedFrame = false;
    this.paintedIndex = -1;
    this.motion = { direction: 1, velocity: 0, projectedProgress: 0, tier: 0, step: 1 };
  }
}

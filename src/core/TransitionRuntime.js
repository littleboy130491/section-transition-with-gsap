import { STATES } from "./State.js";
import { Events } from "./Events.js";
import { SequenceRenderer } from "../renderers/SequenceRenderer.js";
import { VideoRenderer } from "../renderers/VideoRenderer.js";
import { ScrubDriver } from "../drivers/ScrubDriver.js";
import { ScrollTriggerDriver } from "../drivers/ScrollTriggerDriver.js";
import { TakeoverDriver } from "../drivers/TakeoverDriver.js";
import { ContentAnimator } from "./ContentAnimator.js";
import { clamp, resolveEasing } from "../utils/common.js";

export class TransitionRuntime {
  constructor(manager, section, name, config) {
    this.manager = manager;
    this.section = section;
    this.name = name;
    this.config = config;
    this.state = STATES.UNINITIALIZED;
    this.progress = 0;
    this.targetProgress = 0;
    this.needsRender = true;
    this.destroyed = false;
    this.renderer = null;
    this.driver = null;
    this.content = null;
    this.usingFallback = false;
    this.spacer = null;
    this.stage = null;
    this.scrubTrack = null;
    this.sceneManaged = false;
    this.stageHome = null;
    this.ownsScrollLock = false;
    this.handoffPending = false;

    this.events = new Events(
      manager.options.events,
      config.events,
      (error, context) => this.reportError(error, context)
    );

    this.reducedMotion =
      config.accessibility.respectReducedMotion &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  }

  context(extra = {}) {
    return {
      transition: this.name,
      state: this.state,
      progress: this.progress,
      runtime: this,
      ...extra
    };
  }

  debug(message, data) {
    if (this.config.debug) console.debug(`[SectionTransition:${this.name}] ${message}`, data ?? "");
  }

  setState(next) {
    this.state = next;
    this.debug(`state -> ${next}`);
  }

  reportError(error, extra = {}) {
    this.debug("error", { error, ...extra });
    if (typeof this.manager.options.onError === "function") {
      try {
        this.manager.options.onError(error, this.context(extra));
      } catch (nested) {
        console.error(nested);
      }
    } else if (!this.destroyed) {
      console.error(`[SectionTransition:${this.name}]`, error);
    }
  }

  createStage() {
    this.spacer = document.createElement("div");
    this.spacer.className = "st-spacer";
    this.spacer.dataset.transitionName = this.name;

    const scrubEngine = this.config.scroll?.scrubEngine || "auto";
    const scrollMode = this.normalizedScrollMode();
    const sceneEligible =
      ["scrub", "snap"].includes(scrollMode) &&
      this.config.scene?.enabled !== false &&
      this.manager.sceneEngine?.supportsElement?.(this.section);
    const primaryEngine = (this.config.scroll?.engine || this.config.engine?.type || "scrolltrigger") === "scrolltrigger";
    this.sceneManaged = sceneEligible && primaryEngine && scrubEngine !== "sticky" && scrubEngine !== "legacy";

    this.stage = document.createElement("div");
    this.stage.className = "st-stage";
    this.stage.style.background = this.sceneManaged ? "transparent" : this.config.render.background;
    this.stage.style.setProperty("--st-z-index", String(this.config.render.zIndex));
    this.stage.setAttribute("aria-hidden", "true");

    const stickyScrub =
      scrollMode === "scrub" &&
      !primaryEngine &&
      !this.sceneManaged &&
      scrubEngine !== "legacy" &&
      (this.config.scroll.scrubStart || "leave") !== "after";

    if (scrollMode === "takeover") {
      this.spacer.classList.add("st-spacer--auto");
      this.stage.classList.add("st-stage--auto");
      this.spacer.appendChild(this.stage);
    } else if (this.sceneManaged) {
      // v0.5: scene scrub uses one manager-owned persistent visual layer.
      // This transition stage is only the animated media surface; the static
      // source/target backgrounds live on SceneBackgroundEngine's base canvas.
      this.spacer.classList.add("st-spacer--scrub-anchor");
      this.stage.classList.add("st-stage--scene-transition");
      this.stage.style.visibility = "hidden";
      this.stage.style.opacity = "0";
      this.manager.sceneEngine.mountTransitionStage(this.stage);
    } else if (primaryEngine && ["scrub", "snap"].includes(scrollMode)) {
      // ScrollTrigger owns scroll progress; a fixed visual surface is only a
      // fallback for non-scene integrations. Declarative scenes use the
      // persistent SceneBackgroundEngine instead.
      this.spacer.classList.add("st-spacer--scrub-anchor");
      this.stage.classList.add("st-stage--scrolltrigger");
      this.stage.style.visibility = "hidden";
      this.stage.style.opacity = "0";
      document.body.appendChild(this.stage);
    } else if (stickyScrub) {
      // v0.4 native sticky-track fallback for non-scene scrub integrations.
      this.spacer.classList.add("st-spacer--scrub-anchor");
      this.scrubTrack = document.createElement("div");
      this.scrubTrack.className = "st-scrub-track";
      this.scrubTrack.dataset.transitionName = this.name;
      this.scrubTrack.style.setProperty("--st-z-index", String(this.config.render.zIndex));
      this.stage.classList.add("st-stage--scrub-sticky");
      this.stage.style.visibility = "hidden";
      this.stage.style.opacity = "0";
      this.scrubTrack.appendChild(this.stage);
    } else {
      // Explicit legacy standalone spacer/sticky scrub.
      this.spacer.appendChild(this.stage);
    }

    this.section.insertAdjacentElement("afterend", this.spacer);
    if (this.scrubTrack) document.body.appendChild(this.scrubTrack);
  }

  normalizedScrollMode() {
    const mode = this.config.scroll?.mode || "scrub";
    return mode === "auto" ? "snap" : mode;
  }

  usesScrollTrigger() {
    return ["scrub", "snap"].includes(this.normalizedScrollMode()) &&
      (this.config.scroll?.engine || this.config.engine?.type || "scrolltrigger") !== "legacy";
  }

  usesTakeover() {
    return this.normalizedScrollMode() === "takeover";
  }

  targetSection() {
    const configured = this.config.to ?? this.config.target;
    if (typeof configured === "string" && configured.trim()) {
      try {
        const found = document.querySelector(configured);
        if (found) return found;
      } catch (_) {}
    } else if (configured?.nodeType === 1) {
      return configured;
    }
    if (this.sceneManaged) {
      const nextScene = this.manager.sceneEngine?.nextScene?.(this.section);
      if (nextScene?.element) return nextScene.element;
    }
    return this.spacer?.nextElementSibling || null;
  }

  createRenderer(source = this.config.source) {
    if (source.type === "sequence") {
      return new SequenceRenderer(this, source, this.config);
    }

    if (source.type === "image") {
      // Static fallback reuses the sequence renderer with one frame.
      return new SequenceRenderer(
        this,
        { type: "sequence", src: [source.src], count: 1, crossOrigin: source.crossOrigin },
        this.config
      );
    }

    return new VideoRenderer(this, source, this.config);
  }

  async activateFallback(reason = "primary-failed") {
    if (
      this.destroyed ||
      this.usingFallback ||
      !this.config.fallback ||
      this.config.fallback === "skip"
    ) {
      return false;
    }

    this.debug("activating fallback", { reason, fallback: this.config.fallback.type });

    try {
      this.renderer?.destroy?.();
      if (this.destroyed || !this.stage) return false;
      this.stage.replaceChildren();
      this.renderer = this.createRenderer(this.config.fallback);
      this.usingFallback = true;
      const ready = await this.renderer.prepare();
      if (this.destroyed) return false;
      this.events.emit("onFallback", this.context({ reason, ready }));
      return !!ready;
    } catch (error) {
      if (!this.destroyed) this.reportError(error, { phase: "fallback", reason });
      return false;
    }
  }

  createDriver() {
    if (this.usesTakeover()) return new TakeoverDriver(this);
    if (this.usesScrollTrigger()) {
      return new ScrollTriggerDriver(this, this.manager.scrollAdapter);
    }
    return new ScrubDriver(this);
  }

  async init() {
    this.setState(STATES.LOADING);
    this.createStage();
    this.driver = this.createDriver();
    // Content interpolation is driven by the GSAP timeline in v0.6. The old
    // ContentAnimator remains only for explicit takeover/legacy compatibility.
    if (!this.usesScrollTrigger()) {
      this.content = new ContentAnimator(this);
      this.content.init();
    }

    // Reduced-motion users do not need transition media at all. Removing the
    // transition distance before renderer creation avoids unnecessary video or
    // image downloads and ensures native document navigation remains intact.
    if (this.reducedMotion) {
      this.spacer.style.height = "0";
      this.stage.style.display = "none";
      this.setState(STATES.READY);
      this.events.emit("onReady", this.context({ ready: true, reducedMotion: true }));
      return true;
    }

    this.renderer = this.createRenderer();

    try {
      const deferAssets =
        this.config.source.type === "sequence" &&
        this.config.preload.deferUntilNear &&
        typeof IntersectionObserver !== "undefined";

      const ready = await this.renderer.prepare({ deferAssets });
      if (this.destroyed) return false;

      this.driver?.install?.();
      this.measure();
      this.setState(ready ? STATES.READY : STATES.LOADING);
      if (ready) this.events.emit("onReady", this.context({ ready: true }));
      this.requestRender();
      return true;
    } catch (error) {
      if (this.destroyed) return false;
      this.reportError(error, { phase: "prepare" });

      const fallbackReady = await this.activateFallback("prepare-failed");
      if (fallbackReady && !this.destroyed) {
        this.driver?.install?.();
        this.measure();
        this.setState(STATES.READY);
        this.events.emit("onReady", this.context({ ready: true, fallback: true }));
        this.requestRender();
        return true;
      }

      if (!this.destroyed) {
        this.setState(STATES.ERROR);
        // Removing the spacer guarantees navigation remains normal.
        this.disableTransition();
      }
      return false;
    }
  }

  async preload() {
    if (this.destroyed || this.reducedMotion) return !!this.reducedMotion;

    if (typeof this.renderer?.startPreload === "function") {
      try {
        const ready = await this.renderer.startPreload();
        if (ready && this.state === STATES.LOADING && !this.destroyed) {
          this.setState(STATES.READY);
          this.events.emit("onReady", this.context({ ready: true, preloaded: true }));
        }
        return ready;
      } catch (error) {
        if (!this.destroyed) this.reportError(error, { phase: "preload" });
        return false;
      }
    }

    return this.state === STATES.READY;
  }

  measure() {
    if (this.reducedMotion || this.destroyed || !this.spacer?.isConnected) return;
    this.driver.measure();
    this.renderer?.resize?.();
  }

  updateScroll(scrollY) {
    if (this.reducedMotion || this.destroyed) return;
    this.driver.update?.(scrollY);
  }

  applyHandoffAlignment(progress = this.progress) {
    if (!this.renderer?.setAlignmentTransform) return;

    const handoff = this.config.playback?.handoff || {};
    const transform = handoff.transform || {};
    const from = transform.from || { scale: 1, x: 0, y: 0 };
    const to = transform.to || { scale: 1, x: 0, y: 0 };
    const startAt = clamp(Number(handoff.startAt ?? 0.9), 0, 0.999999);
    const raw = progress <= startAt ? 0 : clamp((progress - startAt) / (1 - startAt));
    const easing = resolveEasing(handoff.easing);
    const t = clamp(easing(raw));
    const mix = (a, b, fallback) => {
      const av = Number.isFinite(a) ? a : fallback;
      const bv = Number.isFinite(b) ? b : fallback;
      return av + (bv - av) * t;
    };

    this.renderer.setAlignmentTransform({
      origin: transform.origin || "center center",
      scale: mix(from.scale, to.scale, 1),
      x: mix(from.x, to.x, 0),
      y: mix(from.y, to.y, 0)
    });
  }

  setProgress(value) {
    const next = Math.min(1, Math.max(0, value));

    // Apply even when logical progress did not change. Auto playback can enter
    // at exactly 0/1 after the stage was hidden, and a configured endpoint
    // transform must be present before that first composited frame is shown.
    this.applyHandoffAlignment(next);
    if (next === this.progress && !this.needsRender) return;

    this.progress = next;
    this.content?.updateProgress(next);
    this.needsRender = true;
    // Native video playback has its own clock and does not run TakeoverDriver.tick.
    // Applying alignment here keeps the correction on the real media clock.
    this.events.emit("onProgress", this.context());
  }

  renderNow(timestamp = (typeof performance !== "undefined" ? performance.now() : Date.now())) {
    if (this.destroyed || this.reducedMotion || !this.renderer || !this.needsRender) return false;
    this.renderer.render(this.progress, timestamp);
    this.applyHandoffAlignment(this.progress);
    this.needsRender = false;
    this.driver?.afterRender?.(timestamp);
    return true;
  }

  tick(timestamp) {
    if (this.destroyed || this.reducedMotion) return false;

    const driverNeedsMore = this.driver.tick?.(timestamp) || false;

    this.renderNow(timestamp);

    return driverNeedsMore;
  }

  requestRender() {
    if (this.destroyed || this.reducedMotion) return;
    this.needsRender = true;
    this.manager.requestFrame();
  }

  isAutoPlaying() {
    return this.usesTakeover() && !!(
      this.driver?.playing || this.driver?.pending || this.driver?.settling || this.handoffPending
    );
  }

  canCapture(direction, delta) {
    return this.usesTakeover() &&
      !this.reducedMotion &&
      !this.destroyed &&
      this.driver.canCapture(direction, delta);
  }

  pushGesture(delta) {
    if (!this.usesTakeover()) return null;
    return this.driver.pushGesture?.(delta) || null;
  }

  requestAuto(direction) {
    if (!this.usesTakeover() || this.destroyed) return Promise.resolve(false);
    return this.driver.play(direction).catch((error) => {
      if (!this.destroyed) this.reportError(error, { phase: "auto-play" });
      return false;
    });
  }

  async ensureReadyForPlayback() {
    if (this.destroyed) return false;
    if (this.state === STATES.READY || this.state === STATES.COMPLETE) return true;

    const behavior = this.config.loading.onNotReady;

    if (behavior === "skip") return false;

    if (behavior === "fallback") {
      const fallbackReady = await this.activateFallback("not-ready-policy");
      if (fallbackReady && !this.destroyed) {
        this.setState(STATES.READY);
        return true;
      }
      return false;
    }

    // Kick preload without serially waiting for a separate preload timeout;
    // renderer.ensureReady() owns the single readiness deadline.
    this.preload().catch(() => {});
    if (this.destroyed) return false;

    try {
      const ready = await this.renderer?.ensureReady?.(this.config.loading.timeout);
      if (ready && !this.destroyed) {
        this.setState(STATES.READY);
        return true;
      }
    } catch (error) {
      if (!this.destroyed) this.reportError(error, { phase: "readiness" });
    }

    if (this.destroyed) return false;
    const fallbackReady = await this.activateFallback("readiness-timeout");
    if (fallbackReady && !this.destroyed) {
      this.setState(STATES.READY);
      return true;
    }

    return false;
  }

  beginAutoPlayback(direction) {
    if (this.destroyed || !this.stage || !this.stage.parentNode) return false;

    this.setState(direction > 0 ? STATES.PLAYING_FORWARD : STATES.PLAYING_REVERSE);
    this.content?.begin(direction);

    // Portal the stage to <body> during fixed playback. Auto stages are
    // otherwise zero-layout/hidden, so they never become an extra snap section.
    if (!this.stageHome) this.stageHome = this.stage.parentNode;
    if (this.stage.parentNode !== document.body) document.body.appendChild(this.stage);

    const enterFade = Math.max(0, Number(this.config.playback.enterFade) || 0);
    this.stage.style.transition = "none";
    this.stage.style.opacity = enterFade > 0 ? "0" : "1";
    this.stage.style.visibility = "visible";
    this.stage.classList.add("st-stage--auto-playing");

    if (this.config.scroll.lockDuringTransition !== false) {
      this.ownsScrollLock = this.manager.scrollLock.lock(this);
      if (!this.ownsScrollLock) {
        this.content?.cancelAndRestore();
        this.restoreStage();
        this.setState(this.progress >= 0.999 ? STATES.COMPLETE : STATES.READY);
        return false;
      }
    }

    // Fade over the live source/target DOM rather than replacing it in one
    // frame. This is what prevents headings/text from appearing to vanish.
    if (enterFade > 0) {
      // Force the opacity=0 style to commit before the transition is enabled.
      void this.stage.offsetWidth;
      this.stage.style.transition = `opacity ${enterFade}ms ease`;
      requestAnimationFrame(() => {
        if (!this.destroyed && this.stage?.classList.contains("st-stage--auto-playing")) {
          this.stage.style.opacity = "1";
        }
      });
    }

    this.events.emit(direction > 0 ? "onStart" : "onReverseStart", this.context({ direction }));
    return true;
  }

  restoreStage() {
    if (this.stage) {
      this.stage.classList.remove("st-stage--auto-playing", "st-stage--handoff");
      this.stage.style.transition = "none";
      this.stage.style.opacity = "0";
      this.stage.style.visibility = "hidden";
    }

    if (this.stageHome && this.stage && this.stage.parentNode !== this.stageHome) {
      try { this.stageHome.appendChild(this.stage); } catch (_) {}
    }
    this.stageHome = null;
  }

  unlockTo(targetY = null) {
    if (this.ownsScrollLock) {
      const unlockY = targetY == null ? this.manager.scrollLock.scrollY : targetY;
      this.manager.scrollLock.unlock(unlockY, this);
      this.ownsScrollLock = false;
    } else if (targetY != null) {
      window.scrollTo({ top: Math.max(0, targetY), behavior: "auto" });
    }
  }

  releasePlayback(targetY = null) {
    this.unlockTo(targetY);
    this.content?.cancelAndRestore();
    this.restoreStage();
    this.handoffPending = false;
    this.manager.releaseAuto(this);
  }

  waitFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  destinationMetrics(direction) {
    const element = direction > 0 ? this.targetSection() : this.section;
    if (!element?.getBoundingClientRect) return null;
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height || window.innerHeight || 0;
    return {
      top: window.scrollY + rect.top,
      bottom: window.scrollY + rect.bottom,
      height: rect.height ?? Math.max(0, rect.bottom - rect.top),
      viewportHeight
    };
  }

  async stabilizeLanding(targetY, direction) {
    const handoff = this.config.playback?.handoff || {};
    const frames = Math.max(0, Math.min(10, Number(handoff.settleFrames) || 0));
    const tolerance = Math.max(0, Number(handoff.landingTolerance) || 0);
    let corrections = 0;

    // Restoring CSS scroll-snap can schedule a browser-native snap adjustment
    // after scrollTo() returns. Keep the final media frame covering the page
    // while that settles, and reassert the exact DOM landing if it drifts.
    for (let i = 0; i < frames; i++) {
      await this.waitFrame();
      if (this.destroyed) break;
      const drift = window.scrollY - targetY;
      if (Math.abs(drift) > tolerance) {
        corrections += 1;
        window.scrollTo({ top: Math.max(0, targetY), behavior: "auto" });
      }
    }

    const metrics = this.destinationMetrics(direction);
    const finalDrift = window.scrollY - targetY;
    this.debug("auto landing stabilized", {
      direction,
      targetY,
      actualY: window.scrollY,
      landingDrift: finalDrift,
      corrections,
      destinationHeight: metrics?.height ?? null,
      viewportHeight: metrics?.viewportHeight ?? null,
      destinationShorterThanViewport: !!metrics && metrics.height + tolerance < metrics.viewportHeight
    });

    return { finalDrift, corrections, metrics };
  }

  async handoffTo(targetY, direction) {
    if (this.destroyed) return;
    this.handoffPending = true;

    // If target content has an explicit handoff animation, place it in its
    // initial state BEFORE moving the document. The final media frame hides
    // this preparation, so there is no one-frame flash of fully-visible text.
    const animateEnter = !!this.content?.shouldEnterAtHandoff();
    if (animateEnter) this.content.prepareEnter(direction);

    // IMPORTANT: keep the final transition frame fixed over the viewport while
    // the real document moves underneath it. The target section gets a paint
    // opportunity before the stage is faded away, eliminating the blank/text
    // disappearance frame that was visible with snap sections.
    this.unlockTo(targetY);

    const handoff = this.config.playback?.handoff || {};
    const paintFrames = Math.max(0, Math.min(10, Number(handoff.paintFrames) || 0));
    for (let i = 0; i < paintFrames; i++) {
      await this.waitFrame();
      if (this.destroyed || !this.stage) return;
    }

    // CSS snap restoration is asynchronous in several browsers. Verify the
    // landing while the final transition frame is still opaque, before the DOM
    // is revealed. This prevents a tall next section from leaving a visible
    // strip below the previous viewport-height section after reverse playback.
    await this.stabilizeLanding(targetY, direction);
    if (this.destroyed || !this.stage) return;

    // Hold the matching endpoint over an already-painted target. This small
    // dwell is especially useful when CSS scroll-snap needs a frame or two to
    // settle its final position before the transition overlay disappears.
    const hold = Math.max(0, Number(handoff.hold) || 0);
    if (hold > 0) {
      await new Promise((resolve) => setTimeout(resolve, hold));
      if (this.destroyed || !this.stage) return;
    }

    const configuredFade = handoff.fade == null ? this.config.playback.exitFade : handoff.fade;
    const exitFade = Math.max(0, Number(configuredFade) || 0);
    const enterPromise = animateEnter
      ? this.content.animateEnter(direction)
      : Promise.resolve(false);

    let fadePromise = Promise.resolve();
    if (exitFade > 0) {
      this.stage.classList.add("st-stage--handoff");
      this.stage.style.transition = `opacity ${exitFade}ms ease`;
      this.stage.style.opacity = "0";
      fadePromise = new Promise((resolve) => setTimeout(resolve, exitFade));
    } else {
      // No overlay fade: expose the target immediately while its content
      // choreography (if any) continues independently.
      this.stage.style.opacity = "0";
    }

    await Promise.all([fadePromise, enterPromise]);
    if (this.destroyed) return;

    this.content?.cancelAndRestore();
    this.restoreStage();
    this.handoffPending = false;
    this.manager.releaseAuto(this);
  }

  async finishAutoPlayback(direction) {
    if (this.destroyed) return;

    const targetY = this.driver.destinationY(direction);
    await this.handoffTo(targetY, direction);
    if (this.destroyed) return;

    this.manager.refresh();

    this.setState(direction > 0 ? STATES.COMPLETE : STATES.READY);
    this.events.emit(
      direction > 0 ? "onComplete" : "onReverseComplete",
      this.context({ direction })
    );

    this.requestRender();
  }

  skip(direction) {
    if (this.destroyed) return;

    // Failure/readiness must never trap navigation. Skip immediately rather
    // than using the visual handoff because there may be no valid media frame.
    this.setProgress(direction > 0 ? 1 : 0);
    const targetY = this.driver.destinationY(direction);
    this.releasePlayback(targetY);
    this.setState(direction > 0 ? STATES.COMPLETE : STATES.READY);
    this.events.emit("onSkip", this.context({ direction }));
  }

  disableTransition() {
    this.releasePlayback(null);
    if (this.sceneManaged) this.manager.sceneEngine?.cancelTransition?.(this);
    this.scrubTrack?.remove?.();
    this.scrubTrack = null;
    this.stage?.remove?.();
    this.spacer?.remove();
  }

  visibility(hidden) {
    if (!this.usesTakeover() || this.destroyed) return;
    if (hidden) this.driver.pauseVisibility?.();
    else this.driver.resumeVisibility?.();
  }

  diagnostic() {
    return {
      name: this.name,
      state: this.state,
      mode: this.config.scroll.mode,
      sceneManaged: this.sceneManaged,
      progress: Number(this.progress.toFixed(3)),
      pending: !!this.driver?.pending,
      playing: !!this.driver?.playing,
      settling: !!this.driver?.settling || this.handoffPending,
      readiness: this.renderer?.readiness?.() || null,
      scrollDriver: this.driver?.diagnostic?.() || null
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    this.driver?.destroy?.();
    this.releasePlayback(null);
    this.content?.destroy?.();
    this.renderer?.destroy?.();
    if (this.sceneManaged) this.manager.sceneEngine?.cancelTransition?.(this);
    this.scrubTrack?.remove?.();
    this.stage?.remove?.();
    this.spacer?.remove();
    this.renderer = null;
    this.driver = null;
    this.content = null;
    this.stage = null;
    this.scrubTrack = null;
    this.spacer = null;

    this.setState(STATES.DESTROYED);
    this.events.emit("onDestroy", this.context());
  }
}

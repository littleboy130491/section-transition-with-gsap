import { clamp, resolveDistance } from "../utils/common.js";
import { GSAPContentTimeline } from "../core/GSAPContentTimeline.js";
import { STATES } from "../core/State.js";

/**
 * Primary v0.6 scroll driver.
 *
 * ScrollTrigger owns scroll measurement, refresh, scrub smoothing, direction and
 * snapping. SectionTransition only consumes normalized progress to render media
 * and maintain persistent scene-background ownership.
 */
export class ScrollTriggerDriver {
  constructor(runtime, adapter) {
    this.runtime = runtime;
    this.gsap = adapter?.gsap || null;
    this.ScrollTrigger = adapter?.ScrollTrigger || null;
    this.timeline = null;
    this.trigger = null;
    this.proxy = { progress: 0 };
    this.content = null;
    this.overlayActive = false;
    this.overlayWanted = false;
    this.lastDirection = 1;
    this.geometry = null;
    this.installed = false;
    this.lastPrime = null;
    this.motion = {
      direction: 1,
      velocity: 0,
      rawProgress: 0,
      projectedProgress: 0
    };
    this.motionSettleTimer = 0;
  }

  mode() {
    const mode = this.runtime.config.scroll.mode;
    return mode === "auto" ? "snap" : mode;
  }

  viewportHeight() {
    return Math.max(1, Number(window.visualViewport?.height) || Number(window.innerHeight) || 1);
  }

  documentY(element) {
    const rect = element?.getBoundingClientRect?.();
    if (!rect) return null;
    return (Number(window.scrollY) || 0) + Number(rect.top || 0);
  }

  sourceGeometry() {
    const rect = this.runtime.section?.getBoundingClientRect?.();
    if (!rect) return null;
    const scrollY = Number(window.scrollY) || 0;
    const top = scrollY + Number(rect.top || 0);
    const bottom = scrollY + Number(rect.bottom || 0);
    const height = Math.max(0, Number(rect.height) || bottom - top);
    return { top, bottom, height };
  }

  maxScrollY() {
    try {
      if (typeof this.ScrollTrigger?.maxScroll === "function") {
        const value = Number(this.ScrollTrigger.maxScroll(window));
        if (Number.isFinite(value)) return Math.max(0, value);
      }
    } catch (_) {}
    const viewport = this.viewportHeight();
    const height = Math.max(
      Number(document.documentElement?.scrollHeight) || 0,
      Number(document.body?.scrollHeight) || 0
    );
    return Math.max(0, height - viewport);
  }

  startValue() {
    const geometry = this.sourceGeometry();
    if (!geometry) return Number(window.scrollY) || 0;
    const viewport = this.viewportHeight();
    // Fullscreen source begins on its first departing pixel. Taller sections
    // retain natural reading scroll until the final viewport starts leaving.
    return Math.max(geometry.top, geometry.bottom - viewport);
  }

  endValue() {
    const start = this.startValue();
    const scroll = this.runtime.config.scroll;
    let requested;
    if (scroll.scrubRange === "distance") {
      requested = start + Math.max(1, resolveDistance(scroll.distance));
    } else {
      const targetTop = this.documentY(this.runtime.targetSection?.());
      requested = Number.isFinite(targetTop)
        ? targetTop
        : start + Math.max(1, resolveDistance(scroll.distance));
    }
    const end = Math.min(this.maxScrollY(), requested);
    return Math.max(start + 1, end);
  }

  scrubValue() {
    // Glide snap owns smoothing through the single document-scroll tween, so
    // media must follow that real scroll position exactly with no second catch-up.
    if (this.mode() === "snap" && this.runtime.config.scroll.snapStrategy !== "settle") return true;
    const configured = this.runtime.config.scroll.scrub;
    // Primary ScrollTrigger modes are always progress-linked. `false` would
    // turn the attached GSAP timeline into an ordinary toggle animation, which
    // breaks the media-progress contract. Config validation rejects it, and
    // this defensive fallback treats it as direct scrub if called anyway.
    if (configured === false) return true;
    if (configured === true) return true;
    if (Number.isFinite(configured) && configured > 0) return configured;

    // v0.5 smoothing was a 0..0.99 catch-up ratio. Preserve the spirit of that
    // option by mapping it to a short ScrollTrigger scrub duration when present.
    const smoothing = Number(this.runtime.config.scroll.smoothing) || 0;
    if (smoothing <= 0) return true;
    return Math.max(0.01, Math.min(2, smoothing));
  }

  snapValue() {
    if (this.mode() !== "snap") return false;
    // v0.6.3 default: snapping is a one-phase Observer-driven document glide.
    // Keep ScrollTrigger snap only as an explicit compatibility strategy.
    if (this.runtime.config.scroll.snapStrategy !== "settle") return false;
    const configured = this.runtime.config.scroll.snap;
    if (configured === false) return false;
    if (configured === "auto" && this.runtime.manager.documentSnapEnabled?.()) {
      // Avoid two independent snap animations fighting each other. When the
      // authored page already uses CSS scroll-snap, let the browser own the
      // landing while ScrollTrigger only maps that native movement to media.
      return false;
    }
    if (configured && configured !== true && configured !== "auto") return configured;
    return {
      snapTo: [0, 1],
      directional: true,
      inertia: true,
      delay: 0.05,
      duration: { min: 0.2, max: 0.65 },
      ease: "power2.inOut"
    };
  }

  pinValue() {
    const pin = this.runtime.config.scroll.pin;
    if (!pin) return false;
    if (pin === true) return this.runtime.section;
    return pin;
  }

  install() {
    if (this.installed || this.runtime.destroyed || this.runtime.reducedMotion) return true;
    if (!this.gsap || !this.ScrollTrigger) {
      throw new Error(
        `[SectionTransition:${this.runtime.name}] GSAP ScrollTrigger is required for ${this.mode()} mode`
      );
    }

    const timeline = this.gsap.timeline({ paused: true, defaults: { ease: "none" } });
    this.timeline = timeline;

    // Keep timeline duration normalized to exactly 1. The renderer callback is
    // attached to the animation playhead (rather than ScrollTrigger.onUpdate),
    // which is important when numerical scrub smoothing is enabled.
    timeline.to(this.proxy, {
      progress: 1,
      duration: 1,
      ease: "none",
      onUpdate: () => this.applyTimelineProgress()
    }, 0);

    this.content = new GSAPContentTimeline(this.runtime, this.gsap, this.ScrollTrigger);
    this.content.build(timeline);

    const pin = this.pinValue();
    const vars = {
      id: `section-transition:${this.runtime.name}`,
      trigger: this.runtime.section,
      endTrigger: this.runtime.targetSection?.() || this.runtime.section,
      start: () => this.startValue(),
      end: () => this.endValue(),
      animation: timeline,
      scrub: this.scrubValue(),
      snap: this.snapValue(),
      invalidateOnRefresh: true,
      markers: !!this.runtime.config.scroll.markers,
      fastScrollEnd: this.runtime.config.scroll.fastScrollEnd ?? false,
      preventOverlaps: this.runtime.config.scroll.preventOverlaps || false,
      onUpdate: (self) => this.onScrollTriggerUpdate(self),
      onScrubComplete: (self) => this.onScrubComplete(self),
      onRefresh: (self) => this.onRefresh(self),
      onEnter: (self) => this.onBoundary("enter", self),
      onEnterBack: (self) => this.onBoundary("enterBack", self),
      onLeave: (self) => this.onBoundary("leave", self),
      onLeaveBack: (self) => this.onBoundary("leaveBack", self)
    };

    if (pin) {
      vars.pin = pin;
      vars.pinSpacing = this.runtime.config.scroll.pinSpacing !== false;
      vars.pinReparent = !!this.runtime.config.scroll.pinReparent;
      vars.anticipatePin = Number(this.runtime.config.scroll.anticipatePin) || 0;
    }

    this.trigger = this.ScrollTrigger.create(vars);
    this.installed = true;
    this.measure();
    this.prime(0, this.motion, true);
    return true;
  }

  onBoundary(kind, self) {
    const direction = self?.direction < 0 ? -1 : 1;
    if (kind === "enter") {
      this.runtime.setState?.(STATES.PLAYING_FORWARD);
      this.runtime.events.emit("onStart", this.runtime.context({ direction: 1 }));
    } else if (kind === "enterBack") {
      this.runtime.setState?.(STATES.PLAYING_REVERSE);
      this.runtime.events.emit("onReverseStart", this.runtime.context({ direction: -1 }));
    } else if (kind === "leave") {
      this.runtime.setState?.(STATES.COMPLETE);
      this.runtime.events.emit("onComplete", this.runtime.context({ direction: 1 }));
    } else if (kind === "leaveBack") {
      this.runtime.setState?.(STATES.READY);
      this.runtime.events.emit("onReverseComplete", this.runtime.context({ direction: -1 }));
    }
  }

  scheduleMotionSettle(rawProgress, direction) {
    if (this.motionSettleTimer) clearTimeout(this.motionSettleTimer);
    const delay = Math.max(0, Number(this.runtime.config.preload?.motion?.settleMs) || 120);
    this.motionSettleTimer = setTimeout(() => {
      this.motionSettleTimer = 0;
      if (this.runtime.destroyed) return;
      const progress = clamp(Number(rawProgress) || 0);
      this.motion = { direction, velocity: 0, rawProgress: progress, projectedProgress: progress };
      this.prime(progress, this.motion, true);
      this.runtime.requestRender?.();
    }, delay);
  }

  onScrollTriggerUpdate(self) {
    const direction = self?.direction < 0 ? -1 : 1;
    if (direction !== this.lastDirection) {
      this.lastDirection = direction;
      try { this.runtime.renderer?.prepareForDirection?.(direction); } catch (_) {}
    }

    const rawProgress = clamp(Number(self?.progress) || 0);
    const velocity = Number(self?.getVelocity?.()) || 0;
    const span = Math.max(1, Math.abs(Number(self?.end) - Number(self?.start)) ||
      Math.abs((this.geometry?.endY || 1) - (this.geometry?.startY || 0)) || 1);
    const predictionMs = Math.max(0, Number(this.runtime.config.preload?.motion?.predictionMs) || 120);
    const projectedProgress = clamp(rawProgress + (velocity / span) * (predictionMs / 1000));

    this.motion = { direction, velocity, rawProgress, projectedProgress };
    this.runtime.targetProgress = rawProgress;
    this.prime(rawProgress, this.motion);
    this.scheduleMotionSettle(rawProgress, direction);
  }

  onScrubComplete(self) {
    if (this.motionSettleTimer) clearTimeout(this.motionSettleTimer);
    this.motionSettleTimer = 0;
    const rawProgress = clamp(Number(self?.progress ?? this.runtime.targetProgress) || 0);
    const direction = self?.direction < 0 ? -1 : this.lastDirection;
    this.motion = { direction, velocity: 0, rawProgress, projectedProgress: rawProgress };
    this.prime(rawProgress, this.motion, true);
  }

  applyTimelineProgress() {
    if (this.runtime.destroyed) return;
    const progress = clamp(Number(this.proxy.progress) || 0);
    this.runtime.setProgress(progress);
    // Render in the same GSAP animation frame instead of waiting for a second
    // application RAF. This minimizes visual latency between scroll and canvas.
    this.runtime.renderNow?.();
    this.syncOverlay();
  }

  rendererHasDrawable({ exact = false } = {}) {
    const renderer = this.runtime.renderer;
    if (!renderer?.hasDrawableFrame) return false;
    try { return !!renderer.hasDrawableFrame(this.runtime.progress, { exact }); }
    catch (_) { return false; }
  }

  prime(progress, motion = this.motion, force = false) {
    const normalized = clamp(progress);
    const tier = this.runtime.renderer?.assetManager?.motionTier?.(motion?.velocity) ?? 0;
    const signature = `${normalized.toFixed(4)}:${motion?.direction || 1}:${tier}:${Number(motion?.projectedProgress || 0).toFixed(3)}`;
    if (!force && this.lastPrime === signature) return;
    this.lastPrime = signature;
    try { this.runtime.renderer?.prime?.(normalized, motion); } catch (_) {}
  }

  activateOverlay() {
    if (this.overlayActive || this.runtime.destroyed) return;
    if (!this.rendererHasDrawable({ exact: true })) return;
    const stage = this.runtime.stage;
    if (!stage) return;

    if (this.runtime.sceneManaged) {
      this.runtime.manager.sceneEngine?.beginTransition?.(this.runtime);
      stage.classList.add("st-stage--scene-active");
    } else {
      stage.classList.add("st-stage--scrolltrigger-active");
    }
    stage.style.visibility = "visible";
    stage.style.opacity = "1";
    this.overlayActive = true;
  }

  deactivateOverlay({ commitProgress = null } = {}) {
    const stage = this.runtime.stage;
    if (this.runtime.sceneManaged) {
      if (this.overlayActive && commitProgress != null) {
        this.runtime.manager.sceneEngine?.commitTransition?.(this.runtime, commitProgress);
      } else {
        this.runtime.manager.sceneEngine?.cancelTransition?.(this.runtime);
      }
      stage?.classList?.remove?.("st-stage--scene-active");
    } else {
      stage?.classList?.remove?.("st-stage--scrolltrigger-active");
    }
    if (stage?.style) {
      stage.style.visibility = "hidden";
      stage.style.opacity = "0";
    }
    this.overlayActive = false;
  }

  syncOverlay() {
    const progress = clamp(this.runtime.progress);
    const exact = this.rendererHasDrawable({ exact: true });
    const interior = progress > 0.0001 && progress < 0.9999;
    const pendingEndpoint = this.overlayActive && !exact;
    this.overlayWanted = interior || pendingEndpoint;

    if (interior) {
      if (!this.overlayActive) {
        this.prime(progress);
        if (exact) this.activateOverlay();
      }
      return;
    }

    if (this.overlayActive && exact) {
      this.deactivateOverlay({ commitProgress: progress <= 0.0001 ? 0 : 1 });
    } else if (!this.overlayActive) {
      // Keep static scene rendering in control until a transition frame exists.
      this.runtime.manager.sceneEngine?.cancelTransition?.(this.runtime);
    }
  }

  afterRender() {
    if (this.overlayWanted && !this.overlayActive && this.rendererHasDrawable({ exact: true })) {
      this.activateOverlay();
    }
    this.syncOverlay();
  }

  onRefresh(self) {
    this.measure(self);
    this.runtime.renderer?.resize?.();
    this.runtime.manager.sceneEngine?.resize?.();
  }

  measure(self = this.trigger) {
    const start = Number(self?.start);
    const end = Number(self?.end);
    this.geometry = {
      engine: "gsap-scrolltrigger",
      mode: this.mode(),
      startY: Number.isFinite(start) ? start : this.startValue(),
      endY: Number.isFinite(end) ? end : this.endValue(),
      scrub: this.scrubValue(),
      snap: !!this.snapValue(),
      snapStrategy: this.mode() === "snap" ? (this.runtime.config.scroll.snapStrategy || "glide") : null,
      pin: !!this.pinValue()
    };
    return this.geometry;
  }

  update() {
    // ScrollTrigger owns progress. Manager's passive scroll listener only keeps
    // static SceneBackgroundEngine selection updated outside active transitions.
  }

  tick() { return false; }

  diagnostic() {
    return {
      ...this.geometry,
      progress: Number(this.runtime.progress.toFixed(3)),
      rawProgress: Number((this.trigger?.progress || 0).toFixed?.(3) || 0),
      direction: this.lastDirection,
      velocity: Math.round(this.motion.velocity || 0),
      projectedProgress: Number((this.motion.projectedProgress || 0).toFixed(3)),
      adaptiveStep: this.runtime.renderer?.motion?.step || 1,
      overlayWanted: this.overlayWanted,
      overlayActive: this.overlayActive,
      visualReady: this.rendererHasDrawable({ exact: false }),
      exactVisualReady: this.rendererHasDrawable({ exact: true })
    };
  }

  refresh() {
    try { this.trigger?.refresh?.(); } catch (_) {}
  }

  destroy() {
    if (this.motionSettleTimer) clearTimeout(this.motionSettleTimer);
    this.motionSettleTimer = 0;
    this.overlayWanted = false;
    this.deactivateOverlay();
    try { this.trigger?.kill?.(true); } catch (_) {}
    try { this.timeline?.kill?.(); } catch (_) {}
    this.content?.destroy?.();
    this.content = null;
    this.trigger = null;
    this.timeline = null;
    this.installed = false;
  }
}

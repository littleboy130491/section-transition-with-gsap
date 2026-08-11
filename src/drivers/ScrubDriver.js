import { clamp, resolveDistance } from "../utils/common.js";

/**
 * Native-scroll scrub driver.
 *
 * v0.5 preferred architecture (`runtime.sceneManaged`):
 * - authored scene sections stay untouched/in normal flow;
 * - one manager-owned persistent background engine stays fixed behind content;
 * - this runtime contributes only a transparent transition media surface;
 * - JS maps authored source/target geometry to progress;
 * - exact endpoint media is committed into the persistent scene canvas before
 *   the transition surface is hidden.
 *
 * v0.4 sticky-track scrub remains available for non-scene integrations.
 * Legacy standalone spacer scrub remains available explicitly.
 */
export class ScrubDriver {
  constructor(runtime) {
    this.runtime = runtime;
    this.distancePx = 0;
    this.startY = 0;
    this.endY = 0;
    this.viewportHeight = 0;
    this.target = 0;
    this.overlayActive = false;
    this.overlayWanted = false;
    this.geometry = null;
    this.lastScrollY = 0;
    this.lastPrime = null;
    this.hasScrollableRange = true;
  }

  isSceneEngine() {
    return !!this.runtime.sceneManaged;
  }

  isLegacy() {
    const engine = this.runtime.config.scroll.scrubEngine || "auto";
    return engine === "legacy" || (this.runtime.config.scroll.scrubStart || "leave") === "after";
  }

  isStickyTrack() {
    return !this.isSceneEngine() && !this.isLegacy();
  }

  authoredMaxScroll(viewport) {
    if (typeof document === "undefined") return Infinity;

    // Every compatibility sticky track is out-of-flow but can still contribute
    // to scrollable overflow. Exclude all generated tracks while measuring the
    // authored document, not just this runtime's track, otherwise N runtimes can
    // inflate one another's maxScrollY clamp.
    const tracks = [];
    const seen = new Set();
    const addTrack = (track) => {
      if (!track || seen.has(track)) return;
      seen.add(track);
      tracks.push({ track, display: track.style?.display ?? "" });
    };
    addTrack(this.runtime.scrubTrack);
    try {
      for (const track of document.querySelectorAll?.(".st-scrub-track") || []) addTrack(track);
    } catch (_) {}

    for (const { track } of tracks) {
      if (track.style) track.style.display = "none";
    }

    let height = 0;
    try {
      height = Math.max(
        Number(document.documentElement?.scrollHeight) || 0,
        Number(document.body?.scrollHeight) || 0
      );
    } finally {
      for (const { track, display } of tracks) {
        if (track.style) track.style.display = display;
      }
    }
    return height > 0 ? Math.max(0, height - viewport) : Infinity;
  }

  measure() {
    const viewport = Math.max(1, window.visualViewport?.height || window.innerHeight || 1);
    this.viewportHeight = viewport;

    if (this.isLegacy()) {
      const requestedDistance = Math.max(1, resolveDistance(this.runtime.config.scroll.distance));
      this.distancePx = requestedDistance;
      this.runtime.spacer.classList?.remove?.("st-spacer--scrub-anchor");
      this.runtime.stage.classList?.remove?.("st-stage--scrub-sticky", "st-stage--scene-transition");
      this.runtime.spacer.style.marginTop = "0px";
      this.runtime.spacer.style.height = `${viewport + this.distancePx}px`;
      const rect = this.runtime.spacer.getBoundingClientRect();
      this.startY = window.scrollY + rect.top;
      this.endY = this.startY + this.distancePx;
      this.geometry = { mode: "legacy", viewport, startY: this.startY, endY: this.endY };
      return;
    }

    this.runtime.spacer.classList?.add?.("st-spacer--scrub-anchor");
    this.runtime.spacer.style.marginTop = "0px";
    this.runtime.spacer.style.height = "0px";

    const source = this.runtime.section;
    const targetSection = this.runtime.targetSection?.();
    const sourceRect = source?.getBoundingClientRect?.();
    const targetRect = targetSection?.getBoundingClientRect?.();

    if (!sourceRect) {
      this.startY = window.scrollY;
      this.distancePx = Math.max(1, resolveDistance(this.runtime.config.scroll.distance));
      this.endY = this.startY + this.distancePx;
      this.geometry = {
        mode: this.isSceneEngine() ? "scene-fallback-distance" : "sticky-fallback-distance",
        viewport,
        startY: this.startY,
        endY: this.endY
      };
      if (this.isStickyTrack()) this.positionTrack(this.startY, this.endY);
      return;
    }

    const scrollY = window.scrollY;
    const sourceTop = scrollY + Number(sourceRect.top || 0);
    const sourceBottom = scrollY + Number(sourceRect.bottom || 0);
    const sourceHeight = Math.max(
      0,
      Number(sourceRect.height) || (Number(sourceRect.bottom || 0) - Number(sourceRect.top || 0))
    );

    // Fullscreen source: first departing pixel starts the animation.
    // Tall source: preserve natural scrolling until its final viewport leaves.
    this.startY = Math.max(sourceTop, sourceBottom - viewport);

    const rangeMode = this.runtime.config.scroll.scrubRange || "sections";
    const targetTop = targetRect ? scrollY + Number(targetRect.top || 0) : null;
    const maxScrollY = this.authoredMaxScroll(viewport);

    let requestedEnd;
    if (rangeMode === "distance") {
      requestedEnd = this.startY + Math.max(1, resolveDistance(this.runtime.config.scroll.distance));
    } else if (Number.isFinite(targetTop) && targetTop > this.startY + 0.5) {
      requestedEnd = targetTop;
    } else {
      requestedEnd = this.startY + Math.max(1, resolveDistance(this.runtime.config.scroll.distance));
    }

    this.endY = Number.isFinite(maxScrollY) ? Math.min(requestedEnd, maxScrollY) : requestedEnd;
    this.hasScrollableRange = this.endY > this.startY + 0.5;
    if (!this.hasScrollableRange) this.endY = this.startY;
    this.distancePx = Math.max(1, this.endY - this.startY);

    if (this.isStickyTrack()) {
      this.positionTrack(sourceTop, this.endY);
      if (this.runtime.scrubTrack?.style) {
        this.runtime.scrubTrack.style.display = this.hasScrollableRange ? "" : "none";
      }
    }

    this.geometry = {
      mode: this.isSceneEngine() ? "scene-background" : "sticky-track",
      rangeMode,
      viewport,
      sourceTop,
      sourceBottom,
      sourceHeight,
      targetTop,
      maxScrollY: Number.isFinite(maxScrollY) ? maxScrollY : null,
      startY: this.startY,
      endY: this.endY,
      distancePx: this.distancePx,
      hasScrollableRange: this.hasScrollableRange,
      scene: this.isSceneEngine()
        ? this.runtime.manager.sceneEngine?.sceneForElement?.(source)?.name || null
        : null
    };

    this.runtime.debug?.("scrub geometry", this.geometry);
  }

  positionTrack(trackTop, trackEnd) {
    const track = this.runtime.scrubTrack;
    if (!track?.style) return;
    const top = Math.max(0, Number(trackTop) || 0);
    const span = Math.max(1, (Number(trackEnd) || top + 1) - top);

    // The track is appended outside the authored section hierarchy. Position it
    // from actual rendered geometry rather than offsetParent math, which can be
    // altered by transforms/positioning on body/page-builder wrappers.
    track.style.top = "0px";
    let localTop = top;
    try {
      const rect = track.getBoundingClientRect?.();
      if (rect) {
        const renderedDocumentTop = (Number(window.scrollY) || 0) + (Number(rect.top) || 0);
        localTop = top - renderedDocumentTop;
      }
    } catch (_) {}
    track.style.top = `${localTop}px`;
    track.style.setProperty?.("--st-scrub-span", `${span}px`);
  }

  rendererHasDrawable({ exact = false } = {}) {
    const renderer = this.runtime.renderer;
    if (!renderer?.hasDrawableFrame) return false;
    try {
      return !!renderer.hasDrawableFrame(this.runtime.progress, { exact });
    } catch (_) {
      return false;
    }
  }

  prime(progress) {
    const normalized = clamp(progress);
    if (this.lastPrime != null && Math.abs(this.lastPrime - normalized) < 0.0001) return;
    this.lastPrime = normalized;
    try { this.runtime.renderer?.prime?.(normalized); } catch (_) {}
  }

  prewarmBoundaryIfNear(y) {
    if (this.isLegacy()) return;
    const margin = Math.max(1, this.viewportHeight || window.innerHeight || 1);
    if (y <= this.startY && this.startY - y <= margin) {
      this.prime(0);
    } else if (y >= this.endY && y - this.endY <= margin) {
      this.prime(1);
    }
  }

  activateOverlay() {
    if (this.overlayActive || this.runtime.destroyed) return;
    const stage = this.runtime.stage;
    if (!stage || !this.rendererHasDrawable({ exact: true })) return;

    if (this.isSceneEngine()) {
      this.runtime.manager.sceneEngine?.beginTransition?.(this.runtime);
      stage.classList.add("st-stage--scene-active");
    } else {
      stage.classList.add("st-stage--scrub-active");
    }
    if (stage.style) {
      stage.style.visibility = "visible";
      stage.style.opacity = "1";
    }
    this.overlayActive = true;
  }

  deactivateOverlay({ commitProgress = null } = {}) {
    const stage = this.runtime.stage;

    if (this.isSceneEngine()) {
      if (this.overlayActive && commitProgress != null) {
        this.runtime.manager.sceneEngine?.commitTransition?.(this.runtime, commitProgress);
      } else {
        this.runtime.manager.sceneEngine?.cancelTransition?.(this.runtime);
      }
      stage?.classList?.remove?.("st-stage--scene-active");
    } else if (stage && this.isStickyTrack()) {
      stage.classList.remove("st-stage--scrub-active");
    }

    if (stage && !this.isLegacy() && stage.style) {
      stage.style.visibility = "hidden";
      stage.style.opacity = "0";
    }
    this.overlayActive = false;
  }

  syncOverlay() {
    if (this.isLegacy()) return;

    if (!this.hasScrollableRange) {
      this.overlayWanted = false;
      this.deactivateOverlay();
      return;
    }

    const y = this.lastScrollY;
    const smoothing = Math.max(0, Math.min(0.99, this.runtime.config.scroll.smoothing || 0));
    const inRange = y > this.startY && y < this.endY;
    const exactReady = this.rendererHasDrawable({ exact: true });

    // Do not hide/commit on the same task that merely changes logical progress
    // to 0/1. Canvas/video rendering happens later in Runtime.tick(). Hold the
    // transition surface until that exact endpoint is actually drawable.
    const pendingStart = y <= this.startY && (
      this.runtime.progress > 0.0001 ||
      this.runtime.needsRender ||
      (this.overlayActive && !exactReady)
    );
    const pendingEnd = y >= this.endY && (
      this.runtime.progress < 0.9999 ||
      this.runtime.needsRender ||
      (this.overlayActive && !exactReady)
    );
    const settlingStart = smoothing > 0 && y <= this.startY && this.runtime.progress > 0.0001;
    const settlingEnd = smoothing > 0 && y >= this.endY && this.runtime.progress < 0.9999;

    this.overlayWanted = inRange || pendingStart || pendingEnd || settlingStart || settlingEnd;

    if (!this.overlayWanted) {
      let commitProgress = null;
      if (this.isSceneEngine() && exactReady) {
        if (y <= this.startY && this.runtime.progress <= 0.0001) commitProgress = 0;
        else if (y >= this.endY && this.runtime.progress >= 0.9999) commitProgress = 1;
      }
      this.deactivateOverlay({ commitProgress });
      return;
    }

    if (!this.overlayActive) {
      this.prime(this.runtime.progress);
      if (exactReady) this.activateOverlay();
    }
  }

  afterRender() {
    if (this.overlayWanted && !this.overlayActive && this.rendererHasDrawable({ exact: true })) {
      this.activateOverlay();
    }
    // Endpoint rendering may have completed in this tick. Re-evaluate now so
    // the exact frame is committed to the scene canvas before hiding media.
    this.syncOverlay();
  }

  update(scrollY) {
    this.lastScrollY = scrollY;
    const raw = (scrollY - this.startY) / Math.max(1, this.distancePx);
    this.target = clamp(raw);

    const smoothing = Math.max(0, Math.min(0.99, this.runtime.config.scroll.smoothing || 0));
    if (!smoothing) this.runtime.setProgress(this.target);
    this.runtime.targetProgress = this.target;

    this.prewarmBoundaryIfNear(scrollY);
    if (scrollY > this.startY && scrollY < this.endY) this.prime(this.runtime.progress);
    this.syncOverlay();
  }

  tick() {
    const smoothing = Math.max(0, Math.min(0.99, this.runtime.config.scroll.smoothing || 0));
    if (!smoothing) return false;

    const delta = this.target - this.runtime.progress;
    if (Math.abs(delta) < 0.0001) {
      this.runtime.setProgress(this.target);
      this.syncOverlay();
      return false;
    }

    this.runtime.setProgress(this.runtime.progress + delta * (1 - smoothing));
    if (this.overlayWanted && !this.overlayActive) this.prime(this.runtime.progress);
    this.syncOverlay();
    return true;
  }

  diagnostic() {
    return {
      engine: this.isSceneEngine()
        ? "persistent-scene-background"
        : this.isStickyTrack()
          ? "native-sticky-track"
          : "legacy-spacer",
      startY: Math.round(this.startY * 100) / 100,
      endY: Math.round(this.endY * 100) / 100,
      distancePx: Math.round(this.distancePx * 100) / 100,
      overlayWanted: this.overlayWanted,
      overlayActive: this.overlayActive,
      visualReady: this.rendererHasDrawable({ exact: false }),
      exactVisualReady: this.rendererHasDrawable({ exact: true }),
      geometry: this.geometry
    };
  }

  destroy() {
    this.overlayWanted = false;
    this.deactivateOverlay();
    if (this.runtime.spacer?.style) {
      this.runtime.spacer.style.marginTop = "";
      this.runtime.spacer.style.height = "";
    }
    if (this.runtime.scrubTrack?.style) {
      this.runtime.scrubTrack.style.top = "";
      this.runtime.scrubTrack.style.height = "";
      this.runtime.scrubTrack.style.removeProperty?.("--st-scrub-span");
    }
  }
}

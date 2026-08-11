import { clamp, resolveEasing } from "../utils/common.js";
import { GestureDetector } from "../input/GestureDetector.js";

export class TakeoverDriver {
  constructor(runtime) {
    this.runtime = runtime;
    this.sourceTopY = 0;
    this.sourceBottomY = 0;
    this.forwardY = 0;
    this.targetY = 0;
    this.reverseTargetY = 0;
    this.snapMode = false;
    this.playing = false;
    this.pending = false;
    this.settling = false;
    this.direction = 0;
    this.from = 0;
    this.to = 1;
    this.elapsedActive = 0;
    this.lastTimestamp = 0;
    this.pausedByVisibility = false;
    this.playToken = 0;
    this.gesture = new GestureDetector(runtime.config);
  }

  measure() {
    // Auto transitions must not add a fake viewport to the document. That extra
    // 100vh block fought CSS scroll-snap and could leave the browser visually
    // parked on an empty transition slot instead of the real target section.
    this.runtime.spacer.style.height = "0px";

    const sourceRect = this.runtime.section.getBoundingClientRect();
    this.sourceTopY = window.scrollY + sourceRect.top;
    this.sourceBottomY = window.scrollY + sourceRect.bottom;

    const target = this.runtime.targetSection();
    if (target) {
      const targetRect = target.getBoundingClientRect();
      this.targetY = window.scrollY + targetRect.top;
    } else {
      this.targetY = this.sourceBottomY;
    }

    const snapSetting = this.runtime.config.scroll.snap ?? "auto";
    this.snapMode = snapSetting === true ||
      (snapSetting === "auto" && this.runtime.manager.documentSnapEnabled());

    // In a snap document the section's own snap position is the stable capture
    // point. In a normal document we preserve the old semantic: capture when the
    // source section's bottom reaches the viewport bottom.
    this.forwardY = this.snapMode
      ? this.sourceTopY
      : Math.max(this.sourceTopY, this.sourceBottomY - window.innerHeight);

    this.reverseTargetY = this.snapMode ? this.sourceTopY : this.forwardY;
  }

  boundaryY(direction) {
    return direction > 0 ? this.forwardY : this.targetY;
  }

  destinationY(direction, { live = true } = {}) {
    if (!live || typeof window === "undefined") {
      return direction > 0 ? this.targetY : this.reverseTargetY;
    }

    // Re-read the destination from live DOM geometry at handoff time. Long or
    // oversized sections can change the visual viewport (mobile browser chrome),
    // fonts/images may finish layout after init, and page builders can reflow
    // containers. Cached init-time coordinates are therefore not reliable enough
    // for the final snap landing.
    const element = direction > 0
      ? this.runtime.targetSection?.()
      : this.runtime.section;

    if (!element?.getBoundingClientRect) {
      return direction > 0 ? this.targetY : this.reverseTargetY;
    }

    const rect = element.getBoundingClientRect();
    const top = window.scrollY + rect.top;

    if (direction > 0 || this.snapMode) return Math.max(0, top);

    // Preserve the original non-snap reverse semantic: return to the point
    // where the source fills the viewport rather than always forcing its top.
    const viewportHeight = window.visualViewport?.height || window.innerHeight || 0;
    const bottom = window.scrollY + rect.bottom;
    return Math.max(0, top, bottom - viewportHeight);
  }

  canCapture(direction, delta = 0) {
    if (this.playing || this.pending || this.settling) return true;

    const y = window.scrollY;
    const tolerance = this.snapMode ? 12 : 5;

    if (direction > 0) {
      if (this.runtime.progress > 0.001) return false;
      const boundary = this.forwardY;
      const projected = y + Math.max(0, delta);
      return projected >= boundary - tolerance && y <= boundary + tolerance;
    }

    if (!this.runtime.config.scroll.reversible || this.runtime.progress < 0.999) return false;
    const boundary = this.targetY;
    const projected = y + Math.min(0, delta);
    return projected <= boundary + tolerance && y >= boundary - tolerance;
  }

  pushGesture(delta) {
    return this.gesture.push(delta);
  }

  async play(direction) {
    if (this.playing || this.pending || this.settling || this.runtime.destroyed) return false;

    const token = ++this.playToken;
    this.pending = true;
    this.direction = direction;
    this.gesture.reset();

    try {
      const ready = await this.runtime.ensureReadyForPlayback();
      if (token !== this.playToken || this.runtime.destroyed) return false;

      if (!ready) {
        this.runtime.skip(direction);
        return false;
      }

      if (!this.runtime.manager.claimAuto(this.runtime)) {
        this.runtime.debug("auto playback ignored because another transition owns playback");
        return false;
      }

      this.pending = false;
      this.playing = true;
      this.direction = direction;
      this.from = direction > 0 ? 0 : 1;
      this.to = direction > 0 ? 1 : 0;
      this.elapsedActive = 0;
      this.lastTimestamp = 0;

      // Select/pre-position the correct encoded video before the fixed stage is
      // revealed. With source.reverseSrc this swaps to a pre-reversed file, so
      // reverse playback can use normal forward decoding instead of backward
      // currentTime seeking.
      this.runtime.renderer?.prepareForDirection?.(direction);
      this.runtime.setProgress(this.from);

      const began = this.runtime.beginAutoPlayback(direction);
      if (!began) {
        this.playing = false;
        this.runtime.manager.releaseAuto(this.runtime);
        return false;
      }

      // Native playback is preferred in auto mode. Forward uses source.src.
      // Reverse can also be native when VideoRenderer has source.reverseSrc.
      // Without a reverse asset playNative(-1) returns false and the existing
      // timeline-seek fallback remains available for backward compatibility.
      if (
        this.runtime.renderer?.videoMode === "native" &&
        typeof this.runtime.renderer.playNative === "function"
      ) {
        const usedNative = await this.runtime.renderer.playNative(direction);
        if (token !== this.playToken || this.runtime.destroyed) return false;
        if (usedNative && this.playing) {
          this.runtime.setProgress(direction > 0 ? 1 : 0);
          this.finish();
          return true;
        }
      }

      if (this.playing && !this.runtime.destroyed) {
        this.runtime.manager.requestFrame();
        return true;
      }
      return false;
    } finally {
      if (token === this.playToken) this.pending = false;
    }
  }

  tick(timestamp) {
    if (!this.playing || this.pausedByVisibility || this.runtime.destroyed) return false;

    if (!this.lastTimestamp) this.lastTimestamp = timestamp;
    const dt = Math.min(100, Math.max(0, timestamp - this.lastTimestamp));
    this.lastTimestamp = timestamp;
    this.elapsedActive += dt;

    const duration = Math.max(1, this.runtime.config.playback.duration || 1400);
    const t = clamp(this.elapsedActive / duration);
    const easing = resolveEasing(this.runtime.config.playback.easing);
    const eased = clamp(easing(t));

    this.runtime.setProgress(this.from + (this.to - this.from) * eased);

    if (t >= 1) {
      this.finish();
      return false;
    }

    return true;
  }

  finish() {
    if (!this.playing) return;
    const direction = this.direction;
    this.playing = false;
    this.settling = true;
    this.runtime.setProgress(this.to);

    Promise.resolve(this.runtime.finishAutoPlayback(direction))
      .catch((error) => {
        if (!this.runtime.destroyed) {
          this.runtime.reportError(error, { phase: "auto-handoff" });
          this.runtime.releasePlayback(this.destinationY(direction));
        }
      })
      .finally(() => {
        this.settling = false;
      });
  }

  pauseVisibility() {
    this.pausedByVisibility = true;
    this.runtime.renderer?.pause?.();
  }

  resumeVisibility() {
    this.pausedByVisibility = false;
    this.lastTimestamp = 0;
    this.runtime.renderer?.resume?.();
    if (this.playing) this.runtime.manager.requestFrame();
  }

  update(scrollY) {
    if (this.playing || this.pending || this.settling || this.runtime.reducedMotion) return;

    const forwardBoundary = this.forwardY;
    const reverseBoundary = this.targetY;
    const tolerance = 8;

    // Scrollbar dragging can bypass wheel/touch capture. Recover only if the
    // browser lands between the source exit point and the real target section.
    if (
      this.runtime.progress <= 0.001 &&
      scrollY > forwardBoundary + tolerance &&
      scrollY < reverseBoundary - tolerance
    ) {
      window.scrollTo({ top: forwardBoundary, behavior: "auto" });
      this.runtime.requestAuto(1);
      return;
    }

    if (
      this.runtime.config.scroll.reversible &&
      this.runtime.progress >= 0.999 &&
      scrollY < reverseBoundary - tolerance
    ) {
      // A mandatory snap container can skip the entire interval between the
      // target and source boundaries in one momentum gesture. v0.3.4 only
      // recovered while the browser was *between* those boundaries, so a
      // direct landing on the source boundary silently bypassed reverse media.
      //
      // Treat the source boundary (and a small overshoot above it) as a valid
      // reverse-recovery landing. Do not first jump back to reverseBoundary in
      // this case: progress=1 already has the correct transition endpoint ready
      // to cover the viewport, and keeping the document at the source lets the
      // reverse handoff finish onto the DOM that is already underneath it.
      const landedAtSource = scrollY <= forwardBoundary + tolerance;

      if (landedAtSource) {
        this.runtime.requestAuto(-1);
        return;
      }

      // Scrollbar dragging / non-snap movement can still land in the interval.
      // Preserve the previous recovery behavior there by restoring the target
      // boundary before starting reverse playback.
      if (scrollY > forwardBoundary + tolerance) {
        window.scrollTo({ top: reverseBoundary, behavior: "auto" });
        this.runtime.requestAuto(-1);
      }
    }
  }

  destroy() {
    this.playToken += 1;
    this.pending = false;
    this.playing = false;
    this.settling = false;
    this.gesture.reset();
    this.runtime.renderer?.cancelNativePlayback?.();
  }
}

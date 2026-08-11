import { clamp } from "../utils/common.js";

/**
 * One-phase section navigation for scroll.mode="snap".
 *
 * ScrollTrigger continues to own progress/media mapping. Observer only claims a
 * wheel/touch gesture when the viewport is already at an eligible transition
 * boundary, then one GSAP tween moves the real document scroll position from
 * that boundary to the adjacent one. This avoids native/CSS momentum settling
 * followed by a second ScrollTrigger snap animation.
 */
export class SnapGlideController {
  constructor(manager, adapter) {
    this.manager = manager;
    this.gsap = adapter?.gsap || null;
    this.ScrollTrigger = adapter?.ScrollTrigger || null;
    this.observer = null;
    this.tween = null;
    this.animating = false;
    this.gestureActive = false;
    this.inputStopped = true;
    this.destroyed = false;
    this.cssSnapshot = null;

    this.onChangeY = this.onChangeY.bind(this);
    this.onStop = this.onStop.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  runtimes() {
    return this.manager.runtimes.filter((runtime) =>
      !runtime.destroyed &&
      runtime.usesScrollTrigger?.() &&
      runtime.normalizedScrollMode?.() === "snap" &&
      runtime.config.scroll?.snap !== false &&
      runtime.config.scroll?.snapStrategy !== "settle"
    );
  }

  options(runtime = null) {
    return runtime?.config?.scroll?.snapGlide || this.manager.options.scroll?.snapGlide || {};
  }

  install() {
    if (this.destroyed || this.observer || !this.runtimes().length) return false;
    if (!this.gsap || typeof this.ScrollTrigger?.observe !== "function") {
      throw new Error("[SectionTransition] GSAP ScrollTrigger.observe() is required for snap glide mode");
    }

    const options = this.options();
    if (options.disableCssSnap !== false) this.disableCssSnap();

    // passive:false + debounce:false lets us conditionally prevent the current
    // event synchronously only when a transition boundary actually claims it.
    // Native scrolling remains untouched everywhere else (including tall scenes).
    this.observer = this.ScrollTrigger.observe({
      target: window,
      type: options.type || "wheel,touch",
      passive: false,
      preventDefault: false,
      debounce: false,
      lockAxis: true,
      tolerance: Math.max(1, Number(options.inputTolerance) || 8),
      dragMinimum: Math.max(0, Number(options.dragMinimum) || 6),
      ignore: options.ignore || "input,textarea,select,button,[contenteditable='true'],[data-st-native-scroll]",
      onChangeY: this.onChangeY,
      onStop: this.onStop,
      onStopDelay: Math.max(0.05, Number(options.onStopDelay) || 0.18)
    });

    if (options.keyboard !== false) {
      document.addEventListener("keydown", this.onKeyDown, { capture: true });
    }
    return true;
  }

  snapshotStyle(element, property) {
    return {
      value: element?.style?.getPropertyValue?.(property) || "",
      priority: element?.style?.getPropertyPriority?.(property) || ""
    };
  }

  restoreStyle(element, property, snapshot) {
    if (!element?.style || !snapshot) return;
    if (snapshot.value) element.style.setProperty(property, snapshot.value, snapshot.priority || "");
    else element.style.removeProperty(property);
  }

  disableCssSnap() {
    const root = document.documentElement;
    const body = document.body;
    this.cssSnapshot = {
      rootSnap: this.snapshotStyle(root, "scroll-snap-type"),
      bodySnap: this.snapshotStyle(body, "scroll-snap-type"),
      rootBehavior: this.snapshotStyle(root, "scroll-behavior"),
      bodyBehavior: this.snapshotStyle(body, "scroll-behavior")
    };
    root?.style?.setProperty?.("scroll-snap-type", "none", "important");
    body?.style?.setProperty?.("scroll-snap-type", "none", "important");
    root?.style?.setProperty?.("scroll-behavior", "auto", "important");
    body?.style?.setProperty?.("scroll-behavior", "auto", "important");
  }

  restoreCssSnap() {
    if (!this.cssSnapshot) return;
    const root = document.documentElement;
    const body = document.body;
    this.restoreStyle(root, "scroll-snap-type", this.cssSnapshot.rootSnap);
    this.restoreStyle(body, "scroll-snap-type", this.cssSnapshot.bodySnap);
    this.restoreStyle(root, "scroll-behavior", this.cssSnapshot.rootBehavior);
    this.restoreStyle(body, "scroll-behavior", this.cssSnapshot.bodyBehavior);
    this.cssSnapshot = null;
  }

  eventDirection(observer) {
    const delta = Number(observer?.deltaY) || 0;
    if (!delta) return 0;
    const type = String(observer?.event?.type || "").toLowerCase();
    // Wheel deltaY > 0 means scroll forward/down. A touch/pointer finger moving
    // upward has negative deltaY but produces the same forward page intent.
    const touchLike = type.includes("touch") || type.includes("pointer");
    return touchLike ? (delta < 0 ? 1 : -1) : (delta > 0 ? 1 : -1);
  }

  preventEvent(observer) {
    const event = observer?.event;
    if (event?.cancelable !== false && typeof event?.preventDefault === "function") {
      try { event.preventDefault(); } catch (_) {}
    }
  }

  canNestedScroll(target, direction) {
    let node = target?.nodeType === 1 ? target : target?.parentElement;
    const body = document.body;
    const root = document.documentElement;
    while (node && node !== body && node !== root) {
      try {
        const style = getComputedStyle(node);
        const overflow = `${style.overflowY || ""} ${style.overflow || ""}`;
        if (/(auto|scroll|overlay)/.test(overflow) && node.scrollHeight > node.clientHeight + 1) {
          const max = node.scrollHeight - node.clientHeight;
          if (direction > 0 && node.scrollTop < max - 1) return true;
          if (direction < 0 && node.scrollTop > 1) return true;
        }
      } catch (_) {}
      node = node.parentElement;
    }
    return false;
  }

  boundaryFor(runtime, direction) {
    const driver = runtime?.driver;
    if (!driver) return null;
    const value = direction > 0 ? driver.startValue?.() : driver.endValue?.();
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  destinationFor(runtime, direction) {
    const driver = runtime?.driver;
    if (!driver) return null;
    const value = direction > 0 ? driver.endValue?.() : driver.startValue?.();
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  findRuntime(direction, y = Number(window.scrollY) || 0) {
    let best = null;
    let bestDistance = Infinity;
    for (const runtime of this.runtimes()) {
      const boundary = this.boundaryFor(runtime, direction);
      if (!Number.isFinite(boundary)) continue;
      const tolerance = Math.max(1, Number(this.options(runtime).boundaryTolerance) || 18);
      const distance = Math.abs(y - boundary);
      if (distance <= tolerance && distance < bestDistance) {
        best = runtime;
        bestDistance = distance;
      }
    }
    return best;
  }

  durationFor(runtime, distance) {
    const configured = this.options(runtime).duration;
    if (Number.isFinite(configured)) return Math.max(0.05, Number(configured));
    const min = Math.max(0.05, Number(configured?.min) || 0.42);
    const max = Math.max(min, Number(configured?.max) || 0.72);
    const viewport = Math.max(1, Number(window.visualViewport?.height) || Number(window.innerHeight) || 1);
    const ratio = clamp(Math.abs(distance) / viewport, 0, 1.5) / 1.5;
    return min + (max - min) * ratio;
  }

  onChangeY(observer) {
    if (this.destroyed) return;
    const direction = this.eventDirection(observer);
    if (!direction) return;

    if (this.animating || this.gestureActive) {
      this.preventEvent(observer);
      return;
    }

    if (this.canNestedScroll(observer?.event?.target, direction)) return;
    const runtime = this.findRuntime(direction);
    if (!runtime) return; // native scrolling remains untouched away from boundaries

    this.preventEvent(observer);
    this.gestureActive = true;
    this.inputStopped = false;
    this.glide(runtime, direction);
  }

  onStop() {
    this.inputStopped = true;
    if (!this.animating) this.gestureActive = false;
  }

  glide(runtime, direction) {
    if (this.destroyed || this.animating) return false;
    const from = Number(window.scrollY) || 0;
    const target = this.destinationFor(runtime, direction);
    if (!Number.isFinite(target)) return false;

    const distance = target - from;
    if (Math.abs(distance) <= 0.5) {
      window.scrollTo(0, target);
      this.ScrollTrigger?.update?.();
      this.gestureActive = false;
      return true;
    }

    this.animating = true;
    const state = { y: from };
    const options = this.options(runtime);
    const duration = this.durationFor(runtime, distance);
    const ease = options.ease || "power2.inOut";

    try { this.tween?.kill?.(); } catch (_) {}
    this.tween = this.gsap.to(state, {
      y: target,
      duration,
      ease,
      overwrite: true,
      onStart: () => {
        try { runtime.renderer?.prepareForDirection?.(direction); } catch (_) {}
      },
      onUpdate: () => {
        window.scrollTo(0, state.y);
        try { this.ScrollTrigger?.update?.(); } catch (_) {}
      },
      onComplete: () => {
        window.scrollTo(0, target);
        try { this.ScrollTrigger?.update?.(); } catch (_) {}
        this.tween = null;
        this.animating = false;
        if (this.inputStopped) this.gestureActive = false;
      },
      onInterrupt: () => {
        this.tween = null;
        this.animating = false;
        if (this.inputStopped) this.gestureActive = false;
      }
    });
    return true;
  }

  onKeyDown(event) {
    if (this.destroyed || event.defaultPrevented) return;
    const target = event.target;
    const tag = String(target?.tagName || "").toLowerCase();
    if (target?.isContentEditable || ["input", "textarea", "select", "button"].includes(tag)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    let direction = 0;
    if (["ArrowDown", "PageDown"].includes(event.key) || (event.key === " " && !event.shiftKey)) direction = 1;
    if (["ArrowUp", "PageUp"].includes(event.key) || (event.key === " " && event.shiftKey)) direction = -1;
    if (!direction || this.animating || this.gestureActive) return;

    const runtime = this.findRuntime(direction);
    if (!runtime) return;
    event.preventDefault();
    this.gestureActive = true;
    this.inputStopped = true;
    this.glide(runtime, direction);
  }

  diagnostic() {
    return {
      installed: !!this.observer,
      animating: this.animating,
      gestureActive: this.gestureActive,
      cssSnapSuppressed: !!this.cssSnapshot,
      strategy: "glide"
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    try { this.tween?.kill?.(); } catch (_) {}
    try { this.observer?.kill?.(); } catch (_) {}
    document.removeEventListener("keydown", this.onKeyDown, { capture: true });
    this.restoreCssSnap();
    this.tween = null;
    this.observer = null;
    this.animating = false;
    this.gestureActive = false;
  }
}

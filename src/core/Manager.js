import { TransitionRuntime } from "./TransitionRuntime.js";
import { validateTransitionConfig } from "./Config.js";
import { deepMerge } from "../utils/common.js";
import { InputManager } from "../input/InputManager.js";
import { ScrollLockManager } from "../input/ScrollLockManager.js";
import { SceneBackgroundEngine } from "./SceneBackgroundEngine.js";
import { resolveGSAP } from "./GSAPAdapter.js";

export class Manager {
  constructor(options) {
    this.options = options;
    this.runtimes = [];
    this.raf = 0;
    this.framePending = false;
    this.resizeTimer = 0;
    this.pendingRefresh = false;
    this.intersectionObservers = [];
    this.resizeObserver = null;
    this.input = null;
    this.scrollLock = null;
    this.scrollAdapter = resolveGSAP(options);
    this.sceneEngine = new SceneBackgroundEngine(this, options.scene || {});
    this.autoOwner = null;
    this.destroyed = false;

    this.onScroll = this.onScroll.bind(this);
    this.onResize = this.onResize.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
  }

  transitionConfig(name, local) {
    const base = {
      engine: this.options.engine,
      scene: this.options.scene,
      scroll: this.options.scroll,
      playback: this.options.playback,
      render: this.options.render,
      content: this.options.content,
      preload: this.options.preload,
      cache: this.options.cache,
      loading: this.options.loading,
      input: this.options.input,
      layout: this.options.layout,
      accessibility: this.options.accessibility,
      responsive: this.options.responsive,
      network: this.options.network,
      debug: this.options.debug,
      events: {}
    };

    let config = deepMerge(base, local);

    // Mobile overrides are selected at initialization. See README for the
    // deliberate init-time responsive contract.
    const mobile = config.responsive?.mobile;
    const breakpoint = config.responsive?.mobileBreakpoint ?? 767;
    if (window.innerWidth <= breakpoint && mobile) {
      if (mobile.disabled) return { ...config, _disabled: true };
      config = deepMerge(config, mobile);
    }

    // Save-Data / slow-connection adaptation is opt-in except Save-Data itself.
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const saveData = !!connection?.saveData;
    const slow = ["slow-2g", "2g"].includes(connection?.effectiveType);

    const preferFallback =
      (saveData && config.network?.preferFallbackOnSaveData) ||
      (slow && config.network?.preferFallbackOnSlowConnection);

    if (preferFallback && config.fallback && config.fallback !== "skip") {
      config.source = config.fallback.type === "image"
        ? { type: "image", src: config.fallback.src, crossOrigin: config.fallback.crossOrigin }
        : config.fallback;
      config.fallback = "skip";
      config._adaptiveFallback = true;
    }

    return config;
  }

  resolveElement(value) {
    if (value?.nodeType === 1) return value;
    if (typeof value !== "string" || !value.trim()) return null;
    try { return document.querySelector(value); } catch (_) { return null; }
  }

  async init() {
    // Scene discovery happens before runtime creation so scrub runtimes can mount
    // their transition media into the persistent background engine immediately.
    this.sceneEngine.init();
    // Begin loading/painting the initially visible declarative background while
    // transition renderers prepare in parallel. Authored CSS remains fallback
    // until the scene image is actually drawable.
    this.sceneEngine.update(window.scrollY);

    const specs = [];
    const names = new Set();

    // Backward-compatible declarative discovery. Existing markup using
    // data-exit-transition continues to work unchanged.
    const nodes = [...document.querySelectorAll(this.options.selector)];
    for (const section of nodes) {
      const name = section.getAttribute("data-exit-transition");
      if (!name) continue;
      const local = this.options.transitions?.[name];
      if (!local) {
        console.warn(`[SectionTransition] Missing config for "${name}"`);
        continue;
      }
      specs.push({ section, name, local });
      names.add(name);
    }

    // v0.5 scene scrub discovery. A scene only declares semantics/relationship
    // in HTML; media source/count/tuning remains in the JS transition config.
    const scrubAttr = this.options.scene?.scrubAttribute || "data-st-scrub";
    const sceneNodes = [...document.querySelectorAll(`[${scrubAttr}]`)];
    for (const section of sceneNodes) {
      const name = section.getAttribute(scrubAttr);
      if (!name || names.has(name)) continue;
      const local = this.options.transitions?.[name];
      if (!local) {
        console.warn(`[SectionTransition] Missing config for scene scrub "${name}"`);
        continue;
      }
      specs.push({ section, name, local: deepMerge({ scroll: { mode: "scrub" } }, local) });
      names.add(name);
    }

    // v0.3.9: configuration-only discovery. This makes scrub/auto transitions
    // usable on Elementor or existing HTML without adding any data attributes.
    for (const [name, local] of Object.entries(this.options.transitions || {})) {
      if (names.has(name) || !local?.from) continue;
      const section = this.resolveElement(local.from);
      if (!section) {
        console.warn(`[SectionTransition] from selector/element not found for "${name}"`);
        continue;
      }
      specs.push({ section, name, local });
      names.add(name);
    }

    // ScrollTrigger recommends creation in document order, particularly when
    // upstream triggers pin because their spacer distance can affect downstream
    // measurements. Discovery comes from several APIs, so normalize the combined
    // list to authored DOM order before creating runtimes/triggers.
    specs.sort((a, b) => {
      if (a.section === b.section) return 0;
      try {
        const position = a.section.compareDocumentPosition?.(b.section) || 0;
        const following = typeof Node !== "undefined" ? Node.DOCUMENT_POSITION_FOLLOWING : 4;
        const preceding = typeof Node !== "undefined" ? Node.DOCUMENT_POSITION_PRECEDING : 2;
        if (position & following) return -1;
        if (position & preceding) return 1;
      } catch (_) {}
      const aTop = (Number(window.scrollY) || 0) + Number(a.section.getBoundingClientRect?.().top || 0);
      const bTop = (Number(window.scrollY) || 0) + Number(b.section.getBoundingClientRect?.().top || 0);
      return aTop - bTop;
    });

    for (const { section, name, local } of specs) {
      const config = this.transitionConfig(name, local);
      if (config._disabled) continue;

      try {
        validateTransitionConfig(name, config);
      } catch (error) {
        if (typeof this.options.onError === "function") {
          this.options.onError(error, { transition: name, phase: "config" });
        } else {
          console.error(error);
        }
        continue;
      }

      const runtime = new TransitionRuntime(this, section, name, config);
      this.runtimes.push(runtime);
    }

    const needsScrollTrigger = this.runtimes.some((runtime) => runtime.usesScrollTrigger?.());
    if (needsScrollTrigger && !this.scrollAdapter) {
      // Scene discovery may already have created the persistent layer. Revert it
      // before failing so a missing peer dependency never changes page layout.
      this.sceneEngine.destroy();
      throw new Error(
        "[SectionTransition] GSAP + ScrollTrigger are required for scrub/snap mode. " +
        "Load them before SectionTransition, call SectionTransition.useGSAP(gsap, ScrollTrigger), " +
        "or set scroll.engine=\"legacy\" for the compatibility engine."
      );
    }

    const needsTakeover = this.runtimes.some((runtime) => runtime.usesTakeover?.());
    if (needsTakeover) {
      this.input = new InputManager(this, this.options);
      this.scrollLock = new ScrollLockManager();
    }

    // Prepare independently instead of serially blocking transition 2 on 1.
    // Renderer preparation itself is timeout-bounded, so a stalled asset cannot
    // leave init() pending forever.
    await Promise.allSettled(this.runtimes.map((runtime) => runtime.init()));
    if (this.destroyed) return this;

    window.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onResize, { passive: true });
    window.visualViewport?.addEventListener?.("resize", this.onResize, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibility);
    this.input?.attach?.();

    this.installLayoutObservers();
    this.installPreloadObserver();
    try { this.scrollAdapter?.ScrollTrigger?.refresh?.(); } catch (_) {}

    if (this.options.layout.refreshOnFonts && document.fonts?.ready) {
      document.fonts.ready.then(() => this.refresh()).catch(() => {});
    }

    if (this.options.layout.refreshOnLoad && document.readyState !== "complete") {
      window.addEventListener("load", () => this.refresh(), { once: true });
    }

    this.onScroll();
    this.requestFrame();
    return this;
  }

  installLayoutObservers() {
    if (!this.options.layout.autoRefresh || typeof ResizeObserver === "undefined") return;

    this.resizeObserver = new ResizeObserver(() => this.scheduleRefresh());
    this.runtimes.forEach((runtime) => {
      if (runtime.section?.isConnected) this.resizeObserver.observe(runtime.section);
      const target = runtime.targetSection?.();
      if (target?.isConnected && target !== runtime.section) this.resizeObserver.observe(target);
      if (runtime.section?.parentElement) this.resizeObserver.observe(runtime.section.parentElement);
    });
  }

  installPreloadObserver() {
    if (typeof IntersectionObserver === "undefined") {
      this.runtimes.forEach((runtime) => runtime.preload().catch(() => {}));
      return;
    }

    // Intersection margin can be overridden per transition. Group runtimes by
    // rootMargin so each local config is honored without creating one observer
    // per section unnecessarily.
    const groups = new Map();
    for (const runtime of this.runtimes) {
      const margin = runtime.config.preload?.intersectionMargin || this.options.preload.intersectionMargin;
      if (!groups.has(margin)) groups.set(margin, []);
      groups.get(margin).push(runtime);
    }

    for (const [rootMargin, runtimes] of groups) {
      const bySection = new Map(runtimes.map((runtime) => [runtime.section, runtime]));
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const runtime = bySection.get(entry.target);
          if (!runtime || runtime.destroyed) continue;
          runtime.preload().catch(() => {});
        }
      }, { rootMargin });

      runtimes.forEach((runtime) => {
        if (runtime.section?.isConnected) observer.observe(runtime.section);
      });
      this.intersectionObservers.push(observer);
    }
  }

  claimAuto(runtime) {
    if (this.destroyed) return false;
    if (this.autoOwner && this.autoOwner !== runtime) return false;
    this.autoOwner = runtime;
    return true;
  }

  releaseAuto(runtime) {
    if (this.autoOwner === runtime) this.autoOwner = null;
  }

  documentSnapEnabled() {
    const root = document.documentElement;
    const body = document.body;
    const rootSnap = getComputedStyle(root).scrollSnapType || "none";
    const bodySnap = body ? (getComputedStyle(body).scrollSnapType || "none") : "none";
    return rootSnap !== "none" || bodySnap !== "none";
  }

  onScroll() {
    if (this.destroyed) return;
    const y = window.scrollY;
    this.runtimes.forEach((runtime) => {
      if (!runtime.usesScrollTrigger?.()) runtime.updateScroll(y);
    });
    this.sceneEngine.update(y);
    this.requestFrame();
  }

  onResize() {
    // Keep the persistent scene surface visually sized by the live viewport in
    // the same event; expensive section geometry can remain debounced.
    this.sceneEngine.resize();
    this.scheduleRefresh();
  }

  scheduleRefresh() {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(
      () => this.refresh(),
      Math.max(0, this.options.layout.debounce || 100)
    );
  }

  onVisibility() {
    const hidden = document.visibilityState === "hidden";
    this.runtimes.forEach((runtime) => runtime.visibility(hidden));
  }

  findAutoRuntimeForIntent(direction, delta, inputType = null) {
    const supportsInput = (runtime) =>
      !inputType || runtime.config.input?.[inputType] !== false;

    // If one is pending/playing, keep ownership so repeated momentum does not
    // start a second playback while readiness or native video is unresolved.
    const active = this.runtimes.find((r) => r.isAutoPlaying() && supportsInput(r));
    if (active) return active;

    return this.runtimes.find((runtime) =>
      supportsInput(runtime) && runtime.canCapture(direction, delta)
    ) || null;
  }

  requestFrame() {
    if (this.destroyed || this.framePending) return;
    this.framePending = true;
    this.raf = requestAnimationFrame((timestamp) => {
      this.framePending = false;
      if (this.destroyed) return;
      let again = false;
      for (const runtime of this.runtimes) {
        if (runtime.tick(timestamp)) again = true;
      }
      if (again) this.requestFrame();
    });
  }

  refresh() {
    if (this.destroyed) return this;

    if (this.scrollLock?.locked) {
      // Re-measuring document boundaries while document scroll lock is
      // active can produce incorrect startY values. Resize render surfaces
      // immediately, then defer boundary measurement until unlock.
      this.pendingRefresh = true;
      this.runtimes.forEach((runtime) => runtime.renderer?.resize?.());
      return this;
    }

    this.pendingRefresh = false;
    this.sceneEngine.resize();
    this.runtimes.forEach((runtime) => {
      if (!runtime.usesScrollTrigger?.()) runtime.measure();
      else runtime.renderer?.resize?.();
    });
    try { this.scrollAdapter?.ScrollTrigger?.refresh?.(); } catch (_) {}
    this.onScroll();
    return this;
  }

  /**
   * Explicit animated navigation API. Programmatic browser scrolls are not
   * globally intercepted because doing so would break unrelated libraries.
   */
  async navigateTo(target, { transitions = true } = {}) {
    const element =
      typeof target === "string" ? document.querySelector(target) : target;

    if (!element) throw new Error("[SectionTransition] navigateTo target not found");

    if (!transitions) {
      element.scrollIntoView({ behavior: "auto", block: "start" });
      return;
    }

    // ScrollTrigger-driven modes keep scroll position and media progress as one
    // system, so programmatic navigation simply moves to the authored target.
    const runtime = this.runtimes.find((r) => r.targetSection?.() === element);
    if (runtime?.usesTakeover?.()) {
      window.scrollTo({ top: Math.max(0, runtime.driver.boundaryY(1)), behavior: "auto" });
      await runtime.requestAuto(1);
      return;
    }

    element.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  diagnostics() {
    return this.runtimes.map((r) => r.diagnostic());
  }

  sceneDiagnostics() {
    return this.sceneEngine?.diagnostic?.() || null;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    cancelAnimationFrame(this.raf);
    clearTimeout(this.resizeTimer);
    window.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("resize", this.onResize);
    window.visualViewport?.removeEventListener?.("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.input?.detach?.();
    this.resizeObserver?.disconnect();
    this.intersectionObservers.forEach((observer) => observer.disconnect());
    this.intersectionObservers = [];

    // Runtime cleanup owns portal restoration and native-playback cancellation.
    this.runtimes.forEach((runtime) => runtime.destroy());
    this.runtimes = [];
    this.autoOwner = null;
    this.sceneEngine.destroy();

    // Last-resort unlock in case third-party code interrupted runtime cleanup.
    if (this.scrollLock?.locked) this.scrollLock.unlock();
  }
}

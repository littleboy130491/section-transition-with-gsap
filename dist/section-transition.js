/**
 * SectionTransition v0.6.3
 * Generated from /src by build.mjs. Do not hand-edit this file.
 */
(function (global) {
  "use strict";

/* ===== src/utils/common.js ===== */
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function deepMerge(base, override) {
  const out = { ...(base || {}) };
  Object.keys(override || {}).forEach((key) => {
    const a = base?.[key];
    const b = override[key];
    if (
      b && typeof b === "object" && !Array.isArray(b) &&
      a && typeof a === "object" && !Array.isArray(a)
    ) {
      out[key] = deepMerge(a, b);
    } else {
      out[key] = b;
    }
  });
  return out;
}

function resolveDistance(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").trim().toLowerCase();
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid distance: ${value}`);
  if (raw.endsWith("vh")) return (n / 100) * window.innerHeight;
  if (raw.endsWith("vw")) return (n / 100) * window.innerWidth;
  return n;
}

const EASINGS = {
  linear: (t) => t,
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2
};

function resolveEasing(value) {
  if (typeof value === "function") return value;
  return EASINGS[value] || EASINGS.easeInOutCubic;
}

function normalizeWheel(event) {
  let delta = event.deltaY;
  if (event.deltaMode === 1) delta *= 16; // line -> approximate pixels
  if (event.deltaMode === 2) delta *= window.innerHeight; // page -> pixels
  return delta;
}

function idle(callback) {
  if ("requestIdleCallback" in window) {
    return requestIdleCallback(callback, { timeout: 500 });
  }
  return setTimeout(callback, 32);
}

function cancelIdle(id) {
  if ("cancelIdleCallback" in window) cancelIdleCallback(id);
  else clearTimeout(id);
}



/* ===== src/core/State.js ===== */
const STATES = Object.freeze({
  UNINITIALIZED: "UNINITIALIZED",
  LOADING: "LOADING",
  READY: "READY",
  PLAYING_FORWARD: "PLAYING_FORWARD",
  PLAYING_REVERSE: "PLAYING_REVERSE",
  COMPLETE: "COMPLETE",
  ERROR: "ERROR",
  DESTROYED: "DESTROYED"
});



/* ===== src/core/Config.js ===== */

const DEFAULTS = {
  selector: "[data-exit-transition]",

  engine: {
    type: "scrolltrigger", // "scrolltrigger" | "legacy"
    gsap: null,
    ScrollTrigger: null
  },

  scene: {
    enabled: true,
    selector: "[data-st-scene]",
    backgroundAttribute: "data-st-background",
    scrubAttribute: "data-st-scrub",
    fit: "cover",
    position: "center center",
    zIndex: 0,
    contentZIndex: 1,
    manageContentLayer: true,
    preloadAhead: 1,
    preloadBehind: 1,
    cacheMax: 4,
    maxDpr: 2
  },

  scroll: {
    mode: "scrub",           // "scrub" | "snap" | "auto"(alias of snap) | "takeover"
    engine: "scrolltrigger", // "scrolltrigger" | "legacy" per transition
    distance: "180vh",       // used when scrubRange="distance" / legacy
    scrub: true,              // primary engine: true | positive seconds; false is legacy-only
    smoothing: 0,             // deprecated compatibility hint; prefer scroll.scrub
    scrubStart: "leave",      // legacy-only compatibility setting
    scrubRange: "sections",  // "sections" | "distance"
    scrubEngine: "scene",     // legacy compatibility: "auto"|"scene"|"sticky"|"legacy"
    reversible: true,
    snap: "auto",             // snap mode enabled unless false; "auto" is kept for compatibility
    snapStrategy: "glide",     // "glide" (Observer + one GSAP scroll tween) | "settle" (legacy ScrollTrigger snap)
    snapGlide: {
      type: "wheel,touch",
      inputTolerance: 8,
      dragMinimum: 6,
      boundaryTolerance: 18,
      duration: { min: 0.42, max: 0.72 },
      ease: "power2.inOut",
      onStopDelay: 0.18,
      disableCssSnap: true,
      keyboard: true,
      ignore: "input,textarea,select,button,[contenteditable='true'],[data-st-native-scroll]"
    },
    pin: false,               // optional ScrollTrigger pin target/boolean
    pinSpacing: true,
    pinReparent: false,
    anticipatePin: 0,
    fastScrollEnd: false,
    preventOverlaps: false,
    markers: false,

    // takeover-only compatibility options
    triggerThreshold: 24,
    lockDuringTransition: true
  },

  playback: {
    duration: 1400,
    easing: "easeInOutCubic",
    maxFps: 60,
    videoMode: "auto",      // "auto" | "timeline" | "native"
    enterFade: 90,           // takeover mode: source -> transition crossfade
    exitFade: 140,           // legacy/default transition -> target crossfade

    // Select the useful normalized portion of the media. This is applied
    // after video source.trim, so trim can choose seconds and range can make
    // small visual endpoint corrections without re-encoding the asset.
    range: {
      start: 0,
      end: 1
    },

    // Optional normalized range for source.reverseSrc. reverseSrc is expected
    // to be the visual inverse of the effective forward transition; therefore
    // its full range is used by default even when the forward file is cropped.
    reverseRange: {
      start: 0,
      end: 1
    },

    handoff: {
      hold: 60,              // ms to hold final frame after target has painted
      fade: null,            // null => use playback.exitFade
      paintFrames: 2,        // render frames to wait after moving the document
      settleFrames: 3,       // reassert landing while restored scroll-snap settles
      landingTolerance: 1,   // px drift allowed before correcting the landing
      startAt: 0.9,          // normalized playback progress where alignment starts
      easing: "easeOutCubic",
      transform: {
        origin: "center center",
        from: { scale: 1, x: 0, y: 0 },
        to: { scale: 1, x: 0, y: 0 }
      }
    }
  },

  render: {
    fit: "cover",
    position: "center center",
    background: "#000",
    maxDpr: 2,
    // Keep transition media below a normal sticky/fixed site header by default.
    // Raise/lower per site instead of relying on an effectively infinite z-index.
    zIndex: 900
  },

  content: {
    // Content choreography is opt-in for backward compatibility. Add
    // data-st-leave/data-st-enter markers (or custom selectors) to animate
    // text/UI independently from the media transition.
    leave: {
      effect: "native",      // native | none | fade | fade-up | fade-down | scale
      selector: "[data-st-leave]",
      start: 0,
      end: 0.18,
      distance: 12,
      scale: 0.98,
      stagger: 0,            // milliseconds, converted to playback progress
      easing: "easeOutCubic"
    },
    enter: {
      effect: "native",      // native keeps ordinary viewport scrolling
      selector: "[data-st-enter]",
      trigger: "auto",       // ScrollTrigger modes: auto => timeline; takeover => handoff
      start: 0.82,
      end: 1,
      duration: 240,
      delay: 0,
      distance: 24,
      scale: 0.98,
      stagger: 40,
      easing: "easeOutCubic",
      threshold: 0.05,        // viewport trigger only
      once: true
    }
  },

  preload: {
    strategy: "nearby",     // "nearby" | "progressive" | "all"
    ahead: 12,
    behind: 6,
    intersectionMargin: "150% 0px",
    deferUntilNear: true,
    readyFrames: 8,
    maxConcurrent: 4,

    // Sequence-only fast-scroll scheduler. Scroll itself stays native; these
    // options only decide which decoded frames get scarce network/decode slots.
    motion: {
      enabled: true,
      predictionMs: 120,
      settleMs: 120,
      mediumVelocity: 900,
      fastVelocity: 1800,
      extremeVelocity: 2800,
      adaptiveFrames: true,
      maxStep: 4,
      pruneStale: true,
      preemptStale: true,
      keepRadius: 12,
      preemptDistance: 16
    }
  },

  cache: {
    maxFrames: 24,
    useImageBitmap: true
  },

  loading: {
    onNotReady: "wait",     // "wait" | "fallback" | "skip"
    timeout: 8000
  },

  input: {
    gestureTimeout: 180,
    momentumCooldown: 250,
    keyboard: true,
    touch: true,
    wheel: true
  },

  layout: {
    autoRefresh: true,
    debounce: 100,
    refreshOnFonts: true,
    refreshOnLoad: true
  },

  accessibility: {
    respectReducedMotion: true
  },

  responsive: {
    mobileBreakpoint: 767,
    mobile: null
  },

  network: {
    preferFallbackOnSaveData: true,
    preferFallbackOnSlowConnection: false
  },

  events: {},

  debug: false
};

function normalizeOptions(userOptions = {}) {
  return deepMerge(DEFAULTS, userOptions);
}

function validateTransitionConfig(name, cfg) {
  const problems = [];

  if (!cfg?.source?.type) problems.push("source.type is required");

  for (const key of ["from", "to", "target"]) {
    const value = cfg?.[key];
    if (value == null) continue;
    const valid = (typeof value === "string" && value.trim()) || value?.nodeType === 1;
    if (!valid) problems.push(`${key} must be a non-empty CSS selector or DOM element`);
  }

  if (cfg?.source?.type === "sequence") {
    if (!cfg.source.src) problems.push("sequence source.src is required");
    if (!Number.isInteger(cfg.source.count) || cfg.source.count < 1) {
      problems.push("sequence source.count must be a positive integer");
    }
    if (Array.isArray(cfg.source.src) && cfg.source.count !== cfg.source.src.length) {
      problems.push("sequence source.count must match source.src array length");
    }
  }

  if (cfg?.source?.type === "video" && !cfg.source.src) {
    problems.push("video source.src is required");
  }

  if (cfg?.source?.type === "video" && cfg.source.reverseSrc != null) {
    if (typeof cfg.source.reverseSrc !== "string" || !cfg.source.reverseSrc.trim()) {
      problems.push("video source.reverseSrc must be a non-empty URL string");
    }
    if (cfg.source.reversePlaybackRate != null &&
        (!Number.isFinite(cfg.source.reversePlaybackRate) || cfg.source.reversePlaybackRate <= 0)) {
      problems.push("video source.reversePlaybackRate must be > 0");
    }
  }

  if (!["sequence", "video", "image"].includes(cfg?.source?.type)) {
    problems.push(`unsupported source.type "${cfg?.source?.type}"`);
  }

  if (cfg?.source?.type === "image" && !cfg.source.src) {
    problems.push("image source.src is required");
  }

  if (cfg?.fallback && cfg.fallback !== "skip") {
    if (!["sequence", "video", "image"].includes(cfg.fallback.type)) {
      problems.push(`fallback.type must be "sequence", "video", "image", or fallback must be "skip"`);
    }
    if (!cfg.fallback.src) problems.push("fallback.src is required");
    if (cfg.fallback.type === "sequence" &&
        (!Number.isInteger(cfg.fallback.count) || cfg.fallback.count < 1)) {
      problems.push("sequence fallback.count must be a positive integer");
    }
  }

  if (!["scrub", "snap", "auto", "takeover"].includes(cfg?.scroll?.mode)) {
    problems.push(`scroll.mode must be "scrub", "snap", "auto", or "takeover"`);
  }

  if (!["scrolltrigger", "legacy"].includes(cfg?.scroll?.engine || cfg?.engine?.type)) {
    problems.push(`scroll.engine must be "scrolltrigger" or "legacy"`);
  }

  const scrubValue = cfg?.scroll?.scrub;
  if (!(scrubValue === true || scrubValue === false || (Number.isFinite(scrubValue) && scrubValue > 0))) {
    problems.push("scroll.scrub must be true, false, or a positive number of seconds");
  } else {
    const normalizedMode = cfg?.scroll?.mode === "auto" ? "snap" : cfg?.scroll?.mode;
    const scrollEngine = cfg?.scroll?.engine || cfg?.engine?.type;
    if (scrubValue === false && scrollEngine !== "legacy" && ["scrub", "snap"].includes(normalizedMode)) {
      problems.push("scroll.scrub cannot be false for ScrollTrigger scrub/snap modes; use true for direct progress or a positive number for catch-up smoothing");
    }
  }

  if (!["wait", "fallback", "skip"].includes(cfg?.loading?.onNotReady)) {
    problems.push(`loading.onNotReady must be "wait", "fallback", or "skip"`);
  }

  if (!Number.isFinite(cfg?.cache?.maxFrames) || cfg.cache.maxFrames < 2) {
    problems.push("cache.maxFrames must be >= 2");
  }

  if (!Number.isFinite(cfg?.playback?.duration) || cfg.playback.duration <= 0) {
    problems.push("playback.duration must be > 0");
  }

  if (!Number.isFinite(cfg?.playback?.maxFps) || cfg.playback.maxFps < 1 || cfg.playback.maxFps > 240) {
    problems.push("playback.maxFps must be between 1 and 240");
  }

  if (!Number.isFinite(cfg?.preload?.maxConcurrent) || cfg.preload.maxConcurrent < 1) {
    problems.push("preload.maxConcurrent must be >= 1");
  }

  const motion = cfg?.preload?.motion || {};
  if (!Number.isFinite(motion.predictionMs) || motion.predictionMs < 0 || motion.predictionMs > 1000) {
    problems.push("preload.motion.predictionMs must be between 0 and 1000ms");
  }
  if (!Number.isFinite(motion.settleMs) || motion.settleMs < 0 || motion.settleMs > 1000) {
    problems.push("preload.motion.settleMs must be between 0 and 1000ms");
  }
  for (const [key, min] of [["mediumVelocity", 1], ["fastVelocity", 1], ["extremeVelocity", 1]]) {
    if (!Number.isFinite(motion[key]) || motion[key] < min) {
      problems.push(`preload.motion.${key} must be >= ${min}`);
    }
  }
  if (
    Number.isFinite(motion.mediumVelocity) &&
    Number.isFinite(motion.fastVelocity) &&
    Number.isFinite(motion.extremeVelocity) &&
    !(motion.mediumVelocity <= motion.fastVelocity && motion.fastVelocity <= motion.extremeVelocity)
  ) {
    problems.push("preload.motion velocity thresholds must be ordered medium <= fast <= extreme");
  }
  if (!Number.isInteger(motion.maxStep) || motion.maxStep < 1 || motion.maxStep > 12) {
    problems.push("preload.motion.maxStep must be an integer between 1 and 12");
  }
  if (!Number.isFinite(motion.keepRadius) || motion.keepRadius < 1) {
    problems.push("preload.motion.keepRadius must be >= 1");
  }
  if (!Number.isFinite(motion.preemptDistance) || motion.preemptDistance < 1) {
    problems.push("preload.motion.preemptDistance must be >= 1");
  }

  if (!Number.isFinite(cfg?.loading?.timeout) || cfg.loading.timeout < 1000) {
    problems.push("loading.timeout must be >= 1000ms");
  }

  if (!Number.isFinite(cfg?.scroll?.triggerThreshold) || cfg.scroll.triggerThreshold < 1) {
    problems.push("scroll.triggerThreshold must be >= 1");
  }

  const snapStrategy = cfg?.scroll?.snapStrategy;
  if (!(snapStrategy === "glide" || snapStrategy === "settle")) {
    problems.push('scroll.snapStrategy must be "glide" or "settle"');
  }

  const snap = cfg?.scroll?.snap;
  if (!(snap === true || snap === false || snap === "auto" || (snap && typeof snap === "object"))) {
    problems.push('scroll.snap must be true, false, "auto", or a ScrollTrigger snap config object');
  }

  if (!["auto", "scene", "sticky", "legacy"].includes(cfg?.scroll?.scrubEngine)) {
    problems.push('scroll.scrubEngine must be "auto", "scene", "sticky", or "legacy"');
  }

  if (!Number.isFinite(cfg?.playback?.enterFade) || cfg.playback.enterFade < 0) {
    problems.push("playback.enterFade must be >= 0");
  }

  if (!Number.isFinite(cfg?.playback?.exitFade) || cfg.playback.exitFade < 0) {
    problems.push("playback.exitFade must be >= 0");
  }

  const settleFrames = cfg?.playback?.handoff?.settleFrames;
  if (!Number.isFinite(settleFrames) || settleFrames < 0 || settleFrames > 10) {
    problems.push("playback.handoff.settleFrames must be between 0 and 10");
  }

  const landingTolerance = cfg?.playback?.handoff?.landingTolerance;
  if (!Number.isFinite(landingTolerance) || landingTolerance < 0) {
    problems.push("playback.handoff.landingTolerance must be >= 0");
  }


  const range = cfg?.playback?.range;
  if (!Number.isFinite(range?.start) || range.start < 0 || range.start > 1) {
    problems.push("playback.range.start must be between 0 and 1");
  }
  if (!Number.isFinite(range?.end) || range.end < 0 || range.end > 1) {
    problems.push("playback.range.end must be between 0 and 1");
  }
  if (Number.isFinite(range?.start) && Number.isFinite(range?.end) && range.end <= range.start) {
    problems.push("playback.range.end must be greater than playback.range.start");
  }

  const reverseRange = cfg?.playback?.reverseRange;
  if (!Number.isFinite(reverseRange?.start) || reverseRange.start < 0 || reverseRange.start > 1) {
    problems.push("playback.reverseRange.start must be between 0 and 1");
  }
  if (!Number.isFinite(reverseRange?.end) || reverseRange.end < 0 || reverseRange.end > 1) {
    problems.push("playback.reverseRange.end must be between 0 and 1");
  }
  if (
    Number.isFinite(reverseRange?.start) &&
    Number.isFinite(reverseRange?.end) &&
    reverseRange.end <= reverseRange.start
  ) {
    problems.push("playback.reverseRange.end must be greater than playback.reverseRange.start");
  }

  const handoff = cfg?.playback?.handoff;
  if (typeof handoff?.transform?.origin !== "string" || !handoff.transform.origin.trim()) {
    problems.push("playback.handoff.transform.origin must be a non-empty CSS transform-origin string");
  }
  if (!Number.isFinite(handoff?.hold) || handoff.hold < 0) {
    problems.push("playback.handoff.hold must be >= 0");
  }
  if (handoff?.fade != null && (!Number.isFinite(handoff.fade) || handoff.fade < 0)) {
    problems.push("playback.handoff.fade must be null or >= 0");
  }
  if (!Number.isInteger(handoff?.paintFrames) || handoff.paintFrames < 0 || handoff.paintFrames > 10) {
    problems.push("playback.handoff.paintFrames must be an integer between 0 and 10");
  }
  if (!Number.isFinite(handoff?.startAt) || handoff.startAt < 0 || handoff.startAt >= 1) {
    problems.push("playback.handoff.startAt must be >= 0 and < 1");
  }

  for (const endpoint of ["from", "to"]) {
    const t = handoff?.transform?.[endpoint];
    if (!Number.isFinite(t?.scale) || t.scale <= 0) {
      problems.push(`playback.handoff.transform.${endpoint}.scale must be > 0`);
    }
    if (!Number.isFinite(t?.x)) {
      problems.push(`playback.handoff.transform.${endpoint}.x must be a finite pixel value`);
    }
    if (!Number.isFinite(t?.y)) {
      problems.push(`playback.handoff.transform.${endpoint}.y must be a finite pixel value`);
    }
  }

  if (cfg?.source?.type === "video" && cfg.source.trim != null) {
    const trim = cfg.source.trim;
    const trimStart = trim?.start == null ? 0 : trim.start;
    if (!Number.isFinite(trimStart) || trimStart < 0) {
      problems.push("video source.trim.start must be >= 0 seconds");
    }
    if (trim?.end != null && (!Number.isFinite(trim.end) || trim.end <= trimStart)) {
      problems.push("video source.trim.end must be greater than source.trim.start");
    }
  }

  if (cfg?.source?.type === "video" && cfg.source.reverseTrim != null) {
    const trim = cfg.source.reverseTrim;
    const trimStart = trim?.start == null ? 0 : trim.start;
    if (!Number.isFinite(trimStart) || trimStart < 0) {
      problems.push("video source.reverseTrim.start must be >= 0 seconds");
    }
    if (trim?.end != null && (!Number.isFinite(trim.end) || trim.end <= trimStart)) {
      problems.push("video source.reverseTrim.end must be greater than source.reverseTrim.start");
    }
  }

  if (!["leave", "after"].includes(cfg?.scroll?.scrubStart)) {
    problems.push('scroll.scrubStart must be "leave" or "after"');
  }

  if (!["sections", "distance"].includes(cfg?.scroll?.scrubRange)) {
    problems.push('scroll.scrubRange must be "sections" or "distance"');
  }

  if (!Number.isFinite(cfg?.render?.zIndex)) {
    problems.push("render.zIndex must be a finite number");
  }

  const allowedContentEffects = ["native", "none", "fade", "fade-up", "fade-down", "scale"];
  for (const kind of ["leave", "enter"]) {
    const rule = cfg?.content?.[kind];
    if (!allowedContentEffects.includes(rule?.effect)) {
      problems.push(`content.${kind}.effect must be one of ${allowedContentEffects.join(", ")}`);
    }
    if (typeof rule?.selector !== "string" || !rule.selector.trim()) {
      problems.push(`content.${kind}.selector must be a non-empty CSS selector or "self"`);
    }
    if (!Number.isFinite(rule?.distance) || rule.distance < 0) {
      problems.push(`content.${kind}.distance must be >= 0`);
    }
    if (!Number.isFinite(rule?.scale) || rule.scale <= 0) {
      problems.push(`content.${kind}.scale must be > 0`);
    }
    if (!Number.isFinite(rule?.stagger) || rule.stagger < 0) {
      problems.push(`content.${kind}.stagger must be >= 0`);
    }
  }

  const leaveContent = cfg?.content?.leave;
  if (!Number.isFinite(leaveContent?.start) || leaveContent.start < 0 || leaveContent.start > 1) {
    problems.push("content.leave.start must be between 0 and 1");
  }
  if (!Number.isFinite(leaveContent?.end) || leaveContent.end < 0 || leaveContent.end > 1) {
    problems.push("content.leave.end must be between 0 and 1");
  }
  if (Number.isFinite(leaveContent?.start) && Number.isFinite(leaveContent?.end) && leaveContent.end <= leaveContent.start) {
    problems.push("content.leave.end must be greater than content.leave.start");
  }

  const enterContent = cfg?.content?.enter;
  if (!["auto", "handoff", "viewport"].includes(enterContent?.trigger)) {
    problems.push('content.enter.trigger must be "auto", "handoff", or "viewport"');
  }
  if (!Number.isFinite(enterContent?.start) || enterContent.start < 0 || enterContent.start > 1) {
    problems.push("content.enter.start must be between 0 and 1");
  }
  if (!Number.isFinite(enterContent?.end) || enterContent.end < 0 || enterContent.end > 1) {
    problems.push("content.enter.end must be between 0 and 1");
  }
  if (Number.isFinite(enterContent?.start) && Number.isFinite(enterContent?.end) && enterContent.end <= enterContent.start) {
    problems.push("content.enter.end must be greater than content.enter.start");
  }
  if (!Number.isFinite(enterContent?.duration) || enterContent.duration < 0) {
    problems.push("content.enter.duration must be >= 0");
  }
  if (!Number.isFinite(enterContent?.delay) || enterContent.delay < 0) {
    problems.push("content.enter.delay must be >= 0");
  }
  if (!Number.isFinite(enterContent?.threshold) || enterContent.threshold < 0 || enterContent.threshold > 1) {
    problems.push("content.enter.threshold must be between 0 and 1");
  }
  if (typeof enterContent?.once !== "boolean") {
    problems.push("content.enter.once must be boolean");
  }

  if (!Number.isFinite(cfg?.input?.gestureTimeout) || cfg.input.gestureTimeout < 0) {
    problems.push("input.gestureTimeout must be >= 0");
  }

  if (!Number.isFinite(cfg?.input?.momentumCooldown) || cfg.input.momentumCooldown < 0) {
    problems.push("input.momentumCooldown must be >= 0");
  }

  if (problems.length) {
    throw new Error(`[SectionTransition:${name}] Invalid config: ${problems.join("; ")}`);
  }
}



/* ===== src/core/Events.js ===== */
class Events {
  constructor(globalEvents = {}, localEvents = {}, onError = null) {
    this.globalEvents = globalEvents || {};
    this.localEvents = localEvents || {};
    this.onError = onError;
  }

  emit(name, context) {
    const handlers = [this.globalEvents[name], this.localEvents[name]].filter(
      (fn) => typeof fn === "function"
    );

    handlers.forEach((fn) => {
      try {
        fn(context);
      } catch (error) {
        if (typeof this.onError === "function") {
          this.onError(error, { ...context, phase: `event:${name}` });
        } else {
          console.error(error);
        }
      }
    });
  }
}



/* ===== src/core/GSAPAdapter.js ===== */
let registeredGSAP = null;
let registeredScrollTrigger = null;

function registerGSAP(gsap, ScrollTrigger) {
  if (!gsap || !ScrollTrigger) {
    throw new Error("[SectionTransition] registerGSAP() requires both gsap and ScrollTrigger");
  }
  registeredGSAP = gsap;
  registeredScrollTrigger = ScrollTrigger;
  try { gsap.registerPlugin?.(ScrollTrigger); } catch (_) {}
  return { gsap, ScrollTrigger };
}

function resolveGSAP(options = {}) {
  const explicit = options?.engine || {};
  const globalObject = typeof globalThis !== "undefined" ? globalThis : {};
  const gsap = explicit.gsap || registeredGSAP || globalObject.gsap || null;
  const ScrollTrigger =
    explicit.ScrollTrigger ||
    registeredScrollTrigger ||
    globalObject.ScrollTrigger ||
    gsap?.plugins?.ScrollTrigger ||
    null;

  if (!gsap || !ScrollTrigger) return null;
  try { gsap.registerPlugin?.(ScrollTrigger); } catch (_) {}
  return { gsap, ScrollTrigger };
}

function clearRegisteredGSAPForTests() {
  registeredGSAP = null;
  registeredScrollTrigger = null;
}



/* ===== src/core/SceneBackgroundEngine.js ===== */

function splitPosition(position) {
  const parts = String(position || "center center").trim().split(/\s+/);
  return { x: parts[0] || "center", y: parts[1] || parts[0] || "center" };
}

function alignOffset(container, content, align) {
  if (align === "left" || align === "top") return 0;
  if (align === "right" || align === "bottom") return container - content;
  const percent = /^(-?\d+(?:\.\d+)?)%$/.exec(String(align || ""));
  if (percent) return (container - content) * clamp(Number(percent[1]) / 100);
  return (container - content) / 2;
}

/**
 * Persistent background surface for scrub scenes.
 *
 * The engine owns one fixed visual layer for all declarative scrub scenes.
 * Authored sections keep their DOM/content and normal scroll behavior; only
 * their visual background is delegated to this surface after a drawable scene
 * image or transition frame exists.
 */
class SceneBackgroundEngine {
  constructor(manager, options = {}) {
    this.manager = manager;
    this.options = options;
    this.scenes = [];
    this.byElement = new Map();
    this.byName = new Map();
    this.cache = new Map();
    this.inflight = new Map();
    this.failed = new Map();
    this.layer = null;
    this.canvas = null;
    this.ctx = null;
    this.mediaHost = null;
    this.currentScene = null;
    this.wantedScene = null;
    this.currentVisual = null;
    this.activeTransition = null;
    this.destroyed = false;
    this.resizeScheduled = false;
    this.requestSerial = 0;
    this.surfaceReady = false;
  }

  get enabled() {
    return this.options?.enabled !== false;
  }

  sceneSelector() {
    return this.options?.selector || "[data-st-scene]";
  }

  backgroundAttribute() {
    return this.options?.backgroundAttribute || "data-st-background";
  }

  scrubAttribute() {
    return this.options?.scrubAttribute || "data-st-scrub";
  }

  init() {
    if (!this.enabled || typeof document === "undefined") return false;
    this.discover();
    if (!this.scenes.length) return false;
    this.createLayer();
    this.scenes.forEach((scene) => this.promoteContent(scene));
    this.resize();
    return true;
  }

  discover() {
    this.scenes = [];
    this.byElement.clear();
    this.byName.clear();

    const bgAttr = this.backgroundAttribute();
    const scrubAttr = this.scrubAttribute();
    const selector = `${this.sceneSelector()},[${bgAttr}],[data-st-bg],[${scrubAttr}]`;
    // A browser querySelectorAll(selectorList) already returns document order.
    // Sort defensively anyway so custom DOM implementations/test doubles cannot
    // break nextScene()/previousScene() by grouping selector branches.
    const nodes = [...new Set(document.querySelectorAll(selector))];
    nodes.sort((a, b) => {
      if (a === b || typeof a?.compareDocumentPosition !== "function") return 0;
      const position = a.compareDocumentPosition(b);
      if (position & 2) return 1;  // b precedes a
      if (position & 4) return -1; // b follows a
      return 0;
    });
    nodes.forEach((element, index) => {
      const explicitName = element.getAttribute("data-st-scene");
      const name = explicitName || element.id || `scene-${index + 1}`;
      const background =
        element.getAttribute(bgAttr) ||
        element.getAttribute("data-st-bg") ||
        null;
      const scene = {
        element,
        name,
        index,
        background,
        fit: element.getAttribute("data-st-background-fit") || this.options.fit || "cover",
        position: element.getAttribute("data-st-background-position") || this.options.position || "center center",
        crossOrigin: element.getAttribute("data-st-background-crossorigin") || this.options.crossOrigin || null,
        loaded: false,
        owned: false,
        promoted: false,
        contentLayers: []
      };
      this.scenes.push(scene);
      this.byElement.set(element, scene);
      this.byName.set(name, scene);
      if (background) element.classList?.add?.("st-scene-managed");
    });
  }

  createLayer() {
    if (this.layer?.isConnected) return;
    this.layer = document.createElement("div");
    this.layer.className = "st-scene-engine";
    this.layer.setAttribute("aria-hidden", "true");
    this.layer.style.setProperty("--st-scene-z-index", String(this.options.zIndex ?? 0));
    this.layer.style.opacity = "0";
    this.layer.style.visibility = "hidden";

    this.canvas = document.createElement("canvas");
    this.canvas.className = "st-scene-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.ctx = this.canvas.getContext("2d", { alpha: true });

    this.mediaHost = document.createElement("div");
    this.mediaHost.className = "st-scene-media-host";
    this.mediaHost.setAttribute("aria-hidden", "true");

    this.layer.append(this.canvas, this.mediaHost);
    document.body.appendChild(this.layer);
  }

  supportsElement(element) {
    return !!element && this.byElement.has(element);
  }

  sceneForElement(element) {
    return this.byElement.get(element) || null;
  }

  sceneForName(name) {
    return this.byName.get(name) || null;
  }

  nextScene(element) {
    const current = this.sceneForElement(element);
    return current ? this.scenes[current.index + 1] || null : null;
  }

  previousScene(element) {
    const current = this.sceneForElement(element);
    return current ? this.scenes[current.index - 1] || null : null;
  }

  transitionNameFor(element) {
    return element?.getAttribute?.(this.scrubAttribute()) || null;
  }

  mountTransitionStage(stage) {
    if (!stage || !this.mediaHost) return false;
    if (stage.parentNode !== this.mediaHost) this.mediaHost.appendChild(stage);
    return true;
  }

  viewportSize() {
    const vv = window.visualViewport;
    return {
      width: Math.max(1, Number(vv?.width) || Number(window.innerWidth) || 1),
      height: Math.max(1, Number(vv?.height) || Number(window.innerHeight) || 1)
    };
  }

  resize() {
    if (!this.canvas || !this.ctx || this.destroyed) return;
    const { width, height } = this.viewportSize();
    const dpr = Math.min(
      Math.max(1, Number(window.devicePixelRatio) || 1),
      Math.max(1, Number(this.options.maxDpr) || 2)
    );
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.redrawCurrent();
  }

  drawCover(source, { fit = "cover", position = "center center" } = {}) {
    if (!source || !this.ctx || !this.canvas) return false;
    const sw = Number(source.videoWidth || source.naturalWidth || source.width) || 0;
    const sh = Number(source.videoHeight || source.naturalHeight || source.height) || 0;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (!sw || !sh || !cw || !ch) return false;

    if (fit === "fill") {
      this.ctx.clearRect(0, 0, cw, ch);
      this.ctx.drawImage(source, 0, 0, cw, ch);
      return true;
    }

    const scale = fit === "contain"
      ? Math.min(cw / sw, ch / sh)
      : Math.max(cw / sw, ch / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const pos = splitPosition(position);
    const dx = alignOffset(cw, dw, pos.x);
    const dy = alignOffset(ch, dh, pos.y);

    this.ctx.clearRect(0, 0, cw, ch);
    this.ctx.drawImage(source, dx, dy, dw, dh);
    return true;
  }

  redrawCurrent() {
    if (!this.currentVisual) return false;

    // A committed transition snapshot is a flattened old-viewport raster. On a
    // later viewport resize, prefer the authored scene image so cover/contain
    // and background position are recomputed from the real source asset. Until
    // that image is available, `fit: fill` keeps the exact endpoint pixels
    // continuous without double-cropping the snapshot.
    if (this.currentVisual.type === "transition-snapshot" && this.currentScene?.background) {
      const snapshot = this.currentVisual;
      const cached = this.cache.get(this.currentScene.name);
      if (cached) {
        if (this.drawCover(cached, this.currentScene)) {
          this.currentVisual = {
            source: cached,
            fit: this.currentScene.fit,
            position: this.currentScene.position,
            type: "scene"
          };
          return true;
        }
      } else {
        const scene = this.currentScene;
        this.loadScene(scene, { priority: "high" }).then((image) => {
          if (
            !image || this.destroyed || this.activeTransition ||
            this.currentScene !== scene || this.currentVisual !== snapshot
          ) return;
          if (!this.drawCover(image, scene)) return;
          this.currentVisual = { source: image, fit: scene.fit, position: scene.position, type: "scene" };
          this.activateSurfaceOwnership();
          this.setSurfaceOwnership(scene, true);
          this.markOwned(scene);
          this.showLayer();
        }).catch(() => {});
      }
    }

    return this.drawCover(this.currentVisual.source, this.currentVisual);
  }

  showLayer() {
    if (!this.layer) return;
    this.layer.style.visibility = "visible";
    this.layer.style.opacity = "1";
  }

  hideLayer() {
    if (!this.layer || this.activeTransition) return;
    this.layer.style.opacity = "0";
    this.layer.style.visibility = "hidden";
  }

  promoteContent(scene) {
    if (!scene?.element || scene.promoted) return;
    const element = scene.element;
    const candidates = [...(element.children || [])];
    const layers = candidates.length ? candidates : [element];
    scene.contentLayers = [];

    // Promote content children, not the scene root itself. This keeps the
    // authored scene background below the persistent engine while allowing
    // headings/buttons to scroll naturally above it. It also avoids turning a
    // fallback section background into a foreground layer.
    for (const layer of layers) {
      const saved = {
        element: layer,
        position: layer.style.position,
        zIndex: layer.style.zIndex
      };
      scene.contentLayers.push(saved);
      layer.classList?.add?.("st-scene-content-layer");
      layer.style?.setProperty?.("--st-scene-content-z", String(this.options.contentZIndex ?? 1));
      try {
        const computed = getComputedStyle(layer);
        if (this.options.manageContentLayer !== false && computed.position === "static") {
          layer.style.position = "relative";
        }
        if (this.options.manageContentLayer !== false && (computed.zIndex === "auto" || !computed.zIndex)) {
          layer.style.zIndex = String(this.options.contentZIndex ?? 1);
        }
      } catch (_) {}
    }
    scene.promoted = true;
  }

  activateSurfaceOwnership() {
    if (this.surfaceReady) return;
    this.surfaceReady = true;
    for (const scene of this.scenes) {
      if (!scene?.background || this.failed.has(scene.name)) continue;
      scene.element?.classList?.add?.("st-scene-surface-owned");
    }
  }

  setSurfaceOwnership(scene, owned = true) {
    if (!scene?.element || !scene.background) return;
    scene.element.classList?.toggle?.("st-scene-surface-owned", !!owned);
  }

  releaseBackgroundOwnership(scene) {
    if (!scene?.element) return;
    scene.element.classList?.remove?.("st-scene-surface-owned");
    scene.element.classList?.remove?.("st-scene-owned");
    scene.owned = false;
  }

  markOwned(scene) {
    if (!scene?.element || scene.owned) return;
    this.promoteContent(scene);
    scene.element.classList.add("st-scene-owned");
    scene.owned = true;
  }

  restoreOwned(scene) {
    if (!scene?.element) return;
    scene.element.classList.remove("st-scene-owned");
    scene.element.classList.remove("st-scene-surface-owned");
    scene.element.classList.remove("st-scene-managed");
    for (const saved of scene.contentLayers || []) {
      const layer = saved.element;
      layer?.classList?.remove?.("st-scene-content-layer");
      layer?.style?.removeProperty?.("--st-scene-content-z");
      if (layer?.style) {
        layer.style.position = saved.position;
        layer.style.zIndex = saved.zIndex;
      }
    }
    scene.contentLayers = [];
    scene.owned = false;
    scene.promoted = false;
  }

  touchCache(scene, image) {
    if (!scene || !image) return;
    this.cache.delete(scene.name);
    this.cache.set(scene.name, image);
    const max = Math.max(2, Number(this.options.cacheMax) || 4);
    const keep = new Set([this.currentScene?.name, this.wantedScene?.name].filter(Boolean));

    while (this.cache.size > max) {
      let eviction = null;
      for (const key of this.cache.keys()) {
        if (!keep.has(key)) {
          eviction = key;
          break;
        }
      }
      // At most current+wanted are protected and cacheMax is >=2, so this is
      // normally unreachable. Breaking is safer than evicting an owned visual.
      if (eviction == null) break;
      this.cache.delete(eviction);
    }
  }

  sceneFailureGate(scene) {
    const record = scene ? this.failed.get(scene.name) : null;
    if (!record) return null;
    if (record.attempts >= 3) return record.error;
    if (Date.now() < record.retryAfter) return record.error;
    return null;
  }

  recordSceneFailure(scene, error) {
    if (!scene) return;
    const previous = this.failed.get(scene.name);
    const attempts = (previous?.attempts || 0) + 1;
    const backoff = attempts === 1 ? 1000 : attempts === 2 ? 5000 : Number.POSITIVE_INFINITY;
    this.failed.set(scene.name, {
      attempts,
      retryAfter: Date.now() + backoff,
      error
    });
  }

  loadScene(scene, { priority = "auto" } = {}) {
    if (!scene?.background || this.destroyed) return Promise.resolve(null);
    if (this.cache.has(scene.name)) {
      const cached = this.cache.get(scene.name);
      this.touchCache(scene, cached);
      return Promise.resolve(cached);
    }
    if (this.inflight.has(scene.name)) return this.inflight.get(scene.name);
    if (this.sceneFailureGate(scene)) return Promise.resolve(null);

    const promise = new Promise((resolve) => {
      const image = new Image();
      if (scene.crossOrigin) image.crossOrigin = scene.crossOrigin;
      image.decoding = "async";
      try { image.fetchPriority = priority; } catch (_) {}
      image.onload = async () => {
        if (this.destroyed) return resolve(null);
        try { await image.decode?.(); } catch (_) {}
        scene.loaded = true;
        this.failed.delete(scene.name);
        this.touchCache(scene, image);
        resolve(image);
      };
      image.onerror = () => {
        const error = new Error(`Could not load scene background ${scene.background}`);
        this.recordSceneFailure(scene, error);
        resolve(null);
      };
      image.src = scene.background;
    }).finally(() => this.inflight.delete(scene.name));

    this.inflight.set(scene.name, promise);
    return promise;
  }

  preloadAround(scene) {
    if (!scene) return;
    const ahead = Math.max(0, Number(this.options.preloadAhead) || 1);
    const behind = Math.max(0, Number(this.options.preloadBehind) || 1);
    for (let offset = -behind; offset <= ahead; offset++) {
      const candidate = this.scenes[scene.index + offset];
      if (candidate?.background) {
        const priority = offset === 0 || offset === 1 ? "high" : "auto";
        this.loadScene(candidate, { priority }).catch(() => {});
      }
    }
  }

  async showScene(scene, { force = false } = {}) {
    if (!scene || this.destroyed) return false;
    this.wantedScene = scene;
    this.preloadAround(scene);

    if (!force && this.currentScene === scene && this.currentVisual) {
      this.showLayer();
      return true;
    }

    const serial = ++this.requestSerial;
    const image = await this.loadScene(scene, { priority: "high" });
    if (this.destroyed || serial !== this.requestSerial || this.wantedScene !== scene) return false;
    if (this.activeTransition) {
      const sourceScene = this.sceneForElement(this.activeTransition.section);
      // Keep the source visual underneath a transparent/contained transition.
      // A target scene requested just before scrub activation must not replace
      // that base while the transition is still travelling.
      if (scene !== sourceScene) return false;
    }
    if (!image) {
      // Fail open for this scene only. Once the persistent surface is active,
      // managed scene roots are transparent so they cannot cover the canvas.
      // If this particular authored background is unavailable, restore that
      // section's own styling rather than exposing an empty surface.
      this.releaseBackgroundOwnership(scene);
      if (this.currentScene !== scene && !this.currentVisual) this.hideLayer();
      return false;
    }

    if (!this.drawCover(image, scene)) return false;
    this.currentScene = scene;
    this.currentVisual = { source: image, fit: scene.fit, position: scene.position, type: "scene" };
    this.activateSurfaceOwnership();
    this.setSurfaceOwnership(scene, true);
    this.markOwned(scene);
    this.showLayer();
    return true;
  }

  visualElementFor(runtime) {
    return runtime?.renderer?.getVisualElement?.() ||
      runtime?.renderer?.canvas ||
      runtime?.renderer?.activeVideo ||
      runtime?.renderer?.video ||
      null;
  }

  beginTransition(runtime) {
    if (!runtime || this.destroyed) return;
    this.activeTransition = runtime;
    const sourceScene = this.sceneForElement(runtime.section);
    if (sourceScene) {
      this.wantedScene = sourceScene;
      this.requestSerial += 1; // invalidate a pending target/static switch
      if (sourceScene.background && !this.cache.has(sourceScene.name)) {
        this.loadScene(sourceScene, { priority: "high" }).then((image) => {
          if (!image || this.destroyed || this.activeTransition !== runtime) return;
          // Only establish the base if no valid visual is already retained.
          if (!this.currentVisual) {
            this.drawCover(image, sourceScene);
            this.currentVisual = { source: image, fit: sourceScene.fit, position: sourceScene.position, type: "scene" };
            this.currentScene = sourceScene;
            this.activateSurfaceOwnership();
            this.setSurfaceOwnership(sourceScene, true);
            this.markOwned(sourceScene);
          }
        }).catch(() => {});
      }
    }
    const targetScene = this.sceneForElement(runtime.targetSection?.());
    if (targetScene?.background) this.loadScene(targetScene, { priority: "high" }).catch(() => {});
    this.showLayer();
  }

  /**
   * Commit the exact transition endpoint to the persistent canvas before the
   * transition surface disappears. This removes the overlay/background handoff
   * entirely; the last transition frame simply becomes the scene background.
   */
  commitTransition(runtime, progress) {
    if (!runtime || this.destroyed) return false;
    const forward = progress >= 0.5;
    const scene = forward
      ? this.sceneForElement(runtime.targetSection?.())
      : this.sceneForElement(runtime.section);
    const visual = this.visualElementFor(runtime);
    if (scene) this.wantedScene = scene;
    this.requestSerial += 1;
    let committed = false;

    if (visual) {
      try {
        committed = this.drawCover(visual, {
          fit: runtime.config.render?.fit || "cover",
          position: runtime.config.render?.position || "center center"
        });
      } catch (_) {
        committed = false;
      }
    }

    if (committed) {
      // Preserve the endpoint across visualViewport/canvas backing-store resizes.
      const snapshot = document.createElement("canvas");
      snapshot.width = this.canvas.width;
      snapshot.height = this.canvas.height;
      const snapshotCtx = snapshot.getContext("2d", { alpha: true });
      try {
        snapshotCtx?.drawImage(this.canvas, 0, 0);
        // The snapshot is already a fully composed viewport raster. Reapplying
        // cover/contain on resize would crop it a second time; stretch the
        // snapshot only as a temporary continuity surface, then hydrate the
        // authored target scene image (with its own fit/position) when available.
        this.currentVisual = { source: snapshot, fit: "fill", position: "center center", type: "transition-snapshot" };
      } catch (_) {
        this.currentVisual = null;
      }
      this.currentScene = scene || this.currentScene;
      this.activateSurfaceOwnership();
      if (scene) {
        this.setSurfaceOwnership(scene, true);
        this.markOwned(scene);
      }
      this.showLayer();
    } else if (scene) {
      this.showScene(scene, { force: true }).catch(() => {});
    }

    this.activeTransition = null;

    return committed;
  }

  cancelTransition(runtime) {
    if (this.activeTransition === runtime) this.activeTransition = null;
  }

  sceneAtViewport(scrollY = window.scrollY) {
    if (!this.scenes.length) return null;
    const viewport = this.viewportSize().height;
    const probe = scrollY + viewport * 0.5;
    let nearest = null;
    let nearestDistance = Infinity;

    for (const scene of this.scenes) {
      const rect = scene.element?.getBoundingClientRect?.();
      if (!rect) continue;
      const top = scrollY + Number(rect.top || 0);
      const bottom = scrollY + Number(rect.bottom || 0);
      if (probe >= top && probe < bottom) return scene;
      const distance = Math.min(Math.abs(probe - top), Math.abs(probe - bottom));
      if (distance < nearestDistance && rect.bottom > 0 && rect.top < viewport) {
        nearest = scene;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  update(scrollY = window.scrollY) {
    if (this.destroyed || this.activeTransition) return;
    const scene = this.sceneAtViewport(scrollY);
    if (!scene) {
      this.wantedScene = null;
      this.hideLayer();
      return;
    }
    if (scene === this.currentScene && this.currentVisual) {
      this.preloadAround(scene);
      this.showLayer();
      return;
    }
    this.showScene(scene).catch(() => {});
  }

  diagnostic() {
    return {
      enabled: !!this.layer,
      surfaceReady: this.surfaceReady,
      scenes: this.scenes.map((scene) => ({
        name: scene.name,
        background: scene.background,
        loaded: scene.loaded,
        owned: scene.owned
      })),
      currentScene: this.currentScene?.name || null,
      wantedScene: this.wantedScene?.name || null,
      activeTransition: this.activeTransition?.name || null,
      cacheSize: this.cache.size,
      failedBackgrounds: [...this.failed.entries()].map(([name, record]) => ({
        name,
        attempts: record.attempts,
        retryAfter: Number.isFinite(record.retryAfter) ? record.retryAfter : null
      }))
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scenes.forEach((scene) => this.restoreOwned(scene));
    this.layer?.remove?.();
    this.scenes = [];
    this.byElement.clear();
    this.byName.clear();
    this.cache.clear();
    this.inflight.clear();
    this.failed.clear();
    this.layer = null;
    this.canvas = null;
    this.ctx = null;
    this.mediaHost = null;
    this.currentVisual = null;
    this.currentScene = null;
    this.surfaceReady = false;
    this.activeTransition = null;
  }
}



/* ===== src/assets/FrameCache.js ===== */
/**
 * Bounded LRU cache for decoded image frames.
 *
 * This is the key memory-safety mechanism. Full-HD images may consume several
 * MB each after decoding, regardless of compressed WebP/AVIF file size.
 */
class FrameCache {
  constructor(maxFrames = 24) {
    this.maxFrames = Math.max(2, maxFrames);
    this.map = new Map();
  }

  has(index) {
    return this.map.has(index);
  }

  get(index) {
    const item = this.map.get(index);
    if (!item) return null;

    // Move to end = most recently used.
    this.map.delete(index);
    this.map.set(index, item);
    return item;
  }

  set(index, frame) {
    if (this.map.has(index)) {
      this.dispose(this.map.get(index));
      this.map.delete(index);
    }

    this.map.set(index, frame);
    this.evict();
  }

  evict() {
    while (this.map.size > this.maxFrames) {
      const oldestKey = this.map.keys().next().value;
      const oldest = this.map.get(oldestKey);
      this.map.delete(oldestKey);
      this.dispose(oldest);
    }
  }

  dispose(frame) {
    // ImageBitmap supports explicit memory release.
    if (frame && typeof frame.close === "function") {
      try { frame.close(); } catch (_) {}
    }
  }

  clear() {
    for (const frame of this.map.values()) this.dispose(frame);
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}



/* ===== src/assets/AssetManager.js ===== */


const PRIORITY = Object.freeze({
  requested: 0,
  predictive: 1,
  critical: 2,
  nearby: 3,
  progressive: 4,
  normal: 5
});

function abortError(message = "Aborted") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function isSameOriginUrl(url) {
  try {
    const base = globalThis.document?.baseURI || globalThis.location?.href || "http://localhost/";
    const parsed = new URL(url, base);
    const baseUrl = new URL(base);
    return parsed.origin === baseUrl.origin;
  } catch (_) {
    return true;
  }
}

class AssetManager {
  constructor(source, config, hooks = {}) {
    this.source = source;
    this.config = config;
    this.hooks = hooks;
    this.cache = new FrameCache(config.cache.maxFrames);
    this.inflight = new Map(); // queued + active promises, keyed by frame index
    this.failed = new Map();
    this.loadedEver = new Set();
    this.idleIds = new Set();
    this.controllers = new Map();
    this.queue = [];
    this.queuedJobs = new Map();
    this.activeJobs = new Map();
    this.activeCount = 0;
    this.sequence = 0;
    this.destroyed = false;
  }

  frameUrl(index) {
    const src = this.source.src;

    if (Array.isArray(src)) return src[index];

    const start = this.source.start ?? 1;
    const padding = this.source.padding ?? 4;
    const token = String(start + index).padStart(padding, "0");
    return src.replace("{frame}", token);
  }

  requestTimeout() {
    return Math.max(1000, Number(this.config.loading?.timeout) || 8000);
  }

  async decodeUrl(url, signal) {
    const sameOrigin = isSameOriginUrl(url);
    // Fetch+ImageBitmap is excellent for same-origin assets and explicit CORS
    // sources. For an arbitrary cross-origin CDN without CORS intent, skip the
    // fetch attempt entirely and go straight to <img>; `no-cors` responses are
    // opaque and cannot provide a useful blob for createImageBitmap anyway.
    const preferBitmap =
      this.config.cache.useImageBitmap &&
      typeof createImageBitmap === "function" &&
      typeof fetch === "function" &&
      (sameOrigin || !!this.source.crossOrigin);

    if (preferBitmap) {
      try {
        const response = await fetch(url, {
          mode: sameOrigin ? "same-origin" : "cors",
          credentials: this.source.crossOrigin === "use-credentials" ? "include" : "same-origin",
          signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (signal?.aborted) throw abortError();
        return await createImageBitmap(blob);
      } catch (error) {
        if (error?.name === "AbortError" || signal?.aborted) throw error;
        // Cross-origin servers frequently omit CORS. Fall back to Image so
        // public/CDN assets still work if the browser permits image display.
        this.hooks.debug?.("ImageBitmap path failed, using Image fallback", { url, error });
      }
    }

    return await new Promise((resolve, reject) => {
      const img = new Image();
      let settled = false;
      const timeout = setTimeout(() => finish(reject, new Error(`Timed out loading image ${url}`)), this.requestTimeout());

      const cleanup = () => {
        clearTimeout(timeout);
        img.onload = null;
        img.onerror = null;
        signal?.removeEventListener?.("abort", onAbort);
      };

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };

      const onAbort = () => {
        try { img.src = ""; } catch (_) {}
        finish(reject, abortError());
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }

      signal?.addEventListener?.("abort", onAbort, { once: true });
      if (this.source.crossOrigin) img.crossOrigin = this.source.crossOrigin;
      img.onload = () => finish(resolve, img);
      img.onerror = () => finish(reject, new Error(`Could not load image ${url}`));
      img.src = url;
    });
  }

  failureGate(index) {
    const record = this.failed.get(index);
    if (!record) return null;

    const now = Date.now();
    if (record.attempts >= 3) return record.error;
    if (now < record.retryAfter) return record.error;
    return null;
  }

  recordFailure(index, error) {
    const previous = this.failed.get(index);
    const attempts = (previous?.attempts || 0) + 1;
    const backoff = attempts === 1 ? 1000 : attempts === 2 ? 5000 : Number.POSITIVE_INFINITY;
    this.failed.set(index, {
      attempts,
      retryAfter: Date.now() + backoff,
      error
    });
  }

  load(index, priority = "normal") {
    if (this.destroyed) return Promise.reject(abortError("AssetManager destroyed"));

    index = clamp(index, 0, this.source.count - 1);

    const cached = this.cache.get(index);
    if (cached) return Promise.resolve(cached);

    if (this.inflight.has(index)) {
      // A fast fling may turn a formerly-low-priority nearby request into the
      // exact frame the user needs now. Promote queued work in place instead of
      // enqueueing a duplicate request. Active requests are left alone.
      const queued = this.queuedJobs.get(index);
      const nextRank = PRIORITY[priority] ?? PRIORITY.normal;
      if (queued && nextRank < queued.rank) {
        queued.priority = priority;
        queued.rank = nextRank;
        this.pump();
      }
      return this.inflight.get(index);
    }

    const gatedError = this.failureGate(index);
    if (gatedError) return Promise.reject(gatedError);

    let resolveJob;
    let rejectJob;
    const promise = new Promise((resolve, reject) => {
      resolveJob = resolve;
      rejectJob = reject;
    });

    this.inflight.set(index, promise);
    const job = {
      index,
      priority,
      rank: PRIORITY[priority] ?? PRIORITY.normal,
      sequence: this.sequence++,
      resolve: resolveJob,
      reject: rejectJob
    };
    this.queue.push(job);
    this.queuedJobs.set(index, job);
    this.pump();

    return promise;
  }

  motionConfig() {
    return this.config.preload?.motion || {};
  }

  motionTier(velocity = 0) {
    const cfg = this.motionConfig();
    const speed = Math.abs(Number(velocity) || 0);
    const medium = Math.max(1, Number(cfg.mediumVelocity) || 900);
    const fast = Math.max(medium, Number(cfg.fastVelocity) || 1800);
    const extreme = Math.max(fast, Number(cfg.extremeVelocity) || 2800);
    if (speed >= extreme) return 3;
    if (speed >= fast) return 2;
    if (speed >= medium) return 1;
    return 0;
  }

  cancelQueued(job, reason = "Superseded") {
    if (!job || !this.queuedJobs.has(job.index)) return false;
    const pos = this.queue.indexOf(job);
    if (pos >= 0) this.queue.splice(pos, 1);
    this.queuedJobs.delete(job.index);
    this.inflight.delete(job.index);
    job.reject(abortError(reason));
    return true;
  }

  pruneMotionQueue(targetIndex, projectedIndex, direction, keepSet = new Set()) {
    const cfg = this.motionConfig();
    if (cfg.pruneStale === false) return 0;

    const radius = Math.max(3, Number(cfg.keepRadius) || Math.max(6, this.config.preload?.ahead || 12));
    const lo = Math.max(0, Math.min(targetIndex, projectedIndex) - radius);
    const hi = Math.min(this.source.count - 1, Math.max(targetIndex, projectedIndex) + radius);
    let removed = 0;

    for (const job of [...this.queue]) {
      // Exact requested frames are never discarded. Startup critical safety
      // frames are lower priority than interaction, but remain queued so a
      // fast fling cannot destroy the coarse fallback skeleton entirely.
      if (job.priority === "critical" || job.rank <= PRIORITY.requested || keepSet.has(job.index)) continue;
      const inWindow = job.index >= lo && job.index <= hi;
      const directionallyUseful = direction > 0
        ? job.index >= targetIndex - 1
        : direction < 0
          ? job.index <= targetIndex + 1
          : true;
      if (inWindow && directionallyUseful) continue;
      if (this.cancelQueued(job, "Superseded by fast scroll")) removed++;
    }
    return removed;
  }

  preemptStaleActive(targetIndex, direction, velocity, keepSet = new Set()) {
    const cfg = this.motionConfig();
    if (cfg.preemptStale === false || this.motionTier(velocity) < 3) return false;
    const maxConcurrent = Math.max(1, this.config.preload.maxConcurrent || 4);
    if (this.activeCount < maxConcurrent || !this.queuedJobs.has(targetIndex)) return false;

    const staleDistance = Math.max(8, Number(cfg.preemptDistance) || Math.max(12, this.config.preload?.ahead || 12));
    let candidate = null;
    let candidateDistance = -1;
    for (const active of this.activeJobs.values()) {
      const job = active.job;
      if (!job || job.rank < PRIORITY.critical || keepSet.has(job.index)) continue;
      const distance = Math.abs(job.index - targetIndex);
      const lowPriority = job.rank >= PRIORITY.nearby;
      const veryStaleCritical = job.priority === "critical" && distance > staleDistance * 2;
      if (!lowPriority && !veryStaleCritical) continue;
      const behind = direction > 0
        ? job.index < targetIndex - staleDistance
        : direction < 0
          ? job.index > targetIndex + staleDistance
          : distance > staleDistance;
      if (!behind || distance <= candidateDistance) continue;
      candidate = active;
      candidateDistance = distance;
    }

    if (!candidate?.controller) return false;
    try { candidate.controller.abort(); } catch (_) { return false; }
    return true;
  }

  scheduleMotion(index, motion = {}) {
    if (this.destroyed) return;
    index = clamp(Math.round(index), 0, this.source.count - 1);
    const cfg = this.motionConfig();
    if (cfg.enabled === false) {
      this.load(index, "requested").catch(() => {});
      this.preloadNearby(index);
      return;
    }

    const direction = Number(motion.direction) < 0 ? -1 : 1;
    const velocity = Number(motion.velocity) || 0;
    const tier = this.motionTier(velocity);
    const projectedIndex = clamp(
      Math.round(Number.isFinite(motion.projectedIndex) ? motion.projectedIndex : index),
      0,
      this.source.count - 1
    );
    const keep = new Set([index, projectedIndex]);

    // Exact current visual always wins. The projected destination is next.
    this.load(index, "requested").catch(() => {});

    if (tier > 0 && projectedIndex !== index) {
      const anchors = tier >= 2 ? 3 : 2;
      for (let n = 1; n <= anchors; n++) {
        const anchor = clamp(
          Math.round(index + ((projectedIndex - index) * n) / anchors),
          0,
          this.source.count - 1
        );
        keep.add(anchor);
        if (!this.cache.has(anchor)) this.load(anchor, "predictive").catch(() => {});
      }

      // Keep one sparse safety frame near the predicted landing warm. Critical
      // indexes are already evenly distributed through the sequence.
      const safety = this.criticalIndexes()
        .sort((a, b) => Math.abs(a - projectedIndex) - Math.abs(b - projectedIndex))[0];
      if (Number.isInteger(safety)) {
        keep.add(safety);
        if (!this.cache.has(safety)) this.load(safety, "predictive").catch(() => {});
      }
    }

    if (tier >= 2) this.pruneMotionQueue(index, projectedIndex, direction, keep);
    if (tier >= 3) this.preemptStaleActive(index, direction, velocity, keep);

    if (tier === 0) this.preloadNearby(index);
    else {
      // A small directional halo improves continuity without refilling the queue
      // with every skipped intermediate frame.
      const halo = tier === 1 ? 3 : 2;
      for (let n = 1; n <= halo; n++) {
        const i = clamp(index + direction * n, 0, this.source.count - 1);
        keep.add(i);
        if (!this.cache.has(i)) this.load(i, "nearby").catch(() => {});
      }
    }
  }

  pump() {
    if (this.destroyed) return;
    const maxConcurrent = Math.max(1, this.config.preload.maxConcurrent || 4);

    if (this.queue.length > 1) {
      this.queue.sort((a, b) => a.rank - b.rank || a.sequence - b.sequence);
    }

    while (this.activeCount < maxConcurrent && this.queue.length) {
      const job = this.queue.shift();
      this.queuedJobs.delete(job.index);
      this.execute(job);
    }
  }

  async execute(job) {
    if (this.destroyed) {
      this.inflight.delete(job.index);
      job.reject(abortError("AssetManager destroyed"));
      return;
    }

    this.activeCount += 1;
    const url = this.frameUrl(job.index);
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    this.controllers.set(job.index, controller);
    this.activeJobs.set(job.index, { job, controller });
    let timedOut = false;
    const requestTimer = controller
      ? setTimeout(() => {
          timedOut = true;
          try { controller.abort(); } catch (_) {}
        }, this.requestTimeout())
      : 0;

    try {
      const frame = await this.decodeUrl(url, controller?.signal);
      if (this.destroyed) {
        if (typeof frame?.close === "function") frame.close();
        throw abortError("AssetManager destroyed");
      }

      this.cache.set(job.index, frame);
      this.loadedEver.add(job.index);
      this.failed.delete(job.index);
      this.hooks.onFrameLoaded?.(job.index);
      job.resolve(frame);
    } catch (error) {
      if (timedOut && !this.destroyed) {
        error = new Error(`Timed out loading image ${url}`);
      }
      if (error?.name !== "AbortError" && !this.destroyed) {
        this.recordFailure(job.index, error);
        this.hooks.onFrameError?.(error, {
          index: job.index,
          url,
          priority: job.priority,
          attempts: this.failed.get(job.index)?.attempts || 1
        });
      }
      job.reject(error);
    } finally {
      if (requestTimer) clearTimeout(requestTimer);
      this.controllers.delete(job.index);
      this.activeJobs.delete(job.index);
      this.inflight.delete(job.index);
      this.activeCount = Math.max(0, this.activeCount - 1);
      this.pump();
    }
  }

  /**
   * Critical frames are spread across the entire animation instead of simply
   * taking frames 0..N. This means auto playback degrades more gracefully if
   * the user reaches the transition before every intermediate frame is ready.
   */
  criticalIndexes() {
    const count = this.source.count;
    const range = this.config.playback?.range || { start: 0, end: 1 };
    const first = Math.round(clamp(range.start) * (count - 1));
    const last = Math.round(clamp(range.end) * (count - 1));
    const available = Math.max(1, last - first + 1);
    const desired = Math.min(
      available,
      Math.max(2, this.config.preload.readyFrames || 8)
    );

    const indexes = new Set([first, last]);

    let segments = 2;
    while (indexes.size < desired) {
      for (let i = 1; i < segments && indexes.size < desired; i += 2) {
        indexes.add(Math.round(first + (i / segments) * (last - first)));
      }
      segments *= 2;
    }

    return [...indexes].sort((a, b) => a - b);
  }

  async prepareCritical() {
    const indexes = this.criticalIndexes();
    const results = await Promise.allSettled(
      indexes.map((i) => this.load(i, "critical"))
    );

    const ok = results.filter((r) => r.status === "fulfilled" && r.value).length;
    return ok === indexes.length;
  }

  preloadNearby(index) {
    const { ahead, behind } = this.config.preload;
    const from = Math.max(0, index - behind);
    const to = Math.min(this.source.count - 1, index + ahead);

    const candidates = [];
    for (let i = from; i <= to; i++) candidates.push(i);
    candidates.sort((a, b) => Math.abs(a - index) - Math.abs(b - index));

    for (const i of candidates) {
      if (!this.cache.has(i) && !this.inflight.has(i)) {
        this.load(i, "nearby").catch(() => {});
      }
    }
  }

  progressivePreload() {
    let index = 0;
    const batchSize = Math.max(1, this.config.preload.maxConcurrent || 4);

    const pumpBatch = () => {
      if (this.destroyed || index >= this.source.count) return;

      const batch = [];
      while (index < this.source.count && batch.length < batchSize) {
        const i = index++;
        if (!this.cache.has(i) && !this.inflight.has(i)) {
          batch.push(this.load(i, "progressive").catch(() => null));
        }
      }

      Promise.allSettled(batch).finally(() => {
        if (this.destroyed || index >= this.source.count) return;
        const id = idle(() => {
          this.idleIds.delete(id);
          pumpBatch();
        });
        this.idleIds.add(id);
      });
    };

    pumpBatch();
  }

  async get(index) {
    index = clamp(index, 0, this.source.count - 1);
    const cached = this.cache.get(index);
    if (cached) return cached;
    return await this.load(index, "requested");
  }

  nearestCached(index) {
    if (!this.cache.size) return null;

    for (let radius = 0; radius < this.source.count; radius++) {
      const left = index - radius;
      const right = index + radius;
      if (left >= 0) {
        const item = this.cache.get(left);
        if (item) return { index: left, frame: item };
      }
      if (right < this.source.count) {
        const item = this.cache.get(right);
        if (item) return { index: right, frame: item };
      }
    }

    return null;
  }

  bestCached(index, options = {}) {
    const nearest = this.nearestCached(index);
    if (!nearest || !options.preferMovement || !options.direction) return nearest;

    const direction = options.direction < 0 ? -1 : 1;
    const paintedIndex = Number.isInteger(options.paintedIndex) ? options.paintedIndex : null;
    const maxLead = Math.max(2, Number(options.maxLead) || 8);

    // When the nearest frame is simply the one already on screen, a fast fling
    // looks frozen. If a directionally-correct predictive frame is available
    // within a modest lead window, advance to it instead of holding stale pixels.
    if (paintedIndex == null || nearest.index !== paintedIndex) return nearest;
    for (let distance = 1; distance <= maxLead; distance++) {
      const candidateIndex = index + direction * distance;
      if (candidateIndex < 0 || candidateIndex >= this.source.count) break;
      const frame = this.cache.get(candidateIndex);
      if (frame) return { index: candidateIndex, frame };
    }
    return nearest;
  }

  readiness() {
    const critical = this.criticalIndexes();
    const loaded = critical.filter((i) => this.loadedEver.has(i)).length;
    return {
      loaded,
      total: critical.length,
      ratio: critical.length ? loaded / critical.length : 1,
      cacheSize: this.cache.size,
      failed: this.failed.size,
      queued: this.queue.length,
      active: this.activeCount,
      queuedIndexes: this.queue.slice(0, 12).map((job) => job.index)
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    for (const id of this.idleIds) cancelIdle(id);
    this.idleIds.clear();

    for (const controller of this.controllers.values()) {
      try { controller?.abort?.(); } catch (_) {}
    }
    this.controllers.clear();
    this.activeJobs.clear();

    const error = abortError("AssetManager destroyed");
    for (const job of this.queue.splice(0)) {
      this.queuedJobs.delete(job.index);
      this.inflight.delete(job.index);
      job.reject(error);
    }
    this.queuedJobs.clear();

    this.cache.clear();
    this.failed.clear();
    this.loadedEver.clear();
  }
}



/* ===== src/renderers/SequenceRenderer.js ===== */


function parsePosition(position) {
  const [x = "center", y = "center"] = String(position || "center center").split(/\s+/);
  return { x, y };
}

function offset(container, content, align) {
  if (align === "left" || align === "top") return 0;
  if (align === "right" || align === "bottom") return container - content;
  return (container - content) / 2;
}

class SequenceRenderer {
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



/* ===== src/renderers/VideoRenderer.js ===== */

class VideoRenderer {
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



/* ===== src/input/GestureDetector.js ===== */
class GestureDetector {
  constructor(config) {
    this.config = config;
    this.value = 0;
    this.direction = 0;
    this.lastAt = 0;
    this.cooldownUntil = 0;
  }

  push(delta) {
    const now = performance.now();
    const direction = delta > 0 ? 1 : -1;

    if (now < this.cooldownUntil) return { triggered: false, direction };

    if (now - this.lastAt > this.config.input.gestureTimeout || direction !== this.direction) {
      this.value = 0;
    }

    this.direction = direction;
    this.lastAt = now;
    this.value += Math.abs(delta);

    const threshold = Math.max(1, this.config.scroll.triggerThreshold || 24);
    if (this.value >= threshold) {
      this.value = 0;
      this.cooldownUntil = now + this.config.input.momentumCooldown;
      return { triggered: true, direction };
    }

    return { triggered: false, direction };
  }

  reset() {
    this.value = 0;
    this.direction = 0;
  }
}



/* ===== src/input/ScrollLockManager.js ===== */
/**
 * Locks document scrolling without moving <body> into position:fixed.
 *
 * The old body-fixed strategy can invalidate sticky/snap/page-builder layout
 * calculations and is a common cause of text jumping/disappearing during a
 * fullscreen transition. Overflow locking keeps the document at its real
 * scroll position while wheel/touch/keyboard capture blocks user movement.
 */
class ScrollLockManager {
  constructor() {
    this.locked = false;
    this.owner = null;
    this.scrollY = 0;
    this.snapshot = null;
  }

  lock(owner = null) {
    if (this.locked) return this.owner === owner;

    this.locked = true;
    this.owner = owner;
    this.scrollY = window.scrollY;

    const root = document.documentElement;
    const body = document.body;
    const scrollbarWidth = window.innerWidth - root.clientWidth;
    const computedPaddingRight = parseFloat(getComputedStyle(body).paddingRight) || 0;

    this.snapshot = {
      rootOverflow: root.style.overflow,
      rootOverscroll: root.style.overscrollBehavior,
      rootScrollBehavior: root.style.scrollBehavior,
      rootSnapType: root.style.scrollSnapType,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
      bodyScrollBehavior: body.style.scrollBehavior,
      bodySnapType: body.style.scrollSnapType,
      bodyPaddingRight: body.style.paddingRight
    };

    // Disable native snap/smooth movement while the transition owns navigation.
    root.style.scrollBehavior = "auto";
    body.style.scrollBehavior = "auto";
    root.style.scrollSnapType = "none";
    body.style.scrollSnapType = "none";
    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";

    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${computedPaddingRight + scrollbarWidth}px`;
    }

    // Some browsers adjust the viewport when overflow changes. Reassert the
    // exact position while snap is disabled.
    window.scrollTo({ top: this.scrollY, behavior: "auto" });
    return true;
  }

  unlock(targetY = this.scrollY, owner = null) {
    if (!this.locked) return false;
    if (owner && this.owner && owner !== this.owner) return false;

    const root = document.documentElement;
    const body = document.body;
    const snapshot = this.snapshot || {};
    const y = Math.max(0, targetY);

    // Move behind the still-visible transition stage while snap is disabled.
    window.scrollTo({ top: y, behavior: "auto" });

    root.style.overflow = snapshot.rootOverflow || "";
    root.style.overscrollBehavior = snapshot.rootOverscroll || "";
    body.style.overflow = snapshot.bodyOverflow || "";
    body.style.overscrollBehavior = snapshot.bodyOverscroll || "";
    body.style.paddingRight = snapshot.bodyPaddingRight || "";

    // Reassert after overflow restoration, then restore native snap behavior.
    window.scrollTo({ top: y, behavior: "auto" });
    root.style.scrollBehavior = snapshot.rootScrollBehavior || "";
    body.style.scrollBehavior = snapshot.bodyScrollBehavior || "";
    root.style.scrollSnapType = snapshot.rootSnapType || "";
    body.style.scrollSnapType = snapshot.bodySnapType || "";

    this.locked = false;
    this.owner = null;
    this.snapshot = null;
    return true;
  }
}



/* ===== src/input/InputManager.js ===== */

class InputManager {
  constructor(manager, config) {
    this.manager = manager;
    this.config = config;
    this.touchY = null;

    this.onWheel = this.onWheel.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  hasInput(type) {
    return this.manager.runtimes.some(
      (runtime) => runtime.usesTakeover?.() && runtime.config.input?.[type] !== false
    );
  }

  attach() {
    if (this.hasInput("wheel")) {
      window.addEventListener("wheel", this.onWheel, { passive: false });
    }
    if (this.hasInput("touch")) {
      window.addEventListener("touchstart", this.onTouchStart, { passive: true });
      window.addEventListener("touchmove", this.onTouchMove, { passive: false });
    }
    if (this.hasInput("keyboard")) {
      window.addEventListener("keydown", this.onKeyDown, { passive: false });
    }
  }

  detach() {
    window.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("touchstart", this.onTouchStart);
    window.removeEventListener("touchmove", this.onTouchMove);
    window.removeEventListener("keydown", this.onKeyDown);
  }

  handleDelta(delta, event, inputType) {
    if (!delta) return;
    const direction = delta > 0 ? 1 : -1;

    const runtime = this.manager.findAutoRuntimeForIntent(direction, delta, inputType);
    if (!runtime) return;

    // At an active auto boundary, browser-native movement is intentionally
    // captured. Everywhere else, scrolling remains untouched.
    event.preventDefault();

    if (runtime.isAutoPlaying()) return;

    const result = runtime.pushGesture(delta);
    if (result?.triggered) {
      runtime.requestAuto(result.direction);
    }
  }

  onWheel(event) {
    this.handleDelta(normalizeWheel(event), event, "wheel");
  }

  onTouchStart(event) {
    if (event.touches?.length) this.touchY = event.touches[0].clientY;
  }

  onTouchMove(event) {
    if (this.touchY == null || !event.touches?.length) return;
    const y = event.touches[0].clientY;
    const delta = this.touchY - y;
    this.touchY = y;
    this.handleDelta(delta, event, "touch");
  }

  onKeyDown(event) {
    // Do not hijack typing, controls, editable elements, or modifier shortcuts.
    const target = event.target;
    if (
      target?.isContentEditable ||
      /INPUT|TEXTAREA|SELECT|BUTTON/.test(target?.tagName || "") ||
      event.ctrlKey || event.metaKey || event.altKey
    ) {
      return;
    }

    let direction = 0;
    if (["ArrowDown", "PageDown", " "].includes(event.key) && !event.shiftKey) direction = 1;
    if (["ArrowUp", "PageUp"].includes(event.key) || (event.key === " " && event.shiftKey)) direction = -1;
    if (!direction) return;

    const runtime = this.manager.findAutoRuntimeForIntent(direction, direction * 9999, "keyboard");
    if (!runtime) return;

    event.preventDefault();
    if (!runtime.isAutoPlaying()) runtime.requestAuto(direction);
  }
}



/* ===== src/drivers/ScrubDriver.js ===== */

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
class ScrubDriver {
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



/* ===== src/drivers/ScrollTriggerDriver.js ===== */



/**
 * Primary v0.6 scroll driver.
 *
 * ScrollTrigger owns scroll measurement, refresh, scrub smoothing, direction and
 * snapping. SectionTransition only consumes normalized progress to render media
 * and maintain persistent scene-background ownership.
 */
class ScrollTriggerDriver {
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



/* ===== src/drivers/SnapGlideController.js ===== */

/**
 * One-phase section navigation for scroll.mode="snap".
 *
 * ScrollTrigger continues to own progress/media mapping. Observer only claims a
 * wheel/touch gesture when the viewport is already at an eligible transition
 * boundary, then one GSAP tween moves the real document scroll position from
 * that boundary to the adjacent one. This avoids native/CSS momentum settling
 * followed by a second ScrollTrigger snap animation.
 */
class SnapGlideController {
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



/* ===== src/drivers/TakeoverDriver.js ===== */


class TakeoverDriver {
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



/* ===== src/core/ContentAnimator.js ===== */

const PASSIVE_EFFECTS = new Set(["native", "none"]);

function readInline(style, property) {
  if (!style) return "";
  if (typeof style.getPropertyValue === "function") {
    return style.getPropertyValue(property) || "";
  }
  const camel = property.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  return style[camel] || "";
}

function writeInline(style, property, value) {
  if (!style) return;
  if (typeof style.setProperty === "function") {
    style.setProperty(property, value);
    return;
  }
  const camel = property.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  style[camel] = value;
}

function restoreInline(style, property, value) {
  if (!style) return;
  if (value) {
    writeInline(style, property, value);
  } else if (typeof style.removeProperty === "function") {
    style.removeProperty(property);
  } else {
    const camel = property.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    style[camel] = "";
  }
}

class ContentAnimator {
  constructor(runtime) {
    this.runtime = runtime;
    this.direction = 1;
    this.leaveRecords = [];
    this.enterRecords = [];
    this.viewportObserver = null;
    this.animationToken = 0;
    this.viewportAnimating = false;
  }

  rule(kind) {
    return this.runtime.config.content?.[kind] || {};
  }

  enabled(rule) {
    return !!rule && !PASSIVE_EFFECTS.has(rule.effect || "native");
  }

  resolvedEnterTrigger() {
    const configured = this.rule("enter").trigger || "auto";
    if (configured !== "auto") return configured;
    return ["auto", "takeover"].includes(this.runtime.config.scroll.mode) ? "handoff" : "viewport";
  }

  init() {
    if (this.runtime.reducedMotion) return;

    if (this.runtime.config.scroll.mode === "scrub" && this.enabled(this.rule("leave"))) {
      this.prepareLeave(1);
      this.updateProgress(this.runtime.progress);
    }

    if (this.enabled(this.rule("enter")) && this.resolvedEnterTrigger() === "viewport") {
      this.installViewportEnter();
    }
  }

  leavingSection(direction = this.direction) {
    return direction > 0 ? this.runtime.section : this.runtime.targetSection();
  }

  enteringSection(direction = this.direction) {
    return direction > 0 ? this.runtime.targetSection() : this.runtime.section;
  }

  query(section, rule, kind) {
    if (!section || !this.enabled(rule)) return [];
    const selector = rule.selector;
    if (selector === "self") return [section];
    if (!selector || typeof section.querySelectorAll !== "function") return [];

    try {
      return Array.from(section.querySelectorAll(selector));
    } catch (error) {
      this.runtime.reportError(error, { phase: "content-selector", kind, selector });
      return [];
    }
  }

  snapshot(element) {
    const style = element?.style;
    let baseOpacity = Number.parseFloat(readInline(style, "opacity"));

    if (!Number.isFinite(baseOpacity) && typeof getComputedStyle === "function") {
      try {
        baseOpacity = Number.parseFloat(getComputedStyle(element).opacity);
      } catch (_) {}
    }
    if (!Number.isFinite(baseOpacity)) baseOpacity = 1;

    return {
      element,
      baseOpacity,
      inline: {
        opacity: readInline(style, "opacity"),
        translate: readInline(style, "translate"),
        scale: readInline(style, "scale"),
        transition: readInline(style, "transition"),
        willChange: readInline(style, "will-change")
      }
    };
  }

  prepareRecords(section, rule, kind) {
    return this.query(section, rule, kind).map((element) => {
      const record = this.snapshot(element);
      writeInline(element.style, "transition", "none");
      writeInline(element.style, "will-change", "opacity, translate, scale");
      return record;
    });
  }

  restoreRecords(records) {
    for (const record of records || []) {
      const style = record.element?.style;
      if (!style) continue;
      restoreInline(style, "opacity", record.inline.opacity);
      restoreInline(style, "translate", record.inline.translate);
      restoreInline(style, "scale", record.inline.scale);
      restoreInline(style, "transition", record.inline.transition);
      restoreInline(style, "will-change", record.inline.willChange);
    }
  }

  begin(direction) {
    this.animationToken += 1;
    this.restoreRecords(this.leaveRecords);
    this.restoreRecords(this.enterRecords);
    this.leaveRecords = [];
    this.enterRecords = [];
    this.direction = direction > 0 ? 1 : -1;
    this.prepareLeave(this.direction);
    this.updateProgress(this.runtime.progress);
  }

  prepareLeave(direction = this.direction) {
    const rule = this.rule("leave");
    if (!this.enabled(rule)) return;
    this.restoreRecords(this.leaveRecords);
    this.leaveRecords = this.prepareRecords(this.leavingSection(direction), rule, "leave");
  }

  phaseProgress(progress, direction = this.direction) {
    return direction > 0 ? clamp(progress) : 1 - clamp(progress);
  }

  rangedProgress(travel, rule, index = 0) {
    const start = clamp(Number(rule.start ?? 0));
    const end = clamp(Number(rule.end ?? 1));
    const duration = Math.max(1, Number(this.runtime.config.playback?.duration) || 1400);
    const stagger = Math.max(0, Number(rule.stagger) || 0) / duration;
    let localStart = clamp(start + stagger * index);
    let localEnd = clamp(end + stagger * index);

    if (localEnd <= localStart) {
      return travel >= localEnd ? 1 : 0;
    }

    return clamp((travel - localStart) / (localEnd - localStart));
  }

  applyEffect(record, rule, t, entering = false) {
    const eased = clamp(resolveEasing(rule.easing)(clamp(t)));
    const effect = rule.effect || "native";
    const distance = Math.max(0, Number(rule.distance) || 0);
    const endScale = Number.isFinite(rule.scale) && rule.scale > 0 ? rule.scale : 0.98;

    let opacityFactor = entering ? eased : 1 - eased;
    let y = 0;
    let scale = 1;

    if (effect === "fade-up") {
      y = entering ? distance * (1 - eased) : -distance * eased;
    } else if (effect === "fade-down") {
      y = entering ? -distance * (1 - eased) : distance * eased;
    } else if (effect === "scale") {
      scale = entering
        ? endScale + (1 - endScale) * eased
        : 1 + (endScale - 1) * eased;
    }

    writeInline(record.element.style, "opacity", String(record.baseOpacity * opacityFactor));

    // Each effect owns only the properties it animates. Restore the element's
    // original inline value for the opposite transform property so switching
    // effects (or sharing an element between leave/enter rules) cannot inherit a
    // stale translate/scale from an earlier application.
    if (effect === "fade-up" || effect === "fade-down") {
      writeInline(record.element.style, "translate", `0px ${y.toFixed(3)}px`);
      restoreInline(record.element.style, "scale", record.inline.scale);
    } else if (effect === "scale") {
      restoreInline(record.element.style, "translate", record.inline.translate);
      writeInline(record.element.style, "scale", String(scale));
    } else {
      restoreInline(record.element.style, "translate", record.inline.translate);
      restoreInline(record.element.style, "scale", record.inline.scale);
    }
  }

  updateProgress(progress) {
    if (!this.leaveRecords.length) return;
    const rule = this.rule("leave");
    if (!this.enabled(rule)) return;

    const travel = this.phaseProgress(progress);
    this.leaveRecords.forEach((record, index) => {
      const local = this.rangedProgress(travel, rule, index);
      this.applyEffect(record, rule, local, false);
    });
  }

  shouldEnterAtHandoff() {
    return this.enabled(this.rule("enter")) && this.resolvedEnterTrigger() === "handoff";
  }

  prepareEnter(direction = this.direction) {
    const rule = this.rule("enter");
    if (!this.enabled(rule)) return false;

    this.restoreRecords(this.enterRecords);
    this.enterRecords = this.prepareRecords(this.enteringSection(direction), rule, "enter");
    this.enterRecords.forEach((record) => this.applyEffect(record, rule, 0, true));
    return this.enterRecords.length > 0;
  }

  scheduleFrame(callback) {
    if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
    return setTimeout(() => callback(typeof performance !== "undefined" ? performance.now() : Date.now()), 16);
  }

  animateEnter(direction = this.direction) {
    const rule = this.rule("enter");
    if (!this.enabled(rule)) return Promise.resolve(false);
    if (!this.enterRecords.length && !this.prepareEnter(direction)) return Promise.resolve(false);

    const duration = Math.max(0, Number(rule.duration) || 0);
    const delay = Math.max(0, Number(rule.delay) || 0);
    const stagger = Math.max(0, Number(rule.stagger) || 0);
    const records = [...this.enterRecords];
    const token = ++this.animationToken;

    if (duration === 0) {
      records.forEach((record) => this.applyEffect(record, rule, 1, true));
      this.restoreRecords(records);
      this.enterRecords = this.enterRecords.filter((record) => !records.includes(record));
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      let startedAt = null;
      const lastIndex = Math.max(0, records.length - 1);
      const total = delay + stagger * lastIndex + duration;

      const frame = (timestamp) => {
        if (token !== this.animationToken || this.runtime.destroyed) {
          resolve(false);
          return;
        }

        if (startedAt == null) startedAt = timestamp;
        const elapsed = timestamp - startedAt;

        records.forEach((record, index) => {
          const localElapsed = elapsed - delay - stagger * index;
          const local = clamp(localElapsed / duration);
          this.applyEffect(record, rule, local, true);
        });

        if (elapsed >= total) {
          records.forEach((record) => this.applyEffect(record, rule, 1, true));
          this.restoreRecords(records);
          this.enterRecords = this.enterRecords.filter((record) => !records.includes(record));
          resolve(true);
          return;
        }

        this.scheduleFrame(frame);
      };

      this.scheduleFrame(frame);
    });
  }

  installViewportEnter() {
    const target = this.enteringSection(1);
    const rule = this.rule("enter");
    if (!target || typeof IntersectionObserver === "undefined") return;

    this.prepareEnter(1);
    if (!this.enterRecords.length) return;

    const threshold = clamp(Number(rule.threshold ?? 0.05));
    this.viewportObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target !== target) continue;

        if (entry.isIntersecting && !this.viewportAnimating) {
          this.viewportAnimating = true;
          this.animateEnter(1).finally(() => {
            this.viewportAnimating = false;
            if (rule.once !== false) this.viewportObserver?.unobserve(target);
          });
        } else if (!entry.isIntersecting && rule.once === false && !this.viewportAnimating) {
          this.prepareEnter(1);
        }
      }
    }, { threshold });

    this.viewportObserver.observe(target);
  }

  cancelAndRestore() {
    this.animationToken += 1;
    this.restoreRecords(this.leaveRecords);
    this.restoreRecords(this.enterRecords);
    this.leaveRecords = [];
    this.enterRecords = [];
    this.viewportAnimating = false;
  }

  destroy() {
    this.viewportObserver?.disconnect();
    this.viewportObserver = null;
    this.cancelAndRestore();
  }
}



/* ===== src/core/GSAPContentTimeline.js ===== */

function gsapEase(value) {
  const map = {
    linear: "none",
    easeInOutCubic: "power3.inOut",
    easeOutCubic: "power3.out"
  };
  return map[value] || value || "none";
}

function enabled(rule) {
  return !!rule && !["native", "none"].includes(rule.effect || "native");
}

function query(section, selector) {
  if (!section || !selector) return [];
  if (selector === "self") return [section];
  try { return Array.from(section.querySelectorAll?.(selector) || []); } catch (_) { return []; }
}

function effectVars(rule, entering) {
  const effect = rule.effect || "native";
  const distance = Math.max(0, Number(rule.distance) || 0);
  const scale = Number.isFinite(rule.scale) && rule.scale > 0 ? rule.scale : 0.98;

  if (effect === "fade") {
    return entering ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }];
  }
  if (effect === "fade-up") {
    return entering
      ? [{ opacity: 0, y: distance }, { opacity: 1, y: 0 }]
      : [{ opacity: 1, y: 0 }, { opacity: 0, y: -distance }];
  }
  if (effect === "fade-down") {
    return entering
      ? [{ opacity: 0, y: -distance }, { opacity: 1, y: 0 }]
      : [{ opacity: 1, y: 0 }, { opacity: 0, y: distance }];
  }
  if (effect === "scale") {
    return entering
      ? [{ opacity: 0, scale }, { opacity: 1, scale: 1 }]
      : [{ opacity: 1, scale: 1 }, { opacity: 0, scale }];
  }
  return [{}, {}];
}

/**
 * Adds content choreography to the same GSAP timeline that drives media.
 * GSAP owns interpolation/cleanup; SectionTransition only maps the existing
 * content configuration into timeline positions.
 */
class GSAPContentTimeline {
  constructor(runtime, gsap, ScrollTrigger) {
    this.runtime = runtime;
    this.gsap = gsap;
    this.ScrollTrigger = ScrollTrigger;
    this.context = null;
    this.viewportTriggers = [];
  }

  build(timeline) {
    if (this.runtime.reducedMotion || !timeline) return;
    const source = this.runtime.section;
    const target = this.runtime.targetSection?.();
    const leave = this.runtime.config.content?.leave;
    const enter = this.runtime.config.content?.enter;

    this.context = this.gsap.context?.(() => {
      if (enabled(leave)) this.addRule(timeline, source, leave, false, "leave");

      if (enabled(enter)) {
        const trigger = enter.trigger === "auto" ? "timeline" : enter.trigger;
        if (trigger === "viewport") this.installViewportEnter(target, enter);
        else this.addRule(timeline, target, enter, true, "enter");
      }
    }) || null;
  }

  addRule(timeline, section, rule, entering, kind) {
    const elements = query(section, rule.selector);
    if (!elements.length) return;

    const [fromVars, toVars] = effectVars(rule, entering);
    const playbackDuration = Math.max(1, Number(this.runtime.config.playback?.duration) || 1400);
    const stagger = Math.max(0, Number(rule.stagger) || 0) / playbackDuration;

    let start;
    let end;
    if (kind === "leave") {
      start = clamp(Number(rule.start ?? 0));
      end = clamp(Number(rule.end ?? 0.18));
    } else {
      start = clamp(Number(rule.start ?? 0.82));
      end = clamp(Number(rule.end ?? 1));
    }
    if (end <= start) end = Math.min(1, start + 0.001);

    const count = elements.length;
    const available = Math.max(0.001, end - start);
    const maxStagger = count > 1 ? Math.min(stagger, available / (count * 2)) : 0;
    const tweenDuration = Math.max(0.001, available - maxStagger * Math.max(0, count - 1));

    elements.forEach((element, index) => {
      timeline.fromTo(
        element,
        { ...fromVars },
        {
          ...toVars,
          duration: tweenDuration,
          ease: gsapEase(rule.easing),
          immediateRender: false,
          overwrite: "auto"
        },
        start + maxStagger * index
      );
    });
  }

  installViewportEnter(target, rule) {
    if (!target || !enabled(rule)) return;
    const elements = query(target, rule.selector);
    if (!elements.length) return;
    const [fromVars, toVars] = effectVars(rule, true);
    const duration = Math.max(0, Number(rule.duration) || 240) / 1000;
    const delay = Math.max(0, Number(rule.delay) || 0) / 1000;
    const stagger = Math.max(0, Number(rule.stagger) || 0) / 1000;
    const threshold = clamp(Number(rule.threshold ?? 0.05));
    const startPercent = Math.max(0, Math.min(100, (1 - threshold) * 100));

    this.gsap.set(elements, fromVars);
    const trigger = this.ScrollTrigger.create({
      trigger: target,
      start: `top ${startPercent}%`,
      once: rule.once !== false,
      onEnter: () => {
        this.gsap.to(elements, {
          ...toVars,
          duration,
          delay,
          stagger,
          ease: gsapEase(rule.easing || "power2.out"),
          overwrite: "auto"
        });
      },
      onLeaveBack: rule.once === false
        ? () => this.gsap.set(elements, fromVars)
        : undefined
    });
    this.viewportTriggers.push(trigger);
  }

  destroy() {
    this.viewportTriggers.forEach((trigger) => trigger?.kill?.());
    this.viewportTriggers = [];
    try { this.context?.revert?.(); } catch (_) {}
    this.context = null;
  }
}



/* ===== src/core/TransitionRuntime.js ===== */









class TransitionRuntime {
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



/* ===== src/core/Manager.js ===== */








class Manager {
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
    this.snapGlide = null;
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

    const needsSnapGlide = this.runtimes.some((runtime) =>
      runtime.usesScrollTrigger?.() &&
      runtime.normalizedScrollMode?.() === "snap" &&
      runtime.config.scroll?.snap !== false &&
      runtime.config.scroll?.snapStrategy !== "settle"
    );
    if (needsSnapGlide) {
      this.snapGlide = new SnapGlideController(this, this.scrollAdapter);
      this.snapGlide.install();
      // CSS scroll-snap may have been suppressed by the glide controller.
      // Refresh once more so ScrollTrigger measurements reflect the final style.
      try { this.scrollAdapter?.ScrollTrigger?.refresh?.(); } catch (_) {}
    }

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

  snapDiagnostics() {
    return this.snapGlide?.diagnostic?.() || null;
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
    this.snapGlide?.destroy?.();
    this.snapGlide = null;
    this.resizeObserver?.disconnect();
    this.intersectionObservers.forEach((observer) => observer.disconnect());
    this.intersectionObservers = [];

    // Runtime cleanup owns portal restoration and native-playback cancellation.
    this.runtimes.forEach((runtime) => runtime.destroy());
    this.runtimes = [];
    this.autoOwner = null;
    this.snapGlide = null;
    this.sceneEngine.destroy();

    // Last-resort unlock in case third-party code interrupted runtime cleanup.
    if (this.scrollLock?.locked) this.scrollLock.unlock();
  }
}



/* ===== src/index.js ===== */



const SectionTransition = {
  version: "0.6.3",

  useGSAP(gsap, ScrollTrigger) {
    registerGSAP(gsap, ScrollTrigger);
    return this;
  },

  async init(userOptions = {}) {
    const options = normalizeOptions(userOptions);

    if (!options.transitions || typeof options.transitions !== "object") {
      throw new Error("[SectionTransition] init() requires a transitions object");
    }

    const manager = new Manager(options);
    return await manager.init();
  }
};

if (typeof window !== "undefined") {
  window.SectionTransition = SectionTransition;
}


  global.SectionTransition = SectionTransition;
})(window);

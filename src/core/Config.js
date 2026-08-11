import { deepMerge } from "../utils/common.js";

export const DEFAULTS = {
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

export function normalizeOptions(userOptions = {}) {
  return deepMerge(DEFAULTS, userOptions);
}

export function validateTransitionConfig(name, cfg) {
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

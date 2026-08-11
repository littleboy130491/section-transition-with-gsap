import assert from "node:assert/strict";
import { FrameCache } from "../src/assets/FrameCache.js";
import { AssetManager } from "../src/assets/AssetManager.js";
import { TakeoverDriver } from "../src/drivers/TakeoverDriver.js";
import { ScrollTriggerDriver } from "../src/drivers/ScrollTriggerDriver.js";
import { ScrubDriver } from "../src/drivers/ScrubDriver.js";
import { VideoRenderer } from "../src/renderers/VideoRenderer.js";
import { SequenceRenderer } from "../src/renderers/SequenceRenderer.js";
import { TransitionRuntime } from "../src/core/TransitionRuntime.js";
import { ContentAnimator } from "../src/core/ContentAnimator.js";
import { GSAPContentTimeline } from "../src/core/GSAPContentTimeline.js";
import { SceneBackgroundEngine } from "../src/core/SceneBackgroundEngine.js";
import { GestureDetector } from "../src/input/GestureDetector.js";
import { normalizeOptions, validateTransitionConfig } from "../src/core/Config.js";

{
  let closed = 0;
  const cache = new FrameCache(2);
  cache.set(0, { close(){ closed++; } });
  cache.set(1, { close(){ closed++; } });
  cache.get(0); // 1 is now LRU
  cache.set(2, { close(){ closed++; } });
  assert.equal(cache.has(0), true);
  assert.equal(cache.has(1), false);
  assert.equal(cache.has(2), true);
  assert.equal(closed, 1);
  cache.clear();
  assert.equal(closed, 3);
}

{
  const lowCfg = normalizeOptions({
    scroll: { triggerThreshold: 10 },
    input: { gestureTimeout: 180, momentumCooldown: 0 }
  });
  const highCfg = normalizeOptions({
    scroll: { triggerThreshold: 50 },
    input: { gestureTimeout: 180, momentumCooldown: 0 }
  });
  const low = new GestureDetector(lowCfg);
  const high = new GestureDetector(highCfg);
  assert.equal(low.push(4).triggered, false);
  assert.equal(low.push(6).triggered, true);
  assert.equal(high.push(10).triggered, false);
}

{
  const cfg = normalizeOptions({});
  const transition = {
    ...cfg,
    source: { type: "sequence", src: "/f-{frame}.webp", count: 10 },
    fallback: { type: "image", src: "/fallback.webp" }
  };
  assert.doesNotThrow(() => validateTransitionConfig("test", transition));
}

{
  const cfg = normalizeOptions({});
  const transition = {
    ...cfg,
    from: "#section-a",
    to: "#section-b",
    source: { type: "image", src: "/fallback.webp" }
  };
  assert.doesNotThrow(() => validateTransitionConfig("selector-discovery", transition));
  assert.throws(() => validateTransitionConfig("bad-selector-discovery", { ...transition, from: 42 }));
}

{
  // All image requests, including critical preparation, obey maxConcurrent.
  const cfg = normalizeOptions({
    preload: { maxConcurrent: 2 },
    loading: { timeout: 1000 }
  });
  const assets = new AssetManager(
    { type: "sequence", src: "/f-{frame}.webp", count: 6 },
    cfg
  );
  let active = 0;
  let maxActive = 0;
  assets.decodeUrl = async (url) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return { width: 1, height: 1, url };
  };
  await Promise.all(Array.from({ length: 6 }, (_, i) => assets.load(i, "critical")));
  assert.equal(maxActive <= 2, true);
  assets.destroy();
}

{
  // A failed static frame is backoff-gated instead of hammering the URL on
  // every render request.
  const cfg = normalizeOptions({ loading: { timeout: 1000 } });
  const assets = new AssetManager(
    { type: "sequence", src: "/missing-{frame}.webp", count: 1 },
    cfg
  );
  let calls = 0;
  assets.decodeUrl = async () => {
    calls++;
    throw new Error("404");
  };
  await assert.rejects(assets.load(0, "requested"));
  await assert.rejects(assets.load(0, "requested"));
  assert.equal(calls, 1);
  assets.destroy();
}

{
  // Repeated input while readiness is pending must not create overlapping
  // auto playback attempts.
  const cfg = normalizeOptions({ scroll: { mode: "takeover" } });
  let resolveReady;
  let readinessCalls = 0;
  let beginCalls = 0;
  const readyPromise = new Promise((resolve) => { resolveReady = resolve; });
  const runtime = {
    config: cfg,
    destroyed: false,
    reducedMotion: false,
    renderer: null,
    ensureReadyForPlayback() {
      readinessCalls++;
      return readyPromise;
    },
    manager: {
      claimAuto: () => true,
      releaseAuto() {},
      requestFrame() {}
    },
    beginAutoPlayback() {
      beginCalls++;
      return true;
    },
    setProgress() {},
    finishAutoPlayback() {},
    skip() {},
    debug() {}
  };
  const driver = new TakeoverDriver(runtime);
  runtime.driver = driver;

  const first = driver.play(1);
  const second = driver.play(1);
  assert.equal(driver.pending, true);
  assert.equal(readinessCalls, 1);
  assert.equal(await second, false);

  resolveReady(true);
  assert.equal(await first, true);
  assert.equal(beginCalls, 1);
  driver.destroy();
}

{
  // Destroying while readiness is unresolved invalidates the pending play.
  const cfg = normalizeOptions({ scroll: { mode: "takeover" } });
  let resolveReady;
  let beginCalls = 0;
  const runtime = {
    config: cfg,
    destroyed: false,
    reducedMotion: false,
    renderer: null,
    ensureReadyForPlayback: () => new Promise((resolve) => { resolveReady = resolve; }),
    manager: {
      claimAuto: () => true,
      releaseAuto() {},
      requestFrame() {}
    },
    beginAutoPlayback() {
      beginCalls++;
      return true;
    },
    setProgress() {},
    finishAutoPlayback() {},
    skip() {},
    debug() {}
  };
  const driver = new TakeoverDriver(runtime);
  runtime.driver = driver;
  const playing = driver.play(1);
  driver.destroy();
  runtime.destroyed = true;
  resolveReady(true);
  assert.equal(await playing, false);
  assert.equal(beginCalls, 0);
}


// Auto mode must be layout-neutral and use real source/target positions.
{
  const previousWindow = globalThis.window;
  globalThis.window = { scrollY: 100, innerHeight: 800 };
  const cfg = normalizeOptions({ scroll: { mode: "takeover", snap: "auto" } });
  const runtime = {
    config: cfg,
    section: { getBoundingClientRect: () => ({ top: 0, bottom: 800 }) },
    spacer: { style: {} },
    targetSection: () => ({ getBoundingClientRect: () => ({ top: 800 }) }),
    manager: { documentSnapEnabled: () => true }
  };
  const driver = new TakeoverDriver(runtime);
  driver.measure();
  assert.equal(runtime.spacer.style.height, "0px");
  assert.equal(driver.forwardY, 100);
  assert.equal(driver.targetY, 900);
  assert.equal(driver.destinationY(1), 900);
  assert.equal(driver.destinationY(-1), 100);
  globalThis.window = previousWindow;
}

// A completed snap transition must recover reverse playback when momentum
// lands directly on the source boundary instead of in the interval.
{
  const previousWindow = globalThis.window;
  const calls = [];
  globalThis.window = {
    scrollY: 100,
    innerHeight: 800,
    scrollTo(options) { calls.push(["scrollTo", options.top]); }
  };

  const cfg = normalizeOptions({
    scroll: { mode: "takeover", snap: true, reversible: true }
  });
  const requests = [];
  const runtime = {
    config: cfg,
    progress: 1,
    reducedMotion: false,
    section: { getBoundingClientRect: () => ({ top: 0, bottom: 800 }) },
    spacer: { style: {} },
    targetSection: () => ({ getBoundingClientRect: () => ({ top: 800 }) }),
    manager: { documentSnapEnabled: () => true },
    requestAuto(direction) { requests.push(direction); }
  };

  const driver = new TakeoverDriver(runtime);
  driver.measure();
  driver.update(driver.forwardY);

  assert.deepEqual(requests, [-1]);
  assert.deepEqual(calls, []);
  globalThis.window = previousWindow;
}

// The older recovery path still rewinds to the target if the browser lands
// inside the transition interval rather than directly at the source boundary.
{
  const previousWindow = globalThis.window;
  const calls = [];
  globalThis.window = {
    scrollY: 100,
    innerHeight: 800,
    scrollTo(options) { calls.push(["scrollTo", options.top]); }
  };

  const cfg = normalizeOptions({
    scroll: { mode: "takeover", snap: true, reversible: true }
  });
  const requests = [];
  const runtime = {
    config: cfg,
    progress: 1,
    reducedMotion: false,
    section: { getBoundingClientRect: () => ({ top: 0, bottom: 800 }) },
    spacer: { style: {} },
    targetSection: () => ({ getBoundingClientRect: () => ({ top: 800 }) }),
    manager: { documentSnapEnabled: () => true },
    requestAuto(direction) { requests.push(direction); }
  };

  const driver = new TakeoverDriver(runtime);
  driver.measure();
  driver.update(driver.forwardY + 100);

  assert.deepEqual(requests, [-1]);
  assert.deepEqual(calls, [["scrollTo", driver.targetY]]);
  globalThis.window = previousWindow;
}

// The handoff/settling phase must retain input ownership.
{
  const cfg = normalizeOptions({ scroll: { mode: "takeover" } });
  const runtime = { config: cfg };
  const driver = new TakeoverDriver(runtime);
  driver.settling = true;
  assert.equal(driver.canCapture(1, 100), true);
}


// Video trim (seconds) and playback.range (normalized) compose predictably.
{
  const cfg = normalizeOptions({
    playback: {
      videoMode: "timeline",
      range: { start: 0.1, end: 0.9 }
    }
  });
  const runtime = { destroyed: false };
  const renderer = new VideoRenderer(
    runtime,
    { type: "video", src: "/clip.mp4", trim: { start: 2, end: 8 } },
    cfg
  );
  renderer.ready = true;
  renderer.video = { duration: 10, currentTime: 0, style: {} };

  const range = renderer.mediaRange();
  assert.ok(Math.abs(range.start - 2.6) < 1e-9);
  assert.ok(Math.abs(range.end - 7.4) < 1e-9);
  renderer.render(0);
  assert.ok(Math.abs(renderer.video.currentTime - 2.6) < 1e-9);
  renderer.render(1);
  assert.ok(Math.abs(renderer.video.currentTime - 7.4) < 1e-9);
}

// Endpoint correction begins only at handoff.startAt and interpolates scale/x/y.
{
  const runtime = Object.create(TransitionRuntime.prototype);
  runtime.config = normalizeOptions({
    playback: {
      handoff: {
        startAt: 0.8,
        easing: "linear",
        transform: {
          origin: "center center",
          from: { scale: 1, x: 0, y: 0 },
          to: { scale: 1.2, x: 20, y: -10 }
        }
      }
    }
  });
  let captured = null;
  runtime.renderer = { setAlignmentTransform(value) { captured = value; } };

  runtime.applyHandoffAlignment(0.5);
  assert.deepEqual(captured, {
    origin: "center center",
    scale: 1,
    x: 0,
    y: 0
  });

  runtime.applyHandoffAlignment(0.9);
  assert.ok(Math.abs(captured.scale - 1.1) < 1e-9);
  assert.ok(Math.abs(captured.x - 10) < 1e-9);
  assert.ok(Math.abs(captured.y + 5) < 1e-9);

  runtime.applyHandoffAlignment(1);
  assert.ok(Math.abs(captured.scale - 1.2) < 1e-9);
  assert.ok(Math.abs(captured.x - 20) < 1e-9);
  assert.ok(Math.abs(captured.y + 10) < 1e-9);
}

// Native media-clock monitoring advances runtime progress and stops at the
// configured effective endpoint instead of waiting for encoded video end.
{
  const previousRAF = globalThis.requestAnimationFrame;
  const previousCancelRAF = globalThis.cancelAnimationFrame;
  const queue = [];
  globalThis.requestAnimationFrame = (cb) => {
    queue.push(cb);
    return queue.length;
  };
  globalThis.cancelAnimationFrame = () => {};

  const progressValues = [];
  const runtime = {
    destroyed: false,
    setProgress(value) { progressValues.push(value); }
  };
  const cfg = normalizeOptions({ playback: { videoMode: "native" } });
  const renderer = new VideoRenderer(runtime, { type: "video", src: "/clip.mp4" }, cfg);
  renderer.video = {
    currentTime: 2,
    ended: false,
    pause() { this.paused = true; }
  };
  renderer.nativeStart = 2;
  renderer.nativeEnd = 4;
  renderer.nativePlaying = true;
  let completed = null;
  renderer.nativeEndResolver = (value) => { completed = value; };
  renderer.watchNativeProgress();

  for (const time of [2.5, 3, 3.5, 4]) {
    renderer.video.currentTime = time;
    const cb = queue.shift();
    assert.ok(cb);
    cb();
  }

  assert.equal(completed, true);
  assert.equal(renderer.video.paused, true);
  assert.equal(progressValues.at(-1), 1);
  assert.ok(progressValues.some((value) => value > 0 && value < 1));

  if (previousRAF === undefined) delete globalThis.requestAnimationFrame;
  else globalThis.requestAnimationFrame = previousRAF;
  if (previousCancelRAF === undefined) delete globalThis.cancelAnimationFrame;
  else globalThis.cancelAnimationFrame = previousCancelRAF;
}

// Synchronization options are validated early instead of failing mid-transition.
{
  const base = normalizeOptions({});
  assert.throws(() => validateTransitionConfig("bad-range", {
    ...base,
    source: { type: "video", src: "/clip.mp4" },
    playback: { ...base.playback, range: { start: 0.9, end: 0.2 } }
  }), /playback\.range\.end must be greater/);

  assert.throws(() => validateTransitionConfig("bad-trim", {
    ...base,
    source: { type: "video", src: "/clip.mp4", trim: { start: 2, end: 1 } }
  }), /source\.trim\.end/);
}


// Content leave choreography follows normalized transition progress and restores
// the element's original inline styles after completion/cancellation.
{
  const makeStyle = () => ({
    values: new Map(),
    getPropertyValue(name) { return this.values.get(name) || ""; },
    setProperty(name, value) { this.values.set(name, String(value)); },
    removeProperty(name) { this.values.delete(name); }
  });
  const element = { style: makeStyle() };
  const section = { querySelectorAll: () => [element] };
  const target = { querySelectorAll: () => [] };
  const cfg = normalizeOptions({
    scroll: { mode: "takeover" },
    playback: { duration: 1000 },
    content: {
      leave: {
        effect: "fade-up",
        selector: "[data-st-leave]",
        start: 0,
        end: 0.2,
        distance: 20,
        easing: "linear",
        stagger: 0
      }
    }
  });
  const runtime = {
    config: cfg,
    reducedMotion: false,
    destroyed: false,
    progress: 0,
    section,
    targetSection: () => target,
    reportError() {}
  };
  const content = new ContentAnimator(runtime);
  content.begin(1);
  content.updateProgress(0.1);
  assert.ok(Math.abs(Number(element.style.getPropertyValue("opacity")) - 0.5) < 1e-9);
  assert.equal(element.style.getPropertyValue("translate"), "0px -10.000px");
  content.cancelAndRestore();
  assert.equal(element.style.getPropertyValue("opacity"), "");
  assert.equal(element.style.getPropertyValue("translate"), "");
}

// Reverse auto navigation swaps the content roles: the current target section
// leaves and the original source becomes the entering destination.
{
  const makeStyle = () => ({
    values: new Map(),
    getPropertyValue(name) { return this.values.get(name) || ""; },
    setProperty(name, value) { this.values.set(name, String(value)); },
    removeProperty(name) { this.values.delete(name); }
  });
  const sourceElement = { style: makeStyle() };
  const targetElement = { style: makeStyle() };
  const source = { querySelectorAll: () => [sourceElement] };
  const target = { querySelectorAll: () => [targetElement] };
  const cfg = normalizeOptions({
    scroll: { mode: "takeover" },
    content: {
      leave: { effect: "fade", start: 0, end: 1, easing: "linear" }
    }
  });
  const runtime = {
    config: cfg,
    reducedMotion: false,
    destroyed: false,
    progress: 1,
    section: source,
    targetSection: () => target,
    reportError() {}
  };
  const content = new ContentAnimator(runtime);
  content.begin(-1);
  content.updateProgress(0.5);
  assert.ok(Math.abs(Number(targetElement.style.getPropertyValue("opacity")) - 0.5) < 1e-9);
  assert.equal(sourceElement.style.getPropertyValue("opacity"), "");
  content.cancelAndRestore();
}

// Handoff enter choreography prepares the destination while it is covered by
// the final media frame, then restores original inline styles after animation.
{
  const makeStyle = () => ({
    values: new Map(),
    getPropertyValue(name) { return this.values.get(name) || ""; },
    setProperty(name, value) { this.values.set(name, String(value)); },
    removeProperty(name) { this.values.delete(name); }
  });
  const element = { style: makeStyle() };
  const source = { querySelectorAll: () => [] };
  const target = { querySelectorAll: () => [element] };
  const cfg = normalizeOptions({
    scroll: { mode: "takeover" },
    content: {
      enter: {
        effect: "fade-up",
        trigger: "handoff",
        duration: 0,
        distance: 24,
        easing: "linear"
      }
    }
  });
  const runtime = {
    config: cfg,
    reducedMotion: false,
    destroyed: false,
    progress: 0,
    section: source,
    targetSection: () => target,
    reportError() {}
  };
  const content = new ContentAnimator(runtime);
  assert.equal(content.shouldEnterAtHandoff(), true);
  assert.equal(content.prepareEnter(1), true);
  assert.equal(element.style.getPropertyValue("opacity"), "0");
  assert.equal(element.style.getPropertyValue("translate"), "0px 24.000px");
  assert.equal(await content.animateEnter(1), true);
  assert.equal(element.style.getPropertyValue("opacity"), "");
  assert.equal(element.style.getPropertyValue("translate"), "");
}

// Content choreography and layering options fail validation early.
{
  const base = normalizeOptions({});
  assert.throws(() => validateTransitionConfig("bad-content-effect", {
    ...base,
    source: { type: "image", src: "/frame.webp" },
    content: {
      ...base.content,
      leave: { ...base.content.leave, effect: "spin" }
    }
  }), /content\.leave\.effect/);

  assert.throws(() => validateTransitionConfig("bad-z", {
    ...base,
    source: { type: "image", src: "/frame.webp" },
    render: { ...base.render, zIndex: Number.NaN }
  }), /render\.zIndex/);
}



// TakeoverDriver uses native reverse playback when the renderer can provide it,
// and completes at logical progress 0 without entering the rAF seek fallback.
{
  const cfg = normalizeOptions({ scroll: { mode: "takeover", reversible: true } });
  const progressValues = [];
  const nativeDirections = [];
  let framesRequested = 0;
  let finishDirection = null;
  const runtime = {
    config: cfg,
    destroyed: false,
    reducedMotion: false,
    progress: 1,
    renderer: {
      videoMode: "native",
      prepareForDirection(direction) { this.direction = direction; },
      async playNative(direction) { nativeDirections.push(direction); return true; },
      cancelNativePlayback() {}
    },
    ensureReadyForPlayback: async () => true,
    manager: {
      claimAuto: () => true,
      releaseAuto() {},
      requestFrame() { framesRequested++; }
    },
    beginAutoPlayback: () => true,
    setProgress(value) { this.progress = value; progressValues.push(value); },
    async finishAutoPlayback(direction) { finishDirection = direction; },
    skip() {},
    debug() {},
    reportError() {},
    releasePlayback() {}
  };
  const driver = new TakeoverDriver(runtime);
  runtime.driver = driver;

  assert.equal(await driver.play(-1), true);
  // finishAutoPlayback is scheduled by finish(); allow its promise chain to run.
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(nativeDirections, [-1]);
  assert.equal(progressValues.at(-1), 0);
  assert.equal(framesRequested, 0);
  assert.equal(finishDirection, -1);
}

// A dedicated reverseSrc maps runtime progress 1 -> 0 onto monotonically
// increasing media time, avoiding backward MP4 seeks entirely.
{
  const cfg = normalizeOptions({
    scroll: { mode: "takeover" },
    playback: { videoMode: "timeline" }
  });
  const runtime = { destroyed: false, debug() {} };
  const renderer = new VideoRenderer(
    runtime,
    { type: "video", src: "/forward.mp4", reverseSrc: "/reverse.mp4" },
    cfg
  );
  renderer.ready = true;
  renderer.reverseReady = true;
  renderer.video = {
    duration: 2, currentTime: 0, style: {}, pause() {}
  };
  renderer.reverseVideo = {
    duration: 2, currentTime: 0, style: {}, pause() {}
  };

  renderer.prepareForDirection(-1);
  assert.equal(renderer.activeVideo, renderer.reverseVideo);
  assert.equal(renderer.usingReverseAsset, true);

  renderer.render(1);
  const t1 = renderer.reverseVideo.currentTime;
  renderer.render(0.5);
  const t2 = renderer.reverseVideo.currentTime;
  renderer.render(0);
  const t3 = renderer.reverseVideo.currentTime;

  assert.ok(t1 <= t2 && t2 <= t3);
  assert.ok(t1 < 0.01);
  assert.ok(t3 > 1.9);
}

// Native reverseSrc playback drives runtime progress downward while the
// encoded reverse file itself plays normally forward.
{
  const previousRAF = globalThis.requestAnimationFrame;
  const previousCancelRAF = globalThis.cancelAnimationFrame;
  const queue = [];
  globalThis.requestAnimationFrame = (cb) => {
    queue.push(cb);
    return queue.length;
  };
  globalThis.cancelAnimationFrame = () => {};

  const progressValues = [];
  const runtime = {
    destroyed: false,
    setProgress(value) { progressValues.push(value); },
    debug() {}
  };
  const cfg = normalizeOptions({ playback: { videoMode: "native" } });
  const renderer = new VideoRenderer(
    runtime,
    { type: "video", src: "/forward.mp4", reverseSrc: "/reverse.mp4" },
    cfg
  );
  renderer.ready = true;
  renderer.reverseReady = true;
  renderer.reverseVideo = {
    duration: 2,
    currentTime: 0,
    ended: false,
    paused: false,
    style: {},
    pause() { this.paused = true; }
  };
  renderer.activeVideo = renderer.reverseVideo;
  renderer.usingReverseAsset = true;
  renderer.nativeDirection = -1;
  renderer.nativeStart = 0;
  renderer.nativeEnd = 2;
  renderer.nativePlaying = true;
  let completed = null;
  renderer.nativeEndResolver = (value) => { completed = value; };
  renderer.watchNativeProgress();

  for (const time of [0.5, 1, 1.5, 2]) {
    renderer.reverseVideo.currentTime = time;
    const cb = queue.shift();
    assert.ok(cb);
    cb();
  }

  assert.equal(completed, true);
  assert.equal(progressValues.at(-1), 0);
  assert.ok(progressValues.some((value) => value > 0 && value < 1));
  for (let i = 1; i < progressValues.length; i++) {
    assert.ok(progressValues[i] <= progressValues[i - 1] + 1e-9);
  }

  if (previousRAF === undefined) delete globalThis.requestAnimationFrame;
  else globalThis.requestAnimationFrame = previousRAF;
  if (previousCancelRAF === undefined) delete globalThis.cancelAnimationFrame;
  else globalThis.cancelAnimationFrame = previousCancelRAF;
}

// Reverse video configuration is validated early.
{
  const base = normalizeOptions({});
  assert.throws(() => validateTransitionConfig("bad-reverse-src", {
    ...base,
    source: { type: "video", src: "/forward.mp4", reverseSrc: "" }
  }), /source\.reverseSrc/);

  assert.throws(() => validateTransitionConfig("bad-reverse-trim", {
    ...base,
    source: {
      type: "video",
      src: "/forward.mp4",
      reverseSrc: "/reverse.mp4",
      reverseTrim: { start: 2, end: 1 }
    }
  }), /source\.reverseTrim\.end/);
}

{
  // Mobile browser chrome can resize the fixed scrub stage before innerHeight
  // catches up. The canvas CSS box must remain stage-relative (100%) rather
  // than being pixel-locked to a stale innerHeight value.
  const previousWindow = globalThis.window;
  globalThis.window = {
    devicePixelRatio: 2,
    innerWidth: 390,
    innerHeight: 548,
    visualViewport: { width: 390, height: 577 }
  };

  let renderRequests = 0;
  const runtime = {
    stage: { getBoundingClientRect: () => ({ width: 390, height: 577 }) },
    requestRender() { renderRequests++; },
    debug() {},
    reportError() {},
    destroyed: false
  };
  const cfg = normalizeOptions({ render: { maxDpr: 2 } });
  const renderer = new SequenceRenderer(
    runtime,
    { type: "sequence", src: "/f-{frame}.webp", count: 2 },
    cfg
  );
  renderer.canvas = { width: 0, height: 0, style: {} };
  renderer.resize();

  assert.equal(renderer.canvas.style.width, "100%");
  assert.equal(renderer.canvas.style.height, "100%");
  assert.equal(renderer.canvas.width, 780);
  assert.equal(renderer.canvas.height, 1154);
  assert.equal(renderRequests, 1);

  renderer.assetManager.destroy();
  globalThis.window = previousWindow;
}

console.log("Unit assertions passed.");

// Destination coordinates are recalculated from live DOM geometry at handoff
// time, so layout/viewport changes after init do not use stale snap positions.
{
  const previousWindow = globalThis.window;
  globalThis.window = { scrollY: 500, innerHeight: 800 };
  const cfg = normalizeOptions({ scroll: { mode: "takeover", snap: true } });
  let sourceTop = -500;
  const runtime = {
    config: cfg,
    section: { getBoundingClientRect: () => ({ top: sourceTop, bottom: sourceTop + 800 }) },
    spacer: { style: {} },
    targetSection: () => ({ getBoundingClientRect: () => ({ top: 300, bottom: 1300 }) }),
    manager: { documentSnapEnabled: () => true }
  };
  const driver = new TakeoverDriver(runtime);
  driver.measure();
  assert.equal(driver.destinationY(-1, { live: false }), 0);
  sourceTop = -420; // live layout shifted 80px after initial measure
  assert.equal(driver.destinationY(-1), 80);
  assert.equal(driver.destinationY(1), 800);
  globalThis.window = previousWindow;
}

// Snap stabilization reasserts the intended landing while the transition
// overlay still owns the viewport if the browser drifts after snap restore.
{
  const previousWindow = globalThis.window;
  const previousRAF = globalThis.requestAnimationFrame;
  let y = 100;
  const scrollCalls = [];
  globalThis.window = {
    get scrollY() { return y; },
    set scrollY(value) { y = value; },
    innerHeight: 800,
    visualViewport: { height: 800 },
    scrollTo({ top }) { y = top; scrollCalls.push(top); }
  };
  const rafQueue = [];
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };

  const runtime = Object.create(TransitionRuntime.prototype);
  runtime.destroyed = false;
  runtime.config = normalizeOptions({ playback: { handoff: { settleFrames: 3, landingTolerance: 1 } } });
  runtime.section = { getBoundingClientRect: () => ({ top: -y + 100, bottom: -y + 900, height: 800 }) };
  runtime.targetSection = () => ({ getBoundingClientRect: () => ({ top: -y + 900, bottom: -y + 1900, height: 1000 }) });
  runtime.debug = () => {};

  const settling = runtime.stabilizeLanding(100, -1);
  // Browser snap drifts after the first restored frame.
  y = 116;
  while (rafQueue.length) rafQueue.shift()();
  // Each resolved frame schedules the next microtask/frame.
  await Promise.resolve();
  while (rafQueue.length) { rafQueue.shift()(); await Promise.resolve(); }
  await settling;

  assert.equal(y, 100);
  assert.ok(scrollCalls.includes(100));

  globalThis.window = previousWindow;
  if (previousRAF === undefined) delete globalThis.requestAnimationFrame;
  else globalThis.requestAnimationFrame = previousRAF;
}


// Explicit `to` selector resolves without requiring target adjacency or HTML markers.
{
  const previousDocument = globalThis.document;
  const target = { nodeType: 1 };
  globalThis.document = { querySelector(selector) { return selector === "#target" ? target : null; } };
  const runtime = Object.create(TransitionRuntime.prototype);
  runtime.config = { to: "#target" };
  runtime.spacer = { nextElementSibling: { id: "fallback" } };
  assert.equal(runtime.targetSection(), target);
  globalThis.document = previousDocument;
}

// Default native-sticky scrub is layout-neutral and starts on the first pixel that a
// viewport-height source leaves. Progress 1 is the real target section top.
{
  const previousWindow = globalThis.window;
  globalThis.window = {
    scrollY: 100,
    innerHeight: 800,
    innerWidth: 1200,
    visualViewport: { height: 800 }
  };
  const cfg = normalizeOptions({ scroll: { mode: "scrub" } });
  const source = { getBoundingClientRect: () => ({ top: 0, bottom: 800, height: 800 }) };
  const target = { getBoundingClientRect: () => ({ top: 800, bottom: 1600, height: 800 }) };
  const spacer = { style: {}, classList: { add() {}, remove() {} } };
  const stage = { classList: { add() {}, remove() {} } };
  const runtime = {
    config: cfg,
    section: source,
    spacer,
    stage,
    destroyed: false,
    targetSection: () => target,
    debug() {}
  };
  const driver = new ScrubDriver(runtime);
  driver.measure();
  assert.equal(spacer.style.height, "0px");
  assert.equal(spacer.style.marginTop, "0px");
  assert.equal(driver.startY, 100);
  assert.equal(driver.endY, 900);
  assert.equal(driver.distancePx, 800);
  // Track begins at source top and spans through the target boundary; CSS adds
  // one dynamic viewport for the sticky constraint without adding document flow.
  globalThis.window = previousWindow;
}

// A tall source remains naturally scrollable. Scrubbing starts when its final
// viewport begins leaving and still completes at the real target boundary.
{
  const previousWindow = globalThis.window;
  globalThis.window = {
    scrollY: 100,
    innerHeight: 800,
    innerWidth: 1200,
    visualViewport: { height: 800 }
  };
  const cfg = normalizeOptions({ scroll: { mode: "scrub" } });
  const source = { getBoundingClientRect: () => ({ top: 0, bottom: 1200, height: 1200 }) };
  const target = { getBoundingClientRect: () => ({ top: 1200, bottom: 2000, height: 800 }) };
  const runtime = {
    config: cfg,
    section: source,
    targetSection: () => target,
    spacer: { style: {}, classList: { add() {}, remove() {} } },
    stage: { classList: { add() {}, remove() {} } },
    destroyed: false,
    debug() {}
  };
  const driver = new ScrubDriver(runtime);
  driver.measure();
  assert.equal(driver.startY, 500); // document source bottom 1300 - 800 viewport
  assert.equal(driver.endY, 1300);
  assert.equal(driver.distancePx, 800);
  globalThis.window = previousWindow;
}

// Native sticky track never bootstraps document overflow. A short final target
// that cannot reach the viewport top clamps scrub completion to authored maxScrollY.
{
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const trackStyle = {
    display: "",
    setProperty(name, value) { this[name] = value; },
    removeProperty(name) { delete this[name]; }
  };
  let measuredWithoutTrack = false;
  globalThis.window = {
    scrollY: 0,
    innerHeight: 800,
    innerWidth: 1200,
    visualViewport: { height: 800 }
  };
  globalThis.document = {
    documentElement: {
      get scrollHeight() {
        measuredWithoutTrack = trackStyle.display === "none";
        return 1200;
      }
    },
    body: { scrollHeight: 1200 }
  };
  const runtime = {
    config: normalizeOptions({ scroll: { mode: "scrub" } }),
    section: { getBoundingClientRect: () => ({ top: 0, bottom: 800, height: 800 }) },
    targetSection: () => ({ getBoundingClientRect: () => ({ top: 800, bottom: 1200, height: 400 }) }),
    spacer: { style: {}, classList: { add() {}, remove() {} } },
    scrubTrack: { isConnected: true, style: trackStyle },
    stage: { classList: { add() {}, remove() {} } },
    destroyed: false,
    debug() {}
  };
  const driver = new ScrubDriver(runtime);
  driver.measure();
  assert.equal(measuredWithoutTrack, true);
  assert.equal(driver.startY, 0);
  assert.equal(driver.endY, 400); // 1200 authored height - 800 viewport
  assert.equal(driver.distancePx, 400);
  assert.equal(trackStyle.top, "0px");
  assert.equal(trackStyle["--st-scrub-span"], "400px");
  assert.equal(trackStyle.height, undefined); // CSS owns dynamic viewport height
  globalThis.window = previousWindow;
  globalThis.document = previousDocument;
}

// `scrubRange: distance` keeps the no-layout sticky-track architecture but lets an
// author deliberately choose a scroll span that is independent of target top.
{
  const previousWindow = globalThis.window;
  globalThis.window = {
    scrollY: 0,
    innerHeight: 800,
    innerWidth: 1200,
    visualViewport: { height: 800 }
  };
  const cfg = normalizeOptions({
    scroll: { mode: "scrub", scrubRange: "distance", distance: 1200 }
  });
  const runtime = {
    config: cfg,
    section: { getBoundingClientRect: () => ({ top: 0, bottom: 800, height: 800 }) },
    targetSection: () => ({ getBoundingClientRect: () => ({ top: 800, bottom: 1600, height: 800 }) }),
    spacer: { style: {}, classList: { add() {}, remove() {} } },
    stage: { classList: { add() {}, remove() {} } },
    destroyed: false,
    debug() {}
  };
  const driver = new ScrubDriver(runtime);
  driver.measure();
  assert.equal(driver.startY, 0);
  assert.equal(driver.endY, 1200);
  assert.equal(driver.distancePx, 1200);
  globalThis.window = previousWindow;
}

// In default native-sticky scrub mode the exact source/target boundaries remain real
// DOM frames. The first pixel in either direction reveals the already-sticky stage.
{
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const classes = new Set();
  const home = { appendChild(node) { node.parentNode = this; } };
  const body = { appendChild(node) { node.parentNode = this; } };
  globalThis.window = {
    scrollY: 0,
    innerHeight: 800,
    innerWidth: 1200,
    visualViewport: { height: 800 }
  };
  globalThis.document = { body };
  const stage = {
    parentNode: home,
    style: {},
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); }
    }
  };
  const cfg = normalizeOptions({ scroll: { mode: "scrub" } });
  const runtime = {
    config: cfg,
    section: { getBoundingClientRect: () => ({ top: 0, bottom: 800, height: 800 }) },
    targetSection: () => ({ getBoundingClientRect: () => ({ top: 800, bottom: 1600, height: 800 }) }),
    spacer: { style: {}, classList: { add() {}, remove() {} } },
    scrubTrack: {
      isConnected: true,
      style: { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } }
    },
    stage,
    stageHome: null,
    destroyed: false,
    progress: 0,
    renderer: {
      prime() {},
      hasDrawableFrame() { return true; }
    },
    debug() {},
    setProgress(value) { this.progress = value; }
  };
  const driver = new ScrubDriver(runtime);
  runtime.driver = driver;
  driver.measure();

  driver.update(driver.startY);
  assert.equal(driver.overlayActive, false);
  assert.equal(runtime.progress, 0);

  driver.update(driver.startY + 1);
  assert.equal(driver.overlayActive, true);
  assert.equal(classes.has("st-stage--scrub-active"), true);
  assert.equal(stage.parentNode, home);
  assert.equal(runtime.progress > 0, true);

  driver.update(driver.endY);
  assert.equal(driver.overlayActive, false);
  assert.equal(stage.parentNode, home);
  assert.equal(runtime.progress, 1);

  driver.update(driver.endY - 1);
  assert.equal(driver.overlayActive, true);
  assert.equal(runtime.progress < 1, true);
  driver.destroy();

  globalThis.window = previousWindow;
  globalThis.document = previousDocument;
}

// Smoothed scrub keeps the sticky media visible until progress reaches a real
// boundary; reaching target scrollY must not expose an unfinished media frame.
{
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const home = { appendChild(node) { node.parentNode = this; } };
  const body = { appendChild(node) { node.parentNode = this; } };
  const classes = new Set();
  globalThis.window = { scrollY: 0, innerHeight: 800, innerWidth: 1200, visualViewport: { height: 800 } };
  globalThis.document = { body };
  const stage = {
    parentNode: home,
    style: {},
    classList: { add(n) { classes.add(n); }, remove(n) { classes.delete(n); } }
  };
  const runtime = {
    config: normalizeOptions({ scroll: { mode: "scrub", smoothing: 0.5 } }),
    section: { getBoundingClientRect: () => ({ top: 0, bottom: 800, height: 800 }) },
    targetSection: () => ({ getBoundingClientRect: () => ({ top: 800, bottom: 1600, height: 800 }) }),
    spacer: { style: {}, classList: { add() {}, remove() {} } },
    scrubTrack: {
      isConnected: true,
      style: { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } }
    },
    stage,
    stageHome: null,
    destroyed: false,
    progress: 0.5,
    targetProgress: 0.5,
    renderer: {
      prime() {},
      hasDrawableFrame() { return true; }
    },
    debug() {},
    setProgress(value) { this.progress = value; }
  };
  const driver = new ScrubDriver(runtime);
  runtime.driver = driver;
  driver.measure();
  runtime.progress = 0.5;
  driver.update(driver.endY);
  assert.equal(driver.overlayActive, true);
  for (let i = 0; i < 30 && driver.tick(); i++) {}
  driver.tick();
  assert.equal(runtime.progress > 0.999, true);
  assert.equal(driver.overlayActive, false);
  globalThis.window = previousWindow;
  globalThis.document = previousDocument;
}


// First scrub exposure is fail-open: entering the sticky range with no drawable
// media must keep the real page visible instead of showing the stage background.
{
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const home = { appendChild(node) { node.parentNode = this; } };
  const body = { appendChild(node) { node.parentNode = this; } };
  const classes = new Set();
  globalThis.window = { scrollY: 0, innerHeight: 800, innerWidth: 1200, visualViewport: { height: 800 } };
  globalThis.document = { body };

  let drawable = false;
  let primes = 0;
  const stage = {
    parentNode: home,
    style: {},
    classList: { add(n) { classes.add(n); }, remove(n) { classes.delete(n); } }
  };
  const runtime = {
    config: normalizeOptions({ scroll: { mode: "scrub" } }),
    section: { getBoundingClientRect: () => ({ top: 0, bottom: 800, height: 800 }) },
    targetSection: () => ({ getBoundingClientRect: () => ({ top: 800, bottom: 1600, height: 800 }) }),
    spacer: { style: {}, classList: { add() {}, remove() {} } },
    scrubTrack: {
      isConnected: true,
      style: { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } }
    },
    stage,
    stageHome: null,
    destroyed: false,
    progress: 0,
    targetProgress: 0,
    renderer: {
      prime() { primes++; },
      hasDrawableFrame() { return drawable; }
    },
    debug() {},
    setProgress(value) { this.progress = value; }
  };
  const driver = new ScrubDriver(runtime);
  runtime.driver = driver;
  driver.measure();

  // Boundary update prewarms frame 0 before the user actually enters.
  driver.update(driver.startY);
  assert.equal(primes > 0, true);
  assert.equal(driver.overlayActive, false);

  // Entering with media late must remain fail-open.
  driver.update(driver.startY + 20);
  assert.equal(driver.overlayWanted, true);
  assert.equal(driver.overlayActive, false);
  assert.equal(stage.parentNode, home);
  assert.equal(stage.style.visibility, "hidden");

  // Once the exact frame is painted/decoded, afterRender exposes the stage.
  drawable = true;
  driver.afterRender();
  assert.equal(driver.overlayActive, true);
  assert.equal(stage.parentNode, home);
  assert.equal(classes.has("st-stage--scrub-active"), true);

  // Once active, a later exact frame being temporarily unavailable must not
  // toggle the stage off; the renderer keeps the previous valid frame visible.
  drawable = false;
  driver.update(driver.startY + 40);
  assert.equal(driver.overlayActive, true);

  globalThis.window = previousWindow;
  globalThis.document = previousDocument;
}

// Sequence first-exposure readiness requires the exact painted frame, not just
// any cached/nearest frame. This prevents a wrong critical frame from popping in.
{
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1, innerWidth: 100, innerHeight: 100, visualViewport: { width: 100, height: 100 } };
  const runtime = {
    progress: 0.5,
    stage: { getBoundingClientRect: () => ({ width: 100, height: 100 }) },
    driver: { overlayActive: false },
    requestRender() {}, debug() {}, reportError() {}, destroyed: false
  };
  const cfg = normalizeOptions({ playback: { range: { start: 0, end: 1 } } });
  const renderer = new SequenceRenderer(runtime, { type: "sequence", src: "/f-{frame}.webp", count: 11 }, cfg);
  renderer.canvas = { width: 100, height: 100, style: {} };
  renderer.ctx = {};
  renderer.hasPaintedFrame = true;
  renderer.paintedIndex = 4;
  assert.equal(renderer.hasDrawableFrame(0.5, { exact: false }), true);
  assert.equal(renderer.hasDrawableFrame(0.5, { exact: true }), false); // target is frame 5
  renderer.paintedIndex = 5;
  assert.equal(renderer.hasDrawableFrame(0.5, { exact: true }), true);
  renderer.assetManager.destroy();
  globalThis.window = previousWindow;
}

// Resizing an active sequence surface preserves/redraws the last cached frame in
// the same task, so changing canvas.width/height never exposes an empty backing store.
{
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1, innerWidth: 200, innerHeight: 200, visualViewport: { width: 200, height: 200 } };
  let draws = 0;
  const runtime = {
    stage: { getBoundingClientRect: () => ({ width: 200, height: 200 }) },
    driver: { overlayActive: true },
    requestRender() {}, debug() {}, reportError() {}, destroyed: false
  };
  const cfg = normalizeOptions({});
  const renderer = new SequenceRenderer(runtime, { type: "sequence", src: "/f-{frame}.webp", count: 2 }, cfg);
  const frame = { width: 100, height: 100 };
  renderer.assetManager.cache.set(0, frame);
  renderer.canvas = { width: 100, height: 100, style: {} };
  renderer.ctx = {
    save() {}, restore() {}, fillRect() {}, drawImage() { draws++; },
    set fillStyle(_) {}
  };
  renderer.hasPaintedFrame = true;
  renderer.paintedIndex = 0;
  renderer.lastIndex = 0;
  renderer.resize();
  assert.equal(renderer.canvas.width, 200);
  assert.equal(renderer.canvas.height, 200);
  assert.equal(draws, 1);
  assert.equal(renderer.hasPaintedFrame, true);
  assert.equal(renderer.paintedIndex, 0);
  assert.equal(renderer.canvas.style.visibility, "visible");
  renderer.assetManager.destroy();
  globalThis.window = previousWindow;
}


// Scrubbed video does not count metadata-only readiness as drawable. First
// exposure requires current frame data and (for exact gating) a settled seek.
{
  const cfg = normalizeOptions({ scroll: { mode: "scrub" } });
  const runtime = { progress: 0.5, requestRender() {}, debug() {}, destroyed: false };
  const renderer = new VideoRenderer(runtime, { type: "video", src: "/clip.mp4" }, cfg);
  renderer.ready = true;
  renderer.video = {
    duration: 2,
    currentTime: 1,
    readyState: 1, // metadata only
    seeking: false,
    style: {}
  };
  renderer.activeVideo = renderer.video;
  assert.equal(renderer.hasDrawableFrame(0.5), false);

  renderer.video.readyState = 2;
  renderer.video.currentTime = 0;
  assert.equal(renderer.hasDrawableFrame(0.5, { exact: false }), true);
  assert.equal(renderer.hasDrawableFrame(0.5, { exact: true }), false);

  renderer.video.currentTime = 1;
  assert.equal(renderer.hasDrawableFrame(0.5, { exact: true }), true);
  renderer.video.seeking = true;
  assert.equal(renderer.hasDrawableFrame(0.5, { exact: true }), false);
}

// Legacy standalone sticky-spacer scrub remains available explicitly.
{
  const previousWindow = globalThis.window;
  globalThis.window = { scrollY: 50, innerHeight: 800, innerWidth: 1200 };
  const cfg = normalizeOptions({
    scroll: { mode: "scrub", distance: 1000, scrubStart: "after" }
  });
  const spacer = {
    style: {},
    classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({ top: 800 })
  };
  const runtime = {
    config: cfg,
    spacer,
    stage: { classList: { add() {}, remove() {} } },
    destroyed: false
  };
  const driver = new ScrubDriver(runtime);
  driver.measure();
  assert.equal(spacer.style.marginTop, "0px");
  assert.equal(spacer.style.height, "1800px");
  assert.equal(driver.startY, 850);
  globalThis.window = previousWindow;
}


// Scene scrub is selected only for scene-managed runtimes and commits the exact
// rendered endpoint into the persistent scene background before hiding media.
{
  const cfg = normalizeOptions({ scroll: { mode: "scrub", scrubEngine: "scene", smoothing: 0 } });
  let commits = 0;
  let cancels = 0;
  const stage = {
    style: {},
    classList: { add() {}, remove() {} }
  };
  const runtime = {
    config: cfg,
    sceneManaged: true,
    destroyed: false,
    progress: 1,
    targetProgress: 1,
    needsRender: false,
    stage,
    renderer: { hasDrawableFrame: () => true },
    manager: {
      sceneEngine: {
        beginTransition() {},
        commitTransition(_runtime, progress) { commits++; assert.equal(progress, 1); },
        cancelTransition() { cancels++; }
      }
    }
  };
  const driver = new ScrubDriver(runtime);
  runtime.driver = driver;
  driver.startY = 0;
  driver.endY = 100;
  driver.distancePx = 100;
  driver.hasScrollableRange = true;
  driver.lastScrollY = 100;
  driver.overlayActive = true;
  driver.syncOverlay();
  assert.equal(commits, 1);
  assert.equal(cancels, 0);
  assert.equal(driver.overlayActive, false);
  assert.equal(driver.isSceneEngine(), true);
}

{
  const cfg = normalizeOptions({ scroll: { scrubEngine: "scene" } });
  const transition = {
    ...cfg,
    source: { type: "sequence", src: "/f-{frame}.webp", count: 10 }
  };
  assert.doesNotThrow(() => validateTransitionConfig("scene-engine", transition));
  assert.throws(() => validateTransitionConfig("bad-scene-engine", {
    ...transition,
    scroll: { ...transition.scroll, scrubEngine: "unknown" }
  }));
}


// Declarative scene discovery accepts the semantic name attribute but also
// registers sections that only provide background/scrub attributes.
{
  const previousDocument = globalThis.document;
  const makeElement = (id, attrs = {}) => ({
    id,
    children: [],
    getAttribute(name) { return attrs[name] ?? null; }
  });
  const a = makeElement("hero", {
    "data-st-background": "/hero.webp",
    "data-st-scrub": "hero-next"
  });
  const b = makeElement("next", {
    "data-st-scene": "next-scene",
    "data-st-background": "/next.webp"
  });
  globalThis.document = { querySelectorAll: () => [a, b] };
  const engine = new SceneBackgroundEngine({}, {});
  engine.discover();
  assert.equal(engine.scenes.length, 2);
  assert.equal(engine.sceneForElement(a).name, "hero");
  assert.equal(engine.sceneForElement(b).name, "next-scene");
  assert.equal(engine.transitionNameFor(a), "hero-next");
  assert.equal(engine.nextScene(a).element, b);
  globalThis.document = previousDocument;
}

// Persistent scene canvas uses the same cover/contain math as transition media.
{
  const engine = new SceneBackgroundEngine({}, {});
  let drawArgs = null;
  engine.canvas = { width: 200, height: 100 };
  engine.ctx = {
    clearRect() {},
    drawImage(...args) { drawArgs = args; }
  };
  const image = { naturalWidth: 100, naturalHeight: 100 };
  assert.equal(engine.drawCover(image, { fit: "cover", position: "center center" }), true);
  assert.equal(drawArgs[0], image);
  // square image covering 2:1 canvas => 200x200, vertically centered at -50
  assert.equal(drawArgs[3], 200);
  assert.equal(drawArgs[4], 200);
}

// Scene discovery is explicitly DOM-order safe even if a custom DOM/test double
// returns selector-list matches grouped out of order. Legacy data-st-bg alone is
// also sufficient to register a scene.
{
  const previousDocument = globalThis.document;
  const makeElement = (id, rank, attrs = {}) => ({
    id,
    rank,
    children: [],
    getAttribute(name) { return attrs[name] ?? null; },
    compareDocumentPosition(other) {
      if (other.rank < this.rank) return 2; // PRECEDING
      if (other.rank > this.rank) return 4; // FOLLOWING
      return 0;
    }
  });
  const first = makeElement("first", 0, { "data-st-bg": "/first.webp" });
  const second = makeElement("second", 1, { "data-st-scene": "second" });
  globalThis.document = { querySelectorAll: () => [second, first] };
  const engine = new SceneBackgroundEngine({}, {});
  engine.discover();
  assert.deepEqual(engine.scenes.map((scene) => scene.element.id), ["first", "second"]);
  assert.equal(engine.scenes[0].background, "/first.webp");
  globalThis.document = previousDocument;
}

// Missing scene backgrounds use bounded retry/backoff instead of issuing a new
// request on every scroll/update preload pass.
{
  const previousImage = globalThis.Image;
  let requests = 0;
  globalThis.Image = class {
    set src(value) {
      this._src = value;
      requests++;
      this.onerror?.();
    }
  };
  const engine = new SceneBackgroundEngine({}, {});
  const scene = { name: "missing", background: "/404.webp", crossOrigin: null };
  assert.equal(await engine.loadScene(scene), null);
  assert.equal(await engine.loadScene(scene), null);
  assert.equal(requests, 1);
  assert.equal(engine.failed.get("missing").attempts, 1);
  if (previousImage === undefined) delete globalThis.Image;
  else globalThis.Image = previousImage;
}

// Scene cache eviction never removes the current or wanted scene while a
// disposable entry is available.
{
  const engine = new SceneBackgroundEngine({}, { cacheMax: 2 });
  engine.currentScene = { name: "current" };
  engine.wantedScene = { name: "wanted" };
  engine.cache.set("current", { id: "current" });
  engine.cache.set("wanted", { id: "wanted" });
  engine.touchCache({ name: "other" }, { id: "other" });
  assert.equal(engine.cache.has("current"), true);
  assert.equal(engine.cache.has("wanted"), true);
  assert.equal(engine.cache.has("other"), false);
}

// authoredMaxScroll excludes every generated sticky compatibility track, not
// only the current runtime's track, and restores their inline display values.
{
  const previousDocument = globalThis.document;
  const trackA = { style: { display: "" } };
  const trackB = { style: { display: "block" } };
  const tracks = [trackA, trackB];
  const visibleTracks = () => tracks.filter((track) => track.style.display !== "none").length;
  const root = {};
  const body = {};
  Object.defineProperty(root, "scrollHeight", { get: () => 1000 + visibleTracks() * 400 });
  Object.defineProperty(body, "scrollHeight", { get: () => 1000 + visibleTracks() * 400 });
  globalThis.document = {
    documentElement: root,
    body,
    querySelectorAll: () => tracks
  };
  const driver = new ScrubDriver({ scrubTrack: trackA });
  assert.equal(driver.authoredMaxScroll(200), 800);
  assert.equal(trackA.style.display, "");
  assert.equal(trackB.style.display, "block");
  globalThis.document = previousDocument;
}

// If an active sequence frame has been evicted from the decoded cache, resize
// snapshots the currently painted canvas, updates the backing store immediately,
// and keeps the surface drawable while requesting an exact replacement.
{
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    devicePixelRatio: 2,
    innerWidth: 200,
    innerHeight: 100,
    visualViewport: { width: 200, height: 100 }
  };
  let snapshotCopies = 0;
  globalThis.document = {
    createElement(name) {
      assert.equal(name, "canvas");
      return {
        width: 0,
        height: 0,
        getContext() {
          return { drawImage() { snapshotCopies++; } };
        }
      };
    }
  };
  let redrawRequests = 0;
  const runtime = {
    stage: { getBoundingClientRect: () => ({ width: 200, height: 100 }) },
    driver: { overlayActive: true },
    requestRender() { redrawRequests++; },
    debug() {}, reportError() {}, destroyed: false
  };
  const cfg = normalizeOptions({ render: { maxDpr: 2 } });
  const renderer = new SequenceRenderer(runtime, { type: "sequence", src: "/f-{frame}.webp", count: 2 }, cfg);
  renderer.canvas = { width: 100, height: 50, style: {} };
  renderer.ctx = {
    clearRect() {},
    drawImage() { snapshotCopies++; }
  };
  renderer.hasPaintedFrame = true;
  renderer.paintedIndex = 0;
  renderer.lastIndex = 0;
  renderer.resize();
  assert.equal(renderer.canvas.width, 400);
  assert.equal(renderer.canvas.height, 200);
  assert.equal(renderer.hasPaintedFrame, true);
  assert.equal(renderer.paintedIndex, 0);
  assert.equal(renderer.lastIndex, -1);
  assert.equal(renderer.canvas.style.visibility, "visible");
  assert.equal(snapshotCopies >= 2, true);
  assert.equal(redrawRequests > 0, true);
  renderer.assetManager.destroy();
  globalThis.window = previousWindow;
  globalThis.document = previousDocument;
}

// Content effects restore transform properties they do not own, preventing a
// prior translate/scale effect from leaking into a later effect application.
{
  const style = {
    values: new Map([["translate", "3px 4px"], ["scale", "1.1"]]),
    getPropertyValue(name) { return this.values.get(name) || ""; },
    setProperty(name, value) { this.values.set(name, String(value)); },
    removeProperty(name) { this.values.delete(name); }
  };
  const runtime = { config: normalizeOptions({}), reducedMotion: false };
  const animator = new ContentAnimator(runtime);
  const record = {
    element: { style },
    baseOpacity: 1,
    inline: { opacity: "", translate: "3px 4px", scale: "1.1", transition: "", willChange: "" }
  };
  animator.applyEffect(record, { effect: "fade-up", distance: 20, easing: "linear" }, 0.5, false);
  assert.equal(style.getPropertyValue("translate"), "0px -10.000px");
  assert.equal(style.getPropertyValue("scale"), "1.1");
  animator.applyEffect(record, { effect: "scale", scale: 0.9, easing: "linear" }, 0.5, false);
  assert.equal(style.getPropertyValue("translate"), "3px 4px");
  animator.applyEffect(record, { effect: "fade", easing: "linear" }, 0.5, false);
  assert.equal(style.getPropertyValue("translate"), "3px 4px");
  assert.equal(style.getPropertyValue("scale"), "1.1");
}

// Cross-origin assets without explicit CORS intent bypass the fetch/ImageBitmap
// path, avoiding a guaranteed failed fetch followed by a duplicate <img> request.
{
  const previousDocument = globalThis.document;
  const previousImage = globalThis.Image;
  const previousFetch = globalThis.fetch;
  const previousBitmap = globalThis.createImageBitmap;
  globalThis.document = { baseURI: "https://site.test/page" };
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new Error("should not fetch"); };
  globalThis.createImageBitmap = async () => ({});
  globalThis.Image = class {
    set src(value) { this._src = value; this.onload?.(); }
  };
  const cfg = normalizeOptions({ cache: { useImageBitmap: true } });
  const assets = new AssetManager(
    { type: "sequence", src: ["https://cdn.test/f.webp"], count: 1 },
    cfg
  );
  const image = await assets.decodeUrl("https://cdn.test/f.webp");
  assert.ok(image);
  assert.equal(fetches, 0);
  assets.destroy();
  globalThis.document = previousDocument;
  if (previousImage === undefined) delete globalThis.Image; else globalThis.Image = previousImage;
  if (previousFetch === undefined) delete globalThis.fetch; else globalThis.fetch = previousFetch;
  if (previousBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = previousBitmap;
}

// Endpoint snapshots remain exact immediately after handoff, then a resize/redraw
// switches to the authored scene image so its fit/position are recomputed.
{
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(name) {
      assert.equal(name, "canvas");
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage() {} })
      };
    }
  };
  const engine = new SceneBackgroundEngine({}, {});
  engine.canvas = { width: 200, height: 100 };
  engine.ctx = { clearRect() {}, drawImage() {} };
  const sourceElement = {};
  const targetElement = {};
  const targetScene = {
    element: targetElement,
    name: "target",
    background: "/target.webp",
    fit: "contain",
    position: "left top",
    owned: false
  };
  engine.byElement.set(targetElement, targetScene);
  engine.markOwned = () => {};
  engine.showLayer = () => {};
  const targetImage = { naturalWidth: 100, naturalHeight: 100 };
  engine.cache.set("target", targetImage);
  const runtime = {
    section: sourceElement,
    targetSection: () => targetElement,
    renderer: { getVisualElement: () => ({ width: 200, height: 100 }) },
    config: { render: { fit: "contain", position: "left top" } }
  };
  engine.activeTransition = runtime;
  assert.equal(engine.commitTransition(runtime, 1), true);
  assert.equal(engine.currentVisual.type, "transition-snapshot");
  assert.equal(engine.currentVisual.fit, "fill");
  assert.equal(engine.redrawCurrent(), true);
  assert.equal(engine.currentVisual.type, "scene");
  assert.equal(engine.currentVisual.fit, "contain");
  assert.equal(engine.currentVisual.position, "left top");
  globalThis.document = previousDocument;
}

// Newly validated fields reject nonsensical runtime values early.
{
  const base = normalizeOptions({});
  assert.throws(() => validateTransitionConfig("bad-fps", {
    ...base,
    source: { type: "image", src: "/frame.webp" },
    playback: { ...base.playback, maxFps: 0 }
  }), /playback\.maxFps/);
  assert.throws(() => validateTransitionConfig("bad-origin", {
    ...base,
    source: { type: "image", src: "/frame.webp" },
    playback: {
      ...base.playback,
      handoff: {
        ...base.playback.handoff,
        transform: { ...base.playback.handoff.transform, origin: "" }
      }
    }
  }), /transform\.origin/);
}

// v0.6 primary engine: ScrollTrigger owns normalized progress, auto aliases snap,
// numerical/media progress is updated from the GSAP animation playhead, and
// reverse direction can switch VideoRenderer to reverseSrc without scroll lock.
{
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    scrollY: 100,
    innerHeight: 800,
    visualViewport: { height: 800 },
    devicePixelRatio: 1
  };
  globalThis.document = {
    documentElement: { scrollHeight: 5000 },
    body: { scrollHeight: 5000 }
  };

  let mediaTween = null;
  let triggerVars = null;
  const fakeTimeline = {
    to(target, vars) {
      if (Object.prototype.hasOwnProperty.call(target, "progress")) mediaTween = { target, vars };
      return this;
    },
    fromTo() { return this; },
    kill() {}
  };
  const fakeGsap = {
    timeline: () => fakeTimeline,
    context(callback) { callback(); return { revert() {} }; },
    set() {},
    to() {},
    registerPlugin() {}
  };
  const fakeScrollTrigger = {
    maxScroll: () => 4200,
    create(vars) {
      triggerVars = vars;
      return {
        start: vars.start(),
        end: vars.end(),
        progress: 0,
        refresh() {},
        kill() {}
      };
    }
  };

  const cfg = normalizeOptions({
    scroll: { mode: "auto", snap: true, scrub: 0.08 },
    content: {
      leave: { effect: "native" },
      enter: { effect: "native" }
    }
  });
  const directions = [];
  const progressValues = [];
  const runtime = {
    name: "gsap-driver",
    config: cfg,
    destroyed: false,
    reducedMotion: false,
    progress: 0,
    targetProgress: 0,
    sceneManaged: false,
    section: { getBoundingClientRect: () => ({ top: 0, bottom: 800, height: 800 }) },
    targetSection: () => ({ getBoundingClientRect: () => ({ top: 800, bottom: 1600, height: 800 }) }),
    renderer: {
      hasDrawableFrame: () => true,
      prime() {},
      prepareForDirection(direction) { directions.push(direction); }
    },
    stage: {
      style: {},
      classList: { add() {}, remove() {} }
    },
    manager: {
      documentSnapEnabled: () => false,
      sceneEngine: { cancelTransition() {}, beginTransition() {}, commitTransition() {} }
    },
    setProgress(value) { this.progress = value; progressValues.push(value); },
    renderNow() {},
    events: { emit() {} },
    context(extra = {}) { return extra; }
  };

  const driver = new ScrollTriggerDriver(runtime, { gsap: fakeGsap, ScrollTrigger: fakeScrollTrigger });
  runtime.driver = driver;
  assert.equal(driver.mode(), "snap");
  assert.equal(driver.install(), true);
  assert.equal(triggerVars.scrub, 0.08);
  assert.deepEqual(triggerVars.snap.snapTo, [0, 1]);
  assert.equal(driver.trigger.start, 100);
  assert.equal(driver.trigger.end, 900);

  mediaTween.target.progress = 0.5;
  mediaTween.vars.onUpdate();
  assert.equal(progressValues.at(-1), 0.5);

  triggerVars.onUpdate({ direction: -1, progress: 0.5 });
  assert.deepEqual(directions, [-1]);
  driver.destroy();

  globalThis.window = previousWindow;
  globalThis.document = previousDocument;
}

// In snap:auto mode, existing CSS scroll-snap remains the landing authority;
// ScrollTrigger should not install a second competing snap animation.
{
  const cfg = normalizeOptions({ scroll: { mode: "snap", snap: "auto" } });
  const runtime = {
    config: cfg,
    manager: { documentSnapEnabled: () => true }
  };
  const driver = new ScrollTriggerDriver(runtime, { gsap: {}, ScrollTrigger: {} });
  assert.equal(driver.snapValue(), false);
}

// New mode validation: takeover is explicit, and arbitrary scroll modes fail.
{
  const base = normalizeOptions({});
  assert.doesNotThrow(() => validateTransitionConfig("takeover", {
    ...base,
    scroll: { ...base.scroll, mode: "takeover" },
    source: { type: "image", src: "/frame.webp" }
  }));
  assert.throws(() => validateTransitionConfig("bad-mode-v06", {
    ...base,
    scroll: { ...base.scroll, mode: "magic" },
    source: { type: "image", src: "/frame.webp" }
  }), /scroll\.mode/);
}

// ScrollTrigger scrub/snap modes are always progress-linked; scrub:false is
// rejected instead of silently converting the media timeline into a toggle.
{
  const base = normalizeOptions({});
  assert.throws(() => validateTransitionConfig("bad-scrub-false", {
    ...base,
    scroll: { ...base.scroll, mode: "scrub", engine: "scrolltrigger", scrub: false },
    source: { type: "image", src: "/frame.webp" }
  }), /scroll\.scrub cannot be false/);
  assert.doesNotThrow(() => validateTransitionConfig("legacy-scrub-false", {
    ...base,
    scroll: { ...base.scroll, mode: "scrub", engine: "legacy", scrub: false },
    source: { type: "image", src: "/frame.webp" }
  }));
}


// Scroll-linked reverseSrc switching is atomic: keep the forward frame visible
// while the reverse encode seeks to the equivalent logical progress, then swap.
{
  const cfg = normalizeOptions({
    scroll: { mode: "scrub" },
    playback: { videoMode: "auto" }
  });
  let renders = 0;
  const runtime = {
    destroyed: false,
    progress: 0.5,
    normalizedScrollMode: () => "scrub",
    requestRender() { renders++; },
    debug() {}
  };
  const renderer = new VideoRenderer(runtime, {
    type: "video",
    src: "/forward.mp4",
    reverseSrc: "/reverse.mp4"
  }, cfg);

  const makeVideo = () => {
    const listeners = new Map();
    let time = 0;
    return {
      duration: 2,
      readyState: 2,
      seeking: false,
      style: {},
      pause() {},
      addEventListener(name, fn) { listeners.set(name, fn); },
      get currentTime() { return time; },
      set currentTime(value) { time = value; this.seeking = true; },
      emit(name) { listeners.get(name)?.(); }
    };
  };

  renderer.ready = true;
  renderer.reverseReady = true;
  renderer.video = makeVideo();
  renderer.reverseVideo = makeVideo();
  renderer.setActiveVideo(renderer.video, { reverseAsset: false, direction: 1 });

  renderer.prepareForDirection(-1);
  assert.equal(renderer.activeVideo, renderer.video);
  assert.equal(renderer.pendingTimelineVideo, renderer.reverseVideo);
  assert.ok(renderer.reverseVideo.currentTime > 0.9 && renderer.reverseVideo.currentTime < 1.1);

  renderer.reverseVideo.seeking = false;
  renderer.reverseVideo.emit("seeked");
  assert.equal(renderer.activeVideo, renderer.reverseVideo);
  assert.equal(renderer.usingReverseAsset, true);
  assert.equal(renderer.pendingTimelineVideo, null);
  assert.equal(renders, 1);
}

// Content choreography added to the normalized ScrollTrigger master timeline
// must not extend beyond progress=1, even with many staggered elements.
{
  const records = [];
  const timeline = {
    fromTo(_element, _from, to, position) {
      records.push({ position, duration: to.duration });
      return this;
    }
  };
  const elements = Array.from({ length: 6 }, (_, i) => ({ id: i }));
  const section = { querySelectorAll: () => elements };
  const target = { querySelectorAll: () => elements };
  const cfg = normalizeOptions({
    playback: { duration: 1000 },
    content: {
      leave: { effect: "fade-up", start: 0, end: 0.2, stagger: 100 },
      enter: { effect: "fade-up", start: 0.8, end: 1, stagger: 100 }
    }
  });
  const runtime = {
    reducedMotion: false,
    section,
    config: cfg,
    targetSection: () => target
  };
  const gsap = { context(fn) { fn(); return { revert() {} }; } };
  const content = new GSAPContentTimeline(runtime, gsap, { create() {} });
  content.build(timeline);
  assert.ok(records.length > 0);
  for (const record of records) {
    assert.ok(record.position >= 0);
    assert.ok(record.position + record.duration <= 1 + 1e-9);
  }
  content.destroy();
}

// Explicit takeover keeps the old handoff-triggered content semantics.
{
  const runtime = { config: normalizeOptions({ scroll: { mode: "takeover" } }) };
  const content = new ContentAnimator(runtime);
  assert.equal(content.resolvedEnterTrigger(), "handoff");
}

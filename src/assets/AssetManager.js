import { FrameCache } from "./FrameCache.js";
import { clamp, idle, cancelIdle } from "../utils/common.js";

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

export class AssetManager {
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

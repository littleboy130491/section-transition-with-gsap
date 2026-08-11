import { clamp } from "../utils/common.js";

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
export class SceneBackgroundEngine {
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
        this.loadScene(scene).then((image) => {
          if (
            !image || this.destroyed || this.activeTransition ||
            this.currentScene !== scene || this.currentVisual !== snapshot
          ) return;
          if (!this.drawCover(image, scene)) return;
          this.currentVisual = { source: image, fit: scene.fit, position: scene.position, type: "scene" };
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

  markOwned(scene) {
    if (!scene?.element || scene.owned) return;
    this.promoteContent(scene);
    scene.element.classList.add("st-scene-owned");
    scene.owned = true;
  }

  restoreOwned(scene) {
    if (!scene?.element) return;
    scene.element.classList.remove("st-scene-owned");
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

  loadScene(scene) {
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
      if (candidate?.background) this.loadScene(candidate).catch(() => {});
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
    const image = await this.loadScene(scene);
    if (this.destroyed || serial !== this.requestSerial || this.wantedScene !== scene) return false;
    if (this.activeTransition) {
      const sourceScene = this.sceneForElement(this.activeTransition.section);
      // Keep the source visual underneath a transparent/contained transition.
      // A target scene requested just before scrub activation must not replace
      // that base while the transition is still travelling.
      if (scene !== sourceScene) return false;
    }
    if (!image) {
      // Fail open: keep authored section styling visible if its managed
      // background cannot be loaded.
      if (this.currentScene !== scene) this.hideLayer();
      return false;
    }

    if (!this.drawCover(image, scene)) return false;
    this.currentScene = scene;
    this.currentVisual = { source: image, fit: scene.fit, position: scene.position, type: "scene" };
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
        this.loadScene(sourceScene).then((image) => {
          if (!image || this.destroyed || this.activeTransition !== runtime) return;
          // Only establish the base if no valid visual is already retained.
          if (!this.currentVisual) {
            this.drawCover(image, sourceScene);
            this.currentVisual = { source: image, fit: sourceScene.fit, position: sourceScene.position, type: "scene" };
            this.currentScene = sourceScene;
            this.markOwned(sourceScene);
          }
        }).catch(() => {});
      }
    }
    const targetScene = this.sceneForElement(runtime.targetSection?.());
    if (targetScene?.background) this.loadScene(targetScene).catch(() => {});
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
      if (scene) this.markOwned(scene);
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
    this.activeTransition = null;
  }
}

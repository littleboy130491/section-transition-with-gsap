import { clamp, resolveEasing } from "../utils/common.js";

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

export class ContentAnimator {
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

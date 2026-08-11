import { clamp } from "../utils/common.js";

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
export class GSAPContentTimeline {
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

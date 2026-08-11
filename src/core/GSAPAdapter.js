let registeredGSAP = null;
let registeredScrollTrigger = null;

export function registerGSAP(gsap, ScrollTrigger) {
  if (!gsap || !ScrollTrigger) {
    throw new Error("[SectionTransition] registerGSAP() requires both gsap and ScrollTrigger");
  }
  registeredGSAP = gsap;
  registeredScrollTrigger = ScrollTrigger;
  try { gsap.registerPlugin?.(ScrollTrigger); } catch (_) {}
  return { gsap, ScrollTrigger };
}

export function resolveGSAP(options = {}) {
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

export function clearRegisteredGSAPForTests() {
  registeredGSAP = null;
  registeredScrollTrigger = null;
}

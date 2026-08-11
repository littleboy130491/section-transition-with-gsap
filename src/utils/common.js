export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function deepMerge(base, override) {
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

export function resolveDistance(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").trim().toLowerCase();
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid distance: ${value}`);
  if (raw.endsWith("vh")) return (n / 100) * window.innerHeight;
  if (raw.endsWith("vw")) return (n / 100) * window.innerWidth;
  return n;
}

export const EASINGS = {
  linear: (t) => t,
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2
};

export function resolveEasing(value) {
  if (typeof value === "function") return value;
  return EASINGS[value] || EASINGS.easeInOutCubic;
}

export function normalizeWheel(event) {
  let delta = event.deltaY;
  if (event.deltaMode === 1) delta *= 16; // line -> approximate pixels
  if (event.deltaMode === 2) delta *= window.innerHeight; // page -> pixels
  return delta;
}

export function idle(callback) {
  if ("requestIdleCallback" in window) {
    return requestIdleCallback(callback, { timeout: 500 });
  }
  return setTimeout(callback, 32);
}

export function cancelIdle(id) {
  if ("cancelIdleCallback" in window) cancelIdleCallback(id);
  else clearTimeout(id);
}

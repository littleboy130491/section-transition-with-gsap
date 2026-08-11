export class GestureDetector {
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

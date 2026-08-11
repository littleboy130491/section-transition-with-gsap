import { normalizeWheel } from "../utils/common.js";

export class InputManager {
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

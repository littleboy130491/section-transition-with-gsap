/**
 * Locks document scrolling without moving <body> into position:fixed.
 *
 * The old body-fixed strategy can invalidate sticky/snap/page-builder layout
 * calculations and is a common cause of text jumping/disappearing during a
 * fullscreen transition. Overflow locking keeps the document at its real
 * scroll position while wheel/touch/keyboard capture blocks user movement.
 */
export class ScrollLockManager {
  constructor() {
    this.locked = false;
    this.owner = null;
    this.scrollY = 0;
    this.snapshot = null;
  }

  lock(owner = null) {
    if (this.locked) return this.owner === owner;

    this.locked = true;
    this.owner = owner;
    this.scrollY = window.scrollY;

    const root = document.documentElement;
    const body = document.body;
    const scrollbarWidth = window.innerWidth - root.clientWidth;
    const computedPaddingRight = parseFloat(getComputedStyle(body).paddingRight) || 0;

    this.snapshot = {
      rootOverflow: root.style.overflow,
      rootOverscroll: root.style.overscrollBehavior,
      rootScrollBehavior: root.style.scrollBehavior,
      rootSnapType: root.style.scrollSnapType,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
      bodyScrollBehavior: body.style.scrollBehavior,
      bodySnapType: body.style.scrollSnapType,
      bodyPaddingRight: body.style.paddingRight
    };

    // Disable native snap/smooth movement while the transition owns navigation.
    root.style.scrollBehavior = "auto";
    body.style.scrollBehavior = "auto";
    root.style.scrollSnapType = "none";
    body.style.scrollSnapType = "none";
    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";

    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${computedPaddingRight + scrollbarWidth}px`;
    }

    // Some browsers adjust the viewport when overflow changes. Reassert the
    // exact position while snap is disabled.
    window.scrollTo({ top: this.scrollY, behavior: "auto" });
    return true;
  }

  unlock(targetY = this.scrollY, owner = null) {
    if (!this.locked) return false;
    if (owner && this.owner && owner !== this.owner) return false;

    const root = document.documentElement;
    const body = document.body;
    const snapshot = this.snapshot || {};
    const y = Math.max(0, targetY);

    // Move behind the still-visible transition stage while snap is disabled.
    window.scrollTo({ top: y, behavior: "auto" });

    root.style.overflow = snapshot.rootOverflow || "";
    root.style.overscrollBehavior = snapshot.rootOverscroll || "";
    body.style.overflow = snapshot.bodyOverflow || "";
    body.style.overscrollBehavior = snapshot.bodyOverscroll || "";
    body.style.paddingRight = snapshot.bodyPaddingRight || "";

    // Reassert after overflow restoration, then restore native snap behavior.
    window.scrollTo({ top: y, behavior: "auto" });
    root.style.scrollBehavior = snapshot.rootScrollBehavior || "";
    body.style.scrollBehavior = snapshot.bodyScrollBehavior || "";
    root.style.scrollSnapType = snapshot.rootSnapType || "";
    body.style.scrollSnapType = snapshot.bodySnapType || "";

    this.locked = false;
    this.owner = null;
    this.snapshot = null;
    return true;
  }
}

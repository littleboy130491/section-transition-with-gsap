# SectionTransition v0.6.0

Scene-aware image-sequence and video transitions for ordinary HTML sections.

v0.6 deliberately stops implementing its own primary scroll engine. **GSAP + ScrollTrigger own scroll progress, scrub smoothing, direction, refresh/resize, optional pinning, and snap completion.** SectionTransition keeps the parts that are specific to this project:

- persistent `data-st-scene` background canvas
- image-sequence loading and bounded decoded-frame cache
- video/sequence rendering
- forward/reverse media selection
- endpoint/background continuity
- semantic scene attributes
- diagnostics and fallback behavior

The old gesture/scroll-lock engine remains available only as explicit `mode: "takeover"` compatibility behavior.

## Requirements

Primary `scrub`, `snap`, and `auto` modes require GSAP 3.13+ with ScrollTrigger.

### Classic script tags

Load GSAP and ScrollTrigger before SectionTransition:

```html
<link rel="stylesheet" href="/section-transition/dist/section-transition.css">

<script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/ScrollTrigger.min.js"></script>
<script src="/section-transition/dist/section-transition.js"></script>
```

The browser build auto-detects `window.gsap` and `window.ScrollTrigger`.

You may also register them explicitly:

```js
SectionTransition.useGSAP(gsap, ScrollTrigger);
```

### npm / ESM

```bash
npm install section-transition gsap
```

Convenience entry:

```js
import { SectionTransition } from "section-transition/gsap";
```

Or register manually:

```js
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SectionTransition } from "section-transition";

gsap.registerPlugin(ScrollTrigger);
SectionTransition.useGSAP(gsap, ScrollTrigger);
```

GSAP is a peer dependency and is **not bundled** into SectionTransition.

---

## Recommended scrub-scene markup

The visual background belongs to the persistent scene canvas; authored HTML remains normal scrolling content.

```html
<section
  id="desk"
  class="chapter"
  data-st-scene="desk"
  data-st-background="/images/desk.webp"
  data-st-scrub="desk-to-woman"
>
  <div class="chapter__content">
    <h1>Normal HTML content</h1>
    <p>This content stays in ordinary document flow.</p>
  </div>
</section>

<section
  id="woman"
  class="chapter"
  data-st-scene="woman"
  data-st-background="/images/woman.webp"
>
  <div class="chapter__content">
    <h2>Next scene</h2>
  </div>
</section>
```

Recommended mobile section sizing:

```css
.chapter {
  min-height: 100vh;
  min-height: 100dvh;
}
```

Avoid `100svh` when the section must always cover the current mobile visual viewport; collapsed browser chrome can make the visible viewport taller than a small-viewport section.

## Basic scrub

```js
const manager = await SectionTransition.init({
  transitions: {
    "desk-to-woman": {
      source: {
        type: "sequence",
        src: "/frames/desk-woman-{frame}.webp",
        count: 120
      },

      scroll: {
        mode: "scrub",
        scrub: 0.06,
        scrubRange: "sections"
      }
    }
  }
});
```

For a viewport-height source:

```text
source aligned         progress 0
first departing pixel  progress > 0
scroll                  progress follows ScrollTrigger
next section arrives   progress 1
```

For a source taller than the viewport, the extra height scrolls naturally. The transition starts only when the source's final viewport begins leaving.

`scroll.scrub` maps directly to ScrollTrigger behavior:

```js
scroll: { scrub: true }   // exact scroll-linked progress
scroll: { scrub: 0.08 }   // 0.08s catch-up smoothing
```

The old `scroll.smoothing` option is retained as a compatibility hint, but new configurations should use `scroll.scrub`.

---

# Snap mode

`snap` is now scroll-driven instead of scroll-lock-driven.

```js
scroll: {
  mode: "snap",
  scrub: 0.06,
  snap: true
}
```

Behavior:

```text
user scrolls
    ↓
transition progress follows real scroll
    ↓
user releases
    ↓
ScrollTrigger completes to progress 0 or 1
```

Reverse is the same timeline in the opposite direction. There is no global wheel/touch `preventDefault`, document scroll lock, synthetic landing recovery, or takeover handoff.

### `mode: "auto"`

For compatibility, v0.6 treats:

```js
scroll: { mode: "auto" }
```

as an alias for:

```js
scroll: { mode: "snap" }
```

If you need the old one-gesture cinematic takeover, use `mode: "takeover"` explicitly.

### Existing CSS scroll-snap

Default:

```js
snap: "auto"
```

If the document already has CSS `scroll-snap-type`, SectionTransition lets native CSS snapping remain the landing authority and does **not** install a second ScrollTrigger snap animation.

If CSS snap is absent, `snap: "auto"` installs the default ScrollTrigger endpoint snap.

Force ScrollTrigger snapping even on a CSS-snap page:

```js
scroll: {
  mode: "snap",
  snap: true
}
```

Custom ScrollTrigger snap configuration is passed through:

```js
scroll: {
  mode: "snap",
  snap: {
    snapTo: [0, 1],
    directional: true,
    delay: 0.05,
    duration: { min: 0.2, max: 0.7 },
    ease: "power2.inOut"
  }
}
```

---

# Persistent scene background engine

One manager-owned canvas remains behind all managed scene content:

```text
HTML content                    normal document flow
────────────────────────────────────────────────────
Scene A text/buttons
Scene B text/buttons
Scene C text/buttons

Persistent visual engine        fixed behind content
────────────────────────────────────────────────────
base scene canvas
transition media host
```

At rest:

```text
canvas = Scene A background
```

During scrub/snap:

```text
Scene A background
→ transition frame 1
→ transition frame 2
→ ...
→ transition endpoint
```

At the endpoint, the exact rendered transition frame is copied to the persistent canvas **before** the transition surface is hidden. There is no separate background handoff frame.

### Scene attributes

```text
data-st-scene       readable scene name
data-st-background  static scene visual
data-st-scrub       outgoing transition config name
```

Only semantic scene relationships belong in HTML. Technical tuning stays in JavaScript.

### Fail-open ownership

SectionTransition does not remove an authored fallback background until a drawable managed background exists.

```text
authored background
→ managed scene successfully paints
→ .st-scene-owned
→ authored background becomes transparent
```

If the managed image fails, the authored page remains visible.

---

# Image sequences

```js
source: {
  type: "sequence",
  src: "/frames/frame-{frame}.webp",
  count: 160,
  start: 1,
  pad: 4
}
```

SectionTransition retains its bounded decoded-frame pipeline:

- priority loading
- max-concurrency queue
- nearby preloading
- LRU decoded-frame cache
- `ImageBitmap.close()` disposal where supported
- failed-frame backoff

These media concerns are intentionally not delegated to ScrollTrigger.

---

# Video

```js
source: {
  type: "video",
  src: "/transition-forward.mp4",
  reverseSrc: "/transition-reverse.mp4",
  trim: { start: 0.15, end: 2.8 }
},
playback: {
  range: { start: 0.02, end: 0.96 }
}
```

In `scrub`/`snap`, video is timeline-seeked from ScrollTrigger progress.

When `reverseSrc` is available, v0.6 preloads both encodes. On a direction change it pre-seeks the desired encode to the equivalent logical progress while keeping the currently composited frame visible, then swaps the visible file after the new seek is drawable. This avoids exposing time `0` during a source switch.

For highly bidirectional, frame-critical scrub, an image sequence is still the most deterministic media format.

---

# Content choreography

Content effects are now inserted into the **same GSAP timeline** as media progress. No SectionTransition-specific content RAF loop is used in normal scrub/snap mode.

```html
<h2 data-st-leave>Old message</h2>
<h2 data-st-enter>New message</h2>
```

```js
content: {
  leave: {
    effect: "fade-up",
    start: 0,
    end: 0.16,
    distance: 12
  },
  enter: {
    effect: "fade-up",
    start: 0.84,
    end: 1,
    distance: 24
  }
}
```

Supported effects:

```text
native
none
fade
fade-up
fade-down
scale
```

`native` remains the preferred default when the target content should simply enter with normal scrolling.

`content.enter.trigger: "viewport"` creates a separate ScrollTrigger for that entrance. `trigger: "auto"` uses the transition timeline in v0.6.

---

# Optional pinning

Persistent scene backgrounds normally do **not** need pinning because the visual engine itself is fixed behind ordinary content.

For a custom non-scene composition, ScrollTrigger pinning is exposed:

```js
scroll: {
  mode: "scrub",
  pin: true,
  pinSpacing: true,
  anticipatePin: 1,
  pinReparent: false
}
```

Do not enable `pinReparent` unless transformed ancestors actually break the pinned element; reparenting can affect descendant/nesting-dependent CSS.

---

# Explicit legacy takeover

The old gesture-owned behavior still exists for designs that absolutely require one wheel/touch gesture to play a time-based movie independent of scroll distance:

```js
scroll: {
  mode: "takeover",
  triggerThreshold: 24,
  lockDuringTransition: true
}
```

This compatibility mode uses the old:

- `InputManager`
- `GestureDetector`
- `TakeoverDriver`
- `ScrollLockManager`

It is intentionally **not** the default and is not recommended for ordinary mobile/snap navigation.

---

# Legacy scrub engine

If GSAP cannot be used for an old integration:

```js
scroll: {
  mode: "scrub",
  engine: "legacy"
}
```

This preserves the v0.5 compatibility driver. New implementations should use ScrollTrigger.

---

# Configuration example

```js
const manager = await SectionTransition.init({
  scene: {
    zIndex: 0,
    contentZIndex: 1,
    cacheMax: 4,
    preloadAhead: 1,
    preloadBehind: 1
  },

  render: {
    zIndex: 90,
    fit: "cover",
    position: "center center"
  },

  preload: {
    maxConcurrent: 4,
    ahead: 12,
    behind: 6
  },

  cache: {
    maxFrames: 24,
    useImageBitmap: true
  },

  transitions: {
    "desk-to-woman": {
      source: {
        type: "sequence",
        src: "/frames/desk-woman-{frame}.webp",
        count: 120
      },
      scroll: {
        mode: "scrub",
        scrub: 0.05
      }
    },

    "woman-to-idea": {
      source: {
        type: "video",
        src: "/woman-idea.mp4"
      },
      scroll: {
        mode: "snap",
        snap: "auto"
      }
    }
  }
});
```

---

# Refresh and page-builder integration

ScrollTrigger owns start/end refresh in the primary engine. SectionTransition still observes relevant source/target layout changes and calls one coordinated `ScrollTrigger.refresh()` through `manager.refresh()`.

Manual refresh after a major Elementor/AJAX layout change:

```js
manager.refresh();
```

Destroy:

```js
manager.destroy();
```

Destroy kills ScrollTriggers/timelines and reverts SectionTransition-owned scene/content state.

---

# Diagnostics

```js
console.table(manager.diagnostics());
console.log(manager.sceneDiagnostics());
```

A ScrollTrigger-driven runtime reports values such as:

```text
engine: gsap-scrolltrigger
mode: scrub | snap
startY
endY
scrub
snap
pin
progress
rawProgress
direction
overlayActive
visualReady
```

Use ScrollTrigger markers during development:

```js
scroll: {
  mode: "scrub",
  markers: true
}
```

---

# Reduced motion

When `prefers-reduced-motion: reduce` is active and `accessibility.respectReducedMotion` remains `true`, transition media is skipped and ordinary document navigation remains intact.

---

# v0.5 → v0.6 migration

The significant behavior change is:

```text
v0.5 mode:auto      gesture takeover + scroll lock
v0.6 mode:auto      alias of ScrollTrigger snap
v0.6 mode:takeover  old takeover behavior
```

See `MIGRATION.md` for the full checklist.

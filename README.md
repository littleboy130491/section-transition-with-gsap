# SectionTransition v0.6.3

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

## Aggressive mobile swipes / velocity-aware sequence scheduling

Image sequences can decode more slowly than a high-velocity mobile fling advances scroll progress. v0.6.2 keeps native scrolling untouched and adapts **media scheduling**, not the user's gesture:

```text
slow swipe       -> exact frame-by-frame requests
medium swipe     -> light frame stepping + directional preload
fast swipe       -> projected-frame preload + stale queue pruning
extreme fling    -> optional preemption of one stale low-priority request
scroll settles   -> immediately return to exact frame selection
endpoints        -> always exact
```

The driver uses ScrollTrigger's scroll velocity and projects a short distance ahead so scarce network/decode slots are spent on frames the user is actually approaching. Frames may be intentionally skipped during a fast fling; this is preferable to holding one stale frame and then jumping.

Defaults:

```js
preload: {
  maxConcurrent: 4,
  motion: {
    enabled: true,
    predictionMs: 120,
    settleMs: 120,
    mediumVelocity: 900,
    fastVelocity: 1800,
    extremeVelocity: 2800,
    adaptiveFrames: true,
    maxStep: 4,
    pruneStale: true,
    preemptStale: true,
    keepRadius: 12,
    preemptDistance: 16
  }
}
```

For heavy mobile image sequences, a small ScrollTrigger catch-up buffer is also useful:

```js
scroll: {
  mode: "scrub",
  scrub: 0.08 // try roughly 0.08-0.12 for mobile-heavy sequences
}
```

Do not solve frame starvation by blindly raising `maxConcurrent`; more simultaneous downloading/decoding can increase mobile CPU and memory pressure. Prefer responsive lower-resolution sequence assets when possible.

---

# Snap mode

`mode: "snap"` uses the v0.6.3 **glide** strategy by default. This is deliberately different from ScrollTrigger's built-in settle-after-scroll `snap`.

```js
scroll: {
  mode: "snap",
  snapStrategy: "glide",
  snapGlide: {
    duration: { min: 0.42, max: 0.72 },
    ease: "power2.inOut"
  }
}
```

Behavior:

```text
viewport is aligned at a transition boundary
    ↓
one wheel/swipe intent is detected by ScrollTrigger.observe()
    ↓
that boundary gesture is prevented
    ↓
one GSAP tween moves the real document scroll position A → B
    ↓
ScrollTrigger progress + media + content follow that same scroll tween
    ↓
target section is aligned
```

There is no `native scroll → pause → second snap animation` phase. Additional momentum events from the same wheel/trackpad/swipe gesture are absorbed until the gesture stops, preventing accidental multi-section skipping.

The glide controller only claims input at an eligible boundary. In a section taller than the viewport, ordinary scrolling remains native until its final viewport reaches the outgoing transition boundary. Nested scroll containers are also allowed to consume their own scroll first.

### CSS scroll-snap

Glide mode must have a single motion authority. By default it temporarily suppresses root/body `scroll-snap-type` and `scroll-behavior` while the manager is active, then restores the exact previous inline values/priorities on `destroy()`.

```js
scroll: {
  mode: "snap",
  snapStrategy: "glide",
  snapGlide: {
    disableCssSnap: true // default
  }
}
```

Do not rely on CSS `scroll-snap-type` for the same scene chain when glide mode is active. `scroll-snap-align` declarations may remain in your stylesheet; without an active snap container they do nothing.

### Legacy settle strategy

If you intentionally want the old ScrollTrigger/native settle-after-scroll behavior, opt into it explicitly:

```js
scroll: {
  mode: "snap",
  snapStrategy: "settle",
  scrub: 0.08,
  snap: {
    snapTo: [0, 1],
    directional: true,
    inertia: false,
    delay: 0,
    duration: { min: 0.12, max: 0.28 }
  }
}
```

`settle` is kept for compatibility. It is not recommended when the desired interaction is one continuous section-to-section motion.

### `mode: "auto"`

For compatibility, `auto` remains an alias of `snap`, so in v0.6.3 it also uses the glide strategy unless `snapStrategy: "settle"` is explicitly configured.

The older cinematic media takeover is still available as:

```js
scroll: { mode: "takeover" }
```

### Snap glide tuning

```js
scroll: {
  mode: "snap",
  snapGlide: {
    inputTolerance: 8,
    dragMinimum: 6,
    boundaryTolerance: 18,
    duration: { min: 0.42, max: 0.72 },
    ease: "power2.inOut",
    onStopDelay: 0.18,
    keyboard: true
  }
}
```

The animation duration scales modestly with the travel distance. Keep it relatively short; overly long values can make section navigation feel detached from the gesture.

`manager.snapDiagnostics()` reports whether the glide observer is installed, whether a glide is currently animating, and whether CSS snap suppression is active.

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

### Continuous scene ownership and cold-start loading

The persistent canvas becomes the single visual owner only after the initially visible scene has produced a drawable image. Until then, authored section styling remains untouched.

Once that first visual exists, **all sections with `data-st-background` become transparent surfaces together**. This is important: an incoming section must not cover the persistent canvas with its own background color/image while its static endpoint is still loading.

```text
page starts
→ authored styling remains available
→ current scene loads + paints on persistent canvas
→ persistent surface becomes ready
→ all data-st-background sections become transparent
→ current/next backgrounds continue warming behind the transition
```

The current scene and immediately-next scene are requested with high fetch priority. Farther scene preloads remain normal priority. If a managed background ultimately fails, that individual section drops persistent-surface ownership so its authored CSS can fail open.

For a completely clean **cold first paint**, the browser still needs the first image bytes before either CSS or canvas can show them. Preload only the first critical scene in `<head>` (do not preload every scene):

```html
<link
  rel="preload"
  as="image"
  href="/images/desk.webp"
  fetchpriority="high"
>
```

For large immersive sites, a lightweight page loading cover that is removed after `await SectionTransition.init(...)` is also reasonable. Avoid blocking on every scene/sequence frame.

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
    behind: 6,
    motion: {
      enabled: true,
      predictionMs: 120,
      maxStep: 4
    }
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
        snapStrategy: "glide"
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
v0.6.3 mode:auto    alias of one-phase GSAP Observer glide
v0.6 mode:takeover  old takeover behavior
```

See `MIGRATION.md` for the full checklist.

# SectionTransition v0.6 Architecture

## v0.6.3 snap glide

`ScrollTriggerDriver` still maps actual document scroll to normalized media/content progress, but it no longer asks ScrollTrigger to perform endpoint snapping in the default snap strategy.

`SnapGlideController` uses `ScrollTrigger.observe()` as the input-intent layer. It conditionally prevents wheel/touch input only when the document is already at an eligible section boundary, then creates one GSAP tween of the real document scroll position. This makes scroll position, transition progress, scene background, and content timeline one continuous motion.

CSS scroll snap is suppressed during glide ownership so there is never a second landing authority. The old ScrollTrigger snap implementation is retained as `snapStrategy:"settle"`.

Tall authored sections are not captured until their outgoing final-viewport boundary; nested scrollable descendants also retain priority while they can still scroll.


## Design principle

Do not reinvent generic scroll orchestration.

```text
GSAP ScrollTrigger owns
────────────────────────────────
scroll position → normalized progress
scrub catch-up
scroll direction
refresh/resize measurements
snap completion
optional pinning
content timeline interpolation

SectionTransition owns
────────────────────────────────
scene semantics
persistent background canvas
sequence frame loading/cache
video/sequence rendering
media endpoint continuity
fallback/readiness
transition diagnostics
```

## Primary graph

```text
Manager
├── GSAPAdapter
│   └── GSAP + ScrollTrigger (peer dependency)
├── SceneBackgroundEngine
│   ├── persistent base canvas
│   ├── static-scene cache
│   └── transition media host
└── TransitionRuntime
    ├── ScrollTriggerDriver
    │   ├── normalized GSAP timeline
    │   └── GSAPContentTimeline
    └── Renderer
        ├── SequenceRenderer
        │   └── AssetManager
        │       └── FrameCache (bounded LRU)
        └── VideoRenderer
```

## Compatibility graph

Only explicit compatibility modes instantiate the old infrastructure:

```text
mode: takeover
├── InputManager
├── GestureDetector
├── ScrollLockManager
├── TakeoverDriver
└── ContentAnimator

scroll.engine: legacy
└── ScrubDriver
```

Normal scrub/snap does not attach non-passive global wheel/touch handlers and does not lock document scrolling.

## Progress contract

The primary runtime contract is still:

```js
runtime.setProgress(value); // 0..1
```

But ScrollTrigger is now the authority that decides `value`.

A normalized GSAP timeline always has duration `1`:

```text
0.00                                      1.00
│──────────────────────────────────────────│
media proxy progress
source content leave
optional target content enter
```

For numerical `scrub`, media is updated from the **GSAP animation playhead**, not raw `ScrollTrigger.progress`, so the renderer follows the smoothed playhead correctly.

## Velocity-aware sequence scheduling

ScrollTrigger remains the only scroll authority. v0.6.2 uses `ScrollTrigger.getVelocity()` purely as a media-loading hint:

```text
ScrollTrigger raw progress + velocity
              │
              ├─> short projected progress
              │
              ▼
SequenceRenderer adaptive display index
              │
              ▼
AssetManager motion scheduler
  exact requested > predictive > nearby > progressive
              │
              ├─ prunes stale queued work on fast flings
              └─ may preempt one stale low-priority active request at extreme velocity
```

This layer never calls `preventDefault()`, changes scroll position, or changes ScrollTrigger progress. Its only job is to spend bounded download/decode concurrency on useful future frames. After a short quiet period, velocity is reset to zero and exact frame selection resumes. Endpoints are never quantized.

## Geometry

For a source section:

```text
sourceTop
sourceBottom
viewportHeight
```

Transition start:

```text
max(sourceTop, sourceBottom - viewportHeight)
```

Therefore:

- viewport-height source: starts on first departing pixel
- tall source: extra content scrolls normally; transition starts on its final viewport

Default end is the target section's document top, clamped to real maximum scroll. `scrubRange: "distance"` may supply an explicit distance.

These values are functions passed to ScrollTrigger and are recalculated on refresh.

## Snap architecture

`snap` and `auto` use the same scroll-linked timeline as scrub.

```text
native scroll
→ ScrollTrigger progress
→ media progress
→ user releases
→ endpoint snap
```

`scroll.snap: "auto"` follows one-authority behavior:

- if host CSS scroll-snap exists: browser CSS snap owns landing
- otherwise: ScrollTrigger endpoint snap owns landing

The package does not intentionally run CSS snap and a second JS snap simultaneously by default.

## Scene-background invariant

Managed scene HTML is never wrapped/reparented.

```text
scene HTML/content          authored flow
persistent scene engine    body-level fixed visual surface
```

A scene root is made transparent only after the persistent engine has a drawable visual.

## Endpoint invariant

The transition surface may not disappear until the exact endpoint is drawable.

At endpoint:

```text
transition endpoint media
→ copied into persistent canvas
→ transition surface hidden
```

If endpoint media is late, the last valid composited frame remains visible rather than exposing an empty/black layer.

## Video direction changes

For scroll-linked video with `reverseSrc`:

```text
direction changes
→ keep currently composited file visible
→ pre-seek desired encode to equivalent logical progress
→ wait until seeked/decoded
→ atomically switch visible encode
```

This avoids showing time `0` of the reverse file while it is seeking.

Without `reverseSrc`, backward progress still requires backward seeking of the forward encode and remains codec/keyframe dependent.

## Refresh lifecycle

ScrollTrigger performs its own resize refresh. SectionTransition additionally coordinates refresh when:

- observed source/target dimensions change
- fonts become ready
- page `load` completes
- host explicitly calls `manager.refresh()`

`manager.refresh()` resizes media/scene canvases and calls one `ScrollTrigger.refresh()` for the primary engine.

## Destruction

Destroy order:

```text
kill ScrollTrigger/timeline
→ revert GSAP content context
→ cancel transition scene ownership
→ destroy renderer/assets
→ remove stage/anchor
→ restore scene-owned authored styles
```

No scroll lock exists in the primary path, so there is no landing/unlock restoration phase.

# AI Agent Guide — SectionTransition v0.6

## v0.6.3 snap invariant

Do not re-enable ScrollTrigger `snap` or CSS `scroll-snap-type` on a transition using the default `snapStrategy:"glide"`. Glide is intentionally single-authority: Observer claims one eligible boundary gesture and one GSAP document-scroll tween drives the entire section transition.

Do not globally prevent wheel/touch events. `SnapGlideController` is intentionally conditional: input away from a transition boundary, inside a tall section, or inside a nested scroll container that can still scroll must remain native.

If a client explicitly wants settle-after-scroll behavior, use `snapStrategy:"settle"`; do not combine the two strategies.


## Non-negotiable architecture

Do **not** add new custom scroll-position/snap/smoothing logic to the primary engine.

Primary `scrub`, `snap`, and `auto` are driven by GSAP ScrollTrigger.

SectionTransition-specific code may own:

- scene/background semantics
- media loading/caching
- renderer progress mapping
- visual readiness and endpoint commit
- diagnostics

ScrollTrigger must remain responsible for:

- start/end refresh
- scrub smoothing
- direction
- snap
- optional pinning

## Mode semantics

```text
scrub      ScrollTrigger continuous timeline
auto       alias of snap
snap       ScrollTrigger/CSS snap completion
takeover   explicit legacy gesture/scroll-lock compatibility
```

Never silently route `auto` back to `TakeoverDriver`.

## GSAP dependency

Do not bundle GSAP into `dist/section-transition.js`.

Classic build resolves:

```text
window.gsap
window.ScrollTrigger
```

or explicit:

```js
SectionTransition.useGSAP(gsap, ScrollTrigger)
```

Bundlers may use `section-transition/gsap`.

## ScrollTrigger playhead

If numerical scrub is enabled, do not render from raw `ScrollTrigger.onUpdate.progress`. ScrollTrigger documents that the animation may continue catching up after scroll stops. Media must render from the GSAP timeline/proxy `onUpdate` playhead.

## CSS snap

Do not install a second default JS snap when `snap:"auto"` and the document already has CSS `scroll-snap-type`.

## Scene engine

Never wrap, move, clone, or reparent authored scene sections for scrub.

The persistent scene engine owns visual backgrounds only after a drawable visual exists. Preserve authored CSS fallback on media failure.

## Media readiness

Never expose a transition stage with an empty canvas/undecoded video.

First exposure requires the exact current visual to be drawable.

## Endpoint commit

Never hide transition media first. Commit the exact endpoint into the persistent canvas, then hide the transition surface.

## Video reverse

`reverseSrc` is a media feature, not a scroll feature.

For ScrollTrigger modes, direction switching must keep the old visible frame until the alternate encode has seeked to equivalent logical progress. Do not immediately show reverse video at time `0`.

## Content

Do not reintroduce a custom content RAF loop in the primary path. Add content effects to the GSAP timeline or create a separate ScrollTrigger for `trigger:"viewport"`.

`ContentAnimator` exists only for takeover/legacy compatibility.

## Takeover compatibility

`InputManager`, `GestureDetector`, `ScrollLockManager`, and `TakeoverDriver` may only be initialized when at least one runtime explicitly uses `mode:"takeover"`.

## Tests required for driver changes

At minimum verify:

- `auto` normalizes to snap
- scrub media follows GSAP animation playhead
- numeric scrub is passed through
- CSS snap auto-detection suppresses duplicate ScrollTrigger snap
- reverse direction calls media direction preparation
- destroy kills ScrollTrigger and timeline
- no takeover input/scroll lock is created for normal scrub/snap
- scene endpoint commit remains exact

## Scene cold-start / incoming-section ownership (v0.6.1)

Do not independently reveal/hide authored backgrounds for each `data-st-background` section once the persistent scene surface is ready. The engine intentionally makes all managed background sections transparent together after the first drawable canvas visual exists; otherwise an incoming section background can cover the continuous canvas while its endpoint is still warming.

The current and next static scene backgrounds are high-priority requests. For the very first network paint, prefer one `<link rel="preload" as="image" ... fetchpriority="high">` for the initial scene or a host-level loading cover. Do not preload all scene backgrounds or all sequence frames.


## v0.6.2 fast-swipe invariant

For sequence scrub/snap, never solve aggressive mobile flings by taking scroll ownership. The primary engine must remain ScrollTrigger/native-scroll driven. Use `ScrollTrigger.getVelocity()` only to influence AssetManager scheduling.

Required invariants:

- frame 0 and the final effective frame are exact; never quantize endpoints
- slow/stationary scrub uses step 1
- stale queued nearby/progressive work may be discarded on a fast directionally decisive fling
- already-active requests are preempted only conservatively (extreme tier, low priority, clearly behind, at most one decision at a time)
- after the quiet/settle timer, reset velocity and request the exact stationary frame
- do not increase network concurrency dynamically as a substitute for prioritization
- diagnostics should expose velocity/projected progress/adaptive step for field debugging

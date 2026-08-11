# AI Agent Guide — SectionTransition v0.6

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

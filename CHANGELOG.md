# Changelog

## 0.6.0

GSAP ScrollTrigger engine refactor.

- replaced the primary custom ScrubDriver/AutoDriver scroll orchestration with `ScrollTriggerDriver`
- `scrub`, `snap`, and compatibility alias `auto` now use GSAP ScrollTrigger progress/refresh/direction/snap
- `mode: "auto"` now aliases `snap`; old one-gesture behavior moved to explicit `mode: "takeover"`
- normal scrub/snap no longer initializes global non-passive wheel/touch interception or ScrollLockManager
- added `SectionTransition.useGSAP(gsap, ScrollTrigger)` and automatic classic-global detection
- added `section-transition/gsap` ESM convenience entry and `gsap >=3.13.0` peer dependency
- numerical `scroll.scrub` drives media from the GSAP animation playhead so catch-up smoothing remains synchronized
- `snap: "auto"` avoids double snapping: existing CSS scroll-snap remains authoritative; otherwise ScrollTrigger endpoint snap is installed
- added optional ScrollTrigger pin/pinSpacing/pinReparent/anticipatePin/markers/fastScrollEnd/preventOverlaps passthrough
- content leave/enter effects are added to the same GSAP timeline instead of using the custom ContentAnimator RAF in primary modes
- viewport content entrances use ScrollTrigger
- retained persistent SceneBackgroundEngine, AssetManager, FrameCache, SequenceRenderer, and VideoRenderer
- improved scroll-linked `reverseSrc` switching: pre-seek alternate encode at equivalent logical progress while old frame remains composited, then swap after seek readiness
- retained old ScrubDriver as `scroll.engine:"legacy"` compatibility and renamed old AutoDriver to TakeoverDriver
- added migration guide and ScrollTrigger-specific regression coverage
- creates mixed-discovery ScrollTriggers in authored DOM order so optional upstream pin spacing refreshes downstream triggers predictably
- primary scrub/snap rejects `scroll.scrub:false`; use `true` for direct progress or a positive catch-up duration
- fixed explicit takeover initialization/content-handoff compatibility after the driver split

## 0.5.1

- Hardened declarative scene discovery with explicit DOM ordering and legacy `data-st-bg` discovery.
- Added retry/backoff gating for failed static scene backgrounds (1s, 5s, then stop), preventing repeated 404 requests during scroll updates.
- Made scene-cache eviction explicitly protect both current and wanted scenes.
- Compatibility sticky scrub now excludes **all** generated `.st-scrub-track` elements when measuring authored max scroll height.
- Compatibility sticky-track positioning now uses rendered document geometry instead of `offsetParent` math.
- Sequence resize can preserve an already-painted frame even after that decoded frame has been evicted, while still updating the DPR backing store immediately.
- Transition endpoint snapshots are temporary continuity surfaces and hydrate back to the authored scene image/fit/position when available.
- Content choreography restores non-owned `translate`/`scale` properties when switching effects.
- Cross-origin sequence assets without explicit CORS intent skip the doomed fetch/ImageBitmap attempt and load directly through `<img>`.
- Added validation for `playback.maxFps` and `playback.handoff.transform.origin`.
- Removed a duplicate `TransitionRuntime.content` initialization.
- Added regressions for scene order, background failure backoff, protected cache eviction, multi-track scroll-height isolation, evicted-frame resize preservation, effect switching, cross-origin request behavior, and endpoint scene hydration.

## 0.5.0

Persistent scrub-scene background engine.

- added semantic scene attributes: `data-st-scene`, `data-st-background`, and `data-st-scrub`
- added one manager-owned persistent background layer for declarative scrub scenes
- scene roots keep their authored DOM/content and normal scrolling; the package owns only visual background/media surfaces
- static scene backgrounds are painted to one persistent canvas and nearby scenes are preloaded with a small bounded cache
- background ownership is fail-open: authored CSS backgrounds are suppressed only after a drawable canvas visual exists
- scene content roots are promoted above the persistent canvas without rewriting authored sticky/fixed/absolute positioning
- scrub transition surfaces are transparent and live inside the persistent scene media host instead of using a sticky/fixed body overlay
- exact transition endpoints are copied into the persistent scene canvas before transition media is hidden, removing the visual handoff gap
- endpoint snapshots survive dynamic viewport/canvas backing-store resizing
- reverse scrub commits the first transition frame back to the source scene using the same endpoint rule
- added `scroll.scrubEngine: "auto" | "scene" | "sticky" | "legacy"`; `auto` selects the scene engine for registered scenes and retains v0.4 sticky scrub for other integrations
- scene discovery also accepts sections that only carry `data-st-background` or `data-st-scrub`; `data-st-scene` remains recommended for readable names
- auto/snap playback architecture remains separate and unchanged
- added tests for scene-engine configuration, endpoint commit ownership, bundle/CSS surface presence, and backward-compatible scrub fallback

## 0.4.0

- redesigned default scrub as a native CSS sticky-track engine instead of a JS-simulated fixed body overlay
- authored source/target sections remain untouched; scrub injects only a zero-height anchor plus an out-of-flow body-level track
- scrub stage is never portaled/reparented while scrolling; browser layout owns viewport attachment
- generated track adds no document flow height and excludes itself while measuring authored maximum scroll
- scrub endpoint is clamped to the real maximum scroll position, preventing short final sections from creating unreachable progress or extra blank scroll
- track height uses `100dvh` so mobile browser chrome changes update sticky constraints natively
- retained exact-frame first-exposure gating, targeted prewarming, last-valid-frame preservation, and canvas resize safety from v0.3.11
- auto/snap engine remains unchanged and continues to use a temporary fixed body portal during playback
- legacy `scrubStart: "after"` spacer scrub remains available for backward compatibility

## 0.3.11

Scrub first-frame readiness and black-flash hardening.

- scrub overlay now has a strict first-exposure gate: the fixed stage is never shown until the renderer has a drawable frame for the current scrub position
- late media is fail-open: normal page content remains visible and scrolling is never blocked while the requested frame is loading/decoding
- sequence scrub requires the exact current frame for first exposure; a distant cached critical frame cannot accidentally become the opening visual
- once the overlay is active, the last valid frame remains visible while later frames decode, avoiding visibility flicker during ordinary scrubbing
- nearby scrub boundaries cheaply prewarm only the boundary/current frame; existing IntersectionObserver/critical preload policy still controls broader loading
- blank `alpha:false` sequence canvases remain hidden until the first real frame has been painted
- resizing an active sequence canvas preserves and synchronously redraws the last cached frame when the backing store changes, preventing resize-time full-screen black flashes
- if an active canvas cannot safely preserve its displayed frame, backing-store resize is deferred and CSS temporarily scales the existing frame instead of clearing it
- sequence FPS throttling now schedules the deferred repaint, so an exact frame that finishes decoding just after a draw is not lost when scrolling stops
- scrubbed video distinguishes metadata readiness from visual readiness; first exposure waits for `loadeddata`/a settled seekable frame instead of showing an undecoded video surface
- scrub diagnostics now include `overlayWanted`, `visualReady`, and `exactVisualReady`
- added regression coverage for late first frames, no-black fail-open behavior, exact-frame activation, active-overlay continuity, resize preservation, and video metadata-vs-frame readiness

## 0.3.10

Mobile scrub viewport rendering fix.

- fixed a transient black strip that could appear while mobile browser chrome collapses/expands during an active image-sequence scrub
- scrub canvas CSS now remains `width: 100%; height: 100%` relative to the fixed transition stage instead of being pixel-locked to `window.innerHeight`
- canvas backing-store dimensions now prefer the live stage box / `visualViewport` before falling back to `innerWidth` / `innerHeight`
- fixed scrub overlay sizing now relies on `position: fixed; inset: 0` with `height: auto`, avoiding redundant `100dvh` constraints during compositor viewport animation
- this fix changes only media surface sizing; scrub progress, source/target geometry, and host section heights are unchanged
- added a regression test for a stage whose live visual height is larger than stale `window.innerHeight`

## 0.3.9

Layout-neutral scrub architecture release.

- scrub mode now uses the real source/target DOM geometry instead of creating transition height by default
- the first scroll pixel leaving a viewport-height source immediately advances media progress
- tall source sections remain naturally scrollable; scrub begins when their final viewport starts leaving
- reverse scrubbing is symmetric and starts on the first upward pixel from the target boundary
- added `scroll.scrubRange: "sections" | "distance"`; `sections` is the new default
- `scrubRange: "sections"` ends progress at the live target section top; `distance` allows an explicit custom scrub span without adding layout
- default scrub spacer is now a zero-height JS-owned anchor; only the media stage is portaled/fixed while progress is between 0 and 1
- legacy sticky/spacer scrub remains available with `scroll.scrubStart: "after"`
- added configuration-only `from` / `to` selectors (or DOM elements), so existing HTML does not require `data-exit-transition` attributes
- `to` is optional; when omitted, the next real sibling remains the target for backward compatibility
- ResizeObserver now also watches explicit target sections, and visualViewport resize events trigger remeasurement
- scrub diagnostics expose live start/end/distance geometry
- smoothed scrub now keeps the fixed stage visible until rendered progress truly settles at 0/1, preventing a boundary-frame flash
- updated scrub example, architecture guide, AI-agent rules, and regression tests for the new model

## 0.3.8

- Fix reverse handoff landing after returning from oversized (`>100vh`) snap sections.
- Recompute destination coordinates from live DOM geometry at handoff time instead of relying only on init-time measurements.
- Add post-unlock snap stabilization: while the final media frame still covers the viewport, the runtime waits for native CSS scroll-snap settling and reasserts the intended landing if the browser drifts.
- Add `playback.handoff.settleFrames` (default `3`) and `landingTolerance` (default `1px`).
- Debug diagnostics now report landing drift, correction count, destination height, viewport height, and whether the destination itself is shorter than the viewport.
- Documentation clarification: fullscreen host sections that must track the changing mobile visual viewport should prefer `min-height: 100vh; min-height: 100dvh;`. `100svh` can expose the next section after browser chrome collapses because it remains based on the small viewport. This is host-site layout behavior; core package CSS intentionally does not force section heights.

## 0.3.6

Smooth reversible-video release.

- fixed the real cause of "reverse freezes on the final frame, then jumps back": backward `currentTime` seeking on ordinary compressed MP4s is not reliably decodable in real time
- added optional `source.reverseSrc` for a dedicated pre-reversed video asset
- reverse auto playback now plays `reverseSrc` **forward natively** while runtime progress travels `1 -> 0`
- added `source.reverseTrim`, `source.reversePlaybackRate`, and `playback.reverseRange`
- preloads reverse-video metadata during initialization so reverse playback is ready at the boundary
- switches/prepositions the correct encoded file before the fixed transition stage becomes visible
- keeps legacy backward timeline seeking when no `reverseSrc` exists, but diagnostics now identify that fallback as `timeline-seek`
- preserved the v0.3.5 direct source-boundary snap recovery and between-boundaries recovery behavior
- added regression tests proving reverse media time moves monotonically forward while transition progress moves backward
- added regression coverage for reverse-video config validation and native reverse media-clock progress

## 0.3.4

Content choreography and layering release.

- added opt-in source-content leave choreography synchronized to transition progress
- added target-content enter choreography for auto handoff or viewport entry
- added `native`, `fade`, `fade-up`, `fade-down`, and `scale` content effects
- added selector-based content targeting with `data-st-leave` / `data-st-enter` defaults and `selector: "self"` support
- forward/reverse auto navigation now swaps source/target content roles correctly
- content inline styles are restored on complete, reverse, skip, failure, and destroy
- content effects use CSS translate/scale longhands so plain fades do not overwrite Elementor `transform`
- replaced the hardcoded `z-index: 2147483000` with configurable `render.zIndex` (default `900`) and `--st-z-index`
- added validation and regression coverage for choreography and layering options

## 0.3.3

Transition synchronization and visual endpoint alignment release.

- added video `source.trim` in encoded-video seconds
- added normalized `playback.range` for video and image-sequence endpoint selection
- made sequence critical preloading honor the selected playback range
- added progress-driven handoff transform alignment (`scale`, `x`, `y`, `origin`)
- added configurable handoff `paintFrames`, `hold`, and `fade`
- native video now reports real media-clock progress so endpoint transforms stay synchronized
- native video honors trim/range and stops at the configured effective endpoint instead of requiring the encoded file to end
- reverse playback naturally unwinds endpoint alignment
- added validation and regression tests for trim/range/alignment options

## 0.3.2

- Auto transitions are layout-neutral (0px spacer) and no longer insert a fake 100vh section.
- Added snap-aware boundary detection with `scroll.snap: "auto" | true | false`.
- Replaced body `position: fixed` scroll locking with overflow-based locking to avoid Elementor/sticky/snap layout invalidation.
- Added two-phase visual handoff: fade into the transition, move the document behind the final frame, wait for target paint, then fade out.
- Auto transitions remain input-owned while the final handoff is settling.
- `navigateTo()` now uses the real auto boundary instead of the removed spacer geometry.
- Native auto-video reverse playback now correctly uses timeline seeking.


## 0.3.1

Lifecycle and loading hardening release.

- prevented overlapping `auto` playback attempts while media readiness is pending
- made pending playback count as active input ownership
- added manager-level auto playback ownership so two transitions cannot play concurrently
- restored portaled fullscreen stages safely during completion, skip, error, and `destroy()`
- cancel native-video completion promises on destroy/cancellation
- made video metadata preparation timeout-bounded
- made sequence critical preparation timeout-bounded
- added abortable image requests and bounded retry/backoff for failed frames
- routed critical/requested/nearby/progressive image loads through one priority queue honoring `preload.maxConcurrent`
- made gesture threshold/timeout/cooldown truly per-transition
- honored per-transition `preload.intersectionMargin` values
- implemented `scroll.lockDuringTransition: false`
- skipped transition-media downloads entirely when reduced motion is requested
- added ESM package entrypoint while retaining the browser IIFE build
- expanded automated tests for concurrency, failure backoff, pending-play races, cancellation, and ESM import
- documented that responsive mobile overrides are selected at initialization rather than hot-swapped on resize

## 0.3.0

Production-hardening release.

- separated progress drivers from renderers
- added bounded LRU decoded-frame cache
- added ImageBitmap decode/disposal path with Image fallback
- added critical frame readiness strategy
- added slow-network wait/skip behavior
- normalized wheel delta modes
- added gesture timeout and momentum cooldown
- added touch and keyboard auto navigation
- added robust temporary scroll locking
- added automatic ResizeObserver/font/load remeasurement
- added visibility pause/resume for auto timelines
- added video native/timeline playback selection
- added lifecycle events and structured error context
- added config validation
- added diagnostics API
- added explicit `navigateTo()`
- added fallback renderer chain (video/static image/skip)
- added mobile overrides and Save-Data/slow-network adaptation
- throttled background image request concurrency
- preserved native-video playback across tab visibility changes
- added comprehensive architecture/AI/testing documentation
- fixed canonical source/dist packaging structure

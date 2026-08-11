# SectionTransition v0.6 Testing

## Automated

```bash
npm test
npm run build
npm pack --dry-run
```

Automated coverage should include:

- bounded frame cache and frame-load concurrency
- velocity-aware queue promotion/pruning and adaptive sequence stepping
- failed frame/background backoff
- SceneBackgroundEngine ordering/ownership/cache eviction
- ScrollTriggerDriver scrub/snap configuration
- numerical scrub media playhead callback
- `mode:auto` → snap alias
- CSS-snap `snap:auto` single-authority behavior
- explicit takeover compatibility
- video reverseSrc timeline source switching
- content timeline configuration/cleanup
- ESM and browser bundle smoke assertions

## Browser matrix

Test at minimum:

```text
Chrome desktop
Firefox desktop
Safari desktop
Chrome Android
Safari iOS
```

### Scrub scene

1. Load at top with mobile browser chrome visible.
2. Scroll 1px away from a `100dvh` source.
3. Verify media immediately advances.
4. Stop/reverse repeatedly mid-transition.
5. Verify no black frame, background overlap, or HTML jump.
6. Collapse/expand browser chrome while scrubbing.
7. Verify canvas still covers the visual viewport.

### Tall source

1. Source `min-height: 160dvh`.
2. Verify first ~60dvh is normal content scrolling.
3. Verify transition starts only on the final source viewport.

### Snap

Test both:

```text
host CSS scroll-snap enabled + snap:"auto"
host CSS scroll-snap disabled + snap:true
```

Verify only one snapping system owns the landing.

### Rapid input

Flick through multiple transitions with trackpad/touch momentum. There should be no custom wheel/touch prevention in scrub/snap mode and no document overflow lock.

### Reverse video

With `reverseSrc`:

1. Enter transition forward to ~60%.
2. Reverse direction.
3. Verify old composited frame remains until reverse encode has seeked.
4. Verify no flash of reverse video time `0`.

Without `reverseSrc`, document that backward MP4 seeking remains codec/keyframe dependent.

### Reduced motion

Enable `prefers-reduced-motion: reduce`; verify ordinary document navigation and no unnecessary transition-media download.

## Development markers

Use:

```js
scroll: { markers: true }
```

for ScrollTrigger start/end debugging. Remove markers in production.

## Persistent scene cold-load regression (v0.6.1)

Test with cache disabled / Slow 3G:

1. Start on a `data-st-background` scene.
2. Confirm authored styling remains until the first persistent canvas visual is drawable.
3. Once the canvas owns the surface, scroll so the next scene is partially visible before its own static background finishes loading.
4. The incoming section must remain transparent; it must not expose its authored background color/image over the shared canvas.
5. Confirm current + next scene image requests receive high fetch priority where supported.
6. Force a later scene background to 404. That individual scene should fail open to authored CSS without making every managed scene opaque again.


## Aggressive mobile sequence fling regression (v0.6.2)

Use a real multi-frame sequence with DevTools cache disabled and CPU/network throttling.

1. Slowly scrub forward and backward; verify exact frame-by-frame response.
2. Fling forward aggressively inside the trigger. Scroll itself must remain native and responsive.
3. The visual may skip intermediate frames, but it must keep advancing rather than freeze on one stale frame.
4. Repeat in reverse.
5. Stop abruptly mid-transition; within `preload.motion.settleMs`, diagnostics should report `velocity: 0` / `adaptiveStep: 1` and the exact stationary frame should replace any coarse frame.
6. Fling completely through the endpoint; frame 0 / last frame must be exact before scene endpoint commit.
7. Inspect diagnostics: projected progress should lead raw progress in the fling direction and queued indexes should move toward that projected region rather than accumulating behind it.
8. Repeat on Chrome Android and Safari iOS with browser chrome expanding/collapsing.

Recommended test config:

```js
scroll: { mode: "scrub", scrub: 0.08 },
preload: {
  maxConcurrent: 4,
  motion: { enabled: true, predictionMs: 120, maxStep: 4 }
}
```


## Snap glide regression (v0.6.3)

Verify on desktop wheel, precision trackpad, Android touch, and iOS touch:

1. From a fullscreen source boundary, one forward gesture produces one continuous source→target movement with no pause in the middle.
2. Reverse gesture produces the same single-phase motion backward.
3. Continued momentum from the original gesture does not advance a second section.
4. A section taller than the viewport scrolls natively until its final viewport reaches the outgoing boundary.
5. At the top of a tall target, forward input remains native into the tall content while reverse input can return to the previous scene.
6. A nested scroll container consumes wheel/touch while it can still scroll.
7. Root/body CSS `scroll-snap-type` is `none` while glide owns snap and is restored exactly after `manager.destroy()`.
8. ArrowDown/PageDown/Space and reverse keyboard equivalents glide only when a valid boundary is active; form/editable controls remain unaffected.
9. `snapStrategy:"settle"` continues to use the old ScrollTrigger snap configuration for compatibility.

Use `manager.snapDiagnostics()` while debugging.

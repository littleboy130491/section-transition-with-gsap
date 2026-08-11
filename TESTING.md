# SectionTransition v0.6 Testing

## Automated

```bash
npm test
npm run build
npm pack --dry-run
```

Automated coverage should include:

- bounded frame cache and frame-load concurrency
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

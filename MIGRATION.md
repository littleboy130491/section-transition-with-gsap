# Migrating to v0.6.3

## v0.6.2 → v0.6.3 snap behavior

The default `snap` strategy changed because ScrollTrigger/native snapping is inherently a settle-after-scroll interaction and can feel like `scroll → stop → continue`.

Old default behavior can be retained explicitly:

```js
scroll: {
  mode: "snap",
  snapStrategy: "settle"
}
```

The new default is:

```js
scroll: {
  mode: "snap",
  snapStrategy: "glide"
}
```

Glide mode temporarily disables root/body CSS scroll snap while the manager exists. Remove any JavaScript that manually toggles CSS snap for the same scene chain. CSS values are restored on `manager.destroy()`.

`mode:"auto"` remains an alias for `snap`, so it now uses glide too. Use `mode:"takeover"` only when you specifically need the old media-takeover engine.

---

# Migration: v0.5.x → v0.6.0

## 1. Load GSAP + ScrollTrigger

Classic browser pages must load GSAP and ScrollTrigger before SectionTransition.

ESM users may import:

```js
import { SectionTransition } from "section-transition/gsap";
```

## 2. `mode: "auto"` changed meaning

v0.5:

```js
scroll: { mode: "auto" }
```

meant gesture interception + scroll lock + time-based takeover.

v0.6:

```js
scroll: { mode: "auto" }
```

is an alias of:

```js
scroll: { mode: "snap" }
```

It follows real scroll progress and completes using CSS/ScrollTrigger snapping.

To retain old behavior:

```js
scroll: { mode: "takeover" }
```

## 3. Replace `smoothing` with `scrub`

Old:

```js
scroll: { smoothing: 0.04 }
```

New preferred:

```js
scroll: { scrub: 0.04 }
```

The value is now explicitly a ScrollTrigger catch-up duration in seconds.

## 4. Keep scene attributes

No change required:

```html
data-st-scene
data-st-background
data-st-scrub
```

The persistent canvas architecture remains.

## 5. Content effects

Normal scrub/snap content effects are now GSAP timeline tweens. Existing leave `start/end` remain valid. Enter effects now also accept normalized `start/end` (defaults `0.82 → 1`).

`trigger: "viewport"` is also implemented with ScrollTrigger.

## 6. CSS scroll snap

Default `snap: "auto"` avoids double snapping:

- existing CSS snap → CSS remains authority
- no CSS snap → ScrollTrigger adds endpoint snap

If you want ScrollTrigger to own snapping regardless of CSS:

```js
snap: true
```

## 7. Legacy engines

Old scrub compatibility:

```js
scroll: {
  mode: "scrub",
  engine: "legacy"
}
```

Old takeover:

```js
scroll: {
  mode: "takeover"
}
```

These paths remain available for migration but should not be the starting point for new pages.

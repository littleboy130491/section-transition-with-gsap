/**
 * Bounded LRU cache for decoded image frames.
 *
 * This is the key memory-safety mechanism. Full-HD images may consume several
 * MB each after decoding, regardless of compressed WebP/AVIF file size.
 */
export class FrameCache {
  constructor(maxFrames = 24) {
    this.maxFrames = Math.max(2, maxFrames);
    this.map = new Map();
  }

  has(index) {
    return this.map.has(index);
  }

  get(index) {
    const item = this.map.get(index);
    if (!item) return null;

    // Move to end = most recently used.
    this.map.delete(index);
    this.map.set(index, item);
    return item;
  }

  set(index, frame) {
    if (this.map.has(index)) {
      this.dispose(this.map.get(index));
      this.map.delete(index);
    }

    this.map.set(index, frame);
    this.evict();
  }

  evict() {
    while (this.map.size > this.maxFrames) {
      const oldestKey = this.map.keys().next().value;
      const oldest = this.map.get(oldestKey);
      this.map.delete(oldestKey);
      this.dispose(oldest);
    }
  }

  dispose(frame) {
    // ImageBitmap supports explicit memory release.
    if (frame && typeof frame.close === "function") {
      try { frame.close(); } catch (_) {}
    }
  }

  clear() {
    for (const frame of this.map.values()) this.dispose(frame);
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

/**
 * Deterministic pseudo-randomness.
 *
 * The simulator must return the *same* answer for the same (scenario, time bucket)
 * pair, otherwise every React Query refetch would reshuffle the whole dashboard
 * and nothing would look like an observed system. Seeded PRNGs give us
 * reproducibility, and time bucketing gives us the illusion of a live system.
 */

/** FNV-1a. Small, fast, good enough to turn a string into a 32-bit seed. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32 — 32-bit seeded PRNG. Returns a function yielding values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Uniform float in [min, max). */
export function between(rand: () => number, min: number, max: number): number {
  return min + rand() * (max - min)
}

/** Integer in [min, max]. */
export function betweenInt(rand: () => number, min: number, max: number): number {
  return Math.floor(between(rand, min, max + 1))
}

/** Pick one element. Throws on an empty list rather than returning undefined. */
export function pick<T>(rand: () => number, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() called with an empty list')
  return items[Math.floor(rand() * items.length)]!
}

/** Round to `digits` decimal places, avoiding float noise in the JSON payload. */
export function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Bucket a timestamp so the simulated world only changes every `bucketMs`.
 * Without this, every request would produce a subtly different estate.
 */
export function timeBucket(now: number, bucketMs: number): number {
  return Math.floor(now / bucketMs) * bucketMs
}

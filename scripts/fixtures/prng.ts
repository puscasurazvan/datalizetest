// A tiny seeded PRNG (mulberry32) so fixture generation is deterministic:
// the same seed always yields the same sequence, on any machine, forever.
// Math.random() is intentionally never used anywhere in scripts/fixtures.

export type Rng = () => number

/** Builds a mulberry32 generator seeded from a 32-bit integer. Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A random integer in [min, max), never equal to max. */
export function nextInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min))
}

/** A random decimal in [min, max), rounded to the given number of places. */
export function nextDecimal(rng: Rng, min: number, max: number, places: number): number {
  const value = min + rng() * (max - min)
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** Picks one element from a non-empty, readonly list of options. */
export function pick<T>(rng: Rng, options: readonly [T, ...T[]]): T {
  const index = nextInt(rng, 0, options.length)
  return options[index] ?? options[0]
}

/** True with the given probability (0 to 1). */
export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability
}

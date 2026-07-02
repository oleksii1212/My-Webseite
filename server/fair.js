// Provably-fair primitives shared by the single-player games.
//
// Each round picks a random server seed and reveals its SHA-256 hash *before*
// any outcome is shown. The outcome is derived deterministically from the seed,
// so once the seed is revealed a player can recompute the result and confirm it
// was decided in advance.
import crypto from 'node:crypto';

export function hashSeed(serverSeed) {
  return crypto.createHash('sha256').update(serverSeed).digest('hex');
}

export function newSeed() {
  const serverSeed = crypto.randomBytes(16).toString('hex');
  return { serverSeed, hash: hashSeed(serverSeed) };
}

// Deterministic stream of bytes / floats / ints derived from a server seed.
// Bytes come from SHA-256(`${seed}:${counter}`) chunks, refilled as needed.
export function makeRng(serverSeed) {
  let counter = 0;
  let pool = Buffer.alloc(0);
  let pos = 0;

  function nextByte() {
    if (pos >= pool.length) {
      pool = crypto.createHash('sha256').update(`${serverSeed}:${counter}`).digest();
      counter += 1;
      pos = 0;
    }
    const b = pool[pos];
    pos += 1;
    return b;
  }

  // Uniform float in [0, 1) using 48 bits of entropy.
  function float() {
    let n = 0;
    for (let i = 0; i < 6; i += 1) n = n * 256 + nextByte();
    return n / 2 ** 48;
  }

  // Uniform integer in [0, maxExclusive).
  function int(maxExclusive) {
    return Math.floor(float() * maxExclusive);
  }

  return { float, int };
}

// Fisher-Yates shuffle of `arr` in place using the provided rng.
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

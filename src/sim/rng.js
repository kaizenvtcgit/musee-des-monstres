// mulberry32: small seedable RNG returning numbers in [0, 1).
export function createRng(seed) {
  let a = seed >>> 0;
  const rng = function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  // for saving and loading a game: the sequence continues exactly where it stopped
  rng.getState = () => a;
  rng.setState = (s) => { a = s >>> 0; };
  return rng;
}

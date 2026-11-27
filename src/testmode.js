// Test mode, for trying everything quickly while developing: open the game with "?test" in the
// address (http://localhost:5180/?test). Unlimited money, and a separate saved game so the real
// one is never touched. It does not exist in the published game (npm run build): `dev` is false there.
export function isTestMode(search, dev) {
  if (!dev) return false;
  return new URLSearchParams(search).has('test');
}

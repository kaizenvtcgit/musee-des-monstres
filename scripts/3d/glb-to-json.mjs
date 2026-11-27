// Wraps .glb models into .json files ({ "glb": "<base64>" }) for hosts that only serve common web file types.
// The game decodes them itself (src/render3d/visit.js) and hands the bytes to three.js, so no data: URL and
// no WebAssembly decoder are needed (some embedding pages forbid both).
// Usage: node scripts/3d/glb-to-json.mjs file.glb... (writes file.glb.json next to each, removes the .glb)
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

for (const file of process.argv.slice(2)) {
  const buf = readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a .glb`);
  const out = `${file}.json`;
  writeFileSync(out, JSON.stringify({ glb: buf.toString('base64') }));
  unlinkSync(file);
  console.log(`${out}: ${(buf.length * 4 / 3 / 1024).toFixed(0)} KB`);
}

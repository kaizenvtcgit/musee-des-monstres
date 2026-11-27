// Turns .glb models into self-contained glTF JSON files (the binary data inlined as base64), for hosts that
// do not serve .glb files. three.js's GLTFLoader reads both the same way.
// Usage: node scripts/3d/glb-to-json.mjs file.glb... (writes file.gltf.json next to each, removes the .glb)
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

for (const file of process.argv.slice(2)) {
  const buf = readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a .glb`);
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  if (bin) json.buffers[0].uri = `data:application/octet-stream;base64,${bin.toString('base64')}`;
  const out = file.replace(/\.glb$/, '.gltf.json');
  writeFileSync(out, JSON.stringify(json));
  unlinkSync(file);
  console.log(`${out}: ${(JSON.stringify(json).length / 1024).toFixed(0)} KB`);
}

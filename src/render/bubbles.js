// The mood bubbles over the heads (happy, bored, hungry, scared) and the keeper's alert, drawn on a canvas
// of any size, for the 3D view (src/render3d/park-scene.js).
// A discreet dark disc with a small coloured sign (no cartoon outline), drawn on a 24 x 24 grid.
const SIGNS = {
  'bubble-happy': (g) => {
    g.fillStyle = '#ff006e';
    disc(g, 9, 10, 3.2);
    disc(g, 15, 10, 3.2);
    g.beginPath(); g.moveTo(5.9, 11); g.lineTo(18.1, 11); g.lineTo(12, 18); g.closePath(); g.fill();
  },
  'bubble-bored': (g) => {
    g.fillStyle = '#6c757d';
    for (const x of [7, 12, 17]) disc(g, x, 12, 1.8);
  },
  'bubble-hungry': (g) => {
    g.fillStyle = '#f77f00';
    disc(g, 12, 13, 5);
    g.fillStyle = '#52b788';
    g.beginPath(); g.ellipse(14, 7, 2.5, 1.5, 0, 0, Math.PI * 2); g.fill();
  },
  'bubble-scared': (g) => {
    g.fillStyle = '#e63946';
    g.fillRect(10.5, 5, 3, 9);
    disc(g, 12, 17, 1.8);
  },
  // a keeper running after an escaped monster
  'bubble-alert': (g) => {
    g.fillStyle = '#f4c430';
    g.fillRect(10.5, 5, 3, 9);
    disc(g, 12, 17, 1.8);
  },
};

function disc(g, x, y, r) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

// A canvas `size` px wide with the bubble `key` drawn on it (null if unknown).
export function drawBubble(key, size = 24) {
  const sign = SIGNS[key];
  if (!sign) return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.scale(size / 24, size / 24);
  g.fillStyle = 'rgba(18, 22, 26, 0.72)';
  disc(g, 12, 12, 9);
  g.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  g.lineWidth = 1;
  g.beginPath(); g.arc(12, 12, 9, 0, Math.PI * 2); g.stroke();
  sign(g);
  return c;
}

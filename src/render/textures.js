// Every visual of the game is drawn here, in code, at boot.
// Flat cartoon style: bright fills, thick dark outlines, big eyes.
import { BUBBLE_KEYS, drawBubble } from './bubbles.js';

const OUTLINE = 0x2b2d42;

const HABITAT_COLORS = {
  lava: [0xe76f51, 0xf4a261],
  water: [0x48cae4, 0x90e0ef],
  dark: [0x3c2a5c, 0x5a4582],
  forest: [0x40916c, 0x74c69d],
  ice: [0xcaf0f8, 0xffffff],
};

const MONSTER_PALETTES = {
  dragonnet: [{ body: 0xe63946, belly: 0xffd166, extra: 0xb5179e }, { body: 0xffb703, belly: 0xfff3b0, extra: 0xfb8500 }],
  kraken: [{ body: 0x7b2cbf, belly: 0xc77dff, extra: 0x5a189a }, { body: 0x00b4d8, belly: 0x90e0ef, extra: 0x0077b6 }],
  spectre: [{ body: 0xe0e1ff, belly: 0xb8b8ff, extra: 0x9090d0 }, { body: 0x80ffdb, belly: 0xc7f9cc, extra: 0x48bfe3 }],
  golem: [{ body: 0x8d99ae, belly: 0xadb5bd, extra: 0x52b788 }, { body: 0x6d597a, belly: 0x9d8ba7, extra: 0xffafcc }],
  yeti: [{ body: 0xf8f9fa, belly: 0xe9ecef, extra: 0x90e0ef }, { body: 0xffc8dd, belly: 0xffe5ec, extra: 0xcdb4db }],
};

const VISITOR_SHIRTS = [0x3a86ff, 0xff006e, 0xffbe0b, 0x8338ec];
const SKINS = [0xf1c27d, 0xe0ac69, 0x8d5524, 0xffdbac];

function tex(scene, key, w, h, draw) {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

function diamond(g, color, outline = null, alpha = 1) {
  const pts = [{ x: 32, y: 0 }, { x: 64, y: 16 }, { x: 32, y: 32 }, { x: 0, y: 16 }];
  g.fillStyle(color, alpha);
  g.fillPoints(pts, true);
  if (outline !== null) {
    g.lineStyle(1, outline, 0.35);
    g.strokePoints(pts, true);
  }
}

function eyes(g, cx, cy, r, gap) {
  for (const dx of [-gap, gap]) {
    g.fillStyle(0xffffff);
    g.fillCircle(cx + dx, cy, r);
    g.lineStyle(2, OUTLINE);
    g.strokeCircle(cx + dx, cy, r);
    g.fillStyle(OUTLINE);
    g.fillCircle(cx + dx + r * 0.25, cy + r * 0.15, r * 0.5);
    g.fillStyle(0xffffff);
    g.fillCircle(cx + dx + r * 0.05, cy - r * 0.2, r * 0.18);
  }
}

function shape(g, color, fn, alpha = 1) {
  g.fillStyle(color, alpha);
  fn('fill');
  g.lineStyle(3, OUTLINE);
  fn('stroke');
}

// ---- monsters (64 x 64, feet at y ~ 60) ------------------------------------

const DRAW_MONSTER = {
  dragonnet(g, p) {
    shape(g, p.extra, (m) => g[`${m}Triangle`](20, 30, 2, 12, 14, 40));
    shape(g, p.extra, (m) => g[`${m}Triangle`](44, 30, 62, 12, 50, 40));
    shape(g, p.body, (m) => g[`${m}Ellipse`](32, 40, 34, 36));
    shape(g, p.belly, (m) => g[`${m}Ellipse`](32, 46, 18, 18));
    shape(g, p.belly, (m) => g[`${m}Triangle`](22, 26, 18, 12, 28, 23));
    shape(g, p.belly, (m) => g[`${m}Triangle`](42, 26, 46, 12, 36, 23));
    eyes(g, 32, 34, 5, 7);
    g.fillStyle(OUTLINE);
    g.fillCircle(29, 43, 1.5);
    g.fillCircle(35, 43, 1.5);
  },
  kraken(g, p) {
    for (let i = 0; i < 5; i++) {
      const x = 14 + i * 9;
      shape(g, p.extra, (m) => g[`${m}RoundedRect`](x - 4, 40, 8, 20, 4));
    }
    shape(g, p.body, (m) => g[`${m}Ellipse`](32, 32, 40, 38));
    g.fillStyle(p.belly);
    g.fillCircle(20, 24, 4);
    g.fillCircle(44, 22, 3);
    g.fillCircle(40, 40, 3);
    eyes(g, 32, 32, 6, 8);
  },
  spectre(g, p) {
    g.fillStyle(p.body, 0.92);
    g.fillCircle(32, 28, 18);
    g.fillRect(14, 28, 36, 22);
    for (let i = 0; i < 4; i++) g.fillTriangle(14 + i * 9, 50, 23 + i * 9, 50, 18.5 + i * 9, 60);
    g.lineStyle(3, p.extra);
    g.beginPath();
    g.arc(32, 28, 18, Math.PI, 0);
    g.strokePath();
    g.lineBetween(14, 28, 14, 50);
    g.lineBetween(50, 28, 50, 50);
    g.fillStyle(OUTLINE);
    g.fillEllipse(25, 28, 7, 10);
    g.fillEllipse(39, 28, 7, 10);
    g.fillEllipse(32, 40, 6, 8);
  },
  golem(g, p) {
    shape(g, p.body, (m) => g[`${m}RoundedRect`](10, 18, 44, 42, 10));
    shape(g, p.belly, (m) => g[`${m}RoundedRect`](4, 32, 10, 20, 4));
    shape(g, p.belly, (m) => g[`${m}RoundedRect`](50, 32, 10, 20, 4));
    g.fillStyle(p.extra);
    g.fillCircle(18, 20, 7);
    g.fillCircle(30, 16, 8);
    g.fillCircle(44, 20, 7);
    g.fillCircle(48, 44, 4);
    eyes(g, 32, 34, 5, 9);
    g.lineStyle(2, OUTLINE);
    g.lineBetween(27, 46, 37, 46);
  },
  yeti(g, p) {
    shape(g, p.body, (m) => g[`${m}Circle`](32, 38, 22));
    for (const [x, y] of [[14, 24], [24, 16], [40, 16], [50, 24], [12, 46], [52, 46]]) {
      shape(g, p.body, (m) => g[`${m}Circle`](x, y, 7));
    }
    g.fillStyle(p.body);
    g.fillCircle(32, 36, 20);
    shape(g, p.extra, (m) => g[`${m}Ellipse`](32, 38, 26, 20));
    eyes(g, 32, 36, 4, 6);
    g.fillStyle(OUTLINE);
    g.fillEllipse(32, 44, 8, 4);
  },
};

// ---- people ----------------------------------------------------------------

function person(g, shirt, skin, cap = null) {
  shape(g, 0x495057, (m) => g[`${m}RoundedRect`](8, 22, 4, 10, 2));
  shape(g, 0x495057, (m) => g[`${m}RoundedRect`](14, 22, 4, 10, 2));
  shape(g, shirt, (m) => g[`${m}RoundedRect`](5, 12, 16, 14, 5));
  shape(g, skin, (m) => g[`${m}Circle`](13, 8, 6));
  if (cap) shape(g, cap, (m) => g[`${m}RoundedRect`](6, 1, 14, 5, 2));
}

// ---- buildings -------------------------------------------------------------

function stall(g, awning, stripe) {
  shape(g, 0xdda15e, (m) => g[`${m}RoundedRect`](12, 30, 40, 26, 3));
  shape(g, 0xfefae0, (m) => g[`${m}Rect`](18, 36, 28, 10));
  for (let i = 0; i < 4; i++) {
    shape(g, i % 2 ? stripe : awning, (m) => g[`${m}Rect`](8 + i * 12, 18, 12, 12));
  }
}

export function generateTextures(scene) {
  // ground
  tex(scene, 'tile-grass', 64, 32, (g) => {
    diamond(g, 0x95d5b2, 0x40916c);
  });
  tex(scene, 'tile-grass2', 64, 32, (g) => {
    diamond(g, 0x8fcfa9, 0x40916c);
    g.fillStyle(0x74c69d);
    g.fillTriangle(24, 14, 27, 8, 30, 14);
    g.fillTriangle(36, 20, 39, 14, 42, 20);
  });
  tex(scene, 'tile-path', 64, 32, (g) => {
    diamond(g, 0xf2e2ba, 0xbc8a5f);
    g.fillStyle(0xe6ccb2);
    g.fillCircle(26, 14, 2);
    g.fillCircle(40, 19, 2);
  });
  for (const [hab, [a, b]] of Object.entries(HABITAT_COLORS)) {
    tex(scene, `tile-${hab}`, 64, 32, (g) => {
      diamond(g, a, OUTLINE);
      g.fillStyle(b, 0.8);
      g.fillEllipse(24, 14, 10, 4);
      g.fillEllipse(40, 20, 8, 3);
    });
  }
  // soft ground shadow under monsters (64 x 24)
  tex(scene, 'shadow', 64, 24, (g) => {
    for (let i = 6; i >= 1; i--) {
      g.fillStyle(0x000000, 0.06);
      g.fillEllipse(32, 12, 10 * i, 4 * i);
    }
  });
  tex(scene, 'tile-entrance', 64, 32, (g) => {
    diamond(g, 0xffd166, 0xbc8a5f);
  });

  // monsters
  for (const [id, palettes] of Object.entries(MONSTER_PALETTES)) {
    tex(scene, `monster-${id}`, 64, 64, (g) => DRAW_MONSTER[id](g, palettes[0]));
    tex(scene, `monster-${id}-rare`, 64, 64, (g) => {
      DRAW_MONSTER[id](g, palettes[1]);
      g.fillStyle(0xffd60a);
      g.fillTriangle(54, 2, 58, 10, 50, 10);
      g.fillTriangle(54, 14, 58, 6, 50, 6);
    });
  }

  // people
  VISITOR_SHIRTS.forEach((shirt, i) => {
    tex(scene, `visitor-${i}`, 26, 34, (g) => person(g, shirt, SKINS[i]));
  });
  tex(scene, 'keeper', 26, 34, (g) => person(g, 0x2d6a4f, 0xf1c27d, 0x1b4332));

  // buildings
  tex(scene, 'decoration', 64, 64, (g) => {
    shape(g, 0x8b5e34, (m) => g[`${m}Rect`](28, 36, 8, 20));
    shape(g, 0x52b788, (m) => g[`${m}Circle`](32, 26, 18));
    g.fillStyle(0xff006e);
    g.fillCircle(24, 22, 3);
    g.fillCircle(38, 30, 3);
    g.fillCircle(36, 16, 3);
  });
  tex(scene, 'snack', 64, 64, (g) => {
    stall(g, 0xe63946, 0xffffff);
    shape(g, 0xffb703, (m) => g[`${m}Circle`](32, 8, 7));
  });
  tex(scene, 'souvenir', 64, 64, (g) => {
    stall(g, 0x3a86ff, 0xffffff);
    g.fillStyle(0xffd60a);
    g.fillTriangle(32, 0, 37, 14, 27, 14);
    g.fillTriangle(32, 18, 37, 4, 27, 4);
  });
  tex(scene, 'expeditionBase', 128, 112, (g) => {
    shape(g, 0xbc6c25, (m) => g[`${m}Triangle`](64, 20, 18, 92, 110, 92));
    shape(g, 0x6f1d1b, (m) => g[`${m}Triangle`](64, 50, 50, 92, 78, 92));
    g.lineStyle(3, OUTLINE);
    g.lineBetween(64, 20, 64, 2);
    shape(g, 0xe63946, (m) => g[`${m}Triangle`](64, 2, 86, 8, 64, 14));
    shape(g, 0x8d99ae, (m) => g[`${m}RoundedRect`](92, 76, 22, 18, 4));
  });
  tex(scene, 'hatchery', 128, 112, (g) => {
    shape(g, 0xadb5bd, (m) => g[`${m}RoundedRect`](18, 70, 92, 24, 6));
    g.fillStyle(0xcaf0f8, 0.85);
    g.fillEllipse(64, 64, 84, 72);
    g.lineStyle(3, OUTLINE);
    g.strokeEllipse(64, 64, 84, 72);
    shape(g, 0xfefae0, (m) => g[`${m}Ellipse`](50, 72, 16, 20));
    shape(g, 0xffafcc, (m) => g[`${m}Ellipse`](70, 70, 16, 20));
    shape(g, 0xbde0fe, (m) => g[`${m}Ellipse`](62, 52, 14, 18));
  });
  tex(scene, 'egg', 24, 30, (g) => {
    shape(g, 0xfefae0, (m) => g[`${m}Ellipse`](12, 16, 18, 24));
    g.fillStyle(0xe76f51);
    g.fillCircle(8, 14, 2);
    g.fillCircle(15, 20, 2);
  });

  // mood bubbles (24 x 24, src/render/bubbles.js)
  for (const key of BUBBLE_KEYS) if (!scene.textures.exists(key)) scene.textures.addCanvas(key, drawBubble(key, 24));
}

export function monsterTextureKey(monster) {
  return `monster-${monster.speciesId}${monster.rare ? '-rare' : ''}`;
}

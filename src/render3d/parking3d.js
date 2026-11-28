// The road and the car park in front of the entrance, and their cars (src/sim/parking.js), in 3D.
// The road is always there; the car park when it is built. The cars (src/assets/3d/cars.glb.json, Quaternius,
// CC0) follow the way the game gives them, turning smoothly, backing out of their place, wheels turning.
import * as THREE from 'three';
import {
  PARKING_W, PARKING_H, CAR_MODELS, roadRow, ROAD_HALF, placeOf, arrivalPath, departurePath, pointAlong,
} from '../sim/parking.js';

const RING = 7; // tiles of lawn and forest around the park
// car paints (of the plain cars: saloons, SUV, white sports car)
const PAINTS = [0xb3261e, 0x2f5d3a, 0x9aa0a6, 0x1d1f22, 0x22355e, 0xd8cdb4, 0xeeeeea, 0x7fa7d6, 0x6b2b3a, 0x4a4f55];
const WHEEL_RADIUS = 0.33; // m (about: the models' wheels are 0.5 to 0.66 m across)

// A dark asphalt with grain, drawn once.
function asphaltTexture() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#3b3d40';
  g.fillRect(0, 0, S, S);
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    const v = 45 + rnd() * 40;
    g.fillStyle = `rgba(${v},${v},${v + 3},${0.35 + rnd() * 0.4})`;
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.anisotropy = 8;
  return tx;
}

// A flat rectangle on the ground (metres), x0..x1, z0..z1, at height y, texture repeated every `rep` m.
function slab(x0, z0, x1, z1, y, mat, rep = 4) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / rep, uv.getY(i) * (z1 - z0) / rep);
  const m = new THREE.Mesh(g, mat);
  m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  m.receiveShadow = true;
  return m;
}

// The blue "P" sign of the car park.
function signTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1f5fbf';
  g.beginPath();
  g.roundRect(6, 6, 116, 116, 14);
  g.fill();
  g.strokeStyle = '#fff';
  g.lineWidth = 6;
  g.stroke();
  g.fillStyle = '#fff';
  g.font = 'bold 92px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('P', 64, 70);
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  return tx;
}

export class Parking3D {
  // `park`: the ParkScene (scene, world, models, T)
  constructor(park, T) {
    this.park = park;
    this.T = T;
    this.cars = new Map(); // id -> { obj, wheels, heading }
    this.asphalt = new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.92, color: 0xffffff });
    this.paint = new THREE.MeshStandardMaterial({ color: 0xf2f2ea, roughness: 0.8 });
    this.buildRoad();
  }

  // The road across the map, below the car park, out into the far fields on both sides.
  buildRoad() {
    const { T } = this, { grid } = this.park.world;
    const z = roadRow(grid) * T, h = ROAD_HALF * T, x0 = (-RING - 30) * T, x1 = (grid.w + RING + 30) * T;
    const g = new THREE.Group();
    g.add(slab(x0, z - h, x1, z + h, 0.025, this.asphalt, 6));
    // the edge lines and the dashed middle line
    g.add(slab(x0, z - h + 0.15, x1, z - h + 0.27, 0.03, this.paint, 50));
    g.add(slab(x0, z + h - 0.27, x1, z + h - 0.15, 0.03, this.paint, 50));
    for (let x = x0; x < x1; x += 6) g.add(slab(x, z - 0.06, x + 3, z + 0.06, 0.03, this.paint, 50));
    this.park.s3.add(g);
    this.road = g;
  }

  // The car park itself (rebuilt when it is built, moved or pulled down).
  buildLot() {
    if (this.lot) {
      this.park.s3.remove(this.lot);
      this.lot.traverse((o) => o.geometry?.dispose());
      this.lot = null;
    }
    const p = this.park.world.parking;
    this.lotKey = p ? `${p.x0},${p.y0}` : null;
    if (!p) return;
    const { T } = this, g = new THREE.Group();
    const X = (tx) => tx * T, Z = (ty) => ty * T;
    const left = X(p.x0 - 0.5), right = X(p.x0 + PARKING_W - 0.5), top = Z(p.y0 - 0.5), bottom = Z(p.y0 + PARKING_H - 0.5);
    g.add(slab(left, top, right, bottom + 0.2, 0.02, this.asphalt, 6));
    // lines between the places (and at both ends of each row)
    for (let k = 0; k <= 6; k++) {
      const x = X(p.x0 + 0.5 + k);
      g.add(slab(x - 0.06, Z(p.y0 - 0.5) + 0.2, x + 0.06, Z(p.y0 + 1.5) - 0.1, 0.03, this.paint));
      g.add(slab(x - 0.06, Z(p.y0 + 2.5) + 0.1, x + 0.06, Z(p.y0 + 4.5) - 0.2, 0.03, this.paint));
    }
    // a low kerb along the park side
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(right - left, 0.15, 0.25), new THREE.MeshStandardMaterial({ color: 0xbdb8ad, roughness: 0.9 }));
    kerb.position.set((left + right) / 2, 0.075, top + 0.125);
    kerb.castShadow = kerb.receiveShadow = true;
    g.add(kerb);
    // the "P" sign at the driveway, and two street lamps
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), new THREE.MeshStandardMaterial({ color: 0x8a8d91, metalness: 0.6, roughness: 0.4 }));
    post.position.set(left - 0.4, 1.3, bottom - 0.6);
    post.castShadow = true;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ map: signTexture(), side: THREE.DoubleSide, roughness: 0.5 }));
    sign.position.set(left - 0.4, 2.7, bottom - 0.6);
    sign.rotation.y = Math.PI / 4;
    sign.castShadow = true;
    g.add(post, sign);
    this.park.props().then((props) => {
      const lamp = props.get('streetLamp');
      if (!lamp || this.lot !== g) return;
      for (const x of [left + 0.3, right - 0.3]) {
        const l = lamp.clone();
        l.position.set(x, 0, top + 0.6);
        l.scale.setScalar(3.6 / lamp.userData.size.y);
        g.add(l);
      }
    }).catch(() => {});
    this.park.s3.add(g);
    this.lot = g;
  }

  // The car models, loaded once: one template per car, its wheels found by name.
  templates() {
    this.tplP ??= this.park.model('cars').then((m) => {
      const out = new Map();
      // one root node per car (a lone wrapping node, if any, is skipped)
      const roots = m.scene.children.length === 1 ? m.scene.children[0].children : m.scene.children;
      for (const node of roots) {
        node.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
        out.set(node.name, node);
      }
      return out;
    });
    return this.tplP;
  }

  // Each frame: the car park rebuilt if it changed, the cars where the game has them.
  update(dt) {
    const p = this.park.world.parking;
    const key = p ? `${p.x0},${p.y0}` : null;
    if (key !== this.lotKey) {
      this.buildLot();
      this.park.buildTrees(); // the trees make room for it
    }
    const seen = new Set();
    for (const car of p?.cars ?? []) {
      seen.add(car.id);
      let e = this.cars.get(car.id);
      if (!e) {
        e = { loading: true };
        this.cars.set(car.id, e);
        this.templates().then((tpl) => {
          const src = tpl.get(CAR_MODELS[car.model]) ?? tpl.values().next().value;
          if (!src || this.cars.get(car.id) !== e) return;
          const obj = src.clone();
          obj.position.set(0, 0, 0);
          this.repaint(obj, car);
          const wheels = [];
          obj.traverse((o) => { if (/Wheel/.test(o.name)) wheels.push(o); });
          Object.assign(e, { obj, wheels, loading: false, heading: null });
          this.park.s3.add(obj);
        }).catch(() => {});
        continue;
      }
      if (e.loading) continue;
      this.placeCar(e, car, p, dt);
    }
    for (const [id, e] of this.cars) {
      if (seen.has(id)) continue;
      if (e.obj) this.park.s3.remove(e.obj);
      this.cars.delete(id);
    }
  }

  // Every car its own paint (the taxi, the police car and the orange sports car keep theirs).
  repaint(obj, car) {
    const name = CAR_MODELS[car.model];
    if (name === 'Taxi' || name === 'Cop' || name === 'SportsCar') return;
    const k = [...car.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const paint = new THREE.Color(PAINTS[k % PAINTS.length]);
    obj.traverse((o) => {
      if (!o.isMesh || /Wheel/.test(o.name)) return;
      const mats = [].concat(o.material).map((m) => {
        if (!/^(Blue|LightBlue|White)$/.test(m.name)) return m;
        const c = m.clone();
        c.color.copy(paint);
        return c;
      });
      o.material = Array.isArray(o.material) ? mats : mats[0];
    });
  }

  // Where a car is on its way: position, heading (smoothed in the turns), wheels turning with the distance.
  placeCar(e, car, p, dt) {
    const { T } = this, { world } = this.park;
    let x, y, heading;
    let back = false;
    if (car.state === 'parked') {
      const pl = placeOf(p, car.place);
      x = pl.x;
      y = pl.y;
      heading = pl.face < 0 ? Math.PI : 0;
    } else {
      const path = car.state === 'arriving' ? arrivalPath(world, p, car.place) : departurePath(world, p, car.place);
      const pt = pointAlong(path, car.s);
      x = pt.x;
      y = pt.y;
      back = pt.back;
      // facing where it goes (backing up: the other way)
      heading = Math.atan2(pt.dx, pt.dy) + (back ? Math.PI : 0);
    }
    const nx = x * T, nz = y * T;
    const moved = e.last ? Math.hypot(nx - e.last.x, nz - e.last.z) : 0;
    e.last = { x: nx, z: nz };
    e.obj.position.set(nx, 0, nz);
    if (e.heading === null) e.heading = heading;
    let diff = heading - e.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    e.heading += diff * Math.min(1, dt * 6);
    e.obj.rotation.y = e.heading;
    for (const w of e.wheels) w.rotation.x += (back ? -1 : 1) * (moved / WHEEL_RADIUS);
  }

  // The tiles of the road and the car park, kept free of trees.
  blocks(tx, ty) {
    const { grid, parking: p } = this.park.world;
    if (Math.abs(ty - roadRow(grid)) < ROAD_HALF + 0.6) return true;
    return !!p && tx > p.x0 - 1.4 && tx < p.x0 + PARKING_W + 0.4 && ty > p.y0 - 1 && ty < p.y0 + PARKING_H + 0.4;
  }
}

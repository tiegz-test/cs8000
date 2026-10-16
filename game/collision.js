// Basic collisions between the player and the trees and rocks.
//
//  - Trees are upright cylinders (the trunk plus a margin so the camera stays out of the branches).
//  - Rocks are domes. Walking into one that is taller than a step blocks you; jump and you can
//    land on top and stand there. Small rocks are simply stepped over.
//
// Colliders live in a coarse grid so each frame only looks at the few nearby ones.
export const PLAYER_RADIUS = 0.45;
export const STEP_UP = 0.55;           // m: how tall a ledge you can walk straight up onto
const CELL = 16;

export function makeCollisionWorld() {
  let grid = new Map();
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;

  function insert(c, reach) {
    const x0 = Math.floor((c.x - reach) / CELL), x1 = Math.floor((c.x + reach) / CELL);
    const z0 = Math.floor((c.z - reach) / CELL), z1 = Math.floor((c.z + reach) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = key(i, j);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(c);
    }
  }
  const near = (x, z) => grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) || [];

  // height of a rock dome at horizontal distance d (or -Infinity outside it)
  const domeTop = (c, d) => (d >= c.r ? -Infinity : c.cy + c.h * Math.sqrt(1 - (d / c.r) * (d / c.r)));

  return {
    // colliders: trees { x, z, r } and rocks { x, z, r, cy, h }, as plain arrays
    set(trees, rocks) {
      grid = new Map();
      for (const t of trees) insert({ kind: 0, x: t.x, z: t.z, r: t.r }, t.r + PLAYER_RADIUS);
      for (const r of rocks) insert({ kind: 1, ...r }, r.r + PLAYER_RADIUS);
    },

    // height of the highest rock surface under (x, z), or -Infinity if none
    rockTop(x, z) {
      let top = -Infinity;
      for (const c of near(x, z)) if (c.kind === 1) top = Math.max(top, domeTop(c, Math.hypot(x - c.x, z - c.z)));
      return top;
    },

    // push the player out of anything solid at feet height feetY; returns the push direction when it hit something
    resolve(pos, feetY, prevX = pos.x, prevZ = pos.z) {
      let hit = false, nx = 0, nz = 0;
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (const c of near(pos.x, pos.z)) {
          let dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz);
          let edge;                                              // distance from the collider's center we must stay beyond
          if (c.kind === 0) edge = c.r + PLAYER_RADIUS;
          else {
            const need = feetY + STEP_UP - c.cy;                  // dome height we'd have to climb to
            if (need >= c.h) continue;                            // we're above it (or it's a small rock): free to pass
            edge = (need <= 0 ? c.r : c.r * Math.sqrt(1 - (need / c.h) * (need / c.h))) + PLAYER_RADIUS;
          }
          if (d >= edge) continue;
          if (d < 1e-4) { dx = prevX - c.x; dz = prevZ - c.z; d = Math.hypot(dx, dz) || 1; if (d < 1e-4) { dx = 1; dz = 0; d = 1; } }
          nx = dx / d; nz = dz / d;
          pos.x = c.x + nx * edge; pos.z = c.z + nz * edge;
          hit = true; moved = true;
        }
        if (!moved) break;
      }
      return hit ? { nx, nz } : null;
    },
  };
}

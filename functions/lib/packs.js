// Seasonal packs: ready-made animation sets you can add to the sign from the
// app (Animations -> Library -> Seasonal packs). Nothing here needs Gemini.
//
// Each animation is built from hand-drawn sprites plus motion paths computed
// here (falling leaves sway, gusts loop, snow drifts). Randomness is seeded,
// so a pack always comes out the same and the app preview matches the sign.

const { normalizeSpec } = require("./animations");
const {
  rng, range, irange, pick, recolor, mirror, grid, rows,
  AUTUMN, XMAS, autumnTree, leafLitter, LEAF, GUST, TURKEY_WALK, TURKEY_FAN,
  xmasTree, xmasTreeSmall, FLAKE, DOT, SNOWBANK, SANTA, REINDEER, RUDOLPH_WALK, RUDOLPH_FLY,
  ELF, ELF_CARRY, SNOWMAN, SNOWMAN_ARM, SNOWMAN_ARM_L, STAR, TWINKLE, MOON,
} = require("./art");
/** Keyframes sampled from a path function p(u) -> {x, y}, u in 0..1. */
function path(t0, t1, fn, steps, flip = false) {
  const keys = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const { x, y } = fn(u);
    keys.push({ t: Math.round(t0 + (t1 - t0) * u), x: Math.round(x), y: Math.round(y), flip });
  }
  return keys;
}

/** Sit still from t0 to t1. */
const hold = (t0, t1, x, y, flip = false) => [{ t: t0, x, y, flip }, { t: t1, x, y, flip }];

/**
 * Assemble a spec from named sprites; only colors actually used go in the palette.
 * sprites: { key: { frame_ms, frames } }, actors: [{ sprite: key, keyframes, outline, phase }]
 */
function scene({ name, duration, background = "black", sprites, actors }, PAL) {
  const keys = Object.keys(sprites);
  const used = new Set();
  for (const k of keys) for (const f of sprites[k].frames) for (const r of f) for (const c of r) if (c !== ".") used.add(c);
  const palette = {};
  for (const c of used) {
    if (!PAL[c]) throw new Error(`${name}: color "${c}" missing from the palette`);
    palette[c] = PAL[c];
  }
  const spec = {
    name, duration_ms: duration, background, palette,
    sprites: keys.map((k) => ({ name: k, frame_ms: sprites[k].frame_ms, frames: sprites[k].frames })),
    actors: actors.map((a) => ({
      sprite: keys.indexOf(a.sprite), outline: Boolean(a.outline), keyframes: a.keyframes,
      ...(a.phase ? { phase: Math.round(a.phase) } : {}),
      ...(a.sway ? { sway: a.sway } : {}),
    })),
  };
  for (const a of actors) if (!keys.includes(a.sprite)) throw new Error(`${name}: unknown sprite ${a.sprite}`);
  return spec;
}

const leafSprites = () => Object.fromEntries(["r", "o", "y", "R", "n"].map((c) => [`leaf_${c}`, { frame_ms: 140, frames: recolor(LEAF, { x: c }) }]));

// ---- motion ----
// Motion uses the sign's built-in sway (a sine wobble on top of a straight
// path), so a falling leaf needs 2 keyframes instead of 20 -- the sign holds
// hundreds of these in memory. Copies get different "phase" values so they
// don't wobble in step.

/** A leaf drifting down with a side-to-side sway. */
function fallingLeaf(r, { x0, y0, y1, t0, t1, sway = 3 }) {
  const drift = Math.round(range(r, -6, 6));
  return {
    keyframes: [{ t: t0, x: x0, y: y0 }, { t: t1, x: x0 + drift, y: y1 }],
    sway: { x: sway, y: 0, ms: irange(r, 1300, 2100) },
  };
}

/** A leaf caught in a gust: races across, looping. dir = 1 (to the right) or -1. */
function gustLeaf(r, { y0, t0, t1, dir = 1, loops = 1.5, radius = 4 }) {
  const rad = Math.max(2, Math.round(range(r, radius * 0.6, radius * 1.2))), rise = Math.round(range(r, -6, 4));
  const xa = dir > 0 ? -6 : 68, xb = dir > 0 ? 68 : -6;
  return {
    keyframes: [{ t: t0, x: xa, y: y0 }, { t: t1, x: xb, y: y0 + rise }],
    sway: { x: rad, y: rad, ms: Math.max(300, Math.round((t1 - t0) / loops)) },
  };
}

const LEAF_KEYS = ["leaf_r", "leaf_o", "leaf_y", "leaf_R", "leaf_n"];

function autumnGust() {
  const r = rng(11), D = 11000, actors = [];
  const L = { frame_ms: 400, frames: [autumnTree(3)] }, Lw = { frame_ms: 400, frames: [autumnTree(3, 2)] };
  const Rt = { frame_ms: 400, frames: mirror([autumnTree(8)]) }, Rw = { frame_ms: 400, frames: mirror([autumnTree(8, -2)]) };
  const gustStart = 4200, gustEnd = 8200;
  actors.push({ sprite: "litterL", keyframes: hold(0, D, 0, 30) }, { sprite: "litterR", keyframes: hold(0, D, 32, 30) });
  // trees: calm, windy during the gust, calm again
  actors.push({ sprite: "treeL", keyframes: hold(0, gustStart, -5, 0) }, { sprite: "treeLw", keyframes: hold(gustStart + 1, gustEnd, -5, 0) },
    { sprite: "treeL", keyframes: hold(gustEnd + 1, D, -5, 0) });
  actors.push({ sprite: "treeR", keyframes: hold(0, gustStart, 45, 0) }, { sprite: "treeRw", keyframes: hold(gustStart + 1, gustEnd, 45, 0) },
    { sprite: "treeR", keyframes: hold(gustEnd + 1, D, 45, 0) });
  // a few leaves drift down before the wind
  for (let i = 0; i < 6; i++) {
    const left = i % 2 === 0, t0 = 200 + i * 600;
    actors.push({ sprite: pick(r, LEAF_KEYS), phase: r() * 2400,
      ...fallingLeaf(r, { x0: left ? irange(r, 8, 18) : irange(r, 44, 54), y0: irange(r, 6, 14), y1: 29, t0, t1: t0 + irange(r, 3200, 4200) }) });
  }
  // the gust: streaks, then leaves torn off and carried across in loops
  for (let i = 0; i < 4; i++) {
    const t0 = gustStart - 300 + i * 650, y = [6, 15, 10, 21][i];
    actors.push({ sprite: "gust", phase: i * 90, keyframes: [{ t: t0, x: -20, y }, { t: t0 + 1500, x: 66, y }] });
  }
  for (let i = 0; i < 22; i++) {
    const t0 = gustStart + i * 140;
    actors.push({ sprite: pick(r, LEAF_KEYS), phase: r() * 2400,
      ...gustLeaf(r, { y0: irange(r, 4, 22), t0, t1: t0 + irange(r, 1900, 2600), loops: range(r, 1, 2), radius: 5 }) });
  }
  // stragglers settle afterwards
  for (let i = 0; i < 4; i++) {
    const t0 = gustEnd + i * 450;
    actors.push({ sprite: pick(r, LEAF_KEYS), phase: r() * 2400,
      ...fallingLeaf(r, { x0: irange(r, 14, 48), y0: -3, y1: 29, t0, t1: Math.min(D, t0 + 2600) }) });
  }
  return scene({ name: "Autumn gust", duration: D, sprites: {
    treeL: L, treeLw: Lw, treeR: Rt, treeRw: Rw, ...leafSprites(), gust: { frame_ms: 160, frames: GUST },
    litterL: { frame_ms: 1000, frames: leafLitter(4) }, litterR: { frame_ms: 1000, frames: leafLitter(9) },
  }, actors }, AUTUMN);
}

function fallingLeaves() {
  const r = rng(21), D = 8000, actors = [];
  for (let i = 0; i < 18; i++) {
    const t0 = Math.round(i * 330 + r() * 200), dur = irange(r, 3600, 5000);
    actors.push({ sprite: pick(r, LEAF_KEYS), phase: r() * 2400,
      ...fallingLeaf(r, { x0: irange(r, 2, 60), y0: -3, y1: 33, t0, t1: Math.min(D, t0 + dur), sway: 4 }) });
  }
  return scene({ name: "Falling leaves", duration: D, background: "transit", sprites: leafSprites(), actors }, AUTUMN);
}

function leafGust() {
  const r = rng(31), D = 5200, actors = [];
  for (let i = 0; i < 5; i++) {
    const t0 = i * 380, y = [5, 14, 22, 9, 26][i];
    actors.push({ sprite: "gust", phase: i * 70, keyframes: [{ t: t0, x: -20, y }, { t: t0 + 1300, x: 66, y }] });
  }
  for (let i = 0; i < 18; i++) {
    const t0 = 300 + i * 150;
    actors.push({ sprite: pick(r, LEAF_KEYS), phase: r() * 2400,
      ...gustLeaf(r, { y0: irange(r, 3, 26), t0, t1: Math.min(D, t0 + irange(r, 1700, 2300)), loops: range(r, 0.8, 1.8), radius: 4 }) });
  }
  return scene({ name: "Leaf gust", duration: D, background: "transit",
    sprites: { gust: { frame_ms: 160, frames: GUST }, ...leafSprites() }, actors }, AUTUMN);
}

function turkeyStrut() {
  const D = 8000, y = 18;
  return scene({ name: "Turkey strut", duration: D, background: "transit", sprites: {
    walk: { frame_ms: 220, frames: TURKEY_WALK }, fan: { frame_ms: 260, frames: TURKEY_FAN },
  }, actors: [
    { sprite: "walk", outline: true, keyframes: [{ t: 0, x: 66, y, flip: true }, { t: 2600, x: 24, y, flip: true }] },
    { sprite: "fan", outline: true, keyframes: hold(2601, 5000, 22, 16) },
    { sprite: "walk", outline: true, keyframes: [{ t: 5001, x: 24, y, flip: true }, { t: D, x: -18, y, flip: true }] },
  ] }, AUTUMN);
}

function turkeyGrove() {
  const r = rng(41), D = 10000, actors = [];
  actors.push({ sprite: "litterL", keyframes: hold(0, D, 0, 30) }, { sprite: "litterR", keyframes: hold(0, D, 32, 30) });
  actors.push({ sprite: "treeL", keyframes: hold(0, D, -4, 0) }, { sprite: "treeR", keyframes: hold(0, D, 44, 0) });
  actors.push({ sprite: "walk", keyframes: [{ t: 0, x: -16, y: 17 }, { t: 2800, x: 18, y: 17 }] });
  actors.push({ sprite: "fan", keyframes: hold(2801, 6200, 22, 15) });
  actors.push({ sprite: "walk", keyframes: [{ t: 6201, x: 24, y: 17 }, { t: D, x: 66, y: 17 }] });
  for (let i = 0; i < 10; i++) {
    const left = r() < 0.5, t0 = Math.round(i * 900 + r() * 400);
    actors.push({ sprite: pick(r, LEAF_KEYS), phase: r() * 2400,
      ...fallingLeaf(r, { x0: left ? irange(r, 6, 16) : irange(r, 46, 56), y0: irange(r, 6, 14), y1: 29, t0, t1: Math.min(D, t0 + irange(r, 3000, 4000)) }) });
  }
  return scene({ name: "Turkey grove", duration: D, sprites: {
    treeL: { frame_ms: 400, frames: [autumnTree(5)] }, treeR: { frame_ms: 400, frames: mirror([autumnTree(13)]) },
    walk: { frame_ms: 220, frames: TURKEY_WALK }, fan: { frame_ms: 260, frames: TURKEY_FAN }, ...leafSprites(),
    litterL: { frame_ms: 1000, frames: leafLitter(2) }, litterR: { frame_ms: 1000, frames: leafLitter(7) },
  }, actors }, AUTUMN);
}

/** A snowflake falling with a gentle sway. */
function snowfall(r, n, { D, big = 0.35, y1 = 33, every }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t0 = Math.round(every ? i * every + r() * every : r() * D * 0.6);
    const dur = irange(r, 4500, 7000), x0 = irange(r, 0, 62);
    const t1 = Math.min(D, t0 + dur), frac = (t1 - t0) / dur;
    out.push({ sprite: r() < big ? "flake" : "dot", phase: r() * 3000,
      keyframes: [{ t: t0, x: x0, y: -3 }, { t: t1, x: x0, y: Math.round(-3 + (y1 + 3) * frac) }],
      sway: { x: irange(r, 1, 2), y: 0, ms: irange(r, 1800, 3000) } });
  }
  return out;
}

function xmasTrees() {
  const r = rng(51), D = 10000;
  const actors = [
    { sprite: "bankL", keyframes: hold(0, D, 0, 29) }, { sprite: "bankR", keyframes: hold(0, D, 32, 29) },
    { sprite: "tree", keyframes: hold(0, D, 1, 4) },
    { sprite: "tree", phase: 400, keyframes: hold(0, D, 48, 4) },
    { sprite: "small", phase: 200, keyframes: hold(0, D, 25, 14) },
    ...snowfall(r, 22, { D, every: 420 }),
  ];
  return scene({ name: "Christmas trees", duration: D, sprites: {
    tree: { frame_ms: 600, frames: xmasTree(1) }, small: { frame_ms: 600, frames: xmasTreeSmall() },
    flake: { frame_ms: 500, frames: FLAKE }, dot: { frame_ms: 1000, frames: DOT },
    bankL: { frame_ms: 1000, frames: SNOWBANK(1) }, bankR: { frame_ms: 1000, frames: SNOWBANK(5) },
  }, actors }, XMAS);
}

function snowfallOverlay() {
  const r = rng(61), D = 9000;
  return scene({ name: "Snowfall", duration: D, background: "transit", sprites: {
    flake: { frame_ms: 500, frames: FLAKE }, dot: { frame_ms: 1000, frames: DOT },
  }, actors: snowfall(r, 34, { D, every: 230, big: 0.3 }) }, XMAS);
}

/** Santa's sleigh with three reindeer, Rudolph in front. */
function sleighTeam(r, { t0, t1, y, bob = 2, dir = 1, outline = false }) {
  const xs = dir > 0 ? [-80, 68] : [68, -80];
  // the team bobs in a ripple: each reindeer a little ahead of the one behind
  const member = (sprite, dx, phase) => ({ sprite, outline, phase,
    keyframes: [{ t: t0, x: xs[0] + dx, y }, { t: t1, x: xs[1] + dx, y }], sway: { x: 0, y: bob, ms: 1600 } });
  return [member("sleigh", 0, 0), member("deer", 22, 1400), member("deer", 37, 1200), member("rudolph", 52, 1000)];
}

const deerSprites = () => ({
  deer: { frame_ms: 160, frames: recolor(REINDEER, { x: "N" }) },
  rudolph: { frame_ms: 160, frames: REINDEER.map((f, i) => recolor([f], { x: i % 2 ? "r" : "p" })[0]) },
});

const NIGHT_SKY = (seed, n, D) => {
  const r = rng(seed);
  return Array.from({ length: n }, () => ({ sprite: r() < 0.3 ? "star" : "twinkle", phase: r() * 1200,
    keyframes: hold(0, D, irange(r, 0, 62), irange(r, 0, 20)) }));
};

function santaNight(durationOverride) {
  const r = rng(71), D = durationOverride || 9000;
  const sky = NIGHT_SKY(3, 14, D);
  const actors = [
    { sprite: "moon", keyframes: hold(0, D, 55, 2) },
    ...sky,
    ...sleighTeam(r, { t0: 500, t1: D - 300, y: 12, bob: 2 }),
  ];
  // a trail of sparkles behind the sleigh
  for (let i = 0; i < 8; i++) {   // from when the sleigh is on screen
    const t = 5600 + i * 400, u = (t - 500) / (D - 800), x = Math.round(-80 + 148 * u) - 2;
    actors.push({ sprite: "twinkle", phase: i * 200, keyframes: [{ t, x, y: 20 + (i % 3) }, { t: t + 900, x: x - 3, y: 24 + (i % 3) }] });
  }
  return scene({ name: "Santa's sleigh", duration: D, sprites: {
    sleigh: { frame_ms: 1000, frames: SANTA }, ...deerSprites(),
    moon: { frame_ms: 1000, frames: MOON }, star: { frame_ms: 300, frames: STAR }, twinkle: { frame_ms: 250, frames: TWINKLE },
  }, actors }, { ...XMAS, n: "#a0602a" });
}

function santaFlyBy() {
  const r = rng(81), D = 5500;
  return scene({ name: "Santa flies by", duration: D, background: "transit", sprites: {
    sleigh: { frame_ms: 1000, frames: SANTA }, ...deerSprites(),
  }, actors: sleighTeam(r, { t0: 0, t1: D, y: 3, bob: 2, outline: true }) }, { ...XMAS, n: "#a0602a" });
}

function rudolphWalk() {
  const D = 7000, y = 17;
  return scene({ name: "Rudolph walks", duration: D, background: "transit", sprites: {
    rudolph: { frame_ms: 180, frames: RUDOLPH_WALK },
  }, actors: [{ sprite: "rudolph", outline: true, keyframes: [{ t: 0, x: -18, y }, { t: D, x: 66, y }] }] }, XMAS);
}

function rudolphFlies() {
  const r = rng(91), D = 7000;
  const sky = NIGHT_SKY(9, 16, D);
  const fly = path(0, D, (u) => ({ x: -18 + 86 * u, y: 15 - 11 * Math.sin(u * 3.14) }), 28);
  const actors = [...sky];
  for (let i = 0; i < 11; i++) {   // sparkles left behind
    const k = fly[Math.min(fly.length - 1, 4 + i * 2)];
    actors.push({ sprite: "star", phase: i * 130, keyframes: [{ t: k.t, x: k.x + 2, y: k.y + 9 }, { t: k.t + 1000, x: k.x, y: k.y + 12 }] });
  }
  actors.push({ sprite: "rudolph", keyframes: path(0, D, (u) => ({ x: -18 + 86 * u, y: 15 - 11 * Math.sin(u * 3.14) }), 10),
    sway: { x: 0, y: 2, ms: 1100 } });
  return scene({ name: "Rudolph flies", duration: D, sprites: {
    rudolph: { frame_ms: 200, frames: RUDOLPH_FLY },
    star: { frame_ms: 300, frames: STAR }, twinkle: { frame_ms: 250, frames: TWINKLE },
  }, actors }, XMAS);
}

function elves() {
  const D = 7500, y = 19;
  const walk = (sprite, dx, ph, hop) => ({ sprite, outline: true, phase: ph,
    keyframes: path(0, D, (u) => ({ x: -26 + dx + 96 * u, y: y - (hop ? Math.abs(Math.sin(u * 28)) * 2 : 0) }), 30) });
  return scene({ name: "Elves", duration: D, background: "transit", sprites: {
    elf: { frame_ms: 200, frames: ELF }, carry: { frame_ms: 200, frames: ELF_CARRY },
  }, actors: [walk("elf", 0, 0, true), walk("carry", 12, 200, false)] }, XMAS);
}

function snowman() {
  const r = rng(101), D = 10000;
  const x = 23, y = 7;
  return scene({ name: "Snowman", duration: D, sprites: {
    snowman: { frame_ms: 1000, frames: [SNOWMAN] }, arm: { frame_ms: 220, frames: SNOWMAN_ARM }, armL: { frame_ms: 1000, frames: SNOWMAN_ARM_L },
    flake: { frame_ms: 500, frames: FLAKE }, dot: { frame_ms: 1000, frames: DOT },
    bankL: { frame_ms: 1000, frames: SNOWBANK(2) }, bankR: { frame_ms: 1000, frames: SNOWBANK(6) },
  }, actors: [
    { sprite: "bankL", keyframes: hold(0, D, 0, 29) }, { sprite: "bankR", keyframes: hold(0, D, 32, 29) },
    { sprite: "snowman", keyframes: hold(0, D, x, y) },
    { sprite: "armL", keyframes: hold(0, D, x - 5, y + 10) },
    { sprite: "arm", keyframes: hold(0, D, x + 15, y + 5) },
    ...snowfall(r, 22, { D, every: 430 }),
  ] }, XMAS);
}

// ---------------------------------------------------------------------------
// The packs
// ---------------------------------------------------------------------------
const PACKS = [
  { id: "thanksgiving", name: "Thanksgiving", blurb: "Autumn trees, falling leaves, gusts of wind, and a strutting turkey.",
    build: { gust: autumnGust, leaves: fallingLeaves, wind: leafGust, turkey: turkeyStrut, grove: turkeyGrove } },
  { id: "christmas", name: "Christmas", blurb: "Twinkling trees, snow, Santa's sleigh, Rudolph, elves, and a snowman.",
    build: { trees: xmasTrees, snow: snowfallOverlay, sleigh: santaNight, flyby: santaFlyBy, rudolph: rudolphWalk,
      rudolphfly: rudolphFlies, elves, snowman } },
];

let cache = null;

/** All packs with their animations (validated specs). */
function packs() {
  if (cache) return cache;
  cache = PACKS.map((p) => ({
    id: p.id, name: p.name, blurb: p.blurb,
    animations: Object.entries(p.build).map(([key, fn]) => ({ id: `${p.id}.${key}`, spec: normalizeSpec(fn()) })),
  }));
  return cache;
}

const findPack = (id) => packs().find((p) => p.id === id) || null;

/** Look up one pack animation by its id ("christmas.snowman"). */
function packAnimation(id) {
  for (const p of packs()) for (const a of p.animations) if (a.id === id) return a;
  return null;
}

module.exports = { packs, findPack, packAnimation };

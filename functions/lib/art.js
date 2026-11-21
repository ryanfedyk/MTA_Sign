// Hand-drawn pixel art for the seasonal packs (and the holiday sprites in the
// Gemini / Quick-animation library). Each piece is drawn with its own small
// palette (AUTUMN, XMAS); single characters are colors and "." is transparent.
// Some pieces are generated (trees, leaf litter) from a seeded random number
// generator, so they come out the same every time.

function rng(seed) {                       // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (r, lo, hi) => lo + r() * (hi - lo);

const irange = (r, lo, hi) => Math.floor(range(r, lo, hi + 1));

const pick = (r, list) => list[Math.floor(r() * list.length)];

/** Recolor a sprite's frames: map = { fromChar: toChar }. */
const recolor = (frames, map) => frames.map((f) => f.map((row) => [...row].map((c) => map[c] || c).join("")));

/** Mirror frames left-right. */
const mirror = (frames) => frames.map((f) => f.map((row) => [...row].reverse().join("")));

/** Make an empty grid. */
const grid = (w, h) => Array.from({ length: h }, () => Array(w).fill("."));

const rows = (g) => g.map((r) => r.join(""));

const AUTUMN = {
  T: "#a85e22", t: "#6e3a12",                    // trunk, trunk shadow
  r: "#ff2a10", o: "#ff7a0a", y: "#ffc21a", R: "#b01606", n: "#9a4a10",   // leaves
  w: "#6f88b0", W: "#d8e8ff",                    // wind
  B: "#8b4a1e", b: "#5a2a0a", k: "#000000", c: "#ffe1af", h: "#ff4060", // turkey
  g: "#4a3010",                                  // ground leaf litter shadow
};

/** A leafy autumn tree whose trunk is on the left. lean = canopy pushed by wind (+ right, - left). */
function autumnTree(seed, lean = 0) {
  const W = 24, H = 32, r = rng(seed), g = grid(W, H);
  // trunk + branches first, so gaps in the leaves show them
  for (let y = 12; y < H; y++) {
    const x0 = y > 28 ? 5 : y > 22 ? 6 : 7, wdt = y > 28 ? 5 : y > 22 ? 3 : 2;
    for (let x = x0; x < x0 + wdt; x++) g[y][x] = x === x0 ? "t" : "T";
  }
  g[31][4] = "t"; g[31][10] = "T"; g[30][10] = "T";
  for (const [x, y] of [[9, 15], [10, 14], [11, 13], [12, 12], [13, 11], [14, 10], [6, 14], [5, 13], [4, 12], [3, 11],
    [9, 11], [10, 10], [10, 9], [16, 10], [17, 9], [8, 10], [8, 9]]) g[y][x] = "T";
  const blobs = [[8, 6, 6], [15, 5, 5], [4, 10, 4.5], [13, 11, 5.5], [19, 9, 3.5], [9, 12, 4]];
  const colorAt = (x, y) => {           // clumps of color, darker underneath
    const cell = ((x >> 2) * 7 + (y >> 2) * 13 + seed) % 11;
    if (y > 13 && r() < 0.45) return pick(r, ["R", "n"]);
    if (r() < 0.15) return pick(r, ["y", "o", "r", "R"]);
    return ["r", "o", "y", "o", "r", "R", "o", "y", "r", "o", "y"][cell];
  };
  for (let y = 0; y < 18; y++) {
    const shift = Math.round(lean * (18 - y) / 7);
    for (let x = 0; x < W; x++) {
      let inside = false, edge = false;
      for (const [cx, cy, rad] of blobs) {
        const d = Math.hypot(x - shift - cx, (y - cy) * 1.15);
        if (d < rad - 1) inside = true; else if (d < rad + 0.5) edge = true;
      }
      if (inside && r() < 0.86) g[y][x] = colorAt(x, y);
      else if (!inside && edge && r() < 0.4) g[y][x] = colorAt(x, y);
    }
  }
  return rows(g);
}

// 3x3 leaf, 4 tumble frames (drawn with "x", recolored per leaf color)
const LEAF = [
  ["xx.", ".xx", "..."],
  [".x.", ".x.", ".x."],
  [".xx", "xx.", "..."],
  ["...", "xxx", "..."],
];

// gust streak, 18x3, shimmering
const GUST = [
  ["............www...", "wwwwwwWWWWWW...w..", "..............w..."],
  ["..........ww......", "wwwwWWWWWWww..w...", ".............w...."],
];

// leaf litter along the ground (two halves of the screen)
function leafLitter(seed) {
  const r = rng(seed), g = grid(32, 2);
  for (let x = 0; x < 32; x++) {
    if (r() < 0.75) g[1][x] = pick(r, ["r", "o", "y", "R", "n", "g"]);
    if (r() < 0.25) g[0][x] = pick(r, ["r", "o", "y"]);
  }
  return [rows(g)];
}

// Turkey, side view facing right (16x14), 2-frame strut
const TURKEY_WALK = [
  [
    "................",
    "............hh..",
    ".cB.........hkhy",
    "cBbB.......hhhyy",
    "BboBc......hh...",
    "BbyoBc....BBh...",
    ".BboBBBBBBBBh...",
    "..BBBbBbBbBBB...",
    "...BbBbBbBbBB...",
    "....BBBbBbBB....",
    ".....BBBBBB.....",
    "......o...o.....",
    ".....o.....o....",
    "....oo.....oo...",
  ],
  [
    "................",
    "............hh..",
    ".cB.........hkhy",
    "cBbB.......hhhyy",
    "BboBc......hh...",
    "BbyoBc....BBh...",
    ".BboBBBBBBBBh...",
    "..BBBbBbBbBBB...",
    "...BbBbBbBbBB...",
    "....BBBbBbBB....",
    ".....BBBBBB.....",
    ".......o.o......",
    ".......o.o......",
    "......oo.oo.....",
  ],
];

// Turkey facing you with its tail fanned (20x16), 2 frames (gobble)
const TURKEY_FAN = [
  [
    "......cyc.cyc.......",
    "...cyc.rBr.rBr.cyc..",
    "..yrBryoBoyoBoyrBry.",
    ".crBo.yoBoBoBoy.oBrc",
    ".yBoryoBbBbBbBoyroBy",
    "crBoroBbBbBbBbBoroBr",
    "yBobBBbBhhhhBbBBboBy",
    "rBbBBBBhhkkhhBBBBbBr",
    ".BBbBBBhhyyhhBBBbBB.",
    "..BBBbBBhhhhBBbBBB..",
    "...BBBbBBhhBBbBBB...",
    "....BBBBbhhbBBBB....",
    ".....BBBBBBBBBB.....",
    ".......BBBBBB.......",
    "........o..o........",
    ".......oo..oo.......",
  ],
  [
    "......cyc.cyc.......",
    "...cyc.rBr.rBr.cyc..",
    "..yrBryoBoyoBoyrBry.",
    ".crBo.yoBoBoBoy.oBrc",
    ".yBoryoBbBbBbBoyroBy",
    "crBoroBbBbBbBbBoroBr",
    "yBobBBbBhhhhBbBBboBy",
    "rBbBBBBhhkkhhBBBBbBr",
    ".BBbBBBhhyyhhBBBbBB.",
    "..BBBbBBhhhhBBbBBB..",
    "...BBBbBBhhhBBbBBB..",
    "....BBBBbhhhbBBB....",
    ".....BBBBBhBBBBB....",
    ".......BBBBBB.......",
    "........o..o........",
    ".......oo..oo.......",
  ],
];

const XMAS = {
  G: "#16a02a", g: "#0a5a16",                    // tree greens
  T: "#7a3f14",                                  // trunk / sticks
  y: "#ffd21a", Y: "#fff6b0",                    // gold, star glow
  r: "#ff1e1e", b: "#3c6cff", p: "#ff50c8", W: "#ffffff", B: "#a8c8ff",   // lights, snow
  R: "#d0101a", f: "#ffc29a", k: "#000000",     // Santa red, skin, black
  N: "#9a5626", L: "#e0b078", a: "#f0dca0",     // reindeer brown, light, antler
  o: "#ff8a1a", e: "#3cdc3c",                    // carrot, elf green
};

/** Christmas tree (15x26) with blinking lights; returns 3 frames. */
function xmasTree(seed) {
  const W = 15, H = 26, r = rng(seed);
  const base = grid(W, H);
  const tiers = [[4, 10, 1, 4], [9, 17, 3, 6], [15, 23, 4, 7]];   // [top, bottom, start half-width, end half-width]
  for (const [y0, y1, w0, w1] of tiers) {
    for (let y = y0; y < y1; y++) {
      const half = Math.round(w0 + (w1 - w0) * (y - y0) / (y1 - y0 - 1));
      for (let x = 7 - half; x <= 7 + half; x++) base[y][x] = x === 7 - half || x === 7 + half || y === y1 - 1 ? "g" : (r() < 0.85 ? "G" : "g");
    }
  }
  base[0][7] = "y"; base[1][6] = "y"; base[1][7] = "Y"; base[1][8] = "y"; base[2][7] = "y"; base[3][7] = "G";
  base[1][5] = "."; base[1][9] = ".";
  for (let y = 23; y < 26; y++) for (let x = 6; x <= 8; x++) base[y][x] = "T";
  // lights along diagonal garlands
  const lights = [];
  for (const [y, xs] of [[6, [6, 9]], [8, [5, 8]], [11, [5, 9]], [13, [4, 7, 10]], [15, [3, 9]], [17, [4, 7, 11]], [19, [3, 6, 10]], [21, [5, 8, 12]], [22, [2]]]) {
    for (const x of xs) if (base[y][x] !== ".") lights.push([x, y]);
  }
  const colors = ["r", "y", "b", "p"];
  return [0, 1, 2].map((f) => {
    const g = base.map((row) => row.slice());
    lights.forEach(([x, y], i) => { g[y][x] = colors[(i + f) % colors.length]; });
    if (f === 1) { g[0][7] = "Y"; g[1][5] = "y"; g[1][9] = "y"; }   // star twinkle
    return rows(g);
  });
}

const FLAKE = [[".W.", "WBW", ".W."], ["W.W", ".W.", "W.W"]];

const DOT = [["W"]];

const SNOWBANK = (seed) => {
  const r = rng(seed), g = grid(32, 3);
  for (let x = 0; x < 32; x++) {
    const h = 1 + (Math.sin(x / 4 + seed) > 0.3 ? 1 : 0) + (r() < 0.15 ? 1 : 0);
    for (let y = 3 - h; y < 3; y++) g[y][x] = y === 3 - h ? "W" : "B";
  }
  return [rows(g)];
};

const SANTA = [   // 20x10 sleigh with Santa and his sack, facing right
  [
    "....WRR.............",
    ".....RRR............",
    "nn...WWWW...........",
    "nnn..fkfW...........",
    "nnnn.WWWWRR.......y.",
    "nnnnRRRRRRfk......y.",
    "RRRRRRRRRRRRRRRRRRy.",
    ".RRRRRRRRRRRRRRRRy..",
    "..y.......y......y..",
    "yyyyyyyyyyyyyyyyy...",
  ],
];

// flying reindeer (13x10), 2 frames; nose drawn with "x"
const REINDEER = (() => {
  const top = [
    ".........a.a.",
    "..........aa.",
    "..........NNN",
    ".........NNkN",
    "L........NNNx",
    ".NNNNNNNNNN..",
    ".NNNNNNNNNN..",
    "..LLLLLLLN...",
  ];
  return [
    [...top, ".N.......N...", "N.........N.."],
    [...top, "..N.....N....", "..N.....N...."],
  ];
})();

// Rudolph (16x14): bigger, with a glowing nose. Legs make the walk / flight.
function rudolphFrames(legSets) {
  const body = [
    "..........a.a.a.",
    "...........aaa..",
    "............a...",
    "...........NNN..",
    "..........NNkNN.",
    "..........NNNNNx",
    "..........NNN...",
    ".L.NNNNNNNNNN...",
    "LNNNNNNNNNNNN...",
    "..NNNNNNNNNNN...",
    "..LLLLLLLLLL....",
  ];
  return legSets.map((legs, i) => {
    const glow = i % 2 === 0;
    return [...body, ...legs].map((row, y) => [...row].map((c, x) => {
      if (c === "x") return glow ? "r" : "R";
      if (glow && c === "." && x === 15 && (y === 4 || y === 6)) return "p";
      return c;
    }).join(""));
  });
}

const RUDOLPH_WALK = rudolphFrames([
  [".N..N....NN.....", "N....N...NN.....", "N....N...NN....."],
  ["..NN.....NN.....", "..NN.....NN.....", "..NN.....NN....."],
  ["..NN....N..N....", "..NN...N....N...", "..NN...N....N..."],
  ["..NN.....NN.....", "..NN.....NN.....", "..NN.....NN....."],
]);

const RUDOLPH_FLY = rudolphFrames([
  ["NNN......NNNN...", "................", "................"],
  [".NN.......NN....", "N...........N...", "................"],
]);

// elf (7x13) walking, 2 frames
const ELF = (() => {
  const top = [
    "..e....",
    "..ee...",
    ".eeee..",
    ".WWWW..",
    "ffffkf.",
    ".ffff..",
    ".rrrr..",
    "eeeeee.",
    ".eyee..",
    ".eeee..",
  ];
  return [
    [...top, ".r..r..", ".W..W..", "ee..ee."],
    [...top, "..rr...", "..WW...", ".eeee.."],
  ];
})();

// an elf carrying a present in front of it (11x13)
const ELF_CARRY = ELF.map((f) => {
  const g = f.map((row) => [...(row + "....")]);
  ["ryrr", "yyyy", "ryrr", "ryrr"].forEach((row, y) => [...row].forEach((c, x) => { g[6 + y][7 + x] = c; }));
  g[8][6] = "f";
  return rows(g);
});

// snowman (17x24); the stick arm on the right waves (3 frames)
const SNOWMAN = (() => {
  const base = [
    ".....rrrrr.......",
    "....rrrrrrr......",
    "....WWWWWWW......",
    "...WWWWWWWWW.....",
    "...WWkWWWkWB.....",
    "...WWWWooWWB.....",
    "...WWWWWoooB.....",
    "...WkWWWkWWB.....",
    "....WWkkkWB......",
    "...rrrrrrrrr.....",
    "..WWWWWrrWWWWB...",
    ".WWWWWWrrWWWWWB..",
    ".WWWWWWkWWWWWWB..",
    "WWWWWWWWWWWWWWWB.",
    "WWWWWWWkWWWWWWWB.",
    "WWWWWWWWWWWWWWWB.",
    ".WWWWWWkWWWWWWB..",
    "WWWWWWWWWWWWWWWB.",
    "WWWWWWWWWWWWWWWBB",
    "WWWWWWWWWWWWWWWWB",
    "WWWWWWWWWWWWWWWWB",
    "WWWWWWWWWWWWWWWWB",
    ".WWWWWWWWWWWWWWB.",
    "..BBBBBBBBBBBBB..",
  ];
  return base;
})();

const SNOWMAN_ARM = [   // 6x7 waving stick arm (3 frames); attaches at its bottom-left
  ["....T.", "...T.T", "...T..", "..T...", ".T....", "T.....", "......"],
  [".....T", "....TT", "...T..", "..T...", ".T....", "T.....", "......"],
  ["......", "......", "....TT", "...T.T", "..T...", ".TT...", "T....."],
];

const SNOWMAN_ARM_L = [["T.....", ".T....", "..T...", "...T..", "....T.", "....T.", "......"].map((r) => [...r].reverse().join(""))];

/** A smaller tree (13x16) with gifts, for the middle. */
function xmasTreeSmall() {
  const big = xmasTree(7);
  return big.map((f) => {
    const g = grid(15, 16);
    // compress: keep rows 0-3 (star) + every other row of the canopy
    const pickRows = [0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 23, 24, 25];
    pickRows.forEach((src, y) => { g[y] = [...f[src]]; });
    for (const [x, y, c] of [[2, 15, "r"], [3, 15, "y"], [4, 15, "r"], [2, 14, "y"], [3, 14, "y"], [4, 14, "y"],
      [10, 15, "b"], [11, 15, "W"], [12, 15, "b"], [11, 14, "W"], [10, 14, "b"], [12, 14, "b"]]) g[y][x] = c;
    return rows(g);
  });
}

const STAR = [["..y..", ".yYy.", "..y.."], ["..Y..", ".yWy.", "..Y.."], [".....", "..y..", "....."]];

const TWINKLE = [["Y"], ["y"], ["."], ["y"]];

const MOON = [[".WWW..", "WWW...", "WW....", "WW....", "WWW...", ".WWW.."]];

module.exports = {
  rng, range, irange, pick, recolor, mirror, grid, rows,
  AUTUMN, XMAS, autumnTree, leafLitter, LEAF, GUST, TURKEY_WALK, TURKEY_FAN,
  xmasTree, xmasTreeSmall, FLAKE, DOT, SNOWBANK, SANTA, REINDEER, RUDOLPH_WALK, RUDOLPH_FLY,
  ELF, ELF_CARRY, SNOWMAN, SNOWMAN_ARM, SNOWMAN_ARM_L, STAR, TWINKLE, MOON,
};

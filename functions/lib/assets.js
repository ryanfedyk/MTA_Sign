// Hand-drawn sprite library, shared by:
//   - Gemini (it references these by name instead of drawing cats from scratch)
//   - the "Quick animation" builder in the web app (no AI needed)
//
// Every sprite faces RIGHT (use flip to face left). Characters are drawn in a
// shared palette (ASSET_PALETTE) so they look consistent next to each other.

const ASSET_PALETTE = {
  o: "#ff7d0f", // orange fur
  d: "#a53700", // dark orange stripes
  w: "#ffe1af", // cream
  p: "#ff698c", // pink
  e: "#78ff50", // green eyes
  g: "#b4b4be", // grey (mouse)
  b: "#4664ff", // blue (yarn, bird)
  B: "#aabeff", // light blue
  r: "#ff2828", // red (laser, heart)
  R: "#ffb4b4", // laser glow
  y: "#fff0a0", // yellow (stars, moon)
  W: "#ffffff", // white
  k: "#000000", // black (pupils; blocks what's behind)
};

const ASSETS = {
  cat_walk: {
    label: "Cat walking", frame_ms: 140, notes: "16x11, 4-frame walk cycle. Stands on y = 21 to walk along the bottom.",
    frames: [
      [".o........o....o", "o.........oo..oo", "o.........oooooo", "o.........oeooeo", ".ooodoodooowppwo", "..oodoodoooowwo.",
        "..oodoodoooo....", "..oooooooooo....", "..owwwwwwwoo....", "..o..o...o..o...", ".o...o..o....o.."],
      ["o.........o....o", "o.........oo..oo", "o.........oooooo", ".o........oeooeo", ".ooodoodooowppwo", "..oodoodoooowwo.",
        "..oodoodoooo....", "..oooooooooo....", "..owwwwwwwoo....", "...o.o....o.o...", "...o.o....o.o..."],
      [".o........o....o", "o.........oo..oo", "o.........oooooo", "o.........oeooeo", ".ooodoodooowppwo", "..oodoodoooowwo.",
        "..oodoodoooo....", "..oooooooooo....", "..owwwwwwwoo....", "...oo.....oo....", "...oo.....oo...."],
      ["o.........o....o", ".o........oo..oo", "o.........oooooo", "o.........oeooeo", ".ooodoodooowppwo", "..oodoodoooowwo.",
        "..oodoodoooo....", "..oooooooooo....", "..owwwwwwwoo....", "...o.o....o.o...", "...o.o....o.o..."],
    ],
  },
  cat_run: {
    label: "Cat running", frame_ms: 110, notes: "16x11, 2-frame gallop, ears back. Use for chasing; y = 21 for the bottom.",
    frames: [
      ["................", "..........o...o.", "oo........oo.oo.", "..o.......ooooo.", "...ooodoodoeooeo", "...oodoodoowppwo",
        "..oodoodoooowwo.", "..ooooooooooo...", ".owwwwwwwwwo....", "oo.........oo...", "o............o.."],
      ["................", "..........o...o.", "..........oo.oo.", "ooo.......ooooo.", "...ooodoodoeooeo", "...oodoodoowppwo",
        "...odoodoooowwo.", "...oooooooooo...", "....owwwwwwo....", "....oo..oo......", "....o....o......"],
    ],
  },
  cat_sit: {
    label: "Cat sitting", frame_ms: 450, notes: "12x12, sitting and swishing its tail (2 frames). y = 20 to sit on the bottom.",
    frames: [
      ["......o...o.", "......oo.oo.", "......ooooo.", "......oeoeo.", "......owpwo.", ".....ooooo..",
        "....oodooo..", "...oodoodo..", "...ooooooo..", "...owwwwoo..", "o..owwwwoo..", "oooowwwwwwo."],
      ["......o...o.", "......oo.oo.", "......ooooo.", "......oeoeo.", "......owpwo.", ".....ooooo..",
        "....oodooo..", "...oodoodo..", "o..ooooooo..", "o..owwwwoo..", ".o.owwwwoo..", "..oowwwwwwo."],
    ],
  },
  cat_sleep: {
    label: "Cat sleeping", frame_ms: 700, notes: "16x7, curled up asleep, breathing (2 frames). y = 25 for the bottom.",
    frames: [
      ["................", "...........o.o..", "....ooooo..oooo.", "..oodoodoooodood", ".ooodoodoooooppo", "oowooooooooooo..", ".ooooooooooooo.."],
      ["...........o.o..", "....ooooo..oooo.", "..oodoodoooodood", ".ooodoodoooooppo", "oowooooooooooo..", ".oooooooooooooo.", "................"],
    ],
  },
  cat_face: {
    label: "Cat face", frame_ms: 160, notes: "18x15 big front-facing head; frame 2 is a blink. Rise from y = 32 to y = 17 to peek up.",
    frames: [
      ["..o............o..", "..oo..........oo..", "..opo........opo..", "..oppo......oppo..", "..oooooooooooooo..",
        ".oooodoodoodooooo.", ".oooooooooooooooo.", ".oooeeooooooeeooo.", ".oooekooooookeooo.", "gooooooowpwoooooog",
        ".gooooowwpwwoooog.", "goooooowwwwoooooog", ".oooooooooooooooo.", "..oooooooooooooo..", "...oooooooooooo..."],
      ["..o............o..", "..oo..........oo..", "..opo........opo..", "..oppo......oppo..", "..oooooooooooooo..",
        ".oooodoodoodooooo.", ".oooooooooooooooo.", ".oooooooooooooooo.", ".oookkooooookkooo.", "gooooooowpwoooooog",
        ".gooooowwpwwoooog.", "goooooowwwwoooooog", ".oooooooooooooooo.", "..oooooooooooooo..", "...oooooooooooo..."],
    ],
  },
  yarn: {
    label: "Ball of yarn", frame_ms: 120, notes: "6x6, rolling (2 frames). y = 26 for the bottom.",
    frames: [
      [".bbbb.", "bBbbBb", "bbBBbb", "bbBBbb", "bBbbBb", ".bbbb."],
      [".bBbb.", "bbbBbb", "Bbbbbb", "bbbbbB", "bbBbbb", ".bbBb."],
    ],
  },
  mouse: {
    label: "Mouse", frame_ms: 120, notes: "8x5, scurrying (2 frames). y = 27 for the bottom.",
    frames: [
      ["....gg..", "...gggg.", "g.ggggkg", ".ggggggp", "..g...g."],
      ["....gg..", "...gggg.", "g.ggggkg", ".ggggggp", "...g.g.."],
    ],
  },
  laser: {
    label: "Laser dot", frame_ms: 90, notes: "3x3 glowing red dot (flickers). Cats love chasing it.",
    frames: [[".R.", "RrR", ".R."], ["...", ".r.", "..."]],
  },
  butterfly: {
    label: "Butterfly", frame_ms: 150, notes: "5x5, flapping (2 frames). Flutters in the air.",
    frames: [
      ["pp.pp", "ppypp", ".pyp.", "pp.pp", "....."],
      [".....", ".pyp.", "ppypp", ".p.p.", "....."],
    ],
  },
  bird: {
    label: "Bird", frame_ms: 160, notes: "7x5, flapping (2 frames). Flies right.",
    frames: [
      ["b...b..", ".b.b...", "..bbbby", "...bb..", "......."],
      [".......", "..bbbby", ".b.bb..", "b...b..", "......."],
    ],
  },
  heart: {
    label: "Heart", frame_ms: 300, notes: "7x6 red heart, pulsing (2 frames).",
    frames: [
      [".rr.rr.", "rrrrrrr", "rrrrrrr", ".rrrrr.", "..rrr..", "...r..."],
      [".......", ".rr.rr.", ".rrrrr.", "..rrr..", "...r...", "......."],
    ],
  },
  star: {
    label: "Star", frame_ms: 300, notes: "5x5 twinkling star (2 frames).",
    frames: [
      ["..y..", "..y..", "yyWyy", "..y..", "..y.."],
      [".....", "..y..", ".yWy.", "..y..", "....."],
    ],
  },
  moon: {
    label: "Moon", frame_ms: 1000, notes: "6x6 crescent moon (1 frame).",
    frames: [[".yyy..", "yyy...", "yy....", "yy....", "yyy...", ".yyy.."]],
  },
  zzz: {
    label: "Zzz", frame_ms: 400, notes: "5x7 sleepy Z's floating (2 frames). Put above a sleeping cat.",
    frames: [
      ["WWW..", "..W..", "WWW..", ".....", "..WWW", "...W.", "..WWW"],
      [".....", "WWW..", ".W...", "WWW..", "..WWW", "...W.", "..WWW"],
    ],
  },
};

/** Short catalog text for Gemini's instructions. */
function catalogText() {
  return Object.entries(ASSETS).map(([id, a]) => {
    const f = a.frames[0];
    return `- "${id}" (${a.label}): ${f[0].length}x${f.length}, ${a.frames.length} frame(s). ${a.notes}`;
  }).join("\n");
}

module.exports = { ASSET_PALETTE, ASSETS, catalogText };

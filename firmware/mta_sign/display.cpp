#include "display.h"
#include "fonts.h"
#include <stdio.h>
#include <string.h>

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------
static const uint16_t C_BLACK   = 0;
static const uint16_t C_WHITE   = rgb565(255, 255, 255);
static const uint16_t C_AMBER   = rgb565(255, 180, 50);    // live GPS
static const uint16_t C_LABEL   = rgb565(180, 180, 180);
static const uint16_t C_DIM     = rgb565(140, 140, 145);
static const uint16_t C_COMMA   = rgb565(130, 130, 135);
static const uint16_t C_RULE    = rgb565(35, 35, 40);
static const uint16_t C_L_GREY  = rgb565(85, 90, 95);      // L train bullet
static const uint16_t C_B_BLUE  = rgb565(0, 55, 165);      // bus badge
static const uint16_t C_MESSAGE = rgb565(255, 205, 130);   // warm white for messages

// ---------------------------------------------------------------------------
// Pixel-art sprites. One string per row; each character is a palette entry:
//   .  transparent        k  black (blocks what's behind)
//   o  orange fur         d  dark-orange stripe
//   w  cream              p  pink
//   e  green eye          g  grey whisker
//   b  yarn blue          B  yarn highlight
// ---------------------------------------------------------------------------
static uint16_t paletteColor(char c) {
  switch (c) {
    case 'o': return rgb565(255, 125, 15);
    case 'd': return rgb565(165, 55, 0);
    case 'w': return rgb565(255, 225, 175);
    case 'p': return rgb565(255, 105, 140);
    case 'e': return rgb565(120, 255, 80);
    case 'g': return rgb565(120, 120, 125);
    case 'b': return rgb565(70, 100, 255);
    case 'B': return rgb565(170, 190, 255);
    default:  return C_BLACK;   // 'k'
  }
}

// Draw a sprite at (x, y). If `outline` is set, a 1-pixel black halo is drawn
// around the cat first, so it reads cleanly when it walks in front of the
// arrival times instead of blending into them.
static void drawSprite(Adafruit_GFX& g, const char* const* rows, int h, int x, int y,
                       bool outline, bool mirror = false) {
  auto px = [&](int c, int w) { return mirror ? x + (w - 1 - c) : x + c; };
  if (outline) {
    static const int dx[4] = {1, -1, 0, 0}, dy[4] = {0, 0, 1, -1};
    for (int r = 0; r < h; r++) {
      int w = (int)strlen(rows[r]);
      for (int c = 0; c < w; c++) {
        if (rows[r][c] == '.') continue;
        for (int k = 0; k < 4; k++) {
          int X = px(c, w) + (mirror ? -dx[k] : dx[k]), Y = y + r + dy[k];
          if (X >= 0 && X < SCREEN_W && Y >= 0 && Y < SCREEN_H) g.drawPixel(X, Y, C_BLACK);
        }
      }
    }
  }
  for (int r = 0; r < h; r++) {
    const char* row = rows[r];
    int w = (int)strlen(row);
    int py = y + r;
    if (py < 0 || py >= SCREEN_H) continue;
    for (int c = 0; c < w; c++) {
      char ch = row[c];
      if (ch == '.') continue;
      int X = px(c, w);
      if (X < 0 || X >= SCREEN_W) continue;
      g.drawPixel(X, py, paletteColor(ch));
    }
  }
}

// Orange tabby walking right. 16 x 11.
static const int CAT_W = 16, CAT_H = 11;
static const char* const CAT_WALK[4][CAT_H] = {
  { // stride A
    ".o........o....o",
    "o.........oo..oo",
    "o.........oooooo",
    "o.........oeooeo",
    ".ooodoodooowppwo",
    "..oodoodoooowwo.",
    "..oodoodoooo....",
    "..oooooooooo....",
    "..owwwwwwwoo....",
    "..o..o...o..o...",
    ".o...o..o....o..",
  },
  { // passing
    "o.........o....o",
    "o.........oo..oo",
    "o.........oooooo",
    ".o........oeooeo",
    ".ooodoodooowppwo",
    "..oodoodoooowwo.",
    "..oodoodoooo....",
    "..oooooooooo....",
    "..owwwwwwwoo....",
    "...o.o....o.o...",
    "...o.o....o.o...",
  },
  { // stride B
    ".o........o....o",
    "o.........oo..oo",
    "o.........oooooo",
    "o.........oeooeo",
    ".ooodoodooowppwo",
    "..oodoodoooowwo.",
    "..oodoodoooo....",
    "..oooooooooo....",
    "..owwwwwwwoo....",
    "...oo.....oo....",
    "...oo.....oo....",
  },
  { // passing (tail other way)
    "o.........o....o",
    ".o........oo..oo",
    "o.........oooooo",
    "o.........oeooeo",
    ".ooodoodooowppwo",
    "..oodoodoooowwo.",
    "..oodoodoooo....",
    "..oooooooooo....",
    "..owwwwwwwoo....",
    "...o.o....o.o...",
    "...o.o....o.o...",
  },
};

// Running (stretched) cat for the chase. 16 x 11, ears back.
static const char* const CAT_RUN[2][CAT_H] = {
  {
    "................",
    "..........o...o.",
    "oo........oo.oo.",
    "..o.......ooooo.",
    "...ooodoodoeooeo",
    "...oodoodoowppwo",
    "..oodoodoooowwo.",
    "..ooooooooooo...",
    ".owwwwwwwwwo....",
    "oo.........oo...",
    "o............o..",
  },
  {
    "................",
    "..........o...o.",
    "..........oo.oo.",
    "ooo.......ooooo.",
    "...ooodoodoeooeo",
    "...oodoodoowppwo",
    "...odoodoooowwo.",
    "...oooooooooo...",
    "....owwwwwwo....",
    "....oo..oo......",
    "....o....o......",
  },
};

// Ball of yarn, 6 x 6, rolling (two frames).
static const int YARN_W = 6, YARN_H = 6;
static const char* const YARN[2][YARN_H] = {
  { ".bbbb.", "bBbbBb", "bbBBbb", "bbBBbb", "bBbbBb", ".bbbb." },
  { ".bBbb.", "bbbBbb", "Bbbbbb", "bbbbbB", "bbBbbb", ".bbBb." },
};

// Big cat face that peeks up from the bottom. 18 x 15.
static const int FACE_W = 18, FACE_H = 15;
static const char* const FACE_OPEN[FACE_H] = {
  "..o............o..",
  "..oo..........oo..",
  "..opo........opo..",
  "..oppo......oppo..",
  "..oooooooooooooo..",
  ".oooodoodoodooooo.",
  ".oooooooooooooooo.",
  ".oooeeooooooeeooo.",
  ".oooekooooookeooo.",
  "gooooooowpwoooooog",
  ".gooooowwpwwoooog.",
  "goooooowwwwoooooog",
  ".oooooooooooooooo.",
  "..oooooooooooooo..",
  "...oooooooooooo...",
};
static const char* const FACE_BLINK[FACE_H] = {
  "..o............o..",
  "..oo..........oo..",
  "..opo........opo..",
  "..oppo......oppo..",
  "..oooooooooooooo..",
  ".oooodoodoodooooo.",
  ".oooooooooooooooo.",
  ".oooooooooooooooo.",
  ".oookkooooookkooo.",
  "gooooooowpwoooooog",
  ".gooooowwpwwoooog.",
  "goooooowwwwoooooog",
  ".oooooooooooooooo.",
  "..oooooooooooooo..",
  "...oooooooooooo...",
};

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------
AnimKind animFromName(const char* name) {
  if (!name) return ANIM_NONE;
  if (!strcmp(name, "walk"))  return ANIM_WALK;
  if (!strcmp(name, "chase")) return ANIM_CHASE;
  if (!strcmp(name, "peek"))  return ANIM_PEEK;
  return ANIM_NONE;
}

// ---------------------------------------------------------------------------
// Text helpers (default 5x7 Adafruit font: 6px per char at size 1, 12px at size 2)
// ---------------------------------------------------------------------------

static void printAt(Adafruit_GFX& g, int x, int y, uint8_t size, uint16_t color, const char* s) {
  g.setTextWrap(false);
  g.setTextSize(size);
  g.setTextColor(color);
  g.setCursor(x, y);
  g.print(s);
}

static void printNumAt(Adafruit_GFX& g, int x, int y, uint8_t size, uint16_t color, int v) {
  g.setTextWrap(false);
  g.setTextSize(size);
  g.setTextColor(color);
  g.setCursor(x, y);
  g.print(v);
}

// ---------------------------------------------------------------------------
// Connecting screen
// ---------------------------------------------------------------------------
void drawConnecting(Adafruit_GFX& g, uint32_t ms, const char* detail) {
  g.fillScreen(C_BLACK);
  printAt(g, 2, 6, 1, rgb565(200, 200, 200), "CONNECTING");
  int dots = (ms / 400) % 4;
  for (int i = 0; i < dots; i++) g.drawPixel(28 + i * 3, 16, rgb565(200, 200, 200));
  if (detail && *detail) {
    int w = (int)strlen(detail) * 6 - 1;
    printAt(g, (SCREEN_W - w) / 2, 21, 1, C_AMBER, detail);
  }
}

// ---------------------------------------------------------------------------
// Weekday layout: L train on top, B48 below (unchanged from the original sign)
// ---------------------------------------------------------------------------
static void drawDualTimes(Adafruit_GFX& g, int yPos, int t1, int t2, bool live1, bool live2) {
  if (t1 < 0) {
    printAt(g, 44, yPos, 1, C_DIM, "--");
    return;
  }
  uint16_t c1 = live1 ? C_AMBER : C_WHITE;
  if (t1 == 0) printAt(g, 32, yPos, 1, c1, "AR");
  else printNumAt(g, t1 < 10 ? 37 : 31, yPos, 1, c1, t1);

  if (t2 >= 0) {
    g.drawPixel(46, yPos + 5, C_COMMA);
    g.drawPixel(45, yPos + 6, C_COMMA);
    uint16_t c2 = live2 ? C_AMBER : C_WHITE;
    if (t2 == 0) printAt(g, 50, yPos, 1, c2, "AR");
    else printNumAt(g, t2 < 10 ? 55 : 49, yPos, 1, c2, t2);
  }
}

static void drawTwoRow(Adafruit_GFX& g, const TransitData& t) {
  // Top row: L train
  g.fillRoundRect(2, 2, 11, 11, 3, C_L_GREY);
  printAt(g, 5, 4, 1, C_WHITE, "L");
  printAt(g, 16, 4, 1, C_LABEL, t.lLabel);
  drawDualTimes(g, 4, t.l1, t.l2, true, true);

  g.drawFastHLine(2, 15, 60, C_RULE);

  // Bottom row: B48 bus
  g.fillRoundRect(2, 18, 11, 11, 3, C_B_BLUE);
  printAt(g, 5, 20, 1, C_WHITE, "B");
  printAt(g, 16, 20, 1, C_LABEL, t.bLabel);
  drawDualTimes(g, 20, t.b1, t.b2, t.bLive1, t.bLive2);
}

// ---------------------------------------------------------------------------
// Custom type + shapes (see fonts.h)
// ---------------------------------------------------------------------------
enum Face { FACE_SMALL, FACE_MED, FACE_BIG };

template <typename G, size_t N>
static const char* const* findGlyph(const G (&font)[N], char c) {
  for (const auto& gl : font) if (gl.c == c) return gl.r;
  return nullptr;
}

static void blit(Adafruit_GFX& g, const char* const* rows, int h, int x, int y, uint16_t color) {
  for (int r = 0; r < h; r++)
    for (int c = 0; rows[r][c]; c++)
      if (rows[r][c] == '#') g.drawPixel(x + c, y + r, color);
}

// Draws text in one of the custom fonts (or only measures it when g is null).
// Letter spacing: 1 px (small, medium) / `bigGap` px (big). Returns the width.
static int customText(Adafruit_GFX* g, Face f, const char* s, int x, int y, uint16_t color, int bigGap = 2) {
  const int h = f == FACE_BIG ? BIG_H : f == FACE_MED ? MED_H : SMALL_H;
  const int gap = f == FACE_BIG ? bigGap : 1;
  int cx = x;
  for (const char* p = s; *p; p++) {
    const char* const* rows = f == FACE_BIG ? findGlyph(BIG_FONT, *p)
                            : f == FACE_MED ? findGlyph(MED_FONT, *p)
                                            : findGlyph(SMALL_FONT, *p);
    if (!rows) continue;
    if (g) blit(*g, rows, h, cx, y, color);
    cx += (int)strlen(rows[0]) + (p[1] ? gap : 0);
  }
  return cx - x;
}
static int textWidth(Face f, const char* s, int bigGap = 2) { return customText(nullptr, f, s, 0, 0, 0, bigGap); }

// Filled circle of an exact pixel diameter (even or odd) inside the box
// starting at (x0, y0) -- unlike fillCircle, it can be truly centred on an
// even-sized area.
static void fillDisc(Adafruit_GFX& g, int x0, int y0, int d, uint16_t color) {
  float r = d / 2.0f, r2 = r * r + r * 0.6f;   // slight bulge = rounder looking edge pixels
  for (int y = 0; y < d; y++)
    for (int x = 0; x < d; x++) {
      float dx = x + 0.5f - r, dy = y + 0.5f - r;
      if (dx * dx + dy * dy <= r2) g.drawPixel(x0 + x, y0 + y, color);
    }
}

// ---------------------------------------------------------------------------
// Weekend layout: L train only, full screen
//
//    ████     Manhattan          <- label top lines up with the top of the bullet
//   ██ L ██
//   ██   ██   12m  18            <- big next train + bold "m", medium following
//    ████                           train; bottoms line up with the bullet's bottom
//
// Everything that has to be read from across the room uses 2-px strokes.
// ---------------------------------------------------------------------------
static const uint16_t C_LABEL_SOFT = rgb565(200, 200, 205);
static const uint16_t C_AMBER_2ND  = rgb565(235, 160, 40);   // a touch softer than the next train

static const char* directionName(const char* label) {
  if (!strcmp(label, "MN")) return "Manhattan";
  if (!strcmp(label, "BK")) return "Brooklyn";
  return nullptr;
}

static void drawLOnly(Adafruit_GFX& g, const TransitData& t) {
  // Geometry
  const int DISC_X = 2, DISC_Y = 5, DISC_D = 22;          // bullet occupies rows 5..26
  const int TOP = DISC_Y, BOTTOM = DISC_Y + DISC_D - 1;    // text aligns to these
  const int TX = DISC_X + DISC_D + 3;                      // text column starts at x = 27

  // Bullet: grey disc with a bold L, optically centred (nudged right 1 px
  // because an L's weight sits on its left side).
  fillDisc(g, DISC_X, DISC_Y, DISC_D, C_L_GREY);
  const int lw = (int)strlen(BULLET_L[0]);
  blit(g, BULLET_L, BULLET_L_H,
       DISC_X + (DISC_D - lw) / 2 + 1, DISC_Y + (DISC_D - BULLET_L_H) / 2, C_WHITE);

  // Direction, cap height aligned with the top of the bullet
  const char* name = directionName(t.lLabel);
  if (name) customText(&g, FACE_SMALL, name, TX, TOP, C_LABEL_SOFT);
  else printAt(g, TX, TOP, 1, C_LABEL_SOFT, t.lLabel);

  // Times, bottoms aligned with the bottom of the bullet
  const int bigY = BOTTOM - BIG_H + 1;     // rows 13..26
  const int medY = BOTTOM - MED_H + 1;     // rows 19..26

  if (t.l1 < 0) { customText(&g, FACE_BIG, "--", TX, bigY, C_DIM); return; }

  char a[12], b[12];
  if (t.l1 == 0) snprintf(a, sizeof a, "AR"); else snprintf(a, sizeof a, "%d", t.l1);
  if (t.l2 == 0) snprintf(b, sizeof b, "AR"); else snprintf(b, sizeof b, "%d", t.l2);
  const bool unit = t.l1 != 0;
  bool hasSecond = t.l2 >= 0;

  // Fit to 64 px: shrink the gap before the following train, then the
  // spacing inside the big number, and only then leave the following train out.
  const int unitW = 1 + textWidth(FACE_MED, "m");
  int bigGap = 2, gap = 4;
  auto total = [&]() {
    return TX + textWidth(FACE_BIG, a, bigGap) + (unit ? unitW : 0) + (hasSecond ? gap + textWidth(FACE_MED, b) : 0);
  };
  if (total() > SCREEN_W) gap = 3;
  if (total() > SCREEN_W) bigGap = 1;
  if (total() > SCREEN_W) gap = 2;
  if (total() > SCREEN_W) hasSecond = false;

  int x = TX + customText(&g, FACE_BIG, a, TX, bigY, C_AMBER, bigGap);
  if (unit) x += 1 + customText(&g, FACE_MED, "m", x + 1, medY, C_AMBER);
  if (hasSecond) customText(&g, FACE_MED, b, x + gap, medY, C_AMBER_2ND);
}

void drawTransit(Adafruit_GFX& g, const TransitData& t) {
  g.fillScreen(C_BLACK);
  if (t.lOnly) drawLOnly(g, t);
  else drawTwoRow(g, t);
}

// ---------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------

// A cat strolls left -> right along the bottom of the screen (~4 s).
static bool animWalk(Adafruit_GFX& g, uint32_t ms) {
  const int speed = 18;                         // pixels per second
  int x = -CAT_W + (int)(ms * speed / 1000);
  if (x >= SCREEN_W) return false;
  int frame = (ms / 140) % 4;
  int bob = (frame == 1 || frame == 3) ? -1 : 0;   // body lifts on the passing step
  drawSprite(g, CAT_WALK[frame], CAT_H, x, SCREEN_H - CAT_H + bob, true);
  return true;
}

// A ball of yarn rolls past, and a cat sprints after it (~4.5 s).
static bool animChase(Adafruit_GFX& g, uint32_t ms) {
  int yarnX = -YARN_W + (int)(ms * 30 / 1000);
  int yarnBounce = ((ms / 180) % 2) ? 0 : -1;
  if (yarnX < SCREEN_W) {
    drawSprite(g, YARN[(ms / 120) % 2], YARN_H, yarnX, SCREEN_H - YARN_H + yarnBounce, true);
    // a strand of yarn trailing behind
    for (int i = 1; i <= 6 && yarnX - i >= 0; i++)
      if (yarnX - i < SCREEN_W) g.drawPixel(yarnX - i, SCREEN_H - 1, paletteColor('b'));
  }
  const uint32_t catDelay = 900;
  if (ms < catDelay) return true;
  uint32_t t = ms - catDelay;
  int catX = -CAT_W + (int)(t * 34 / 1000);
  if (catX >= SCREEN_W) return false;
  drawSprite(g, CAT_RUN[(t / 110) % 2], CAT_H, catX, SCREEN_H - CAT_H, true);
  return true;
}

// A cat face rises from the bottom, looks around, blinks, and ducks back down (~4 s).
static bool animPeek(Adafruit_GFX& g, uint32_t ms) {
  const uint32_t rise = 700, hold = 2600, sink = 700;
  const int x = (SCREEN_W - FACE_W) / 2;
  const int topY = SCREEN_H - FACE_H;           // fully visible
  int y;
  if (ms < rise) y = SCREEN_H - (int)((FACE_H) * ms / rise);
  else if (ms < rise + hold) y = topY;
  else if (ms < rise + hold + sink) y = topY + (int)(FACE_H * (ms - rise - hold) / sink);
  else return false;

  uint32_t h = ms > rise ? ms - rise : 0;
  bool blink = (h > 900 && h < 1050) || (h > 1900 && h < 2020) || (h > 2120 && h < 2240);
  drawSprite(g, blink ? FACE_BLINK : FACE_OPEN, FACE_H, x, y, true);
  return true;
}

bool drawAnim(Adafruit_GFX& g, AnimKind kind, uint32_t ms) {
  switch (kind) {
    case ANIM_WALK:  return animWalk(g, ms);
    case ANIM_CHASE: return animChase(g, ms);
    case ANIM_PEEK:  return animPeek(g, ms);
    default:         return false;
  }
}

// ---------------------------------------------------------------------------
// Scrolling message (full screen, big text, a little cat follows the text)
// ---------------------------------------------------------------------------
bool drawMessage(Adafruit_GFX& g, const char* text, uint8_t repeat, uint32_t ms) {
  if (!text || !*text) return false;
  if (repeat == 0) repeat = 1;
  const int speed = 26;                               // pixels per second
  const int textW = (int)strlen(text) * 12;
  const int passW = SCREEN_W + textW + CAT_W + 4;     // enter right, leave left
  int travelled = (int)(ms * speed / 1000);
  if (travelled >= passW * repeat) return false;

  int x = SCREEN_W - (travelled % passW);
  g.fillScreen(C_BLACK);
  printAt(g, x, 9, 2, C_MESSAGE, text);     // vertically centred (rows 9..22)

  // A tiny cat trots along the bottom after the text (facing left, so mirrored).
  int catX = x + textW + 2;
  drawSprite(g, CAT_WALK[(ms / 140) % 4], CAT_H, catX, SCREEN_H - CAT_H, false, true);
  return true;
}

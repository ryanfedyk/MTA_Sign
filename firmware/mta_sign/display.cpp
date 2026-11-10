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
void drawConnecting(Adafruit_GFX& g, uint32_t ms, const char* detail, const char* title) {
  g.fillScreen(C_BLACK);
  printAt(g, (SCREEN_W - ((int)strlen(title) * 6 - 1)) / 2, 6, 1, rgb565(200, 200, 200), title);
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
//   ██   ██   12, 18m            <- big next train, comma, medium following train,
//    ████                           one "m"; bottoms line up with the bullet's bottom
//
// Everything that has to be read from across the room uses 2-px strokes.
// ---------------------------------------------------------------------------
static const uint16_t C_LABEL_SOFT = rgb565(200, 200, 205);
static const uint16_t C_AMBER_2ND  = rgb565(235, 160, 40);   // a touch softer than the next train
static const uint16_t C_ALERT_RED  = rgb565(255, 60, 40);

static uint16_t alertColor(uint8_t sev) { return sev >= 2 ? C_ALERT_RED : C_AMBER; }
// Alternate a label with its alert every 2 s (alert shown 1.2 s of each 2 s).
static bool showAlertNow(uint32_t ms) { return (ms % 2000) < 1200; }

// Small warning triangle (7x7) for the two-row layout.
static const char* const WARN[7] = {
  "...#...", "..###..", "..#.#..", ".##.##.", ".#####.", "###.###", "#######",
};

static const char* directionName(const char* label) {
  if (!strcmp(label, "MN")) return "Manhattan";
  if (!strcmp(label, "BK")) return "Brooklyn";
  return nullptr;
}

// Weekday two-row layout (L on top, B48 below); a warning triangle replaces
// the direction label every other second when a route has a problem.
static void drawTwoRow(Adafruit_GFX& g, const TransitData& t, uint32_t ms) {
  const bool lWarn = t.lAlert[0] && showAlertNow(ms), bWarn = t.bAlert[0] && showAlertNow(ms);
  // Top row: L train
  g.fillRoundRect(2, 2, 11, 11, 3, C_L_GREY);
  printAt(g, 5, 4, 1, C_WHITE, "L");
  if (lWarn) blit(g, WARN, 7, 17, 4, alertColor(t.lSev));
  else printAt(g, 16, 4, 1, C_LABEL, t.lLabel);
  drawDualTimes(g, 4, t.l1, t.l2, true, true);

  g.drawFastHLine(2, 15, 60, C_RULE);

  // Bottom row: B48 bus
  g.fillRoundRect(2, 18, 11, 11, 3, C_B_BLUE);
  printAt(g, 5, 20, 1, C_WHITE, "B");
  if (bWarn) blit(g, WARN, 7, 17, 20, alertColor(t.bSev));
  else printAt(g, 16, 20, 1, C_LABEL, t.bLabel);
  drawDualTimes(g, 20, t.b1, t.b2, t.bLive1, t.bLive2);
}

// Full-screen single-route layout geometry (shared by the L and B48 screens)
static const int BADGE_X = 2, BADGE_Y = 5, BADGE_D = 22;          // badge occupies rows 5..26
static const int ROW_TOP = BADGE_Y, ROW_BOTTOM = BADGE_Y + BADGE_D - 1;

// Times on the badge's bottom edge:  "12, 18m"
// Big next arrival, comma, medium following arrival, and one bold "m" at the
// end -- reads as a list of minutes (not 12:18), like a countdown clock.
static void drawBigTimes(Adafruit_GFX& g, int TX, int t1, int t2, uint16_t c1, uint16_t c2) {
  const int BOTTOM = ROW_BOTTOM;
  const int bigY = BOTTOM - BIG_H + 1;     // rows 13..26
  const int medY = BOTTOM - MED_H + 1;     // rows 19..26

  if (t1 < 0) { customText(&g, FACE_BIG, "--", TX, bigY, C_DIM); return; }

  char a[12], b[12];
  if (t1 == 0) snprintf(a, sizeof a, "AR"); else snprintf(a, sizeof a, "%d", t1);
  if (t2 == 0) snprintf(b, sizeof b, "AR"); else snprintf(b, sizeof b, "%d", t2);
  bool hasSecond = t2 >= 0;
  auto lastIsMinutes = [&]() { return hasSecond ? t2 > 0 : t1 > 0; };
  bool unit = lastIsMinutes();

  static const char* const COMMA[4] = {"##", "##", ".#", "#."};   // sits on the baseline, tail dips below
  const int unitW = 1 + textWidth(FACE_MED, "m");
  int bigGap = 2, cg = 2;                                          // cg = space around the comma
  auto total = [&]() {
    return TX + textWidth(FACE_BIG, a, bigGap) + (hasSecond ? cg + 2 + cg + textWidth(FACE_MED, b) : 0) + (unit ? unitW : 0);
  };
  // Fit to 64 px: tighten spacing, then drop the "m", then the following arrival.
  if (total() > SCREEN_W) cg = 1;
  if (total() > SCREEN_W) bigGap = 1;
  if (total() > SCREEN_W) unit = false;
  if (total() > SCREEN_W) { hasSecond = false; unit = lastIsMinutes(); }
  if (total() > SCREEN_W) unit = false;

  int x = TX + customText(&g, FACE_BIG, a, TX, bigY, c1, bigGap);
  if (hasSecond) {
    blit(g, COMMA, 4, x + cg, BOTTOM - 2, c2);
    x += cg + 2 + cg;
    x += customText(&g, FACE_MED, b, x, medY, c2);
  }
  if (unit) customText(&g, FACE_MED, "m", x + 1, medY, hasSecond ? c2 : c1);
}

static void drawLOnly(Adafruit_GFX& g, const TransitData& t, uint32_t ms) {
  const int TX = BADGE_X + BADGE_D + 3;                    // text column starts at x = 27

  // Bullet: grey disc with a bold L, optically centred (nudged right 1 px
  // because an L's weight sits on its left side).
  fillDisc(g, BADGE_X, BADGE_Y, BADGE_D, C_L_GREY);
  const int lw = (int)strlen(BULLET_L[0]);
  blit(g, BULLET_L, BULLET_L_H,
       BADGE_X + (BADGE_D - lw) / 2 + 1, BADGE_Y + (BADGE_D - BULLET_L_H) / 2, C_WHITE);

  // Direction, cap height aligned with the top of the bullet
  const char* name = directionName(t.lLabel);
  if (t.lAlert[0] && showAlertNow(ms)) customText(&g, FACE_SMALL, t.lAlert, TX, ROW_TOP, alertColor(t.lSev));
  else if (name) customText(&g, FACE_SMALL, name, TX, ROW_TOP, C_LABEL_SOFT);
  else printAt(g, TX, ROW_TOP, 1, C_LABEL_SOFT, t.lLabel);

  drawBigTimes(g, TX, t.l1, t.l2, C_AMBER, C_AMBER_2ND);    // subway times are always live
}

// Full-screen B48: blue rounded-square badge, "Northbound"/"Southbound",
// amber = live GPS, white = scheduled.
static void drawBusOnly(Adafruit_GFX& g, const TransitData& t, uint32_t ms) {
  const int TX = BADGE_X + BADGE_D + 1;                    // x = 25 ("Northbound"/"Southbound" are 38 px wide)
  g.fillRoundRect(BADGE_X, BADGE_Y, BADGE_D, BADGE_D, 5, C_B_BLUE);
  const int bw = textWidth(FACE_MED, "B48");
  customText(&g, FACE_MED, "B48", BADGE_X + (BADGE_D - bw) / 2 + 1, BADGE_Y + (BADGE_D - MED_H) / 2, C_WHITE);

  const char* name = !strcmp(t.bLabel, "NB") ? "Northbound" : !strcmp(t.bLabel, "SB") ? "Southbound" : nullptr;
  if (t.bAlert[0] && showAlertNow(ms)) customText(&g, FACE_SMALL, t.bAlert, TX, ROW_TOP, alertColor(t.bSev));
  else if (name) customText(&g, FACE_SMALL, name, TX, ROW_TOP, C_LABEL_SOFT);
  else printAt(g, TX, ROW_TOP, 1, C_LABEL_SOFT, t.bLabel);

  drawBigTimes(g, TX, t.b1, t.b2, t.bLive1 ? C_AMBER : C_WHITE, t.bLive2 ? C_AMBER_2ND : rgb565(220, 220, 220));
}

// ---------------------------------------------------------------------------
// Clock:   10:42          big time, colon blinks
//        Tue Nov 10       date -- or, if a watched route has a problem:
//        (L) Delays       route bullet + what's wrong (alternates if both routes)
// ---------------------------------------------------------------------------
static const char* const DAYS[7] = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};
static const char* const MONTHS[12] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};

static ClockStyle gClock;
void setClockStyle(const ClockStyle& style) { gClock = style; }

static uint16_t hsv565(int hue) {               // full saturation/value rainbow
  hue %= 360; int x = (hue % 60) * 255 / 60;
  int r, g, b;
  switch (hue / 60) {
    case 0: r = 255; g = x; b = 0; break;     case 1: r = 255 - x; g = 255; b = 0; break;
    case 2: r = 0; g = 255; b = x; break;     case 3: r = 0; g = 255 - x; b = 255; break;
    case 4: r = x; g = 0; b = 255; break;     default: r = 255; g = 0; b = 255 - x; break;
  }
  return rgb565(r, g, b);
}

// Color for each pixel of the time: solid, a vertical gradient, or a moving rainbow.
struct ClockPaint {
  const ClockStyle& st; uint32_t ms; int top, bottom;
  uint16_t at(int x, int y) const {
    if (st.mode == CLOCK_RAINBOW) return hsv565(ms / 40 + x * 5);
    if (st.mode == CLOCK_GRADIENT && bottom > top) {
      int f = (y - top) * 256 / (bottom - top); if (f < 0) f = 0; if (f > 256) f = 256;
      return rgb565(st.r + (st.r2 - st.r) * f / 256, st.g + (st.g2 - st.g) * f / 256, st.b + (st.b2 - st.b) * f / 256);
    }
    return rgb565(st.r, st.g, st.b);
  }
  uint16_t dim(int pct) const {                // for the date / seconds bar
    if (st.mode == CLOCK_RAINBOW) return rgb565(150, 150, 150);
    return rgb565(st.r * pct / 100, st.g * pct / 100, st.b * pct / 100);
  }
};

// ---- clock typefaces ----
static int clockHeight(ClockFont f) { return f == CLOCK_HUGE ? 28 : f == CLOCK_SEGMENT ? 16 : 14; }
static int clockGap(ClockFont f) { return f == CLOCK_HUGE ? 3 : f == CLOCK_SEGMENT ? 3 : 2; }

// Seven-segment digits (9x16, 2-px segments). Unlit segments glow faintly.
static const uint8_t SEGMENTS[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};   // bits: a b c d e f g
static void segRect(Adafruit_GFX* g, const ClockPaint& p, int x, int y, int w, int h, bool lit) {
  if (!g) return;
  for (int yy = y; yy < y + h; yy++)
    for (int xx = x; xx < x + w; xx++) {
      uint16_t c = p.at(xx, yy);
      if (!lit) {   // ghost segment: ~10% brightness
        c = rgb565(((c >> 11) << 3) / 10, (((c >> 5) & 63) << 2) / 10, ((c & 31) << 3) / 10);
      }
      g->drawPixel(xx, yy, c);
    }
}
static int drawSegDigit(Adafruit_GFX* g, const ClockPaint& p, int d, int x, int y, int H = 16) {
  const int W = 9, T = 2, M = H / 2;
  uint8_t on = (d >= 0 && d <= 9) ? SEGMENTS[d] : 0x40;   // '-' = middle segment only
  segRect(g, p, x + T, y, W - 2 * T, T, on & 0x01);                 // a
  segRect(g, p, x + W - T, y + T, T, M - T - 1, on & 0x02);         // b
  segRect(g, p, x + W - T, y + M + 1, T, M - T - 1, on & 0x04);     // c
  segRect(g, p, x + T, y + H - T, W - 2 * T, T, on & 0x08);         // d
  segRect(g, p, x, y + M + 1, T, M - T - 1, on & 0x10);             // e
  segRect(g, p, x, y + T, T, M - T - 1, on & 0x20);                 // f
  segRect(g, p, x + T, y + M - 1, W - 2 * T, T, on & 0x40);         // g
  return W;
}

// Bitmap glyph at an integer scale, colored per pixel.
static int drawScaledGlyph(Adafruit_GFX* g, const ClockPaint& p, const char* const* rows, int h, int scale, int x, int y) {
  int w = (int)strlen(rows[0]);
  if (g)
    for (int r = 0; r < h; r++)
      for (int c = 0; c < w; c++)
        if (rows[r][c] == '#')
          for (int sy = 0; sy < scale; sy++)
            for (int sx = 0; sx < scale; sx++) {
              int X = x + c * scale + sx, Y = y + r * scale + sy;
              g->drawPixel(X, Y, p.at(X, Y));
            }
  return w * scale;
}

// Draws (or measures, with g = null) the time string in a clock typeface.
// `colonOn` false leaves the colon's space empty (blinking).
static int drawClockText(Adafruit_GFX* g, const ClockPaint& p, ClockFont f, const char* s, int x, int y, bool colonOn, int segH = 16) {
  int cx = x;
  for (const char* q = s; *q; q++) {
    const bool colon = *q == ':';
    int w = 0;
    if (f == CLOCK_SEGMENT) {
      if (colon) { w = 2; if (g && colonOn) { segRect(g, p, cx, y + segH / 4, 2, 2, true); segRect(g, p, cx, y + segH - segH / 4 - 2, 2, 2, true); } }
      else w = drawSegDigit(g, p, *q == '-' ? -1 : *q - '0', cx, y, segH);
    } else if (f == CLOCK_RETRO) {
      const char* const* rows = findGlyph(RETRO_FONT, *q);
      if (rows) w = drawScaledGlyph(colon && !colonOn ? nullptr : g, p, rows, RETRO_H, 2, cx, y);
    } else {
      const char* const* rows = findGlyph(BIG_FONT, *q);
      int scale = f == CLOCK_HUGE ? 2 : 1;
      if (rows) w = drawScaledGlyph(colon && !colonOn ? nullptr : g, p, rows, BIG_H, scale, cx, y);
    }
    cx += w + (q[1] ? clockGap(f) : 0);
  }
  return cx - x;
}

static void drawClock(Adafruit_GFX& g, const TransitData& t, uint32_t ms, const ClockTime* now) {
  const ClockStyle& st = gClock;
  const bool hasL = t.lAlert[0], hasB = t.bAlert[0];
  const bool alert = hasL || hasB;
  ClockFont f = st.font;
  if (f == CLOCK_HUGE && alert) f = CLOCK_STATION;          // make room for the problem
  const bool showDate = st.date && !alert && f != CLOCK_HUGE;
  const bool bottomLine = showDate || alert;

  char tbuf[8];
  if (!now || !now->valid) snprintf(tbuf, sizeof tbuf, "--:--");
  else if (st.h24) snprintf(tbuf, sizeof tbuf, "%02d:%02d", now->hour, now->minute);
  else { int h12 = now->hour % 12; if (!h12) h12 = 12; snprintf(tbuf, sizeof tbuf, "%d:%02d", h12, now->minute); }
  const char* ampm = (now && now->valid && !st.h24 && st.ampm) ? (now->hour < 12 ? "AM" : "PM") : nullptr;

  const int th = clockHeight(f);
  ClockPaint paint{st, ms, 0, th - 1};
  const int tw = drawClockText(nullptr, paint, f, tbuf, 0, 0, true);
  const int aw = ampm ? 2 + textWidth(FACE_SMALL, ampm) : 0;
  const int x0 = (SCREEN_W - (tw + aw)) / 2;
  const int y0 = bottomLine ? (alert ? 3 : (f == CLOCK_SEGMENT ? 3 : 4)) : (SCREEN_H - th) / 2 - (st.secBar ? 1 : 0);
  paint.top = y0; paint.bottom = y0 + th - 1;

  const bool colonOn = !st.blink || !now || !now->valid || now->second % 2 == 0;
  drawClockText(&g, paint, f, tbuf, x0, y0, colonOn);
  if (ampm) customText(&g, FACE_SMALL, ampm, x0 + tw + 2, y0 + th - 5, paint.at(x0 + tw, y0 + th - 1));

  if (st.secBar && now && now->valid) {
    int w = (now->second + 1) * SCREEN_W / 60;
    for (int x = 0; x < w; x++) g.drawPixel(x, SCREEN_H - 1, paint.dim(45));
  }

  if (showDate && now && now->valid) {
    char date[16];
    snprintf(date, sizeof date, "%s %s %d", DAYS[now->wday % 7], MONTHS[now->mon % 12], now->mday);
    customText(&g, FACE_SMALL, date, (SCREEN_W - textWidth(FACE_SMALL, date)) / 2, 23, paint.dim(65));
    return;
  }
  if (!alert) return;

  // Indicator strip: bullet + label. With two problems, alternate every 3 s.
  const bool showL = hasL && (!hasB || (ms / 3000) % 2 == 0);
  const char* label = showL ? t.lAlert : t.bAlert;
  const uint16_t c = alertColor(showL ? t.lSev : t.bSev);
  const int badgeW = showL ? 9 : 15, labelW = textWidth(FACE_SMALL, label);
  const int bx = (SCREEN_W - (badgeW + 4 + labelW)) / 2, by = 21;
  if (showL) {
    fillDisc(g, bx, by, 9, C_L_GREY);
    customText(&g, FACE_SMALL, "L", bx + 3, by + 2, C_WHITE);
  } else {
    g.fillRoundRect(bx, by, badgeW, 9, 2, C_B_BLUE);
    customText(&g, FACE_SMALL, "B48", bx + 2, by + 2, C_WHITE);
  }
  customText(&g, FACE_SMALL, label, bx + badgeW + 4, by + 2, c);
}

// ---------------------------------------------------------------------------
// One route + clock (designed with breathing room):
//
//    (L)  4, 11m          MN      <- bullet, next arrivals, direction code
//                                    (a warning triangle replaces the code
//                                     when the route has a problem)
//          3:42   Tue
//                 Nov 10          <- clock in your style + date, centered together
// ---------------------------------------------------------------------------
static void drawRouteClock(Adafruit_GFX& g, const TransitData& t, uint32_t ms, const ClockTime* now, bool bus) {
  const int BX = 3, BY = 2, BD = 11;                 // top line: rows 2..12

  // Badge
  int tx;
  if (bus) {
    g.fillRoundRect(BX - 1, BY, 16, BD, 3, C_B_BLUE);
    customText(&g, FACE_SMALL, "B48", BX + 1, BY + 3, C_WHITE);
    tx = BX + 15 + 3;
  } else {
    fillDisc(g, BX, BY, BD, C_L_GREY);
    static const char* const L7[7] = {"##...", "##...", "##...", "##...", "##...", "#####", "#####"};
    blit(g, L7, 7, BX + 3, BY + 2, C_WHITE);
    tx = BX + BD + 4;
  }

  // Next arrivals: medium bold "4, 11m", sitting on the badge's baseline
  const int t1 = bus ? t.b1 : t.l1, t2 = bus ? t.b2 : t.l2;
  const uint16_t c1 = bus ? (t.bLive1 ? C_AMBER : C_WHITE) : C_AMBER;
  const uint16_t c2 = bus ? (t.bLive2 ? C_AMBER_2ND : rgb565(220, 220, 220)) : C_AMBER_2ND;
  const int ty = BY + BD - MED_H;                    // rows 5..12
  int x = tx;
  if (t1 < 0) x += customText(&g, FACE_MED, "--", tx, ty, C_DIM);
  else {
    char a[12], b[12];
    if (t1 == 0) snprintf(a, sizeof a, "AR"); else snprintf(a, sizeof a, "%d", t1);
    x += customText(&g, FACE_MED, a, tx, ty, c1);
    if (t2 >= 0) {
      static const char* const COMMA[3] = {"#", "#", "#"};
      blit(g, COMMA, 3, x + 2, ty + 6, c2);
      x += 5;
      if (t2 == 0) snprintf(b, sizeof b, "AR"); else snprintf(b, sizeof b, "%d", t2);
      x += customText(&g, FACE_MED, b, x, ty, c2);
    }
    if ((t2 >= 0 ? t2 : t1) > 0) x += 1 + customText(&g, FACE_MED, "m", x + 1, ty, t2 >= 0 ? c2 : c1);
  }

  // Right end of the top line: warning triangle (problem) or direction code
  const char* alert = bus ? t.bAlert : t.lAlert;
  if (alert[0]) {
    blit(g, WARN, 7, SCREEN_W - 3 - 7, BY + 2, alertColor(bus ? t.bSev : t.lSev));
  } else {
    const char* code = bus ? t.bLabel : t.lLabel;          // MN / BK / NB / SB
    const int cw = textWidth(FACE_SMALL, code);
    if (x + 3 + cw <= SCREEN_W - 2) customText(&g, FACE_SMALL, code, SCREEN_W - 2 - cw, BY + BD - 5, C_LABEL);
  }

  // Clock: rows 16..29, in the chosen style (Huge doesn't fit here -> Station)
  const ClockStyle& st = gClock;
  const ClockFont f = st.font == CLOCK_HUGE ? CLOCK_STATION : st.font;
  char tbuf[8];
  if (!now || !now->valid) snprintf(tbuf, sizeof tbuf, "--:--");
  else if (st.h24) snprintf(tbuf, sizeof tbuf, "%02d:%02d", now->hour, now->minute);
  else { int h12 = now->hour % 12; if (!h12) h12 = 12; snprintf(tbuf, sizeof tbuf, "%d:%02d", h12, now->minute); }
  const int cy = 16, ch = 14;
  ClockPaint paint{st, ms, cy, cy + ch - 1};
  const bool colonOn = !st.blink || !now || !now->valid || now->second % 2 == 0;
  const int cw = drawClockText(nullptr, paint, f, tbuf, 0, cy, colonOn, 14);

  // Date to the right of the time (two short lines), if it fits; the pair is centered.
  char day[4] = "", md[8] = "";
  int dw = 0;
  if (st.date && now && now->valid) {
    snprintf(day, sizeof day, "%s", DAYS[now->wday % 7]);
    snprintf(md, sizeof md, "%s %d", MONTHS[now->mon % 12], now->mday);
    dw = textWidth(FACE_SMALL, md) > textWidth(FACE_SMALL, day) ? textWidth(FACE_SMALL, md) : textWidth(FACE_SMALL, day);
  }
  const char* ampm = (!st.h24 && st.ampm && now && now->valid) ? (now->hour < 12 ? "AM" : "PM") : nullptr;
  const int gap = 5;
  const bool dateFits = dw && cw + gap + dw <= SCREEN_W - 4;
  const int aw = ampm ? 2 + textWidth(FACE_SMALL, ampm) : 0;
  const int groupW = dateFits ? cw + gap + dw : cw + (ampm && cw + aw <= SCREEN_W - 4 ? aw : 0);
  const int cx = (SCREEN_W - groupW) / 2;
  drawClockText(&g, paint, f, tbuf, cx, cy, colonOn, 14);
  if (dateFits) {
    customText(&g, FACE_SMALL, day, cx + cw + gap, cy + 1, paint.dim(65));
    customText(&g, FACE_SMALL, md, cx + cw + gap, cy + 8, paint.dim(65));
  } else if (ampm && cw + aw <= SCREEN_W - 4) {
    customText(&g, FACE_SMALL, ampm, cx + cw + 2, cy + ch - 5, paint.at(cx + cw, cy + ch - 1));
  }
}

void drawTransit(Adafruit_GFX& g, const TransitData& t, uint32_t ms, const ClockTime* now) {
  g.fillScreen(C_BLACK);
  switch (t.layout) {
    case LAYOUT_L:     if (gClock.withRoute) drawRouteClock(g, t, ms, now, false); else drawLOnly(g, t, ms); break;
    case LAYOUT_BUS:   if (gClock.withRoute) drawRouteClock(g, t, ms, now, true); else drawBusOnly(g, t, ms); break;
    case LAYOUT_CLOCK: drawClock(g, t, ms, now); break;
    case LAYOUT_OFF:   break;                       // blank sign (idle animations still play)
    default:           drawTwoRow(g, t, ms); break;
  }
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

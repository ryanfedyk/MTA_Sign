// Everything that draws on the 64x32 matrix.
//
// This file only depends on Adafruit_GFX (which MatrixPanel_I2S_DMA extends),
// so the exact same code also runs in the desktop preview tool (../../tools/sim)
// to render GIF previews of layouts and animations.
#pragma once

#include <Adafruit_GFX.h>
#include <stdint.h>

static const int SCREEN_W = 64;
static const int SCREEN_H = 32;

inline uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

// Which screen to draw -- set by the schedule in the cloud ("lay").
enum Layout : uint8_t {
  LAYOUT_TWO = 0,   // "LB": L on top, B48 below
  LAYOUT_L,         // "L":  L train full screen
  LAYOUT_BUS,       // "B":  B48 full screen
  LAYOUT_OFF,       // "off": nothing scheduled -- blank
  LAYOUT_CLOCK,     // "clock": time + date, with service-problem indicators
};

// Local time for the clock screen (filled from NTP in the sketch).
struct ClockTime {
  bool valid = false;
  int hour = 0, minute = 0, second = 0;
  int wday = 0, mon = 0, mday = 1;     // 0 = Sunday / January
};

// Latest arrivals from the cloud function (/transit).
struct TransitData {
  bool valid = false;
  Layout layout = LAYOUT_TWO;
  char lLabel[6] = "MN";
  int l1 = -1, l2 = -1;
  char bLabel[6] = "SB";
  int b1 = -1, b2 = -1;
  bool bLive1 = true, bLive2 = true;
  // Service problems on watched routes ("" = none). sev: 1 amber, 2 red.
  char lAlert[12] = "";
  char bAlert[12] = "";
  uint8_t lSev = 0, bSev = 0;
};

// Animations (all cat themed). Names match the cloud function / web app.
enum AnimKind : uint8_t { ANIM_NONE = 0, ANIM_WALK, ANIM_CHASE, ANIM_PEEK, ANIM_COUNT };
AnimKind animFromName(const char* name);   // "walk", "chase", "peek" (unknown -> ANIM_NONE)

// Screens
// `detail` is a short status line, e.g. "WIFI", "LOADING", "ERR -1".
void drawConnecting(Adafruit_GFX& g, uint32_t ms, const char* detail = nullptr, const char* title = "CONNECTING");
// `ms` drives blinking/alternating indicators; `now` is needed for the clock.
void drawTransit(Adafruit_GFX& g, const TransitData& t, uint32_t ms = 0, const ClockTime* now = nullptr);

// Draws one frame of an animation `elapsedMs` after it started, on top of
// whatever is already on screen. Returns false once the animation is over.
bool drawAnim(Adafruit_GFX& g, AnimKind kind, uint32_t elapsedMs);

// Full-screen scrolling message. Returns false once it has scrolled `repeat` times.
bool drawMessage(Adafruit_GFX& g, const char* text, uint8_t repeat, uint32_t elapsedMs);

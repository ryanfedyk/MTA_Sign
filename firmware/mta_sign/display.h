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

// Latest arrivals from the cloud function (/transit).
struct TransitData {
  bool valid = false;
  bool lOnly = false;        // "lay":"L" -> full-screen L train layout (weekends)
  char lLabel[6] = "MN";
  int l1 = -1, l2 = -1;
  char bLabel[6] = "SB";
  int b1 = -1, b2 = -1;
  bool bLive1 = true, bLive2 = true;
};

// Animations (all cat themed). Names match the cloud function / web app.
enum AnimKind : uint8_t { ANIM_NONE = 0, ANIM_WALK, ANIM_CHASE, ANIM_PEEK, ANIM_COUNT };
AnimKind animFromName(const char* name);   // "walk", "chase", "peek" (unknown -> ANIM_NONE)

// Screens
// `detail` is a short status line, e.g. "WIFI", "LOADING", "ERR -1".
void drawConnecting(Adafruit_GFX& g, uint32_t ms, const char* detail = nullptr);
void drawTransit(Adafruit_GFX& g, const TransitData& t);

// Draws one frame of an animation `elapsedMs` after it started, on top of
// whatever is already on screen. Returns false once the animation is over.
bool drawAnim(Adafruit_GFX& g, AnimKind kind, uint32_t elapsedMs);

// Full-screen scrolling message. Returns false once it has scrolled `repeat` times.
bool drawMessage(Adafruit_GFX& g, const char* text, uint8_t repeat, uint32_t elapsedMs);

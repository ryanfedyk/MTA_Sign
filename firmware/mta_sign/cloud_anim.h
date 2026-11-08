// Animations downloaded from the cloud (/anims) -- including ones Gemini drew
// from a prompt in the web app. Played without re-flashing the sign.
//
// Drawing only depends on Adafruit_GFX, so the desktop preview tool can run it
// too. Parsing the JSON lives in mta_sign.ino (it needs ArduinoJson).
#pragma once

#include <Adafruit_GFX.h>
#include <stdint.h>
#include <memory>
#include <vector>

struct CloudSprite {
  uint8_t w = 0, h = 0;
  uint16_t frameMs = 150;
  std::vector<std::vector<uint8_t>> frames;   // w*h each; 0 = transparent, n = palette[n-1]
};

struct CloudKey { uint16_t t; int16_t x, y; bool flip; };

struct CloudActor {
  uint8_t sprite = 0;
  bool outline = true;
  std::vector<CloudKey> keys;                  // sorted by t
};

struct CloudAnim {
  char id[32] = "";
  uint16_t duration = 4000;
  bool blackBg = false;                        // full-screen scene instead of drawing over arrivals
  bool idle = false;                           // part of the idle rotation
  uint8_t ncolors = 0;
  uint16_t palette[15] = {0};
  std::vector<CloudSprite> sprites;
  std::vector<CloudActor> actors;
  std::vector<uint8_t> image;                  // optional 64x32 RGB332 background (uploaded photos)
};

using CloudAnimPtr = std::shared_ptr<const CloudAnim>;
using CloudLibrary = std::vector<CloudAnimPtr>;

// Draws one frame `ms` after the animation started, on top of what's on
// screen (or on black for blackBg). Returns false once it's over.
bool drawCloudAnim(Adafruit_GFX& g, const CloudAnim& a, uint32_t ms);

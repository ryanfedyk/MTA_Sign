// Desktop preview: runs the sign's real drawing code (firmware/mta_sign/display.cpp)
// and writes raw frames that render_gif.py turns into GIFs.
//
//   usage: sim <scene> <out.rgb>     scenes: weekday weekend walk chase peek message connecting
#include "Adafruit_GFX.h"
#include "../../firmware/mta_sign/display.h"
#include <stdio.h>
#include <string>

class Panel : public Adafruit_GFX {
public:
  uint16_t fb[SCREEN_H][SCREEN_W];
  Panel() : Adafruit_GFX(SCREEN_W, SCREEN_H) { memset(fb, 0, sizeof fb); }
  void drawPixel(int16_t x, int16_t y, uint16_t c) override {
    if (x >= 0 && y >= 0 && x < SCREEN_W && y < SCREEN_H) fb[y][x] = c;
  }
  void dump(FILE* f) {
    for (int y = 0; y < SCREEN_H; y++)
      for (int x = 0; x < SCREEN_W; x++) {
        uint16_t c = fb[y][x];
        uint8_t px[3] = {(uint8_t)((c >> 11) << 3), (uint8_t)(((c >> 5) & 63) << 2), (uint8_t)((c & 31) << 3)};
        fwrite(px, 1, 3, f);
      }
  }
};

int main(int argc, char** argv) {
  if (argc < 3) { fprintf(stderr, "usage: sim <scene> <out.rgb>\n"); return 2; }
  std::string scene = argv[1];
  FILE* f = fopen(argv[2], "wb");
  Panel p;
  const int fps = 25, step = 1000 / fps;

  TransitData wk;
  wk.valid = true; strcpy(wk.lLabel, "MN"); wk.l1 = 4; wk.l2 = 11;
  strcpy(wk.bLabel, "SB"); wk.b1 = 7; wk.bLive1 = true; wk.b2 = 22; wk.bLive2 = false;
  TransitData we = wk; we.lOnly = true; we.l1 = 12; we.l2 = 18;

  int frames = 0;
  if (scene == "weekday") { drawTransit(p, wk); p.dump(f); frames = 1; }
  else if (scene == "weekend") { drawTransit(p, we); p.dump(f); frames = 1; }
  else if (scene == "weekend-ar") { we.l1 = 0; we.l2 = 7; drawTransit(p, we); p.dump(f); frames = 1; }
  else if (scene == "connecting") {
    for (uint32_t t = 0; t < 1600; t += step) { drawConnecting(p, t); p.dump(f); frames++; }
  } else if (scene == "message") {
    for (uint32_t t = 0;; t += step) {
      if (!drawMessage(p, "Dinner's ready!", 1, t)) break;
      p.dump(f); frames++;
    }
  } else {
    AnimKind k = animFromName(scene.c_str());
    const char* base = getenv("BASE");
    TransitData& bg = (base && !strcmp(base, "weekend")) ? we : wk;
    for (uint32_t t = 0;; t += step) {
      drawTransit(p, bg);
      if (!drawAnim(p, k, t)) break;
      p.dump(f); frames++;
    }
    drawTransit(p, bg); p.dump(f); frames++;
  }
  fclose(f);
  printf("%s: %d frames\n", scene.c_str(), frames);
  return 0;
}

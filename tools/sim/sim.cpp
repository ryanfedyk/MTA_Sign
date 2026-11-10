// Desktop preview: runs the sign's real drawing code (firmware/mta_sign/display.cpp)
// and writes raw frames that render_gif.py turns into GIFs.
//
//   usage: sim <scene> <out.rgb> [anim.txt]   scenes: weekday weekend walk chase peek message connecting cloud
#include "Adafruit_GFX.h"
#include "../../firmware/mta_sign/display.h"
#include "../../firmware/mta_sign/cloud_anim.h"
#include <fstream>
#include <sstream>
#include <stdlib.h>
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

// Reads the text form written by anim2txt.js
static bool loadCloud(const char* file, CloudAnim& a) {
  std::ifstream in(file);
  std::string tag;
  while (in >> tag) {
    if (tag == "D") { int bg; in >> a.duration >> bg; a.blackBg = bg; }
    else if (tag == "P") {
      std::string line; std::getline(in, line); std::istringstream ls(line); std::string hex;
      while (ls >> hex && a.ncolors < 15) { unsigned v = strtoul(hex.c_str(), nullptr, 16); a.palette[a.ncolors++] = rgb565(v >> 16, (v >> 8) & 255, v & 255); }
    } else if (tag == "S") { CloudSprite sp; int w, h, f, n; in >> w >> h >> f >> n; sp.w = w; sp.h = h; sp.frameMs = f;
      for (int i = 0; i < n; i++) { std::string t, fr; in >> t >> fr; std::vector<uint8_t> px;
        for (char c : fr) px.push_back(c >= '0' && c <= '9' ? c - '0' + 1 : c >= 'a' && c <= 'e' ? c - 'a' + 11 : 0);
        sp.frames.push_back(px); }
      a.sprites.push_back(sp);
    } else if (tag == "I") {   // base64 RGB332 image
      std::string b64; in >> b64;
      static const std::string tbl = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      uint32_t acc = 0; int bits = 0;
      for (char c : b64) { size_t v = tbl.find(c); if (v == std::string::npos) continue; acc = (acc << 6) | v; bits += 6;
        if (bits >= 8) { bits -= 8; a.image.push_back((acc >> bits) & 0xFF); } }
    } else if (tag == "A") { CloudActor ac; int s2, o, n; in >> s2 >> o >> n; ac.sprite = s2; ac.outline = o;
      for (int i = 0; i < n; i++) { std::string t; int kt, kx, ky, kf; in >> t >> kt >> kx >> ky >> kf; ac.keys.push_back({(uint16_t)kt, (int16_t)kx, (int16_t)ky, kf != 0}); }
      a.actors.push_back(ac);
    }
  }
  return !a.sprites.empty() || !a.image.empty();
}

int main(int argc, char** argv) {
  if (argc < 3) { fprintf(stderr, "usage: sim <scene> <out.rgb>\n"); return 2; }
  std::string scene = argv[1];
  FILE* f = fopen(argv[2], "wb");
  Panel p;
  const int fps = 25, step = 1000 / fps;

  TransitData wk;
  wk.valid = true; strcpy(wk.lLabel, "MN"); wk.l1 = 4; wk.l2 = 11;
  strcpy(wk.bLabel, "SB"); wk.b1 = 7; wk.bLive1 = true; wk.b2 = 22; wk.bLive2 = false;
  TransitData we = wk; we.layout = LAYOUT_L; we.l1 = 12; we.l2 = 18;

  int frames = 0;
  if (scene == "weekday") { drawTransit(p, wk); p.dump(f); frames = 1; }
  else if (scene == "weekend") { drawTransit(p, we); p.dump(f); frames = 1; }
  else if (scene == "weekend-ar") { we.l1 = 0; we.l2 = 7; drawTransit(p, we); p.dump(f); frames = 1; }
  else if (scene == "clock-cases") {      // clock: plain, L delays, L suspended, both, two-row + full-screen indicators
    ClockTime ck; ck.valid = true; ck.hour = 14; ck.minute = 7; ck.second = 0; ck.wday = 2; ck.mon = 10; ck.mday = 10;
    TransitData c = wk; c.layout = LAYOUT_CLOCK;
    drawTransit(p, c, 0, &ck); p.dump(f); frames++;
    strcpy(c.lAlert, "Delays"); c.lSev = 1; ck.hour = 9; ck.minute = 41; drawTransit(p, c, 0, &ck); p.dump(f); frames++;
    strcpy(c.lAlert, "Suspended"); c.lSev = 2; ck.hour = 23; ck.minute = 59; drawTransit(p, c, 0, &ck); p.dump(f); frames++;
    strcpy(c.bAlert, "Changes"); c.bSev = 1; drawTransit(p, c, 3500, &ck); p.dump(f); frames++;
    TransitData two = wk; strcpy(two.lAlert, "Delays"); two.lSev = 1; drawTransit(p, two, 0, &ck); p.dump(f); frames++;
    TransitData one = we; strcpy(one.lAlert, "Delays"); one.lSev = 1; drawTransit(p, one, 0, &ck); p.dump(f); frames++;
  }
  else if (scene == "bus-cases") {        // B48 full screen: live/scheduled mixes
    TransitData bu = wk; bu.layout = LAYOUT_BUS;
    int cases[][4] = {{7, 22, 1, 0}, {12, 31, 1, 1}, {0, 9, 1, 0}, {-1, -1, 1, 1}};
    for (auto& c : cases) { bu.b1 = c[0]; bu.b2 = c[1]; bu.bLive1 = c[2]; bu.bLive2 = c[3]; drawTransit(p, bu); p.dump(f); frames++; }
    strcpy(bu.bLabel, "NB"); bu.b1 = 4; bu.b2 = 16; bu.bLive1 = false; bu.bLive2 = false; drawTransit(p, bu); p.dump(f); frames++;
    TransitData off = wk; off.layout = LAYOUT_OFF; drawTransit(p, off); p.dump(f); frames++;
  }
  else if (scene == "weekend-cases") {   // one frame per tricky combination
    int cases[][2] = {{4, 11}, {12, 19}, {20, 28}, {0, 7}, {3, 0}, {7, -1}, {-1, -1}, {88, 98}};
    for (auto& c : cases) { we.l1 = c[0]; we.l2 = c[1]; drawTransit(p, we); p.dump(f); frames++; }
    strcpy(we.lLabel, "BK"); we.l1 = 6; we.l2 = 14; drawTransit(p, we); p.dump(f); frames++;
  }
  else if (scene == "connecting") {
    for (uint32_t t = 0; t < 1600; t += step) { drawConnecting(p, t, "ERR -1"); p.dump(f); frames++; }
  } else if (scene == "message") {
    for (uint32_t t = 0;; t += step) {
      if (!drawMessage(p, "Dinner's ready!", 1, t)) break;
      p.dump(f); frames++;
    }
  } else if (scene == "cloud") {            // sim cloud <out.rgb> <anim.txt>
    CloudAnim a;
    if (argc < 4 || !loadCloud(argv[3], a)) { fprintf(stderr, "bad cloud animation file\n"); return 1; }
    const char* base = getenv("BASE");
    TransitData& bg = (base && !strcmp(base, "weekend")) ? we : wk;
    for (uint32_t t = 0;; t += step) {
      drawTransit(p, bg);
      if (!drawCloudAnim(p, a, t)) break;
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

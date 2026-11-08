#include "cloud_anim.h"
#include "display.h"
#include <math.h>

static void drawCloudSprite(Adafruit_GFX& g, const CloudAnim& a, const CloudSprite& sp,
                            const std::vector<uint8_t>& px, int x, int y, bool flip, bool outline) {
  auto sx = [&](int c) { return flip ? x + (sp.w - 1 - c) : x + c; };
  if (outline) {
    static const int dx[4] = {1, -1, 0, 0}, dy[4] = {0, 0, 1, -1};
    for (int r = 0; r < sp.h; r++)
      for (int c = 0; c < sp.w; c++) {
        if (!px[r * sp.w + c]) continue;
        for (int k = 0; k < 4; k++) {
          int X = sx(c) + dx[k], Y = y + r + dy[k];
          if (X >= 0 && X < SCREEN_W && Y >= 0 && Y < SCREEN_H) g.drawPixel(X, Y, 0);
        }
      }
  }
  for (int r = 0; r < sp.h; r++) {
    int Y = y + r;
    if (Y < 0 || Y >= SCREEN_H) continue;
    for (int c = 0; c < sp.w; c++) {
      uint8_t v = px[r * sp.w + c];
      if (!v || v > a.ncolors) continue;
      int X = sx(c);
      if (X >= 0 && X < SCREEN_W) g.drawPixel(X, Y, a.palette[v - 1]);
    }
  }
}

bool drawCloudAnim(Adafruit_GFX& g, const CloudAnim& a, uint32_t ms) {
  if (ms >= a.duration) return false;
  if (a.blackBg) g.fillScreen(0);
  if (a.image.size() == (size_t)SCREEN_W * SCREEN_H) {
    for (int y = 0; y < SCREEN_H; y++)
      for (int x = 0; x < SCREEN_W; x++) {
        uint8_t v = a.image[y * SCREEN_W + x];          // RRRGGGBB
        uint8_t r = (v >> 5) * 255 / 7, gr = ((v >> 2) & 7) * 255 / 7, b = (v & 3) * 85;
        g.drawPixel(x, y, rgb565(r, gr, b));
      }
  }

  for (const CloudActor& act : a.actors) {
    if (act.sprite >= a.sprites.size() || act.keys.empty()) continue;
    const CloudSprite& sp = a.sprites[act.sprite];
    if (sp.frames.empty()) continue;

    // Position: straight line between the surrounding keyframes.
    int x, y;
    bool flip;
    if (act.keys.size() == 1) {
      x = act.keys[0].x; y = act.keys[0].y; flip = act.keys[0].flip;
    } else {
      if (ms < act.keys.front().t || ms > act.keys.back().t) continue;   // not on stage
      size_t i = 0;
      while (i + 2 < act.keys.size() && ms > act.keys[i + 1].t) i++;
      const CloudKey &k0 = act.keys[i], &k1 = act.keys[i + 1];
      float f = k1.t > k0.t ? float(ms - k0.t) / float(k1.t - k0.t) : 0.f;
      x = k0.x + (int)lroundf((k1.x - k0.x) * f);
      y = k0.y + (int)lroundf((k1.y - k0.y) * f);
      flip = k0.flip;
    }
    const auto& frame = sp.frames[(ms / (sp.frameMs ? sp.frameMs : 150)) % sp.frames.size()];
    drawCloudSprite(g, a, sp, frame, x, y, flip, act.outline);
  }
  return true;
}

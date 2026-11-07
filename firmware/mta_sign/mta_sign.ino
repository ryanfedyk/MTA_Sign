// MTA Transit RGB LED Matrix — Waveshare ESP32-S3-RGB-Matrix (64x32 HUB75)
//
// Weekdays: L train on top, B48 bus below.   Weekends: L train only, full screen.
// Amber = live GPS, White = scheduled.
// Every ~30 s a cat wanders across the screen. From the web app you can change
// brightness, play an animation, or send a scrolling message.
//
// How it's organised:
//   - A background task (core 0) talks to the cloud: arrivals every 30 s,
//     sign settings/commands every 5 s, and keeps Wi-Fi alive.
//   - loop() (core 1) only draws, ~30 frames per second, so animations stay
//     smooth even while a network request is in progress.
//   - All drawing code lives in display.cpp.
//
// Before flashing: copy secrets.example.h to secrets.h and fill in Wi-Fi.

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <time.h>

#include "secrets.h"
#include "display.h"

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
static const char* TRANSIT_URL = "https://us-central1-mta-transit-matrix.cloudfunctions.net/transit";
static const char* SIGN_URL    = "https://us-central1-mta-transit-matrix.cloudfunctions.net/sign";

static const uint32_t TRANSIT_EVERY_MS = 30000;
static const uint32_t SIGN_EVERY_MS    = 5000;
static const uint32_t FRAME_MS         = 33;              // ~30 fps
static const uint32_t WIFI_GIVE_UP_MS  = 5UL * 60 * 1000; // reboot after 5 min offline

// Defaults until the cloud says otherwise (a little dimmer than before: was 16 / 6).
static const uint8_t DEFAULT_DAY_BRIGHTNESS   = 12;
static const uint8_t DEFAULT_NIGHT_BRIGHTNESS = 5;
static const int NIGHT_STARTS = 22, NIGHT_ENDS = 7;       // local hours

#define PANEL_RES_X 64
#define PANEL_RES_Y 32
#define PANEL_CHAIN 1

#define R1_PIN 4
#define G1_PIN 5
#define B1_PIN 6
#define R2_PIN 7
#define G2_PIN 15
#define B2_PIN 16
#define A_PIN  18
#define B_PIN  8
#define C_PIN  3
#define D_PIN  42
#define E_PIN  -1
#define LAT_PIN 40
#define OE_PIN  2
#define CLK_PIN 41

// ---------------------------------------------------------------------------
// Shared state (written by the network task, read by the drawing loop)
// ---------------------------------------------------------------------------
static const int MAX_MSG = 80;

struct SignSettings {
  uint8_t dayBright = DEFAULT_DAY_BRIGHTNESS;
  uint8_t nightBright = DEFAULT_NIGHT_BRIGHTNESS;
  uint16_t idleSec = 30;           // 0 = no idle animation
  char idleAnim[12] = "walk";      // "walk" | "chase" | "peek" | "mix"
  uint32_t animId = 0;             // changes each time the app presses "Play"
  char animName[12] = "";
  uint32_t msgId = 0;              // changes each time the app sends a message
  char msgText[MAX_MSG + 1] = "";
  uint8_t msgRepeat = 2;
};

static TransitData gTransit;
static SignSettings gSettings;
static SemaphoreHandle_t gLock;

MatrixPanel_I2S_DMA* dma_display = nullptr;

static void copyStr(char* dst, size_t n, const char* src) {
  strncpy(dst, src ? src : "", n - 1);
  dst[n - 1] = 0;
}

// ---------------------------------------------------------------------------
// Network task
// ---------------------------------------------------------------------------
static bool httpGetJson(const char* url, JsonDocument& doc) {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient https;
  https.setTimeout(8000);
  if (!https.begin(client, url)) return false;
  bool ok = false;
  int code = https.GET();
  if (code == HTTP_CODE_OK) {
    String payload = https.getString();
    ok = !deserializeJson(doc, payload);
  } else {
    Serial.printf("GET %s -> %d\n", url, code);
  }
  https.end();
  return ok;
}

static void fetchTransit() {
  JsonDocument doc;
  if (!httpGetJson(TRANSIT_URL, doc)) return;

  TransitData t;
  t.valid = true;
  t.lOnly = strcmp(doc["lay"] | "LB", "L") == 0;
  copyStr(t.lLabel, sizeof t.lLabel, doc["l"]["dir"] | "MN");
  t.l1 = doc["l"]["t1"] | -1;
  t.l2 = doc["l"]["t2"] | -1;
  copyStr(t.bLabel, sizeof t.bLabel, doc["b"]["dir"] | "");
  t.b1 = doc["b"]["t1"] | -1;
  t.b2 = doc["b"]["t2"] | -1;
  t.bLive1 = doc["b"]["live1"] | true;
  t.bLive2 = doc["b"]["live2"] | true;

  xSemaphoreTake(gLock, portMAX_DELAY);
  gTransit = t;
  xSemaphoreGive(gLock);
}

static void fetchSign() {
  JsonDocument doc;
  if (!httpGetJson(SIGN_URL, doc)) return;

  SignSettings s;
  s.dayBright   = doc["bd"] | DEFAULT_DAY_BRIGHTNESS;
  s.nightBright = doc["bn"] | DEFAULT_NIGHT_BRIGHTNESS;
  s.idleSec     = doc["ie"] | 30;
  copyStr(s.idleAnim, sizeof s.idleAnim, doc["is"] | "walk");
  if (doc["a"].is<JsonObject>()) {
    s.animId = doc["a"]["i"] | 0;
    copyStr(s.animName, sizeof s.animName, doc["a"]["n"] | "");
  }
  if (doc["m"].is<JsonObject>()) {
    s.msgId = doc["m"]["i"] | 0;
    copyStr(s.msgText, sizeof s.msgText, doc["m"]["t"] | "");
    s.msgRepeat = doc["m"]["r"] | 2;
  }

  xSemaphoreTake(gLock, portMAX_DELAY);
  gSettings = s;
  xSemaphoreGive(gLock);
}

static void netTask(void*) {
  uint32_t lastTransit = 0, lastSign = 0, offlineSince = 0, lastReconnect = 0;
  bool first = true;
  for (;;) {
    uint32_t now = millis();
    if (WiFi.status() != WL_CONNECTED) {
      // Wi-Fi watchdog: retry every 10 s, reboot if it's been down for 5 minutes.
      if (!offlineSince) offlineSince = now;
      if (now - lastReconnect > 10000) { WiFi.reconnect(); lastReconnect = now; }
      if (now - offlineSince > WIFI_GIVE_UP_MS) ESP.restart();
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }
    offlineSince = 0;

    if (first || now - lastTransit >= TRANSIT_EVERY_MS) { lastTransit = now; fetchTransit(); }
    if (first || now - lastSign >= SIGN_EVERY_MS)       { lastSign = now;    fetchSign(); }
    first = false;
    vTaskDelay(pdMS_TO_TICKS(250));
  }
}

// ---------------------------------------------------------------------------
// Drawing loop
// ---------------------------------------------------------------------------
enum Mode { MODE_TRANSIT, MODE_ANIM, MODE_MESSAGE };
static Mode mode = MODE_TRANSIT;
static AnimKind currentAnim = ANIM_NONE;
static uint32_t modeStart = 0, nextIdleAt = 0, seenAnimId = 0, seenMsgId = 0;
static char currentMsg[MAX_MSG + 1] = "";
static uint8_t currentRepeat = 2;
static uint8_t appliedBrightness = 0;

static void scheduleIdle(const SignSettings& s, uint32_t now) {
  // every `idleSec` seconds, give or take a few, so it feels less mechanical
  nextIdleAt = now + s.idleSec * 1000UL + random(-4000, 4000);
}

static AnimKind pickIdle(const SignSettings& s) {
  if (!strcmp(s.idleAnim, "mix")) return (AnimKind)random(ANIM_WALK, ANIM_COUNT);
  AnimKind k = animFromName(s.idleAnim);
  return k == ANIM_NONE ? ANIM_WALK : k;
}

static void updateBrightness(const SignSettings& s) {
  struct tm ti;
  bool night = false;
  if (getLocalTime(&ti, 5)) night = ti.tm_hour >= NIGHT_STARTS || ti.tm_hour < NIGHT_ENDS;
  uint8_t b = night ? s.nightBright : s.dayBright;
  if (b != appliedBrightness) {
    dma_display->setBrightness8(b);
    appliedBrightness = b;
  }
}

void setup() {
  Serial.begin(115200);
  gLock = xSemaphoreCreateMutex();

  HUB75_I2S_CFG mxconfig(PANEL_RES_X, PANEL_RES_Y, PANEL_CHAIN);
  mxconfig.gpio.r1 = R1_PIN; mxconfig.gpio.g1 = G1_PIN; mxconfig.gpio.b1 = B1_PIN;
  mxconfig.gpio.r2 = R2_PIN; mxconfig.gpio.g2 = G2_PIN; mxconfig.gpio.b2 = B2_PIN;
  mxconfig.gpio.a = A_PIN;   mxconfig.gpio.b = B_PIN;   mxconfig.gpio.c = C_PIN;
  mxconfig.gpio.d = D_PIN;   mxconfig.gpio.e = E_PIN;
  mxconfig.gpio.lat = LAT_PIN; mxconfig.gpio.oe = OE_PIN; mxconfig.gpio.clk = CLK_PIN;

  mxconfig.clkphase = false;
  mxconfig.i2sspeed = HUB75_I2S_CFG::HZ_10M;
  mxconfig.min_refresh_rate = 60;
  mxconfig.double_buff = true;      // draw off-screen, then flip: no flicker during animations

  dma_display = new MatrixPanel_I2S_DMA(mxconfig);
  dma_display->begin();
  dma_display->setBrightness8(DEFAULT_DAY_BRIGHTNESS);
  appliedBrightness = DEFAULT_DAY_BRIGHTNESS;

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTzTime("EST5EDT,M3.2.0,M11.1.0", "pool.ntp.org", "time.nist.gov");

  randomSeed(esp_random());
  xTaskCreatePinnedToCore(netTask, "net", 16384, nullptr, 1, nullptr, 0);
  scheduleIdle(gSettings, millis());
}

void loop() {
  static uint32_t lastFrame = 0, lastBrightness = 0;
  uint32_t now = millis();
  if (now - lastFrame < FRAME_MS) { delay(1); return; }
  lastFrame = now;

  TransitData t;
  SignSettings s;
  xSemaphoreTake(gLock, portMAX_DELAY);
  t = gTransit;
  s = gSettings;
  xSemaphoreGive(gLock);

  if (now - lastBrightness > 1000) { lastBrightness = now; updateBrightness(s); }

  // New commands from the web app
  if (s.msgId && s.msgId != seenMsgId) {
    seenMsgId = s.msgId;
    copyStr(currentMsg, sizeof currentMsg, s.msgText);
    currentRepeat = s.msgRepeat;
    if (currentMsg[0]) { mode = MODE_MESSAGE; modeStart = now; }
  }
  if (s.animId && s.animId != seenAnimId) {
    seenAnimId = s.animId;
    AnimKind k = animFromName(s.animName);
    if (k != ANIM_NONE && mode != MODE_MESSAGE) { mode = MODE_ANIM; currentAnim = k; modeStart = now; }
  }

  // Idle cat
  if (mode == MODE_TRANSIT && t.valid && s.idleSec > 0) {
    if ((int32_t)(now - nextIdleAt) >= 0) {
      mode = MODE_ANIM; currentAnim = pickIdle(s); modeStart = now;
    } else if ((int32_t)(nextIdleAt - now) > (int32_t)(s.idleSec * 1000UL + 5000)) {
      scheduleIdle(s, now);   // interval was shortened in the app
    }
  }

  // Draw one frame
  if (mode == MODE_MESSAGE) {
    if (!drawMessage(*dma_display, currentMsg, currentRepeat, now - modeStart)) {
      mode = MODE_TRANSIT;
      scheduleIdle(s, now);
    }
  }
  if (mode != MODE_MESSAGE) {
    if (!t.valid) {
      drawConnecting(*dma_display, now);
    } else {
      drawTransit(*dma_display, t);
      if (mode == MODE_ANIM && !drawAnim(*dma_display, currentAnim, now - modeStart)) {
        mode = MODE_TRANSIT;
        scheduleIdle(s, now);
      }
    }
  }
  dma_display->flipDMABuffer();
}

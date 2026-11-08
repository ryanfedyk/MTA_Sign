// MTA Transit RGB LED Matrix — Waveshare ESP32-S3-RGB-Matrix (64x32 HUB75)
//
// Weekdays: L train on top, B48 bus below.   Weekends: L train only, full screen.
// Amber = live GPS, White = scheduled.
// Every ~30 s a cat wanders across the screen. From the web app you can change
// brightness, play an animation, send a scrolling message, or have Gemini
// create new animations from a prompt (downloaded from the cloud, no re-flash).
//
// How it's organised:
//   - A background task (core 0) talks to the cloud: arrivals every 30 s,
//     sign settings/commands every 5 s, and keeps Wi-Fi alive.
//   - loop() (core 1) only draws, ~30 frames per second, so animations stay
//     smooth even while a network request is in progress.
//   - All drawing code lives in display.cpp.
//
// Over-the-air updates: GitHub Actions builds every firmware change on main
// and publishes it as a release. The sign checks for a newer build every
// 10 minutes and installs it itself -- no USB cable needed after the first flash.
// If a new build crashes before it has shown arrivals, the board rolls back.
//
// Wi-Fi details: the first time you flash from the Arduino IDE (with your real
// secrets.h), they're saved in the board's settings storage. Builds from
// GitHub only contain placeholders, so they use the saved details -- updates
// never erase them.
//
// Before flashing: copy secrets.example.h to secrets.h and fill in Wi-Fi.

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <HTTPUpdate.h>
#include <Preferences.h>
#include <esp_ota_ops.h>
#include <time.h>

#include "secrets.h"
#include "display.h"
#include "cloud_anim.h"

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
static const char* TRANSIT_URL = "https://us-central1-mta-transit-matrix.cloudfunctions.net/transit";
static const char* SIGN_URL    = "https://us-central1-mta-transit-matrix.cloudfunctions.net/sign";
static const char* ANIMS_URL   = "https://us-central1-mta-transit-matrix.cloudfunctions.net/anims";

// Firmware version = GitHub Actions build number (set by CI). Local builds are
// version 0, so a hand-flashed sign upgrades itself to the latest release.
#ifndef FW_VERSION
#define FW_VERSION 0
#endif
static const char* FW_VERSION_URL = "https://github.com/ryanfedyk/MTA_Sign/releases/latest/download/version.txt";
static const char* FW_BIN_URL     = "https://github.com/ryanfedyk/MTA_Sign/releases/latest/download/mta_sign.bin";
static const uint32_t FW_CHECK_EVERY_MS = 10UL * 60 * 1000;
static const uint32_t FW_FIRST_CHECK_MS = 20000;

static const uint32_t TRANSIT_EVERY_MS = 30000;
static const uint32_t SIGN_EVERY_MS    = 5000;
static const uint32_t FRAME_MS         = 33;              // ~30 fps
static const uint32_t WIFI_GIVE_UP_MS  = 5UL * 60 * 1000; // reboot after 5 min offline

// Defaults until the cloud says otherwise (a little dimmer than before: was 16 / 6).
static const uint8_t DEFAULT_DAY_BRIGHTNESS   = 12;
static const uint8_t DEFAULT_NIGHT_BRIGHTNESS = 5;
static const int DEFAULT_NIGHT_STARTS = 17, DEFAULT_NIGHT_ENDS = 7;   // local hours; set from the app

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
  uint8_t nightStart = DEFAULT_NIGHT_STARTS;     // night brightness from this hour...
  uint8_t nightEnd = DEFAULT_NIGHT_ENDS;         // ...until this hour
  uint16_t idleSec = 30;           // 0 = no idle animation
  char idleAnim[40] = "walk";      // "walk" | "chase" | "peek" | "mix" | "mine"
  uint32_t animId = 0;             // changes each time the app presses "Play"
  char animName[40] = "";          // built-in name, or "c:<id>" for a cloud animation
  uint32_t libVersion = 0;         // cloud animation library version
  uint32_t msgId = 0;              // changes each time the app sends a message
  char msgText[MAX_MSG + 1] = "";
  uint8_t msgRepeat = 2;
};

static TransitData gTransit;
static SignSettings gSettings;
static CloudLibrary gLibrary;              // animations downloaded from /anims
static uint32_t gLoadedLibVersion = 0;
static SemaphoreHandle_t gLock;

// What the "CONNECTING" screen should say while there's no data yet.
static volatile int gLastHttpCode = 0;      // 0 = no request finished yet
static volatile bool gLastParseFailed = false;
static volatile bool gUpdating = false;      // OTA in progress: show "UPDATING"

// ---- Wi-Fi details (kept in flash settings so OTA builds keep working) ----
static char gSsid[64] = "", gPass[64] = "";

static void loadWifiCredentials() {
  Preferences prefs;
  prefs.begin("wifi", false);
  const bool compiledIn = strlen(WIFI_SSID) > 0 && strcmp(WIFI_SSID, "your-wifi-name") != 0;
  if (compiledIn) {
    // Hand-flashed build with real details: use them and remember them.
    strncpy(gSsid, WIFI_SSID, sizeof gSsid - 1);
    strncpy(gPass, WIFI_PASSWORD, sizeof gPass - 1);
    if (prefs.getString("ssid", "") != gSsid || prefs.getString("pass", "") != gPass) {
      prefs.putString("ssid", gSsid);
      prefs.putString("pass", gPass);
      Serial.println("[wifi] saved Wi-Fi details to settings storage");
    }
  } else {
    // Build from GitHub (placeholders): use the saved details.
    prefs.getString("ssid", "").toCharArray(gSsid, sizeof gSsid);
    prefs.getString("pass", "").toCharArray(gPass, sizeof gPass);
  }
  prefs.end();
}
static volatile bool gFirmwareConfirmed = false;

// Tell the Arduino core not to mark this firmware as good at boot; we do it
// ourselves once the sign has actually worked (see confirmFirmware). If it
// crashes before then, the bootloader rolls back to the previous version.
extern "C" bool verifyRollbackLater() { return true; }

static void confirmFirmware() {
  if (gFirmwareConfirmed) return;
  gFirmwareConfirmed = true;
  esp_ota_mark_app_valid_cancel_rollback();
  Serial.printf("[ota] firmware v%d confirmed good\n", FW_VERSION);
}

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
  gLastHttpCode = code;
  if (code == HTTP_CODE_OK) {
    String payload = https.getString();
    DeserializationError err = deserializeJson(doc, payload);
    ok = !err;
    gLastParseFailed = !ok;
    if (err) Serial.printf("[net] %s: bad JSON (%s)\n", url, err.c_str());
  } else {
    Serial.printf("[net] %s -> HTTP %d (%s)\n", url, code, https.errorToString(code).c_str());
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
  Serial.printf("[net] transit ok: lay=%s L %d,%d  B %d,%d\n", t.lOnly ? "L" : "LB", t.l1, t.l2, t.b1, t.b2);
}

// ---- cloud animation library ----
static uint8_t paletteIndex(char c) {
  if (c >= '0' && c <= '9') return c - '0' + 1;
  if (c >= 'a' && c <= 'e') return c - 'a' + 11;
  return 0;   // '.' or anything unexpected = transparent
}

static CloudAnimPtr parseCloudAnim(JsonObjectConst o) {
  auto a = std::make_shared<CloudAnim>();
  copyStr(a->id, sizeof a->id, o["id"] | "");
  a->duration = o["d"] | 4000;
  a->blackBg = (o["bg"] | 0) == 1;
  a->idle = (o["i"] | 0) == 1;
  for (JsonVariantConst hex : o["p"].as<JsonArrayConst>()) {
    if (a->ncolors >= 15) break;
    uint32_t v = strtoul(hex | "000000", nullptr, 16);
    a->palette[a->ncolors++] = rgb565(v >> 16, (v >> 8) & 0xFF, v & 0xFF);
  }
  for (JsonObjectConst so : o["s"].as<JsonArrayConst>()) {
    CloudSprite sp;
    sp.w = so["w"] | 0;
    sp.h = so["h"] | 0;
    sp.frameMs = so["f"] | 150;
    if (!sp.w || !sp.h || sp.w > 48 || sp.h > 32) return nullptr;
    for (JsonVariantConst fv : so["fr"].as<JsonArrayConst>()) {
      const char* fr = fv | "";
      size_t n = strlen(fr);
      if (n != (size_t)sp.w * sp.h) return nullptr;
      std::vector<uint8_t> px(n);
      for (size_t i = 0; i < n; i++) px[i] = paletteIndex(fr[i]);
      sp.frames.push_back(std::move(px));
    }
    if (sp.frames.empty()) return nullptr;
    a->sprites.push_back(std::move(sp));
  }
  for (JsonObjectConst ao : o["a"].as<JsonArrayConst>()) {
    CloudActor act;
    act.sprite = ao["s"] | 0;
    act.outline = (ao["o"] | 1) == 1;
    for (JsonArrayConst k : ao["k"].as<JsonArrayConst>()) {
      act.keys.push_back({(uint16_t)(k[0] | 0), (int16_t)(k[1] | 0), (int16_t)(k[2] | 0), (k[3] | 0) == 1});
    }
    if (act.sprite < a->sprites.size() && !act.keys.empty()) a->actors.push_back(std::move(act));
  }
  if (a->sprites.empty() || a->actors.empty() || !a->id[0]) return nullptr;
  return a;
}

static bool fetchLibrary() {
  JsonDocument doc;
  if (!httpGetJson(ANIMS_URL, doc)) return false;
  CloudLibrary lib;
  for (JsonObjectConst o : doc["a"].as<JsonArrayConst>()) {
    CloudAnimPtr a = parseCloudAnim(o);
    if (a) lib.push_back(a);
  }
  uint32_t v = doc["v"] | 0;
  xSemaphoreTake(gLock, portMAX_DELAY);
  gLibrary = std::move(lib);
  gLoadedLibVersion = v;
  xSemaphoreGive(gLock);
  Serial.printf("[net] animation library v%u: %u animations, free heap %u\n",
                (unsigned)v, (unsigned)gLibrary.size(), (unsigned)ESP.getFreeHeap());
  return true;
}

static void fetchSign() {
  JsonDocument doc;
  static char url[160];
  snprintf(url, sizeof url, "%s?fw=%d", SIGN_URL, FW_VERSION);   // lets the app show the firmware version
  if (!httpGetJson(url, doc)) return;

  SignSettings s;
  s.dayBright   = doc["bd"] | DEFAULT_DAY_BRIGHTNESS;
  s.nightBright = doc["bn"] | DEFAULT_NIGHT_BRIGHTNESS;
  s.nightStart  = doc["ns"] | DEFAULT_NIGHT_STARTS;
  s.nightEnd    = doc["ne"] | DEFAULT_NIGHT_ENDS;
  s.idleSec     = doc["ie"] | 30;
  copyStr(s.idleAnim, sizeof s.idleAnim, doc["is"] | "walk");
  s.libVersion = doc["lv"] | 0;
  if (doc["a"].is<JsonObject>()) {
    s.animId = doc["a"]["i"] | 0;
    copyStr(s.animName, sizeof s.animName, doc["a"]["n"] | "");
  }
  if (doc["m"].is<JsonObject>()) {
    s.msgId = doc["m"]["i"] | 0;
    copyStr(s.msgText, sizeof s.msgText, doc["m"]["t"] | "");
    s.msgRepeat = doc["m"]["r"] | 2;
  }

  // Download new/changed animations *before* publishing the settings, so a
  // "play" command for a just-created animation finds it in the library.
  xSemaphoreTake(gLock, portMAX_DELAY);
  bool libStale = s.libVersion != gLoadedLibVersion;
  xSemaphoreGive(gLock);
  if (libStale) fetchLibrary();

  xSemaphoreTake(gLock, portMAX_DELAY);
  gSettings = s;
  xSemaphoreGive(gLock);
}

// ---- over-the-air update ----
static void checkForUpdate() {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient https;
  https.setTimeout(10000);
  https.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);   // GitHub redirects release downloads
  if (!https.begin(client, FW_VERSION_URL)) return;
  int code = https.GET();
  long latest = code == HTTP_CODE_OK ? https.getString().toInt() : -1;
  https.end();
  Serial.printf("[ota] running v%d, latest release v%ld (HTTP %d)\n", FW_VERSION, latest, code);
  if (latest <= FW_VERSION) return;

  gUpdating = true;
  delay(200);   // let the drawing loop show "UPDATING"
  WiFiClientSecure binClient;
  binClient.setInsecure();
  httpUpdate.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  httpUpdate.rebootOnUpdate(true);
  t_httpUpdate_return r = httpUpdate.update(binClient, FW_BIN_URL);
  // Only reached if the update failed (success reboots).
  Serial.printf("[ota] update failed (%d): %s\n", (int)r, httpUpdate.getLastErrorString().c_str());
  gUpdating = false;
}

static void netTask(void*) {
  uint32_t lastTransit = 0, lastSign = 0, offlineSince = 0, lastAttempt = millis();
  uint32_t nextFwCheck = millis() + FW_FIRST_CHECK_MS;
  bool first = true, wasOnline = false;
  for (;;) {
    uint32_t now = millis();
    if (WiFi.status() != WL_CONNECTED) {
      if (wasOnline) { Serial.println("[wifi] lost connection"); wasOnline = false; }
      // Wi-Fi watchdog: give each attempt 30 s to finish, then start a fresh one.
      // Reboot if we've been offline for 5 minutes.
      if (!offlineSince) offlineSince = now;
      if (!gSsid[0]) { vTaskDelay(pdMS_TO_TICKS(1000)); continue; }   // nothing to connect to
      if (now - lastAttempt > 30000) {
        Serial.printf("[wifi] still not connected (status %d), retrying\n", (int)WiFi.status());
        WiFi.disconnect();
        WiFi.begin(gSsid, gPass);
        lastAttempt = now;
      }
      if (now - offlineSince > WIFI_GIVE_UP_MS) ESP.restart();
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }
    if (!wasOnline) {
      Serial.printf("[wifi] connected, IP %s, signal %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
      wasOnline = true;
    }
    offlineSince = 0;

    xSemaphoreTake(gLock, portMAX_DELAY);
    bool haveData = gTransit.valid;
    xSemaphoreGive(gLock);
    // Until the first arrivals arrive, retry every 5 s instead of every 30 s.
    uint32_t transitEvery = haveData ? TRANSIT_EVERY_MS : 5000;

    if (first || now - lastTransit >= transitEvery) { lastTransit = now; fetchTransit(); }
    if (first || now - lastSign >= SIGN_EVERY_MS)   { lastSign = now;    fetchSign(); }
    first = false;

    // Mark this firmware good after it has shown arrivals for a minute.
    if (haveData && !gFirmwareConfirmed && now > 60000) confirmFirmware();

    if ((int32_t)(now - nextFwCheck) >= 0) {
      nextFwCheck = now + FW_CHECK_EVERY_MS;
      checkForUpdate();
    }
    vTaskDelay(pdMS_TO_TICKS(250));
  }
}

// Short status line for the CONNECTING screen.
static void connectingDetail(char* out, size_t n) {
  wl_status_t ws = WiFi.status();
  if (!gSsid[0]) { snprintf(out, n, "SET WIFI"); return; }   // no saved details: flash once from the IDE
  if (ws != WL_CONNECTED) {
    if (ws == WL_NO_SSID_AVAIL)       snprintf(out, n, "NO WIFI");    // network name not found
    else if (ws == WL_CONNECT_FAILED) snprintf(out, n, "WIFI PASS?"); // usually a wrong password
    else                              snprintf(out, n, "WIFI");
  } else if (gLastHttpCode == 0 || gLastHttpCode == HTTP_CODE_OK) {
    snprintf(out, n, gLastParseFailed ? "BAD DATA" : "LOADING");
  } else {
    snprintf(out, n, "ERR %d", (int)gLastHttpCode);
  }
}

// ---------------------------------------------------------------------------
// Drawing loop
// ---------------------------------------------------------------------------
enum Mode { MODE_TRANSIT, MODE_ANIM, MODE_MESSAGE };
static Mode mode = MODE_TRANSIT;
static AnimKind currentAnim = ANIM_NONE;
static CloudAnimPtr currentCloud;         // set when playing a cloud animation
static uint32_t modeStart = 0, nextIdleAt = 0, seenAnimId = 0, seenMsgId = 0;
static char currentMsg[MAX_MSG + 1] = "";
static uint8_t currentRepeat = 2;
static uint8_t appliedBrightness = 0;

static void scheduleIdle(const SignSettings& s, uint32_t now) {
  // every `idleSec` seconds, give or take a few, so it feels less mechanical
  nextIdleAt = now + s.idleSec * 1000UL + random(-4000, 4000);
}

static CloudAnimPtr findCloud(const char* name) {
  if (strncmp(name, "c:", 2) != 0) return nullptr;
  CloudAnimPtr found;
  xSemaphoreTake(gLock, portMAX_DELAY);
  for (const auto& a : gLibrary) if (!strcmp(a->id, name + 2)) { found = a; break; }
  xSemaphoreGive(gLock);
  return found;
}

// Starts an animation by name: "walk" / "chase" / "peek" or "c:<id>".
static bool startAnim(const char* name, uint32_t now) {
  AnimKind k = animFromName(name);
  CloudAnimPtr c = k == ANIM_NONE ? findCloud(name) : nullptr;
  if (k == ANIM_NONE && !c) return false;
  mode = MODE_ANIM; currentAnim = k; currentCloud = c; modeStart = now;
  return true;
}

// Idle: a built-in cat, "mix" (built-ins + your idle animations) or "mine" (only yours).
static void startIdle(const SignSettings& s, uint32_t now) {
  std::vector<CloudAnimPtr> mine;
  xSemaphoreTake(gLock, portMAX_DELAY);
  for (const auto& a : gLibrary) if (a->idle) mine.push_back(a);
  xSemaphoreGive(gLock);

  bool isMix = !strcmp(s.idleAnim, "mix"), isMine = !strcmp(s.idleAnim, "mine");
  if ((isMix || isMine) && !mine.empty()) {
    int builtins = isMix ? (ANIM_COUNT - ANIM_WALK) : 0;
    int pick = random(0, builtins + (int)mine.size());
    if (pick >= builtins) {
      mode = MODE_ANIM; currentAnim = ANIM_NONE; currentCloud = mine[pick - builtins]; modeStart = now;
      return;
    }
    mode = MODE_ANIM; currentAnim = (AnimKind)(ANIM_WALK + pick); currentCloud = nullptr; modeStart = now;
    return;
  }
  AnimKind k = isMix ? (AnimKind)random(ANIM_WALK, ANIM_COUNT) : animFromName(s.idleAnim);
  mode = MODE_ANIM; currentAnim = k == ANIM_NONE ? ANIM_WALK : k; currentCloud = nullptr; modeStart = now;
}

static void updateBrightness(const SignSettings& s) {
  struct tm ti;
  bool night = false;
  if (getLocalTime(&ti, 5)) {
    int h = ti.tm_hour;
    night = s.nightStart > s.nightEnd ? (h >= s.nightStart || h < s.nightEnd)    // wraps past midnight
                                      : (h >= s.nightStart && h < s.nightEnd);
  }
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

  loadWifiCredentials();
  Serial.printf("\n[boot] MTA sign firmware v%d starting, connecting to Wi-Fi \"%s\"\n", FW_VERSION, gSsid);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  if (gSsid[0]) WiFi.begin(gSsid, gPass);
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
    if (mode != MODE_MESSAGE) startAnim(s.animName, now);
  }

  // Idle cat
  if (mode == MODE_TRANSIT && t.valid && s.idleSec > 0) {
    if ((int32_t)(now - nextIdleAt) >= 0) {
      startIdle(s, now);
    } else if ((int32_t)(nextIdleAt - now) > (int32_t)(s.idleSec * 1000UL + 5000)) {
      scheduleIdle(s, now);   // interval was shortened in the app
    }
  }

  // Draw one frame
  if (gUpdating) {
    drawConnecting(*dma_display, now, "KEEP POWER", "UPDATING");
    dma_display->flipDMABuffer();
    return;
  }
  if (mode == MODE_MESSAGE) {
    if (!drawMessage(*dma_display, currentMsg, currentRepeat, now - modeStart)) {
      mode = MODE_TRANSIT;
      scheduleIdle(s, now);
    }
  }
  if (mode != MODE_MESSAGE) {
    if (!t.valid) {
      char detail[16];
      connectingDetail(detail, sizeof detail);
      drawConnecting(*dma_display, now, detail);
    } else {
      drawTransit(*dma_display, t);
      if (mode == MODE_ANIM) {
        bool running = currentCloud ? drawCloudAnim(*dma_display, *currentCloud, now - modeStart)
                                    : drawAnim(*dma_display, currentAnim, now - modeStart);
        if (!running) {
          if (currentCloud && currentCloud->blackBg) drawTransit(*dma_display, t);   // don't flash black
          mode = MODE_TRANSIT;
          currentCloud = nullptr;
          scheduleIdle(s, now);
        }
      }
    }
  }
  dma_display->flipDMABuffer();
}

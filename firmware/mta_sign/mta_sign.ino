// MTA Transit RGB LED Matrix — Waveshare ESP32-S3-RGB-Matrix (64x32 HUB75)
// Row 1: L Train (Lorimer St)   Row 2: B48 Bus
// Amber = live GPS, White = scheduled. Data comes from the Firebase proxy
// (see ../../functions) every 30 seconds.
//
// Before flashing: copy secrets.example.h to secrets.h and fill in Wi-Fi.

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <time.h>

#include "secrets.h"

const char* ssid      = WIFI_SSID;
const char* password  = WIFI_PASSWORD;
const char* proxy_url = "https://us-central1-mta-transit-matrix.cloudfunctions.net/transit";

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

MatrixPanel_I2S_DMA *dma_display = nullptr;

unsigned long lastFetch = 0;
const unsigned long fetchInterval = 30000;

String l_label   = "MN";
int l_min1       = -1;
int l_min2       = -1;

String b48_label = "SB";
int b48_min1     = -1;
int b48_min2     = -1;
bool b48_live1   = true;
bool b48_live2   = true;

void updateBrightness() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) return;

  int hour = timeinfo.tm_hour;
  if (hour >= 22 || hour < 7) {
    dma_display->setBrightness8(6);
  } else {
    dma_display->setBrightness8(16);
  }
}

void drawDualTimes(int yPos, int t1, int t2, bool isLive1, bool isLive2) {
  if (t1 < 0) {
    dma_display->setTextColor(dma_display->color565(140, 140, 145));
    dma_display->setCursor(44, yPos);
    dma_display->print("--");
    return;
  }

  // Lead arrival: Live GPS = Amber (255, 180, 50) | Scheduled = Pure White (255, 255, 255)
  uint16_t color1 = isLive1 ? dma_display->color565(255, 180, 50) : dma_display->color565(255, 255, 255);
  dma_display->setTextColor(color1);

  if (t1 == 0) {
    dma_display->setCursor(32, yPos);
    dma_display->print("AR");
  } else {
    dma_display->setCursor(t1 < 10 ? 37 : 31, yPos);
    dma_display->print(t1);
  }

  // Follower arrival
  if (t2 >= 0) {
    uint16_t commaColor = dma_display->color565(130, 130, 135);
    dma_display->drawPixel(46, yPos + 5, commaColor);
    dma_display->drawPixel(45, yPos + 6, commaColor);

    uint16_t color2 = isLive2 ? dma_display->color565(255, 180, 50) : dma_display->color565(255, 255, 255);
    dma_display->setTextColor(color2);

    if (t2 == 0) {
      dma_display->setCursor(50, yPos);
      dma_display->print("AR");
    } else {
      dma_display->setCursor(t2 < 10 ? 55 : 49, yPos);
      dma_display->print(t2);
    }
  }
}

void drawTransitScreen() {
  dma_display->fillScreen(dma_display->color565(0, 0, 0));

  // Top Row: L Train
  dma_display->fillRoundRect(2, 2, 11, 11, 3, dma_display->color565(85, 90, 95));
  dma_display->setTextColor(dma_display->color565(255, 255, 255));
  dma_display->setCursor(5, 4);
  dma_display->print("L");

  dma_display->setTextColor(dma_display->color565(180, 180, 180));
  dma_display->setCursor(16, 4);
  dma_display->print(l_label);

  drawDualTimes(4, l_min1, l_min2, true, true);

  dma_display->drawFastHLine(2, 15, 60, dma_display->color565(35, 35, 40));

  // Bottom Row: B48 Bus
  dma_display->fillRoundRect(2, 18, 11, 11, 3, dma_display->color565(0, 55, 165));
  dma_display->setTextColor(dma_display->color565(255, 255, 255));
  dma_display->setCursor(5, 20);
  dma_display->print("B");

  dma_display->setTextColor(dma_display->color565(180, 180, 180));
  dma_display->setCursor(16, 20);
  dma_display->print(b48_label);

  drawDualTimes(20, b48_min1, b48_min2, b48_live1, b48_live2);
}

void fetchTransitData() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient https;
  if (https.begin(client, proxy_url)) {
    int httpCode = https.GET();
    if (httpCode == HTTP_CODE_OK) {
      String payload = https.getString();
      StaticJsonDocument<512> doc;
      DeserializationError err = deserializeJson(doc, payload);

      if (!err) {
        l_label   = doc["l"]["dir"].as<const char*>();
        l_min1    = doc["l"]["t1"];
        l_min2    = doc["l"]["t2"];

        b48_label = doc["b"]["dir"].as<const char*>();
        b48_min1  = doc["b"]["t1"];
        b48_live1 = doc["b"]["live1"];
        b48_min2  = doc["b"]["t2"];
        b48_live2 = doc["b"]["live2"];
      }
    }
    https.end();
  }
}

void setup() {
  Serial.begin(115200);

  HUB75_I2S_CFG mxconfig(PANEL_RES_X, PANEL_RES_Y, PANEL_CHAIN);
  mxconfig.gpio.r1 = R1_PIN; mxconfig.gpio.g1 = G1_PIN; mxconfig.gpio.b1 = B1_PIN;
  mxconfig.gpio.r2 = R2_PIN; mxconfig.gpio.g2 = G2_PIN; mxconfig.gpio.b2 = B2_PIN;
  mxconfig.gpio.a = A_PIN;   mxconfig.gpio.b = B_PIN;   mxconfig.gpio.c = C_PIN;
  mxconfig.gpio.d = D_PIN;   mxconfig.gpio.e = E_PIN;
  mxconfig.gpio.lat = LAT_PIN; mxconfig.gpio.oe = OE_PIN; mxconfig.gpio.clk = CLK_PIN;

  mxconfig.clkphase = false;
  mxconfig.i2sspeed = HUB75_I2S_CFG::HZ_10M;
  mxconfig.min_refresh_rate = 60;

  dma_display = new MatrixPanel_I2S_DMA(mxconfig);
  dma_display->begin();
  dma_display->setBrightness8(16);
  dma_display->clearScreen();

  dma_display->setTextColor(dma_display->color565(200, 200, 200));
  dma_display->setCursor(2, 12);
  dma_display->print("CONNECTING");

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }

  configTzTime("EST5EDT,M3.2.0,M11.1.0", "pool.ntp.org", "time.nist.gov");
  struct tm timeinfo;
  int retry = 0;
  while (!getLocalTime(&timeinfo) && retry < 10) {
    delay(300);
    retry++;
  }

  updateBrightness();
  fetchTransitData();
  drawTransitScreen();
  lastFetch = millis();
}

void loop() {
  if (millis() - lastFetch >= fetchInterval) {
    lastFetch = millis();
    updateBrightness();
    fetchTransitData();
    drawTransitScreen();
  }
}

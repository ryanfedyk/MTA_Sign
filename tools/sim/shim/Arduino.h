// Minimal Arduino stand-in so Adafruit_GFX + the sign's display code compile on a desktop.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>
#include "Print.h"
#include "pgmspace.h"
typedef bool boolean;
typedef uint8_t byte;
#include <algorithm>
#include <string>
using std::min;
using std::max;
#define radians(d) ((d) * 0.017453292519943295)
#define degrees(r) ((r) * 57.29577951308232)
class __FlashStringHelper;
#define F(s) ((const __FlashStringHelper*)(s))
class String : public std::string {
public:
  using std::string::string;
  String(const std::string& s) : std::string(s) {}
  unsigned int length() const { return (unsigned int)size(); }
};

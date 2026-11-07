#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
class __FlashStringHelper;
class Print {
public:
  virtual ~Print() {}
  virtual size_t write(uint8_t) = 0;
  virtual size_t write(const uint8_t* buf, size_t n) { size_t k = 0; while (n--) k += write(*buf++); return k; }
  size_t print(const char* s) { return write((const uint8_t*)s, strlen(s)); }
  size_t print(char c) { return write((uint8_t)c); }
  size_t print(int v) { char b[16]; snprintf(b, sizeof b, "%d", v); return print(b); }
  size_t print(unsigned v) { char b[16]; snprintf(b, sizeof b, "%u", v); return print(b); }
  size_t print(long v) { char b[24]; snprintf(b, sizeof b, "%ld", v); return print(b); }
};

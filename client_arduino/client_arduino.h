#ifndef client_arduino_h
#define client_arduino_h

struct tMeasurement {
  float temp, hum, pres, co2, tvoc;
  float latitude, longitude;
  unsigned long long timestamp;
};

#endif
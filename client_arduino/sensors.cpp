//Define pin number e where DHTxx device is connected and and device type, if you comment the pin, the DHTxx code will be excluded
//#define DHT_PIN 14
#define DHTTYPE DHT22   // DHT11, DHT 21 (AM2301), DHT 22  (AM2302), AM2321

//Define pin number where one wire device(s) are connected, if you comment the pin, the onewire code will be excluded
#define ONE_WIRE_PIN 5    //D2

#include <BME280I2C.h>
#include <ClosedCube_HDC1080.h>
#include <SparkFunCCS811.h>
#include <SparkFun_Si7021_Breakout_Library.h>
#include <Adafruit_BME680.h>
#include "client_arduino.h"

String tempSens, humSens, presSens, co2Sens, tvocSens, gpsSens;
extern float defaultLatitude, defaultLongitude;

#if defined(ONE_WIRE_PIN)
  #include <OneWire.h>
  #include <DallasTemperature.h>
  OneWire oneWire(ONE_WIRE_PIN);// 1-wire on pin (a 4.7K resistor is necessary)
  DallasTemperature ow_sensors(&oneWire); //Use oneWire reference to Dallas Temperature
#endif
  unsigned int oneWireDevices = 0;

#if defined(DHT_PIN)
  #include <DHT.h>
  DHT dht(DHT_PIN, DHTTYPE);
#endif
bool bDHT = false;

#if defined(ESP32)  //TT-BEAM device
  #include <TinyGPS++.h>
  #include <axp20x.h>
  TinyGPSPlus gps;
  HardwareSerial GPS(1);
  AXP20X_Class axp; //Power control
#endif
bool bGPS = false;

BME280I2C bme;
bool bBME280 = false;
bool bBMP280 = false;
ClosedCube_HDC1080 hdc1080;
bool bHDC = false;
CCS811 ccs811(0x5a);
bool bCCS = false;
Weather si7021sensor;
bool b7021 = false;
Adafruit_BME680 bme680; // I2C
bool bBME680 = false;


// Debug function showing all available I2C devices
void report_i2c() {
   Serial.println( "I2C scan");
   byte nDevices = 0;
   for(byte address = 1; address < 127; address++ ) {
    Wire.beginTransmission(address);
    byte error = Wire.endTransmission();
    if (error == 0) {
      Serial.print("I2C device found at address 0x");
      if (address<16) {
        Serial.print("0");
      }
      Serial.println(address,HEX);
      nDevices++;
    }
    else if (error==4) {
      Serial.print("Unknow error at address 0x");
      if (address<16) {
        Serial.print("0");
      }
      Serial.println(address,HEX);
    }
  }
  if (nDevices == 0) {
    Serial.println("No I2C devices found\n");
  }
  else {
    Serial.println("done\n");
  }
}

// Initialize all sensors
void setupSensors() {
  Serial.println( "Setup sensors");
  //Init I2C
  Wire.begin();
  report_i2c();

  #if defined(ESP32)
  // Initialising GPS and power management controller
  if (!axp.begin(Wire, AXP192_SLAVE_ADDRESS)) { //I2C 0x34
    Serial.println("Found AXP192 power controller");
    axp.setPowerOutPut(AXP192_LDO2, AXP202_ON);
    axp.setPowerOutPut(AXP192_LDO3, AXP202_ON);
    axp.setPowerOutPut(AXP192_DCDC2, AXP202_ON);
    axp.setPowerOutPut(AXP192_EXTEN, AXP202_ON);
    axp.setPowerOutPut(AXP192_DCDC1, AXP202_ON);
    GPS.begin(9600, SERIAL_8N1, 34, 12);   //17-TX 18-RX
    bGPS = true;
  } else
    Serial.println("Missing AXP192");
  #endif

  // Initialising Sensor BME680
  if (bme680.begin()) {  //I2C 0x77
    Serial.println("Found BME680 sensor");
    // Set up oversampling and filter initialization
    bme680.setTemperatureOversampling(BME680_OS_8X);
    bme680.setHumidityOversampling(BME680_OS_2X);
    bme680.setPressureOversampling(BME680_OS_4X);
    bme680.setIIRFilterSize(BME680_FILTER_SIZE_3);
    bme680.setGasHeater(320, 150); // 320*C for 150 ms
    bBME680 = true;
  } else
    Serial.println("Missing BME680 sensor");

  // Initialising Sensor BMP/BME280
  if ( bme.begin()) { //I2C 0x76
    switch(bme.chipModel()) {
       case BME280::ChipModel_BME280:
         Serial.println("Found BME280 sensor");
         bBME280 = true;
         break;
       case BME280::ChipModel_BMP280:
         Serial.println("Found BMP280 sensor");
         bBMP280 = true;
         break;
       default:
         Serial.println("Missing BMx280 sensor");
    }
  }

  // Initialising Sensor SI7021
  if (si7021sensor.begin()) { //I2C 0x40
    Serial.println("Found SI7021 sensor");
    b7021 = true;
  } else {
    Serial.println("Missing SI7021 sensor");
  }

  // Initialising Sensor hdc1080
  hdc1080.begin(0x40);
  if ( hdc1080.readManufacturerId() == 0x5449) {
    Serial.println("Found HDC1080 sensor");
    bHDC = true;
  } else {
    Serial.print("Missing HDC1080 sensor, code: ");
    Serial.println(hdc1080.readManufacturerId(), HEX);
  }

  // Initialising Sensor CSS811
  if ( ccs811.beginWithStatus() == CCS811Core::CCS811_Stat_SUCCESS) { //I2C 0x5A or 0x5B
    Serial.println("Found CCS811 sensor");
    bCCS = true;
  } else {
    Serial.println("Missing CCS811 sensor");
  }

#if defined(ONE_WIRE_PIN)
  // Initialising OneWire sensors
  ow_sensors.begin(); // Start up the library
  oneWireDevices = ow_sensors.getDeviceCount();
  if (oneWireDevices > 0) {
    Serial.print("Found One Wire devices: ");
    Serial.println(oneWireDevices);
  } else
    Serial.println("Missing One Wire device");
  ow_sensors.setResolution( 12); //12-bit resolution
#endif

#if defined(DHT_PIN)
  // Initialising DHTxx sensors
  pinMode(DHT_PIN, INPUT);
  dht.begin();
  if (!isnan(dht.readTemperature())) {
    Serial.println("Found DHT" xstr(DHTTYPE) " sensor");
    bDHT = true;
  } else
    Serial.println("Missing DHT" xstr(DHTTYPE) " sensor");
#endif
}

//Read all values from available sensors
void readSensors( tMeasurement* ppm) {
  //Clear measurements and sensors
  ppm->temp = NAN;
  ppm->hum = NAN;
  ppm->pres = NAN;
  ppm->co2 = NAN;
  ppm->tvoc = NAN;
  ppm->latitude = defaultLatitude;
  ppm->longitude = defaultLongitude;
  tempSens = "";
  humSens = "";
  presSens = "";
  co2Sens = "";
  tvocSens = "";
  gpsSens = "";
#if defined(ESP32)
  //Read GPS location
  if (bGPS) {
    while (GPS.available() > 0)
      gps.encode(GPS.read());
    if (gps.location.isValid()) {
      ppm->latitude = gps.location.lat();
      ppm->longitude = gps.location.lng();
      Serial.println( String("GPS Lat: ") + ppm->latitude + "\t\tLongitude: " + ppm->longitude);
      gpsSens = "NEO-M8N";
    } else
      Serial.println( "Waiting for GPS fix");
  }
#endif

#if defined(ONE_WIRE_PIN)
  //Read temperature from the DS1820 sensor(s)
  ow_sensors.requestTemperatures();
  oneWireDevices = ow_sensors.getDeviceCount();
  for ( uint8_t i1 = 0; i1 < oneWireDevices; i1++) {
    float t = ow_sensors.getTempCByIndex( i1);
    if (t == -127)
      t = NAN;
    Serial.println(String("OneWire Temp: ") + t + "°C");
    if (isnan(ppm->temp) || (ppm->temp < t)) { //get the highest temperature
      ppm->temp = t;
      tempSens = "DS1820";
    }
  }
#endif

#if defined(DHT_PIN)
  //Read temperature and humidity from the DHTxx sensor
  if (bDHT) {
    ppm->temp = dht.readTemperature(); // Gets the values of the temperature
    tempSens = "DHT"xstr(DHTTYPE);
    ppm->hum = dht.readHumidity(); // Gets the values of the humidity
    HUMSens = "DHT"xstr(DHTTYPE);
  }
#endif

  //Read the BME680 sensor
  if (bBME680) {
    if (bme680.performReading()) {
      ppm->temp = bme680.temperature;
      tempSens = "bme680";
      ppm->hum = bme680.humidity;
      humSens = "bme680";
      ppm->pres = bme680.pressure / 100.0;
      presSens = "bme680";
      ppm->co2 = (bme680.gas_resistance / 1000.0) + 400;
      co2Sens = "bme680";
    } else {
      Serial.println("Failed to perform reading from BME680");
    }
  }

  //Read the BME280/BMP280 sensor
  if ( bBME280 || bBMP280) {
    bme.read(ppm->pres, ppm->temp, ppm->hum, BME280::TempUnit_Celsius, BME280::PresUnit_hPa);
    tempSens = "BME280";
    humSens = "BME280";
    presSens = "BME280";
    if ( !bBME280) { // Only BME280 does have humidity sensor
      ppm->hum = NAN;
      tempSens = "BMP280";
      humSens = "";
      presSens = "BMP280";
    }
    Serial.println(String("BME Temp: ") + ppm->temp + "°C\tHumidity: " + ppm->hum + "% RH\tPressure: " + ppm->pres + " hPa");
  }

  //Read the HDC1080 sensor
  if (bHDC) {
    ppm->temp = hdc1080.readTemperature();
    tempSens = "HDC1080";
    ppm->hum = hdc1080.readHumidity();
    humSens = "HDC1080";
    Serial.println(String("HDC Temp: ") + ppm->temp + "°C\tHumidity: " + ppm->hum + "% RH");
  }

  //Read the SI7021 sensor
  if (b7021) {
    ppm->temp = si7021sensor.getTemp();
    tempSens = "SI7021";
    ppm->hum = si7021sensor.getRH();
    humSens = "SI7021";
    Serial.println(String("SI Temp: ") + ppm->temp + "°C\tHumidity: " + ppm->hum + "% RH");
  }

  //Read the CCS811 sensor
  if (bCCS) {
    ccs811.setEnvironmentalData( isnan(ppm->hum) ? 60 : ppm->hum, ppm->temp);  //if humidity is not measured, set 60%
    ccs811.readAlgorithmResults();
    ppm->co2 = ccs811.getCO2();
    co2Sens = "CCS811";
    ppm->tvoc = ccs811.getTVOC();
    tvocSens = "CCS811";
    Serial.println(String("CCS CO2: ") + ppm->co2 + "ppm\t\tVOC: " + ppm->tvoc + "ppb");
  }
}

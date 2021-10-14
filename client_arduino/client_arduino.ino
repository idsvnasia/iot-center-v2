#define VERSION "0.52"
// Set WiFi AP SSID
#define WIFI_SSID "SSID"
// Set WiFi password
#define WIFI_PASSWORD "PASSWORD"
// Set IoT Center URL - set URL where IoT Center registration API is running
#define IOT_CENTER_URL "http://IP:5000"

//#define MEMORY_DEBUG    //Uncomment if you want to debug memory usage
//#define REAL_TIME
#define DEFAULT_CONFIG_REFRESH 3600
#define DEFAULT_MEASUREMENT_INTERVAL 60
#define MIN_FREE_MEMORY 15000   //memory leaks prevention

#if defined(ESP32)
  #include <WiFiClient.h>
  #include <HTTPClient.h>
  #define DEVICE "ESP32"
#elif defined(ESP8266)
  #include <ESP8266WiFi.h>
  #include <ESP8266HTTPClient.h>
  #define DEVICE "ESP8266"
  #define WIFI_AUTH_OPEN ENC_TYPE_NONE
#endif

#include "custom_dev.h" //Custom development configuration - remove or comment it out 
#include "cbuffer.h"
#include "client_arduino.h"

#define xstr(s) str(s)
#define str(s) #s

#if defined(MEMORY_DEBUG)
void printHeapInfluxDB( const char* location);
#define printHeap(s) printHeapInfluxDB(s)
#else
#define printHeap(s)
#endif

//Simple circular buffer to store measured values when offline
CircularBuffer<tMeasurement> mBuff;
String deviceID;
enum {i_influxdb, i_kafka, i_mqtt} dataIntf;

//declarations from other files
void setupSensors();
void readSensors( tMeasurement* ppm);
void initInfluxDB( bool connect, const String& url, const String& org, const String& bucket, const String& token, const String& deviceID, const char* device, const char* version, bool connectionReuse);
void measurementToLineProtocol( tMeasurement* ppm);
String getMeasurementStr();
bool writeInfluxDB();
bool readyInfluxDB();
void initMQTT( const char* url, const String& topic, const String& user, const String& passowrd, const String& options);
bool readyMQTT();
bool writeMQTT( const String& data);
void loopMQTT();
float defaultLatitude(NAN), defaultLongitude(NAN);

// How often the device should read configuration in seconds
int configRefresh = DEFAULT_CONFIG_REFRESH;
// How often the device should transmit measurements in seconds
int measurementInterval = DEFAULT_MEASUREMENT_INTERVAL;
//Time of the last config load
unsigned long loadConfigTime;

//Load value for specific parameter
String loadParameter( const String& response, const char* param) {
  int i = response.indexOf(param);
  if (i == -1) {
    Serial.print("Error - missing parameter: ");
    Serial.println( param);
    return "";
  }
  //Serial.println( "loadParameter: " + String(param) + "=" + response.substring( response.indexOf(":", i) + 2, response.indexOf("\n", i)));
  return response.substring( response.indexOf(":", i) + 2, response.indexOf("\n", i));
}

WiFiClient wifi_client;
HTTPClient http_config;


//Load configuration from IoT Center
void configSync() {
/*
Example response:
influx_url: https://us-west-2-1.aws.cloud2.influxdata.com
influx_org: iot-center-workshop@bonitoo.io
influx_token: YzgCfIlA9CHeEnVTvKqqvtatq9Y-oF7RIyYnY8Hu9OV1q8yZlxszXk9NZMQr7Om5xh9RjH4FtrtkVR-_sLVxqz==
influx_bucket: iot_center
id: ESP8266-5CCF7F1DC2E5
default_lon: 14.4071543
default_lat: 50.0873254
measurement_interval: 60
newlyRegistered: false
createdAt: 2021-06-17T12:02:49.144583231Z
updatedAt: 2021-06-17T12:02:49.144583231Z
serverTime: 2021-06-18T09:30:56.495Z
configuration_refresh: 3600
write_endpoint: /mqtt
kafka_url: null
kafka_topic: null
mqtt_url: mqtt://test.mosquitto.org
mqtt_topic: iot_center
mqtt_user: null
mqtt_password: null
mqtt_options: '{"connectTimeout":10000}'
*/
 
  // Load config from IoT Center
  String payload;
  String url = IOT_CENTER_URL + String(F("/api/env/")) + deviceID;
  Serial.println("Connecting " + url);
  http_config.begin( wifi_client, url);
  http_config.addHeader(F("Accept"), F("text/plain"));
  int httpCode = http_config.GET();
  if (httpCode == HTTP_CODE_OK) {
    payload = http_config.getString();
    Serial.println( "--Received configuration");
    Serial.print(payload);
    Serial.println("--end");
  } else {
    Serial.print("Config GET failed, error: ");
    Serial.println( http_config.errorToString(httpCode).c_str());
  }
  http_config.end();

  //Parse response, if exists
  if ( payload.length() > 0) {

    //Sync time from IoT Center
    String iotTime = loadParameter( payload, "serverTime");
    tm tmServer;
    int ms;
    sscanf( iotTime.c_str(), "%d-%d-%dT%d:%d:%d.%dZ", &tmServer.tm_year, &tmServer.tm_mon, &tmServer.tm_mday, &tmServer.tm_hour, &tmServer.tm_min, &tmServer.tm_sec, &ms);
    Serial.println( "Time: " + String(tmServer.tm_year) + " " + String(tmServer.tm_mon) + " " + String(tmServer.tm_mday) + " " + String(tmServer.tm_hour) + " " + String(tmServer.tm_min) + " " + String(tmServer.tm_sec));
    time_t ttServer = mktime(&tmServer);
    struct timeval tvServer = { .tv_sec = ttServer };
    settimeofday(&tvServer, NULL);

    // Show time
    ttServer = time(nullptr);
    Serial.print("Set time: ");
    Serial.print(String(ctime(&ttServer)));

    //Load refresh parameters
    measurementInterval = loadParameter( payload, "measurement_interval").toInt();
    if (measurementInterval == 0)
      measurementInterval = DEFAULT_MEASUREMENT_INTERVAL;
    //Serial.println(measurementInterval);

    configRefresh = loadParameter( payload, "configuration_refresh").toInt();
    if (configRefresh == 0)
      configRefresh = DEFAULT_CONFIG_REFRESH;
    //Serial.println(configRefresh);

    defaultLatitude = loadParameter( payload, "default_lat").toDouble();
    defaultLongitude = loadParameter( payload, "default_lon").toDouble();
    //Serial.println("GPS " + String(defaultLatitude) + "," + String(defaultLongitude));

    //Initialize InfluxDB and MQTT connection
    String endpoint = loadParameter( payload, "write_endpoint");
    
    if (endpoint == "/influx")
      dataIntf = i_influxdb;
    else
    if ( endpoint == "/kafka")
      dataIntf = i_kafka;
    else
    if ( endpoint == "/mqtt")
      dataIntf = i_mqtt;
     
    //Connect for for both influx and kafka, use direct InfluxDB connection, init for all
    initInfluxDB(( dataIntf == i_influxdb || dataIntf == i_kafka), loadParameter( payload, "influx_url"), loadParameter( payload, "influx_org"), loadParameter( payload, "influx_bucket"), loadParameter( payload, "influx_token"), deviceID, DEVICE, VERSION, measurementInterval <= 60);
    if ( dataIntf == i_mqtt)
      initMQTT( loadParameter( payload, "mqtt_url").c_str(), loadParameter( payload, "mqtt_topic"), loadParameter( payload, "mqtt_user"), loadParameter( payload, "mqtt_password"), loadParameter( payload, "mqtt_options"));
  } else
    Serial.println("Config GET failed, emty response");

  loadConfigTime = millis();
}

// Arduino main setup fuction
void setup() {
  //Prepare logging
  Serial.begin(115200);
  Serial.println();
  Serial.println( "V" VERSION);
  delay(500);
  printHeap("setup start");

  // Initialize sensors
  setupSensors();

  // Setup wifi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to wifi ");
  Serial.print(WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(100);
  }
  Serial.println();
  Serial.println("Connected " + WiFi.SSID() + " " +  WiFi.localIP().toString());

  //Generate Device ID
  deviceID = WiFi.macAddress();
  deviceID.remove(14, 1); //remove MAC separators
  deviceID.remove(11, 1);
  deviceID.remove(8, 1);
  deviceID.remove(5, 1);
  deviceID.remove(2, 1);
  deviceID = String(DEVICE) + "-" + deviceID;

  // Load configuration including time
  configSync();
  printHeap("setup exit");
}

bool writeReady() {
  //return false;
  if ( dataIntf == i_influxdb || dataIntf == i_kafka) //cannot write directly to kafka, use influxdb
    return readyInfluxDB();
  if ( dataIntf == i_mqtt)
    return readyMQTT();
}

bool writeData() {
  if ( dataIntf == i_influxdb || dataIntf == i_kafka)
    return writeInfluxDB();
  if ( dataIntf == i_mqtt)
    return writeMQTT( getMeasurementStr());
}

void writeLoop() {  //Keep alive the connection
  if ( dataIntf == i_mqtt) {
#if defined(REAL_TIME)
    // Read measurements from all the sensors
    tMeasurement* pm = mBuff.getTail();
    pm->timestamp = time(nullptr);
    readSensors( pm);
    measurementToLineProtocol( pm);
    writeMQTT( getMeasurementStr());
#endif
    return loopMQTT();
  }
}

void _delay( unsigned long t) {
  for (unsigned int i = 0; i < (t/1000); i++) {
    writeLoop();
    delay(1000);
  }
  delay(t%1000);
}
  
// Arduino main loop function
void loop() {
  printHeap("loop");
  // Read actual time to calculate final delay
  unsigned long loopTime = millis();

  // Read measurements from all the sensors
  tMeasurement* pm = mBuff.getTail();
  pm->timestamp = time(nullptr);
  readSensors( pm);


  // Write point into buffer
  unsigned long writeTime = millis();

  // If no Wifi signal, try to reconnect it
  if (WiFi.status() != WL_CONNECTED)
    Serial.println("Error, Wifi connection lost");
  // Flush buffer is needed and possible
  if (!mBuff.isEmpty()) {
    //Write circular buffer if not empty
    while (writeReady() && !mBuff.isEmpty()) {
      pm = mBuff.dequeue();
      measurementToLineProtocol( pm);
      Serial.print("Restoring from cBuffer: ");
      Serial.println(getMeasurementStr());
      writeData();
    }
  }
  //Serial.println("Loop2: " + String(loopTime));
  if (!isnan(pm->temp)) { //Write to InfluxDB only if we have a valid temperature
    // Convert measured values into InfluxDB point
    measurementToLineProtocol( pm);
    //Serial.println("Loop3: " + String(loopTime));
    if ( writeReady()) { //Only if InfluxDB client buffer is flushed, write new data
      Serial.print("Writing: ");
      Serial.println(getMeasurementStr());
      writeData();
    } else {
      if (mBuff.isFull())
        Serial.println("Error, full cBuffer, dropping the oldest record");
      Serial.print("Writing to cBuffer: ");
      Serial.println(getMeasurementStr());
      //Serial.println("Loop4: " + String(loopTime));
      mBuff.enqueue();            //if we already have data in InfluxDB client buffer, save to circular buffer
      //Serial.println("Loop5: " + String(loopTime));
      Serial.print("cBuffer size: ");
      Serial.print( mBuff.size() + 1);  //One record is allocated for actual write
      Serial.println(" of " xstr(OFFLINE_BUFFER_SIZE));
    }
  } else
    Serial.println("Error, no temperature, skip write");
  //Serial.println("Loop6: " + String(loopTime));
  // Test wheter synce sync configuration and configuration from IoT center
  if ((loadConfigTime > millis()) || ( millis() >= loadConfigTime + (configRefresh * 1000))) {
    if (ESP.getFreeHeap() < MIN_FREE_MEMORY) {    //if low memory, restart
      printHeap("low memory");
      ESP.restart();
    }
    printHeap("config start");
    configSync();
    printHeap("config exit");
  }
  // Calculate sleep time
  long delayTime = (measurementInterval * 1000) - (millis() - writeTime) - (writeTime - loopTime);
  //Serial.println(String(writeTime) + "," + String(loopTime) + "," + String(millis()));

  if (delayTime <= 0) {
    Serial.println("Warning, too slow processing " + String(delayTime));
    delayTime = 0;
  }

  if (delayTime > measurementInterval * 1000) {
    Serial.println("Error, time overflow " + String(delayTime));
    delayTime = measurementInterval * 1000;
  }
  // Sleep remaining time
  Serial.print("Wait: ");
  Serial.println( delayTime);
  _delay(delayTime);
}

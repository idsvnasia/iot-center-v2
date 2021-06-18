#include <InfluxDbClient.h>   //InfluxDB client for Arduino
#include <InfluxDbCloud.h>    //For Influx Cloud support
#include "cbuffer.h"

extern String tempSens, humSens, presSens, co2Sens, tvocSens, gpsSens;

#define WRITE_PRECISION WritePrecision::S
#define MAX_BATCH_SIZE 2
#define WRITE_BUFFER_SIZE 2

// InfluxDB client
InfluxDBClient clientDB;
// Data point
Point envData("environment");

void initInfluxDB( const String& url, const String& org, const String& bucket, const String& token, const String& deviceID, const char* device, const char* version, bool connectionReuse) {
  // Set InfluxDB parameters
  clientDB.setConnectionParams(url.c_str(), org.c_str(), bucket.c_str(), token.c_str(), InfluxDbCloud2CACert);
  
  /*WriteOptions wrOpt;
  wrOpt.writePrecision( WRITE_PRECISION).batchSize( MAX_BATCH_SIZE).bufferSize( WRITE_BUFFER_SIZE).addDefaultTag( "clientId", deviceID).addDefaultTag( "Device", device).addDefaultTag( "Version", version);
  clientDB.setWriteOptions(wrOpt);

  HTTPOptions htOpt;
  htOpt.connectionReuse(connectionReuse);
  clientDB.setHTTPOptions(htOpt);*/

  // Check InfluxDB server connection
  if (clientDB.validateConnection()) {
    Serial.print("Connected to InfluxDB: ");
    Serial.println(clientDB.getServerUrl());
  } else {
    Serial.print("InfluxDB connection failed: ");
    Serial.println(clientDB.getLastErrorMessage());
  }
}

// Add sensor type as tag
void addSensorTag( const char* tagName, float value, String sensor) {
  if ( isnan(value) || (sensor == ""))  //No sensor, exit
    return;
  envData.addTag( tagName, sensor);
}

// Convert measured values into InfluxDB point
void measurementToPoint( tMeasurement* ppm, Point& point) {
  // Clear tags (except default ones) and fields
  envData.clearTags();
  envData.clearFields();

  // Add InfluxDB tags
  addSensorTag( "TemperatureSensor", ppm->temp, tempSens);
  addSensorTag( "HumiditySensor", ppm->hum, humSens);
  addSensorTag( "PressureSensor", ppm->pres, presSens);
  addSensorTag( "CO2Sensor", ppm->co2, co2Sens);
  addSensorTag( "TVOCSensor", ppm->tvoc, tvocSens);
  addSensorTag( "GPSSensor", ppm->latitude, gpsSens);

  // Report measured values. If NAN, addField will skip it
  point.setTime( ppm->timestamp);
  point.addField("Temperature", ppm->temp);
  point.addField("Humidity", ppm->hum);
  point.addField("Pressure", ppm->pres);
  if ( !isnan(ppm->co2))
    point.addField("CO2", uint16_t(ppm->co2));
  if ( !isnan(ppm->tvoc))
    point.addField("TVOC", uint16_t(ppm->tvoc));
  point.addField("Lat", ppm->latitude, 6);
  point.addField("Lon", ppm->longitude, 6);
}

void setMeasurement( tMeasurement* ppm) {
  measurementToPoint( ppm, envData);
}

String getMeasurementStr() {
  return clientDB.pointToLineProtocol(envData);
}

bool readyInfluxDB() {
  bool b = clientDB.flushBuffer();
  if (!b) {  
    Serial.print("Error, InfluxDB flush failed: ");
    Serial.println(clientDB.getLastErrorMessage());
  }
  return b;
}

bool writeInfluxDB() {
  clientDB.writePoint(envData);  
  return readyInfluxDB();
}

//Only for memory debug puproses - detect memory leaks
void printHeapInfluxDB( const char* location){
  Serial.print(location);
  Serial.print(" - Free: ");
#if defined(ESP8266)  
  Serial.println(ESP.getFreeHeap());
#elif defined(ESP32)  
  Serial.print(ESP.getFreeHeap());
  Serial.print(" Min: ");
  Serial.print(ESP.getMinFreeHeap());
  Serial.print(" Size: ");
  Serial.print(ESP.getHeapSize());
  Serial.print(" Alloc: ");
  Serial.println(ESP.getMaxAllocHeap());
#endif
  return;   //skip logging
  if (clientDB.isBufferEmpty()) {
    Point memData("memory");
    memData.addTag( "Code", location);
    memData.addField("Free", ESP.getFreeHeap());
#if defined(ESP32)    
    memData.addField("Min", ESP.getMinFreeHeap());
    memData.addField("Size", ESP.getHeapSize());
    memData.addField("Alloc", ESP.getMaxAllocHeap());
#endif    
    clientDB.writePoint(memData);
    clientDB.flushBuffer();
  }
}

#if defined(ESP32)
  #include <WiFi.h>
#elif defined(ESP8266)
  #include <ESP8266WiFi.h>
#endif
  
#include <Arduino.h>
#include <PubSubClient.h>

WiFiClient espClient;
PubSubClient clientMQTT(espClient);
String topicMQTT;
extern String deviceID;

void _reconnect() {
  if (clientMQTT.connected())
    return;
  
  Serial.println("MQTT connect " + deviceID);
  if (!clientMQTT.connect( deviceID.c_str())) {
    Serial.print("MQTT failed: ");
    Serial.println(clientMQTT.state());
  }
}

void initMQTT( const char* url, const String& topic, const String& user, const String& password, const String& options) {
  int port = 1883;
  String sUrl = url;
  sUrl.toLowerCase();
  if (sUrl.startsWith("mqtt://")) //remove prefix?
    sUrl.remove(0, 7);
  if ( sUrl.indexOf(':') != -1) {  //port included? extract
    port = sUrl.substring( sUrl.indexOf(':') + 1).toInt();
    sUrl.remove(sUrl.indexOf(':'));
  }
  Serial.println( String(F("MQTT Server ")) + sUrl + ":" +  String(port));
  clientMQTT.setServer(sUrl.c_str(), port);
  clientMQTT.connect( deviceID.c_str(), user.c_str(), password.c_str());
  topicMQTT = topic;
  //_reconnect();
}

bool readyMQTT() {
  //clientMQTT.loop();
  if (!clientMQTT.connected())
    _reconnect();
  
  return clientMQTT.connected();
}

bool writeMQTT( const String& data) {
  Serial.println("MQTT publish " + topicMQTT + " - " + data);
  return clientMQTT.publish( topicMQTT.c_str(), data.c_str());
}

void loopMQTT() {
  clientMQTT.loop();
}

#include <ESP8266WiFi.h>
#include <Arduino.h>
#include <PubSubClient.h>
extern String deviceID;


WiFiClient espClient;
PubSubClient clientMQTT(espClient);
String topicMQTT;

void _reconnect() {
  if (clientMQTT.connected())
    return;
  
  Serial.println("MQTT connect");    
  if (clientMQTT.connect( deviceID.c_str())) {
    Serial.println("MQTT connected");
  } else {
    Serial.print("MQTT failed: ");
    Serial.println(clientMQTT.state());
  }
}

void initMQTT( const char* url, const String& topic, const String& user, const String& passowrd, const String& options) {
  int port = 1883;
  String sUrl = url;
  sUrl.toLowerCase();
  if (sUrl.startsWith("mqtt://")) //remove prefix?
    sUrl.remove(0, 7);
  if ( sUrl.indexOf(':') != -1) {  //port included?
    port = sUrl.substring( sUrl.indexOf(':') + 1).toInt();
    sUrl.remove(sUrl.indexOf(':'));
  }
  Serial.println( String(F("MQTT ")) + sUrl + ":" +  String(port));
  clientMQTT.setServer(sUrl.c_str(), port);
  topicMQTT = topic;

  _reconnect();
}

bool readyMQTT() {
  //clientMQTT.loop();
  if (!clientMQTT.connected())
    _reconnect();
  
  return clientMQTT.connected();
}

bool writeMQTT( const String& data) {
  Serial.println("MQTT publish");
  clientMQTT.publish( topicMQTT.c_str(), data.c_str());
  return clientMQTT.publish( topicMQTT.c_str(), data.c_str());
}

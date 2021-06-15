/** InfluxDB URL */
const INFLUX_URL = process.env.INFLUX_URL || 'http://localhost:8086'
/** InfluxDB authorization token */
const INFLUX_TOKEN = process.env.INFLUX_TOKEN || 'my-token'
/** Organization within InfluxDB  */
const INFLUX_ORG = process.env.INFLUX_ORG || 'my-org'
/** InfluxDB bucket  */
const INFLUX_BUCKET = 'iot_center'

/** optional Kafka Host */
const KAFKA_HOST = process.env.KAFKA_HOST
/** optional Kafka Topic */
const KAFKA_TOPIC = process.env.KAFKA_TOPIC

/** MQTT URL is required to use MQTT to write data when set, see https://github.com/mqttjs/MQTT.js#connect for available values */
const MQTT_URL = process.env.MQTT_URL
/** MQTT topic it is required to use MQTT to write data */
const MQTT_TOPIC = process.env.MQTT_TOPIC
/** optional MQTT username */
const MQTT_USERNAME = process.env.MQTT_USERNAME
/** optional MQTT password */
const MQTT_PASSWORD = process.env.MQTT_PASSWORD
const MQTT_OPTIONS_DEFAULT = '{"connectTimeout":10000}'
/** optional JSON encoded MQTT options, see https://github.com/mqttjs/MQTT.js#client */
const MQTT_OPTIONS = process.env.MQTT_OPTIONS || MQTT_OPTIONS_DEFAULT

// Defaults when on boarding a fresh new InfluxDB instance
/** InfluxDB user  */
const onboarding_username = 'my-user'
/** InfluxDB password  */
const onboarding_password = 'my-password'

/** recommended interval for client's to refresh configuration in seconds */
const configuration_refresh = 3600

function logEnvironment() {
  console.log(`INFLUX_URL=${INFLUX_URL}`)
  console.log(`INFLUX_TOKEN=${INFLUX_TOKEN ? '***' : ''}`)
  console.log(`INFLUX_ORG=${INFLUX_ORG}`)
  console.log(`INFLUX_BUCKET=${INFLUX_BUCKET}`)
  if (KAFKA_HOST) {
    console.log(`KAFKA_HOST=${KAFKA_HOST}`)
  }
  if (KAFKA_TOPIC) {
    console.log(`KAFKA_TOPIC=${KAFKA_TOPIC}`)
  }
  if (MQTT_URL) {
    console.log(`MQTT_URL=${MQTT_URL}`)
  }
  if (MQTT_TOPIC) {
    console.log(`MQTT_TOPIC=${MQTT_TOPIC}`)
  }
  if (MQTT_USERNAME) {
    console.log(`MQTT_USERNAME=${MQTT_USERNAME}`)
  }
  if (MQTT_URL) {
    console.log(`MQTT_OPTIONS=${MQTT_OPTIONS}`)
  }
}

module.exports = {
  INFLUX_URL,
  INFLUX_TOKEN,
  INFLUX_ORG,
  onboarding_username,
  onboarding_password,
  configuration_refresh,
  INFLUX_BUCKET,
  logEnvironment,
  KAFKA_HOST,
  KAFKA_TOPIC,
  MQTT_URL,
  MQTT_TOPIC,
  MQTT_USERNAME,
  MQTT_PASSWORD,
  MQTT_OPTIONS,
}

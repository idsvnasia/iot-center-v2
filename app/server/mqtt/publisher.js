const {MQTT_URL, MQTT_TOPIC} = require('../env')
const createClient = require('./createClient')
const {Point} = require('@influxdata/influxdb-client')
const {
  generateTemperature,
  generateHumidity,
  generatePressure,
  generateCO2,
  generateTVOC,
} = require('./util/generateValue')

const SEND_INTERVAL = 50

if (MQTT_URL && MQTT_TOPIC) {
  ;(async function () {
    const client = await createClient()
    console.log('Publishing to', MQTT_TOPIC, 'at', MQTT_URL)
    const sendData = async () => {
      const point = new Point('dummy')
      point.tag('host', 'test-host')
      point
        .floatField('Temperature', generateTemperature(Date.now()))
        .floatField('Humidity', generateHumidity(Date.now()))
        .floatField('Pressure', generatePressure(Date.now()))
        .intField('CO2', generateCO2(Date.now()))
        .intField('TVOC', generateTVOC(Date.now()))
      point.timestamp(new Date().getTime())
      const influxLineProtocolData = point.toLineProtocol()
      console.log(influxLineProtocolData)
      try {
        await client.publish(MQTT_TOPIC, influxLineProtocolData)
      } catch (e) {
        console.error('Unable to publish data: ', e)
      }
    }
    await sendData()
    const sendDataHandle = setInterval(sendData, SEND_INTERVAL)

    async function onShutdown() {
      try {
        clearInterval(sendDataHandle)
        await client.end()
      } catch (error) {
        console.error('ERROR: MQTT finalization failed', error)
      }
    }
    process.on('SIGINT', onShutdown)
    process.on('SIGTERM', onShutdown)
  })().catch(console.error)
} else {
  console.log('Please specify both MQTT_URL and MQTT_TOPIC')
}

const {MQTT_URL, MQTT_TOPIC} = require('../env')
const createClient = require('./createClient')
const {Point} = require('@influxdata/influxdb-client')
const {generateValue} = require('./util/generateValue')
const {parentPort} = require('worker_threads')

let sendDataHandle = -1

parentPort.on('message', async (data) => {
  if (!(MQTT_URL && MQTT_TOPIC))
    throw new Error('MQTT_URL and MQTT_TOPIC not specified')

  clearInterval(sendDataHandle)

  if (!data.running) {
    sendDataHandle = -1
    return
  }

  const client = await createClient()
  console.log('Publishing to', MQTT_TOPIC, 'at', MQTT_URL)
  const sendData = async () => {
    const point = new Point('environment')
    const now = Date.now()
    Object.entries(data.measurements).forEach(([name, options]) => {
      point.floatField(
        name,
        generateValue(options.period, options.min, options.max, now)
      )
    })
    point
      .tag('TemperatureSensor', 'virtual_TemperatureSensor')
      .tag('HumiditySensor', 'virtual_HumiditySensor')
      .tag('PressureSensor', 'virtual_PressureSensor')
      .tag('CO2Sensor', 'virtual_CO2Sensor')
      .tag('TVOCSensor', 'virtual_TVOCSensor')
      .tag('GPSSensor', 'virtual_GPSSensor')
      .tag('clientId', 'virtual_device')
    point.timestamp(now * 10 ** 6)
    const influxLineProtocolData = point.toLineProtocol()
    try {
      await client.publish(MQTT_TOPIC, influxLineProtocolData)
    } catch (e) {
      console.error('Unable to publish data: ', e)
    }
  }

  await sendData()
  sendDataHandle = setInterval(sendData, data.sendInterval)
})

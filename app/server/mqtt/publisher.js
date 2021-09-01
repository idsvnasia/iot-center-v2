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
    const point = new Point('dummy')
    point.tag('host', 'test-host')
    const now = Date.now()
    Object.entries(data.measurements).forEach(([name, options]) => {
      point.floatField(
        name,
        generateValue(options.period, options.min, options.max, now)
      )
    })
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
  sendDataHandle = setInterval(sendData, data.sendInterval)
})

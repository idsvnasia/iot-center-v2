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
const {parentPort} = require('worker_threads')

let sendDataHandle = -1
const GPX_SPEED_MODIFIER = 10000000

const measurements = [
  {name: 'Temperature', generate: generateTemperature},
  {name: 'Humidity', generate: generateHumidity},
  {name: 'Pressure', generate: generatePressure},
  {name: 'CO2', generate: generateCO2},
  {name: 'TVOC', generate: generateTVOC},
]

let gpxData
require('fs').readFile('./apis/gpxData.json', (_err, data) => {
  gpxData = JSON.parse(data.toString('utf-8'))
})

const MONTH_MILLIS = 30 * 24 * 60 * 60 * 1000

const getGPXIndex = (len, time) => {
  // modifier has to be divisible by len so modif % len = 0 % len
  const fixedModif = Math.floor(GPX_SPEED_MODIFIER / len) * len
  // ((time % MONTH_MILLIS) / MONTH_MILLIS) transforms time into month cycle result is <0;1)
  const indexFull = (((time % MONTH_MILLIS) / MONTH_MILLIS) * fixedModif) % len
  const index = Math.floor(indexFull)
  const rest = indexFull - index
  return {index, rest}
}

const generateGPXData = (data, time) => {
  const len = data.length
  const {index, rest} = getGPXIndex(len, time)
  const nextIndex = (index + 1) % len

  const e0 = data[index]
  const e1 = data[nextIndex]

  const i = (a, b) => a * (1 - rest) + b * rest
  const interpolatedResult = [i(e0[0], e1[0]), i(e0[1], e1[1])]

  return interpolatedResult
}

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
    measurements.forEach(({name, generate}) => {
      point.floatField(name, generate(now))
    })
    if (gpxData) {
      const [lat, lon] = generateGPXData(gpxData, Date.now())
      point.floatField('Lat', lat)
      point.floatField('Lon', lon)
    }
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

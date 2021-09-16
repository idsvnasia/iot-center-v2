const {MQTT_URL, MQTT_TOPIC} = require('../env')
const createClient = require('./createClient')
const {Point} = require('@influxdata/influxdb-client')
const {generateValue} = require('./util/generateValue')
const {parentPort} = require('worker_threads')

let sendDataHandle = -1

const limit = (min, max, value) => Math.min(max, Math.max(min, value))
const random = (min, max) => Math.random() * (max - min) + min

const cssMeasurements = [
  {
    last: 0,
    lastTime: 0,
    measurement: 'ParkingBrakeSwitch',
    generate: (last /* , lastTime, currentTime */) => {
      return limit(0, 2000, random(-100, 100.01) + last)
    },
  },
  {
    last: 0,
    lastTime: 0,
    measurement: 'Longitude',
    generate: (last /* , lastTime, currentTime */) => {
      return limit(0, 2000, random(-100, 100.01) + last)
    },
  },
  {
    last: 0,
    lastTime: 0,
    measurement: 'EngineCoolantTemperature',
    generate: (last /* , lastTime, currentTime */) => {
      return limit(0, 100, random(-5, 5.001) + last)
    },
  },
  {
    last: 0,
    lastTime: 0,
    measurement: 'BrakePrimaryPressure',
    generate: (last /* , lastTime, currentTime */) => {
      return limit(0, 2000, random(-100, 100.01) + last)
    },
  },
  {
    last: 0,
    lastTime: 0,
    measurement: 'EngineExhaustTemperature',
    generate: (last /* , lastTime, currentTime */) => {
      return limit(0, 300, random(-10, 10.01) + last)
    },
  },
  {
    last: 0,
    lastTime: 0,
    measurement: 'Latitude',
    generate: (last /* , lastTime, currentTime */) => {
      return limit(0, 2000, random(-100, 100.01) + last)
    },
  },
  {
    last: 0,
    lastTime: 0,
    measurement: 'EngineFuelRate',
    generate: (last /* , lastTime, currentTime */) => {
      return limit(0, 2000, random(-100, 100.01) + last)
    },
  },
  {
    last: 0,
    lastTime: 0,
    measurement: 'EngineIntakeAirPressure',
    generate: (last /* , lastTime, currentTime */) => {
      return limit(0, 2000, random(-100, 100.01) + last)
    },
  },
  {
    last: 0,
    lastTime: 0,
    measurement: 'EngineFuel1Temperature1',
    generate: (last /* , lastTime, currentTime */) => {
      return limit(0, 120, random(-2, 2.005) + last)
    },
  },
  {
    last: 0,
    lastTime: 0,
    measurement: 'EngineOilPressure1',
    generate: (last /* , lastTime, currentTime */) => {
      return limit(0, 2000, random(-100, 100.01) + last)
    },
  },
  {
    last: 0,
    lastTime: 0,
    measurement: 'WheelBasedVehicleSpeed',
    generate: (last /* , lastTime, currentTime */) => {
      return limit(0, 2000, random(-100, 100.01) + last)
    },
  },
  {
    last: 0,
    lastTime: 0,
    measurement: 'BatteryPotentialPowerInput1',
    generate: (last /* , lastTime, currentTime */) => {
      return limit(0, 2000, random(-100, 100.01) + last)
    },
  },
  {
    last: 0,
    lastTime: 0,
    measurement: 'EngineSpeed',
    generate: (last /* , lastTime, currentTime */) => {
      return limit(0, 2000, random(-100, 100.01) + last)
    },
  },
  {
    last: 0,
    lastTime: 0,
    measurement: 'EngineOilTemperature1',
    generate: (last /* , lastTime, currentTime */) => {
      return limit(0, 120, random(-5, 5.001) + last)
    },
  },
  {
    last: 0,
    lastTime: 0,
    measurement: 'EngineTotalHoursofOperation',
    generate: (last, lastTime, currentTime) => {
      if (!lastTime) return random(100, 3000)
      return last + (currentTime - lastTime) / (60 * 60 * 1000)
    },
  },
]

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

    for (const meas of cssMeasurements) {
      const point = new Point('css')
      const now = Date.now()
      meas.last = meas.generate(meas.last, meas.lastTime, now)
      meas.lastTime = now
      point.floatField(meas.measurement, meas.last)
      point.timestamp(now * 10 ** 6)
      const influxLineProtocolData = point.toLineProtocol()

      try {
        await client.publish(MQTT_TOPIC, influxLineProtocolData)
      } catch (e) {
        console.error('Unable to publish data: ', e)
      }
    }
  }

  await sendData()
  sendDataHandle = setInterval(sendData, data.sendInterval)
})

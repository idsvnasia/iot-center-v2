const express = require('express')
const {MQTT_TOPIC} = require('../env')
const createClient = require('./createClient')
const setupWsBroker = require('./ws/broker')
const {Worker} = require('worker_threads')

const publisherDefaultSettings = {
  running: false,
  sendInterval: 100,
  measurements: {
    Temperature: {period: 30, min: 0, max: 40},
    Humidity: {period: 90, min: 0, max: 99},
    Pressure: {period: 20, min: 970, max: 1050},
    CO2: {period: 1, min: 400, max: 3000},
    TVOC: {period: 1, min: 250, max: 2000},
  },
}
let publisherSettings = publisherDefaultSettings

const worker = new Worker('./mqtt/publisher.js')

// returns a router instance using an MQTT client configured from env
async function mqttRouter() {
  const client = await createClient()
  const router = express.Router()
  // bigger bodies are expected
  router.use(express.text({limit: '10mb'}))

  router.get('/settings', async (req, res) => {
    res.json(publisherSettings)
  })

  router.post('/settings', async (req, res) => {
    publisherSettings = JSON.parse(req.body)
    worker.postMessage(publisherSettings)
    res.end()
  })

  // register an InfluxDB-compatible write endpoint forwards data to MQTT
  router.post('/api/v2/write', async (req, res) => {
    if (!client) {
      res.status(500)
      res.end('MQTT is not configured!')
      return
    }
    const influxLineProtocolData = req.body
    try {
      await client.publish(MQTT_TOPIC, influxLineProtocolData)
    } catch (e) {
      res.status(500)
      res.end('MQTT producer error: ' + e)
      return
    }
    res.status(204)
    res.end()
  })
  if (!client) return router

  await setupWsBroker(client, router)

  return router
}

module.exports = mqttRouter

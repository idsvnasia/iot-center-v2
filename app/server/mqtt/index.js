const express = require('express')
const {MQTT_TOPIC} = require('../env')
const createClient = require('./createClient')
const setupWsBroker = require('./ws/broker')

// returns a router instance using an MQTT client configured from env
async function mqttRouter() {
  const client = await createClient()
  const router = express.Router()
  // bigger bodies are expected
  router.use(express.text({limit: '10mb'}))

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

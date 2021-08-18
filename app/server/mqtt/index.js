const express = require('express')
const {MQTT_TOPIC} = require('../env')
const {forEachWebSocket} = require('../ws')
const createClient = require('./createClient')

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

  // subscribe to MQTT and route to web sockets
  await client.subscribe(MQTT_TOPIC)
  client.on('message', function (_topic, buffer) {
    forEachWebSocket((ws) => {
      if (ws.subscription) {
        // TODO filter according to subscription
        ws.send(buffer.toString())
      }
    })
  })

  router.ws('/', async function (ws) {
    ws.on('message', async function ({data}) {
      const payload = data.toString()
      if (payload.startsWith('subscribe:')) {
        try {
          const subscription = JSON.parse(
            payload.substring('subscribe:'.length)
          )
          ws.subscription = subscription
        } catch (e) {
          console.error('unparseable subscribe message', payload)
        }
      } else {
        console.error('unknown ws message', payload)
      }
    })
    client.on('message', function (_topic, buffer) {
      ws.send(buffer.toString())
    })
  })
  return router
}

module.exports = mqttRouter

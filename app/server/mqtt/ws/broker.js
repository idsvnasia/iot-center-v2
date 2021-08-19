const {MQTT_TOPIC} = require('../../env')
const {forEachWebSocket} = require('../../ws')

/**
 * Setups express router to forward and filter MQTT messages
 * to web sockets according to their subscriptions.
 *
 * @param {mqtt.MQTTClient} client MQTT Client
 * @param {express.Router} router express router to setup
 */
async function setupWsBroker(client, router) {
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
  })
}

module.exports = setupWsBroker

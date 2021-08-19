const {MQTT_TOPIC} = require('../../env')
const {forEachWebSocket} = require('../../ws')
const parseLineProtocol = require('./lpParser')

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
    try {
      const points = parseLineProtocol(buffer)
      forEachWebSocket((ws) => {
        if (ws.subscription) {
          // TODO filter according to subscription
          const filtered = points.filter((point) => {
            for (const s of ws.subscription) {
              if (s.measurement !== point.measurement) {
                return false
              }
              let tagsMatched = 0
              for (const filter of s.tags) {
                for (const tagPair of point.tagPairs) {
                  if (filter === tagPair) {
                    tagsMatched++
                  }
                  break
                }
              }
              if (tagsMatched !== s.tags.length) {
                return false
              }
            }
            return true
          })
          if (filtered.length) {
            ws.send(JSON.stringify(filtered))
          }
        }
      })
    } catch (e) {
      console.error('Error while processing MQTT message', e)
    }
  })

  router.ws('/', async function (ws) {
    ws.on('message', function (data) {
      const payload = data.toString()
      if (payload.startsWith('subscribe:')) {
        try {
          const subscription = JSON.parse(
            payload.substring('subscribe:'.length)
          )
          if (subscription) {
            if (!Array.isArray(subscription)) {
              console.error(
                'subscription message must contain an array of all subscriptions, but:',
                JSON.stringify(subscription)
              )
              return
            }
            for (const s of subscription) {
              if (!s.measurement) {
                console.error(
                  'subscription ignored, missing measurement in: ',
                  JSON.stringify(s)
                )
                return
              }
              if (!Array.isArray(s.tags)) {
                console.error(
                  'subscription ignored, array of tags with key=value pairs expected in: ',
                  JSON.stringify(s)
                )
                return
              }
            }
          }
          ws.subscription = subscription
        } catch (e) {
          console.error('unparseable subscribe message', payload)
        }
      } else {
        console.error(
          "unknown ws message, should start with 'subscribe:'",
          payload
        )
      }
    })
  })
}
// example client exchange:
// ws =  new WebSocket("ws://" + location.host + "/mqtt/")
// ws.send('subscribe:[{"measurement":"environment", "tags":["a=b"]}]')
// ws.onMessage = ({data}) => console.log(data)
// // example message: [{"measurement":"environment","tagPairs":["CO2Sensor=virtual_CO2Sensor","a=b"],"fields":{"CO2":2572}, "timestamp": "1629357840000000000"}]
// ws.send('subscribe:false') // unsubscribe

module.exports = setupWsBroker

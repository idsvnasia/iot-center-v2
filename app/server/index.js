/* eslint-disable no-process-exit */
const express = require('express')
const path = require('path')
const proxy = require('express-http-proxy')

const apis = require('./apis')
const kafka = require('./kafka')
const mqtt = require('./mqtt')
const onboardInfluxDB = require('./influxdb/onboarding')
const {logEnvironment, INFLUX_URL} = require('./env')
const {monitorResponseTime, startProcessMonitoring} = require('./monitor')
const {addWebSockets} = require('./ws')

// terminate on DTRL+C or CTRL+D
process.on('SIGINT', () => process.exit())
process.on('SIGTERM', () => process.exit())

async function startApplication() {
  const app = express()
  addWebSockets(app)

  // monitor application response time
  monitorResponseTime(app)

  // APIs
  app.use('/api', apis)

  // Kafka write
  app.use('/kafka', kafka)

  // MQTT write
  app.use('/mqtt', await mqtt())

  // start proxy to InfluxDB to avoid CORS blocking with InfluXDB OSS v2 Beta
  app.use('/influx', proxy(INFLUX_URL))
  console.log(`Enable proxy from /influx/* to ${INFLUX_URL}/*`)

  // UI
  const uiBuildDir = path.join(__dirname, '../ui/build')
  app.use(express.static(uiBuildDir))
  // assume UI client navigation
  app.get('*', (req, res) => {
    res.sendFile(path.join(uiBuildDir, 'index.html'))
  })

  // onboard a new InfluxDB instance
  await onboardInfluxDB()

  // start monitoring node process
  startProcessMonitoring()

  // start HTTP server
  const port = process.env.PORT || 5000
  app.listen(port, process.env.HOSTNAME || '0.0.0.0')

  logEnvironment()
  console.log(`Listening on http://localhost:${port}`)
}

startApplication().catch((e) => {
  console.error('Failed to start: ', e)
  process.exitCode = 1
})

import {newTable, Plot, timeFormatter} from '@influxdata/giraffe'
import React, {FunctionComponent, useEffect, useState} from 'react'
import PageContent from './PageContent'

const maxSize = 100

interface Point {
  measurement: string
  tagPairs: string[]
  fields: Record<string, number | boolean | string>
  timestamp: string
  ts: number
}
interface Subscription {
  measurement: string
  tags: string[]
}

const RealTimePage: FunctionComponent = () => {
  const [messages, setMessages] = useState<Point[]>([])
  const [subscriptions /*, setSubscriptions */] = useState<Subscription[]>([
    {measurement: 'dummy', tags: ['host=test-host']},
  ])

  useEffect(() => {
    let ws: WebSocket | undefined
    // create a web socket and start listening
    function startListening() {
      ws = undefined
      const newWS = new WebSocket('ws://localhost:5000/mqtt')
      newWS.onopen = () =>
        newWS.send('subscribe:' + JSON.stringify(subscriptions))
      newWS.onmessage = (event) => {
        const data = JSON.parse(event.data) as Point[]
        setMessages((prev) => {
          if (prev.length >= maxSize) {
            prev = prev.slice(prev.length - maxSize + 1, prev.length)
          }
          data.forEach((x: Point) => {
            x.ts = x.timestamp
              ? Number.parseInt(x.timestamp.substring(0, 13))
              : Date.now()
          })
          return [...prev, ...data].sort((a, b) => a.ts - b.ts)
        })
      }
      ws = newWS
    }
    startListening()
    // reconnect a broken WS connection
    const checker = setInterval(() => {
      if (
        ws &&
        (ws.readyState === WebSocket.CLOSING ||
          ws.readyState === WebSocket.CLOSED)
      ) {
        startListening()
      }
    }, 2000)
    // close web socket, clear timer on unmount
    return () => {
      clearInterval(checker)
      if (ws) ws.close()
    }
  }, [subscriptions])
  return (
    <PageContent title="Realtime Demo">
      <div>
        This demo shows how to receive runtime points that are published using{' '}
        <code>app/server: yarn mqtt_publisher</code>
      </div>
      <div style={{width: '100%', height: 200}}>
        <Plot
          config={{
            table: newTable(messages.length)
              .addColumn(
                '_time',
                'long',
                'time',
                messages.map((x) => x.ts),
                '_time'
              )
              .addColumn(
                '_value',
                'double',
                'number',
                messages.map((x) => x.fields.temperature as number),
                'value'
              ),
            layers: [
              {
                type: 'line',
                x: '_time',
                y: '_value',
              },
            ],
            valueFormatters: {
              _time: timeFormatter({
                timeZone: 'UTC',
                format: 'YYYY-MM-DD HH:mm:ss.sss ZZ',
              }),
            },
          }}
        ></Plot>
      </div>
      {messages.length === 0 ? undefined : (
        <>
          <h3>Last Point</h3>
          <pre>{JSON.stringify(messages[messages.length - 1], null, 2)}</pre>
        </>
      )}
    </PageContent>
  )
}

export default RealTimePage

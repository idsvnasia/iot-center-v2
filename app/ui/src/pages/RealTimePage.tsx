import {newTable, Plot, timeFormatter} from '@influxdata/giraffe'
import React, {FunctionComponent, useEffect, useState} from 'react'
import PageContent from './PageContent'

const maxSize = 10

interface Point {
  measurement: string
  tagPairs: string[]
  fields: Record<string, number | boolean | string>
  timestamp: string
  ts: number
}

const RealTimePage: FunctionComponent = () => {
  const [messages, setMessages] = useState<Point[]>([])

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:5000/mqtt')
    ws.onopen = () => ws.send('subscribe:[{"measurement":"dummy", "tags":[]}]')
    ws.onmessage = (event) => {
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
    return () => ws.close()
  }, [])
  return (
    <PageContent title="Realtime Demo">
      <div>
        This demo shows how to receive runtime points that are published using{' '}
        <code>app/server: yarn mqtt_producer</code>
      </div>
      <div>
        {messages.map((x, i) => (
          <span key={i} title={new Date(x.ts).toString()}>
            {Math.round((x.fields.temperature as number) || 0)}{' '}
          </span>
        ))}
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
                format: 'YYYY-MM-DD HH:mm:ss ZZ',
              }),
            },
          }}
        ></Plot>
      </div>
      <h3>Last Point</h3>
      {messages.length === 0 ? undefined : (
        <pre>{JSON.stringify(messages[messages.length - 1], null, 2)}</pre>
      )}
    </PageContent>
  )
}

export default RealTimePage

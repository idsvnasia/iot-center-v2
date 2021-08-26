import {Card, Col, Divider, Row} from 'antd'
import {Line} from '@ant-design/charts'
import React, {FunctionComponent, useEffect, useState} from 'react'
import PageContent from './PageContent'

const maxSize = 400

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

const formatter = (v: string) => new Date(+v).toLocaleTimeString()

const RealTimePage: FunctionComponent = () => {
  const [messages, setMessages] = useState<Point[]>([])
  const [subscriptions /*, setSubscriptions */] = useState<Subscription[]>([
    {measurement: 'dummy', tags: ['host=test-host']},
  ])

  useEffect(() => {
    let ws: WebSocket | undefined

    // create a web socket and start listening
    const startListening = () => {
      ws = undefined
      const host =
        process.env.NODE_ENV === `development`
          ? window.location.hostname + ':5000'
          : window.location.host
      const newWS = new WebSocket(`ws://${host}/mqtt`)
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

  const dist = (arr: number[]) => {
    const min = Math.min(...arr)
    const max = Math.max(...arr)
    return max - min
  }

  const delay = dist(messages.map((x) => x.ts)) / (messages.length || 0)

  return (
    <PageContent title="Realtime Demo (Old, will be deleted)">
      <Row gutter={[24, 24]}>
        <Col xs={12}>
          <Card>
            <div>
              This demo shows how to receive runtime points that are published
              using <code>app/server: yarn mqtt_publisher</code>
            </div>
            <Divider></Divider>
            <h3>
              Last Point (of{' '}
              {(messages.length || 0).toString(10).padStart(4, '_')} points with
              avg. delay: {Math.round(delay).toString(10)})
            </h3>
            {messages.length === 0 ? (
              'No messages'
            ) : (
              <pre>
                {JSON.stringify(messages[messages.length - 1], null, 2)}
              </pre>
            )}
          </Card>
        </Col>
        <Col xs={12}>
          <Card>
            <Line
              data={messages.flatMap((x) =>
                Object.entries(x.fields).map(([key, value]) => ({
                  value,
                  key,
                  time: x.ts,
                }))
              )}
              xField="time"
              yField="value"
              seriesField="key"
              animation={false}
              xAxis={{
                label: {
                  formatter,
                },
              }}
            />
          </Card>
        </Col>
      </Row>

      <div style={{width: '100%', height: 200}}></div>
    </PageContent>
  )
}

export default RealTimePage

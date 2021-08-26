import {Card, Col, Divider, Row} from 'antd'
import {Line} from '@antv/g2plot'
import React, {FunctionComponent, useEffect, useState} from 'react'
import PageContent from './PageContent'
import {useRef} from 'react'

const maxSize = 400

interface Point {
  measurement: string
  tagPairs: string[]
  fields: Record<string, number | boolean | string>
  timestamp: string
}
interface Subscription {
  measurement: string
  tags: string[]
}
interface DiagramEntryPoint {
  value: number
  time: number
  key: string
}

const formatter = (v: string) => new Date(+v).toLocaleTimeString()

const RealTimePage: FunctionComponent = () => {
  const dataRef = useRef<DiagramEntryPoint[]>([])
  const invalidateRef = useRef(false)
  const [messages, setMessages] = useState<Point[]>([])
  const [subscriptions /*, setSubscriptions */] = useState<Subscription[]>([
    {measurement: 'dummy', tags: ['host=test-host']},
  ])
  const lineRef = useRef<Line>()

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
      newWS.onmessage = (response) => {
        const obj = JSON.parse(response.data) as Point[]
        const dataArr = dataRef.current

        for (const p of obj) {
          const fields = p.fields
          const time = +p.timestamp
          for (const key in fields) {
            const value = fields[key] as number
            dataArr.push({value, key, time})
          }
        }
        // todo: uses 5 fields, find alternative universal solution
        const overflow = dataArr.length - maxSize * 5
        if (overflow > 0) dataArr.splice(0, overflow)
        invalidateRef.current = true
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

  useEffect(() => {
    const handler = {val: -1}
    const loop = () => {
      console.log('raf called')
      handler.val = requestAnimationFrame(loop)
      if (!invalidateRef.current) return
      console.log('Render!')
      invalidateRef.current = false
      const dataArr = dataRef.current
      lineRef.current?.changeData(dataArr)
    }
    handler.val = requestAnimationFrame(loop)

    return () => cancelAnimationFrame(handler.val)
  }, [])

  const diagramContainer = useRef<HTMLDivElement>(undefined!)

  useEffect(() => {
    if (!diagramContainer.current) return
    const container = diagramContainer.current
    const line = new Line(container, {
      data: dataRef.current,
      xField: 'time',
      yField: 'value',
      seriesField: 'key',
      animation: false,
      xAxis: {
        label: {
          formatter,
        },
      },
    })
    line.render()
    lineRef.current = line
  }, [])

  return (
    <PageContent title="Realtime Demo">
      <Row gutter={[24, 24]}>
        <Col xs={12}>
          <Card>
            <div>
              This demo shows how to receive runtime points that are published
              using <code>app/server: yarn mqtt_publisher</code>
            </div>
            {/* <Divider></Divider>
            <h3>Last Point (of {(messages.length || 0).toString(10).padStart(4, "_")} points with avg. delay: {Math.round(delay).toString(10)})</h3>
            {messages.length === 0 ? "No messages" : (
              <pre>{JSON.stringify(messages[messages.length - 1], null, 2)}</pre>
            )} */}
          </Card>
        </Col>
        <Col xs={12}>
          <Card>
            <div ref={diagramContainer} />
          </Card>
        </Col>
      </Row>
      <div style={{width: '100%', height: 200}}></div>
    </PageContent>
  )
}

export default RealTimePage

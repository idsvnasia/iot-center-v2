import {Card, Col, Row} from 'antd'
import {Line, Gauge} from '@antv/g2plot'
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

const useRafOnce = (callback: () => void) => {
  const calledRef = useRef(false)

  return () => {
    if (calledRef.current) return
    calledRef.current = true
    requestAnimationFrame(() => {
      calledRef.current = false
      callback()
    })
  }
}

type MeasurementGaugeOptions = {
  measurement: string
  index: number
  min: number
  max: number
  ticks: number[]
  color: string[]
  unit: string
}

const gaugesOptions: MeasurementGaugeOptions[] = [
  {
    measurement: 'Temperature',
    min: -10,
    max: 50,
    ticks: [0, 0.2, 0.8, 1],
    color: ['#655ae6', 'lightgreen', '#ff5c5c'],
    unit: '°C',
  },
  {
    measurement: 'Humidity',
    min: 0,
    max: 100,
    ticks: [0, 0.1, 0.9, 1],
    color: ['#ff5c5c', 'lightgreen', '#ff5c5c'],
    unit: '%',
  },
  {
    measurement: 'Pressure',
    min: 800,
    max: 1100,
    ticks: [0, 0.25, 0.9, 1],
    color: ['lightgreen', '#dbeb2a', 'red'],
    unit: ' hPa',
  },
  {
    measurement: 'CO2',
    min: 300,
    max: 3500,
    ticks: [0, 0.1, 0.9, 1],
    color: ['#ff5c5c', 'lightgreen', '#ff5c5c'],
    unit: ' ppm',
  },
  // {measurement: 'TVOC', min: 200, max: 2200, ticks: [0, 1 / 3, 2 / 3, 1],color: ['#F4664A', '#FAAD14', '#30BF78'],},
].map((x, index) => ({index, ...x}))

const RealTimePage: FunctionComponent = () => {
  const dataRef = useRef<DiagramEntryPoint[]>([])
  const dataGaugeRef = useRef<Record<string, {time: number; value: number}>>(
    Object.fromEntries(
      gaugesOptions.map(({measurement}) => [measurement, {time: 0, value: 0}])
    )
  )
  const [subscriptions /*, setSubscriptions */] = useState<Subscription[]>([
    {measurement: 'dummy', tags: ['host=test-host']},
  ])
  const diagramContainer = useRef<HTMLDivElement>(undefined!)
  const lineRef = useRef<Line>()
  const gaugesRef = useRef<Gauge[]>(gaugesOptions.map((x) => undefined!))

  const invalidate = useRafOnce(() => {
    lineRef.current?.changeData(dataRef.current)
    const gauges = gaugesRef.current
    for (const i in gauges) {
      const gaugeOpts = gaugesOptions[i]
      const gauge = gauges[i]
      const value = dataGaugeRef.current[gaugeOpts.measurement].value

      const {min, max} = gaugeOpts
      const mappedValue = (value - min) / (max - min)

      gauge.changeData(mappedValue)
    }
  })

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
        const dataGauge = dataGaugeRef.current

        for (const p of obj) {
          const fields = p.fields
          const time = +p.timestamp
          for (const key in fields) {
            const value = fields[key] as number
            dataArr.push({value, key, time})

            const gaugeObj = dataGauge[key]
            if (gaugeObj && gaugeObj.time < time) {
              gaugeObj.time = time
              gaugeObj.value = value
            }
          }
        }
        // todo: uses 5 fields, find alternative universal solution
        const overflow = dataArr.length - maxSize * 5
        if (overflow > 0) dataArr.splice(0, overflow)

        invalidate()
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

  const MeasurementGauge: React.FC<MeasurementGaugeOptions> = ({
    min,
    max,
    ticks,
    color,
    unit,
    index,
    measurement,
  }) => {
    const ref = useRef<HTMLDivElement>(undefined!)

    useEffect(() => {
      const gauge = new Gauge(ref.current, {
        percent: 0.75,
        range: {
          ticks,
          color,
        },
        axis: {
          label: {
            formatter: (v) => +v * (max - min) + min,
          },
        },
        statistic: {
          content: {
            formatter: (x) => {
              if (!x) return ''
              const {percent} = x
              return `${(+percent * (max - min) + min).toFixed(0)}${unit}`
            },
          },
        },
      })
      gauge.render()

      gaugesRef.current[index] = gauge
    }, [])

    return (
      <Col xs={6}>
        <Card title={measurement}>
          <div ref={ref} />
        </Card>
      </Col>
    )
  }

  return (
    <PageContent
      title="Realtime Demo"
      titleExtra={
        <>
          This demo shows how to receive runtime points that are published using{' '}
          <code>app/server: yarn mqtt_publisher</code>
        </>
      }
    >
      <Row gutter={[24, 24]}>
        <Col xs={24}>
          <Row gutter={[24, 24]}>{gaugesOptions.map(MeasurementGauge)}</Row>
        </Col>
        <Col xs={24}>
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

import {Card, Col, Row} from 'antd'
import {Line, Gauge} from '@antv/g2plot'
import React, {FunctionComponent, useEffect, useState} from 'react'
import PageContent from './PageContent'
import {useRef} from 'react'
import {useCallback} from 'react'
import ReactGridLayout, {WidthProvider, Layout} from 'react-grid-layout'
const Grid = WidthProvider(ReactGridLayout)

const maxSize = 400

const host =
  process.env.NODE_ENV === `development`
    ? window.location.hostname + ':5000'
    : window.location.host
const wsAddress = `ws://${host}/mqtt`

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

const useWebSocket = (callback: (ws: WebSocket) => void, url: string) => {
  const wsRef = useRef<WebSocket>()

  const startListening = useCallback(() => {
    console.log('starting WebSocket')
    wsRef.current = new WebSocket(url)
    callback(wsRef.current)
  }, [callback, url])

  useEffect(() => {
    startListening()
    return () => wsRef.current?.close()
  }, [startListening])

  useEffect(() => {
    // reconnect a broken WS connection
    const checker = setInterval(() => {
      if (
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.CLOSING ||
          wsRef.current.readyState === WebSocket.CLOSED)
      ) {
        startListening()
      }
    }, 2000)
    return () => clearInterval(checker)
  }, [startListening])
}

type MeasurementGaugeOptions = {
  measurement: string
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
  {
    measurement: 'TVOC',
    min: 200,
    max: 2200,
    ticks: [0, 1 / 3, 2 / 3, 1],
    color: ['#F4664A', '#FAAD14', '#30BF78'],
    unit: '',
  },
]

const MeasurementGauge: React.FC<
  MeasurementGaugeOptions & {
    index: number
    gaugesRef: React.MutableRefObject<Gauge[]>
  }
> = ({min, max, ticks, color, unit, measurement, index, gaugesRef}) => {
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
      height: 300,
    })
    gauge.render()

    gaugesRef.current[index] = gauge
  }, [])

  return (
    <Card title={measurement} style={{height: '100%'}}>
      <div ref={ref} />
    </Card>
  )
}

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

  const wsInit = useCallback<(ws: WebSocket) => void>(
    (ws) => {
      ws.onopen = () => ws.send('subscribe:' + JSON.stringify(subscriptions))
      ws.onmessage = (response) => {
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
    },
    [subscriptions]
  )
  useWebSocket(wsInit, wsAddress)

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
      height: 300,
    })
    line.render()
    lineRef.current = line
  }, [])

  // quickfix for grid initial render issue
  useEffect(() => {
    setTimeout(() => window.dispatchEvent(new Event('resize')))
  }, [])

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
      <div style={{position: 'relative'}}>
        <Grid cols={5} rowHeight={400} isResizable={true} onLayoutChange={(...x)=>{console.log(x)}}>
          {gaugesOptions.map((x, index) => (
            <div key={index} data-grid={{x: index, y: 0, w: 1, h: 1}}>
              <div style={{width: '100%', height: '100%'}}>
                <MeasurementGauge {...x} key={index} {...{index, gaugesRef}} />
              </div>
            </div>
          ))}
          <div key="lines" data-grid={{x: 0, y: 1, w: 5, h: 1}}>
            <Card style={{height: '100%'}} title={"All measurements line"}>
              <div ref={diagramContainer} />
            </Card>
          </div>
        </Grid>
      </div>
    </PageContent>
  )
}

export default RealTimePage

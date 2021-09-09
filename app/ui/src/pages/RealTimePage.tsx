import {Card} from 'antd'
import {Line, Gauge, GaugeOptions} from '@antv/g2plot'
import React, {FunctionComponent, useState} from 'react'
import PageContent from './PageContent'
import {useRef} from 'react'
import {useCallback} from 'react'
import {
  DiagramEntryPoint,
  G2Plot,
  useG2Plot,
  useWebSocket,
} from '../util/realtimeUtils'
import GridFixed from '../util/GridFixed'

const maxSize = 400

const host =
  process.env.NODE_ENV === `development`
    ? window.location.hostname + ':5000'
    : window.location.host
const wsAddress = `ws://${host}/mqtt`

const useRealtimeData = (
  subscriptions: Subscription[],
  onReceivePoints: (pts: Point[]) => void
) => {
  const wsInit = useCallback<(ws: WebSocket) => void>(
    (ws) => {
      ws.onopen = () => ws.send('subscribe:' + JSON.stringify(subscriptions))
      ws.onmessage = (response) =>
        onReceivePoints(JSON.parse(response.data) as Point[])
    },
    [subscriptions, onReceivePoints]
  )
  useWebSocket(wsInit, wsAddress)
}

type Point = {
  measurement: string
  tagPairs: string[]
  fields: Record<string, number | boolean | string>
  timestamp: string
}
type Subscription = {
  measurement: string
  tags: string[]
}

type MeasurementGaugeOptions = {
  min: number
  max: number
  ticks: number[]
  color: string[]
  unit: string
}

const gaugesOptions: Record<string, MeasurementGaugeOptions> = {
  Temperature: {
    min: -10,
    max: 50,
    ticks: [0, 0.2, 0.8, 1],
    color: ['#655ae6', 'lightgreen', '#ff5c5c'],
    unit: '°C',
  },
  Humidity: {
    min: 0,
    max: 100,
    ticks: [0, 0.1, 0.9, 1],
    color: ['#ff5c5c', 'lightgreen', '#ff5c5c'],
    unit: '%',
  },
  Pressure: {
    min: 800,
    max: 1100,
    ticks: [0, 0.25, 0.9, 1],
    color: ['lightgreen', '#dbeb2a', 'red'],
    unit: ' hPa',
  },
  CO2: {
    min: 300,
    max: 3500,
    ticks: [0, 0.1, 0.9, 1],
    color: ['#ff5c5c', 'lightgreen', '#ff5c5c'],
    unit: ' ppm',
  },
  TVOC: {
    min: 200,
    max: 2200,
    ticks: [0, 1 / 3, 2 / 3, 1],
    color: ['#F4664A', '#FAAD14', '#30BF78'],
    unit: '',
  },
}

const gaugesPlotOptions: Record<
  string,
  Omit<GaugeOptions, 'percent'>
> = Object.fromEntries(
  Object.entries(gaugesOptions).map(
    ([measurement, {ticks, color, max, min, unit}]) => [
      measurement,
      {
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
            formatter: (x) =>
              x ? `${(+x.percent * (max - min) + min).toFixed(0)}${unit}` : '',
          },
        },
        height: 300,
      },
    ]
  )
)

const RealTimePage: FunctionComponent = () => {
  const [subscriptions /*, setSubscriptions */] = useState<Subscription[]>([
    {measurement: 'environment', tags: ['clientId=virtual_device']},
  ])
  const gaugeUpdatesRef = useRef<Record<string, (newData: number) => void>>({})
  const gaugeLastDataTimesRef = useRef<Record<string, number>>(
    Object.fromEntries(Object.keys(gaugesOptions).map((x) => [x, -1]))
  )

  const [lineOptions /*, setLineOptions */] = useState({
    height: 300,
  })
  const plot = useG2Plot(Line, lineOptions)

  const updateGaugeData = (measurement: string, time: number, data: number) => {
    const gaugeLastTimes = gaugeLastDataTimesRef.current
    const gaugeUpdates = gaugeUpdatesRef.current

    if (gaugeLastTimes[measurement] < time) {
      const {min, max} = gaugesOptions[measurement]
      gaugeUpdates[measurement]?.((data - min) / (max - min))
    }
  }

  const updatePoints = useCallback((points: Point[]) => {
    const newData: DiagramEntryPoint[] = []

    for (const p of points) {
      const fields = p.fields
      const time = Math.floor(+p.timestamp / 10 ** 6)

      for (const key in fields) {
        const value = fields[key] as number
        newData.push({key, time, value})
        updateGaugeData(key, time, value)
      }
    }

    plot.update((dataArr) => {
      dataArr.push(...newData)
      // todo: only for 5 entries per point, find alternative universal solution
      const overflow = dataArr.length - maxSize * 5
      if (overflow > 0) dataArr.splice(0, overflow)
      plot.update(dataArr)
    })
  }, [plot])

  useRealtimeData(subscriptions, updatePoints)

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
      <GridFixed cols={5} rowHeight={400} isResizable={true}>
        {Object.entries(gaugesPlotOptions).map(
          ([measurement, options], index) => (
            <Card
              key={index}
              data-grid={{x: index, y: 0, w: 1, h: 1}}
              style={{height: '100%'}}
              title={measurement}
            >
              <G2Plot
                type={Gauge}
                onUpdaterChange={(updater) =>
                  (gaugeUpdatesRef.current[measurement] = updater)
                }
                options={options}
              />
            </Card>
          )
        )}
        <Card
          key="lines"
          data-grid={{x: 0, y: 0, w: 5, h: 1}}
          style={{height: '100%'}}
          title={'All measurements line'}
        >
          {plot.element}
        </Card>
      </GridFixed>
    </PageContent>
  )
}

export default RealTimePage

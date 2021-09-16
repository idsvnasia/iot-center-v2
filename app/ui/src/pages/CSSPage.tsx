import {Switch} from 'antd'
import {Line, GaugeOptions, LineOptions, Gauge} from '@antv/g2plot'
import React, {FunctionComponent, useEffect, useState} from 'react'
import PageContent from './PageContent'
import {useCallback} from 'react'
import {
  DiagramEntryPoint,
  pushBigArray,
  useG2Plot,
  useWebSocket,
} from '../util/realtimeUtils'
import GridFixed from '../util/GridFixed'

import {Table as GiraffeTable} from '@influxdata/giraffe'
import {
  flux,
  fluxDuration,
  InfluxDB,
  fluxExpression,
  fluxString,
} from '@influxdata/influxdb-client'
import {queryTable} from '../util/queryTable'
import {VIRTUAL_DEVICE} from '../App'
import {useRef} from 'react'

// todo: setable on page
const retentionTime = 10000

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

interface DeviceConfig {
  influx_url: string
  influx_org: string
  influx_token: string
  influx_bucket: string
  id: string
}

interface DeviceData {
  config: DeviceConfig
  measurementsTable?: GiraffeTable
}

const fetchDeviceConfig = async (deviceId: string): Promise<DeviceConfig> => {
  const response = await fetch(
    `/api/env/${deviceId}?register=${deviceId === VIRTUAL_DEVICE}`
  )
  if (response.status >= 300) {
    const text = await response.text()
    throw new Error(`${response.status} ${text}`)
  }
  const deviceConfig: DeviceConfig = await response.json()
  if (!deviceConfig.influx_token) {
    throw new Error(`Device '${deviceId}' is not authorized!`)
  }
  return deviceConfig
}

const fetchDeviceMeasurements = async (
  config: DeviceConfig,
  fields: string[],
  timeStart = '-1d'
): Promise<GiraffeTable> => {
  const {
    // influx_url: url, // use '/influx' proxy to avoid problem with InfluxDB v2 Beta (Docker)
    influx_token: token,
    influx_org: org,
    influx_bucket: bucket,
    id,
  } = config
  const queryApi = new InfluxDB({url: '/influx', token}).getQueryApi(org)
  const result = await queryTable(
    queryApi,
    flux`
  from(bucket: ${bucket})
    |> range(start: ${fluxDuration(timeStart)})
    |> filter(fn: (r) => r._measurement == "css")
    |> filter(fn: (r) => ${fluxExpression(
      fields.map((f) => `r["_field"] == ${fluxString(f)}`).join(' or ')
    )})
    `
    // |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)
  )
  return result
}

const fetchInfluxData = async (
  fields: string[]
): Promise<DeviceData | undefined> => {
  try {
    const config = await fetchDeviceConfig(VIRTUAL_DEVICE)
    return {
      config,
      measurementsTable: await fetchDeviceMeasurements(
        config,
        fields /*, timeStart*/
      ),
    }
  } catch (e) {
    // todo: escalation
    console.error(e)
  }
}

const useHybridSource = (
  fields: string[],
  realtime: boolean,
  refreshToken: number,
  dataCallback: (data: DiagramEntryPoint[]) => void
) => {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])

  const realtimeCallback = useCallback((pts: Point[]) => {
    const newData: DiagramEntryPoint[] = []

    for (const p of pts) {
      const pointFields = p.fields
      const time = Math.floor(+p.timestamp / 10 ** 6)

      for (const key in pointFields) {
        const value = pointFields[key] as number

        for (const keep of fields) {
          if (keep !== key) continue
          newData.push({key, time, value})
          break
        }
      }
    }

    dataCallback(newData)
  }, [])

  useRealtimeData(subscriptions, realtimeCallback)

  useEffect(() => {
    if (realtime)
      // TODO: if point has multiple selected fields, then it will duplicate data (add to broker field filtering feature)
      setSubscriptions(
        fields.map((field) => ({
          measurement: 'css',
          tags: [`_field=${field}`],
        }))
      )
    else if (subscriptions.length) setSubscriptions([])
  }, [fields, realtime])

  useEffect(() => {
    ;(async () => {
      if (!realtime) {
        const data = (await fetchInfluxData(fields))?.measurementsTable
        if (!data) return
        const length = data.length
        const fieldCol = data.getColumn('_field', 'string')
        const valueCol = data.getColumn('_value', 'number')
        const timeCol =
          data.getColumn('_time', 'number') ||
          data.getColumn('_start', 'number') ||
          data.getColumn('_stop', 'number')

        const newData: DiagramEntryPoint[] = Array(length)

        if (!fieldCol || !valueCol || !timeCol) return

        for (let i = length; i--; ) {
          const key = fieldCol[i]
          const value = valueCol[i]
          const time = timeCol[i]

          newData[i] = {key, time, value}
        }

        dataCallback(newData)
      }
    })()
  }, [refreshToken, realtime, fields])
}

const Cell: React.FC<{
  title: string
  extra?: JSX.Element
  plotSettings:
    | Omit<LineOptions, 'data' | 'percent'>
    | Omit<GaugeOptions, 'data' | 'percent'>
    | undefined
  plotType: 'gauge' | 'line' | 'text'
  field: string
  isRealtime: boolean
}> = ({field, isRealtime, plotSettings, plotType, title, extra}) => {
  const plot = useG2Plot(plotType === 'line' ? Line : Gauge, plotSettings)
  const [fieldArr, setFieldArr] = useState([field])
  const [text, setText] = useState('')

  useEffect(() => {
    setFieldArr([field])
  }, [field])

  const lastEntryRef = useRef(0)

  useHybridSource(fieldArr, isRealtime, 0, (entries) => {
    if (plotType === 'text') {
      for (const e of entries)
        if (e.time > lastEntryRef.current) {
          lastEntryRef.current = e.time
          const hours = Math.floor(e.value)
          const minfloat = (e.value - hours) * 60
          const min = Math.floor(minfloat)
          const sec = Math.floor((minfloat - min) * 60)
          setText(`${hours}h ${min}m ${sec}s`)
        }
    } else if (plotType === 'gauge') {
      for (const e of entries)
        if (e.time > lastEntryRef.current) {
          lastEntryRef.current = e.time
          const {min, max} = {min: 0, max: 120}
          const percent = (e.value - min) / (max - min)
          plot.update(percent as any)
        }
    } else
      plot.update((d) =>
        pushBigArray(
          d,
          field === 'EngineCoolantTemperature'
            ? entries.map((x) => ({...x, value: x.value * 1000}))
            : entries
        )
      )
  })

  useEffect(() => {
    plot.update([])
  }, [isRealtime])

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        backgroundColor: 'white',
        padding: 16,
        paddingTop: 0,
      }}
    >
      <div>
        <div style={{height: 26, float: 'left'}}>{title}</div>
        <div style={{height: 26, float: 'right'}}>{extra}</div>
        <div style={{content: '', display: 'block', clear: 'both'}}></div>
      </div>
      <div style={{paddingTop: 8}}>
        {plotType === 'text' ? (
          <div
            style={{
              textAlign: 'center',
              fontSize: '2em',
              position: 'absolute',
              top: '50%',
              transform: 'translateY(-50%)',
              width: 'calc(100% - 32px)',
            }}
          >
            {text}
          </div>
        ) : (
          plot.element
        )}
      </div>
    </div>
  )
}

const optsLines1: Omit<LineOptions, 'data' | 'percent'> = {
  height: 130,
  width: 500,
  legend: false,
}

const optsLine2: Omit<LineOptions, 'data' | 'percent'> = {
  height: 420,
  width: 500,
  legend: false,
}

const optsLine3: Omit<LineOptions, 'data' | 'percent'> = {
  height: 230,
  width: 500,
  legend: false,
}

const optsGauges: Omit<GaugeOptions, 'data' | 'percent'> = {
  height: 230,
  width: 500,
  range: {
    ticks: [0, 0.1, 0.6, 0.85, 1],
    color: ['#545667', '#4ED8A0', '#FFD255', '#DC4E58'],
  },
  axis: {
    label: {
      formatter: (v) => +v * 120,
    },
  },
  statistic: {
    content: {
      formatter: (x) => (x ? `${(+x.percent * 120).toFixed(0)}${'°C'}` : ''),
    },
  },
}

const RealTimePage: FunctionComponent = () => {
  const [isRealtime, setIsRealtime] = useState(true)

  return (
    <PageContent
      title="Realtime Demo"
      titleExtra={
        <Switch checked={isRealtime} onChange={(v) => setIsRealtime(v)} />
      }
    >
      <GridFixed cols={12} rowHeight={85} isResizable={true}>
        <div key="cell01" data-grid={{x: 0, y: 0, w: 3, h: 2}}>
          <Cell
            title={'Engine speed'}
            field={'EngineSpeed'}
            isRealtime={isRealtime}
            plotType={'line'}
            plotSettings={optsLines1}
          />
        </div>
        <div key="cell02" data-grid={{x: 0, y: 2, w: 3, h: 2}}>
          <Cell
            title={'Engine Fuel Rate'}
            field={'EngineFuelRate'}
            isRealtime={isRealtime}
            plotType={'line'}
            plotSettings={optsLines1}
          ></Cell>
        </div>
        <div key="cell03" data-grid={{x: 0, y: 4, w: 3, h: 2}}>
          <Cell
            title={'Vehicle Speed'}
            field={'WheelBasedVehicleSpeed'}
            isRealtime={isRealtime}
            plotType={'line'}
            plotSettings={optsLines1}
          />
        </div>
        <div key="cell04" data-grid={{x: 0, y: 6, w: 3, h: 2}}>
          <Cell
            title={'Brake Pressure'}
            field={'BrakePrimaryPressure'}
            isRealtime={isRealtime}
            plotType={'line'}
            plotSettings={optsLines1}
          />
        </div>

        <div key="cell10" data-grid={{x: 3, y: 0, w: 2, h: 3}}>
          <Cell
            title={'Oil Temperature'}
            field={'EngineOilTemperature1'}
            isRealtime={isRealtime}
            plotType={'gauge'}
            plotSettings={optsGauges}
          />
        </div>
        <div key="cell11" data-grid={{x: 3, y: 3, w: 2, h: 3}}>
          <Cell
            title={'Fuel Temperature'}
            field={'EngineFuel1Temperature1'}
            isRealtime={isRealtime}
            plotType={'gauge'}
            plotSettings={optsGauges}
          />
        </div>
        <div key="cell12" data-grid={{x: 3, y: 6, w: 2, h: 2}}>
          <Cell
            title={'Engine Total Hours'}
            field={'EngineTotalHoursofOperation'}
            isRealtime={isRealtime}
            plotType={'text'}
            plotSettings={optsLines1}
          />
        </div>

        <div key="cell20" data-grid={{x: 5, y: 0, w: 7, h: 5}}>
          <Cell
            title={'Intake Air Pressure vs Oil Pressure'}
            field={'EngineIntakeAirPressure' /* EngineOilPressure1 */}
            isRealtime={isRealtime}
            plotType={'line'}
            plotSettings={optsLine2}
          />
        </div>
        <div key="cell21" data-grid={{x: 5, y: 5, w: 7, h: 3}}>
          <Cell
            title={'Coolant and engine temperature'}
            field={'EngineCoolantTemperature' /* EngineExhaustTemperature */}
            isRealtime={isRealtime}
            plotType={'line'}
            plotSettings={optsLine3}
          />
        </div>
      </GridFixed>
    </PageContent>
  )
}

export default RealTimePage

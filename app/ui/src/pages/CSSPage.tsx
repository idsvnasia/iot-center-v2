import React, {
  useRef,
  useCallback,
  FunctionComponent,
  useEffect,
  useState,
} from 'react'
import {Switch} from 'antd'
import {GaugeOptions, LineOptions, Gauge, Area} from '@antv/g2plot'
import {Table as GiraffeTable} from '@influxdata/giraffe'
import {
  flux,
  fluxDuration,
  InfluxDB,
  fluxExpression,
  fluxString,
} from '@influxdata/influxdb-client'
import {
  DiagramEntryPoint,
  G2PlotOptionsNoData,
  MinAndMax,
  pushBigArray,
  useG2Plot,
  useLastDiagramEntryPointGetter,
  useWebSocket,
} from '../util/realtimeUtils'
import PageContent from './PageContent'
import GridFixed from '../util/GridFixed'
import {queryTable} from '../util/queryTable'
import {VIRTUAL_DEVICE} from '../App'

const host =
  process.env.NODE_ENV === `development`
    ? window.location.hostname + ':5000'
    : window.location.host
const wsAddress = `ws://${host}/mqtt`

/** data returned by realtime broker */
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

/** subscribes to realtime broker via ws */
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

interface DeviceConfig {
  influx_url: string
  influx_org: string
  influx_token: string
  influx_bucket: string
  id: string
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

const fetchCssInfluxDataTable = async (
  fields: string[]
): Promise<GiraffeTable | undefined> => {
  const _fetchCssDeviceMeasurements = async (
    config: DeviceConfig,
    fields: string[],
    timeStart = '-1h'
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
    )
    return result
  }

  try {
    const config = await fetchDeviceConfig(VIRTUAL_DEVICE)
    return await _fetchCssDeviceMeasurements(config, fields /*, timeStart*/)
  } catch (e) {
    console.error(e)
  }
}

//#region transformations

const pointsToDiagramEntryPoints = (fields: string[], pts: Point[]) => {
  const data: DiagramEntryPoint[] = []

  for (const p of pts) {
    const pointFields = p.fields
    const time = Math.floor(+p.timestamp / 10 ** 6)

    for (const key in pointFields) {
      const value = pointFields[key] as number

      for (const keep of fields) {
        if (keep !== key) continue
        data.push({key, time, value})
        break
      }
    }
  }

  return data
}

const giraffeTableToDiagramEntryPoints = (table: GiraffeTable | undefined) => {
  if (!table) return
  const length = table.length
  const fieldCol = table.getColumn('_field', 'string')
  const valueCol = table.getColumn('_value', 'number')
  const timeCol =
    table.getColumn('_time', 'number') ||
    table.getColumn('_start', 'number') ||
    table.getColumn('_stop', 'number')
  if (!fieldCol || !valueCol || !timeCol) return

  const data: DiagramEntryPoint[] = Array(length)

  for (let i = length; i--; ) {
    const key = fieldCol[i]
    const value = valueCol[i]
    const time = timeCol[i]
    data[i] = {key, time, value}
  }

  return data
}

//#endregion transformations

const useHybridSource = (
  fields: string[],
  realtime: boolean,
  refreshToken: number,
  dataCallback: (data: DiagramEntryPoint[]) => void
) => {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])

  const realtimeCallback = useCallback(
    (pts: Point[]) => {
      const newData = pointsToDiagramEntryPoints(fields, pts)
      dataCallback(newData)
    },
    [fields, dataCallback]
  )

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
        const table = await fetchCssInfluxDataTable(fields)
        const data = giraffeTableToDiagramEntryPoints(table)
        if (data) dataCallback(data)
      }
    })()
  }, [fields, realtime, refreshToken])
}

/** return previous array when content of new array is identical */
const useArray = <T,>(arr: T[] | T) => {
  const [arrPrev, setArrPrev] = useState<T[]>([])

  useEffect(() => {
    const newArr = Array.isArray(arr) ? arr : [arr]
    if (
      newArr.length !== arrPrev.length ||
      newArr.some((x, i) => x !== arrPrev[i])
    )
      setArrPrev(newArr)
  }, [arr])

  return arrPrev
}

const hoursToTimeString = (time: number) => {
  const hours = Math.floor(time)
  const minfloat = (time - hours) * 60
  const min = Math.floor(minfloat)
  const sec = Math.floor((minfloat - min) * 60)
  return `${hours}h ${min
    .toString()
    .padStart(2, ' ')}m ${sec.toString().padStart(2, ' ')}s`
}

const Cell: React.FC<{
  title: string
  extra?: JSX.Element
  plotSettings:
    | Omit<LineOptions, 'data' | 'percent'>
    | Omit<GaugeOptions, 'data' | 'percent'>
    | undefined
  plotType: 'gauge' | 'line' | 'text'
  fields: string | string[]
  isRealtime: boolean
  dataMapping?: MinAndMax
}> = ({
  fields: _fields,
  dataMapping,
  isRealtime,
  plotSettings,
  plotType,
  title,
  extra,
}) => {
  const plot = useG2Plot(
    plotType === 'line' ? Area : Gauge,
    plotSettings,
    isRealtime ? 10_000 : Infinity
  )
  const fields = useArray(_fields)
  const [text, setText] = useState('')

  const getLastPoint = useLastDiagramEntryPointGetter()

  useEffect(() => {
    plot.update(undefined)
  }, [isRealtime])

  useHybridSource(fields, isRealtime, 0, (_entries) => {
    const {min, max} = dataMapping ? dataMapping : {min: 0, max: 1}
    const entries = _entries.map((x) => ({
      ...x,
      value: (x.value - min) / (max - min),
    }))

    if (plotType === 'text') {
      const lastEntry = getLastPoint(entries)
      if (!lastEntry) return
      setText(hoursToTimeString(lastEntry.value))
    } else plot.update(entries)
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
              ...(plotSettings as any),
              height: undefined,
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

/** position used by react-grid-layout */
type GridPosition = {x: number; y: number; w: number; h: number}
type CellOptions = {
  pos: GridPosition
  title: string
  fields: string | string[]
  dataMapping?: MinAndMax
} & (
  | {
      plotType: 'line'
      plotOptions?: G2PlotOptionsNoData<LineOptions>
    }
  | {
      plotType: 'gauge'
      plotOptions?: G2PlotOptionsNoData<LineOptions>
    }
  | {
      plotType: 'text'
      plotOptions?: Partial<HTMLDivElement['style']>
    }
)

const optsGaugesTemperature: Omit<GaugeOptions, 'data' | 'percent'> = {
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

const CELLS: CellOptions[] = [
  // 1st column
  {
    pos: {x: 0, y: 0, w: 3, h: 2},
    title: 'Engine speed',
    fields: 'EngineSpeed',
    plotType: 'line',
    plotOptions: {
      legend: false,
      color: '#2EB2E4',
    },
  },
  {
    pos: {x: 0, y: 2, w: 3, h: 2},
    title: 'Engine Fuel Rate',
    fields: 'EngineFuelRate',
    plotType: 'line',
    plotOptions: {
      legend: false,
      color: '#32B252',
    },
  },
  {
    pos: {x: 0, y: 4, w: 3, h: 2},
    title: 'Vehicle Speed',
    fields: 'WheelBasedVehicleSpeed',
    plotType: 'line',
    plotOptions: {
      legend: false,
      color: '#FACE54',
    },
  },
  {
    pos: {x: 0, y: 6, w: 3, h: 2},
    title: 'Brake Pressure',
    fields: 'BrakePrimaryPressure',
    plotType: 'line',
    plotOptions: {
      legend: false,
      color: '#BE2EE3',
    },
  },
  // 2nd column
  {
    pos: {x: 3, y: 0, w: 2, h: 3},
    title: 'Oil Temperature',
    fields: 'EngineOilTemperature1',
    plotType: 'gauge',
    plotOptions: optsGaugesTemperature,
    dataMapping: {min: 0, max: 120},
  },
  {
    pos: {x: 3, y: 3, w: 2, h: 3},
    title: 'Fuel Temperature',
    fields: 'EngineFuel1Temperature1',
    plotType: 'gauge',
    plotOptions: optsGaugesTemperature,
    dataMapping: {min: 0, max: 120},
  },
  {
    pos: {x: 3, y: 6, w: 2, h: 2},
    title: 'Engine Total Hours',
    fields: 'EngineTotalHoursofOperation',
    plotType: 'text',
    plotOptions: {
      color: '#0daed9',
    },
  },
  // 3rd column
  {
    pos: {x: 5, y: 0, w: 7, h: 5},
    title: 'Intake Air Pressure vs Oil Pressure',
    fields: ['EngineIntakeAirPressure', 'EngineOilPressure1'],
    plotType: 'line',
    plotOptions: {
      legend: false,
      color: ['#D1A244', '#0AB7AD'],
      isStack: false,
    },
  },
  {
    pos: {x: 5, y: 5, w: 7, h: 3},
    title: 'Coolant and engine temperature',
    fields: ['EngineCoolantTemperature', 'EngineExhaustTemperature'],
    plotType: 'line',
    plotOptions: {
      legend: false,
      color: ['#32C0F8', '#9D06A0'],
      isStack: false,
    },
  },
]

const RealTimePage: FunctionComponent = () => {
  const [isRealtime, setIsRealtime] = useState(true)

  return (
    <PageContent
      title="Realtime Demo"
      titleExtra={
        <Switch
          checked={isRealtime}
          onChange={(v) => setIsRealtime(v)}
          checkedChildren={'Realtime'}
          unCheckedChildren={'Historical'}
        />
      }
    >
      <GridFixed cols={12} rowHeight={85} isResizable={true}>
        {CELLS.map(
          ({fields, plotType, pos, title, plotOptions, dataMapping}, i) => (
            <div key={i} data-grid={pos}>
              <Cell
                {...{title, fields, plotType, dataMapping, isRealtime}}
                plotSettings={{
                  height: pos.h * 85 - 16 * 2,
                  ...(plotOptions as any),
                }}
              />
            </div>
          )
        )}
      </GridFixed>
    </PageContent>
  )
}

export default RealTimePage

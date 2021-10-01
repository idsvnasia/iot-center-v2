import {Button, Card, Select, Tooltip} from 'antd'
import {Line, Gauge, GaugeOptions} from '@antv/g2plot'
import React, {FunctionComponent, useEffect, useState} from 'react'
import PageContent, {Message} from './PageContent'
import {useRef} from 'react'
import {useCallback} from 'react'
import {
  DiagramEntryPoint,
  G2Plot,
  G2PlotUpdater,
  useG2Plot,
  useWebSocket,
} from '../util/realtimeUtils'
import GridFixed from '../util/GridFixed'
import {VIRTUAL_DEVICE} from '../App'
import {RouteComponentProps} from 'react-router-dom'
import {DeviceInfo} from './DevicesPage'
import {IconRefresh, IconSettings} from '../styles/icons'
import {Table as GiraffeTable} from '@influxdata/giraffe'
import {flux, fluxDuration, InfluxDB} from '@influxdata/influxdb-client'
import {queryTable} from '../util/queryTable'

interface DeviceConfig {
  influx_url: string
  influx_org: string
  influx_token: string
  influx_bucket: string
  id: string
}

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
  timeStart = '-30d'
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
  import "influxdata/influxdb/v1"    
  from(bucket: ${bucket})
    |> range(start: ${fluxDuration(timeStart)})
    |> filter(fn: (r) => r._measurement == "environment")
    |> filter(fn: (r) => r["_field"] == "Temperature" or r["_field"] == "TVOC" or r["_field"] == "Pressure" or r["_field"] == "Humidity" or r["_field"] == "CO2")
    |> filter(fn: (r) => r.clientId == ${id})
    |> v1.fieldsAsCols()`
  )
  return result
}

/** transformation for pivoted giraffe table */
const giraffeTableToDiagramEntryPoints = (
  table: GiraffeTable | undefined,
  tags: string[]
) => {
  if (!table) return
  const length = table.length
  const timeCol =
    table.getColumn('_time', 'number') ||
    table.getColumn('_start', 'number') ||
    table.getColumn('_stop', 'number')
  if (!timeCol) return

  const data: DiagramEntryPoint[] = Array(length * tags.length)

  for (let j = tags.length; j--; ) {
    const key = tags[j]
    const valueCol = table.getColumn(key, 'number')!
    for (let i = length; i--; ) {
      const value = valueCol[i]
      const time = timeCol[i]
      data[i + j * length] = {key, time, value}
    }
  }

  return data
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
const fields = Object.keys(gaugesOptions)

interface PropsRoute {
  deviceId?: string
}

const RealTimePage: FunctionComponent<RouteComponentProps<PropsRoute>> = ({
  match,
  history,
}) => {
  // realtime
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const gaugeUpdatesRef = useRef<Record<string, G2PlotUpdater<Gauge>>>({})
  const [dataStamp, setDataStamp] = useState(0)
  const [loading, setLoading] = useState(false)

  //#region device selection

  const deviceId = match.params.deviceId ?? VIRTUAL_DEVICE
  const [devices, setDevices] = useState<DeviceInfo[] | undefined>(undefined)

  useEffect(() => {
    const fetchDevices = async () => {
      try {
        const response = await fetch('/api/devices')
        if (response.status >= 300) {
          const text = await response.text()
          throw new Error(`${response.status} ${text}`)
        }
        const data = await response.json()
        setDevices(data)
      } catch (e) {
        console.error(e)
      }
    }

    fetchDevices()
  }, [])

  const chooseDeviceElement = (
    <Tooltip title="Choose device" placement="left">
      <Select
        showSearch
        value={deviceId}
        placeholder={'select device to show'}
        showArrow={true}
        filterOption={true}
        onChange={(key) => history.push(`/realtime/${key}`)}
        style={{minWidth: 200, width: 350, marginRight: 10}}
        loading={!devices}
        disabled={!devices}
      >
        {devices &&
          devices.map(({deviceId}) => (
            <Select.Option key={deviceId} value={deviceId}>
              {deviceId}
            </Select.Option>
          ))}
      </Select>
    </Tooltip>
  )

  //#endregion device selection

  //#region time selection

  const timeOptionsRealtime = ['-10s', '-30s', '-1m']
  // todo: better way
  const timeOptionsRealtimeTime = [10_000, 30_000, 60_000]

  const timeOptionsPast = [
    '-5m',
    '-15m',
    '-1h',
    '-6h',
    '-1d',
    '-3d',
    '-7d',
    '-30d',
  ]

  const [timeStart, setTimeStart] = useState(timeOptionsRealtime[0])

  const isRealtime = timeOptionsRealtime.some((x) => x === timeStart)

  const chooseTimeElement = (
    <Tooltip title="Choose time" placement="left">
      <Select
        value={timeStart}
        onChange={setTimeStart}
        style={{minWidth: 100}}
        loading={loading}
        disabled={loading}
      >
        {timeOptionsRealtime.map((value) => (
          <Select.Option key={value} value={value}>
            {`Now ${value.substr(1)}`}
          </Select.Option>
        ))}
        {timeOptionsPast.map((value) => (
          <Select.Option key={value} value={value}>
            {`Past ${value.substr(1)}`}
          </Select.Option>
        ))}
      </Select>
    </Tooltip>
  )

  //#endregion time selection

  useEffect(() => {
    setSubscriptions(
      isRealtime
        ? [{measurement: 'environment', tags: [`clientId=${deviceId}`]}]
        : []
    )
  }, [deviceId, isRealtime])

  const clearData = () => {
    plot.update(undefined)
    for (const measurement of fields) {
      gaugeUpdatesRef.current[measurement]?.(0)
    }
  }
  useEffect(clearData, [deviceId, isRealtime, dataStamp])

  const updateData = (data: DiagramEntryPoint[]) => {
    plot.update(data)

    for (const measurement of fields) {
      const {min, max} = gaugesOptions[measurement]
      const gaugeData = data
        .filter(({key}) => key === measurement)
        .map((x) => ({...x, value: (x.value - min) / (max - min)}))
      gaugeUpdatesRef.current[measurement]?.(gaugeData)
    }
  }

  // fetch device configuration and data
  useEffect(() => {
    const fetchData = async () => {
      clearData()
      setLoading(true)
      try {
        const config = await fetchDeviceConfig(deviceId)
        const table = await fetchDeviceMeasurements(config, timeStart)
        const data = giraffeTableToDiagramEntryPoints(table, fields)
        if (data) updateData(data)
      } catch (e) {
        console.error(e)
      }
      setLoading(false)
    }

    if (!isRealtime) fetchData()
  }, [dataStamp, deviceId, timeStart])

  const pageControls = (
    <>
      {chooseDeviceElement}
      {chooseTimeElement}

      <Tooltip title="Reload Device Data">
        <Button
          disabled={loading || isRealtime}
          loading={loading}
          onClick={() => setDataStamp(dataStamp + 1)}
          style={{marginLeft: 10}}
          icon={<IconRefresh />}
        />
      </Tooltip>

      <Tooltip title="Go to device settings" placement="topRight">
        <Button
          type="primary"
          icon={<IconSettings />}
          style={{marginLeft: 10}}
          href={`/devices/${deviceId}`}
        ></Button>
      </Tooltip>
    </>
  )

  const [lineOptions /*, setLineOptions */] = useState({
    height: 300,
  })

  const retentionTime = isRealtime
    ? timeOptionsRealtimeTime[
        timeOptionsRealtime.findIndex((x) => x === timeStart)
      ]
    : Infinity

  const plot = useG2Plot(Line, lineOptions, retentionTime)

  const updatePoints = useCallback(
    (points: Point[]) => {
      const newData: DiagramEntryPoint[] = []

      for (const p of points) {
        const fields = p.fields
        const time = Math.floor(+p.timestamp / 10 ** 6)

        for (const key in fields) {
          const value = fields[key] as number
          newData.push({key, time, value})
        }
      }

      updateData(newData)
    },
    [plot, updateData]
  )

  useRealtimeData(subscriptions, updatePoints)

  return (
    <PageContent title="Realtime Demo" titleExtra={pageControls}>
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

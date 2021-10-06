import {Button, Card, Select, Tooltip} from 'antd'
import {Line, Gauge, GaugeOptions, LineOptions, Area} from '@antv/g2plot'
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
import {Row, Col, Collapse, Empty, Divider} from 'antd'
import {
  Plot,
  timeFormatter,
  GAUGE_THEME_LIGHT,
  GaugeLayerConfig,
  LineLayerConfig,
} from '@influxdata/giraffe'
import {InfoCircleFilled} from '@ant-design/icons'
import CollapsePanel from 'antd/lib/collapse/CollapsePanel'
import {getXDomainFromTable} from '../util/tableUtils'
import {colorLink, colorPrimary, colorText} from '../styles/colors'

// TODO: unify naming - column/field etc.

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

// fetchDeviceDataFieldLast replaced by taking data from fetchDeviceMeasurements

// we replaced giraffe with non-react library to handle faster rerendering

type MeasurementDefinition = {
  min: number
  max: number
  unit: string
  decimalPlaces?: number
}

const measurementsDefinitions: Record<string, MeasurementDefinition> = {
  Temperature: {
    min: -10,
    max: 50,
    unit: '°C',
  },
  Humidity: {
    min: 0,
    max: 100,
    unit: '%',
  },
  Pressure: {
    min: 800,
    max: 1100,
    unit: ' hPa',
    decimalPlaces: 0,
  },
  CO2: {
    min: 300,
    max: 3500,
    unit: ' ppm',
    decimalPlaces: 0,
  },
  TVOC: {
    min: 200,
    max: 2200,
    unit: '',
    decimalPlaces: 0,
  },
}
const fields = Object.keys(measurementsDefinitions)

// TODO: implement decimal places logic
// todo: styling
const gaugesPlotOptions: Record<
  string,
  Omit<GaugeOptions, 'percent'>
> = Object.fromEntries(
  Object.entries(measurementsDefinitions).map(
    ([measurement, {max, min, unit}]) => [
      measurement,
      {
        range: {
          ticks: [0, 1],
          color: [`l(0) 0:${colorPrimary} 1:${colorLink}`],
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
        height: 150,
      },
    ]
  )
)

const linePlotOptions: Record<
  string,
  Omit<LineOptions, 'data'>
> = Object.fromEntries(
  Object.entries(measurementsDefinitions).map(([measurement, {}]) => [
    measurement,
    {
      height: 150,
    },
  ])
)

// #region Realtime

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

const host =
  process.env.NODE_ENV === `development`
    ? window.location.hostname + ':5000'
    : window.location.host
const wsAddress = `ws://${host}/mqtt`

const milisTimeLength = Date.now().toString().length

const pointTimeToMillis = (p: Point): Point => ({
  ...p,
  timestamp: p.timestamp
    .substr(0, milisTimeLength)
    .padEnd(milisTimeLength, '0'),
})

const useRealtimeData = (
  subscriptions: Subscription[],
  onReceivePoints: (pts: Point[]) => void
) => {
  const wsInit = useCallback<(ws: WebSocket) => void>(
    (ws) => {
      ws.onopen = () => ws.send('subscribe:' + JSON.stringify(subscriptions))
      ws.onmessage = (response) =>
        onReceivePoints(
          (JSON.parse(response.data) as Point[]).map(pointTimeToMillis)
        )
    },
    [subscriptions, onReceivePoints]
  )
  useWebSocket(wsInit, wsAddress)
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

// #endregion Realtime

interface PropsRoute {
  deviceId?: string
}

interface Props {
  helpCollapsed: boolean
}

const RealTimePage: FunctionComponent<
  RouteComponentProps<PropsRoute> & Props
> = ({match, history, helpCollapsed}) => {
  const deviceId = match.params.deviceId ?? VIRTUAL_DEVICE
  // loading is defaultly false
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<Message | undefined>()
  const [deviceData, setDeviceData] = useState<DeviceData | undefined>()
  const [dataStamp, setDataStamp] = useState(0)
  const [devices, setDevices] = useState<DeviceInfo[] | undefined>(undefined)
  const [timeStart, setTimeStart] = useState('-10s')

  const hasDataFieldsRef = useRef<Record<string, boolean>>({})
  const isVirtualDevice = deviceId === VIRTUAL_DEVICE
  const measurementsTable = deviceData?.measurementsTable

  // #region realtime

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  type Updaters<T> = Record<string, G2PlotUpdater<T>>
  const updatersGaugeRef = useRef<Updaters<Gauge>>({})
  const updatersLineRef = useRef<Updaters<Line>>({})

  const timeOptionsRealtime: {
    label: string
    value: string
    realtimeRetention: number
  }[] = [
    {label: 'Live 10s', value: '-10s', realtimeRetention: 10_000},
    {label: 'Live 30s', value: '-30s', realtimeRetention: 30_000},
    {label: 'Live 1m', value: '-1m', realtimeRetention: 60_000},
  ]

  const isRealtime = timeOptionsRealtime.some((x) => x.value === timeStart)

  const retentionTime = isRealtime
    ? timeOptionsRealtime[
        timeOptionsRealtime.findIndex((x) => x.value === timeStart)
      ].realtimeRetention
    : Infinity

  useEffect(() => {
    setSubscriptions(
      isRealtime
        ? [{measurement: 'environment', tags: [`clientId=${deviceId}`]}]
        : []
    )
  }, [deviceId, isRealtime])

  const updateData = (data: DiagramEntryPoint[] | undefined) => {
    if (data === undefined) return

    // register data received
    const hasData = hasDataFieldsRef.current
    fields
      .filter((x) => !hasData[x])
      .filter((x) => data.some((p) => x === p.key))
      .forEach((x) => (hasData[x] = true))

    for (const field of fields) {
      const lineData = data.filter(({key}) => key === field)

      const {min, max} = measurementsDefinitions[field]
      const gaugeData = lineData.map((x) => ({
        ...x,
        value: (x.value - min) / (max - min),
      }))

      updatersLineRef.current[field]?.(lineData)
      updatersGaugeRef.current[field]?.(gaugeData)
    }
  }

  const updatePoints = (points: Point[]) => {
    const newData: DiagramEntryPoint[] = []

    for (const p of points) {
      const fields = p.fields
      const time = Math.floor(+p.timestamp)

      for (const key in fields) {
        const value = fields[key] as number
        newData.push({key, time, value})
      }
    }

    updateData(newData)
  }

  useRealtimeData(subscriptions, useRef(updatePoints).current)

  const clearData = () => {
    hasDataFieldsRef.current = {}
    for (const measurement of fields) {
      updatersGaugeRef.current[measurement]?.(0)
      updatersLineRef.current[measurement]?.(undefined)
    }
  }
  useEffect(clearData, [deviceId, timeStart, dataStamp])

  // TODO: on deviceData change clear data and set newOne

  useEffect(() => {
    clearData()
    updateData(giraffeTableToDiagramEntryPoints(measurementsTable, fields))
  }, [deviceData])

  // #endregion realtime

  // fetch device configuration and data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const config = await fetchDeviceConfig(deviceId)
        const deviceData: DeviceData = {config}
        const [table] = await Promise.all([
          fetchDeviceMeasurements(config, timeStart),
        ])
        deviceData.measurementsTable = table
        setDeviceData(deviceData)
      } catch (e) {
        console.error(e)
        setMessage({
          title: 'Cannot load device data',
          description: String(e),
          type: 'error',
        })
      }
      setLoading(false)
    }

    // fetch data only if not in realtime mode
    if (!isRealtime) fetchData()
  }, [dataStamp, deviceId, timeStart])

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
        setMessage({
          title: 'Cannot fetch data',
          description: String(e),
          type: 'error',
        })
      }
    }

    fetchDevices()
  }, [])

  // todo: implement
  const renderGauge = (
    column: string,
    gauge: Omit<GaugeOptions, 'percent'>
  ) => (
    <G2Plot
      type={Gauge}
      onUpdaterChange={(updater) =>
        (updatersGaugeRef.current[column] = updater)
      }
      options={gauge}
    />
  )

  // todo: implement
  const gaugeLastTimeMessage = (time: number) => {
    const now = Date.now()
    const diff = now - time

    if (diff < 60_000) return 'just now'
    if (diff < 300_000) return 'less than 5 min ago'
    if (diff < 900_000) return 'more than 5 min ago'
    return 'long time ago'
  }

  // todo: implement
  const gauges =
    deviceData?.measurementsTable?.length || isRealtime ? (
      <>
        <Row gutter={[22, 22]}>
          {Object.entries(gaugesPlotOptions).map(([column, gauge]) => {
            return (
              <Col
                sm={helpCollapsed ? 24 : 24}
                md={helpCollapsed ? 12 : 24}
                xl={helpCollapsed ? 6 : 12}
              >
                <Card title={column}>{renderGauge(column, gauge)}</Card>
              </Col>
            )
          })}
        </Row>
        <Divider style={{color: 'rgba(0, 0, 0, .2)'}} orientation="right">
          {/* 
          {gaugeMissingValues.length
            ? `Gauge missing values: ${gaugeMissingValues.join(', ')}`
            : undefined} 
            */}
        </Divider>
      </>
    ) : undefined

  // todo: implement
  const renderPlot = (column: string, line: Omit<LineOptions, 'data'>) => (
    <G2Plot
      type={Area}
      onUpdaterChange={(updater) => (updatersLineRef.current[column] = updater)}
      options={line}
      retentionTimeMs={retentionTime}
    />
  )

  // todo: implement
  const plots =
    (measurementsTable && measurementsTable?.length) || isRealtime
      ? (() => {
          return (
            <>
              <Row gutter={[0, 24]}>
                {Object.entries(linePlotOptions).map(([column, line], i) => (
                  <Col xs={24}>
                    <Collapse defaultActiveKey={[i]}>
                      <CollapsePanel key={i} header={column}>
                        {renderPlot(column, line)}
                      </CollapsePanel>
                    </Collapse>
                  </Col>
                ))}
              </Row>
              {/* {measurementsNoValues.length ? (
            <Collapse>
              {measurementsNoValues.map(({title}, i) => (
                <CollapsePanel
                  key={i}
                  disabled={true}
                  header={`${title} - No data`}
                />
              ))}
            </Collapse>
          ) : undefined} */}
            </>
          )
        })()
      : undefined

  const timeOptions: {label: string; value: string}[] = [
    {label: 'Past 5m', value: '-5m'},
    {label: 'Past 15m', value: '-15m'},
    {label: 'Past 1h', value: '-1h'},
    {label: 'Past 6h', value: '-6h'},
    {label: 'Past 1d', value: '-1d'},
    {label: 'Past 3d', value: '-3d'},
    {label: 'Past 7d', value: '-7d'},
    {label: 'Past 30d', value: '-30d'},
  ]

  const pageControls = (
    <>
      <Tooltip title="Choose device" placement="left">
        <Select
          showSearch
          value={deviceId}
          placeholder={'select device to show'}
          showArrow={true}
          filterOption={true}
          // goes to realtime page (instead of dashboard)
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

      <Tooltip title="Choose time" placement="left">
        <Select
          value={timeStart}
          onChange={setTimeStart}
          style={{minWidth: 100}}
          loading={loading}
          disabled={loading}
        >
          {[...timeOptionsRealtime, ...timeOptions].map(({label, value}) => (
            <Select.Option key={value} value={value}>
              {label}
            </Select.Option>
          ))}
        </Select>
      </Tooltip>

      <Tooltip title="Reload Device Data">
        <Button
          // disable refresh when in realtime mode
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

  return (
    <PageContent
      title={
        <>
          Realtime Dashboard
          {isVirtualDevice ? (
            <Tooltip title="This page writes temperature measurements for the last 7 days from an emulated device, the temperature is reported every minute.">
              <InfoCircleFilled style={{fontSize: '1em', marginLeft: 5}} />
            </Tooltip>
          ) : undefined}
        </>
      }
      titleExtra={pageControls}
      message={message}
      spin={loading}
      forceShowScroll={true}
    >
      {deviceData?.measurementsTable?.length || isRealtime ? (
        <>
          {gauges}
          {plots}
        </>
      ) : (
        <Card>
          <Empty />
        </Card>
      )}
    </PageContent>
  )
}

export default RealTimePage

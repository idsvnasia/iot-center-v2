import {Button, Card, Select, Tooltip} from 'antd'
import {Line, Gauge, GaugeOptions, LineOptions, Datum} from '@antv/g2plot'
import React, {FunctionComponent, useEffect, useState} from 'react'
import PageContent, {Message} from './PageContent'
import {useRef} from 'react'
import {useCallback} from 'react'
import {
  DiagramEntryPoint,
  G2Plot,
  G2PlotUpdater,
  TimePoint,
  useMap,
  useWebSocket,
} from '../util/realtime'
import {VIRTUAL_DEVICE} from '../App'
import {RouteComponentProps} from 'react-router-dom'
import {DeviceInfo} from './DevicesPage'
import {IconRefresh, IconSettings} from '../styles/icons'
import {Table as GiraffeTable} from '@influxdata/giraffe'
import {flux, fluxDuration, InfluxDB} from '@influxdata/influxdb-client'
import {queryTable} from '../util/queryTable'
import {Row, Col, Collapse, Empty, Divider} from 'antd'
import {InfoCircleFilled} from '@ant-design/icons'
import CollapsePanel from 'antd/lib/collapse/CollapsePanel'
import {colorLink, colorPrimary} from '../styles/colors'
import {DataManager} from '../util/realtime/managed'

//TODO: file upload JSON definition of dashboardu with JSON schema for validation
//TODO: svg upload with escape for script for secure usage
//TODO: show received keys not used in dashboard
/*
  import "influxdata/influxdb/schema"

  schema.fieldKeys(
    // TODO: dynamic bucket
    bucket: "iot_center",
    predicate: (r) => r["_measurement"] == "environment",
    start: -30d
  )
*/

type DashboardCellLayout = [
  {
    /** position from left 0-11 */
    x: number
    /** position from top */
    y: number
    /** width - x coord */
    w: number
    /** height - y coord */
    h: number
  }
]

type DashboardCellType = 'svg' | 'plot'

type DashboardCellSvg = {
  type: 'svg'
  file: string
}

type DashboardCellPlotType = 'gauge' | 'line'

type DashboardCellPlotGauge = {
  type: 'plot'
  plotType: 'gauge'
  field: string
  label: string
  range: {
    min: number
    max: number
  }
  unit: string
  decimalPlaces: number
}

type DashboardCellPlotLine = {
  type: 'plot'
  plotType: 'line'
  field: string
  label: string
}

type DashboardCellPlot = DashboardCellPlotGauge | DashboardCellPlotLine

type DashboardCell = DashboardCellSvg | DashboardCellPlot

/*
  keep layout same when no data
  possible design:
  outer component:
    - device
    - time 
    - dashboard definition
    - svg upload
  inner component:
    - layout
    - plots

  onload outer component loads definition json and passes it into inner component

  demo schema:
  Temperature: {
    min: -10,
    max: 50,
    unit: '°C',
    decimalPlaces: 1,
  },
  Humidity: {
    min: 0,
    max: 100,
    unit: '%',
  },
  Pressure: {
    min: 800,
    max: 1100,
    unit: 'hPa',
  },
  CO2: {
    min: 300,
    max: 3500,
    unit: 'ppm',
  },
  TVOC: {
    min: 200,
    max: 2200,
    unit: '',
  },
*/

/*
 ********************************************
 * This page is adaptation of DashboardPage *
 ********************************************
 */

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
    |> filter(fn: (r) => r["_field"] == "Temperature" or r["_field"] == "TVOC" or r["_field"] == "Pressure" or r["_field"] == "Humidity" or r["_field"] == "CO2" or r["_field"] == "Lat" or r["_field"] == "Lon")
    |> filter(fn: (r) => r.clientId == ${id})
    |> v1.fieldsAsCols()`
  )
  return result
}

// fetchDeviceDataFieldLast replaced by taking data from fetchDeviceMeasurements

// we have replaced giraffe with non-react library to handle faster rerendering

/** gauges style based on mesurement definitions */
const gaugesPlotOptionsFor = ({
  decimalPlaces,
  range: {max, min},
  unit,
}: DashboardCellPlotGauge): Omit<GaugeOptions, 'percent'> => ({
  range: {
    ticks: [0, 1],
    color: `l(0) 0:${colorPrimary} 1:${colorLink}`,
    width: 15,
  },
  indicator: {
    pointer: {
      style: {stroke: 'gray'},
    },
    pin: {
      style: {stroke: 'gray'},
    },
  },
  axis: {
    position: 'bottom',
    label: {
      formatter: (v: string) => (+v * (max - min) + min).toFixed(0),
      offset: -30,
      style: {
        fontSize: 12,
        fontWeight: 900,
        fontFamily: 'Rubik',
        fill: '#55575E',
        shadowColor: 'white',
      },
    },
    tickLine: {
      // length: 10,
      style: {
        lineWidth: 3,
      },
    },
    subTickLine: {
      count: 9,
      // length: 10,
      style: {
        lineWidth: 1,
      },
    },
  },
  statistic: {
    content: {
      formatter: (x: Datum | undefined) =>
        x
          ? `${(+x.percent * (max - min) + min).toFixed(
              decimalPlaces ?? 0
            )}${unit}`
          : '',
      style: {},
      offsetY: 30,
    },
  },
  height: 150,
  padding: [0, 0, 10, 0],
  // renderer: "svg"
  // TODO: fix types
})

/** line plots style based on mesurement definitions */
const linePlotOptionsFor = ({}: DashboardCellPlotLine): Omit<
  LineOptions,
  'data'
> => ({
  height: 200,
  legend: false,
  lineStyle: {
    color: colorPrimary,
    lineWidth: 4,
  },
})

/** Returns list of keys present in data. */
const getFieldsOfData = (data: DiagramEntryPoint[]) => {
  const keysObj: Record<string, true> = {}
  for (let i = data.length; i--; ) {
    const entry = data[i]
    keysObj[entry.key] = true
  }
  return Object.getOwnPropertyNames(keysObj)
}

// #region Realtime

/** Data returned from websocket in line-protocol-like shape */
type RealtimePoint = {
  measurement: string
  tagPairs: string[]
  fields: Record<string, number | boolean | string>
  timestamp: string
}
type RealtimeSubscription = {
  /** influxdb measurement value */
  measurement: string
  /** tag format 'tagName=tagValue'. Point is sent to client when matches all tags. */
  tags: string[]
}

const host =
  process.env.NODE_ENV === `development`
    ? window.location.hostname + ':5000'
    : window.location.host
const wsAddress = `ws://${host}/mqtt`

/** length of unix time with milliseconds precision */
const MILLIS_TIME_LENGTH = 13
/** Transform timestamps to millis for point. (Points can have different precission) */
const pointTimeToMillis = (p: RealtimePoint): RealtimePoint => ({
  ...p,
  timestamp: p.timestamp
    .substr(0, MILLIS_TIME_LENGTH)
    .padEnd(MILLIS_TIME_LENGTH, '0'),
})

/**
 * subscribes for data to servers broker.js via websocket
 * when any subscription present
 */
const useRealtimeData = (
  subscriptions: RealtimeSubscription[],
  onReceivePoints: (pts: RealtimePoint[]) => void
) => {
  const wsInit = useCallback<(ws: WebSocket) => void>(
    (ws) => {
      ws.onopen = () => ws.send('subscribe:' + JSON.stringify(subscriptions))
      ws.onmessage = (response) =>
        onReceivePoints(
          (JSON.parse(response.data) as RealtimePoint[]).map(pointTimeToMillis)
        )
    },
    [subscriptions, onReceivePoints]
  )
  useWebSocket(wsInit, wsAddress, !!subscriptions.length)
}

// transformations for both InfluxDB and Realtime sources so we can use them same way independently of the source

/** transformation for realtime data returned by websocket */
const realtimePointToDiagrameEntryPoint = (points: RealtimePoint[]) => {
  const newData: DiagramEntryPoint[] = []

  for (const p of points) {
    const fields = p.fields
    const time = Math.floor(+p.timestamp)

    for (const key in fields) {
      const value = fields[key] as number
      newData.push({key, time, value})
    }
  }

  return newData
}

/** transformation for pivoted giraffe table */
const giraffeTableToDiagramEntryPoints = (
  table: GiraffeTable | undefined,
  tags: string[]
): DiagramEntryPoint[] => {
  if (!table) return []
  const length = table.length
  const timeCol =
    table.getColumn('_time', 'number') ||
    table.getColumn('_start', 'number') ||
    table.getColumn('_stop', 'number')
  if (!timeCol) return []

  const data: DiagramEntryPoint[] = Array(length * tags.length)

  for (let j = tags.length; j--; ) {
    const key = tags[j]
    const valueCol = table.getColumn(key, 'number') as number[]
    for (let i = length; i--; ) {
      const value = valueCol?.[i]
      const time = timeCol?.[i]
      data[i + j * length] = {key, time, value}
    }
  }

  {
    let length = data.length
    for (let i = data.length; i--; ) {
      if (data[i].value == null || data[i].time == null) {
        length--
        data[i] = data[length]
      }
    }
    data.length = length
    data.sort((a, b) => a.time - b.time)
  }

  return data
}

/**
 * Extracts latlon pairs and return them as TimePoint for realtime-map
 */
const diagramEntryPointsToMapTimePoints = (
  data: DiagramEntryPoint[]
): TimePoint[] => {
  const lats = data.filter((x) => x.key === 'Lat')
  const lons = data.filter((x) => x.key === 'Lon')
  const pointHashMap: Map<number, TimePoint> = new Map()
  const points: TimePoint[] = new Array(lats.length)

  for (let i = lats.length; i--; ) {
    const {time, value} = lats[i]
    const point: TimePoint = [value, undefined as any, time]
    pointHashMap.set(time, point)
    points[i] = point
  }

  for (let i = lons.length; i--; ) {
    const {time, value} = lons[i]
    const entry = pointHashMap.get(time)
    if (entry) entry[1] = value
  }

  let length = points.length
  for (let i = length; i--; ) {
    if (points[i][1] === undefined) {
      length--
      points[i] = points[length]
    }
  }
  points.length = length
  points.sort((a, b) => a[2] - b[2])

  return points
}

// #endregion Realtime

/**
 * definitions for time select. (Live options)
 * realtime options contains retention to be used in plots
 */
const timeOptionsRealtime: {
  label: string
  value: string
  realtimeRetention: number
}[] = [
  {label: 'Live 10s', value: '-10s', realtimeRetention: 10_000},
  {label: 'Live 30s', value: '-30s', realtimeRetention: 30_000},
  {label: 'Live 1m', value: '-1m', realtimeRetention: 60_000},
]

/**
 * definitions for time select. (Past options)
 */
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

interface PropsRoute {
  deviceId?: string
}

interface Props {
  helpCollapsed: boolean
  mqttEnabled: boolean | undefined
}

/** Selects source based on timeStart and feed data into DataManager */
const useSource = (
  manager: DataManager,
  clientId: string,
  timeStart: string,
  fields: string[]
) => {
  const loading = false
  return loading
}

type DashboardLayout = {
  layout: DashboardCell
}

/**
 * render dashboard cells for layout, data passed by context
 */
const DashboardLayout: React.FC<DashboardLayout> = () => {
  return <></>
}

const DynamicDashboardPage: FunctionComponent<
  RouteComponentProps<PropsRoute> & Props
> = ({match, history, helpCollapsed, mqttEnabled}) => {
  const deviceId = match.params.deviceId ?? VIRTUAL_DEVICE
  // loading is defaultly false because we don't load data when page load.
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<Message | undefined>()
  const [dataStamp, setDataStamp] = useState(0)
  const [devices, setDevices] = useState<DeviceInfo[] | undefined>(undefined)
  const [timeStart, setTimeStart] = useState(timeOptionsRealtime[0].value)

  const isVirtualDevice = deviceId === VIRTUAL_DEVICE

  // TODO: move dis
  // #region move to useSource

  const [deviceData, setDeviceData] = useState<DeviceData | undefined>()
  const measurementsTable = deviceData?.measurementsTable

  // TODO: remove, this is handled in data manager
  const [receivedDataFields, setReceivedDataFields] = useState<string[]>([])

  // #endregion move to useSource

  const updateReceivedDataFields = (updatedFields: string[]) => {
    setReceivedDataFields((prevState) => {
      const newFields = updatedFields.filter(
        (x) => !prevState.some((y) => x === y)
      )
      if (!newFields.length) return prevState
      return [...prevState, ...newFields]
    })
  }
  const clearReceivedDataFields = () =>
    setReceivedDataFields((prevState) => (prevState.length ? [] : prevState))
  const hasData = (column: string) =>
    receivedDataFields.some((x) => x === column)

  // #region realtime

  const isRealtime = timeOptionsRealtime.some((x) => x.value === timeStart)

  // Default time selected to Past when mqtt not configured
  useEffect(() => {
    if (mqttEnabled === false) {
      setTimeStart(timeOptions[0].value)
    }
  }, [mqttEnabled])

  // We use hook instead of component so we can bypass react and have full control of rendering plots
  const {mapElement, mapRef} = useMap()
  // Map view automatically follows last point when realtime so drag is not necessary
  mapRef.current.setDragable(!isRealtime)

  const [subscriptions, setSubscriptions] = useState<RealtimeSubscription[]>([])
  // updaters are functions that updates plots outside of react state
  type Updaters = Record<string, G2PlotUpdater>
  const updatersGaugeRef = useRef<Updaters>({})
  const updatersLineRef = useRef<Updaters>({})

  /** plot is showed with fixed time range if set */
  const retentionTime = isRealtime
    ? timeOptionsRealtime[
        timeOptionsRealtime.findIndex((x) => x.value === timeStart)
      ].realtimeRetention
    : Infinity
  mapRef.current.retentionTime = retentionTime

  useEffect(() => {
    setSubscriptions(
      isRealtime
        ? [{measurement: 'environment', tags: [`clientId=${deviceId}`]}]
        : []
    )
  }, [deviceId, isRealtime])

  /** Push data to desired plots and rerender them */
  const updateData = useRef((data: DiagramEntryPoint[]) => {
    updateReceivedDataFields(getFieldsOfData(data))

    mapRef.current.addPoints(diagramEntryPointsToMapTimePoints(data))

    for (const field of fields) {
      const lineData = data.filter(({key}) => key === field)

      const {min, max} = measurementsDefinitions[field]
      const gaugeData = lineData.map((x) => ({
        ...x,
        // plot library uses data for gauges in [0,1] interval
        value: (x.value - min) / (max - min),
      }))

      updatersLineRef.current[field]?.(lineData)
      updatersGaugeRef.current[field]?.(gaugeData)
    }
  }).current

  useRealtimeData(
    subscriptions,
    useRef((points: RealtimePoint[]) => {
      updateData(realtimePointToDiagrameEntryPoint(points))
    }).current
  )

  /** Clear data and resets received data fields state */
  const clearData = useCallback(() => {
    clearReceivedDataFields()
    for (const measurement of fields) {
      updatersGaugeRef.current[measurement]?.(undefined)
      updatersLineRef.current[measurement]?.(undefined)
      mapRef.current.clear()
    }
  }, [mapRef])

  useEffect(() => {
    if (isRealtime) clearData()
  }, [isRealtime, clearData])
  useEffect(clearData, [deviceId, clearData])

  // On measurementsTable is changed, we render it in plots
  useEffect(() => {
    clearData()
    updateData(giraffeTableToDiagramEntryPoints(measurementsTable, fieldsAll))
  }, [measurementsTable, updateData, clearData])

  // #endregion realtime

  // fetch device configuration and data
  useEffect(() => {
    // we don't use fetchDeviceLastValues
    //   Gauge plots will handle last walue selection for us

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
  }, [dataStamp, deviceId, timeStart, isRealtime])

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

  /*
    Rendering plots with minilibrary written in util/realtime/
    This time, data isn't pass by state but by calling callback (got by onUpdaterChange) 
    which allows us to update plot more frequently with better performance.
    All plots has to be rendered whole time because we need to have updater function from it. (so we use display 'none' instead of conditional rendering)
  */
  const renderGauge = (column: string) => (
    <G2Plot
      type={Gauge}
      onUpdaterChange={(updater) =>
        (updatersGaugeRef.current[column] = updater)
      }
      options={gaugesPlotOptions[column]}
    />
  )

  // gaugeLastTimeMessage not implemented

  const gauges = (
    <Row gutter={[22, 22]}>
      {fields.map((column, i) => {
        return (
          <Col
            sm={helpCollapsed ? 24 : 24}
            md={helpCollapsed ? 12 : 24}
            xl={helpCollapsed ? 6 : 12}
            style={hasData(column) ? {} : {display: 'none'}}
            key={i}
          >
            <Card title={column}>{renderGauge(column)}</Card>
          </Col>
        )
      })}
    </Row>
  )

  const plotDivider = (
    <Divider style={{color: 'rgba(0, 0, 0, .2)'}} orientation="right">
      {noDataFields.length
        ? `No data for: ${noDataFields.join(', ')}`
        : undefined}
    </Divider>
  )

  const geo = (
    <div
      style={{
        height: '500px',
        minWidth: '200px',
        ...(hasData('Lat') ? {} : {display: 'none'}),
      }}
    >
      {mapElement}
    </div>
  )

  const renderPlot = (column: string) => (
    <G2Plot
      type={Line}
      onUpdaterChange={(updater) => (updatersLineRef.current[column] = updater)}
      options={linePlotOptions[column]}
      retentionTimeMs={retentionTime}
    />
  )

  const plots = (() => {
    return (
      <>
        <Row gutter={[0, 24]}>
          {fields.map((field, i) => (
            <Col
              xs={24}
              style={hasData(field) ? {} : {display: 'none'}}
              key={i}
            >
              <Collapse defaultActiveKey={[i]}>
                <CollapsePanel key={i} header={field}>
                  {renderPlot(field)}
                </CollapsePanel>
              </Collapse>
            </Col>
          ))}
        </Row>
        {noDataFields.length ? (
          <Collapse>
            {noDataFields.map((field, i) => (
              <CollapsePanel
                collapsible="disabled"
                header={`${field} - No data`}
                key={i}
              />
            ))}
          </Collapse>
        ) : undefined}
      </>
    )
  })()

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

      <Tooltip
        title={
          (mqttEnabled === false ? 'MQTT not configured on server! ' : '') +
          'Choose time'
        }
        placement="left"
      >
        <Select
          value={timeStart}
          onChange={setTimeStart}
          style={{minWidth: 100}}
          loading={loading || mqttEnabled === undefined}
          disabled={loading}
        >
          {timeOptionsRealtime.map(({label, value}) => (
            <Select.Option
              disabled={mqttEnabled === false}
              key={value}
              value={value}
            >
              {label}
            </Select.Option>
          ))}
          {timeOptions.map(({label, value}) => (
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

  return (
    <PageContent
      title={
        <>
          Realtime Dashboard
          {isVirtualDevice ? (
            <Tooltip title="This page is based on Dashboard page, it has two modes: past and live. Past data are received from influxdb and live data are sent directly from device by mqtt">
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
      <div style={receivedDataFields.length ? {} : {display: 'none'}}>
        {gauges}
        {plotDivider}
        {geo}
        {plots}
      </div>
      {!receivedDataFields.length ? (
        <Card>
          <Empty />
        </Card>
      ) : undefined}
    </PageContent>
  )
}

export default DynamicDashboardPage

import {Button, Card, Select, Tooltip} from 'antd'
import {Line, Gauge, GaugeOptions, LineOptions} from '@antv/g2plot'
import React, {FunctionComponent, useEffect, useState} from 'react'
import PageContent, {Message} from './PageContent'
import {useRef} from 'react'
import {useCallback} from 'react'
import {
  DiagramEntryPoint,
  G2Plot,
  G2PlotUpdater,
  useWebSocket,
} from '../util/realtimeUtils'
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

// we have replaced giraffe with non-react library to handle faster rerendering

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
}
const fields = Object.keys(measurementsDefinitions)

const gaugesPlotOptions: Record<
  string,
  Omit<GaugeOptions, 'percent'>
> = Object.fromEntries(
  Object.entries(measurementsDefinitions).map(
    ([measurement, {max, min, unit, decimalPlaces}]) => [
      measurement,
      {
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
            formatter: (v) =>
              max < 1000
                ? (+v * (max - min) + min).toFixed(0)
                : ((+v * (max - min) + min) / 1000).toFixed(0) + 'K',
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
            formatter: (x) =>
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
      },
    ]
  )
)

const linePlotOptions: Record<
  string,
  Omit<LineOptions, 'data'>
> = Object.fromEntries(
  Object.keys(measurementsDefinitions).map((measurement) => [
    measurement,
    {
      height: 200,
      legend: false,
      lineStyle: {
        color: colorPrimary,
        lineWidth: 4,
      },
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
  useWebSocket(wsInit, wsAddress, !!subscriptions.length)
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
    const valueCol = table.getColumn(key, 'number') as number[]
    for (let i = length; i--; ) {
      const value = valueCol?.[i]
      const time = timeCol?.[i]
      data[i + j * length] = {key, time, value}
    }
  }

  for (let i = data.length; i--; )
    if (typeof data[i].value !== 'number' || typeof data[i].time !== 'number')
      data.splice(i, 1)

  return data
}

// #endregion Realtime

const timeOptionsRealtime: {
  label: string
  value: string
  realtimeRetention: number
}[] = [
  {label: 'Live 10s', value: '-10s', realtimeRetention: 10_000},
  {label: 'Live 30s', value: '-30s', realtimeRetention: 30_000},
  {label: 'Live 1m', value: '-1m', realtimeRetention: 60_000},
]

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

const RealTimePage: FunctionComponent<
  RouteComponentProps<PropsRoute> & Props
> = ({match, history, helpCollapsed, mqttEnabled}) => {
  const influxEnabled = true as boolean
  const deviceId = match.params.deviceId ?? VIRTUAL_DEVICE
  // loading is defaultly false
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<Message | undefined>()
  const [deviceData, setDeviceData] = useState<DeviceData | undefined>()
  const [dataStamp, setDataStamp] = useState(0)
  const [devices, setDevices] = useState<DeviceInfo[] | undefined>(undefined)
  const [timeStart, setTimeStart] = useState(timeOptionsRealtime[0].value)

  const isVirtualDevice = deviceId === VIRTUAL_DEVICE
  const measurementsTable = deviceData?.measurementsTable

  const [receivedDataFields, setReceivedDataFields] = useState<string[]>([])
  const noDataFields = fields.filter(
    (x) => !receivedDataFields.some((y) => y === x)
  )
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

  useEffect(() => {
    if (mqttEnabled === false) {
      setTimeStart(timeOptions[0].value)
    }
  }, [mqttEnabled])

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  type Updaters<T> = Record<string, G2PlotUpdater<T>>
  const updatersGaugeRef = useRef<Updaters<Gauge>>({})
  const updatersLineRef = useRef<Updaters<Line>>({})

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

  const updateData = useRef((data: DiagramEntryPoint[] | undefined) => {
    if (data === undefined) return

    const updatedFields: string[] = []

    for (const field of fields) {
      const lineData = data.filter(({key}) => key === field)
      if (lineData.length) updatedFields.push(field)

      const {min, max} = measurementsDefinitions[field]
      const gaugeData = lineData.map((x) => ({
        ...x,
        value: (x.value - min) / (max - min),
      }))

      updatersLineRef.current[field]?.(lineData)
      updatersGaugeRef.current[field]?.(gaugeData)
    }

    updateReceivedDataFields(updatedFields)
  }).current

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

  const clearData = useRef(() => {
    clearReceivedDataFields()
    for (const measurement of fields) {
      updatersGaugeRef.current[measurement]?.(0)
      updatersLineRef.current[measurement]?.(undefined)
    }
  }).current

  useEffect(() => {
    if (isRealtime) clearData()
  }, [isRealtime, clearData])
  useEffect(clearData, [deviceId, clearData])

  useEffect(() => {
    clearData()
    // TODO: somehow clearing data after update, need to be fixed
    setTimeout(() => {
      updateData(giraffeTableToDiagramEntryPoints(measurementsTable, fields))
    }, 100)
  }, [measurementsTable, updateData, clearData])

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

  const renderGauge = (column: string) => (
    <G2Plot
      type={Gauge}
      onUpdaterChange={(updater) =>
        (updatersGaugeRef.current[column] = updater)
      }
      options={gaugesPlotOptions[column]}
    />
  )

  // gaugeLastTimeMessage not supported in this demo helper realtimeUtils mini-library

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
            <Select.Option
              disabled={influxEnabled === false}
              key={value}
              value={value}
            >
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
      <div style={receivedDataFields.length ? {} : {display: 'none'}}>
        {gauges}
        {plotDivider}
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

export default RealTimePage

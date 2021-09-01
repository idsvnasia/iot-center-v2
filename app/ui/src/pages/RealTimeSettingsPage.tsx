import {Card, Col, Row, Form, Input, Switch, Button} from 'antd'
import React, {FunctionComponent, useEffect, useState} from 'react'
import PageContent from './PageContent'

const useRefresh = () => {
  const [token, setToken] = useState(Date.now())
  const refresh = () => {
    setToken(Date.now())
  }
  return [refresh, token] as const
}

type MqttSettings = {
  running: boolean
  sendInterval: number
  measurements: Record<string, {period: number; min: number; max: number}>
}

const labelCol = {xs: 5}
const wrapperCol = Object.fromEntries(
  Object.entries(labelCol).map(([k, v]) => [k, 24 - v])
)

const RealTimeSettingsPage: FunctionComponent = () => {
  const [settings, setSettings] = useState<MqttSettings>()
  const [refresh, refreshToken] = useRefresh()

  useEffect(() => {
    ;(async () => {
      const set = await (await fetch('/mqtt/settings')).json()
      setSettings(set)
    })()
  }, [refreshToken])

  const applyChanges = () => {
    ;(async () => {
      await fetch('/mqtt/settings', {
        method: 'POST',
        body: JSON.stringify(settings),
      })
      refresh()
    })()
  }

  return (
    <>
      <PageContent title={'Realtime-settings'}>
        <Row>
          <Col xs={24} md={12} xl={8}>
            <Card>
              <Form labelCol={labelCol} wrapperCol={wrapperCol}>
                <Form.Item label={'running?'}>
                  <Switch
                    checked={settings?.running}
                    title={'running'}
                    checkedChildren={'on'}
                    unCheckedChildren={'off'}
                    onChange={(e) => {
                      setSettings((settings) => {
                        if (settings) return {...settings, running: e}
                        return settings
                      })
                    }}
                  />
                </Form.Item>
                <Form.Item label="Send interval">
                  <Input
                    value={settings?.sendInterval}
                    defaultValue={100}
                    type="number"
                    onChange={(e) => {
                      setSettings((settings) =>
                        settings
                          ? {...settings, sendInterval: +e.target.value}
                          : undefined
                      )
                    }}
                  />
                </Form.Item>
                {settings?.measurements && (
                  <Row>
                    <Col {...labelCol}></Col>
                    <Col {...wrapperCol}>
                      <Row>
                        <Col xs={6}>Period</Col>
                        <Col xs={9}>min</Col>
                        <Col xs={9}>max</Col>
                      </Row>
                    </Col>
                  </Row>
                )}
                {Object.entries(settings?.measurements || {}).map(([name]) => (
                  <>
                    <Row>
                      <Col {...labelCol}>{name}</Col>
                      <Col {...wrapperCol}>
                        <Row>
                          <Col xs={6}>
                            <Input
                              value={settings!.measurements[name].period}
                              defaultValue={30}
                              type="number"
                              onChange={(e) => {
                                setSettings((settings) =>
                                  settings
                                    ? {
                                        ...settings,
                                        measurements: {
                                          ...settings.measurements,
                                          [name]: {
                                            ...settings.measurements[name],
                                            period: +e.target.value,
                                          },
                                        },
                                      }
                                    : undefined
                                )
                              }}
                            />
                          </Col>
                          <Col xs={9}>
                            <Input
                              value={settings!.measurements[name].min}
                              defaultValue={0}
                              type="number"
                              onChange={(e) => {
                                setSettings((settings) =>
                                  settings
                                    ? {
                                        ...settings,
                                        measurements: {
                                          ...settings.measurements,
                                          [name]: {
                                            ...settings.measurements[name],
                                            min: +e.target.value,
                                          },
                                        },
                                      }
                                    : undefined
                                )
                              }}
                            />
                          </Col>
                          <Col xs={9}>
                            <Input
                              value={settings!.measurements[name].max}
                              defaultValue={30}
                              type="number"
                              onChange={(e) => {
                                setSettings((settings) =>
                                  settings
                                    ? {
                                        ...settings,
                                        measurements: {
                                          ...settings.measurements,
                                          [name]: {
                                            ...settings.measurements[name],
                                            max: +e.target.value,
                                          },
                                        },
                                      }
                                    : undefined
                                )
                              }}
                            />
                          </Col>
                        </Row>
                      </Col>
                    </Row>
                  </>
                ))}
                <Col
                  style={{
                    textAlign: 'right',
                  }}
                >
                  <Button onClick={refresh}>Refresh</Button>
                  <Button onClick={applyChanges}>Apply</Button>
                </Col>
              </Form>
            </Card>
          </Col>
        </Row>
      </PageContent>
    </>
  )
}

export default RealTimeSettingsPage

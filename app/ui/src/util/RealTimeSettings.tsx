import {Card, Col, Row, Form, Input, Switch} from 'antd'
import React, {FunctionComponent, useEffect, useState} from 'react'

type MqttSettings = {
  running: boolean
  sendInterval: number
}

const labelCol = {xs: 14}
const wrapperCol = Object.fromEntries(
  Object.entries(labelCol).map(([k, v]) => [k, 24 - v])
)

const RealTimeSettings: FunctionComponent = () => {
  const [settings, setSettings] = useState<MqttSettings>()

  const refresh = async () => {
    const set = await (await fetch('/mqtt/settings')).json()
    setSettings(set)
  }

  useEffect(() => {
    refresh()
  }, [])

  const applyChanges = (settings: MqttSettings) => {
    setSettings(settings)
    settings.sendInterval = Math.max(30, settings.sendInterval)
    if (!settings) return
    ;(async () => {
      await fetch('/mqtt/settings', {
        method: 'POST',
        body: JSON.stringify(settings),
      })
      await refresh()
    })()
  }

  const setRunning = (isRunning: boolean) => {
    if (settings) applyChanges({...settings, running: isRunning})
  }

  const setSendInterval = (interval: number) => {
    if (settings) applyChanges({...settings, sendInterval: interval})
  }

  return (
    <>
      <Row>
        <Col xs={24} md={12} xxl={8}>
          <Card title="Realtime settings">
            <Form labelCol={labelCol} wrapperCol={wrapperCol}>
              <Form.Item label={'running?'}>
                <Switch
                  checked={settings?.running}
                  title={'running'}
                  checkedChildren={'on'}
                  unCheckedChildren={'off'}
                  onChange={setRunning}
                />
              </Form.Item>
              <Form.Item label="Send interval [ms]">
                <Input
                  value={settings?.sendInterval}
                  defaultValue={100}
                  type="number"
                  onChange={(e) => {
                    const num = +e.target.value
                    setSendInterval(num)
                  }}
                  min={30}
                />
              </Form.Item>
              <Col
                style={{
                  textAlign: 'right',
                  paddingTop: 24,
                }}
              ></Col>
            </Form>
          </Card>
        </Col>
      </Row>
    </>
  )
}

export default RealTimeSettings

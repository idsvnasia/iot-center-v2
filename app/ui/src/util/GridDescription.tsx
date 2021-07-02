import React from 'react'
import {Col, Row} from 'antd'
import {Title} from './Antd.utils'
import {Breakpoint} from 'antd/lib/_util/responsiveObserve'
import {colorBodyBg1} from '../colors'

export type GridDescriptionProps = {
  title?: string
  descriptions: {label: string; value: string | undefined}[]
  column?: number | Partial<Record<Breakpoint, number>> | undefined
}

export const GridDescription: React.FC<GridDescriptionProps> = (props) => {
  const title = props.title || ''
  const descriptions = props.descriptions

  const calculateColSpan = (x: number) => Math.floor(24 / x)
  const colSpan =
    typeof props.column === 'number'
      ? {xs: calculateColSpan(props.column)}
      : props.column === undefined
      ? {xs: calculateColSpan(1)}
      : Object.fromEntries(
          Object.entries(props.column).map(([k, v]) => [k, calculateColSpan(v)])
        )

  return (
    <>
      <Title>{title}</Title>
      <Row
        gutter={[36, 4]}
        style={{
          filter: 'drop-shadow(0px 0px 25px rgba(0, 0, 0, 0.15))',
        }}
      >
        {descriptions.map(({label, value}) => (
          <Col {...colSpan}>
            <Row
              style={{
                // todo: replace this with dynamic column width
                whiteSpace: 'nowrap',
              }}
            >
              <Col
                style={{
                  padding: '16px 24px',
                  borderRight: '1px solid #f0f0f0',
                  background: colorBodyBg1,
                  fontSize: '16px',
                }}
                xs={10}
              >
                {label}
              </Col>
              <Col
                style={{
                  padding: '16px 24px',
                  background: 'white',
                }}
                xs={14}
              >
                {value}
              </Col>
            </Row>
          </Col>
        ))}
      </Row>
    </>
  )
}

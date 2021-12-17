import React, {useContext, useEffect, useRef} from 'react'
import {Gauge, Line} from '@antv/g2plot'
import {G2PlotOptionsNoData, throwReturn} from '../../..'
import {DataManagerContext} from '../..'
import {ManagedG2Plot, PlotConstructor} from '../../components/ManagedG2Plot'

type ManagedG2PlotReactParams = {
  plotType: 'gauge' | 'line' | PlotConstructor
  keys: string[]
  options?: G2PlotOptionsNoData<any>
}

export const ManagedG2PlotReact: React.FC<ManagedG2PlotReactParams> = ({
  plotType: plotType,
  keys,
  options,
}) => {
  const elementRef = useRef<HTMLDivElement>(null)
  const element = <div ref={elementRef} />

  const manager = useContext(DataManagerContext)

  const plotRef = useRef<ManagedG2Plot>()

  useEffect(() => {
    if (!elementRef.current) return
    const ctor =
      typeof plotType === 'string'
        ? plotType === 'gauge'
          ? Gauge
          : plotType === 'line'
          ? Line
          : throwReturn<PlotConstructor>(
              `invalid plotType string! expected line or gauge, got ${plotType}`
            )
        : plotType

    plotRef.current = new ManagedG2Plot(manager, elementRef.current, ctor)
  }, [plotType, manager])

  useEffect(() => {
    if (!plotRef.current) return
    plotRef.current.manager = manager
  }, [manager])

  useEffect(() => {
    if (!plotRef.current) return
    plotRef.current.keys = keys
  }, [keys])

  useEffect(() => {
    if (!plotRef.current) return
    plotRef.current.options = options || {}
  }, [options])

  useEffect(() => {
    plotRef.current?.render?.()
  }, [])

  return <>{element}</>
}
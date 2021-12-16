import {Gauge, Line} from '@antv/g2plot'
import React, {useContext, useEffect, useRef} from 'react'
import {DataManager} from '..'
import {G2PlotOptionsNoData, throwReturn} from '../..'
import {ManagedG2Plot, PlotConstructor} from '../ManagedG2Plot'
import {DataManagerContext} from './DataManagerContext'

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

    plotRef.current = new ManagedG2Plot(manager, ctor, elementRef.current)
  }, [plotType])

  useEffect(() => {
    if (!plotRef.current) return
    plotRef.current.setManager(manager)
  }, [manager])

  useEffect(() => {
    if (!plotRef.current) return
    plotRef.current.keys = keys
  }, [keys])

  useEffect(() => {
    if (!plotRef.current) return
    plotRef.current.options = options || {}
  }, [options])

  useEffect(()=>{
    plotRef.current?.render?.()
  }, [])

  return <>{element}</>
}

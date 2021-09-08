import {Gauge, Plot} from '@antv/g2plot'
import React, {useCallback, useEffect, useRef} from 'react'

export type DiagramEntryPoint = {
  value: number
  time: number
  key: string
}

export const useWebSocket = (
  callback: (ws: WebSocket) => void,
  url: string
) => {
  const wsRef = useRef<WebSocket>()

  const startListening = useCallback(() => {
    console.log('starting WebSocket')
    wsRef.current = new WebSocket(url)
    callback(wsRef.current)
  }, [callback, url])

  useEffect(() => {
    startListening()
    return () => wsRef.current?.close?.()
  }, [startListening])

  useEffect(() => {
    // reconnect a broken WS connection
    const checker = setInterval(() => {
      if (
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.CLOSING ||
          wsRef.current.readyState === WebSocket.CLOSED)
      ) {
        startListening()
      }
    }, 2000)
    return () => clearInterval(checker)
  }, [startListening])
}

const useRafOnce = (callback: () => void, deps: any[] = []) => {
  const calledRef = useRef(false)

  const fnc = useCallback(callback, deps)

  return useCallback(() => {
    if (calledRef.current) return
    calledRef.current = true
    requestAnimationFrame(() => {
      calledRef.current = false
      fnc()
    })
  }, [fnc])
}

const formatter = (v: string) => new Date(+v).toLocaleTimeString()

const g2PlotDefaults = {
  data: [],
  percent: 0,
  xField: 'time',
  yField: 'value',
  seriesField: 'key',
  animation: false,
  xAxis: {
    label: {
      formatter,
    },
  },
  tooltip: {
    title: formatter,
  },
}

export const useG2Plot = <
  PlotConstructor extends new (...args: any[]) => Plot<any>
>(
  ctor: PlotConstructor,
  opts?: Omit<ConstructorParameters<PlotConstructor>[1], 'data' | 'percent'>
) => {
  type PlotType = InstanceType<PlotConstructor>

  const plotRef = useRef<PlotType>()
  const dataRef = useRef<DiagramEntryPoint[] | number>([])

  const elementRef = useRef<HTMLDivElement>(undefined!)
  const element = <div ref={elementRef} />

  useEffect(() => {
    if (!elementRef.current) return
    plotRef.current = new ctor(elementRef.current, {
      ...g2PlotDefaults,
      ...opts,
    }) as any
    plotRef.current!.render()
  }, [])

  // todo: redrawBase should be called when draw optins changes
  const redrawBase = useRafOnce(() =>{
    plotRef.current?.update({
      ...g2PlotDefaults,
      ...opts,
    })
  }, [opts])

  const invalidate = useRafOnce(() => {
    plotRef.current?.changeData(dataRef.current)
  }, [])

  const update = (
    newData: PlotType extends Gauge
      ? number
      :
          | ((data: DiagramEntryPoint[]) => void)
          | DiagramEntryPoint[]
          | DiagramEntryPoint
  ) => {
    if (typeof newData === 'function') {
      newData(dataRef.current as any)
    } else if (typeof newData === 'number') {
      dataRef.current = newData
    } else dataRef.current = Array.isArray(newData) ? newData : [newData]

    invalidate()
  }

  return {element, update} as const
}

type G2PlotParams<PlotConstructor extends new (...args: any[]) => Plot<any>> = {
  type: PlotConstructor
  options?: Omit<ConstructorParameters<PlotConstructor>[1], 'data' | 'percent'>
  onUpdaterChange: (
    updater: (
      newData: InstanceType<PlotConstructor> extends Gauge
        ? number
        :
            | ((data: DiagramEntryPoint[]) => void)
            | DiagramEntryPoint[]
            | DiagramEntryPoint
    ) => void
  ) => void
}

export const G2Plot = <
  PlotConstructor extends new (...args: any[]) => Plot<any>
>(
  params: G2PlotParams<PlotConstructor>
) => {
  const {element, update} = useG2Plot(params.type, params.options)
  useEffect(() => {
    params.onUpdaterChange(update)
  }, [update])

  return <>{element}</>
}

import {Gauge, Plot} from '@antv/g2plot'
import React, {useCallback, useEffect, useRef} from 'react'
import {simplifyForNormalizedData} from './simplyfi'

const BREAKPOINTS_DEFS: {
  timeThreshold: number
  omega: number
}[] = [
  {timeThreshold: 10 * 1000, omega: 0.01},
  {timeThreshold: 20 * 1000, omega: 0.02},
  {timeThreshold: 60 * 1000, omega: 0.03},
]
BREAKPOINTS_DEFS.sort((a, b) => -(a.timeThreshold - b.timeThreshold))

type MinAndMax = {min: number; max: number}
const getMinAndMax = (arr: number[]): MinAndMax => {
  let min = Infinity
  let max = -Infinity
  for (const i of arr) {
    if (min > i) min = i
    if (max < i) max = i
  }
  return {min, max}
}

const normalize = (
  arr: number[],
  minAndMax: MinAndMax,
  inverse: boolean = false
) => {
  const {max, min} = minAndMax
  const dist = max - min
  if (!inverse) {
    return arr.map((x) => (x - min) / dist)
  } else {
    return arr.map((x) => x * dist + min)
  }
}

/** simplify that has data normalization implemented */
const simplify = (xs: number[], ys: number[], epsilon: number) => {
  if (xs.length < 2) return [xs, ys] as const

  const xMinAndMax = getMinAndMax(xs)
  const yMinAndMax = getMinAndMax(ys)

  const [
    xsSimplifiedNormalized,
    ysSimplifiedNormalized,
  ] = simplifyForNormalizedData(
    normalize(xs, xMinAndMax),
    normalize(ys, yMinAndMax),
    epsilon
  )

  const xsSimplified = normalize(xsSimplifiedNormalized, xMinAndMax, true)
  const ysSimplified = normalize(ysSimplifiedNormalized, yMinAndMax, true)

  return [xsSimplified, ysSimplified] as const
}

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
    type: 'time',
    mask: 'HH:MM:ss',
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
      xAxis: {
        ...g2PlotDefaults?.xAxis,
        ...opts?.xAxis,
      },
    }) as any
    plotRef.current!.render()
  }, [])

  const redraw = useRafOnce(() => {
    const data = dataRef.current

    plotRef.current?.update?.({
      ...g2PlotDefaults,
      ...opts,
      ...(typeof data === 'number' ? {percent: data} : {data}),
    })
  }, [opts])

  useEffect(redraw, [redraw])

  const invalidate = useRafOnce(() => {
    // todo: don't redraw when window not visible
    const data = dataRef.current
    if (!data) return
    if (typeof data === 'number') {
      plotRef.current?.changeData?.(data)
      return
    }
    if ((ctor as any) === Gauge) {
      if (!data.length) return
      let dataLast: DiagramEntryPoint = data[0]
      data.forEach((x) => {
        if (x.time > dataLast.time) {
          dataLast = x
        }
      })
      console.log(`aplying last data ${dataLast.value}`)
      plotRef.current?.changeData?.(dataLast.value)

      return
    }
    const lines: Record<string, {xs: number[]; ys: number[]}> = {}

    for (const d of data) {
      let obj = lines[d.key]
      if (!obj) {
        obj = lines[d.key] = {xs: [], ys: []}
      }
      obj.xs.push(d.time)
      obj.ys.push(d.value)
    }

    for (const key in lines) {
      const now = Date.now()
      const {xs, ys} = lines[key]
      const newX: number[] = []
      const newY: number[] = []

      let lastBreakpointIndex = 0

      for (const {omega, timeThreshold} of BREAKPOINTS_DEFS) {
        const index = xs.findIndex((x) => x > now - timeThreshold)
        if (index === -1 || lastBreakpointIndex >= index) continue

        const [xsbp, ysbp] = simplify(
          xs.slice(lastBreakpointIndex, index),
          ys.slice(lastBreakpointIndex, index),
          omega
        )

        pushBigArray(newX, xsbp)
        pushBigArray(newY, ysbp)

        lastBreakpointIndex = index
      }

      if (lastBreakpointIndex < xs.length) {
        pushBigArray(newX, xs.slice(lastBreakpointIndex, xs.length))
        pushBigArray(newY, ys.slice(lastBreakpointIndex, ys.length))
      }

      lines[key] = {xs: newX, ys: newY}
    }

    const newArr: DiagramEntryPoint[] = []

    for (const key in lines) {
      const {xs, ys} = lines[key]
      for (let i = 0; i < xs.length; i++) {
        const time = xs[i]
        const value = ys[i]

        newArr.push({key, time, value})
      }
    }

    plotRef.current?.changeData(newArr)
  })

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

  const plotObjRef = useRef({element, update} as const)

  return plotObjRef.current
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

/**
 * using spread operator with [Array].push
 * function can exceed callback for big arrays.
 * Use this method instead
 */
export const pushBigArray = <T,>(self: T[], arr2: T[]) => {
  const arr2len = arr2.length
  const newLen = self.length + arr2len
  self.length = newLen
  let i = newLen
  for (let j = arr2len; j--; ) {
    i--
    self[i] = arr2[j]
  }
}

import React from 'react'
import {useCallback, useEffect, useRef} from 'react'
import {Gauge, Plot} from '@antv/g2plot'
import {
  DiagramEntryPoint,
  simplifyDiagramEntryPointToMaxPoints,
  linearScale,
  useRafOnce,
  asArray,
  pushBigArray,
  applyRetention,
  getMinAndMax,
} from '.'

const DAY_MILLIS = 24 * 60 * 60 * 1000

const maskTime = 'hh:mm:ss'
const maskDate = 'DD/MM/YY'
const maskDateTime = `${maskDate} ${maskTime} `

const g2PlotDefaults = {
  data: [],
  percent: 0,
  xField: 'time',
  yField: 'value',
  seriesField: 'key',
  animation: false,
  xAxis: {
    type: 'time',
    mask: maskTime,
    nice: false,
    tickInterval: 4,
  },
}

export type PlotConstructor = new (...args: any[]) => Plot<any>
export type G2PlotOptionsNoData<T> = Omit<
  ConstructorParameters<new (...args: any[]) => Plot<T>>[1],
  'data' | 'percent'
>
export type G2PlotUpdater = (
  newData: undefined | DiagramEntryPoint | DiagramEntryPoint[]
) => void

type G2PlotHook = {
  readonly element: JSX.Element
  readonly update: G2PlotUpdater
}

// TODO: replace with class, use setters/getters (only calculateSimplifyedData will be method to ensure user know it's Performance sensitive operation)
/**
 * state management for G2Plot-realtime, ensures caching for rerendering
 */
const createG2PlotData = () => {
  let data: DiagramEntryPoint[] | undefined = undefined
  let retentionTimeMs = Infinity
  const cache = new Map<number, any>()

  const applyRetentionOnData = () => {
    if (!data) return
    const l0 = data.length
    applyRetention(data, retentionTimeMs)
    const l1 = data.length
    if (l0 !== l1) cache.clear()
  }

  const updateData = (newData: DiagramEntryPoint[] | undefined) => {
    if (newData === undefined) data = undefined
    else {
      if (data === undefined) data = []
      pushBigArray(data, newData)
    }
    applyRetentionOnData()
    cache.clear()
  }

  const getRetentionTimeMs = () => retentionTimeMs

  const getRetentionUsed = () =>
    retentionTimeMs !== Infinity && retentionTimeMs > 0

  const setRetention = (ms: number) => {
    retentionTimeMs = ms
    applyRetentionOnData()
  }

  let cacheId = 0
  const cached = <TReturn,>(fnc: () => TReturn) => {
    const key = cacheId++

    return () => {
      if (!cache.has(key)) cache.set(key, fnc())
      return cache.get(key) as TReturn
    }
  }

  const calculateSimplifyedData = cached(() =>
    data
      ? simplifyDiagramEntryPointToMaxPoints(data as DiagramEntryPoint[])
      : []
  )

  const getDataTimeMinMax = cached(() =>
    data?.length ? getMinAndMax(data.map((x) => x.time)) : undefined
  )

  const getLatestDataPoint = cached(() => {
    const minMax = getDataTimeMinMax()
    if (!minMax || !data) return undefined
    const {max} = minMax
    return data.find((x) => x.time === max)
  })

  const getMask = cached(() => {
    if (!data) return ''
    if (data.some((x) => x.time < Date.now() - 3 * DAY_MILLIS)) return maskDate
    if (data.some((x) => x.time < Date.now() - DAY_MILLIS)) return maskDateTime
    return maskTime
  })

  return {
    updateData,
    calculateSimplifyedData,
    getDataTimeMinMax,
    getMask,
    setRetention,
    getLatestDataPoint,
    applyRetentionOnData,
    getRetentionTimeMs,
    getRetentionUsed,
  }
}

export const useG2Plot = (
  ctor: PlotConstructor,
  opts?: Omit<ConstructorParameters<PlotConstructor>[1], 'data' | 'percent'>,
  retentionTimeMs = Infinity
): G2PlotHook => {
  const plotRef = useRef<InstanceType<PlotConstructor>>()
  const {
    updateData,
    calculateSimplifyedData,
    getDataTimeMinMax,
    getMask,
    setRetention,
    getLatestDataPoint,
    getRetentionTimeMs,
    getRetentionUsed,
  } = useRef(createG2PlotData()).current

  const elementRef = useRef<HTMLDivElement>(null)
  const element = <div ref={elementRef} />

  useEffect(() => setRetention(retentionTimeMs), [
    setRetention,
    retentionTimeMs,
  ])

  const getPlotOptions = useCallback(() => {
    const now = Date.now()

    const dataTimeMinMax = getDataTimeMinMax()
    const data = calculateSimplifyedData()
    const retentionUsed = getRetentionUsed()
    const retentionTimeMs = getRetentionTimeMs()

    return {
      ...g2PlotDefaults,
      ...(retentionUsed ? {padding: [22, 28]} : {}),
      ...opts,
      xAxis: {
        ...g2PlotDefaults?.xAxis,
        ...dataTimeMinMax,
        ...(typeof dataTimeMinMax === 'object'
          ? {
              tickMethod: () =>
                retentionUsed
                  ? linearScale(
                      now - retentionTimeMs,
                      dataTimeMinMax.max,
                      8
                    ).map(Math.round)
                  : linearScale(dataTimeMinMax.min, dataTimeMinMax.max, 8).map(
                      Math.round
                    ),
            }
          : {}),
        ...(retentionUsed
          ? {
              min: now - retentionTimeMs,
              // tickMethod: 'wilkinson-extended',
              // tickMethod: 'time-cat',
            }
          : {}),
        mask: getMask(),
        ...opts?.xAxis,
      },
      ...(ctor !== Gauge
        ? {data}
        : {percent: getLatestDataPoint()?.value ?? 0}),
    }
  }, [
    opts,
    ctor,
    calculateSimplifyedData,
    getDataTimeMinMax,
    getLatestDataPoint,
    getMask,
    getRetentionTimeMs,
    getRetentionUsed,
  ])

  useEffect(() => {
    if (!elementRef.current) return
    plotRef.current?.destroy()
    plotRef.current = new ctor(elementRef.current, getPlotOptions())
    plotRef.current.render()
  }, [ctor, getPlotOptions])

  const redraw = useRafOnce(
    useCallback(() => {
      plotRef.current?.update?.(getPlotOptions())
    }, [getPlotOptions])
  )
  useEffect(redraw, [redraw])

  const invalidate = useRafOnce(
    useRef(() => {
      // todo: don't redraw when window not visible
      plotRef.current?.changeData?.(
        ctor === Gauge
          ? getLatestDataPoint()?.value ?? 0
          : calculateSimplifyedData()
      )
    }).current
  )

  const update: G2PlotUpdater = (newData) => {
    // TODO: don't store all rows for gauge
    updateData(newData ? asArray(newData) : undefined)

    if (ctor === Gauge) invalidate()
    else redraw()
  }

  const plotObjRef = useRef({element, update} as const)

  return plotObjRef.current
}

type G2PlotParams = {
  type: PlotConstructor
  options?: G2PlotOptionsNoData<any>
  onUpdaterChange: (updater: G2PlotUpdater) => void
  retentionTimeMs?: number
}

export const G2Plot: React.FC<G2PlotParams> = (params) => {
  const {element, update} = useG2Plot(
    params.type,
    params.options,
    params.retentionTimeMs
  )
  useEffect(() => {
    params.onUpdaterChange(update)
  }, [params, update])

  return <>{element}</>
}

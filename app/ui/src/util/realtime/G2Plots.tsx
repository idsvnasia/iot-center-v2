import React from 'react'
import {useCallback, useEffect, useRef} from 'react'
import {Gauge, Plot} from '@antv/g2plot'
import {
  DiagramEntryPoint,
  useLastDiagramEntryPointGetter,
  simplifyDiagramEntryPointToMaxPoints,
  linearScale,
  useRafOnce,
  asArray,
  pushBigArray,
  applyRetention,
  getMinMaxDataTime,
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
export type G2PlotUpdater<PlotType> = (
  newData:
    | undefined
    | DiagramEntryPoint
    | DiagramEntryPoint[]
    | (PlotType extends Gauge ? number : never)
) => void

type G2PlotHook = {
  readonly element: JSX.Element
  readonly update: G2PlotUpdater<Plot<any>>
}

export const useG2Plot = (
  ctor: PlotConstructor,
  opts?: Omit<ConstructorParameters<PlotConstructor>[1], 'data' | 'percent'>,
  retentionTimeMs = Infinity
): G2PlotHook => {
  type PlotType = InstanceType<PlotConstructor>

  // todo: use one ref for everything
  const plotRef = useRef<PlotType>()
  const dataRef = useRef<DiagramEntryPoint[] | number | undefined>()
  const maskRef = useRef(maskTime)
  const getLastPoint = useLastDiagramEntryPointGetter()

  const elementRef = useRef<HTMLDivElement>(null)
  const element = <div ref={elementRef} />

  const retentionTimeRef = useRef(retentionTimeMs)
  const retentionUsed = () =>
    retentionTimeRef.current !== Infinity && retentionTimeRef.current > 0
  const getSimplifyedData = () =>
    simplifyDiagramEntryPointToMaxPoints(dataRef.current as DiagramEntryPoint[])

  const getPlotOptions = useCallback(() => {
    const data = dataRef.current
    const now = Date.now()

    const dataTimeMinMax = getMinMaxDataTime(data, getLastPoint)
    return {
      ...g2PlotDefaults,
      ...(retentionUsed() ? {padding: [22, 28]} : {}),
      ...opts,
      xAxis: {
        ...g2PlotDefaults?.xAxis,
        ...dataTimeMinMax,
        ...(typeof dataTimeMinMax === 'object'
          ? {
              tickMethod: () =>
                retentionUsed()
                  ? linearScale(
                      now - retentionTimeRef.current,
                      dataTimeMinMax.max,
                      8
                    ).map(Math.round)
                  : linearScale(dataTimeMinMax.min, dataTimeMinMax.max, 8).map(
                      Math.round
                    ),
            }
          : {}),
        ...(retentionUsed()
          ? {
              min: now - retentionTimeRef.current,
              // tickMethod: 'wilkinson-extended',
              // tickMethod: 'time-cat',
            }
          : {}),
        mask: maskRef.current,
        ...opts?.xAxis,
      },
      ...(typeof data === 'number' ? {percent: data} : {}),
      ...(Array.isArray(data) ? {data: getSimplifyedData()} : {}),
    }
  }, [opts, getLastPoint])

  useEffect(() => {
    retentionTimeRef.current = retentionTimeMs
  }, [retentionTimeMs])

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
      const data = dataRef.current

      if (data === undefined) {
        if (ctor === Gauge) {
          plotRef.current?.changeData(0)
        } else {
          plotRef.current?.changeData?.([])
        }
      } else if (typeof data === 'number') plotRef.current?.changeData?.(data)
      else plotRef.current?.changeData?.(getSimplifyedData())
    }).current
  )

  const updateMask = () => {
    if (!Array.isArray(dataRef.current)) return false

    const prevMask = maskRef.current

    if (dataRef.current.some((x) => x.time < Date.now() - 3 * DAY_MILLIS))
      maskRef.current = maskDate
    else if (dataRef.current.some((x) => x.time < Date.now() - DAY_MILLIS))
      maskRef.current = maskDateTime
    else maskRef.current = maskTime

    return prevMask !== maskRef.current
  }

  const update: G2PlotUpdater<PlotType> = (newData) => {
    if (newData === undefined || typeof newData === 'number') {
      getLastPoint.reset()
      dataRef.current = newData
    } else if (ctor === Gauge)
      dataRef.current = getLastPoint(asArray(newData))?.value
    else if (Array.isArray(dataRef.current))
      pushBigArray(dataRef.current, asArray(newData))
    else dataRef.current = asArray(newData)

    if (Array.isArray(dataRef.current))
      applyRetention(dataRef.current, retentionTimeRef.current)

    updateMask()

    if (ctor === Gauge) invalidate()
    else redraw()
  }

  const plotObjRef = useRef({element, update} as const)

  return plotObjRef.current
}

type G2PlotParams = {
  type: PlotConstructor
  options?: G2PlotOptionsNoData<any>
  onUpdaterChange: (updater: G2PlotUpdater<Plot<any>>) => void
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

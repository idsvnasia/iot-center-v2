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
  throwReturn,
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

export type G2PlotHook = {
  readonly element: JSX.Element
  readonly update: G2PlotUpdater
}

export const useG2Plot = (
  ctor: PlotConstructor,
  opts?: Omit<ConstructorParameters<PlotConstructor>[1], 'data' | 'percent'>,
  retentionTimeMs = Infinity
): G2PlotHook => {
  const plotRef = useRef<InstanceType<PlotConstructor>>()
  const state = useRef(new G2PlotState()).current

  const elementRef = useRef<HTMLDivElement>(null)
  const element = <div ref={elementRef} />

  useEffect(() => {
    state.retentionTimeMs = retentionTimeMs
  }, [retentionTimeMs, state])

  const getPlotOptions = useCallback(() => {
    const now = Date.now()

    const {dataTimeMinMax, retentionUsed, retentionTimeMs, mask} = state

    const dataObj =
      ctor !== Gauge
        ? {data: state.calculateSimplifyedData()}
        : {percent: state.latestDataPoint?.value ?? 0}

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
        mask,
        ...opts?.xAxis,
      },
      ...dataObj,
    }
  }, [opts, ctor, state])

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
      plotRef.current?.changeData?.(
        ctor === Gauge
          ? state.latestDataPoint?.value ?? 0
          : state.calculateSimplifyedData()
      )
    }).current
  )

  const update: G2PlotUpdater = (newData) => {
    state.updateData(newData ? asArray(newData) : undefined)

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

// TODO: data should be stored and managed globaly -> no duplicit data/calcualtions (when same data used in more plots), we can store data globaly and decide what plots to draw later (user can modify dasboard without need to fetch again)
/**
 * state management for G2Plot-realtime, ensures caching for rerendering
 */
class G2PlotState {
  private _data: DiagramEntryPoint[] | undefined = undefined
  private _retentionTimeMs = Infinity
  private _cache: Cache<G2PlotState>

  get retentionTimeMs(): number {
    return this._retentionTimeMs
  }

  set retentionTimeMs(ms: number) {
    this._retentionTimeMs = ms
    this.applyRetentionOnData()
  }

  get retentionUsed() {
    return this._retentionTimeMs !== Infinity && this._retentionTimeMs > 0
  }

  applyRetentionOnData() {
    if (!this._data) return
    const l0 = this._data.length
    applyRetention(this._data, this._retentionTimeMs)
    const l1 = this._data.length
    if (l0 !== l1) this._cache.clear()
  }

  updateData(newData: DiagramEntryPoint[] | undefined) {
    if (newData === undefined) this._data = undefined
    else {
      if (this._data === undefined) this._data = []
      pushBigArray(this._data, newData)
    }
    this.applyRetentionOnData()
  }

  calculateSimplifyedData() {
    return this._data ? simplifyDiagramEntryPointToMaxPoints(this._data) : []
  }

  get dataTimeMinMax() {
    return this._data?.length
      ? getMinAndMax(this._data.map((x) => x.time))
      : undefined
  }

  get latestDataPoint() {
    const minMax = this.dataTimeMinMax
    if (!minMax || !this._data) return undefined
    const {max} = minMax
    return this._data.find((x) => x.time === max)
  }

  get mask() {
    if (!this._data) return ''
    if (this._data.some((x) => x.time < Date.now() - 3 * DAY_MILLIS))
      return maskDate
    if (this._data.some((x) => x.time < Date.now() - DAY_MILLIS))
      return maskDateTime
    return maskTime
  }

  constructor() {
    this._cache = new Cache<G2PlotState>(this)
      .cache('calculateSimplifyedData')
      .cache('mask')
      .cache('dataTimeMinMax')
      .cache('latestDataPoint')
      .clearOn('updateData')
  }
}

type MethodWithoudPars<T> = {
  [P in keyof T]: T[P] extends () => any ? P : never
}[keyof T]
type NonMethodProps<T> = {
  [P in keyof T]: T[P] extends (...args: any[]) => any ? never : P
}[keyof T]

class Cache<T> {
  private _obj: T
  private _cache = new Map<string, any>()
  private _cached<TReturn>(fnc: (() => TReturn) | undefined, key: string) {
    if (!fnc) throw new Error('function must be defined')
    if (typeof fnc !== 'function')
      throw new Error(`expected function, got ${fnc}`)
    if (fnc.length !== 0)
      throw new Error(`only functions without arguments currently supported`)
    ;(this.cachedKeys as string[]).push(key)

    return () => {
      if (!this._cache.has(key)) this._cache.set(key, fnc())
      return this._cache.get(key) as TReturn
    }
  }

  private _clearOn<TArgs extends any[], TReturn>(
    fnc: (...args: TArgs) => TReturn
  ) {
    return (...args: TArgs) => {
      this.clear()
      return fnc(...args)
    }
  }

  private _getDescriptorFor(key: keyof T) {
    return (
      Object.getOwnPropertyDescriptor(this._obj, key) ??
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this._obj), key) ??
      throwReturn(`property or method ${key} not found`)
    )
  }

  private _overrideDescriptor(
    key: keyof T,
    newDesc: Partial<PropertyDescriptor>
  ) {
    const desc = this._getDescriptorFor(key)
    Object.defineProperties(this._obj, {
      [key]: {
        ...desc,
        ...newDesc,
      },
    })
  }

  public readonly cachedKeys: readonly string[] = []

  public clear() {
    this._cache.clear()
  }

  /**
   * calls of this getters/methods will be cached
   * doesn't support methods with parameters!
   */
  public cache(key: MethodWithoudPars<T> | NonMethodProps<T>) {
    const desc = this._getDescriptorFor(key)

    this._overrideDescriptor(
      key,
      desc.get
        ? {get: this._cached(desc.get.bind(this._obj), `get.${key}`)}
        : desc.value
        ? {value: this._cached(desc.value.bind(this._obj), `fnc.${key}`)}
        : throwReturn<any>(`${key} is not property nor method`)
    )

    return this
  }

  /**
   * clear whole cache when given method/setter is called
   */
  public clearOn(key: keyof T) {
    const desc = this._getDescriptorFor(key)

    this._overrideDescriptor(
      key,
      desc.set
        ? {set: this._clearOn(desc.set.bind(this._obj))}
        : desc.value
        ? {value: this._clearOn(desc.value.bind(this._obj))}
        : throwReturn<any>(`${key} is not property nor method`)
    )

    return this
  }

  constructor(obj: T) {
    this._obj = obj
  }
}

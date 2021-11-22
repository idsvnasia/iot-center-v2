import {Gauge, Plot} from '@antv/g2plot'
import React, {useCallback, useEffect, useRef} from 'react'
import {simplifyForNormalizedData} from './simplyfi'
import * as leaflet from 'leaflet'
import {AntPath, LatLng} from 'leaflet-ant-path'

const DAY_MILLIS = 24 * 60 * 60 * 1000

const linearScale = (min: number, max: number, len: number) => {
  const step = (max - min) / (len - 1)
  const arr = [min]
  for (let i = 1; i < len - 1; i++) {
    arr.push(min + step * i)
  }
  arr.push(max)
  return arr
}

export type MinAndMax = {min: number; max: number}
export const getMinAndMax = (arr: number[]): MinAndMax => {
  let min = Infinity
  let max = -Infinity
  for (const i of arr) {
    if (min > i) min = i
    if (max < i) max = i
  }
  return {min, max}
}

const normalize = (arr: number[], minAndMax: MinAndMax, inverse = false) => {
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

const simplifyDiagramEntryPoint = (
  arr: DiagramEntryPoint[],
  epsilon: number
) => {
  const lines: Record<string, {xs: number[]; ys: number[]}> = {}

  for (let i = arr.length; i--; ) {
    const {key, time, value} = arr[i]
    if (!lines[key]) lines[key] = {xs: [], ys: []}
    lines[key].xs.push(time)
    lines[key].ys.push(value)
  }

  return Object.entries(lines).flatMap(([key, {xs, ys}]) => {
    const [xss, yss] = simplify(xs, ys, epsilon)
    const entryPoints: DiagramEntryPoint[] = new Array(xss.length)

    for (let i = xss.length; i--; ) {
      const time = xss[i]
      const value = yss[i]
      entryPoints[i] = {key, time, value}
    }

    return entryPoints
  })
}

const simplifyDiagramEntryPointToMaxPoints = (
  arr: DiagramEntryPoint[],
  points = 1000,
  minimalPoints = 200
) => {
  if (arr.length < points) return arr

  const s = simplifyDiagramEntryPoint

  let low = {arr, epsiolon: 0}
  let high = {arr: s(arr, 1), epsiolon: 1}

  for (let i = 15; i--; ) {
    const halfDist = (high.epsiolon - low.epsiolon) / 2
    const center = halfDist + low.epsiolon

    const newArr = s(arr, center)

    // console.log(`${i.toString().padStart(2)} ${low.arr.length.toString().padStart(8)} ${newArr.length.toString().padStart(8)} ${high.arr.length.toString().padStart(8)}`)
    // console.log(`   ${low.epsiolon.toFixed(6).padStart(8)} ${center.toFixed(6).padStart(8)} ${high.epsiolon.toFixed(6).padStart(8)}`)

    // epsilon is low significant that it's no longer differs array size
    if (low.arr.length === newArr.length) break

    if (newArr.length < points) {
      high = {arr: newArr, epsiolon: center}
    } else {
      low = {arr: newArr, epsiolon: center}
    }

    // we are close enough to stop algorithm
    if (Math.floor(high.arr.length / 10) === Math.floor(points / 10)) break
  }

  // alternative way for straight lines
  // todo: test more
  if (high.arr.length < minimalPoints) {
    const step = arr.length / minimalPoints
    const newArr = [arr[0]]
    for (let i = 1; i < minimalPoints - 1; i++) {
      newArr.push(arr[Math.floor(i * step)])
    }
    newArr.push(arr[arr.length - 1])

    return newArr
  }

  return high.arr
}

export type DiagramEntryPoint = {
  value: number
  time: number
  key: string
}

export const useWebSocket = (
  callback: (ws: WebSocket) => void,
  url: string,
  running = true
): void => {
  const wsRef = useRef<WebSocket>()

  const startListening = useCallback(() => {
    console.log('starting WebSocket')
    wsRef.current = new WebSocket(url)
    callback(wsRef.current)
  }, [callback, url])

  useEffect(() => {
    if (running) {
      startListening()
      return () => wsRef.current?.close?.()
    }
  }, [startListening, running])

  useEffect(() => {
    // reconnect a broken WS connection
    const checker = setInterval(() => {
      if (
        running &&
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.CLOSING ||
          wsRef.current.readyState === WebSocket.CLOSED)
      ) {
        startListening()
      }
    }, 2000)
    return () => clearInterval(checker)
  }, [startListening, running])
}

const useRafOnce = (callback: () => void) => {
  const handleRef = useRef(-1)

  return useCallback(() => {
    cancelAnimationFrame(handleRef.current)
    handleRef.current = requestAnimationFrame(callback)
  }, [callback])
}

export const maskTime = 'hh:mm:ss'
export const maskDate = 'DD/MM/YY'
export const maskDateTime = `${maskDate} ${maskTime} `

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

export const useLastDiagramEntryPointGetter = (): {
  (points: DiagramEntryPoint[]): DiagramEntryPoint | undefined
  reset: () => void
} => {
  const lastPointRef = useRef<DiagramEntryPoint>()

  const getLastPoint = (points: DiagramEntryPoint[]) => {
    if (!points.length) return lastPointRef.current
    if (!lastPointRef.current) lastPointRef.current = points[0]

    for (const p of points) {
      if (lastPointRef.current.time < p.time) {
        lastPointRef.current = p
      }
    }

    return lastPointRef.current
  }

  getLastPoint.reset = () => {
    lastPointRef.current = undefined
  }

  return getLastPoint
}

const asArray = <T,>(value: T[] | T): T[] =>
  Array.isArray(value) ? value : [value]

const applyRetention = (arr: DiagramEntryPoint[], retentionTimeMs: number) => {
  if (retentionTimeMs === Infinity || retentionTimeMs === 0) return
  if (retentionTimeMs < 0)
    throw new Error(`retention time has to be bigger than zero`)

  const now = Date.now()
  const cutTime = now - retentionTimeMs

  for (let i = arr.length; i--; ) {
    if (arr[i].time < cutTime) {
      // TODO: splice is slow, replace with faster removing
      arr.splice(i, 1)
    }
  }
}

const getMinMaxDataTime = (
  data: number | DiagramEntryPoint[] | undefined,
  getLastPoint: ReturnType<typeof useLastDiagramEntryPointGetter>
) => {
  if (data === undefined) return undefined
  if (typeof data === 'number') {
    const time = getLastPoint([])?.time
    if (time) return {min: time, max: time}
    return undefined
  }
  if (!data.length) return undefined
  return getMinAndMax(data.map((x) => x.time))
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

/**
 * [lat, lng, time]
 */
export type TimePoint = [number, number, number]

export class TimeMap {
  private _points: TimePoint[] = []
  private _dragable = false

  public retentionTime = Infinity

  public addPoints(points: TimePoint[]): void {
    const newPoints = points.filter(
      (y) => !this._points.some((x) => x[0] === y[0] && x[1] === y[1])
    )
    if (!newPoints.length) {
      this.update()
      // point already exists
      return
    }
    pushBigArray(this._points, newPoints)
    this.setPoints(this._points)
  }

  public addPoint(point: TimePoint): void {
    this.addPoints([point])
  }

  public clear(): void {
    this.setPoints([])
  }

  public setPoints(points: TimePoint[]): void {
    this._points = points
    this.update()
  }

  public update(): void {
    cancelAnimationFrame(this.rafHandle)
    this.rafHandle = requestAnimationFrame(this._update.bind(this))
  }

  private rafHandle = -1
  private _update() {
    if (!this._path || !this._map || !this._marker) return

    this.applyRetention()
    this._points.sort((a, b) => a[2] - b[2])
    this._path.setLatLngs(this._points as any)

    if (this._points.length) {
      const last = (this._points[this._points.length - 1] as any) as LatLng
      try {
        this._map.setView(last as any, this._map.getZoom(), {
          animate: true,
          pan: {
            duration: 1,
          },
        } as any)
        this._marker.setLatLng(last)
      } catch (e: any) {
        // manipulating map properties can throw an error when map no longer exist
        console.warn(
          `error thrown by leaflet map: ${
            e?.message ?? e ?? 'unspecific error'
          }`
        )
      }
    } else {
      this._marker.setLatLng([0, 0])
    }
  }

  private applyRetention(): void {
    const retentionTimeMs = this.retentionTime
    const arr = this._points

    if (retentionTimeMs === Infinity || retentionTimeMs === 0) return
    if (retentionTimeMs < 0)
      throw new Error(`retention time has to be positive number`)

    const now = Date.now()
    const cutTime = now - retentionTimeMs

    for (let i = arr.length; i--; ) {
      if (arr[i][2] < cutTime) {
        // TODO: splice is slow, replace with faster removing
        arr.splice(i, 1)
      }
    }
  }

  public setDragable(dragable: boolean): void {
    this._dragable = dragable
    if (this._map) this._map.options.dragging = dragable
  }

  private _map?: leaflet.Map
  private _marker?: leaflet.Marker
  private _path?: AntPath

  public setContiner(container: HTMLElement | undefined): void {
    if (this._map) this._map.remove()
    if (!container) return

    const point: [number, number] = this._points?.length
      ? (this._points[this._points.length - 1] as any)
      : [51.4921374, -0.1928784]
    const map = leaflet
      .map(container, {scrollWheelZoom: false, dragging: this._dragable})
      .setView(point, 13)

    leaflet
      .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      })
      .addTo(map)

    this._map = map
    this._marker = leaflet.marker([0, 0]).addTo(map)
    this._path = new AntPath([]).addTo(map)

    // fix for dynamic layouts
    setTimeout(() => window.dispatchEvent(new Event('resize')), 2000)

    this.update()
  }
}

export const useMap = (): {
  mapRef: React.MutableRefObject<TimeMap>
  mapElement: JSX.Element
} => {
  const mapRef = useRef(new TimeMap())
  const geoContainerRef = useRef<HTMLDivElement>(null)

  const mapElement = (
    <div
      style={{
        width: '100%',
        height: '100%',
      }}
      ref={geoContainerRef}
    />
  )

  useEffect(() => {
    if (!geoContainerRef.current) return
    mapRef.current.setContiner(geoContainerRef.current)
  })

  useEffect(() => {
    const map = mapRef.current
    return () => map.setContiner(undefined)
  }, [])

  return {mapRef, mapElement}
}

/**
 * using spred operator (Array.push(...items))
 * function can exceed callback for big arrays.
 * Use this method instead
 */
export const pushBigArray = <T,>(self: T[], arr2: T[]): void => {
  const arr2len = arr2.length
  const newLen = self.length + arr2len
  self.length = newLen
  let i = newLen
  for (let j = arr2len; j--; ) {
    i--
    self[i] = arr2[j]
  }
}

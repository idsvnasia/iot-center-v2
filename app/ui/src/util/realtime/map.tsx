import React, {useEffect, useRef} from 'react'
import * as leaflet from 'leaflet'
import {AntPath, LatLng} from 'leaflet-ant-path'
import {pushBigArray} from './utils'

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
        // TODO: don't do small movement with animation or don't do them at all
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

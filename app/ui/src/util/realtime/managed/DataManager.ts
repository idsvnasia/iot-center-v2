import { applyRetention, DiagramEntryPoint, getMinAndMax, pushBigArray, simplifyDiagramEntryPointToMaxPoints } from "."

const DAY_MILLIS = 24 * 60 * 60 * 1000

const maskTime = 'hh:mm:ss'
const maskDate = 'DD/MM/YY'
const maskDateTime = `${maskDate} ${maskTime} `

/**
 * helper for throwing error from expression
 */
const throwReturn = <T,>(msg: string): NonNullable<T> => {
  throw new Error(msg)
}

type TimeValue = [number, number]

type DataManagerData = Record<string, TimeValue[]>

export type DataManagerOnChangeEvent = {
  self: DataManager,
  /** all keys with changed data (added/removed) */
  changedKeys: string[],
  /** all keys with changed data entry with highest time (added/removed) */
  lastValueChangedKeys: string[],
  /** if retention was changed */
  retentionChanged: boolean,
}
/**
 * state management for realtime components
 * encapsulates logic for
 *  - retention time based on current time
 *  - simplification
 *  - merge lat/lon for map
 *  - interval redraw when no new data sent
 */
export class DataManager {
  private _data: DataManagerData = {}
  private _dataLastUpdated: Record<string, number> = {};
  private _retentionTimeMs = Infinity
  private _retentionTimeMsLastUpdated = 0

  get availebleFields(): string[] {
    throw new Error("not implemented")
  }

  public addOnChange(fnc: (e: DataManagerOnChangeEvent) => void) {
    throw new Error("not implemented")
  }

  public removeOnChange() {
    throw new Error("not implemented")
  }

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

  // TODO: rename ?
  /** returns range where max=now, min=max-retentionTime */
  get timeReference() {
    throw new Error("not implemented")
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
    const { max } = minMax
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
}

import { DiagramEntryPoint, getMinAndMax, MinAndMax, pushBigArray, simplifyDiagramEntryPointToMaxPoints } from "."

const DAY_MILLIS = 24 * 60 * 60 * 1000

const maskTime = 'hh:mm:ss'
const maskDate = 'DD/MM/YY'
const maskDateTime = `${maskDate} ${maskTime} `

type TimeValue = [number, number]

type TimeValueLines = Record<string, TimeValue[]>

export type DataManagerOnChangeEvent = {
  target: DataManager,
  /** all keys with changed data (added/removed) */
  changedKeys: string[],
  /** all keys with changed data entry with highest time (added/removed) */
  lastValueChangedKeys: string[],
  retentionChanged: boolean,
  timeWindowChanged: boolean,
}
export type DataManagerDataChangedCallback = (e: DataManagerOnChangeEvent) => void;

const keysToString = (keys: string[]) => [...keys].sort().map(x => x.replaceAll(",", "\\,")).join(", ")
// TODO: fix keys with \,
const stringToKeys = (string: string) => string.split(", ")

const mergeMinMax = (...mms: (MinAndMax | undefined)[]): MinAndMax | undefined => {
  if (!mms.some(x => x)) return undefined
  let min = Infinity
  let max = -Infinity
  for (let i = mms.length; i--;) {
    const mm = mms[i];
    if (!mm) continue;
    min = Math.min(min, mm.min);
    max = Math.max(max, mm.max);
  }
  return { min, max };
}

const sortLine = (arr: TimeValue[]) => { arr.sort((a, b) => a[0] - b[0]) }

const containsSame = <T>(arr: T[], arr2: T[]) =>
  arr.some(x => arr2.some(y => x === y))

const timeValueLinesToDiagramEntryPoint = (lines: TimeValueLines, keys: string[] | undefined = undefined) => {
  const nonNullKeys = (keys ?? Object.keys(lines))

  const len = nonNullKeys.map(x => lines[x].length || 0).reduce((a, b) => a + b, 0);
  const arr: DiagramEntryPoint[] = new Array(len);
  let lastIndex = 0;

  nonNullKeys.forEach(x => {
    const line = lines[x]
  })
}

const DiagramEntryPointsToTimeValueLines = (arr: DiagramEntryPoint[]) => {
  const len = arr.length;
  const lines: TimeValueLines = {}
  for (let i = 0; i < len; i++) {
    const entry = arr[i];
    if (!lines[entry.key]) lines[entry.key] = [];
    const line = lines[entry.key];
    line.push([entry.time, entry.value])
  }
  Object.values(lines).forEach(sortLine)
  return lines;
}

const pushTimeValueLines = (self: TimeValueLines, second: TimeValueLines) => {
  Object.entries(second).forEach(([key, newLineData]) => {
    if (newLineData.length === 0) return;

    const line = self[key];
    if (!line) {
      self[key] = []
      pushBigArray(self[key], newLineData)
    } else if (line.length === 0) {
      pushBigArray(self[key], newLineData)
    } else {
      const isOverlaping = line[line.length - 1][0] > newLineData[0][0];
      pushBigArray(self[key], newLineData)
      if (isOverlaping) {
        sortLine(line)
      }
    }
  });
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
  private _data: TimeValueLines = {}
  private _dataLastUpdated: Record<string, number> = {};
  private _retentionTimeMs = Infinity
  private _retentionTimeMsLastUpdated = 0

  get availebleFields(): string[] {
    throw new Error("not implemented")
  }

  private readonly _onChangeCallbacks: DataManagerDataChangedCallback[] = []

  public addOnChange(fnc: DataManagerDataChangedCallback) {
    this._onChangeCallbacks.push(fnc);
  }

  public removeOnChange(fnc: DataManagerDataChangedCallback) {
    const i = this._onChangeCallbacks.findIndex(x => x === fnc);
    if (i !== -1) {
      this._onChangeCallbacks.splice(i, 1);
    }
  }

  private _callOnChange() {
    this._onChangeCallbacks.forEach(callback => 
      // todo: optimize by checking what realy changed
      callback({
        changedKeys: Object.keys(this._data),
        lastValueChangedKeys: Object.keys(this._data),
        retentionChanged: true,
        target: this,
        timeWindowChanged: true,
      })
    )
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

  /** returns range where max=now, min=max-retentionTime */
  get liveTimeWindow(): MinAndMax | undefined {
    if (this.retentionUsed)
      return { max: Date.now(), min: Date.now() - this.retentionTimeMs }
  }

  public timeWindowRasterSize = 100;
  /** similar to liveTimeWindow but rasterized */
  get timeWindow(): MinAndMax | undefined {
    const window = this.liveTimeWindow;
    if (window) {
      const { min, max } = window;
      const r = this.timeWindowRasterSize;
      const minr = Math.floor(min / r) * r;
      const maxr = Math.ceil(max / r) * r;
      return { min: minr, max: maxr };
    }
  }

  applyRetentionOnData() {
    const window = this.timeWindow;
    if (!window) return;
    const cutTime = window.min;

    const changedKeys = Object.entries(this._data).filter(([_field, entriesArr]) => {
      const len = entriesArr.length
      let toRemove = -1;
      while (++toRemove < len
        && entriesArr[toRemove][0] < cutTime)
        ;
      entriesArr.splice(0, toRemove);
      return (toRemove > 0)
    }).map(x => x[0])
    this._clearSimplifiedCacheForKeys(changedKeys)
  }

  updateData(newData: DiagramEntryPoint[] | undefined) {
    if (newData === undefined) this._data = {}
    else {
      const newLines = DiagramEntryPointsToTimeValueLines(newData);
      pushTimeValueLines(this._data, newLines);
      this._clearSimplifiedCacheForKeys(Object.keys(newLines));
    }
    this.applyRetentionOnData()
    this._callOnChange()
  }

  private _simplifiedDataCache: Record<string, DiagramEntryPoint[]> = {}
  private _clearSimplifiedCacheForKeys(keys: string[]) {
    const k = this._simplifiedDataCache;
    Object.keys(k)
      .filter(x => containsSame(stringToKeys(x), keys))
      .forEach(x => {
        delete k[x]
      })
  }

  calculateSimplifyedData(keys: string[]): DiagramEntryPoint[] {
    const key = keysToString(keys);

    if (this._simplifiedDataCache[key]) return this._simplifiedDataCache[key]

    if (!keys.length) {
      return [];
    } else if (keys.length > 1) {
      this._simplifiedDataCache[key] =
        ([] as DiagramEntryPoint[])
          .concat(...keys.map(x => this._simplifiedDataCache[x]))
          .sort((a, b) => a.time - b.time)
    } else {
      const data = this._data[key];
      this._simplifiedDataCache[key] =
        data ?
          simplifyDiagramEntryPointToMaxPoints(data.map(([time, value]) => ({ time, value, key })))
          : []
    }

    return this._simplifiedDataCache[key]
  }

  getDataTimeMinMax(keys: string[] | string): MinAndMax | undefined {
    if (Array.isArray(keys)) { return mergeMinMax(...keys.map(x => this.getDataTimeMinMax(x))) }
    const line = this._data[keys];
    const len = line?.length;
    return len ? { min: line[0][0], max: line[len - 1][0] } : undefined
  }

  getLatestDataPoint(keys: string[] | string): DiagramEntryPoint | undefined {
    if (Array.isArray(keys)) {
      const points = keys.map(x => this.getLatestDataPoint(x))
      const maxTime = Math.max(-1, ...points.map(x => x?.time).filter(x => x) as number[]);
      return points.find(p => p?.time === maxTime);
    }
    const line = this._data[keys];
    const lastPoint = line?.[line?.length - 1];
    return lastPoint ? { key: keys, time: lastPoint[0], value: lastPoint[1] } : undefined
  }

  getMask(keys: string[] | string): string {
    const minMax = this.getDataTimeMinMax(keys);
    if (!minMax) return ''
    const { max, min } = minMax;
    if (min + 3 * DAY_MILLIS < max)
      return maskDate
    else if (min + DAY_MILLIS < max)
      return maskDateTime
    else return maskTime
  }
}

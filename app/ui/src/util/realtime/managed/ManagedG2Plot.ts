import { Gauge, Plot } from "@antv/g2plot"
import { DataManager, DataManagerOnChangeEvent, linearScale } from "."

export type PlotConstructor = new (...args: any[]) => Plot<any>
export type G2PlotOptionsNoData<T> = Omit<
  ConstructorParameters<new (...args: any[]) => Plot<T>>[1],
  'data' | 'percent'
>

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

const containsAtLeastOneSameValue = <T>(arr: T[], arr2: T[]) => {
  for (let i = arr.length; i--;) {
    for (let j = arr2.length; j--;) {
      if (arr[i] === arr[j])
        return true;
    }
  }
  return false;
}

const mapValueToRange = (min: number, max: number, value: number) => (value - min) / (max - min);

export class ManagedG2Plot {
  public element: HTMLElement
  public ctor: PlotConstructor
  public options: G2PlotOptionsNoData<any> = {}
  public keys: string[] = []

  private _plot?: InstanceType<PlotConstructor>

  /**
   * render G2Plot on current element
   */
  render() {
    this._plot?.destroy()
    this._plot = new this.ctor(this.element, this._getOptions())
    this._plot.render()
  }

  /**
   * redraw G2Plot with current options
   */
  redraw() {
    cancelAnimationFrame(this._redrawHandle);
    this._redrawHandle = requestAnimationFrame(this._redraw.bind(this))
  }
  private _redrawHandle = -1;
  private _redraw() {
    this._plot?.update?.(this._getOptions())
  }

  private _getData() {
    const manager = this._manager;

    if (this.ctor !== Gauge) {
      return manager.calculateSimplifyedData(this.keys)
    } else {
      const min = this.options?.min as number | undefined
      const max = this.options?.max as number | undefined
      const value = manager.getLatestDataPoint(this.keys)?.value ?? 0

      if (min == null || max == null)
        return value
      else {
        return mapValueToRange(min, max, value)
      }
    }
  }

  /**
   * redraw G2Plot with current data
   */
  invalidate() {
    cancelAnimationFrame(this._invalidateHandle);
    this._invalidateHandle = requestAnimationFrame(this._invalidate.bind(this))
  }
  private _invalidateHandle = -1;
  private _invalidate() {
    const manager = this._manager;
    this._plot?.changeData?.(
      this._getData()
    )
  }

  private _getOptions() {
    const manager = this._manager;
    const window = manager.liveTimeWindow

    const mask = manager.getMask(this.keys);
    const retentionUsed = manager.retentionUsed;

    const data = this._getData();

    const dataObj =
      this.ctor !== Gauge
        ? { data }
        : { percent: data }

    return {
      ...g2PlotDefaults,
      ...(retentionUsed ? { padding: [22, 28] } : {}),
      ...this.options,
      xAxis: {
        ...g2PlotDefaults?.xAxis,
        ...window,
        ...(typeof window === 'object'
          ? {
            tickMethod: () =>
              retentionUsed
                ? linearScale(
                  window.min,
                  window.max,
                  8
                ).map(Math.round)
                : linearScale(window.min, window.max, 8).map(
                  Math.round
                ),
          }
          : {}),
        ...(retentionUsed
          ? {
            min: window?.min || 0,
            // tickMethod: 'wilkinson-extended',
            // tickMethod: 'time-cat',
          }
          : {}),
        mask,
        ...this.options?.xAxis,
      },
      ...dataObj,
    }
  }

  update() {
    if (this.ctor === Gauge) this.invalidate()
    else this.redraw()
  }

  private _manager: DataManager
  setManager(manager: DataManager) {
    if (this._manager) {
      this._manager.removeOnChange(this.onDataChanged)
    }
    this._manager = manager
    this._manager.addOnChange(this.onDataChanged)
  }

  onDataChanged(e: DataManagerOnChangeEvent) {
    if (this.ctor === Gauge) {
      if (!containsAtLeastOneSameValue(this.keys, e.lastValueChangedKeys))
        return;
    } else {
      if (!containsAtLeastOneSameValue(this.keys, e.changedKeys)
        && !e.retentionChanged
        && !e.timeWindowChanged
      ) return;
    }

    this.update();
  }

  constructor(manager: DataManager, ctor: PlotConstructor, element: HTMLElement) {
    this.onDataChanged = this.onDataChanged.bind(this);

    this._manager = undefined as any;
    this.setManager(manager);
    this.ctor = ctor;
    this.element = element;
  }
}


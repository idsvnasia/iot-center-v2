import { Gauge, Plot } from "@antv/g2plot"
import { DataManager, DataManagerOnChangeEvent, linearScale } from ".."
import { ManagedComponent } from "../ManagedComponent"

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

export class ManagedG2Plot extends ManagedComponent {
  public ctor: PlotConstructor
  public options: G2PlotOptionsNoData<any> = {}

  private _plot?: InstanceType<PlotConstructor>

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

  render() {
    this._plot?.destroy?.()
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

  /**
   * redraw G2Plot with current data
   */
  invalidate() {
    cancelAnimationFrame(this._invalidateHandle);
    this._invalidateHandle = requestAnimationFrame(this._invalidate.bind(this))
  }
  private _invalidateHandle = -1;
  private _invalidate() {
    this._plot?.changeData?.(
      this._getData()
    )
  }

  private _getOptions() {
    const manager = this._manager;

    const mask = manager.getMask(this.keys);
    const retentionUsed = manager.retentionUsed;
    const retentionTimeMs = manager.retentionTimeMs;

    const dataTimeMinMax = manager.getDataTimeMinMax(this.keys);

    const now = Date.now()

    const data = this._getData();

    const dataObj =
      this.ctor !== Gauge
        ? { data }
        : { percent: data }

    const res = {
      ...g2PlotDefaults,
      ...(retentionUsed ? {padding: [22, 28]} : {}),
      ...this.options,
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
        ...this.options?.xAxis,
      },
      ...dataObj,
    }

    return res;
  }

  update() {
    // if (this.ctor === Gauge) this.invalidate()
    // else 
    this.redraw()
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

  constructor(manager: DataManager, element: HTMLElement, ctor: PlotConstructor) {
    super(manager, element);
    this.ctor = ctor;
  }
}


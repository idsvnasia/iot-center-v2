import { DataManager, DataManagerOnChangeEvent } from "."

export abstract class ManagedComponent {
  private _element: HTMLElement
  public get element(): HTMLElement {
    return this._element
  }
  public set element(element: HTMLElement) {
    const changed = this._element !== element;
    this._element = element;
    if (changed)
      this.render();
  }
  public keys: string[] = []
  protected _manager!: DataManager

  private unregisterManager = () => { }
  public get manager(): DataManager {
    return this._manager
  }
  public set manager(manager: DataManager) {
    this.unregisterManager();
    const dataChangeBinded = this.onDataChanged.bind(this);
    this.unregisterManager = () =>
      this._manager?.removeOnChange?.(dataChangeBinded)
    this._manager = manager
    this._manager.addOnChange(dataChangeBinded)
  }

  protected abstract onDataChanged(e: DataManagerOnChangeEvent): void

  /** render component on current element, automaticaly called when element changes */
  public abstract render(): void

  constructor(manager: DataManager, element: HTMLElement) {
    this._element = element;
    
    this.manager = manager;
  }
}


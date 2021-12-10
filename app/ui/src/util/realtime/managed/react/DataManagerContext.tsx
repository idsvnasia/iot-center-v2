import React from "react";
import { DataManager } from "..";

const DataManagerContext = React.createContext<DataManager>(undefined as any as DataManager);

const DataManagerContextProvider = DataManagerContext.Provider

export const DataManagerContextConsumer = DataManagerContext.Consumer

export default DataManagerContextProvider

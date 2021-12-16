import React from "react";
import { DataManager } from "..";

export const DataManagerContext = React.createContext<DataManager>(undefined as any as DataManager);

const DataManagerContextProvider = DataManagerContext.Provider

export default DataManagerContextProvider

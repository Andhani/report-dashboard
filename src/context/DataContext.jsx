import { createContext, useContext } from "react";
import { useChunkedStorage } from "../hooks/useStorage";

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [flow1Data, setFlow1Data] = useChunkedStorage("flow1_data", {});
  const [flow2Data, setFlow2Data] = useChunkedStorage("flow2_data", {});

  return (
    <DataContext.Provider value={{ flow1Data, setFlow1Data, flow2Data, setFlow2Data }}>
      {children}
    </DataContext.Provider>
  );
}

export function useDataContext() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useDataContext must be used inside DataProvider");
  return ctx;
}

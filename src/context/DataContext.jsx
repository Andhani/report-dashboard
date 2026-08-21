import { createContext, useContext } from "react";
import { useChunkedCloudStorage } from "../hooks/useCloudStorage";

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [flow1Data, setFlow1Data, flow1Storage] = useChunkedCloudStorage(
    "flow1_data",
    {},
  );
  const [flow2Data, setFlow2Data, flow2Storage] = useChunkedCloudStorage(
    "flow2_data",
    {},
  );

  return (
    <DataContext.Provider
      value={{
        flow1Data,
        setFlow1Data,
        flow2Data,
        setFlow2Data,
        flow1MissingKeys: flow1Storage.missingKeys,
        flow2MissingKeys: flow2Storage.missingKeys,
        flow1WriteError: flow1Storage.writeError,
        flow2WriteError: flow2Storage.writeError,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useDataContext() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useDataContext must be used inside DataProvider");
  return ctx;
}

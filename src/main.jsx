import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { CloudDataProvider } from "./context/CloudDataContext";
import { DataProvider } from "./context/DataContext";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <CloudDataProvider>
          <DataProvider>
            <App />
          </DataProvider>
        </CloudDataProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Flow1 from "./pages/Flow1";
import Flow2 from "./pages/Flow2";
import Flow3 from "./pages/Flow3";
import UrlManager from "./pages/UrlManager";
import Settings from "./pages/Settings";
import AuthCallback from "./pages/AuthCallback";

export default function App() {
  return (
    <Routes>
      {/* OAuth callback — no layout */}
      <Route path="/auth/callback" element={<AuthCallback />} />

      {/* All other pages use the main layout */}
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/traffic-optimized" element={<Flow1 />} />
        <Route path="/traffic-overview" element={<Flow2 />} />
        <Route path="/leads-summary" element={<Flow3 />} />
        <Route path="/urls" element={<UrlManager />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

import { Routes, Route, Navigate } from "react-router-dom";
import { SetupPage } from "./pages/SetupPage.tsx";
import { WorkspacePage } from "./pages/WorkspacePage.tsx";
import { useHydration } from "./hooks/useHydration.ts";

export function App() {
  useHydration();

  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/workspace" element={<WorkspacePage />} />
      <Route path="*" element={<Navigate to="/setup" replace />} />
    </Routes>
  );
}

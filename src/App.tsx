import { Routes, Route, Navigate } from "react-router-dom";
import { SetupPage } from "./pages/SetupPage.tsx";
import { WorkspacePage } from "./pages/WorkspacePage.tsx";

export function App() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/workspace" element={<WorkspacePage />} />
      <Route path="*" element={<Navigate to="/setup" replace />} />
    </Routes>
  );
}

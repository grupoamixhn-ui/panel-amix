import "./index.css";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { BrandingProvider } from "./branding";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Streams from "./pages/Streams";
import Sessions from "./pages/Sessions";
import Stats from "./pages/Stats";
import Monitor from "./pages/Monitor";
import Resellers from "./pages/Resellers";
import Settings from "./pages/Settings";
import Pushes from "./pages/Pushes";
import Layout from "./components/Layout";

function Guard({ children }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="min-h-screen flex items-center justify-center mono text-xs text-[var(--muted)]">
        Authenticating…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function LoginRoute() {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;
  return <Login />;
}

export default function App() {
  return (
    <BrandingProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route path="/" element={<Guard><Dashboard /></Guard>} />
            <Route path="/streams" element={<Guard><Streams /></Guard>} />
            <Route path="/sessions" element={<Guard><Sessions /></Guard>} />
            <Route path="/stats" element={<Guard><Stats /></Guard>} />
            <Route path="/monitor" element={<Guard><Monitor /></Guard>} />
            <Route path="/resellers" element={<Guard><Resellers /></Guard>} />
            <Route path="/pushes" element={<Guard><Pushes /></Guard>} />
            <Route path="/settings" element={<Guard><Settings /></Guard>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </BrandingProvider>
  );
}

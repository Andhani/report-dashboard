import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function AdminRoute() {
  const { role } = useAuth();
  if (role !== "admin") return <Navigate to="/" replace />;
  return <Outlet />;
}

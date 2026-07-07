import { useEffect, useState } from "react";
import { Outlet, NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Upload,
  BarChart2,
  Users,
  Link2,
  Settings,
  ChevronUp,
  Moon,
  Sun,
} from "lucide-react";

const navItems = [
  {
    to: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    to: "/flow1",
    label: "Traffic Import",
    icon: Upload,
  },
  {
    to: "/flow2",
    label: "Traffic Overview",
    icon: BarChart2,
  },
  {
    to: "/flow3",
    label: "Leads Summary",
    icon: Users,
  },
  {
    to: "/urls",
    label: "URL Lists",
    icon: Link2,
  },
  {
    to: "/settings",
    label: "Settings",
    icon: Settings,
  },
];

export default function Layout() {
  const location = useLocation();
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [theme, setTheme] = useState(() => {
    return (
      localStorage.getItem("theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light")
    );
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    function onScroll() {
      setShowBackToTop(window.scrollY > 400);
    }
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleTheme() {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-[220px] bg-bg border-r border-border flex flex-col flex-shrink-0">
        {/* Logo */}
        <div className="px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-accent rounded-md flex items-center justify-center text-[11px] font-bold text-white tracking-tight flex-shrink-0">
              RD
            </div>
            <div className="min-w-0">
              <div className="font-heading font-semibold text-sm leading-tight text-ink truncate">
                Report Dashboard
              </div>
              <div className="text-[11px] text-muted truncate">BC & Blog SEO</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors border-l-2 ${
                    isActive
                      ? "border-accent text-accent"
                      : "border-transparent text-muted hover:bg-surface-2 hover:text-ink"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      size={16}
                      className="flex-shrink-0"
                      strokeWidth={isActive ? 2 : 1.75}
                    />
                    <span className="flex-1 min-w-0 truncate">{item.label}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border">
          <div className="text-[11px] text-muted">Monthly SEO Reports</div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="bg-surface border-b border-border px-7 py-3.5 flex items-center justify-between">
          <PageTitle pathname={location.pathname} />
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </header>

        {/* Page content */}
        <main className="flex-1 px-7 py-5 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Back to top */}
      {showBackToTop && (
        <button
          onClick={scrollToTop}
          title="Back to top"
          className="fixed bottom-6 right-6 z-50 w-9 h-9 rounded-full bg-accent shadow-card-hover flex items-center justify-center transition-opacity hover:opacity-90"
        >
          <ChevronUp size={16} color="white" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === "dark";
  return (
    <button
      onClick={onToggle}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        width: "36px",
        height: "20px",
        borderRadius: "999px",
        backgroundColor: "var(--surface-2)",
        border: "1px solid var(--border)",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
        transition: "background-color 0.2s ease",
      }}
    >
      <span
        style={{
          position: "absolute",
          left: isDark ? "18px" : "2px",
          width: "16px",
          height: "16px",
          borderRadius: "50%",
          backgroundColor: "var(--accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "left 0.2s ease",
        }}
      >
        {isDark ? (
          <Moon size={8} color="white" strokeWidth={2.5} />
        ) : (
          <Sun size={8} color="white" strokeWidth={2.5} />
        )}
      </span>
    </button>
  );
}

function PageTitle({ pathname }) {
  const pages = {
    "/": {
      title: "Dashboard",
      sub: "Overview of all flows and slot status",
    },
    "/flow1": {
      title: "Traffic Import",
      sub: "Upload GSC + GA4 exports, merge by slug, push to Sheets",
    },
    "/flow2": {
      title: "Traffic Overview",
      sub: "Aggregate segment-level metrics across 6 months",
    },
    "/flow3": {
      title: "Leads Summary",
      sub: "Computed from Flow 1 + Flow 2 — no uploads needed",
    },
    "/urls": {
      title: "URL Lists",
      sub: "Manage BC and Blog URL lists used for VLOOKUP",
    },
    "/settings": {
      title: "Settings",
      sub: "OAuth connection, rolling window, and Sheets URL",
    },
  };
  const info = pages[pathname] ?? { title: "Report Dashboard", sub: "" };
  return (
    <div>
      <h1 className="font-heading text-2xl font-semibold leading-tight text-ink">
        {info.title}
      </h1>
      {info.sub && <p className="text-xs text-muted mt-0.5">{info.sub}</p>}
    </div>
  );
}

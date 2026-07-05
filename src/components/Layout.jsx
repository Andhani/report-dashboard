import { useEffect, useState } from "react";
import { Outlet, NavLink, useLocation } from "react-router-dom";

const navItems = [
  {
    to: "/",
    label: "Dashboard",
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
        />
      </svg>
    ),
  },
  {
    to: "/flow1",
    label: "Flow 1 — Traffic Import",
    badge: "GSC + GA4",
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
        />
      </svg>
    ),
  },
  {
    to: "/flow2",
    label: "Flow 2 — Traffic Overview",
    badge: "Segments",
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
        />
      </svg>
    ),
  },
  {
    to: "/flow3",
    label: "Flow 3 — Leads Summary",
    badge: "Computed",
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    ),
  },
  {
    to: "/urls",
    label: "URL Lists",
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
        />
      </svg>
    ),
  },
  {
    to: "/settings",
    label: "Settings",
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    ),
  },
];

export default function Layout() {
  const location = useLocation();
  const [showBackToTop, setShowBackToTop] = useState(false);

  // The outer layout uses min-h-screen (not h-screen), so <main>'s
  // overflow-auto never actually engages — the whole page grows past the
  // viewport and the window/document scrolls instead. Track that.
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

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 bg-bg border-r border-line flex flex-col flex-shrink-0">
        {/* Logo */}
        <div className="px-6 py-5 border-b border-line">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center text-white font-bold text-sm">
              RD
            </div>
            <div>
              <div className="font-semibold text-sm leading-tight text-ink">
                Report Dashboard
              </div>
              <div className="text-xs text-muted">Traffic & SEO Insights</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "border-l-2 border-accent bg-accent/10 text-accent"
                    : "text-muted hover:bg-gray-100 hover:text-ink"
                }`
              }
            >
              <span className="flex-shrink-0">{item.icon}</span>
              <span className="flex-1 min-w-0 truncate">{item.label}</span>
              {item.badge && (
                <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-muted">
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-line">
          <div className="text-xs text-muted">BC & Blog Monthly Report</div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-8 py-4">
          <PageTitle pathname={location.pathname} />
        </header>

        {/* Page content */}
        <main className="flex-1 px-8 py-6 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Back to top — applies to every tab, since all pages share this scroll container */}
      {showBackToTop && (
        <button
          onClick={scrollToTop}
          title="Back to top"
          className="fixed bottom-6 right-6 z-50 w-10 h-10 rounded-full bg-accent text-white shadow-lg hover:bg-accent-dark flex items-center justify-center transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 15l7-7 7 7"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

function PageTitle({ pathname }) {
  const pages = {
    "/": {
      accent: "Dashboard",
      rest: "",
      sub: "Overview of all flows and slot status",
    },
    "/flow1": {
      accent: "Flow 1",
      rest: " — Traffic Import",
      sub: "Upload GSC + GA4 exports, merge by slug, push to Sheets",
    },
    "/flow2": {
      accent: "Flow 2",
      rest: " — Traffic Overview",
      sub: "Aggregate segment-level metrics across 6 months",
    },
    "/flow3": {
      accent: "Flow 3",
      rest: " — Leads Summary",
      sub: "Computed from Flow 1 + Flow 2 — no uploads needed",
    },
    "/urls": {
      accent: "URL Lists",
      rest: "",
      sub: "Manage BC and Blog URL lists used for VLOOKUP",
    },
    "/settings": {
      accent: "Settings",
      rest: "",
      sub: "OAuth connection, rolling window, and Sheets URL",
    },
  };
  const info = pages[pathname] ?? {
    accent: "Report Dashboard",
    rest: "",
    sub: "",
  };
  return (
    <div>
      <h1 className="text-xl font-bold leading-tight">
        <span className="text-accent">{info.accent}</span>
        {info.rest && <span className="text-ink">{info.rest}</span>}
      </h1>
      {info.sub && <p className="text-xs text-muted mt-0.5">{info.sub}</p>}
    </div>
  );
}

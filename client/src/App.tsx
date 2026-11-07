import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { useEffect, useState } from "react";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Playground from "./pages/Playground";

// The playground is reachable three ways so it works on any host:
//   /playground                 (when the host rewrites SPAs to index.html)
//   /?view=playground           (query string, any static host)
//   /#playground                (hash, no server routing at all — the default)
function isPlayground() {
  const { hash, search } = window.location;
  if (String(hash || "").replace("#", "").toLowerCase() === "playground") return true;
  if (new URLSearchParams(search || "").get("view") === "playground") return true;
  const path = window.location.pathname.replace(/\/+$/, "");
  return path.endsWith("/playground");
}

function Router() {
  // Sync the view with URL changes. Hash navigation fires `hashchange` even
  // when a router would skip a re-render, which keeps the gate honest.
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((tick) => tick + 1);
    window.addEventListener("hashchange", bump);
    window.addEventListener("popstate", bump);
    return () => {
      window.removeEventListener("hashchange", bump);
      window.removeEventListener("popstate", bump);
    };
  }, []);
  useLocation(); // also re-render on wouter navigations

  if (isPlayground()) return <Playground />;

  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/truthsearch-production/"} component={Home} />
      <Route path={"/truthsearch-production"} component={Home} />
      <Route path={"/playground"} component={Playground} />
      <Route path={"/playground/"} component={Playground} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;

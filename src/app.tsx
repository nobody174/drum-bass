import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { OnScreenPads } from "./ui/OnScreenPads";
import MidiMonitor from "./ui/MidiMonitor";
import { Placeholder } from "./ui/Placeholder";

const ROUTES = [
  { id: "library", label: "Library", icon: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" },
  { id: "kit", label: "Kit", icon: "M3 10h18M5 10v8h14v-8M8 10V6h8v4" },
  { id: "pads", label: "Pads", icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" },
  { id: "monitor", label: "Monitor", icon: "M3 12h4l3-8 4 16 3-8h4" },
  { id: "settings", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 8.500 4 8l-1 3 2 1v2l-2 1 1 3 2-.5L7.500 19l-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.500-1.500 2 .5 1-3-2-1z" },
] as const;

type RouteId = (typeof ROUTES)[number]["id"];

function currentRoute(): RouteId {
  const id = location.hash.replace(/^#\/?/, "");
  return ROUTES.some((r) => r.id === id) ? (id as RouteId) : "pads";
}

function useHashRoute(): RouteId {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const on = () => setRoute(currentRoute());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

function Screen({ route }: { route: RouteId }): ComponentChildren {
  switch (route) {
    case "library":
      return <Placeholder title="Library" text="Your songs will live here. Clone Hero and MIDI import arrive in M2." />;
    case "kit":
      return <Placeholder title="Kit" text="Kit editor comes in M1." />;
    case "pads":
      return <OnScreenPads />;
    case "monitor":
      return <MidiMonitor />;
    case "settings":
      return <Placeholder title="Settings" text="Latency calibration, audio and display options will appear here." />;
  }
}

export function App() {
  const route = useHashRoute();
  return (
    <div class="shell">
      <main class={`shell-main${route === "pads" ? " no-scroll" : ""}`}>
        <Screen route={route} />
      </main>
      <nav class="nav" aria-label="Main">
        {ROUTES.map((r) => (
          <a key={r.id} href={`#/${r.id}`} aria-current={route === r.id ? "page" : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={r.icon} />
            </svg>
            {r.label}
          </a>
        ))}
      </nav>
    </div>
  );
}

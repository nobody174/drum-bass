import { render } from "preact";
import "@fontsource/bebas-neue/400.css";
import "@fontsource/oswald/500.css";
import "@fontsource/oswald/700.css";
import "@fontsource-variable/inter";
import "./styles/theme.css";
import "./styles/app.css";
import { App } from "./app";
import { webMidi } from "./midi";

render(<App />, document.getElementById("app")!);

// Reconnect to MIDI after a relaunch if permission was already granted.
void webMidi.autoConnect();

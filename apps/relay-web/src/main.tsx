import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { RelayWebApp } from "./App";
import { shouldRenderB2VisualDemo } from "./entry";
import { RelayProductionApp } from "./production";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Relay Web root element is missing");

const localIntegration = import.meta.env.DEV
  && import.meta.env.VITE_RELAY_LOCAL_INTEGRATION === "1";
const b2VisualFixture = shouldRenderB2VisualDemo(window.location);
const B2VisualDemo = lazy(async () => {
  const module = await import("./b2-visual");
  return { default: module.B2VisualDemo };
});

createRoot(root).render(
  <StrictMode>
    {b2VisualFixture
      ? <Suspense fallback={<div aria-label="Loading B2 visual demo" style={{ width: "100vw", height: "100vh", background: "#020810" }} />}><B2VisualDemo /></Suspense>
      : import.meta.env.PROD || localIntegration
      ? <RelayProductionApp allowLoopbackHttp={localIntegration} />
      : <RelayWebApp />}
  </StrictMode>,
);

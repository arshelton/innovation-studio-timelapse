import { createRoot } from "react-dom/client";

import App from "./App";

import "@photo-sphere-viewer/core/index.css";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("The root application element was not found.");
}

createRoot(rootElement).render(<App />);

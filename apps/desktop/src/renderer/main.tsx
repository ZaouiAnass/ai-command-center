import React from "react"; import { createRoot } from "react-dom/client"; import App from "./App"; import "./styles.css"; import { initTheme } from "./theme";
initTheme(); // avant le premier rendu : pas de flash sombre en thème clair
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);

import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { ThemeProvider, theme } from "reablocks";
import { router } from "./router";
import { fetchPublicConfig, PublicConfigContext } from "./hooks/use-public-config";
import "./styles.css";

const config = await fetchPublicConfig();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <PublicConfigContext.Provider value={config}>
        <RouterProvider router={router} />
      </PublicConfigContext.Provider>
    </ThemeProvider>
  </React.StrictMode>,
);

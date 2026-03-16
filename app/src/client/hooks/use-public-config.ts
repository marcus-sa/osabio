import { createContext, useContext } from "react";

export type PublicConfig = {
  selfHosted: boolean;
  worktreeManagerEnabled: boolean;
};

export const DEFAULT_CONFIG: PublicConfig = {
  selfHosted: false,
  worktreeManagerEnabled: false,
};

export const CONFIG_URL = "/api/config";

export function parseConfigResponse(data: unknown): PublicConfig {
  if (
    typeof data === "object" &&
    data !== null &&
    "selfHosted" in data &&
    typeof (data as Record<string, unknown>).selfHosted === "boolean"
  ) {
    const record = data as Record<string, unknown>;
    return {
      selfHosted: record.selfHosted as boolean,
      worktreeManagerEnabled:
        typeof record.worktreeManagerEnabled === "boolean"
          ? record.worktreeManagerEnabled
          : false,
    };
  }
  return DEFAULT_CONFIG;
}

export async function fetchPublicConfig(): Promise<PublicConfig> {
  try {
    const response = await fetch(CONFIG_URL);
    if (!response.ok) return DEFAULT_CONFIG;
    const data: unknown = await response.json();
    return parseConfigResponse(data);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export const PublicConfigContext = createContext<PublicConfig>(DEFAULT_CONFIG);

export function usePublicConfig(): PublicConfig {
  return useContext(PublicConfigContext);
}

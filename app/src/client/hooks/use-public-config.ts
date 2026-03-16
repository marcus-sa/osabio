import { useEffect, useState } from "react";

export type PublicConfig = {
  selfHosted: boolean;
  worktreeManagerEnabled: boolean;
};

const DEFAULT_CONFIG: PublicConfig = {
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

export function usePublicConfig(): {
  config: PublicConfig;
  isLoading: boolean;
} {
  const [config, setConfig] = useState<PublicConfig>(DEFAULT_CONFIG);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch(CONFIG_URL)
      .then((response) => {
        if (!response.ok) return DEFAULT_CONFIG;
        return response.json() as Promise<unknown>;
      })
      .then((data) => {
        if (!cancelled) {
          setConfig(parseConfigResponse(data));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConfig(DEFAULT_CONFIG);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { config, isLoading };
}

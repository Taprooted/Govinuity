export const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type GovinuityMode = "local" | "shared";

export function currentMode(): GovinuityMode | "invalid" {
  const mode = (process.env.GOVINUITY_MODE ?? "local").trim().toLowerCase();
  return mode === "local" || mode === "shared" ? mode : "invalid";
}

export function describeMode(mode: GovinuityMode) {
  if (mode === "shared") {
    return {
      label: "Shared mode",
      detail: "API routes require GOVINUITY_API_KEY.",
    };
  }

  return {
    label: "Local mode",
    detail: "This instance only accepts localhost requests.",
  };
}

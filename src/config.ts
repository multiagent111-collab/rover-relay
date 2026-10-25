import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { RelayError } from "./types.ts";

export function loadEnvironment() {
  if (existsSync(".env")) process.loadEnvFile(".env");
}
export function configuration() {
  for (const key of ["SAMPLE_MODE", "DEMO_MODE"])
    if (
      process.env[key] !== undefined &&
      !["true", "false"].includes(process.env[key]!)
    )
      throw new Error(`${key} must be true or false.`);
  const sample = process.env.SAMPLE_MODE !== "false";
  const number = (name: string, fallback: number) => {
    const value = Number(process.env[name] || fallback);
    if (
      !Number.isInteger(value) ||
      value <= 0 ||
      (name === "PORT" && value > 65535)
    )
      throw new Error(`Invalid ${name}`);
    return value;
  };
  return {
    sample,
    demo: sample || process.env.DEMO_MODE === "true",
    host: process.env.HOST || "127.0.0.1",
    port: number("PORT", 4173),
    dataDir: resolve(process.env.DATA_DIR || ".data"),
    databaseUrl: process.env.DATABASE_URL || "",
    accessToken: process.env.RELAY_ACCESS_TOKEN || "",
    planTtlSeconds: number("PLAN_TTL_SECONDS", 60),
  };
}
export type Config = ReturnType<typeof configuration>;
export function inferenceProvider(): "nightshift" | "nvidia" {
  const provider = process.env.RELAY_INFERENCE_PROVIDER || "nightshift";
  if (provider !== "nightshift" && provider !== "nvidia")
    throw new RelayError(
      503,
      "invalid_configuration",
      "RELAY_INFERENCE_PROVIDER must be nightshift or nvidia.",
    );
  return provider;
}
export function requireEnvironment(names: string[]) {
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length)
    throw new RelayError(
      503,
      "missing_configuration",
      `Configure ${missing.join(", ")} before live sponsor mode.`,
    );
}

import { createHash } from "node:crypto";
import { inferenceProvider, type Config } from "./config.ts";
import type { DataPort } from "./types.ts";
import type { Generator } from "./agents.ts";
import { HMEM_REVISION } from "./memory.ts";

export type ServiceObservation = {
  checkedAt: string;
  configured: boolean;
  reachable: boolean | null;
  authenticated: boolean | null;
  lastExercisedAt: string | null;
  provider: string;
  reportedModel: string | null;
  operation: string | null;
  errorCode: string | null;
};
export function safeModel(value: unknown) {
  if (value === "sample-rules-v1") return value;
  return typeof value === "string" &&
    /^(?:nvidia|meterless)\/[a-z0-9._:/-]{1,160}$/i.test(value)
    ? value
    : null;
}
export function failureObservation(error: unknown) {
  const code =
    typeof (error as { code?: unknown })?.code === "string"
      ? (error as { code: string }).code
      : "check_failed";
  const safeCode = /^[a-z_]{1,64}$/.test(code) ? code : "check_failed";
  const missing =
    safeCode === "missing_configuration" ||
    safeCode === "invalid_configuration";
  const auth = safeCode.endsWith("_unauthorized");
  const response =
    auth ||
    safeCode === "invalid_model_output" ||
    safeCode.endsWith("_contract") ||
    safeCode.endsWith("_rate_limited") ||
    safeCode.endsWith("_route_missing");
  return {
    errorCode: safeCode,
    configured: !missing,
    reachable: response ? true : null,
    authenticated: auth ? false : response ? true : null,
  };
}
export function configurationId(
  config: Config,
  role: "relay" | "supplier" = "relay",
  supplierFile?: string,
) {
  let database = "sqlite";
  if (config.databaseUrl) {
    try {
      const url = new URL(config.databaseUrl);
      database = `${url.protocol}//${url.hostname}:${url.port}/${url.pathname}`;
    } catch {
      database = "invalid";
    }
  }
  return createHash("sha256")
    .update(
      JSON.stringify({
        role,
        host: config.host,
        port: config.port,
        dataDir: config.dataDir,
        sample: config.sample,
        database,
        supplierFile,
        provider: config.sample ? "sample" : inferenceProvider(),
        model: config.sample ? null : safeModel(process.env.NEMOTRON_MODEL),
        route: config.sample ? null : safeModel(process.env.METERLESS_ROUTE),
      }),
    )
    .digest("hex");
}

export class Readiness {
  private dataState: ServiceObservation;
  private inferenceState: ServiceObservation;
  readonly startedAt: string;
  constructor(
    private config: Config,
    private clock = Date.now,
  ) {
    this.startedAt = new Date(clock()).toISOString();
    const has = (...names: string[]) =>
      names.every((name) => !!process.env[name]?.trim());
    const base = {
      checkedAt: this.startedAt,
      reachable: null,
      authenticated: null,
      lastExercisedAt: null,
      reportedModel: null,
      operation: null,
      errorCode: null,
    };
    this.dataState = {
      ...base,
      configured:
        config.sample ||
        has("ZETARIS_REST_URL", "ZETARIS_API_KEY", "ZETARIS_ORG_ID"),
      provider: config.sample ? "sample" : "zetaris",
    };
    const provider = config.sample ? "sample" : inferenceProvider();
    this.inferenceState = {
      ...base,
      provider:
        provider === "nvidia"
          ? "nvidia-direct"
          : provider === "nightshift"
            ? "meterless-nightshift"
            : "sample",
      configured:
        config.sample ||
        (provider === "nvidia"
          ? has("NVIDIA_API_KEY", "NEMOTRON_MODEL")
          : has(
              "METERLESS_BASE_URL",
              "METERLESS_RUNTIME_TOKEN",
              "METERLESS_ROUTE",
              "NEMOTRON_MODEL",
            )),
    };
  }
  snapshot() {
    return {
      checkedAt: new Date(this.clock()).toISOString(),
      startedAt: this.startedAt,
      mode: this.config.sample ? "offline_sample" : "live_sponsors",
      dataMode: this.config.sample ? "synthetic" : "zetaris",
      inferenceMode: this.inferenceState.provider,
      executionBackend: "simulator",
      accessConfigured:
        this.config.sample || this.config.accessToken.length >= 24,
      memory: {
        engine: "Meterless H-MEM",
        revision: HMEM_REVISION,
        verification:
          "See the isolated feature/conformance tests; configuration is not proof of a successful feature run.",
      },
      data: { ...this.dataState },
      inference: { ...this.inferenceState },
      evidenceScope:
        "Observations are from this process only; successful adapter calls are not a full mission, verified model provenance, reservations or real execution. Readiness never calls a sponsor.",
    };
  }
  data(port: DataPort): DataPort {
    return {
      snapshot: async (...args) => {
        try {
          const result = await port.snapshot(...args);
          this.dataState = {
            ...this.dataState,
            configured: true,
            reachable: true,
            authenticated: this.config.sample ? null : true,
            checkedAt: new Date(this.clock()).toISOString(),
            lastExercisedAt: new Date(this.clock()).toISOString(),
            operation: "snapshot",
            errorCode: null,
          };
          return result;
        } catch (error) {
          this.dataState = {
            ...this.dataState,
            ...failureObservation(error),
            checkedAt: new Date(this.clock()).toISOString(),
          };
          throw error;
        }
      },
    };
  }
  generator(generator: Generator): Generator {
    return {
      generate: async (...args) => {
        try {
          const result = await generator.generate(...args);
          this.inferenceState = {
            ...this.inferenceState,
            configured: true,
            reachable: true,
            authenticated: this.config.sample ? null : true,
            checkedAt: new Date(this.clock()).toISOString(),
            lastExercisedAt: new Date(this.clock()).toISOString(),
            operation: args[0],
            reportedModel: safeModel(result.model),
            provider: this.inferenceState.provider,
            errorCode: null,
          };
          return result;
        } catch (error) {
          this.inferenceState = {
            ...this.inferenceState,
            ...failureObservation(error),
            checkedAt: new Date(this.clock()).toISOString(),
          };
          throw error;
        }
      },
    };
  }
}

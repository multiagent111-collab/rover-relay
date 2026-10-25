import { z } from "zod";
import { RelayError } from "./types.ts";

const id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:/-]+$/);
const route = z.object({ model: id, provider: id });
// Whitelist metadata only. Never persist the Runtime's prompt preview,
// reasoning scaffold, deliberation, response prose or provider credentials.
const receipt = z.object({
  receipt_id: id,
  request_id: id,
  app: id,
  winning_route: route,
  app_policy: z
    .object({
      requested_mode: id.optional(),
      routed_mode: id.optional(),
      bound_mode: id.optional(),
      race_width: z.number().int().min(1).max(64).optional(),
    })
    .nullable()
    .optional(),
  usage: z
    .object({ latency_ms: z.number().finite().min(0).max(10000000).optional() })
    .optional(),
});
const metadata = z.object({
  schema: z.literal("meterless.compute_receipt.v1"),
  receipt_id: id,
  requested_model: id,
  routed_model: id,
  winning_route: route,
  receipt,
  from_cache: z.boolean().optional(),
  requires_review: z.boolean().optional(),
});
export type RuntimeRoute = {
  source: "runtime_reported";
  responseId: string;
  receiptId: string;
  requestedRoute: string;
  routedModel: string;
  provider: string;
  app: string;
  requestedMode?: string;
  effectiveMode?: string;
  boundMode?: string;
  raceWidth?: number;
  fromCache: boolean | null;
  runtimeLatencyMs?: number;
};
export function runtimeRoute(
  value: unknown,
  responseId: unknown,
  reportedModel: string,
  requestedRoute: string,
): RuntimeRoute | undefined {
  // Plain compatible servers may omit Runtime evidence. Omission is not proof.
  if (value === undefined) return undefined;
  const parsed = metadata.safeParse(value);
  const response = id.safeParse(responseId);
  if (!parsed.success || !response.success)
    throw new RelayError(
      503,
      "nightshift_contract",
      "Nightshift returned malformed routing evidence.",
    );
  const m = parsed.data;
  if (m.requires_review)
    throw new RelayError(
      503,
      "nightshift_review_required",
      "Nightshift marked this output for review; it cannot become an approvable Relay plan.",
    );
  if (
    m.requested_model !== requestedRoute ||
    m.routed_model !== reportedModel ||
    m.winning_route.model !== m.routed_model ||
    m.receipt.receipt_id !== m.receipt_id ||
    m.receipt.request_id !== response.data ||
    m.receipt.winning_route.model !== m.routed_model ||
    m.receipt.winning_route.provider !== m.winning_route.provider
  )
    throw new RelayError(
      503,
      "nightshift_contract",
      "Nightshift response and receipt routing identities disagree.",
    );
  const policy = m.receipt.app_policy;
  return {
    source: "runtime_reported",
    responseId: response.data,
    receiptId: m.receipt_id,
    requestedRoute: m.requested_model,
    routedModel: m.routed_model,
    provider: m.winning_route.provider,
    app: m.receipt.app,
    ...(policy?.requested_mode ? { requestedMode: policy.requested_mode } : {}),
    ...(policy?.routed_mode ? { effectiveMode: policy.routed_mode } : {}),
    ...(policy?.bound_mode ? { boundMode: policy.bound_mode } : {}),
    ...(policy?.race_width ? { raceWidth: policy.race_width } : {}),
    fromCache: m.from_cache ?? null,
    ...(m.receipt.usage?.latency_ms !== undefined
      ? { runtimeLatencyMs: m.receipt.usage.latency_ms }
      : {}),
  };
}
export function nemotronRoute(value: RuntimeRoute | undefined) {
  return (
    !!value &&
    value.provider === "nvidia" &&
    /^nvidia\/[a-z0-9.-]*nemotron[a-z0-9.-]*$/i.test(value.routedModel)
  );
}

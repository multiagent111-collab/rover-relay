import { z } from "zod";
import { hash, sameOwner } from "./domain.ts";
import { RelayError, type Identity } from "./types.ts";

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });
const cents = z.number().int().min(0).max(1000000);
export const executionBackendSchema = z.enum(["simulator", "http_gateway"]);
const plan = z
  .object({ version: z.number().int().positive(), digest })
  .strict();
const selected = z.object({ supplierId: id, courierId: id }).strict();
export const executionIntentSchema = z
  .object({
    contractVersion: z.literal("1.0"),
    intentId: z.uuid(),
    taskId: z.uuid(),
    missionId: z.uuid(),
    request: z.object({ revision: z.literal(1), digest }).strict(),
    approvedPlan: plan,
    approvedAt: timestamp,
    expiresAt: timestamp,
    executionBackend: executionBackendSchema,
    selected,
    equipment: z
      .object({
        sku: z.literal("HDMI-USB-C"),
        quantity: z.number().int().min(1).max(20),
      })
      .strict(),
    pickup: z.object({ locationId: id }).strict(),
    destination: z
      .object({
        locationId: z.enum(["auditorium", "library"]),
        entrance: z.string().min(2).max(120).nullable(),
      })
      .strict(),
    money: z
      .object({
        currency: z.literal("USD"),
        itemEstimateCents: cents,
        deliveryEstimateCents: cents,
        explicitFeesCents: cents,
        approvedTotalCents: cents,
      })
      .strict(),
    absoluteDeadlineAt: timestamp,
    sourceFingerprint: digest,
    memoryRevision: digest,
    evidenceIds: z.array(z.string().min(1).max(200)).min(1).max(200),
  })
  .strict();
export type ApprovedExecutionIntent = z.infer<typeof executionIntentSchema>;

// Keep cross-field checks next to the structural schema. JSON Schema cannot
// express arithmetic or timestamp comparisons; consumers must enforce both.
export function parseExecutionIntent(value: unknown): ApprovedExecutionIntent {
  if (
    typeof value === "object" &&
    value !== null &&
    "contractVersion" in value &&
    value.contractVersion !== "1.0"
  )
    throw new RelayError(
      409,
      "unsupported_contract_version",
      "Only execution contract 1.0 is supported.",
    );
  const parsed = executionIntentSchema.safeParse(value);
  if (!parsed.success)
    throw new RelayError(
      400,
      "invalid_execution_intent",
      "Invalid execution intent structure.",
    );
  const intent = parsed.data,
    money = intent.money;
  if (
    money.itemEstimateCents +
      money.deliveryEstimateCents +
      money.explicitFeesCents !==
      money.approvedTotalCents ||
    Date.parse(intent.approvedAt) >= Date.parse(intent.expiresAt) ||
    Date.parse(intent.expiresAt) > Date.parse(intent.absoluteDeadlineAt) ||
    new Set(intent.evidenceIds).size !== intent.evidenceIds.length
  )
    throw new RelayError(
      400,
      "invalid_execution_intent",
      "Invalid execution amounts, evidence or timestamp order.",
    );
  return intent;
}

export const executionTaskSchema = z
  .object({
    contractVersion: z.literal("1.0"),
    taskId: z.uuid(),
    intentId: z.uuid(),
    missionId: z.uuid(),
    executionBackend: executionBackendSchema,
    request: z.object({ revision: z.literal(1), digest }).strict(),
    approvedPlan: plan,
    selected,
    jobId: id.nullable(),
    status: z.enum([
      "queued",
      "dispatch_requested",
      "accepted",
      "in_progress",
      "completed",
      "declined",
      "cancel_requested",
      "cancelled",
    ]),
    revision: z.number().int().positive(),
    updatedAt: timestamp,
    cancellation: z
      .object({ requestedAt: timestamp, confirmedAt: timestamp.nullable() })
      .strict()
      .optional(),
  })
  .strict();
export type ExecutionTaskState = z.infer<typeof executionTaskSchema>;
export const executionCancelSchema = z
  .object({
    contractVersion: z.literal("1.0"),
    intentId: z.uuid(),
    idempotencyKey: z.string().regex(/^[a-f0-9-]{36}:cancel$/),
    expectedRevision: z.number().int().positive(),
  })
  .strict();

export function parseExecutionTask(value: unknown): ExecutionTaskState {
  const task = executionTaskSchema.parse(value);
  if (
    (task.status === "cancel_requested" &&
      (!task.cancellation || task.cancellation.confirmedAt !== null)) ||
    (task.status === "cancelled" && !task.cancellation?.confirmedAt) ||
    (task.cancellation?.confirmedAt &&
      Date.parse(task.cancellation.confirmedAt) <
        Date.parse(task.cancellation.requestedAt))
  )
    throw new RelayError(
      503,
      "invalid_execution_response",
      "Invalid cancellation state.",
    );
  return task;
}
export const executionEventSchema = z
  .object({
    contractVersion: z.literal("1.0"),
    eventId: z.uuid(),
    type: z.enum([
      "dispatch_requested",
      "accepted",
      "in_progress",
      "completed",
      "declined",
      "cancel_requested",
      "cancelled",
    ]),
    task: executionTaskSchema,
  })
  .strict();
export const executionConflictSchema = z
  .object({
    contractVersion: z.literal("1.0"),
    error: z.enum([
      "identity_mismatch",
      "unapproved_plan",
      "plan_changed",
      "intent_expired",
      "provider_unavailable",
      "quote_changed",
      "mapping_missing",
      "idempotency_conflict",
      "job_already_active",
      "dependency_unavailable",
      "unsupported_contract_version",
      "invalid_execution_intent",
      "stale_task_revision",
    ]),
    message: z.string().min(1).max(500),
  })
  .strict();

export type TrustedApproval = {
  owner: Identity;
  intent: ApprovedExecutionIntent;
};
// A registry populated by trusted approval code, never by the incoming HTTP body.
// The gateway must additionally revalidate its own authoritative mappings/slots.
export function authorizeExecutionIntent(
  identity: Identity,
  value: unknown,
  approval: TrustedApproval | undefined,
) {
  const intent = parseExecutionIntent(value);
  if (!approval || !sameOwner(identity, approval.owner))
    throw new RelayError(
      409,
      "identity_mismatch",
      "Execution requires the verified approval owner.",
    );
  if (hash(intent) !== hash(parseExecutionIntent(approval.intent)))
    throw new RelayError(
      409,
      "unapproved_plan",
      "Intent differs from trusted approved terms.",
    );
  return intent;
}

// Check only after an authenticated, exact committed-intent lookup. A retry of
// an already committed job remains valid after proposal expiry.
export function validateNewExecutionIntent(
  intent: ApprovedExecutionIntent,
  now = Date.now(),
) {
  if (
    Date.parse(intent.approvedAt) > now ||
    Date.parse(intent.expiresAt) <= now ||
    Date.parse(intent.absoluteDeadlineAt) <= now
  )
    throw new RelayError(
      409,
      "intent_expired",
      "New execution intent has expired or approval is in the future.",
    );
}

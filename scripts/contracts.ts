import { writeFile, mkdir } from "node:fs/promises";
import { z } from "zod";
import { requestSchema, evidenceSchema } from "../src/types.ts";
import {
  intakeCreateSchema,
  intakeUpdateSchema,
  intakeConfirmSchema,
} from "../src/intake.ts";
import { actionSchema } from "../src/coordinator.ts";
import {
  executionIntentSchema,
  executionTaskSchema,
  executionEventSchema,
  executionConflictSchema,
  executionCancelSchema,
} from "../src/execution-contract.ts";

const identity = [{ RelayBearer: [] }];
const objectResponse = {
  description: "Structured result; see the domain types in src/types.ts",
  content: { "application/json": { schema: { type: "object" } } },
};
const errorResponse = {
  description: "Controlled error with error code and message",
};
const body = (schema: unknown) => ({
  required: true,
  content: { "application/json": { schema } },
});
const idParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};
const routes: Record<string, unknown> = {
  "/v1/intakes": {
    post: {
      summary:
        "Save a bounded text draft; always needs explicit review/confirmation",
      requestBody: body({ $ref: "#/components/schemas/IntakeCreate" }),
      responses: { "201": objectResponse, "400": errorResponse },
    },
  },
  "/v1/intakes/{id}": {
    parameters: [idParameter],
    get: {
      summary: "Resume an owner-scoped persisted draft",
      responses: { "200": objectResponse, "404": errorResponse },
    },
    patch: {
      summary:
        "Review fields at the current revision without resetting the original deadline",
      requestBody: body({ $ref: "#/components/schemas/IntakeUpdate" }),
      responses: {
        "200": objectResponse,
        "400": errorResponse,
        "409": errorResponse,
      },
    },
  },
  "/v1/intakes/{id}/confirm": {
    parameters: [idParameter],
    post: {
      summary:
        "Explicitly confirm exact reviewed constraints and plan the same mission ID",
      requestBody: body({ $ref: "#/components/schemas/IntakeConfirm" }),
      responses: {
        "200": objectResponse,
        "400": errorResponse,
        "409": errorResponse,
        "503": errorResponse,
      },
    },
  },
  "/v1/health": {
    get: {
      summary:
        "Read mode and local server health; not proof of sponsor connectivity",
      security: [],
      responses: { "200": objectResponse },
    },
  },
  "/v1/bootstrap": {
    get: {
      summary: "Read synthetic campus data and caller-owned missions",
      responses: { "200": objectResponse, "401": errorResponse },
    },
  },
  "/v1/readiness": {
    get: {
      summary:
        "Read passive per-process configuration and actual adapter observations; never calls a sponsor",
      responses: { "200": objectResponse, "401": errorResponse },
    },
  },
  "/v1/missions": {
    post: {
      summary: "Create a request and a bounded planning run",
      requestBody: body({ $ref: "#/components/schemas/MissionRequest" }),
      responses: {
        "201": objectResponse,
        "400": errorResponse,
        "503": errorResponse,
      },
    },
  },
  "/v1/missions/{id}": {
    parameters: [idParameter],
    get: {
      summary: "Read caller-owned mission",
      responses: { "200": objectResponse, "404": errorResponse },
    },
  },
  "/v1/missions/{id}/replan": {
    parameters: [idParameter],
    post: {
      summary: "Refresh observations and create a new plan version",
      responses: {
        "200": objectResponse,
        "409": errorResponse,
        "503": errorResponse,
      },
    },
  },
  "/v1/missions/{id}/approve": {
    parameters: [idParameter],
    post: {
      summary: "Approve current terms and create/recover one simulated task",
      requestBody: body({
        type: "object",
        additionalProperties: false,
        required: ["version", "digest", "idempotencyKey"],
        properties: {
          version: { type: "integer", minimum: 1 },
          digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
          idempotencyKey: { type: "string", minLength: 8, maxLength: 100 },
        },
      }),
      responses: {
        "200": objectResponse,
        "409": errorResponse,
        "503": errorResponse,
      },
    },
  },
  "/v1/missions/{id}/events": {
    parameters: [idParameter],
    get: {
      summary: "Read ordered evidence and task events",
      responses: {
        "200": {
          description: "Ordered events",
          content: {
            "application/json": {
              schema: { type: "array", items: { type: "object" } },
            },
          },
        },
        "404": errorResponse,
      },
    },
  },
  "/v1/missions/{id}/evidence.jsonl": {
    parameters: [idParameter],
    get: {
      summary: "Export evidence as NDJSON",
      responses: {
        "200": {
          description: "Ordered events",
          content: { "application/x-ndjson": { schema: { type: "string" } } },
        },
      },
    },
  },
  "/v1/tasks/{id}": {
    parameters: [idParameter],
    get: {
      summary: "Read caller-owned simulated task",
      responses: { "200": objectResponse, "404": errorResponse },
    },
  },
  "/v1/tasks/{id}/cancel": {
    parameters: [idParameter],
    post: {
      summary: "Cancel a simulated task and release its courier reservation",
      requestBody: {
        ...body({
          type: "object",
          additionalProperties: false,
          properties: { expectedRevision: { type: "integer", minimum: 0 } },
        }),
        required: false,
      },
      responses: { "200": objectResponse, "409": errorResponse },
    },
  },
  "/v1/preferences/entrance": {
    get: {
      summary: "Retrieve confirmed preference through H-MEM",
      parameters: [
        {
          name: "venue",
          in: "query",
          required: true,
          schema: { enum: ["auditorium", "library"] },
        },
      ],
      responses: { "200": objectResponse },
    },
    put: {
      summary: "Confirm or correct an entrance preference",
      requestBody: body({
        type: "object",
        additionalProperties: false,
        required: ["venue", "entrance"],
        properties: {
          venue: { enum: ["auditorium", "library"] },
          entrance: { type: "string", minLength: 2, maxLength: 120 },
        },
      }),
      responses: { "200": objectResponse, "400": errorResponse },
    },
    delete: {
      summary: "Forget the active preference; audit history remains local",
      requestBody: body({
        type: "object",
        additionalProperties: false,
        required: ["venue"],
        properties: { venue: { enum: ["auditorium", "library"] } },
      }),
      responses: { "200": objectResponse },
    },
  },
  "/demo/tasks/{id}/response": {
    parameters: [idParameter],
    post: {
      summary: "Simulate courier response or delivery progress; demo mode only",
      requestBody: body({
        type: "object",
        additionalProperties: false,
        required: ["status"],
        properties: {
          status: {
            enum: ["accepted", "declined", "in_progress", "completed"],
          },
          expectedRevision: { type: "integer", minimum: 0 },
        },
      }),
      responses: {
        "200": objectResponse,
        "404": errorResponse,
        "409": errorResponse,
      },
    },
  },
  "/demo/disruptions": {
    post: {
      summary: "Change local sample stock or route facts; sample mode only",
      requestBody: body({
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "supplierId", "stock"],
            properties: {
              type: { const: "stock" },
              supplierId: { type: "string" },
              stock: { type: "integer", minimum: 0, maximum: 100 },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "edgeId", "closed"],
            properties: {
              type: { const: "route" },
              edgeId: { type: "string" },
              closed: { type: "boolean" },
            },
          },
        ],
      }),
      responses: { "200": objectResponse, "404": errorResponse },
    },
  },
};
await mkdir("contracts", { recursive: true });
const schema = z.toJSONSchema(requestSchema);
const executionSchemas = {
  ApprovedExecutionIntent: z.toJSONSchema(executionIntentSchema),
  ExecutionTaskState: z.toJSONSchema(executionTaskSchema),
  ExecutionEvent: z.toJSONSchema(executionEventSchema),
  ExecutionConflict: z.toJSONSchema(executionConflictSchema),
  ExecutionCancel: z.toJSONSchema(executionCancelSchema),
};
for (const [name, value] of Object.entries(executionSchemas))
  await writeFile(
    `contracts/${name}.schema.json`,
    JSON.stringify(value, null, 2) + "\n",
  );
const executionResponse = (
  name: keyof typeof executionSchemas,
  description: string,
) => ({
  description,
  content: {
    "application/json": { schema: { $ref: `#/components/schemas/${name}` } },
  },
});
const taskResponse = executionResponse(
  "ExecutionTaskState",
  "Authoritative task; request does not imply provider acceptance",
);
const conflictResponse = executionResponse(
  "ExecutionConflict",
  "Typed conflict. Definitive new-intent conflicts guarantee no job was committed; unknown outcomes use 503 and retain the same intent.",
);
await writeFile(
  "contracts/execution.openapi.json",
  JSON.stringify(
    {
      openapi: "3.1.0",
      info: {
        title: "Relay execution gateway contract",
        version: "1.0",
        description:
          "Proposed public contract, exercised only by controlled fixtures. These internal routes are NOT served by the Relay app. Requires separately verified identity and trusted stored approval; digest is not authorization. No production gateway activation.",
      },
      security: [{ VerifiedInternalAssertion: [] }],
      paths: {
        "/internal/relay/v1/execution-intents": {
          post: {
            summary:
              "Verify owner and exact trusted approval; replay before expiry check; atomically reserve selected provider and persist one job/outbox",
            requestBody: body({
              $ref: "#/components/schemas/ApprovedExecutionIntent",
            }),
            responses: {
              "200": taskResponse,
              "400": conflictResponse,
              "401": conflictResponse,
              "409": conflictResponse,
              "503": conflictResponse,
            },
          },
        },
        "/internal/relay/v1/tasks/{id}": {
          parameters: [idParameter],
          get: {
            summary:
              "Read the verified owner's authoritative execution mapping",
            responses: {
              "200": taskResponse,
              "401": conflictResponse,
              "409": conflictResponse,
              "503": conflictResponse,
            },
          },
        },
        "/internal/relay/v1/tasks/{id}/cancel": {
          parameters: [idParameter],
          post: {
            summary:
              "Stable idempotent cancellation request; cancel_requested retains capacity until confirmed",
            requestBody: body({ $ref: "#/components/schemas/ExecutionCancel" }),
            responses: {
              "200": taskResponse,
              "400": conflictResponse,
              "401": conflictResponse,
              "409": conflictResponse,
              "503": conflictResponse,
            },
          },
        },
      },
      components: {
        securitySchemes: {
          VerifiedInternalAssertion: {
            type: "http",
            scheme: "bearer",
            description:
              "Short-lived signed assertion binding verified tenant/subject, method/path, body digest, expiry and replay ID. Demo tokens/unsigned identity headers are invalid. Fixture-only HMAC protocol is not a production credential deployment.",
          },
        },
        schemas: executionSchemas,
      },
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  "contracts/mission-request.schema.json",
  JSON.stringify(schema, null, 2) + "\n",
);
await writeFile(
  "contracts/openapi.json",
  JSON.stringify(
    {
      openapi: "3.1.0",
      info: {
        title: "ROVER Relay",
        version: "0.1.0",
        description:
          "Standalone synthetic campus workflow. Live mode uses bearer authentication; local sample mode uses documented demo identities.",
      },
      servers: [{ url: "http://127.0.0.1:4173" }],
      security: identity,
      paths: routes,
      components: {
        securitySchemes: { RelayBearer: { type: "http", scheme: "bearer" } },
        schemas: {
          MissionRequest: schema,
          SourceEvidence: z.toJSONSchema(evidenceSchema, {
            target: "draft-2020-12",
          }),
          IntakeCreate: z.toJSONSchema(intakeCreateSchema),
          IntakeUpdate: z.toJSONSchema(intakeUpdateSchema),
          IntakeConfirm: z.toJSONSchema(intakeConfirmSchema),
          CoordinatorAction: z.toJSONSchema(actionSchema),
          ...executionSchemas,
        },
      },
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Generated public API and execution 1.0 schemas/OpenAPI (gateway routes remain a contract only).",
);

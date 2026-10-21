import { writeFile, mkdir } from "node:fs/promises";
import { z } from "zod";
import { requestSchema } from "../src/types.ts";

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
        schemas: { MissionRequest: schema },
      },
    },
    null,
    2,
  ) + "\n",
);
console.log("Generated request JSON Schema and OpenAPI 3.1 entry points.");

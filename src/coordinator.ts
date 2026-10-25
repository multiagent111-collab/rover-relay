import { z } from "zod";
import { shortestPath } from "./domain.ts";
import { intakeFields } from "./intake.ts";
import {
  RelayError,
  type DataPort,
  type Identity,
  type MissionRequest,
  type Snapshot,
  type Supplier,
  type Courier,
  type Edge,
} from "./types.ts";
import { PlanningBudget } from "./budget.ts";
const ids = z
  .array(z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/))
  .min(1)
  .max(99)
  .refine(
    (values) => new Set(values).size === values.length,
    "Use unique source identifiers.",
  );
export const actionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("ask_user"),
      fields: z.array(z.enum(intakeFields)).min(1).max(5),
    })
    .strict(),
  z
    .object({
      type: z.literal("read_equipment_options"),
      sku: z.enum(["HDMI-USB-C"]),
      quantity: z.number().int().min(1).max(20),
    })
    .strict(),
  z
    .object({ type: z.literal("read_courier_availability"), supplierIds: ids })
    .strict(),
  z
    .object({
      type: z.literal("read_route_edges"),
      supplierIds: ids,
      destination: z.enum(["auditorium", "library"]),
    })
    .strict(),
  z.object({ type: z.literal("propose") }).strict(),
  z
    .object({
      type: z.literal("finish_infeasible"),
      reason: z.enum(["no_stock", "no_courier", "no_route"]),
    })
    .strict(),
]);
export type Action = z.infer<typeof actionSchema>;
export type ActionRecord = {
  action: Action;
  outcome: "observed" | "ready" | "failed";
  count?: number;
  errorCode?: string;
};
export type Observations = {
  request: MissionRequest;
  equipment?: Supplier[];
  couriers?: Courier[];
  edges?: Edge[];
};
export interface DecisionAdapter {
  usesInference: boolean;
  select(observed: Observations, signal: AbortSignal): Promise<unknown>;
}
const stocked = (state: Observations) =>
  state.equipment?.filter(
    (s) => s.sku === state.request.sku && s.stock >= state.request.quantity,
  ) || [];
const available = (state: Observations) =>
  state.couriers?.filter(
    (c) =>
      c.available &&
      c.capacity >= state.request.quantity &&
      stocked(state).some((s) => s.id === c.supplierId),
  ) || [];
const routed = (state: Observations) =>
  available(state).some((c) => {
    const supplier = stocked(state).find((s) => s.id === c.supplierId)!;
    return (
      shortestPath({ edges: state.edges || [] }, c.node, supplier.pickupNode) &&
      shortestPath(
        { edges: state.edges || [] },
        supplier.pickupNode,
        state.request.destination,
      )
    );
  });
export const observationPolicy: DecisionAdapter = {
  usesInference: false,
  async select(state) {
    if (!state.equipment)
      return {
        type: "read_equipment_options",
        sku: state.request.sku,
        quantity: state.request.quantity,
      };
    if (!stocked(state).length)
      return { type: "finish_infeasible", reason: "no_stock" };
    const supplierIds = stocked(state).map((s) => s.id);
    if (!state.couriers)
      return { type: "read_courier_availability", supplierIds };
    if (!available(state).length)
      return { type: "finish_infeasible", reason: "no_courier" };
    if (!state.edges)
      return {
        type: "read_route_edges",
        supplierIds,
        destination: state.request.destination,
      };
    return routed(state)
      ? { type: "propose" }
      : { type: "finish_infeasible", reason: "no_route" };
  },
};
export async function coordinate(
  data: DataPort,
  identity: Identity,
  request: MissionRequest,
  budget: PlanningBudget,
  trace: ActionRecord[],
  decision: DecisionAdapter = observationPolicy,
): Promise<Snapshot> {
  const observed: Observations = { request };
  let snapshot: Snapshot | undefined;
  const load = async () => {
    if (!snapshot) {
      budget.snapshotCalls++;
      snapshot = await data.snapshot(identity, budget.signal);
    }
    return snapshot;
  };
  for (let turn = 0; turn < 8; turn++) {
    const selected = decision.usesInference
      ? await budget.inference(
          () => decision.select(structuredClone(observed), budget.signal),
          true,
        )
      : await budget.wait(() =>
          decision.select(structuredClone(observed), budget.signal),
        );
    const parsed = actionSchema.safeParse(selected);
    if (!parsed.success)
      throw new RelayError(
        503,
        "invalid_action",
        "The selected action or its arguments failed the allowlisted tool schema.",
      );
    const action = parsed.data;
    const expected = (await observationPolicy.select(
      observed,
      budget.signal,
    )) as Action;
    const allowed = new Set(stocked(observed).map((s) => s.id));
    if (
      action.type !== expected.type ||
      (action.type === "finish_infeasible" &&
        expected.type === "finish_infeasible" &&
        action.reason !== expected.reason) ||
      (action.type === "read_equipment_options" &&
        (action.sku !== request.sku || action.quantity !== request.quantity)) ||
      ((action.type === "read_courier_availability" ||
        action.type === "read_route_edges") &&
        (new Set(action.supplierIds).size !== allowed.size ||
          action.supplierIds.some((id) => !allowed.has(id)))) ||
      (action.type === "read_route_edges" &&
        action.destination !== request.destination)
    )
      throw new RelayError(
        503,
        "invalid_action",
        "The action does not follow the validated observations or confirmed request.",
      );
    if (action.type === "propose" || action.type === "finish_infeasible") {
      trace.push({ action, outcome: "ready" });
      return snapshot!;
    }
    if (action.type === "ask_user")
      throw new RelayError(
        503,
        "invalid_action",
        "Confirmed planning cannot invent missing hard requirements.",
      );
    try {
      const count = await budget.tool(async () => {
        const current = await load();
        if (action.type === "read_equipment_options") {
          observed.equipment = current.fixtures.suppliers.filter(
            (s) => s.sku === action.sku,
          );
          return observed.equipment.length;
        }
        if (action.type === "read_courier_availability") {
          observed.couriers = current.fixtures.couriers.filter((c) =>
            action.supplierIds.includes(c.supplierId),
          );
          return observed.couriers.length;
        }
        observed.edges = current.fixtures.edges;
        return observed.edges.length;
      });
      trace.push({ action, outcome: "observed", count });
    } catch (error) {
      trace.push({
        action,
        outcome: "failed",
        errorCode: error instanceof RelayError ? error.code : "read_failed",
      });
      throw error;
    }
  }
  throw new RelayError(
    503,
    "tool_budget_exhausted",
    "The bounded decision loop ended without a checked outcome.",
  );
}

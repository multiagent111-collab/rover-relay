import { z } from "zod";
import { requestSchema, type Identity, type MissionRequest } from "./types.ts";

export const intakeFields = [
  "sku",
  "quantity",
  "destination",
  "budgetCents",
  "deadlineMinutes",
] as const;
export type IntakeField = (typeof intakeFields)[number];
export const draftFieldsSchema = z
  .object({
    sku: z.enum(["HDMI-USB-C"]).optional(),
    quantity: requestSchema.shape.quantity.optional(),
    destination: requestSchema.shape.destination.optional(),
    budgetCents: requestSchema.shape.budgetCents.optional(),
    deadlineMinutes: requestSchema.shape.deadlineMinutes.optional(),
  })
  .strict();
export const intakeCreateSchema = z
  .object({ text: z.string().trim().min(1).max(1000) })
  .strict();
export const intakeUpdateSchema = z
  .object({
    revision: z.number().int().positive(),
    text: z.string().trim().min(1).max(1000).optional(),
    fields: draftFieldsSchema.optional(),
  })
  .strict()
  .refine(
    (value) => value.text !== undefined || value.fields !== undefined,
    "Supply text or reviewed fields.",
  );
export const intakeConfirmSchema = z
  .object({
    revision: z.number().int().positive(),
    confirmed: z.literal(true),
    request: requestSchema,
  })
  .strict();
export type Intake = {
  schemaVersion: "intake-1.0";
  id: string;
  missionId: string;
  owner: Identity;
  createdAt: string;
  deadlineAt: string | null;
  status: "needs_input" | "confirmed";
  revision: number;
  text: string;
  fields: Partial<MissionRequest>;
  conflicts: IntakeField[];
  questions: { field: IntakeField; message: string }[];
  confirmedRequestHash?: string;
};
const questions: Record<IntakeField, string> = {
  sku: "Confirm USB-C to HDMI compatibility. Other equipment is not supported.",
  quantity: "How many adapters (1–20)?",
  destination: "Deliver to the auditorium or library?",
  budgetCents: "What is the total USD budget including delivery?",
  deadlineMinutes: "Within how many minutes of the original request (1–240)?",
};
export function clarify(
  fields: Partial<MissionRequest>,
  conflicts: IntakeField[],
) {
  return intakeFields
    .filter((field) => fields[field] === undefined || conflicts.includes(field))
    .map((field) => ({
      field,
      message: conflicts.includes(field)
        ? `Resolve conflicting or unsupported ${field} values. ${questions[field]}`
        : questions[field],
    }));
}
// Deliberately bounded phrase extraction, not an LLM or a general language claim.
// Memory is never an input. Every extracted field still requires confirmation.
export function extractDraft(input: string) {
  const text = intakeCreateSchema.parse({ text: input }).text.toLowerCase();
  const values = new Map<IntakeField, (string | number)[]>();
  const add = (field: IntakeField, value: string | number) =>
    values.set(field, [...(values.get(field) || []), value]);
  if (/usb[ -]?c\s*(?:to|→|-)\s*hdmi/.test(text)) add("sku", "HDMI-USB-C");
  const unsupported =
    /\b(?:vga|lightning|displayport|usb[ -]?a)\b|hdmi\s*(?:to|→)\s*usb[ -]?c/.test(
      text,
    );
  const numbers: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const quantity =
    /(?<![\w.-])(-?\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:usb[ -]?c\s*(?:to|→|-)\s*hdmi\s+)?adapters?\b/g;
  for (const match of text.matchAll(quantity))
    add("quantity", numbers[match[1]] ?? Number(match[1]));
  for (const match of text.matchAll(
    /\b(?:quantity|qty)\s*[:=]?\s*(-?\d+(?:\.\d+)?)/g,
  ))
    add("quantity", Number(match[1]));
  for (const venue of ["auditorium", "library"] as const)
    if (new RegExp(`\\b${venue}\\b`).test(text)) add("destination", venue);
  for (const match of text.matchAll(
    /\$\s*(-?\d+(?:\.\d+)?)|(-?\d+(?:\.\d+)?)\s*(?:usd|dollars)\b/g,
  ))
    add(
      "budgetCents",
      /\.\d{3,}/.test(match[1] ?? match[2])
        ? NaN
        : Math.round(Number(match[1] ?? match[2]) * 100),
    );
  for (const match of text.matchAll(
    /(?<![\w.-])(-?\d+(?:\.\d+)?)\s*(?:minutes?|mins?)\b/g,
  ))
    add("deadlineMinutes", Number(match[1]));
  const fields: Partial<MissionRequest> = {};
  const conflicts: IntakeField[] = [];
  for (const [field, candidates] of values) {
    const unique = [...new Set(candidates)];
    const parsed = draftFieldsSchema.safeParse({ [field]: unique[0] });
    if (
      unique.length !== 1 ||
      !parsed.success ||
      /\b(?:not|either|maybe|or)\b/.test(text)
    )
      conflicts.push(field);
    else Object.assign(fields, parsed.data);
  }
  if (unsupported) {
    delete fields.sku;
    if (!conflicts.includes("sku")) conflicts.push("sku");
  }
  if (
    values.has("budgetCents") &&
    /\b(?:delivery[- ]only|excluding delivery|without delivery|delivery fee)\b/.test(
      text,
    )
  ) {
    delete fields.budgetCents;
    if (!conflicts.includes("budgetCents")) conflicts.push("budgetCents");
  }
  return { fields, conflicts, questions: clarify(fields, conflicts) };
}

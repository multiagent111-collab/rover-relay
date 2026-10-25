import { z } from "zod";
import {
  requestSchema,
  type Candidate,
  type MemoryContext,
  type MissionRequest,
} from "./types.ts";

// Model contract v2 has no free-form factual claims. Unknown keys (including
// legacy summary, booking, reservation or tool requests) fail closed.
export const termsSchema = requestSchema
  .extend({
    sku: z.literal("HDMI-USB-C"),
    entrance: z.string().max(300).nullable(),
    totalCents: z.number().int().min(0).max(100000000).nullable(),
    etaMinutes: z.number().finite().min(0).max(100000).nullable(),
  })
  .strict();
export const proposalSchema = z
  .object({
    contractVersion: z.literal("proposal-2.0"),
    candidateId: z.string().min(1).max(200).nullable(),
    evidenceIds: z.array(z.string().min(1).max(200)).max(100),
    terms: termsSchema,
    commitment: z.literal("uncommitted"),
    explanationCode: z.enum(["checked_option", "no_checked_option"]),
  })
  .strict();
export const issueCodeSchema = z.enum([
  "proposal_schema",
  "candidate_unknown",
  "candidate_infeasible",
  "evidence_missing",
  "evidence_invalid",
  "request_mismatch",
  "terms_mismatch",
  "unsupported_claim",
  "feasible_option_exists",
  "critique_schema",
  "critique_inconsistent",
  "refresh_required",
  "critic_revision",
]);
export const issueFieldSchema = z.enum([
  "proposal",
  "candidateId",
  "evidenceIds",
  "terms",
  "sku",
  "quantity",
  "destination",
  "budgetCents",
  "deadlineMinutes",
  "entrance",
  "totalCents",
  "etaMinutes",
  "commitment",
  "explanationCode",
  "critique",
]);
export const critiqueIssueSchema = z
  .object({
    code: issueCodeSchema,
    field: issueFieldSchema,
  })
  .strict();
export const critiqueSchema = z
  .object({
    approved: z.boolean(),
    issues: z.array(critiqueIssueSchema).max(10),
    refreshEvidence: z.boolean(),
  })
  .strict();
export type Proposal = z.infer<typeof proposalSchema>;
export type Critique = z.infer<typeof critiqueSchema>;
export type ReviewIssue = z.infer<typeof critiqueIssueSchema> & {
  repair: string;
  expected?: string | number | null | string[];
};
const repairs: Record<ReviewIssue["code"], string> = {
  proposal_schema:
    "Return only the complete proposal-2.0 contract; no summary, booking or tool fields.",
  candidate_unknown:
    "Choose a supplied candidate ID or null when no checked option exists.",
  candidate_infeasible:
    "Choose a candidate whose required checks all pass, or report null.",
  evidence_missing:
    "Copy all required citation IDs from the checked candidate(s).",
  evidence_invalid:
    "Use each required citation exactly once; remove other IDs.",
  request_mismatch:
    "Copy the confirmed request and entrance exactly; do not relax constraints.",
  terms_mismatch:
    "Copy deterministic totalCents and etaMinutes, or null for an infeasible report.",
  unsupported_claim:
    "Use uncommitted structured terms only; no reservations, bookings or guarantees.",
  feasible_option_exists: "Select an available checked option instead of null.",
  critique_schema:
    "A separate Critic must return approved, structured issues and refreshEvidence.",
  critique_inconsistent:
    "Approval requires no issues and no evidence refresh request.",
  refresh_required:
    "Revise the proposal against the refreshed checked candidates.",
  critic_revision:
    "Address the independent Critic's structured issues in the one repair attempt.",
};
export function issue(
  code: ReviewIssue["code"],
  field: ReviewIssue["field"],
  expected?: ReviewIssue["expected"],
): ReviewIssue {
  return {
    code,
    field,
    repair: repairs[code],
    ...(expected !== undefined ? { expected } : {}),
  };
}
export function checked(candidate: Candidate) {
  const required = [
    "evidence",
    "sku",
    "stock",
    "courier",
    "capacity",
    "route",
    "budget",
    "deadline",
  ];
  return (
    candidate.feasible &&
    candidate.checks.every((c) => c.passed) &&
    required.every((code) =>
      candidate.checks.some((c) => c.code === code && c.passed),
    )
  );
}
export function expectedTerms(
  request: MissionRequest,
  memory: MemoryContext,
  candidate?: Candidate,
) {
  return {
    ...request,
    entrance: memory.entrance,
    totalCents: candidate?.totalCents ?? null,
    etaMinutes: candidate?.travelMinutes ?? null,
  };
}
export function requiredCitations(
  candidates: Candidate[],
  candidate?: Candidate,
) {
  return [
    ...new Set(
      (candidate ? [candidate] : candidates).flatMap((c) => c.evidenceIds),
    ),
  ];
}
export function proposalFor(
  request: MissionRequest,
  memory: MemoryContext,
  candidates: Candidate[],
  candidate?: Candidate,
): Proposal {
  return {
    contractVersion: "proposal-2.0",
    candidateId: candidate?.id ?? null,
    evidenceIds: requiredCitations(candidates, candidate),
    terms: expectedTerms(request, memory, candidate),
    commitment: "uncommitted",
    explanationCode: candidate ? "checked_option" : "no_checked_option",
  };
}
export function validateProposal(
  proposal: Proposal,
  request: MissionRequest,
  memory: MemoryContext,
  candidates: Candidate[],
) {
  const issues: ReviewIssue[] = [];
  const chosen = candidates.find((c) => c.id === proposal.candidateId);
  if (proposal.candidateId !== null && !chosen)
    issues.push(issue("candidate_unknown", "candidateId"));
  if (chosen && !checked(chosen))
    issues.push(issue("candidate_infeasible", "candidateId"));
  if (proposal.candidateId === null && candidates.some(checked))
    issues.push(issue("feasible_option_exists", "candidateId"));
  const expected = expectedTerms(request, memory, chosen);
  for (const field of Object.keys(expected) as (keyof typeof expected)[]) {
    if (proposal.terms[field] !== expected[field])
      issues.push(
        issue(
          field === "totalCents" || field === "etaMinutes"
            ? "terms_mismatch"
            : "request_mismatch",
          field,
          expected[field],
        ),
      );
  }
  const citations = requiredCitations(candidates, chosen);
  const missing = citations.filter((id) => !proposal.evidenceIds.includes(id));
  if (missing.length)
    issues.push(issue("evidence_missing", "evidenceIds", missing));
  if (
    new Set(proposal.evidenceIds).size !== proposal.evidenceIds.length ||
    proposal.evidenceIds.some((id) => !citations.includes(id))
  )
    issues.push(issue("evidence_invalid", "evidenceIds", citations));
  const explanation =
    proposal.candidateId === null ? "no_checked_option" : "checked_option";
  if (proposal.explanationCode !== explanation)
    issues.push(issue("unsupported_claim", "explanationCode", explanation));
  return issues;
}
export function receiptSummary(request: MissionRequest, candidate?: Candidate) {
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const limits = `${request.quantity} ${request.sku} to ${request.destination}; limit ${money(request.budgetCents)} including delivery within ${request.deadlineMinutes} minutes of the original request.`;
  return candidate
    ? `${limits} Checked estimate: ${money(candidate.totalCents)} including delivery, ${candidate.travelMinutes} minutes travel and handling. Inventory is not reserved; no delivery is booked.`
    : `${limits} No checked option satisfies all constraints. No inventory is reserved or delivery booked.`;
}

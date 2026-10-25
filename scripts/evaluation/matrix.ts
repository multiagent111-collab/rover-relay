export type Observation = {
  kind?: string;
  name: string;
  result: string;
  durationMs?: number | null;
  file?: string | null;
};
// Exact names make renamed or missing evidence unresolved, never a silent pass.
const requirements: [string, string, string[]][] = [
  [
    "A01",
    "Canonical checked mission and explicit approval",
    [
      "normal request produces a checked receipt and exactly one task on duplicate approval",
    ],
  ],
  [
    "A02",
    "Clarification without invented constraints",
    [
      "incomplete drafts persist needs_input without sources, inference, memory-derived requirements or tasks",
    ],
  ],
  [
    "A03",
    "Observation-dependent bounded actions",
    [
      "different observations change next actions: no stock skips courier/route reads, no courier skips routes, feasible stock proposes",
    ],
  ],
  [
    "A04",
    "Independent critique and bounded repair",
    [
      "independent Critic identifies a legitimate invalid proposal; one targeted repair changes the selection",
    ],
  ],
  [
    "A05",
    "Insufficient quantity and no fake reservation",
    [
      "stock change rejects the old approval and creates a critiqued replacement",
    ],
  ],
  [
    "A06",
    "Canonical $30 budget and checked $2 alternative",
    [
      "tight budget returns the computed $2 minimum change without creating a task",
    ],
  ],
  [
    "A07",
    "Impossible deadline and honest alternatives",
    [
      "budget and time alternatives use separate eligible sets, exclude unproven options and explicitly explain combined or unavailable cases",
    ],
  ],
  [
    "A08",
    "Named route closure invalidates approval",
    [
      "stock, named edge and entrance changes produce structured replacement receipts that need fresh approval",
    ],
  ],
  [
    "A09",
    "Expired or stale approval cannot execute",
    [
      "expired proposal cannot dispatch and absolute mission deadline is preserved",
    ],
  ],
  [
    "A10",
    "Concurrent double approval",
    [
      "PostgreSQL: eight approvals overlap at the row lock and replay one committed task",
    ],
  ],
  [
    "A11",
    "Competing missions do not double reserve",
    [
      "PostgreSQL: competing keys and competing missions cannot double reserve one courier",
    ],
  ],
  [
    "A12",
    "Actual process crash, stable task/outbox retry",
    [
      "PostgreSQL: crash after approval COMMIT and after outbox COMMIT preserves IDs and terms on restart/retry",
    ],
  ],
  [
    "A13",
    "Decline/cancel, release and fresh approval",
    [
      "a decline releases the slot, excludes that courier only for this mission, and duplicate or old events cannot replan again",
      "PostgreSQL: acceptance/cancellation races honor revisions, and cancelled queued outbox never sends later",
    ],
  ],
  [
    "A14",
    "Actual serial restart changes agent/task memory",
    [
      "real serial process restarts prove both-role recall, corrected task terms, stale-approval rejection, forgetting and scope isolation",
    ],
  ],
  [
    "A15",
    "Correction/forget cannot revive old approval",
    [
      "forget-and-reconfirm cycles never revive an old approval even when the effective preference returns to empty",
    ],
  ],
  [
    "A16",
    "Owner and tenant isolation",
    [
      "another demo identity cannot read missions, approve plans, or recall preferences",
      "PostgreSQL: original key conflicts on changed payload, is owner scoped and denies cross-owner replay",
    ],
  ],
  [
    "A17",
    "Bounded model/connector failures",
    [
      "an output-limit response cannot become an accepted proposal even when its prefix is valid JSON",
      "the overall deadline bounds adapters that ignore cancellation and persists failure without dispatch",
      "Nightshift unauthorized and malformed output remain distinct controlled failures",
      "evaluation fault set: TLS failure, rate limit, authentication and timeout reject without fallback",
    ],
  ],
  [
    "A18",
    "Source freshness, coverage and provenance",
    [
      "Zetaris stale observations and unsafe configured identifiers fail closed",
      "missing or tampered observations fail candidate checks; blocked paths require complete graph evidence",
    ],
  ],
  [
    "A19",
    "Browser presentation, recovery and PostgreSQL chronology",
    [
      "live maps use fresh receipt route facts and never substitute sample stock/couriers/edges",
      "browser requests prevent later mutations after cancellation and keep network/auth failures actionable",
      "PostgreSQL: mission history survives JSONB key ordering with chronological ties and owner filtering",
    ],
  ],
];
export function acceptanceMatrix(
  observations: Observation[],
  gates: { clean: boolean; provenance: boolean },
) {
  const rows = requirements.map(([id, scenario, names]) => {
    const evidence = names.map((name) => ({
      name,
      observations: observations.filter((o) => o.name === name),
    }));
    const result = evidence.some((e) =>
      e.observations.some((o) => o.result === "fail"),
    )
      ? "fail"
      : evidence.every(
            (e) =>
              e.observations.length > 0 &&
              e.observations.every((o) => o.result === "pass"),
          )
        ? "pass"
        : "unresolved";
    return {
      id,
      scenario,
      result,
      scope:
        id === "A19"
          ? "Controlled component/recovery tests and real PostgreSQL; live browser observations are separate evidence."
          : id === "A18"
            ? "Controlled source faults; actual federation evidence is separately labeled."
            : "Controlled regression/actual PostgreSQL as named.",
      evidence,
    };
  });
  return [
    ...rows,
    {
      id: "A20",
      scenario: "Independent clean sample with official H-MEM",
      result: gates.clean ? "pass" : "unresolved",
      scope:
        "Clean locked install/build, measured offline scenarios, official source/conformance checks.",
      evidence: [],
    },
    ...["A21", "A22", "A23"].map((id) => ({
      id,
      scenario:
        id === "A21"
          ? "Private ROVER shadow"
          : id === "A22"
            ? "Private ROVER execution"
            : "Ordinary ROVER regression",
      result: "deferred",
      scope:
        "Deferred by user; no private source/service or real job tested. Controlled HTTP fixture results do not satisfy this gate.",
      evidence: [],
    })),
    {
      id: "A24",
      scenario: "Immutable baseline and declared event delta",
      result: gates.provenance ? "pass" : "unresolved",
      scope:
        "Protected baseline inventory, public Git comparison and tracked plus untracked candidate scan; hashes are not proof of line authorship.",
      evidence: [],
    },
  ];
}
export function publicGate(
  rows: ReturnType<typeof acceptanceMatrix>,
  regressionPassed: boolean,
) {
  return regressionPassed &&
    rows
      .filter((r) => !["A21", "A22", "A23"].includes(r.id))
      .every((r) => r.result === "pass")
    ? "pass"
    : "fail";
}

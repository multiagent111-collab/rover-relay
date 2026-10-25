import React from "react";
import type { Mission, Task } from "../src/types.ts";
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
export function ChangeComparison({
  mission,
  task = null,
}: {
  mission: Mission;
  task?: Task | null;
}) {
  const change = mission.receipt?.changeDetails;
  if (!change) return null;
  const a = change.previous.terms,
    b = change.current.terms;
  const rows: [string, string, string][] = [
    [
      "Supplier / courier",
      a ? `${a.supplierId} / ${a.courierId}` : "No option",
      b ? `${b.supplierId} / ${b.courierId}` : "No option",
    ],
    [
      "Equipment",
      a ? `${a.quantity} × ${money(a.unitPriceCents)}` : "—",
      b ? `${b.quantity} × ${money(b.unitPriceCents)}` : "—",
    ],
    [
      "Delivery / total",
      a ? `${money(a.deliveryCents)} / ${money(a.totalCents)}` : "—",
      b ? `${money(b.deliveryCents)} / ${money(b.totalCents)}` : "—",
    ],
    ["ETA", a ? `${a.etaMinutes} min` : "—", b ? `${b.etaMinutes} min` : "—"],
    [
      "Route",
      a?.routeEdges.join(" → ") || "—",
      b?.routeEdges.join(" → ") || "—",
    ],
    [
      "Entrance",
      a?.entrance || "Not confirmed",
      b?.entrance || "Not confirmed",
    ],
  ];
  return (
    <section className="change-comparison" aria-label="Changed plan comparison">
      <h3>Review the changed plan</h3>
      <p>
        {task?.planDigest === mission.receipt?.digest
          ? "These terms were approved for the stored simulated task."
          : "Fresh approval required."}{" "}
        {change.reasons.map((r) => r.replaceAll("_", " ")).join(" · ")}
      </p>
      <div className="table-scroll">
        <table>
          <caption>
            Previous plan {change.previous.version} compared with plan{" "}
            {change.current.version}
          </caption>
          <thead>
            <tr>
              <th scope="col">Term</th>
              <th scope="col">Previous</th>
              <th scope="col">Current proposal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, old, next]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>{old}</td>
                <td>{next}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        Original deadline:{" "}
        {new Date(change.originalDeadlineAt).toLocaleString()}. Stock remains
        observed, not reserved.
      </p>
      <details>
        <summary>Changed source records and memory revisions</summary>
        <pre>
          {JSON.stringify(
            {
              sourceChanges: change.sourceChanges,
              memory: change.memory,
              previousDigest: change.previous.digest,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </section>
  );
}
export function ApprovalTerms({
  mission,
  task,
}: {
  mission: Mission;
  task: Task | null;
}) {
  const receipt = mission.receipt;
  if (!receipt) return null;
  return (
    <details className="approval-terms">
      <summary>Exact plan and approval identifiers</summary>
      <dl>
        <dt>Mission</dt>
        <dd>{mission.id}</dd>
        <dt>Current plan</dt>
        <dd>
          Version {receipt.version} · {receipt.digest}
        </dd>
        <dt>Original deadline</dt>
        <dd>{new Date(mission.deadlineAt).toLocaleString()}</dd>
        <dt>Proposal expires</dt>
        <dd>{new Date(receipt.expiresAt).toLocaleString()}</dd>
        <dt>Source fingerprint</dt>
        <dd>{receipt.sourceFingerprint}</dd>
        <dt>Memory revision / records</dt>
        <dd>
          {receipt.memoryRevision} ·{" "}
          {receipt.memory.records.map((r) => r.id).join(", ") ||
            "No recalled record"}
        </dd>
        {task && (
          <>
            <dt>Stored simulated task</dt>
            <dd>
              {task.id} · approved plan {task.planVersion} · {task.planDigest} ·{" "}
              {task.entrance || "No entrance confirmed"}
            </dd>
          </>
        )}
      </dl>
    </details>
  );
}

import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  Candidate,
  Event,
  Fixtures,
  MemoryContext,
  Mission,
  MissionRequest,
  Task,
} from "../src/types.ts";
import "./style.css";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const label = (value: string) => value.replaceAll("_", " ");
type Bootstrap = {
  mode: string;
  fixtures: Fixtures;
  missions: Mission[];
  preferences: MemoryContext;
};
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    arrow: (
      <>
        <path d="M4 12h16m-6-6 6 6-6 6" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    box: (
      <>
        <path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 10v9M3 8l9 5 9-5M7.5 5.5l9 5v4" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6v6l4 2" />
      </>
    ),
    route: (
      <>
        <circle cx="5" cy="6" r="2" />
        <circle cx="19" cy="18" r="2" />
        <path d="M7 6h9a4 4 0 0 1 0 8H8a4 4 0 0 0-4 4h13" />
      </>
    ),
    memory: (
      <>
        <path d="M9 4a3 3 0 0 0-5 3v1a4 4 0 0 0 0 8v1a3 3 0 0 0 5 3m6-16a3 3 0 0 1 5 3v1a4 4 0 0 1 0 8v1a3 3 0 0 1-5 3M9 4v16m6-16v16M4 9h3m10 6h3" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" />
      </>
    ),
    file: (
      <>
        <path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8m-8 4h6" />
      </>
    ),
    signal: (
      <>
        <path d="M5 20v-4m5 4v-8m5 8V8m5 12V4" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.box}
    </svg>
  );
}

function CampusMap({
  fixtures,
  selected,
}: {
  fixtures: Fixtures;
  selected?: Candidate;
}) {
  const byId = Object.fromEntries(
    fixtures.nodes.map((node) => [node.id, node]),
  );
  return (
    <div className="map-wrap">
      <div className="map-caption">
        <span>
          <span className="live-dot" /> Campus schematic
        </span>
        <span>Illustrative travel times</span>
      </div>
      <svg
        className="campus-map"
        viewBox="0 0 660 410"
        role="img"
        aria-label="Campus route schematic with suppliers, couriers and destinations"
      >
        <defs>
          <pattern
            id="grid"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r="1" fill="#d7ded9" />
          </pattern>
        </defs>
        <rect width="660" height="410" fill="url(#grid)" />
        <path
          d="M0 280c100-40 155 30 245-5s140-25 175 5 150 5 240-40"
          fill="none"
          stroke="#d8e8e4"
          strokeWidth="32"
        />
        <rect x="315" y="265" width="110" height="85" rx="25" fill="#e5eddf" />
        <rect x="90" y="35" width="80" height="85" rx="18" fill="#e5eddf" />
        {fixtures.edges.map((edge) => {
          const from = byId[edge.from],
            to = byId[edge.to];
          if (!from || !to) return null;
          const active = selected?.routeEdges.includes(edge.id);
          return (
            <g key={edge.id}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={
                  edge.closed ? "#c25948" : active ? "#dc7840" : "#c6d0ca"
                }
                strokeWidth={active ? 5 : 2.5}
                strokeDasharray={edge.closed ? "7 6" : undefined}
              />
              {edge.closed && (
                <text
                  x={(from.x + to.x) / 2}
                  y={(from.y + to.y) / 2 - 9}
                  fontSize="11"
                  fill="#a3483c"
                >
                  CLOSED
                </text>
              )}
            </g>
          );
        })}
        {fixtures.nodes.map((node) => {
          const destination = node.id === "auditorium" || node.id === "library";
          const active = selected?.routeNodes.includes(node.id);
          return (
            <g key={node.id}>
              <circle
                cx={node.x}
                cy={node.y}
                r={destination ? 11 : node.id === "junction" ? 5 : 9}
                fill={destination ? "#142d3e" : active ? "#dc7840" : "#fff"}
                stroke={destination ? "#fff" : "#6b8576"}
                strokeWidth="3"
              />
              <text
                x={node.x}
                y={node.y + (node.id === "supplier-c" ? 27 : -21)}
                textAnchor="middle"
                fill="#304a45"
                fontSize="12"
                fontWeight="600"
              >
                {node.name}
              </text>
              {node.id === selected?.supplier.pickupNode && (
                <text
                  x={node.x}
                  y={node.y + 31}
                  textAnchor="middle"
                  fill="#a75128"
                  fontSize="10"
                >
                  SELECTED PICKUP
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="map-legend">
        <span>
          <i className="legend-line orange" /> Proposed route
        </span>
        <span>
          <i className="legend-line gray" /> Other paths
        </span>
        <span>
          <i className="legend-line red" /> Closed path
        </span>
      </div>
    </div>
  );
}

function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [mission, setMission] = useState<Mission | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [task, setTask] = useState<Task | null>(null);
  const [tab, setTab] = useState<"plan" | "evidence">("plan");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const [token, setToken] = useState(
    sessionStorage.getItem("relay-token") || "",
  );
  const [tokenDraft, setTokenDraft] = useState("");
  const [entrance, setEntrance] = useState("North loading entrance");
  const [memory, setMemory] = useState<MemoryContext | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [request, setRequest] = useState<MissionRequest>({
    sku: "HDMI-USB-C",
    quantity: 2,
    destination: "auditorium",
    budgetCents: 3500,
    deadlineMinutes: 30,
  });
  const call = useCallback(
    async <T,>(path: string, method = "GET", body?: unknown): Promise<T> => {
      const response = await fetch(path, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Request failed.");
      return result as T;
    },
    [token],
  );
  const load = useCallback(
    async (id?: string) => {
      const data = await call<Bootstrap>("/v1/bootstrap");
      setBootstrap(data);
      if (id) {
        const current = await call<Mission>(`/v1/missions/${id}`);
        setMission(current);
        setEvents(await call<Event[]>(`/v1/missions/${id}/events`));
        setTask(
          current.taskId
            ? await call<Task>(`/v1/tasks/${current.taskId}`)
            : null,
        );
      }
    },
    [call],
  );
  useEffect(() => {
    load().catch((error) => setProblem(error.message));
  }, [load]);
  useEffect(() => {
    call<MemoryContext>(`/v1/preferences/entrance?venue=${request.destination}`)
      .then(setMemory)
      .catch(() => {});
  }, [call, request.destination]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setProblem("");
    setNotice("");
    try {
      await operation();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Operation failed.");
      if (mission) await load(mission.id).catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  const selected = mission?.receipt?.candidates.find(
    (candidate) => candidate.id === mission.receipt?.selectedId,
  );
  const expiry = mission?.receipt
    ? Math.max(
        0,
        Math.ceil((Date.parse(mission.receipt.expiresAt) - clock) / 1000),
      )
    : 0;
  const working =
    task &&
    ["queued", "dispatch_requested", "accepted", "in_progress"].includes(
      task.status,
    );
  const createMission = () =>
    run(async () => {
      const created = await call<Mission>("/v1/missions", "POST", request);
      await load(created.id);
      setTab("plan");
    });
  const replan = () =>
    run(async () => {
      if (!mission) return;
      await call(`/v1/missions/${mission.id}/replan`, "POST", {});
      await load(mission.id);
    });
  const approve = () =>
    run(async () => {
      if (!mission?.receipt) return;
      const receipt = mission.receipt;
      await call<Task>(`/v1/missions/${mission.id}/approve`, "POST", {
        version: receipt.version,
        digest: receipt.digest,
        idempotencyKey: `approval-${mission.id}-${receipt.version}`,
      });
      await load(mission.id);
      setNotice(
        "One simulated dispatch task created. Inventory is not reserved.",
      );
    });
  const respond = (status: string) =>
    run(async () => {
      if (!task || !mission) return;
      await call(`/demo/tasks/${task.id}/response`, "POST", { status });
      await load(mission.id);
    });
  const saveEntrance = () =>
    run(async () => {
      const saved = await call<MemoryContext>(
        "/v1/preferences/entrance",
        "PUT",
        { venue: request.destination, entrance },
      );
      setMemory(saved);
      setNotice(
        "Confirmed entrance saved in Meterless H-MEM. Future plans will recall it.",
      );
    });
  const downloadEvidence = () =>
    run(async () => {
      if (!mission) return;
      const rows = await call<Event[]>(`/v1/missions/${mission.id}/events`);
      const url = URL.createObjectURL(
        new Blob([rows.map((row) => JSON.stringify(row)).join("\n") + "\n"], {
          type: "application/x-ndjson",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `relay-${mission.id}.jsonl`;
      anchor.click();
      URL.revokeObjectURL(url);
    });
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Relay home">
          <img src="/relay.svg" width="36" height="36" alt="" />
          <strong>
            relay<span> / ROVER</span>
          </strong>
        </a>
        <nav aria-label="Workspace">
          <span className="nav-active">Mission workspace</span>
          <span className="nav-secondary">Campus operations</span>
        </nav>
        <div className="top-status">
          <span className="live-dot" /> Standalone preview{" "}
          <span className="avatar">EC</span>
        </div>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <div className="eyebrow">CAMPUS EQUIPMENT RESCUE</div>
            <h1>A plan for the unexpected.</h1>
            <p>
              Find the equipment. Check the options. Coordinate the handoff.
            </p>
          </div>
          <span className="mode-badge">
            <Icon name="signal" size={15} />
            {bootstrap?.mode === "live_sponsors"
              ? "Live sponsor adapters"
              : "Offline sample"}
            <span className="badge-divider" />
            Simulated operations
          </span>
        </div>
        {problem && (
          <div className="message error" role="alert">
            <strong>Action needed</strong>
            <span>{problem}</span>
            <button onClick={() => setProblem("")} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="message success" role="status">
            <Icon name="check" />
            <span>{notice}</span>
            <button
              onClick={() => setNotice("")}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        )}
        {!bootstrap && (
          <section className="token-card panel">
            <h2>Connect to Relay</h2>
            <p>
              Sample mode needs no credentials. Live mode uses the server's
              Relay access token.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                sessionStorage.setItem("relay-token", tokenDraft);
                setProblem("");
                setToken(tokenDraft);
              }}
            >
              <label htmlFor="access-token">Relay access token</label>
              <div className="inline-field">
                <input
                  id="access-token"
                  type="password"
                  value={tokenDraft}
                  onChange={(event) => setTokenDraft(event.target.value)}
                  autoComplete="off"
                />
                <button className="primary" type="submit">
                  Connect
                </button>
              </div>
            </form>
          </section>
        )}
        <div className="workspace">
          <aside className="left-column">
            <section className="panel request-panel">
              <div className="section-label">
                <span className="number">01</span> NEW REQUEST
              </div>
              <h2>What do you need?</h2>
              <p className="muted small">
                One item. One pickup. One reliable plan.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  createMission();
                }}
              >
                <label htmlFor="equipment">Equipment</label>
                <div className="equipment-field">
                  <Icon name="box" />
                  <select
                    id="equipment"
                    value={request.sku}
                    onChange={() => {}}
                  >
                    <option value="HDMI-USB-C">USB-C to HDMI adapter</option>
                  </select>
                </div>
                <div className="field-pair">
                  <div>
                    <label htmlFor="quantity">Quantity</label>
                    <input
                      id="quantity"
                      type="number"
                      min="1"
                      max="20"
                      value={request.quantity}
                      onChange={(event) =>
                        setRequest({
                          ...request,
                          quantity: Number(event.target.value),
                        })
                      }
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="deadline">Within minutes</label>
                    <input
                      id="deadline"
                      type="number"
                      min="1"
                      max="240"
                      value={request.deadlineMinutes}
                      onChange={(event) =>
                        setRequest({
                          ...request,
                          deadlineMinutes: Number(event.target.value),
                        })
                      }
                      required
                    />
                  </div>
                </div>
                <label htmlFor="destination">Deliver to</label>
                <select
                  id="destination"
                  value={request.destination}
                  onChange={(event) =>
                    setRequest({
                      ...request,
                      destination: event.target
                        .value as MissionRequest["destination"],
                    })
                  }
                >
                  <option value="auditorium">Auditorium</option>
                  <option value="library">Library</option>
                </select>
                <label htmlFor="budget">
                  Total budget <span className="muted">including delivery</span>
                </label>
                <div className="currency-field">
                  <span>$</span>
                  <input
                    id="budget"
                    type="number"
                    min="0"
                    max="10000"
                    step="0.01"
                    value={request.budgetCents / 100}
                    onChange={(event) =>
                      setRequest({
                        ...request,
                        budgetCents: Math.round(
                          Number(event.target.value) * 100,
                        ),
                      })
                    }
                    required
                  />
                  <span>USD</span>
                </div>
                <div className="scenario-row">
                  <span>Try a scenario</span>
                  <button
                    type="button"
                    onClick={() =>
                      setRequest({
                        ...request,
                        budgetCents: 3500,
                        deadlineMinutes: 30,
                      })
                    }
                  >
                    Standard
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRequest({
                        ...request,
                        budgetCents: 3000,
                        deadlineMinutes: 30,
                      })
                    }
                  >
                    Tight budget
                  </button>
                </div>
                <button
                  className="primary full"
                  disabled={busy || !bootstrap}
                  type="submit"
                >
                  {busy ? "Working…" : "Find a delivery plan"}
                  <Icon name="arrow" size={18} />
                </button>
              </form>
            </section>
            <section className="panel memory-panel">
              <div className="card-title">
                <Icon name="memory" />
                <h3>Remember the details</h3>
                <span className="mini-tag">H-MEM</span>
              </div>
              <p className="muted small">
                Confirmed entrance for the {request.destination}. Recalled
                across restarts.
              </p>
              <label className="sr-only" htmlFor="entrance">
                Delivery entrance preference
              </label>
              <input
                id="entrance"
                value={entrance}
                onChange={(event) => setEntrance(event.target.value)}
                maxLength={120}
              />
              <div className="memory-actions">
                <button
                  className="text-button"
                  disabled={busy || entrance.trim().length < 2}
                  onClick={saveEntrance}
                >
                  Save preference
                </button>
                <button
                  className="text-button muted"
                  disabled={busy || !memory?.records.length}
                  onClick={() =>
                    run(async () => {
                      setMemory(
                        await call<MemoryContext>(
                          "/v1/preferences/entrance",
                          "DELETE",
                          { venue: request.destination },
                        ),
                      );
                      setNotice("Entrance preference forgotten.");
                    })
                  }
                >
                  Forget
                </button>
              </div>
              {memory?.entrance ? (
                <div className="memory-saved">
                  <Icon name="check" size={15} />
                  {memory.entrance}
                </div>
              ) : (
                <div className="small muted">No confirmed entrance yet.</div>
              )}
            </section>
            {bootstrap && bootstrap.missions.length > 0 && (
              <section className="recent">
                <div className="section-label">RECENT MISSIONS</div>
                {bootstrap.missions.slice(0, 4).map((item) => (
                  <button
                    className={item.id === mission?.id ? "recent-active" : ""}
                    key={item.id}
                    onClick={() => run(() => load(item.id))}
                  >
                    <span>
                      {item.request.quantity} adapters →{" "}
                      {item.request.destination}
                    </span>
                    <small>{label(item.status)}</small>
                  </button>
                ))}
              </section>
            )}
          </aside>
          <section className="center-column">
            {bootstrap && (
              <CampusMap fixtures={bootstrap.fixtures} selected={selected} />
            )}
            <section className="panel decision-panel">
              <div className="decision-header">
                <div>
                  <div className="section-label">
                    <span className="number">02</span> DECISION RECEIPT
                  </div>
                  <h2>
                    {mission
                      ? selected
                        ? "A handoff that fits."
                        : mission.status === "infeasible"
                          ? "Let’s adjust the constraints."
                          : "Your mission"
                      : "Your next move, explained."}
                  </h2>
                </div>
                {mission?.receipt && (
                  <span className="version-chip">
                    PLAN {mission.receipt.version}
                  </span>
                )}
              </div>
              {!mission ? (
                <div className="empty-state">
                  <span className="empty-icon">
                    <Icon name="route" size={32} />
                  </span>
                  <h3>Start with what you need.</h3>
                  <p>
                    Relay will compare suppliers and couriers, check your
                    constraints, and explain the tradeoffs.
                  </p>
                  <div className="empty-stages">
                    <span>Find evidence</span>
                    <Icon name="arrow" size={15} />
                    <span>Challenge the plan</span>
                    <Icon name="arrow" size={15} />
                    <span>Approve a handoff</span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="receipt-meta">
                    <span
                      className={`status ${mission.status === "infeasible" ? "amber" : ""}`}
                    >
                      {label(mission.status)}
                    </span>
                    <span>
                      {mission.request.quantity} adapters ·{" "}
                      {mission.request.destination} ·{" "}
                      {money(mission.request.budgetCents)} limit
                    </span>
                  </div>
                  <div
                    className="tabs"
                    role="tablist"
                    aria-label="Receipt views"
                  >
                    <button
                      role="tab"
                      aria-selected={tab === "plan"}
                      className={tab === "plan" ? "active" : ""}
                      onClick={() => setTab("plan")}
                    >
                      Plan & alternatives
                    </button>
                    <button
                      role="tab"
                      aria-selected={tab === "evidence"}
                      className={tab === "evidence" ? "active" : ""}
                      onClick={() => setTab("evidence")}
                    >
                      Evidence & agent steps{" "}
                      <span>{mission.receipt?.steps.length ?? 0}</span>
                    </button>
                  </div>
                  {mission.receipt?.change && (
                    <div className="change-notice">
                      <Icon name="refresh" size={18} />
                      <p>{mission.receipt.change}</p>
                    </div>
                  )}
                  {tab === "plan" ? (
                    <div role="tabpanel">
                      {selected && (
                        <>
                          <div className="recommended">
                            <div className="recommended-top">
                              <span className="green-label">
                                <Icon name="check" size={14} /> CHECKED OPTION
                              </span>
                              <span>
                                {working
                                  ? "Simulated task active"
                                  : expiry
                                    ? `Approval expires in ${expiry}s`
                                    : "Proposal expired"}
                              </span>
                            </div>
                            <div className="plan-route">
                              <div className="supplier-icon">
                                <Icon name="box" size={24} />
                              </div>
                              <div>
                                <h3>{selected.supplier.name}</h3>
                                <p>
                                  {selected.courier.name} delivers to the{" "}
                                  {mission.request.destination}
                                </p>
                              </div>
                              <div className="plan-price">
                                {money(selected.totalCents)}
                                <small>estimated total</small>
                              </div>
                            </div>
                            <div className="plan-stats">
                              <span>
                                <Icon name="clock" size={16} />
                                {selected.travelMinutes} min estimated
                              </span>
                              <span>
                                {mission.request.quantity} ×{" "}
                                {money(selected.supplier.unitPriceCents)} +{" "}
                                {money(selected.courier.deliveryCents)} delivery
                              </span>
                            </div>
                            <div className="entrance-note">
                              <Icon name="memory" size={15} />
                              {mission.receipt?.memory.entrance ||
                                "No entrance preference confirmed."}
                            </div>
                          </div>
                          <div className="check-list">
                            {selected.checks.map((check) => (
                              <span key={check.code}>
                                <Icon name="check" size={13} />
                                {label(check.code)}
                              </span>
                            ))}
                          </div>
                        </>
                      )}
                      {!selected && (
                        <div className="infeasible">
                          <h3>No checked option fits every constraint.</h3>
                          <p>
                            Relay will not change your budget, quantity, or
                            deadline without a new request.
                          </p>
                        </div>
                      )}
                      <h4 className="table-title">
                        Compared options{" "}
                        <span>
                          {mission.receipt?.candidates.length ?? 0} checked
                        </span>
                      </h4>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Supplier / courier</th>
                              <th>Total</th>
                              <th>ETA</th>
                              <th>Result</th>
                            </tr>
                          </thead>
                          <tbody>
                            {mission.receipt?.candidates.map((candidate) => (
                              <tr
                                key={candidate.id}
                                className={
                                  candidate.id === selected?.id
                                    ? "selected-row"
                                    : ""
                                }
                              >
                                <td>
                                  <strong>{candidate.supplier.name}</strong>
                                  <small>{candidate.courier.name}</small>
                                </td>
                                <td>{money(candidate.totalCents)}</td>
                                <td>
                                  {candidate.travelMinutes === 100000
                                    ? "—"
                                    : `${candidate.travelMinutes}m`}
                                </td>
                                <td>
                                  <span
                                    className={
                                      candidate.feasible
                                        ? "result-pass"
                                        : "result-fail"
                                    }
                                  >
                                    {candidate.id === selected?.id
                                      ? "Recommended"
                                      : candidate.feasible
                                        ? "Feasible backup"
                                        : candidate.checks
                                            .filter((check) => !check.passed)
                                            .map((check) => label(check.code))
                                            .join(", ")}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {mission.receipt && !selected && (
                        <div className="alternatives">
                          <h4>What would make this possible?</h4>
                          <p>Within the checked options:</p>
                          <div>
                            <span>Additional budget</span>
                            <strong>
                              {mission.receipt.alternatives
                                .budgetIncreaseCents === null
                                ? "No budget-only fix"
                                : `+${money(mission.receipt.alternatives.budgetIncreaseCents)}`}
                            </strong>
                          </div>
                          <div>
                            <span>Deadline extension</span>
                            <strong>
                              {mission.receipt.alternatives
                                .deadlineExtensionMinutes === null
                                ? "No time-only fix"
                                : `+${mission.receipt.alternatives.deadlineExtensionMinutes} min`}
                            </strong>
                          </div>
                          <button
                            className="text-button"
                            onClick={() => {
                              setRequest({
                                ...mission.request,
                                budgetCents:
                                  mission.request.budgetCents +
                                  (mission.receipt?.alternatives
                                    .budgetIncreaseCents ?? 0),
                              });
                              setNotice(
                                "Budget copied to the request. Review it, then create a new mission to confirm.",
                              );
                            }}
                          >
                            Copy suggested budget to request{" "}
                            <Icon name="arrow" size={14} />
                          </button>
                        </div>
                      )}
                      <div className="receipt-foot">
                        <span>
                          Stock observed, not reserved. Travel and fees are
                          synthetic.
                        </span>
                        {!working && (
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={replan}
                          >
                            <Icon name="refresh" size={14} />
                            Refresh plan
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="evidence-content" role="tabpanel">
                      <div className="evidence-heading">
                        <span>
                          Structured decisions ·{" "}
                          {label(mission.receipt?.mode || "")}
                        </span>
                        <button
                          className="text-button"
                          onClick={downloadEvidence}
                        >
                          <Icon name="file" size={15} />
                          Export JSONL
                        </button>
                      </div>
                      {mission.receipt?.steps.map((step, index) => (
                        <div className="agent-step" key={index}>
                          <span
                            className={`agent-bullet ${step.role.toLowerCase()}`}
                          >
                            {step.role[0]}
                          </span>
                          <div>
                            <div>
                              <strong>{step.role}</strong>
                              <small>
                                Round {step.round} · {step.provider}
                              </small>
                            </div>
                            <p>{step.decision}</p>
                            {step.feedback?.length ? (
                              <p className="feedback">
                                {step.feedback.join(" · ")}
                              </p>
                            ) : null}
                            <small>
                              {step.memoryIds.length} recalled memories
                              {step.model ? ` · ${step.model}` : ""}
                            </small>
                          </div>
                        </div>
                      ))}
                      <details>
                        <summary>
                          Source observations (
                          {mission.receipt?.evidence.length || 0})
                        </summary>
                        <pre>
                          {JSON.stringify(mission.receipt?.evidence, null, 2)}
                        </pre>
                      </details>
                      <details>
                        <summary>Injected H-MEM context</summary>
                        <pre>
                          {mission.receipt?.memory.context ||
                            "No confirmed preferences recalled."}
                        </pre>
                      </details>
                    </div>
                  )}
                  {selected &&
                    !working &&
                    mission.status === "awaiting_approval" && (
                      <button
                        className="primary full approve-button"
                        disabled={busy}
                        onClick={expiry ? approve : replan}
                      >
                        {expiry
                          ? "Approve & request simulated dispatch"
                          : "Refresh expired proposal"}
                        <Icon name="arrow" size={18} />
                      </button>
                    )}
                </>
              )}
            </section>
          </section>
          <aside className="right-column">
            <section className="panel dispatch-panel">
              <div className="section-label">
                <span className="number">03</span> HANDOFF
              </div>
              <h2>Dispatch desk</h2>
              <span className="simulation-label">MINIROVER SIMULATOR</span>
              {task ? (
                <>
                  <div className="task-status">
                    <span className="live-dot" />
                    {label(task.status)}
                  </div>
                  <p className="small muted">
                    {selected?.courier.name || task.courierId} · Plan{" "}
                    {task.planVersion}
                  </p>
                  <div className="task-id">Task {task.id.slice(0, 8)}</div>
                  <div className="dispatch-actions">
                    {task.status === "dispatch_requested" && (
                      <>
                        <button
                          className="primary full"
                          disabled={busy}
                          onClick={() => respond("accepted")}
                        >
                          Simulate acceptance
                        </button>
                        <button
                          className="secondary full"
                          disabled={busy}
                          onClick={() => respond("declined")}
                        >
                          Simulate decline
                        </button>
                      </>
                    )}
                    {task.status === "accepted" && (
                      <button
                        className="primary full"
                        disabled={busy}
                        onClick={() => respond("in_progress")}
                      >
                        Start simulated delivery
                      </button>
                    )}
                    {task.status === "in_progress" && (
                      <button
                        className="primary full"
                        disabled={busy}
                        onClick={() => respond("completed")}
                      >
                        Complete simulated delivery
                      </button>
                    )}
                    {working && (
                      <button
                        className="text-button muted"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await call(
                              `/v1/tasks/${task.id}/cancel`,
                              "POST",
                              {},
                            );
                            await load(mission!.id);
                          })
                        }
                      >
                        Cancel task
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="dispatch-empty">
                  <Icon name="route" size={28} />
                  <p>
                    Your approved plan will appear here as a simulated dispatch
                    task.
                  </p>
                </div>
              )}
              <div className="simulation-note">
                Local workflow only. No real courier booking or supplier
                purchase.
              </div>
            </section>
            <section className="panel demo-panel">
              <div className="card-title">
                <Icon name="signal" size={18} />
                <h3>Change the situation</h3>
              </div>
              <p className="muted small">
                Test how Relay responds when the facts change.
              </p>
              <button
                className="disruption-button"
                disabled={busy || bootstrap?.mode !== "offline_sample"}
                onClick={() =>
                  run(async () => {
                    await call("/demo/disruptions", "POST", {
                      type: "stock",
                      supplierId: "supplier-a",
                      stock: 0,
                    });
                    await load(mission?.id);
                    setNotice(
                      "Campus Tech stock is now 0. Refresh the plan, or try approving it to test stale-plan protection.",
                    );
                  })
                }
              >
                <span className="disruption-symbol">−</span>
                <span>
                  Campus Tech runs out<small>Change supplier inventory</small>
                </span>
                <Icon name="arrow" size={14} />
              </button>
              <button
                className="disruption-button"
                disabled={busy || bootstrap?.mode !== "offline_sample"}
                onClick={() =>
                  run(async () => {
                    const closed = !bootstrap?.fixtures.edges.find(
                      (edge) => edge.id === "E4",
                    )?.closed;
                    await call("/demo/disruptions", "POST", {
                      type: "route",
                      edgeId: "E4",
                      closed,
                    });
                    await load(mission?.id);
                    setNotice(
                      `Central path E4 ${closed ? "closed" : "reopened"}. Refresh to recompute the route.`,
                    );
                  })
                }
              >
                <span className="disruption-symbol">↗</span>
                <span>
                  {bootstrap?.fixtures.edges.find((edge) => edge.id === "E4")
                    ?.closed
                    ? "Reopen central path"
                    : "Close central path"}
                  <small>Change route availability</small>
                </span>
                <Icon name="arrow" size={14} />
              </button>
              <button
                className="text-button muted"
                disabled={busy || bootstrap?.mode !== "offline_sample"}
                onClick={() =>
                  run(async () => {
                    await call("/demo/disruptions", "POST", {
                      type: "stock",
                      supplierId: "supplier-a",
                      stock: 6,
                    });
                    await call("/demo/disruptions", "POST", {
                      type: "route",
                      edgeId: "E4",
                      closed: false,
                    });
                    await load(mission?.id);
                    setNotice(
                      "Supplier stock and central path restored. Existing missions and tasks were preserved.",
                    );
                  })
                }
              >
                Restore stock & path
              </button>
            </section>
            <section className="activity">
              <div className="section-label">MISSION ACTIVITY</div>
              {events.length ? (
                events
                  .slice(-5)
                  .reverse()
                  .map((event) => (
                    <div className="activity-item" key={event.id}>
                      <span className="activity-dot" />
                      <div>
                        <strong>{label(event.type)}</strong>
                        <small>
                          {new Date(event.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          · #{event.sequence}
                        </small>
                      </div>
                    </div>
                  ))
              ) : (
                <p className="small muted">
                  Evidence and handoff events will appear as your mission
                  progresses.
                </p>
              )}
            </section>
          </aside>
        </div>
        <footer>
          <span>
            ROVER RELAY{" "}
            <span className="muted">
              / Independent planning, traceable handoffs.
            </span>
          </span>
          <span>
            Synthetic data ·{" "}
            {bootstrap?.mode === "live_sponsors"
              ? "Sponsor calls enabled; verify receipts"
              : "No external model or data calls"}{" "}
            · Real H-MEM
          </span>
        </footer>
      </main>
      {busy && (
        <div className="working-indicator" role="status">
          <span className="spinner" />
          Checking the evidence…
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

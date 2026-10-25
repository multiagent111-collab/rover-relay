import React, { useState } from "react";
import type { Intake } from "../src/intake.ts";
import type { Mission, MissionRequest } from "../src/types.ts";

export function IntakePanel({
  call,
  run,
  busy,
  pending,
  reload,
  onConfirmed,
}: {
  call: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  run: (operation: () => Promise<void>) => Promise<void>;
  busy: boolean;
  pending: Intake[];
  reload: () => Promise<void>;
  onConfirmed: (mission: Mission) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Intake | null>(null);
  const [fields, setFields] = useState<Partial<MissionRequest>>({});
  const display = (value: Intake) => {
    setDraft(value);
    setFields(value.fields);
    setText(value.text);
  };
  const updateNumber = (
    name: "quantity" | "budgetCents" | "deadlineMinutes",
    value: string,
  ) =>
    setFields({
      ...fields,
      [name]:
        value === ""
          ? undefined
          : name === "budgetCents"
            ? Math.round(Number(value) * 100)
            : Number(value),
    });
  return (
    <section className="panel intake-panel" aria-labelledby="intake-heading">
      <div className="section-label">OPTIONAL REQUEST DRAFT</div>
      <h2 id="intake-heading">Describe what happened.</h2>
      {!draft ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              display(await call<Intake>("/v1/intakes", "POST", { text }));
              await reload();
            });
          }}
        >
          <label htmlFor="draft-text">What do you need?</label>
          <textarea
            id="draft-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={1000}
            rows={4}
            required
            placeholder="Two USB-C to HDMI adapters to the auditorium within 30 minutes, total budget $35."
          />
          <p className="muted small">
            We’ll ask for missing details. You review the constraints before any
            planning starts.
          </p>
          <button
            className="primary full"
            disabled={busy || !text.trim()}
            type="submit"
          >
            Review request draft
          </button>
        </form>
      ) : (
        <>
          <p className="small" role="status">
            Review every field and resolve the questions. Nothing has been
            dispatched.
          </p>
          {draft.questions.length > 0 && (
            <ul className="draft-questions">
              {draft.questions.map((question) => (
                <li key={question.field}>{question.message}</li>
              ))}
            </ul>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const latest = await call<Intake>(`/v1/intakes/${draft.id}`);
                if (latest.status === "confirmed") {
                  await onConfirmed(
                    await call<Mission>(`/v1/missions/${draft.id}`),
                  );
                  setDraft(null);
                  setFields({});
                  setText("");
                  return;
                }
                if (latest.revision !== draft.revision) {
                  display(latest);
                  throw new Error(
                    "This draft changed while waiting. Review the saved fields and confirm again.",
                  );
                }
                const reviewed = await call<Intake>(
                  `/v1/intakes/${draft.id}`,
                  "PATCH",
                  { revision: draft.revision, fields },
                );
                display(reviewed);
                const mission = await call<Mission>(
                  `/v1/intakes/${draft.id}/confirm`,
                  "POST",
                  {
                    revision: reviewed.revision,
                    confirmed: true,
                    request: reviewed.fields,
                  },
                );
                setDraft(null);
                setFields({});
                setText("");
                await onConfirmed(mission);
              });
            }}
          >
            <label htmlFor="draft-sku">Confirm compatibility</label>
            <select
              id="draft-sku"
              value={fields.sku ?? ""}
              required
              onChange={(event) =>
                setFields({
                  ...fields,
                  sku: event.target.value as MissionRequest["sku"],
                })
              }
            >
              <option value="" disabled>
                Select compatibility
              </option>
              <option value="HDMI-USB-C">USB-C to HDMI adapter</option>
            </select>
            <div className="field-pair">
              <div>
                <label htmlFor="draft-quantity">Quantity</label>
                <input
                  id="draft-quantity"
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  required
                  value={fields.quantity ?? ""}
                  onChange={(event) =>
                    updateNumber("quantity", event.target.value)
                  }
                />
              </div>
              <div>
                <label htmlFor="draft-deadline">Within minutes</label>
                <input
                  id="draft-deadline"
                  type="number"
                  min={1}
                  max={240}
                  step={1}
                  required
                  value={fields.deadlineMinutes ?? ""}
                  onChange={(event) =>
                    updateNumber("deadlineMinutes", event.target.value)
                  }
                />
              </div>
            </div>
            <label htmlFor="draft-destination">Delivery venue</label>
            <select
              id="draft-destination"
              value={fields.destination ?? ""}
              required
              onChange={(event) =>
                setFields({
                  ...fields,
                  destination: event.target
                    .value as MissionRequest["destination"],
                })
              }
            >
              <option value="" disabled>
                Select a venue
              </option>
              <option value="auditorium">Auditorium</option>
              <option value="library">Library</option>
            </select>
            <label htmlFor="draft-budget">
              Total budget in USD, including delivery
            </label>
            <input
              id="draft-budget"
              type="number"
              min={0}
              max={10000}
              step="0.01"
              required
              value={
                fields.budgetCents === undefined ? "" : fields.budgetCents / 100
              }
              onChange={(event) =>
                updateNumber("budgetCents", event.target.value)
              }
            />
            <p className="muted small">
              {draft.deadlineAt
                ? `Original deadline: ${new Date(draft.deadlineAt).toLocaleTimeString()}. Waiting does not extend it.`
                : "Any deadline is measured from this draft’s original creation time."}
            </p>
            <button className="primary full" type="submit" disabled={busy}>
              Confirm these constraints and plan
            </button>
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  display(
                    await call<Intake>(`/v1/intakes/${draft.id}`, "PATCH", {
                      revision: draft.revision,
                      fields,
                    }),
                  );
                  await reload();
                })
              }
            >
              Save draft without planning
            </button>
          </form>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              setDraft(null);
              setFields({});
              setText("");
            }}
          >
            Start another draft
          </button>
        </>
      )}
      {pending.length > 0 && (
        <div className="draft-pending">
          <p className="muted small">Saved drafts awaiting confirmation</p>
          {pending.map((value) => (
            <button
              className="text-button"
              key={value.id}
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  display(await call<Intake>(`/v1/intakes/${value.id}`)),
                )
              }
            >
              {value.fields.quantity ?? "?"} adapters ·{" "}
              {value.fields.destination ?? "venue needed"} · resume
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// Never emit raw assertion messages, stderr or stdout into public reports.
import { basename } from "node:path";
export default async function* (events) {
  for await (const event of events) {
    const data = event.data;
    if (event.type === "test:pass" || event.type === "test:fail") {
      yield JSON.stringify({
        kind: "test",
        name: data.name,
        file: data.file ? basename(data.file) : null,
        result:
          event.type === "test:pass" && !data.skip && !data.todo
            ? "pass"
            : data.skip || data.todo
              ? "skipped"
              : "fail",
        durationMs: data.details?.duration_ms ?? null,
        failureCode: event.type === "test:fail" ? "test_failed" : null,
      }) + "\n";
    } else if (event.type === "test:summary") {
      yield JSON.stringify({
        kind: "summary",
        counts: data.counts,
        durationMs: data.duration_ms,
        success: data.success,
      }) + "\n";
    } else if (event.type === "test:stdout") {
      for (const line of data.message.split("\n"))
        try {
          const parsed = JSON.parse(line);
          if (
            [
              "overlapping_approvals",
              "crash_recovery",
              "memory_behavior",
              "decline",
              "cancellation",
            ].includes(parsed.proof)
          ) {
            const proof = {};
            for (const [key, value] of Object.entries(parsed))
              if (
                typeof value === "number" ||
                typeof value === "boolean" ||
                (typeof value === "string" &&
                  /^(?:proof|.*Id|digest|version|stage)$/.test(key))
              )
                proof[key] = value;
            yield JSON.stringify({ kind: "proof", ...proof }) + "\n";
          }
        } catch {}
    }
  }
}

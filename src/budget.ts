import { RelayError } from "./types.ts";
export class PlanningBudget {
  readonly signal: AbortSignal;
  private timer: ReturnType<typeof setTimeout>;
  private start = performance.now();
  inferenceCalls = 0;
  toolCalls = 0;
  selectionCalls = 0;
  snapshotCalls = 0;
  constructor(
    readonly limits = { inference: 6, tools: 6, timeoutMs: 180000 },
    external?: AbortSignal,
  ) {
    if (
      !Number.isInteger(limits.inference) ||
      limits.inference < 1 ||
      limits.inference > 6 ||
      !Number.isInteger(limits.tools) ||
      limits.tools < 1 ||
      limits.tools > 6 ||
      limits.timeoutMs <= 0 ||
      limits.timeoutMs > 180000
    )
      throw new RelayError(
        503,
        "invalid_budget",
        "Planning limits must stay within six inference calls, six reads and 180 seconds.",
      );
    const controller = new AbortController();
    this.timer = setTimeout(() => controller.abort(), limits.timeoutMs);
    this.signal = external
      ? AbortSignal.any([external, controller.signal])
      : controller.signal;
  }
  check() {
    if (this.signal.aborted)
      throw new RelayError(
        503,
        "planning_cancelled",
        "Planning was cancelled or exceeded its shared deadline. No dispatch was created.",
      );
  }
  async wait<T>(action: () => Promise<T>): Promise<T> {
    this.check();
    let listener: () => void = () => {};
    const cancelled = new Promise<never>((_accept, reject) => {
      listener = () =>
        reject(
          new RelayError(
            503,
            "planning_cancelled",
            "Planning was cancelled or exceeded its shared deadline. No dispatch was created.",
          ),
        );
      this.signal.addEventListener("abort", listener, { once: true });
    });
    try {
      const result = await Promise.race([
        Promise.resolve().then(action),
        cancelled,
      ]);
      this.check();
      return result;
    } finally {
      this.signal.removeEventListener("abort", listener);
    }
  }
  inference<T>(action: () => Promise<T>, selection = false) {
    this.check();
    if (this.inferenceCalls >= this.limits.inference)
      throw new RelayError(
        503,
        "inference_budget_exhausted",
        "The shared inference budget is exhausted. No dispatch was created.",
      );
    this.inferenceCalls++;
    if (selection) this.selectionCalls++;
    return this.wait(action);
  }
  tool<T>(action: () => Promise<T>) {
    this.check();
    if (this.toolCalls >= this.limits.tools)
      throw new RelayError(
        503,
        "tool_budget_exhausted",
        "The shared read-tool budget is exhausted. No dispatch was created.",
      );
    this.toolCalls++;
    return this.wait(action);
  }
  usage() {
    return {
      inferenceCalls: this.inferenceCalls,
      extractionCalls: 0,
      selectionCalls: this.selectionCalls,
      plannerCriticCalls: this.inferenceCalls - this.selectionCalls,
      toolCalls: this.toolCalls,
      backendSnapshotCalls: this.snapshotCalls,
      inferenceLimit: this.limits.inference,
      toolLimit: this.limits.tools,
      deadlineMs: this.limits.timeoutMs,
      elapsedMs: Math.round(performance.now() - this.start),
    };
  }
  dispose() {
    clearTimeout(this.timer);
  }
}

// Shared mutable host namespace.
//
// The original ES3 host was a set of globals (`Offhand.tools.status = ...`).
// Phase D turns each file into a module while deliberately keeping those proven
// bodies intact: every module imports this same object and registers into it.
// That keeps the port mechanical and reviewable, and the bundler still emits
// one ES3 file loaded by `InitBolt`. Types are tightened per handler over time.

export type OffhandErrorPayload = {
  code: string;
  message: string;
  hint?: string;
};

export type HostHandler = (args: any) => any;

/** A render-queue item tracked across calls; ExtendScript has no async work. */
export type RenderJob = {
  id: string;
  comp: string | null;
  output: string | null;
  /** 1-based render-queue index at queue time. */
  queueIndex: number;
  status: "queued" | "rendering" | "done" | "failed";
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  ms?: number;
  error?: string;
};

export type OffhandState = {
  version: string;
  tools: Record<string, HostHandler>;
  /** Tools wrapped in a single undo group by the dispatcher. */
  writeTools: Record<string, boolean>;
  json: any;
  util: any;
  /** Render jobs recorded by the render tool (in-memory, per AE session). */
  jobs: RenderJob[];
  loaded?: boolean;
};

export const Offhand: OffhandState = {
  version: "0.2.0",
  tools: {},
  writeTools: {
    comp: true,
    layer: true,
    property: true,
    effect: true,
    text: true,
    shape: true,
    mask: true,
    render: true,
    assets: true,
    execute: true,
    batch: true,
  },
  json: undefined,
  util: undefined,
  jobs: [],
};

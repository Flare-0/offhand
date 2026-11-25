// Typed home of the ExtendScript host (Phase D).
//
// Every module below was ported from `extension/host/**/*.jsx` with its proven
// body intact; they register into the shared `Offhand` object on import. This
// file provides the single dispatcher the panel reaches through `evalTS()`:
// argument parsing, unknown-tool handling, one undo group per write, and a
// `{ok, data | error}` JSON result.

import { Offhand } from "./core/state";

// Order matters: JSON helpers first, then utilities, then the tools.
import "./core/json";
import "./core/util";
import "./tools/status";
import "./tools/project";
import "./tools/comp";
import "./tools/layer";
import "./tools/property";
import "./tools/effect";
import "./tools/text";
import "./tools/shape";
import "./tools/mask";
import "./tools/render";
import "./tools/assets";
import "./tools/view";
import "./tools/execute";

const errorResult = (
  code: string,
  message: string,
  hint?: string,
): string =>
  Offhand.json.stringify({
    ok: false,
    error: hint ? { code, message, hint } : { code, message },
  });

/**
 * Runs one tool call. Always returns JSON; never throws — ExtendScript errors
 * are turned into `{ok:false, error}` so the panel can serialize them.
 */
export const dispatch = (tool: string, argsJson: string): string => {
  let args: unknown;
  try {
    args = Offhand.json.parse(argsJson || "{}");
  } catch (error) {
    return errorResult(
      "INVALID_JSON",
      "Could not parse the tool arguments.",
      "This is an offhand protocol bug. Retry the tool call.",
    );
  }

  const handler = Offhand.tools[tool];
  if (typeof handler !== "function") {
    return errorResult(
      "UNKNOWN_TOOL",
      'The host has no handler for "' + String(tool) + '".',
      "Update the offhand panel and server to the same version.",
    );
  }

  let grouped = false;
  try {
    // Writes share one undo group, so a tool call is a single Cmd/Ctrl+Z.
    if (Offhand.writeTools[tool] && app.project) {
      app.beginUndoGroup("offhand: " + tool);
      grouped = true;
    }
    const data = handler(args);
    return Offhand.json.stringify({ ok: true, data: data });
  } catch (error) {
    const payload =
      error && (error as { offhand?: unknown }).offhand
        ? (error as { offhand: unknown }).offhand
        : {
            code: "HOST_ERROR",
            message:
              error && (error as Error).message
                ? String((error as Error).message)
                : String(error),
          };
    return Offhand.json.stringify({ ok: false, error: payload });
  } finally {
    if (grouped) {
      try {
        app.endUndoGroup();
      } catch (endError) {
        // After Effects may already have closed the group.
      }
    }
  }
};

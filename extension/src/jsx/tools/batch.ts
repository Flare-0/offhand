// Runs several typed tool calls in one bridge round-trip.
//
// The dispatcher wraps `batch` in a single undo group, so every write in the
// batch is one Cmd/Ctrl+Z. Calls run sequentially and stop at the first error
// unless `stopOnError: false`. Nesting `batch` inside `batch` is refused, as is
// `execute` while the panel has raw scripts disabled (the panel checks the
// whole call list before it reaches the host).

import { Offhand } from "../core/state";

Offhand.tools = Offhand.tools || {};

(function () {
  var MAX_CALLS = 20;

  function errorPayload(error) {
    if (error && error.offhand) return error.offhand;
    var message = error && error.message ? String(error.message) : String(error);
    var payload = { code: "HOST_ERROR", message: message };
    return payload;
  }

  Offhand.tools.batch = function (args) {
    var util = Offhand.util;
    var calls = args ? args.calls : null;

    if (!(calls instanceof Array) || calls.length === 0) {
      util.fail(
        "INVALID_ARGS",
        "calls must be a non-empty array of { tool, args } objects.",
        'Example: {"calls":[{"tool":"comp","args":{"action":"list"}},{"tool":"status"}]}',
      );
    }

    if (calls.length > MAX_CALLS) {
      util.fail(
        "INVALID_ARGS",
        "batch accepts at most " + MAX_CALLS + " calls (got " + calls.length + ").",
        "Split the work into several batch calls so a failure stays readable.",
      );
    }

    var stopOnError = args.stopOnError !== false;
    var results = [];
    var failed = 0;
    var ran = 0;

    for (var i = 0; i < calls.length; i += 1) {
      var call = calls[i] || {};
      var name = call.tool;
      var started = new Date().getTime();
      var entry: any = { index: i, tool: name === undefined ? null : name };

      if (!name || typeof name !== "string") {
        entry.ok = false;
        entry.error = {
          code: "INVALID_ARGS",
          message: "Each call needs a tool name.",
          hint: 'Example: {"tool":"status"}',
        };
        results.push(entry);
        failed += 1;
        if (stopOnError) break;
        continue;
      }

      if (name === "batch") {
        entry.ok = false;
        entry.error = {
          code: "INVALID_ARGS",
          message: "batch cannot call batch.",
          hint: "Flatten the calls into one list.",
        };
        results.push(entry);
        failed += 1;
        if (stopOnError) break;
        continue;
      }

      var handler = Offhand.tools[name];
      if (typeof handler !== "function") {
        entry.ok = false;
        entry.error = {
          code: "UNKNOWN_TOOL",
          message: 'No tool named "' + name + '".',
          hint: "Call status or docs to see the tool surface.",
        };
        results.push(entry);
        failed += 1;
        if (stopOnError) break;
        continue;
      }

      var callArgs = call.args;
      if (callArgs === undefined || callArgs === null) {
        callArgs = {};
      } else if (typeof callArgs !== "object" || callArgs instanceof Array) {
        entry.ok = false;
        entry.error = {
          code: "INVALID_ARGS",
          message: 'args for "' + name + '" must be an object.',
        };
        results.push(entry);
        failed += 1;
        if (stopOnError) break;
        continue;
      }

      ran += 1;
      try {
        entry.data = handler(callArgs);
        entry.ok = true;
      } catch (error) {
        entry.ok = false;
        entry.error = errorPayload(error);
        failed += 1;
      }
      entry.ms = new Date().getTime() - started;
      results.push(entry);
      if (!entry.ok && stopOnError) break;
    }

    var out: any = {
      total: calls.length,
      ran: ran,
      failed: failed,
      stoppedEarly: results.length < calls.length,
      results: results,
    };
    if (failed === 0) out.note = "All calls succeeded inside one undo group.";
    return out;
  };
})();

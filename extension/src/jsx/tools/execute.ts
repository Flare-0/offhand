import { Offhand } from "../core/state";

Offhand.tools = Offhand.tools || {};

Offhand.tools.execute = function (args) {
  if (!args || typeof args.script !== "string" || args.script.length === 0) {
    Offhand.util.fail("INVALID_ARGS", "script is required.", "Pass the ExtendScript source in script.");
  }

  var cleaned = args.script.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\r\n]*/g, " ");
  var blocked = [
    /\bsystem\s*\.\s*callSystem\b|\bcallSystem\s*\(/i,
    /\bExternalObject\b/,
    /\bSocket\b/,
    /\bBridgeTalk\b/,
    /\.\s*execute\s*\(/,
    /\$\s*\.\s*evalFile\s*\(/,
    /\$\s*\.\s*setenv\s*\(/,
    /\bapp\s*\.\s*(?:exit|quit)\s*\(/,
    /\bapp\s*\.\s*project\s*\.\s*close\s*\(/,
    /\beval\s*\(|\bnew\s+Function\s*\(/,
    /\.\s*open\s*\(\s*['"][wae]/i,
  ];
  for (var i = 0; i < blocked.length; i += 1) {
    if (blocked[i].test(cleaned)) {
      Offhand.util.fail(
        "INVALID_ARGS",
        "Blocked unsafe ExtendScript operation.",
        "Use typed tools instead of system, file-write, socket, or eval APIs.",
      );
    }
  }

  var result;
  try {
    result = eval(args.script);
  } catch (error) {
    Offhand.util.fail(
      "EXECUTE_ERROR",
      error && error.message ? error.message : String(error),
      "ExtendScript error" +
        (error && error.line ? " at line " + error.line : "") +
        ". Check the script; use the docs tool to confirm API names.",
    );
  }

  var json;
  try {
    json = Offhand.json.stringify(result);
  } catch (error) {
    json = String(result);
  }

  return {
    result: json,
    type: typeof result,
  };
};

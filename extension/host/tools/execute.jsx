Offhand.tools = Offhand.tools || {};

Offhand.tools.execute = function (args) {
  if (!args || typeof args.script !== "string" || args.script.length === 0) {
    Offhand.util.fail("INVALID_ARGS", "script is required.", "Pass the ExtendScript source in script.");
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

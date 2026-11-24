var Offhand = typeof Offhand !== "undefined" ? Offhand : {};

if (!Offhand.loaded) {
  Offhand.version = "0.1.0";
  Offhand.tools = {};
  Offhand.writeTools = {
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
  };

  Offhand.root = (function () {
    try {
      var script = new File($.fileName);
      return script.parent.fsName;
    } catch (error) {
      return "";
    }
  })();

  Offhand.include = function (relativePath) {
    var file = new File(Offhand.root + "/" + relativePath);
    if (!file.exists) {
      throw new Error("offhand: missing host file " + file.fsName);
    }
    $.evalFile(file);
  };

  Offhand.include("core/json.jsx");
  Offhand.include("core/util.jsx");
  Offhand.include("tools/status.jsx");
  Offhand.include("tools/project.jsx");
  Offhand.include("tools/comp.jsx");
  Offhand.include("tools/layer.jsx");
  Offhand.include("tools/property.jsx");
  Offhand.include("tools/effect.jsx");
  Offhand.include("tools/text.jsx");
  Offhand.include("tools/shape.jsx");
  Offhand.include("tools/mask.jsx");
  Offhand.include("tools/render.jsx");
  Offhand.include("tools/assets.jsx");
  Offhand.include("tools/view.jsx");
  Offhand.include("tools/execute.jsx");

  Offhand.dispatch = function (tool, argsJson) {
    var args;
    try {
      args = Offhand.json.parse(argsJson || "{}");
    } catch (error) {
      return Offhand.json.stringify({
        ok: false,
        error: {
          code: "INVALID_JSON",
          message: "Could not parse the tool arguments.",
          hint: "This is an offhand protocol bug. Retry the tool call.",
        },
      });
    }

    var handler = Offhand.tools[tool];
    if (typeof handler !== "function") {
      return Offhand.json.stringify({
        ok: false,
        error: {
          code: "UNKNOWN_TOOL",
          message: 'After Effects has no handler for "' + String(tool) + '".',
          hint: "Update the offhand panel and server to the same version.",
        },
      });
    }

    var grouped = false;
    try {
      if (Offhand.writeTools[tool] && app.project) {
        app.beginUndoGroup("offhand: " + tool);
        grouped = true;
      }
      var data = handler(args);
      return Offhand.json.stringify({ ok: true, data: data });
    } catch (error) {
      var detail =
        error && error.offhand
          ? error.offhand
          : {
              code: "HOST_ERROR",
              message: error && error.message ? error.message : String(error),
            };
      return Offhand.json.stringify({ ok: false, error: detail });
    } finally {
      if (grouped) {
        try {
          app.endUndoGroup();
        } catch (endError) {
          // The undo group may already be closed by After Effects.
        }
      }
    }
  };

  Offhand.loaded = true;
}

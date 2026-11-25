import { Offhand } from "../core/state";

Offhand.tools = Offhand.tools || {};

(function () {
  function listComps(util, limit, offset) {
    var activeProject = util.project();
    var rows = [];
    for (var i = 1; i <= activeProject.numItems; i += 1) {
      var item = activeProject.item(i);
      if (item instanceof CompItem) rows.push(util.compInfo(item));
    }
    var page = util.page(rows, limit === undefined ? 25 : limit, offset);
    if (page.total === 0) page.hint = "No compositions yet. Create one with comp action=\"create\".";
    return page;
  }

  Offhand.tools.comp = function (args) {
    var util = Offhand.util;
    var action = args.action || "list";

    if (action === "list") {
      return listComps(util, args.limit, args.offset);
    }

    if (action === "get") {
      var comp = util.comp(args.comp);
      var detail = util.compInfo(comp);
      detail.selectedLayers = [];
      if (comp.selectedLayers) {
        for (var i = 0; i < comp.selectedLayers.length; i += 1) {
          detail.selectedLayers.push({
            index: comp.selectedLayers[i].index,
            name: comp.selectedLayers[i].name,
          });
        }
      }
      detail.selectedProperties = comp.selectedProperties ? comp.selectedProperties.length : 0;
      detail.usingProxy = false;
      try {
        detail.usingProxy =
          typeof comp.usesProxy === "function" ? !!comp.usesProxy() : !!comp.usesProxy;
      } catch (proxyError) {
        detail.usingProxy = false;
      }
      return detail;
    }

    if (action === "create") {
      var name = args.name ? String(args.name) : "Comp";
      var width = args.width === undefined ? 1920 : util.number(args.width, "width");
      var height = args.height === undefined ? 1080 : util.number(args.height, "height");
      var fps = args.fps === undefined ? 30 : util.number(args.fps, "fps");
      var duration = args.duration === undefined ? 10 : util.number(args.duration, "duration");
      var pixelAspect = args.pixelAspect === undefined ? 1 : util.number(args.pixelAspect, "pixelAspect");

      if (width < 1 || height < 1) util.fail("INVALID_ARGS", "width and height must be positive.", "Example: 1920 Ã— 1080.");
      if (fps <= 0 || fps > 240) util.fail("INVALID_ARGS", "fps must be between 1 and 240.");
      if (duration <= 0) util.fail("INVALID_ARGS", "duration must be greater than 0 seconds.");

      var activeProject = util.project();
      var comp = activeProject.items.addComp(name, width, height, pixelAspect, duration, fps);
      if (args.bg !== undefined) comp.bgColor = util.color(args.bg);
      if (args.open !== false) comp.openInViewer();
      return util.compInfo(comp);
    }

    if (action === "set") {
      var target = util.comp(args.comp);
      var changed = [];

      if (args.name !== undefined) {
        target.name = String(args.name);
        changed.push("name");
      }
      if (args.width !== undefined) {
        target.width = Math.round(util.number(args.width, "width"));
        changed.push("width");
      }
      if (args.height !== undefined) {
        target.height = Math.round(util.number(args.height, "height"));
        changed.push("height");
      }
      if (args.fps !== undefined) {
        target.frameRate = util.number(args.fps, "fps");
        changed.push("fps");
      }
      if (args.duration !== undefined) {
        target.duration = util.number(args.duration, "duration");
        changed.push("duration");
      }
      if (args.bg !== undefined) {
        target.bgColor = util.color(args.bg);
        changed.push("bg");
      }
      if (args.workAreaStart !== undefined) {
        target.workAreaStart = util.number(args.workAreaStart, "workAreaStart");
        changed.push("workAreaStart");
      }
      if (args.workAreaDuration !== undefined) {
        target.workAreaDuration = util.number(args.workAreaDuration, "workAreaDuration");
        changed.push("workAreaDuration");
      }
      if (args.resolutionFactor !== undefined) {
        var factor = args.resolutionFactor;
        if (factor instanceof Array) {
          target.resolutionFactor = [
            util.number(factor[0], "resolutionFactor"),
            util.number(factor[1], "resolutionFactor"),
          ];
        } else {
          var single = util.number(factor, "resolutionFactor");
          target.resolutionFactor = [single, single];
        }
        changed.push("resolutionFactor");
      }
      if (args.motionBlur !== undefined) {
        target.motionBlur = !!args.motionBlur;
        changed.push("motionBlur");
      }
      if (args.shutterAngle !== undefined) {
        target.shutterAngle = util.number(args.shutterAngle, "shutterAngle");
        changed.push("shutterAngle");
      }

      if (changed.length === 0) {
        util.fail("INVALID_ARGS", "Nothing to change.", "Pass name, width, height, fps, duration, bg, work area, or resolutionFactor.");
      }

      var result = util.compInfo(target);
      result.changed = changed;
      return result;
    }

    util.fail(
      "INVALID_ARGS",
      'Unknown comp action "' + action + '".',
      "Use list, get, create, or set.",
    );
  };
})();

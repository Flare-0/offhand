import { Offhand } from "../core/state";

Offhand.tools = Offhand.tools || {};

(function () {
  function compBrief(util, comp) {
    return {
      id: comp.id,
      name: comp.name,
      width: comp.width,
      height: comp.height,
      fps: util.round(comp.frameRate, 3),
      duration: util.round(comp.duration, 3),
      layers: comp.numLayers,
    };  }

  function listComps(util, limit, offset, detail) {
    var activeProject = util.project();
    var rows = [];
    for (var i = 1; i <= activeProject.numItems; i += 1) {
      var item = activeProject.item(i);
      if (item instanceof CompItem) rows.push(detail === "full" ? util.compInfo(item) : compBrief(util, item));
    }
    var page = util.page(rows, limit === undefined ? 25 : limit, offset);
    if (page.total === 0) page.hint = "No compositions yet. Create one with comp action=\"create\".";
    return page;
  }

  function countKeys(value) {
    var total = 0;
    for (var key in value) {
      if (value.hasOwnProperty(key)) total += 1;
    }
    return total;
  }

  Offhand.tools.comp = function (args) {
    var util = Offhand.util;
    var action = args.action || "list";

    if (action === "list") {
      return listComps(util, args.limit, args.offset, args.detail);
    }

    if (action === "get") {
      var comp = util.comp(args.comp);
      var full = args.detail === "full";
      var detail: any = full ? util.compInfo(comp) : compBrief(util, comp);
      detail.selectedLayers = [];
      if (comp.selectedLayers) {
        for (var i = 0; i < comp.selectedLayers.length; i += 1) {
          detail.selectedLayers.push({
            id: comp.selectedLayers[i].id,
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

      if (width < 1 || height < 1) util.fail("INVALID_ARGS", "width and height must be positive.", "Example: 1920 x 1080.");
      if (fps <= 0 || fps > 240) util.fail("INVALID_ARGS", "fps must be between 1 and 240.");
      if (duration <= 0) util.fail("INVALID_ARGS", "duration must be greater than 0 seconds.");

      var activeProject = util.project();
      var comp = activeProject.items.addComp(name, width, height, pixelAspect, duration, fps);
      if (args.bg !== undefined) comp.bgColor = util.color(args.bg);
      if (args.open !== false) comp.openInViewer();
      var created = util.compInfo(comp);
      created.created = { id: comp.id, name: comp.name };
      return created;
    }

    if (action === "set") {
      var target = util.comp(args.comp);
      var trackable = [];
      if (args.name !== undefined) trackable.push("name");
      if (args.width !== undefined) trackable.push("width");
      if (args.height !== undefined) trackable.push("height");
      if (args.fps !== undefined) trackable.push("frameRate");
      if (args.duration !== undefined) trackable.push("duration");
      if (args.bg !== undefined) trackable.push("bgColor");
      if (args.workAreaStart !== undefined) trackable.push("workAreaStart");
      if (args.workAreaDuration !== undefined) trackable.push("workAreaDuration");
      if (args.resolutionFactor !== undefined) trackable.push("resolutionFactor");
      if (args.motionBlur !== undefined) trackable.push("motionBlur");
      if (args.shutterAngle !== undefined) trackable.push("shutterAngle");

      if (trackable.length === 0) {
        util.fail("INVALID_ARGS", "Nothing to change.", "Pass name, width, height, fps, duration, bg, work area, or resolutionFactor.");
      }

      var commit = util.track(target, trackable);

      if (args.name !== undefined) target.name = String(args.name);
      if (args.width !== undefined) target.width = Math.round(util.number(args.width, "width"));
      if (args.height !== undefined) target.height = Math.round(util.number(args.height, "height"));
      if (args.fps !== undefined) target.frameRate = util.number(args.fps, "fps");
      if (args.duration !== undefined) target.duration = util.number(args.duration, "duration");
      if (args.bg !== undefined) target.bgColor = util.color(args.bg);
      if (args.workAreaStart !== undefined) target.workAreaStart = util.number(args.workAreaStart, "workAreaStart");
      if (args.workAreaDuration !== undefined) target.workAreaDuration = util.number(args.workAreaDuration, "workAreaDuration");
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
      }
      if (args.motionBlur !== undefined) target.motionBlur = !!args.motionBlur;
      if (args.shutterAngle !== undefined) target.shutterAngle = util.number(args.shutterAngle, "shutterAngle");

      var changed = commit();
      if (changed.frameRate) {
        changed.fps = changed.frameRate;
        delete changed.frameRate;
      }
      if (changed.bgColor) {
        changed.bg = changed.bgColor;
        delete changed.bgColor;
      }

      var result = util.compInfo(target);
      result.changed = changed;
      if (countKeys(changed) === 0) result.note = "No field changed: the composition already had these values.";
      return result;
    }

    util.fail(
      "INVALID_ARGS",
      'Unknown comp action "' + action + '".',
      "Use list, get, create, or set.",
    );
  };
})();

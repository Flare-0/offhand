import { Offhand } from "../core/state";

Offhand.tools = Offhand.tools || {};

(function () {
  Offhand.tools.view = function (args) {
    var util = Offhand.util;
    var action = args.action || "open";
    var comp = util.comp(args.comp);

    if (action === "open") {
      comp.openInViewer();
      return util.compInfo(comp);
    }

    if (action === "time") {
      if (args.time === undefined) {
        util.fail("INVALID_ARGS", "time is required for action=\"time\".");
      }
      var nextTime = util.number(args.time, "time");
      comp.time = Math.max(0, Math.min(comp.duration, nextTime));
      comp.openInViewer();
      return util.compInfo(comp);
    }

    if (action === "select") {
      if (args.deselect !== false) {
        for (var i = 1; i <= comp.numLayers; i += 1) {
          comp.layer(i).selected = false;
        }
      }
      var targets = [];
      if (args.layers instanceof Array) {
        for (var j = 0; j < args.layers.length; j += 1) {
          targets.push(util.layer(comp, args.layers[j]));
        }
      } else if (args.layer !== undefined) {
        targets.push(util.layer(comp, args.layer));
      }

      var selected = [];
      for (var k = 0; k < targets.length; k += 1) {
        targets[k].selected = true;
        selected.push({ index: targets[k].index, name: targets[k].name });
      }
      comp.openInViewer();
      return { comp: comp.name, selected: selected };
    }

    util.fail("INVALID_ARGS", 'Unknown view action "' + action + '".', "Use open, time, or select.");
  };
})();

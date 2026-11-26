import { Offhand } from "../core/state";

Offhand.tools = Offhand.tools || {};

(function () {
  var COMMON_EFFECTS = [
    { matchName: "ADBE Gaussian Blur 2", name: "Gaussian Blur", category: "Blur & Sharpen" },
    { matchName: "ADBE Fast Box Blur", name: "Fast Box Blur", category: "Blur & Sharpen" },
    { matchName: "ADBE Camera Lens Blur", name: "Camera Lens Blur", category: "Blur & Sharpen" },
    { matchName: "ADBE Motion Blur", name: "Directional Blur", category: "Blur & Sharpen" },
    { matchName: "ADBE Glo2", name: "Glow", category: "Stylize" },
    { matchName: "ADBE Drop Shadow", name: "Drop Shadow", category: "Perspective" },
    { matchName: "ADBE Fill", name: "Fill", category: "Generate" },
    { matchName: "ADBE Ramp", name: "Gradient Ramp", category: "Generate" },
    { matchName: "ADBE Fractal Noise", name: "Fractal Noise", category: "Noise & Grain" },
    { matchName: "ADBE Noise", name: "Noise", category: "Noise & Grain" },
    { matchName: "ADBE HUE SATURATION", name: "Hue/Saturation", category: "Color Correction" },
    { matchName: "ADBE CurvesCustom", name: "Curves", category: "Color Correction" },
    { matchName: "ADBE Easy Levels2", name: "Levels", category: "Color Correction" },
    { matchName: "ADBE Tint", name: "Tint", category: "Color Correction" },
    { matchName: "ADBE Lumetri", name: "Lumetri Color", category: "Color Correction" },
    { matchName: "ADBE Turbulent Displace", name: "Turbulent Displace", category: "Distort" },
    { matchName: "ADBE Displacement Map", name: "Displacement Map", category: "Distort" },
    { matchName: "ADBE Transform", name: "Transform", category: "Distort" },
    { matchName: "ADBE Keylight 906", name: "Keylight (1.2)", category: "Keying" },
    { matchName: "ADBE Linear Wipe", name: "Linear Wipe", category: "Transition" },
    { matchName: "ADBE Slider Control", name: "Slider Control", category: "Expression Controls" },
    { matchName: "ADBE Color Control", name: "Color Control", category: "Expression Controls" },
    { matchName: "ADBE Checkbox Control", name: "Checkbox Control", category: "Expression Controls" },
  ];

  function findEffect(util, parade, selector) {
    if (!parade) {
      util.fail("INVALID_STATE", "Layer has no Effect Parade.");
    }
    if (typeof selector === "number") {
      if (selector < 1 || selector > parade.numProperties) {
        util.fail("NOT_FOUND", "Effect index " + selector + " is out of range.", 'Call effect with action="list".');
      }
      return parade.property(selector);
    }
    if (typeof selector === "string" && selector.length > 0) {
      var lower = selector.toLowerCase();
      for (var i = 1; i <= parade.numProperties; i += 1) {
        var eff = parade.property(i);
        if (eff.name === selector || eff.matchName === selector) return eff;
        if (eff.name.toLowerCase() === lower || eff.matchName.toLowerCase() === lower) return eff;
      }
      util.fail("NOT_FOUND", 'No effect named "' + selector + '" on this layer.', 'Call effect with action="list".');
    }
    util.fail("INVALID_ARGS", "effect selector is required.", 'Pass effect name, matchName, or 1-based index.');
  }

  function effectInfo(util, eff, index) {
    var props = [];
    for (var i = 1; i <= eff.numProperties && props.length < 30; i += 1) {
      var p = eff.property(i);
      if (!p) continue;
      var type = util.propertyType(p);
      if (type === "group" || type === "custom") continue;
      props.push({
        index: i,
        name: p.name,
        matchName: p.matchName,
        type: type,
        value: util.readValue(p),
      });
    }
    return {
      index: index,
      name: eff.name,
      matchName: eff.matchName,
      enabled: eff.enabled,
      properties: props,
    };
  }

  function resolveMatchName(queryOrName) {
    if (typeof queryOrName !== "string") return null;
    var lower = queryOrName.toLowerCase();
    for (var i = 0; i < COMMON_EFFECTS.length; i += 1) {
      if (
        COMMON_EFFECTS[i].matchName.toLowerCase() === lower ||
        COMMON_EFFECTS[i].name.toLowerCase() === lower
      ) {
        return COMMON_EFFECTS[i].matchName;
      }
    }
    if (app.effects) {
      for (var j = 0; j < app.effects.length; j += 1) {
        var eff = app.effects[j];
        if (
          eff.matchName === queryOrName ||
          (eff.displayName && eff.displayName.toLowerCase() === lower)
        ) {
          return eff.matchName;
        }
      }
    }
    return queryOrName;
  }

  Offhand.tools.effect = function (args) {
    var util = Offhand.util;
    var action = args.action || "list";

    if (action === "search") {
      var query = args.query ? String(args.query).toLowerCase() : "";
      var limit = args.limit === undefined ? 25 : util.clampInt(args.limit, 25, 1, 100);
      var matches = [];
      var seen = {};
      var pool = [];

      if (app.effects && app.effects.length) {
        for (var a = 0; a < app.effects.length; a += 1) {
          pool.push({
            matchName: app.effects[a].matchName,
            name: app.effects[a].displayName,
            category: app.effects[a].category || "",
          });
        }
      }
      for (var b = 0; b < COMMON_EFFECTS.length; b += 1) {
        pool.push(COMMON_EFFECTS[b]);
      }

      for (var i = 0; i < pool.length && matches.length < limit; i += 1) {
        var entry = pool[i];
        if (!entry.matchName || seen[entry.matchName]) continue;
        var hay = ((entry.name || "") + " " + entry.matchName + " " + (entry.category || "")).toLowerCase();
        if (query && hay.indexOf(query) === -1) continue;
        seen[entry.matchName] = true;
        matches.push(entry);
      }

      return { query: args.query || "", items: matches, returned: matches.length };
    }

    var comp = util.comp(args.comp);
    var layer = util.layer(comp, args.layer);
    var parade = layer.property("ADBE Effect Parade");

    if (action === "list") {
      var list = [];
      if (parade) {
        var max = args.limit === undefined ? parade.numProperties : Math.min(args.limit, parade.numProperties);
        for (var k = 1; k <= max; k += 1) {
          list.push(effectInfo(util, parade.property(k), k));
        }
      }
      return { layer: layer.name, items: list, total: parade ? parade.numProperties : 0 };
    }

    if (action === "add") {
      if (!parade) {
        util.fail("INVALID_STATE", 'Layer "' + layer.name + '" cannot hold effects.');
      }
      if (!args.effect) {
        util.fail("INVALID_ARGS", "effect name or matchName is required.", 'Call effect with action="search" to find matchNames.');
      }
      var matchName = resolveMatchName(String(args.effect));
      if (!parade.canAddProperty(matchName)) {
        util.fail(
          "INVALID_ARGS",
          'Cannot add effect "' + args.effect + '" (' + matchName + ').',
          'Call effect with action="search" to find a valid matchName.',
        );
      }
      var count = parade.numProperties;
      var added = parade.addProperty(matchName);
      var addResult = effectInfo(util, added, added.propertyIndex);
      addResult.created = { matchName: added.matchName, name: added.name };
      addResult.changed = { effects: { from: count, to: parade.numProperties } };
      return addResult;
    }

    if (action === "set") {
      var target = findEffect(util, parade, args.effect);
      var changed = {};
      var enabledBefore = target.enabled;
      var effProp = null;
      var valueBefore = null;
      if (args.property !== undefined) {
        if (args.value === undefined) {
          util.fail("INVALID_ARGS", "value is required when setting an effect property.");
        }
        if (typeof args.property === "number") {
          effProp = target.property(args.property);
        } else {
          effProp = util.property(target, String(args.property));
        }
        if (!effProp) {
          util.fail("NOT_FOUND", 'No effect property "' + args.property + '" on "' + target.name + '".');
        }
        try {
          valueBefore = util.readValue(effProp);
        } catch (readError) {
          valueBefore = null;
        }
      }
      if (args.enabled !== undefined) {
        target.enabled = !!args.enabled;
        if (target.enabled !== enabledBefore) {
          changed.enabled = { from: enabledBefore, to: target.enabled };
        }
      }
      if (effProp) {
        util.setValue(effProp, args.value, args.time);
        var valueAfter = null;
        try {
          valueAfter = util.readValue(effProp);
        } catch (readAfterError) {
          valueAfter = null;
        }
        changed[effProp.name] = { from: valueBefore, to: valueAfter };
      }
      if (args.enabled === undefined && args.property === undefined) {
        util.fail("INVALID_ARGS", "Nothing to change.", "Pass property + value, or enabled.");
      }
      var res = effectInfo(util, target, target.propertyIndex);
      res.changed = changed;
      return res;
    }

    if (action === "remove") {
      var doomed = findEffect(util, parade, args.effect);
      if (args.confirm !== true) {
        util.fail(
          "INVALID_ARGS",
          'Removing an effect requires confirm: true (would remove "' + doomed.name + '").',
          "Re-run with confirm: true.",
        );
      }
      var removedName = doomed.name;
      doomed.remove();
      return { removed: true, name: removedName, layer: layer.name, layerId: layer.id };
    }

    util.fail("INVALID_ARGS", 'Unknown effect action "' + action + '".', "Use list, search, add, set, or remove.");
  };
})();

import { Offhand } from "../core/state";

Offhand.tools = Offhand.tools || {};

(function () {
  function readSafe(util, prop) {
    try {
      return util.readValue(prop);
    } catch (error) {
      return null;
    }
  }

  // Numeric values (a number or a vector of numbers) can be compared against
  // what AE reports after the write, which catches silent no-ops such as
  // setting a locked or expression-driven property.
  function numericValue(value) {
    if (typeof value === "number" && isFinite(value)) return [value];
    if (value instanceof Array) {
      var out = [];
      for (var i = 0; i < value.length; i += 1) {
        if (typeof value[i] !== "number" || !isFinite(value[i])) return null;
        out.push(value[i]);
      }
      return out;
    }
    return null;
  }

  function sameVector(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i += 1) {
      if (Math.abs(a[i] - b[i]) > 0.0001) return false;
    }
    return true;
  }

  function describe(value) {
    try {
      return Offhand.json.stringify(value);
    } catch (error) {
      return String(value);
    }
  }

  function verifyApplied(util, prop, before, after, requested, args, coerced) {
    if (args.time !== undefined || (prop.numKeys || 0) > 0) return;
    if (!requested) return;
    var beforeVector = numericValue(before);
    // An intentional write of the current value is not a no-op.
    if (beforeVector && sameVector(beforeVector, requested)) return;
    var changed = util.diff({ value: before }, { value: after });
    if (!changed.hasOwnProperty("value")) {
      util.fail(
        "INVALID_STATE",
        'Setting "' + prop.name + '" did not change its value.',
        "The property is likely locked, driven by an expression, or not directly editable. " +
          "Coerced value: " +
          describe(coerced) +
          ".",
      );
    }
  }

  function applyEase(util, prop, keyIndex, easeMode) {
    if (!easeMode || easeMode === "linear") {
      if (typeof KeyframeInterpolationType !== "undefined") {
        prop.setInterpolationTypeAtKey(
          keyIndex,
          KeyframeInterpolationType.LINEAR,
          KeyframeInterpolationType.LINEAR,
        );
      }
      return;
    }

    if (typeof KeyframeEase === "undefined" || typeof KeyframeInterpolationType === "undefined") {
      return;
    }

    var easeIn = new KeyframeEase(0, easeMode === "easeIn" || easeMode === "easeInOut" ? 33.33333 : 0.1);
    var easeOut = new KeyframeEase(0, easeMode === "easeOut" || easeMode === "easeInOut" ? 33.33333 : 0.1);

    var dimensions = 1;
    try {
      var val = prop.keyValue(keyIndex);
      if (val instanceof Array && prop.propertyValueType !== PropertyValueType.TwoD_SPATIAL && prop.propertyValueType !== PropertyValueType.ThreeD_SPATIAL) {
        dimensions = val.length;
      }
    } catch (error) {
      dimensions = 1;
    }

    var inArr = [];
    var outArr = [];
    for (var i = 0; i < dimensions; i += 1) {
      inArr.push(easeIn);
      outArr.push(easeOut);
    }

    prop.setInterpolationTypeAtKey(
      keyIndex,
      KeyframeInterpolationType.BEZIER,
      KeyframeInterpolationType.BEZIER,
    );
    prop.setTemporalEaseAtKey(keyIndex, inArr, outArr);
  }

  Offhand.tools.property = function (args) {
    var util = Offhand.util;
    var action = args.action || "get";
    var comp = util.comp(args.comp);
    var layer = util.layer(comp, args.layer);

    if (action === "list") {
      var group = args.path ? util.property(layer, args.path) : layer;
      var items = util.listProperties(group, args.limit === undefined ? 50 : args.limit);
      if (args.detail === "full") {
        for (var i = 0; i < items.length; i += 1) {
          try {
            var child = group.property(items[i].index);
            if (child) items[i].value = readSafe(util, child);
          } catch (valueError) {
            // Groups and non-value properties have no single value.
          }
        }
      }
      return {
        layer: layer.name,
        layerId: layer.id,
        path: args.path || "",
        items: items,
        total: group.numProperties || 0,
      };
    }

    if (!args.path) {
      util.fail(
        "INVALID_ARGS",
        "path is required.",
        'Example: "transform.position" or "transform.opacity". Use action="list" to inspect.',
      );
    }

    var prop = util.property(layer, args.path);

    if (action === "get") {
      var info = util.propertyInfo(prop, args.detail === "min" ? false : args.includeKeys !== false);
      info.layer = layer.name;
      info.layerId = layer.id;
      info.path = args.path;
      return info;
    }

    if (action === "set") {
      if (args.value === undefined) {
        util.fail("INVALID_ARGS", "value is required for action=\"set\".");
      }
      var valueBefore = readSafe(util, prop);
      var keysBefore = prop.numKeys || 0;
      var coerced;
      if (prop.numKeys && prop.numKeys > 0 && args.time === undefined) {
        coerced = util.setValue(prop, args.value, comp.time);
      } else {
        coerced = util.setValue(prop, args.value, args.time);
      }
      var valueAfter = readSafe(util, prop);
      verifyApplied(util, prop, valueBefore, valueAfter, numericValue(args.value), args, coerced);
      var setResult = util.propertyInfo(prop, false);
      setResult.layer = layer.name;
      setResult.layerId = layer.id;
      setResult.path = args.path;
      setResult.changed = { value: { from: valueBefore, to: valueAfter } };
      if ((prop.numKeys || 0) !== keysBefore) {
        setResult.changed.keyframes = { from: keysBefore, to: prop.numKeys || 0 };
      }
      return setResult;
    }

    if (action === "keyframe") {
      if (args.value === undefined) {
        util.fail("INVALID_ARGS", "value is required for action=\"keyframe\".");
      }
      var atTime = util.time(args, comp);
      var keyValueBefore = readSafe(util, prop);
      var keyCountBefore = prop.numKeys || 0;
      util.setValue(prop, args.value, atTime);
      var keyIndex = prop.nearestKeyIndex(atTime);
      if (args.ease) {
        applyEase(util, prop, keyIndex, args.ease);
      }
      var keyResult = util.propertyInfo(prop, true);
      keyResult.layer = layer.name;
      keyResult.layerId = layer.id;
      keyResult.path = args.path;
      keyResult.keyIndex = keyIndex;
      keyResult.changed = {};
      var keyValueAfter = readSafe(util, prop);
      if (!util.same(keyValueBefore, keyValueAfter)) {
        keyResult.changed.value = { from: keyValueBefore, to: keyValueAfter };
      }
      if ((prop.numKeys || 0) !== keyCountBefore) {
        keyResult.changed.keyframes = { from: keyCountBefore, to: prop.numKeys || 0 };
      }
      return keyResult;
    }

    if (action === "removeKeyframe") {
      var index = args.keyIndex;
      var keyCountBefore = prop.numKeys || 0;
      var keyValueBefore = readSafe(util, prop);
      if (index === undefined && args.time !== undefined && prop.numKeys > 0) {
        index = prop.nearestKeyIndex(util.number(args.time, "time"));
      }
      if (typeof index !== "number" || index < 1 || index > prop.numKeys) {
        util.fail(
          "INVALID_ARGS",
          "Valid keyIndex or time is required for action=\"removeKeyframe\".",
          "Property has " + (prop.numKeys || 0) + " keyframes.",
        );
      }
      prop.removeKey(index);
      var remResult = util.propertyInfo(prop, true);
      remResult.layer = layer.name;
      remResult.layerId = layer.id;
      remResult.path = args.path;
      remResult.changed = {
        keyframes: { from: keyCountBefore, to: prop.numKeys || 0 },
      };
      var remValueAfter = readSafe(util, prop);
      if (!util.same(keyValueBefore, remValueAfter)) {
        remResult.changed.value = { from: keyValueBefore, to: remValueAfter };
      }
      return remResult;
    }

    if (action === "expression") {
      if (!prop.canSetExpression) {
        util.fail(
          "INVALID_STATE",
          'Property "' + prop.name + '" does not support expressions.',
        );
      }
      var expressionBefore = prop.expression || "";
      var enabledBefore = !!prop.expressionEnabled;
      if (args.expression !== undefined) {
        prop.expression = String(args.expression);
      }
      if (args.enabled !== undefined) {
        prop.expressionEnabled = !!args.enabled;
      } else if (args.expression !== undefined) {
        prop.expressionEnabled = args.expression !== "";
      }
      var exprResult = util.propertyInfo(prop, false);
      exprResult.layer = layer.name;
      exprResult.layerId = layer.id;
      exprResult.path = args.path;
      exprResult.changed = {
        expression: { from: expressionBefore, to: prop.expression || "" },
        expressionEnabled: { from: enabledBefore, to: !!prop.expressionEnabled },
      };
      return exprResult;
    }

    util.fail(
      "INVALID_ARGS",
      'Unknown property action "' + action + '".',
      "Use list, get, set, keyframe, removeKeyframe, or expression.",
    );
  };
})();

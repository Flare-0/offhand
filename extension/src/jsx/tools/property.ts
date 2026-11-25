import { Offhand } from "../core/state";

Offhand.tools = Offhand.tools || {};

(function () {
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
      return {
        layer: layer.name,
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
      var info = util.propertyInfo(prop, args.includeKeys !== false);
      info.layer = layer.name;
      info.path = args.path;
      return info;
    }

    if (action === "set") {
      if (args.value === undefined) {
        util.fail("INVALID_ARGS", "value is required for action=\"set\".");
      }
      if (prop.numKeys && prop.numKeys > 0 && args.time === undefined) {
        util.setValue(prop, args.value, comp.time);
      } else {
        util.setValue(prop, args.value, args.time);
      }
      var setResult = util.propertyInfo(prop, false);
      setResult.layer = layer.name;
      setResult.path = args.path;
      return setResult;
    }

    if (action === "keyframe") {
      if (args.value === undefined) {
        util.fail("INVALID_ARGS", "value is required for action=\"keyframe\".");
      }
      var atTime = util.time(args, comp);
      util.setValue(prop, args.value, atTime);
      var keyIndex = prop.nearestKeyIndex(atTime);
      if (args.ease) {
        applyEase(util, prop, keyIndex, args.ease);
      }
      var keyResult = util.propertyInfo(prop, true);
      keyResult.layer = layer.name;
      keyResult.path = args.path;
      keyResult.keyIndex = keyIndex;
      return keyResult;
    }

    if (action === "removeKeyframe") {
      var index = args.keyIndex;
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
      remResult.path = args.path;
      return remResult;
    }

    if (action === "expression") {
      if (!prop.canSetExpression) {
        util.fail(
          "INVALID_STATE",
          'Property "' + prop.name + '" does not support expressions.',
        );
      }
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
      exprResult.path = args.path;
      return exprResult;
    }

    util.fail(
      "INVALID_ARGS",
      'Unknown property action "' + action + '".',
      "Use list, get, set, keyframe, removeKeyframe, or expression.",
    );
  };
})();

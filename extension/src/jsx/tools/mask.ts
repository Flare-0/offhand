import { Offhand } from "../core/state";

Offhand.tools = Offhand.tools || {};

(function () {
  function findMask(util, parade, selector) {
    if (!parade) {
      util.fail("INVALID_STATE", "Layer has no Mask Parade.");
    }
    if (typeof selector === "number") {
      if (selector < 1 || selector > parade.numProperties) {
        util.fail("NOT_FOUND", "Mask index " + selector + " is out of range.", 'Call mask with action="list".');
      }
      return parade.property(selector);
    }
    if (typeof selector === "string" && selector.length > 0) {
      var lower = selector.toLowerCase();
      for (var i = 1; i <= parade.numProperties; i += 1) {
        var m = parade.property(i);
        if (m.name === selector || m.name.toLowerCase() === lower) return m;
      }
      util.fail("NOT_FOUND", 'No mask named "' + selector + '".', 'Call mask with action="list".');
    }
    util.fail("INVALID_ARGS", "mask selector is required.", 'Pass mask name or 1-based index.');
  }

  function maskInfo(util, mask, index) {
    var shape = mask.property("ADBE Mask Shape").value;
    return {
      index: index,
      name: mask.name,
      mode: mask.maskMode,
      inverted: mask.inverted,
      feather: util.readValue(mask.property("ADBE Mask Feather")),
      opacity: util.readValue(mask.property("ADBE Mask Opacity")),
      expansion: util.readValue(mask.property("ADBE Mask Offset")),
      vertices: shape ? shape.vertices.length : 0,
      closed: shape ? shape.closed : true,
    };
  }

  function applyMaskProps(util, mask, args) {
    if (args.name !== undefined) mask.name = String(args.name);
    if (args.mode !== undefined) mask.maskMode = util.maskMode(args.mode);
    if (args.inverted !== undefined) mask.inverted = !!args.inverted;
    if (args.feather !== undefined) {
      var f = args.feather instanceof Array
        ? [util.number(args.feather[0], "featherX"), util.number(args.feather[1], "featherY")]
        : [util.number(args.feather, "feather"), util.number(args.feather, "feather")];
      mask.property("ADBE Mask Feather").setValue(f);
    }
    if (args.opacity !== undefined) {
      mask.property("ADBE Mask Opacity").setValue(util.number(args.opacity, "opacity"));
    }
    if (args.expansion !== undefined) {
      mask.property("ADBE Mask Offset").setValue(util.number(args.expansion, "expansion"));
    }
    if (args.bounds !== undefined || args.vertices !== undefined) {
      var shapeVal = args.vertices !== undefined
        ? util.shapeFromPoints(args.vertices, args.closed)
        : util.shapeFromBounds(args.bounds, args.shape || "rect");
      mask.property("ADBE Mask Shape").setValue(shapeVal);
    }
  }

  Offhand.tools.mask = function (args) {
    var util = Offhand.util;
    var action = args.action || "list";
    var comp = util.comp(args.comp);
    var layer = util.layer(comp, args.layer);
    var parade = layer.property("ADBE Mask Parade");

    if (action === "list") {
      var items = [];
      if (parade) {
        for (var i = 1; i <= parade.numProperties; i += 1) {
          items.push(maskInfo(util, parade.property(i), i));
        }
      }
      return { layer: layer.name, layerId: layer.id, items: items, total: parade ? parade.numProperties : 0 };
    }

    if (action === "get") {
      var m = findMask(util, parade, args.mask);
      return maskInfo(util, m, m.propertyIndex);
    }

    if (action === "create") {
      if (!parade) {
        util.fail("INVALID_STATE", 'Layer "' + layer.name + '" cannot hold masks.');
      }
      var countBefore = parade.numProperties;
      var created = parade.addProperty("ADBE Mask Atom");
      if (args.bounds === undefined && args.vertices === undefined) {
        args.bounds = [0, 0, comp.width, comp.height];
      }
      applyMaskProps(util, created, args);
      var createdResult = maskInfo(util, created, created.propertyIndex);
      createdResult.layerId = layer.id;
      createdResult.created = { name: created.name, index: created.propertyIndex };
      createdResult.changed = { masks: { from: countBefore, to: parade.numProperties } };
      return createdResult;
    }

    if (action === "set") {
      var target = findMask(util, parade, args.mask);
      var before = maskInfo(util, target, target.propertyIndex);
      applyMaskProps(util, target, args);
      var setResult = maskInfo(util, target, target.propertyIndex);
      setResult.layerId = layer.id;
      setResult.changed = util.diff(before, setResult);
      if (!setResult.changed.name && !setResult.changed.mode && !setResult.changed.inverted
        && !setResult.changed.feather && !setResult.changed.opacity && !setResult.changed.expansion
        && !setResult.changed.vertices && !setResult.changed.closed) {
        setResult.note = "No values changed.";
      }
      return setResult;
    }

    if (action === "remove") {
      var doomed = findMask(util, parade, args.mask);
      if (args.confirm !== true) {
        util.fail(
          "INVALID_ARGS",
          'Removing a mask requires confirm: true (would remove "' + doomed.name + '").',
          "Re-run with confirm: true.",
        );
      }
      var removedName = doomed.name;
      var removedIndex = doomed.propertyIndex;
      var countBeforeRemove = parade.numProperties;
      doomed.remove();
      return {
        removed: { name: removedName, index: removedIndex },
        layer: layer.name,
        layerId: layer.id,
        changed: { masks: { from: countBeforeRemove, to: parade.numProperties } },
      };
    }

    util.fail("INVALID_ARGS", 'Unknown mask action "' + action + '".', "Use list, get, create, set, or remove.");
  };
})();

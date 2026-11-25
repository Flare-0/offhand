import { Offhand } from "../core/state";

Offhand.tools = Offhand.tools || {};

(function () {
  function findItem(util, selector) {
    var activeProject = util.project();
    if (typeof selector === "number") {
      for (var i = 1; i <= activeProject.numItems; i += 1) {
        var item = activeProject.item(i);
        if (item.id === selector) return item;
      }
      util.fail("NOT_FOUND", "No project item with id " + selector + ".", 'Call project with action="items".');
    }
    if (typeof selector === "string") {
      var lower = selector.toLowerCase();
      for (var j = 1; j <= activeProject.numItems; j += 1) {
        var candidate = activeProject.item(j);
        if (candidate.name === selector || candidate.name.toLowerCase() === lower) return candidate;
      }
      util.fail("NOT_FOUND", 'No project item named "' + selector + '".', 'Call project with action="items".');
    }
    util.fail("INVALID_ARGS", "source must be a project item id or name.");
  }

  function transformInfo(util, layer) {
    var group = null;
    try {
      group = layer.property("ADBE Transform Group");
    } catch (error) {
      group = null;
    }
    if (!group) return null;

    var output = {};
    var fields = [
      ["anchor", "ADBE Anchor Point"],
      ["position", "ADBE Position"],
      ["scale", "ADBE Scale"],
      ["rotation", "ADBE Rotate Z"],
      ["opacity", "ADBE Opacity"],
    ];

    for (var i = 0; i < fields.length; i += 1) {
      try {
        var prop = group.property(fields[i][1]);
        if (prop) output[fields[i][0]] = util.readValue(prop);
      } catch (fieldError) {
        // 3D-only or missing properties are skipped.
      }
    }

    return output;
  }

  function detail(util, layer) {
    var info = util.layerInfo(layer);
    info.transform = transformInfo(util, layer);

    try {
      var effects = layer.property("ADBE Effect Parade");
      info.effects = effects ? effects.numProperties : 0;
    } catch (effectError) {
      info.effects = 0;
    }

    try {
      var masks = layer.property("ADBE Mask Parade");
      info.masks = masks ? masks.numProperties : 0;
    } catch (maskError) {
      info.masks = 0;
    }

    return info;
  }

  function applyCommon(util, comp, layer, args) {
    var changed = [];

    if (args.name !== undefined) {
      layer.name = String(args.name);
      changed.push("name");
    }
    if (args.startTime !== undefined) {
      layer.startTime = util.number(args.startTime, "startTime");
      changed.push("startTime");
    }
    if (args.stretch !== undefined) {
      layer.stretch = util.number(args.stretch, "stretch");
      changed.push("stretch");
    }
    if (args.inPoint !== undefined) {
      layer.inPoint = util.number(args.inPoint, "inPoint");
      changed.push("inPoint");
    }
    if (args.outPoint !== undefined) {
      layer.outPoint = util.number(args.outPoint, "outPoint");
      changed.push("outPoint");
    }
    if (args.enabled !== undefined) {
      layer.enabled = !!args.enabled;
      changed.push("enabled");
    }
    if (args.locked !== undefined) {
      layer.locked = !!args.locked;
      changed.push("locked");
    }
    if (args.solo !== undefined) {
      layer.solo = !!args.solo;
      changed.push("solo");
    }
    if (args.shy !== undefined) {
      layer.shy = !!args.shy;
      changed.push("shy");
    }
    if (args.label !== undefined) {
      layer.label = util.clampInt(args.label, layer.label, 0, 16);
      changed.push("label");
    }
    if (args.comment !== undefined) {
      layer.comment = String(args.comment);
      changed.push("comment");
    }
    if (args.blendMode !== undefined) {
      layer.blendingMode = util.blendMode(args.blendMode);
      changed.push("blendMode");
    }
    if (args.parent !== undefined) {
      if (args.parent === null || args.parent === "") {
        layer.parent = null;
      } else {
        var parentLayer = util.layer(comp, args.parent);
        if (parentLayer === layer) {
          util.fail("INVALID_ARGS", "A layer cannot be its own parent.");
        }
        layer.parent = parentLayer;
      }
      changed.push("parent");
    }

    return changed;
  }

  Offhand.tools.layer = function (args) {
    var util = Offhand.util;
    var action = args.action || "list";

    if (action === "list") {
      var comp = util.comp(args.comp);
      var rows = [];
      for (var i = 1; i <= comp.numLayers; i += 1) {
        var layer = comp.layer(i);
        var row = util.layerInfo(layer);
        row.selected = layer.selected;
        rows.push(row);
      }
      var page = util.page(rows, args.limit === undefined ? 50 : args.limit, args.offset);
      if (page.total === 0) page.hint = "This comp has no layers. Call layer with action=\"create\".";
      return page;
    }

    if (action === "get") {
      return detail(util, util.layer(util.comp(args.comp), args.layer));
    }

    if (action === "create") {
      var target = util.comp(args.comp);
      var type = args.type || "solid";
      var name = args.name ? String(args.name) : null;
      var created = null;

      if (type === "text") {
        created = target.layers.addText(args.text === undefined ? "Text" : String(args.text));
        if (!name) name = "Text";
        if (args.text !== undefined) {
          var source = created.property("Source Text");
          var doc = source.value;
          doc.text = String(args.text);
          source.setValue(doc);
        }
      } else if (type === "solid") {
        var width = args.width === undefined ? target.width : util.number(args.width, "width");
        var height = args.height === undefined ? target.height : util.number(args.height, "height");
        var duration = args.duration === undefined ? target.duration : util.number(args.duration, "duration");
        created = target.layers.addSolid(
          util.color(args.color === undefined ? "#000000" : args.color),
          name || "Solid",
          width,
          height,
          1,
          duration,
        );
        if (!name) name = "Solid";
        if (args.adjustment === true) created.adjustmentLayer = true;
      } else if (type === "null") {
        created = target.layers.addNull(
          args.duration === undefined ? target.duration : util.number(args.duration, "duration"),
        );
        if (!name) name = "Null";
      } else if (type === "shape") {
        created = target.layers.addShape();
        if (!name) name = "Shape";
      } else if (type === "camera") {
        created = target.layers.addCamera(name || "Camera", [
          target.width / 2,
          target.height / 2,
        ]);
        if (!name) name = "Camera";
      } else if (type === "light") {
        created = target.layers.addLight(name || "Light", [
          target.width / 2,
          target.height / 2,
        ]);
        if (!name) name = "Light";
      } else if (type === "comp" || type === "footage") {
        if (args.source === undefined) {
          util.fail("INVALID_ARGS", 'type="' + type + '" requires source.', "Pass the project item name or id.");
        }
        var item = findItem(util, args.source);
        created = target.layers.add(
          item,
          args.duration === undefined ? target.duration : util.number(args.duration, "duration"),
        );
        if (!name) name = item.name;
      } else {
        util.fail("INVALID_ARGS", 'Unknown layer type "' + type + '".', "Use text, solid, null, shape, camera, light, comp, or footage.");
      }

      if (name) created.name = name;
      if (args.position !== undefined) {
        var position = args.position;
        if (!(position instanceof Array) || position.length < 2) {
          util.fail("INVALID_ARGS", "position must be [x, y].", "Example: [960, 540].");
        }
        created.property("ADBE Transform Group").property("ADBE Position").setValue([
          util.number(position[0], "x"),
          util.number(position[1], "y"),
        ]);
      }

      var changed = applyCommon(util, target, created, args);
      var result = detail(util, created);
      if (changed.length > 0) result.changed = changed;
      return result;
    }

    if (action === "set") {
      var setComp = util.comp(args.comp);
      var setLayer = util.layer(setComp, args.layer);
      var setChanged = applyCommon(util, setComp, setLayer, args);
      if (setChanged.length === 0) {
        util.fail("INVALID_ARGS", "Nothing to change.", "Pass name, timing, parent, blendMode, enabled, or another layer field.");
      }
      var setResult = detail(util, setLayer);
      setResult.changed = setChanged;
      return setResult;
    }

    if (action === "duplicate") {
      var duplicateComp = util.comp(args.comp);
      var original = util.layer(duplicateComp, args.layer);
      var copy = original.duplicate();
      if (args.name !== undefined) copy.name = String(args.name);
      return detail(util, copy);
    }

    if (action === "reorder") {
      var reorderComp = util.comp(args.comp);
      var moved = util.layer(reorderComp, args.layer);
      var index = util.number(args.index, "index");
      if (index <= 1) moved.moveToBeginning();
      else if (index >= reorderComp.numLayers) moved.moveToEnd();
      else moved.moveBefore(reorderComp.layer(Math.round(index)));
      var movedInfo = detail(util, moved);
      movedInfo.hint = "Layer indices change after a reorder. Re-read the comp list.";
      return movedInfo;
    }

    if (action === "delete") {
      var deleteComp = util.comp(args.comp);
      var doomed = util.layer(deleteComp, args.layer);
      if (args.confirm !== true) {
        util.fail(
          "INVALID_ARGS",
          'Deleting a layer requires confirm: true (would remove "' + doomed.name + '").',
          "Re-run with confirm: true after checking the layer name.",
        );
      }
      var doomedName = doomed.name;
      doomed.remove();
      return { deleted: true, name: doomedName, layers: deleteComp.numLayers };
    }

    util.fail(
      "INVALID_ARGS",
      'Unknown layer action "' + action + '".',
      "Use list, get, create, set, duplicate, reorder, or delete.",
    );
  };
})();

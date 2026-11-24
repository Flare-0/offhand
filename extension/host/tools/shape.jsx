Offhand.tools = Offhand.tools || {};

(function () {
  function setPosition(util, layer, pos) {
    if (!(pos instanceof Array) || pos.length < 2) {
      util.fail("INVALID_ARGS", "position must be [x, y] or [x, y, z].");
    }
    var arr = [util.number(pos[0], "x"), util.number(pos[1], "y")];
    if (pos.length >= 3) arr.push(util.number(pos[2], "z"));
    layer.property("ADBE Transform Group").property("ADBE Position").setValue(arr);
  }

  function applyFillAndStroke(util, group, args) {
    var fillProp = util.firstWithMatchName(group, ["ADBE Vector Graphic - Fill"]);
    if (args.color !== undefined || args.fill !== undefined) {
      if (!fillProp && args.fill !== false) {
        fillProp = group.addProperty("ADBE Vector Graphic - Fill");
      }
      if (fillProp) {
        if (args.fill !== undefined) fillProp.enabled = !!args.fill;
        if (args.color !== undefined) {
          fillProp.enabled = true;
          fillProp.property("ADBE Vector Fill Color").setValue(util.color(args.color));
        }
      }
    }

    var strokeProp = util.firstWithMatchName(group, ["ADBE Vector Graphic - Stroke"]);
    if (args.strokeColor !== undefined || args.stroke !== undefined || args.strokeWidth !== undefined) {
      if (!strokeProp && args.stroke !== false) {
        strokeProp = group.addProperty("ADBE Vector Graphic - Stroke");
      }
      if (strokeProp) {
        if (args.stroke !== undefined) strokeProp.enabled = !!args.stroke;
        if (args.strokeColor !== undefined) {
          strokeProp.enabled = true;
          strokeProp.property("ADBE Vector Stroke Color").setValue(util.color(args.strokeColor));
        }
        if (args.strokeWidth !== undefined) {
          strokeProp.enabled = true;
          strokeProp.property("ADBE Vector Stroke Width").setValue(util.number(args.strokeWidth, "strokeWidth"));
        }
      }
    }
  }

  function applyShapeParams(util, layer, args) {
    var contents = layer.property("ADBE Root Vectors Group");
    var rect = util.firstWithMatchName(contents, ["ADBE Vector Shape - Rect"]);
    var ellipse = util.firstWithMatchName(contents, ["ADBE Vector Shape - Ellipse"]);
    var star = util.firstWithMatchName(contents, ["ADBE Vector Shape - Star"]);
    var custom = util.firstWithMatchName(contents, ["ADBE Vector Shape - Group"]);

    if (rect) {
      if (args.size !== undefined) {
        rect.property("ADBE Vector Rect Size").setValue([
          util.number(args.size[0], "width"),
          util.number(args.size[1], "height"),
        ]);
      }
      if (args.roundness !== undefined) {
        rect.property("ADBE Vector Rect Roundness").setValue(util.number(args.roundness, "roundness"));
      }
    }

    if (ellipse && args.size !== undefined) {
      ellipse.property("ADBE Vector Ellipse Size").setValue([
        util.number(args.size[0], "width"),
        util.number(args.size[1], "height"),
      ]);
    }

    if (star) {
      if (args.points !== undefined && typeof args.points === "number") {
        star.property("ADBE Vector Star Points").setValue(util.clampInt(args.points, 5, 3, 200));
      }
      if (args.radius !== undefined) {
        star.property("ADBE Vector Star Outer Radius").setValue(util.number(args.radius, "radius"));
      }
      if (args.innerRadius !== undefined) {
        star.property("ADBE Vector Star Inner Radius").setValue(util.number(args.innerRadius, "innerRadius"));
      }
    }

    if (custom && args.points instanceof Array) {
      var shapeProp = custom.property("ADBE Vector Shape");
      shapeProp.setValue(util.shapeFromPoints(args.points, args.closed));
    }

    var targetGroup = util.firstWithMatchName(contents, ["ADBE Vector Group"]) || contents;
    applyFillAndStroke(util, targetGroup, args);
  }

  function readShapeInfo(util, layer) {
    if (!(layer instanceof ShapeLayer)) {
      util.fail("INVALID_ARGS", 'Layer "' + layer.name + '" is not a shape layer.');
    }
    var contents = layer.property("ADBE Root Vectors Group");
    var info = {
      index: layer.index,
      name: layer.name,
      position: util.readValue(layer.property("ADBE Transform Group").property("ADBE Position")),
      groups: contents ? contents.numProperties : 0,
    };

    var rect = util.firstWithMatchName(contents, ["ADBE Vector Shape - Rect"]);
    var ellipse = util.firstWithMatchName(contents, ["ADBE Vector Shape - Ellipse"]);
    var star = util.firstWithMatchName(contents, ["ADBE Vector Shape - Star"]);
    var fill = util.firstWithMatchName(contents, ["ADBE Vector Graphic - Fill"]);
    var stroke = util.firstWithMatchName(contents, ["ADBE Vector Graphic - Stroke"]);

    if (rect) {
      info.shape = "rect";
      info.size = util.readValue(rect.property("ADBE Vector Rect Size"));
      info.roundness = util.readValue(rect.property("ADBE Vector Rect Roundness"));
    } else if (ellipse) {
      info.shape = "ellipse";
      info.size = util.readValue(ellipse.property("ADBE Vector Ellipse Size"));
    } else if (star) {
      info.shape = star.property("ADBE Vector Star Type").value === 2 ? "polygon" : "star";
      info.points = util.readValue(star.property("ADBE Vector Star Points"));
      info.radius = util.readValue(star.property("ADBE Vector Star Outer Radius"));
    }

    if (fill) {
      info.fill = fill.enabled;
      info.color = util.rgbHex(fill.property("ADBE Vector Fill Color").value);
    }
    if (stroke) {
      info.stroke = stroke.enabled;
      info.strokeColor = util.rgbHex(stroke.property("ADBE Vector Stroke Color").value);
      info.strokeWidth = util.readValue(stroke.property("ADBE Vector Stroke Width"));
    }

    return info;
  }

  Offhand.tools.shape = function (args) {
    var util = Offhand.util;
    var action = args.action || "get";
    var comp = util.comp(args.comp);

    if (action === "get") {
      return readShapeInfo(util, util.layer(comp, args.layer));
    }

    if (action === "create") {
      var kind = args.shape || "rect";
      var layer = comp.layers.addShape();
      if (args.name !== undefined) layer.name = String(args.name);
      var contents = layer.property("ADBE Root Vectors Group");
      var group = contents.addProperty("ADBE Vector Group");
      group.name = "Shape";
      var vectors = group.property("ADBE Vectors Group");

      if (kind === "rect") {
        vectors.addProperty("ADBE Vector Shape - Rect");
      } else if (kind === "ellipse") {
        vectors.addProperty("ADBE Vector Shape - Ellipse");
      } else if (kind === "star" || kind === "polygon") {
        var star = vectors.addProperty("ADBE Vector Shape - Star");
        star.property("ADBE Vector Star Type").setValue(kind === "polygon" ? 2 : 1);
      } else if (kind === "path") {
        vectors.addProperty("ADBE Vector Shape - Group");
      } else {
        util.fail("INVALID_ARGS", 'Unknown shape kind "' + kind + '".', "Use rect, ellipse, star, polygon, or path.");
      }

      if (args.color === undefined && args.fill !== false && args.stroke === undefined) {
        args.color = "#ffffff";
      }

      applyShapeParams(util, layer, args);
      if (args.position !== undefined) setPosition(util, layer, args.position);
      return readShapeInfo(util, layer);
    }

    if (action === "set") {
      var target = util.layer(comp, args.layer);
      if (!(target instanceof ShapeLayer)) {
        util.fail("INVALID_ARGS", 'Layer "' + target.name + '" is not a shape layer.');
      }
      if (args.name !== undefined) target.name = String(args.name);
      applyShapeParams(util, target, args);
      if (args.position !== undefined) setPosition(util, target, args.position);
      return readShapeInfo(util, target);
    }

    util.fail("INVALID_ARGS", 'Unknown shape action "' + action + '".', "Use get, create, or set.");
  };
})();

Offhand.util =
  Offhand.util ||
  (function () {
    var ALIASES = {
      transform: "ADBE Transform Group",
      anchorpoint: "ADBE Anchor Point",
      position: "ADBE Position",
      scale: "ADBE Scale",
      rotation: "ADBE Rotate Z",
      xrotation: "ADBE Rotate X",
      yrotation: "ADBE Rotate Y",
      opacity: "ADBE Opacity",
      effects: "ADBE Effect Parade",
      masks: "ADBE Mask Parade",
      maskshape: "ADBE Mask Shape",
      sourcetext: "Source Text",
      text: "Source Text",
      contents: "ADBE Root Vectors Group",
      vectors: "ADBE Root Vectors Group",
      markers: "Marker",
      marker: "Marker",
      audio: "ADBE Audio Group",
      timeremapping: "ADBE Time Remapping",
      camera: "ADBE Camera Options Group",
      light: "ADBE Light Options Group",
      material: "ADBE Material Options Group",
      orientation: "ADBE Orientation",
    };

    var JUSTIFY = {
      left: 0,
      center: 1,
      right: 2,
      justify: 3,
      full: 3,
    };

    function fail(code, message, hint) {
      var error = new Error(message);
      error.offhand = { code: code, message: message };
      if (hint) error.offhand.hint = hint;
      throw error;
    }

    function isNumber(value) {
      return typeof value === "number" && isFinite(value);
    }

    function number(value, what) {
      var parsed = typeof value === "string" ? parseFloat(value) : value;
      if (!isNumber(parsed)) {
        fail(
          "INVALID_ARGS",
          (what || "value") + " must be a number.",
          "Pass a finite number, for example 30 or 1.5.",
        );
      }
      return parsed;
    }

    function round(value, digits) {
      if (!isNumber(value)) return value;
      var factor = Math.pow(10, digits === undefined ? 2 : digits);
      return Math.round(value * factor) / factor;
    }

    function clampInt(value, fallback, min, max) {
      var parsed = parseInt(value, 10);
      if (!isFinite(parsed)) parsed = fallback;
      if (parsed < min) parsed = min;
      if (parsed > max) parsed = max;
      return parsed;
    }

    function page(rows, limit, offset) {
      var start = offset === undefined || offset === null ? 0 : Math.max(0, parseInt(offset, 10) || 0);
      var max = limit === undefined || limit === null ? rows.length : Math.max(1, parseInt(limit, 10) || 1);
      var slice = [];
      for (var i = start; i < rows.length && slice.length < max; i += 1) {
        slice.push(rows[i]);
      }
      var result = {
        items: slice,
        total: rows.length,
        returned: slice.length,
        truncated: start + slice.length < rows.length,
      };
      if (result.truncated) result.nextOffset = start + slice.length;
      return result;
    }

    function project() {
      if (!app.project) {
        fail("INVALID_STATE", "No After Effects project is open.", "Open or create a project, then retry.");
      }
      return app.project;
    }

    function findComp(selector) {
      var activeProject = project();

      if (selector && typeof selector === "object") {
        if (typeof selector.id === "number") return findComp(selector.id);
        if (typeof selector.name === "string") return findComp(selector.name);
      }

      if (typeof selector === "undefined" || selector === null || selector === "") {
        var active = activeProject.activeItem;
        if (active && active instanceof CompItem) return active;
        fail(
          "INVALID_STATE",
          "No active composition.",
          'Open a composition, or pass comp as an id or name. Call project with action="comps" to list compositions.',
        );
      }

      if (typeof selector === "number") {
        for (var i = 1; i <= activeProject.numItems; i += 1) {
          var item = activeProject.item(i);
          if (item instanceof CompItem && item.id === selector) return item;
        }
        fail("NOT_FOUND", "No composition with id " + selector + ".", 'Call project with action="comps".');
      }

      if (typeof selector === "string") {
        var match = null;
        var lower = selector.toLowerCase();
        for (var j = 1; j <= activeProject.numItems; j += 1) {
          var candidate = activeProject.item(j);
          if (!(candidate instanceof CompItem)) continue;
          if (candidate.name === selector) return candidate;
          if (!match && candidate.name.toLowerCase() === lower) match = candidate;
        }
        if (match) return match;
        fail(
          "NOT_FOUND",
          'No composition named "' + selector + '".',
          'Call project with action="comps" to list compositions.',
        );
      }

      fail("INVALID_ARGS", "comp must be a composition id or name.");
    }

    function findLayer(comp, selector) {
      if (selector && typeof selector === "object") {
        if (typeof selector.index === "number") return findLayer(comp, selector.index);
        if (typeof selector.name === "string") return findLayer(comp, selector.name);
      }

      if (typeof selector === "undefined" || selector === null || selector === "") {
        if (comp.selectedLayers && comp.selectedLayers.length > 0) return comp.selectedLayers[0];
        fail(
          "INVALID_ARGS",
          "No layer selected.",
          'Pass layer as an index or name. Call layer with action="list" to list layers.',
        );
      }

      if (typeof selector === "number") {
        if (selector < 1 || selector > comp.numLayers) {
          fail(
            "NOT_FOUND",
            "Layer index " + selector + " is out of range (1–" + comp.numLayers + ").",
            'Call layer with action="list".',
          );
        }
        return comp.layer(selector);
      }

      if (typeof selector === "string") {
        var match = null;
        var lower = selector.toLowerCase();
        for (var i = 1; i <= comp.numLayers; i += 1) {
          var layer = comp.layer(i);
          if (layer.name === selector) return layer;
          if (!match && layer.name.toLowerCase() === lower) match = layer;
        }
        if (match) return match;
        fail("NOT_FOUND", 'No layer named "' + selector + '".', 'Call layer with action="list".');
      }

      fail("INVALID_ARGS", "layer must be a layer index or name.");
    }

    function time(args, comp) {
      if (args && typeof args.time === "number") return args.time;
      return comp ? comp.time : 0;
    }

    function color(value) {
      if (typeof value === "string") {
        var hex = value.replace(/^#/, "");
        if (hex.length === 3) {
          hex =
            hex.charAt(0) +
            hex.charAt(0) +
            hex.charAt(1) +
            hex.charAt(1) +
            hex.charAt(2) +
            hex.charAt(2);
        }
        if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
          fail("INVALID_ARGS", 'color "' + value + '" is not a hex color.', 'Use "#rrggbb" or [r, g, b].');
        }
        return [
          parseInt(hex.substr(0, 2), 16) / 255,
          parseInt(hex.substr(2, 2), 16) / 255,
          parseInt(hex.substr(4, 2), 16) / 255,
        ];
      }

      if (value && typeof value === "object" && typeof value.length === "number") {
        if (value.length < 3) {
          fail("INVALID_ARGS", "color needs at least three channels.", "Use [r, g, b] or [r, g, b, a].");
        }
        var max = Math.max(value[0], value[1], value[2]);
        if (max > 1) {
          return [value[0] / 255, value[1] / 255, value[2] / 255];
        }
        return [value[0], value[1], value[2]];
      }

      if (value && typeof value === "object") {
        return color([value.r, value.g, value.b]);
      }

      fail("INVALID_ARGS", "color must be [#rrggbb] or [r, g, b].", "Channels are 0–255 or 0–1.");
    }

    function rgbHex(rgb) {
      if (!rgb || rgb.length < 3) return null;
      var out = "#";
      for (var i = 0; i < 3; i += 1) {
        var channel = Math.round(Math.max(0, Math.min(1, rgb[i])) * 255).toString(16);
        out += channel.length === 1 ? "0" + channel : channel;
      }
      return out;
    }

    function itemType(item) {
      if (item instanceof CompItem) return "comp";
      if (item instanceof FootageItem) return "footage";
      if (item instanceof FolderItem) return "folder";
      return "item";
    }

    function itemInfo(item) {
      var info = {
        id: item.id,
        name: item.name,
        type: itemType(item),
        parent: item.parentFolder ? item.parentFolder.name : null,
        comment: item.comment || "",
      };

      if (item instanceof CompItem) {
        info.width = item.width;
        info.height = item.height;
        info.fps = round(item.frameRate, 3);
        info.duration = round(item.duration, 3);
        info.layers = item.numLayers;
      } else if (item instanceof FootageItem) {
        var source = item.mainSource || null;
        info.width = item.width;
        info.height = item.height;
        info.duration = round(item.duration, 3);
        info.missing = typeof item.footageMissing === "boolean" ? item.footageMissing : false;
        info.path = source && source.file ? source.file.fsName : null;
        info.footageType = source && source.file
          ? "file"
          : source && source instanceof SolidSource
            ? "solid"
            : source && source instanceof PlaceholderSource
              ? "placeholder"
              : "other";
      }

      return info;
    }

    function compInfo(comp) {
      return {
        id: comp.id,
        name: comp.name,
        width: comp.width,
        height: comp.height,
        fps: round(comp.frameRate, 3),
        duration: round(comp.duration, 3),
        layers: comp.numLayers,
        time: round(comp.time, 3),
        workAreaStart: round(comp.workAreaStart, 3),
        workAreaDuration: round(comp.workAreaDuration, 3),
        bgColor: rgbHex(comp.bgColor),
        resolutionFactor: comp.resolutionFactor
          ? [comp.resolutionFactor[0], comp.resolutionFactor[1]]
          : null,
        motionBlur: comp.motionBlur,
        shutterAngle: comp.shutterAngle,
      };
    }

    function layerType(layer) {
      if (layer instanceof TextLayer) return "text";
      if (layer instanceof ShapeLayer) return "shape";
      if (layer instanceof CameraLayer) return "camera";
      if (layer instanceof LightLayer) return "light";
      if (layer instanceof AVLayer) {
        if (layer.adjustmentLayer) return "adjustment";
        var source = layer.source;
        if (source instanceof CompItem) return "precomp";
        if (source instanceof FootageItem) {
          if (source.mainSource && source.mainSource instanceof SolidSource) return "solid";
          return "footage";
        }
        return "av";
      }
      return "layer";
    }

    function layerInfo(layer) {
      var info = {
        index: layer.index,
        name: layer.name,
        type: layerType(layer),
        enabled: layer.enabled,
        locked: layer.locked,
        solo: layer.solo,
        shy: layer.shy,
        inPoint: round(layer.inPoint, 3),
        outPoint: round(layer.outPoint, 3),
        startTime: round(layer.startTime, 3),
        stretch: round(layer.stretch, 3),
        parent: layer.parent ? layer.parent.name : null,
        label: layer.label,
        comment: layer.comment || "",
      };

      if (layer instanceof AVLayer) {
        info.hasVideo = layer.hasVideo;
        info.hasAudio = layer.hasAudio;
        info.blendMode = layer.blendingMode;
        if (layer.source) {
          info.source = {
            id: layer.source.id,
            name: layer.source.name,
            type: itemType(layer.source),
          };
        }
      }

      if (layer instanceof CameraLayer) {
        info.zoom = layer.zoom;
      }

      return info;
    }

    function childNames(group, max) {
      var names = [];
      if (!group || !group.numProperties) return names;
      var limit = max === undefined ? 14 : max;
      for (var i = 1; i <= group.numProperties && names.length < limit; i += 1) {
        var child = group.property(i);
        if (child && child.name) names.push(child.name);
      }
      return names;
    }

    function resolveChild(group, token) {
      var prop = null;

      try {
        prop = group.property(token);
      } catch (error) {
        prop = null;
      }

      if (!prop) {
        var alias = ALIASES[String(token).toLowerCase()];
        if (alias) {
          try {
            prop = group.property(alias);
          } catch (aliasError) {
            prop = null;
          }
        }
      }

      if (!prop && /^\d+$/.test(String(token))) {
        var index = parseInt(token, 10);
        if (index > 0 && group.numProperties && index <= group.numProperties) {
          prop = group.property(index);
        }
      }

      if (!prop && group.numProperties) {
        var lower = String(token).toLowerCase();
        for (var i = 1; i <= group.numProperties; i += 1) {
          var child = group.property(i);
          if (!child) continue;
          if (child.name && child.name.toLowerCase() === lower) {
            prop = child;
            break;
          }
          if (child.matchName && child.matchName.toLowerCase() === lower) {
            prop = child;
            break;
          }
        }
      }

      return prop;
    }

    function propertyPath(group, path) {
      if (!group) fail("INVALID_STATE", "No layer or property group to read.");
      if (typeof path !== "string" || path.length === 0) {
        fail("INVALID_ARGS", "path is required.", 'Example: "transform.position" or "effects.Glow.Glow Threshold".');
      }

      var cleaned = path.replace(/^layer\./i, "");
      var parts = cleaned.split(".");
      var current = group;

      for (var i = 0; i < parts.length; i += 1) {
        var token = parts[i];
        if (token === "") continue;
        var next = resolveChild(current, token);
        if (!next) {
          fail(
            "NOT_FOUND",
            'No property "' + token + '" under "' + (current.name || "layer") + '".',
            "Available: " + childNames(current).join(", ") + ". Use property with action=\"list\" to inspect.",
          );
        }
        current = next;
      }

      return current;
    }

    function propertyType(prop) {
      if (typeof PropertyValueType === "undefined") return "unknown";
      var type = prop.propertyValueType;
      if (type === PropertyValueType.NO_VALUE) return "group";
      if (type === PropertyValueType.ThreeD_SPATIAL) return "3d";
      if (type === PropertyValueType.TwoD_SPATIAL) return "2d";
      if (type === PropertyValueType.OneD) return "number";
      if (type === PropertyValueType.COLOR) return "color";
      if (type === PropertyValueType.CUSTOM_VALUE) return "custom";
      if (type === PropertyValueType.MARKER) return "marker";
      if (type === PropertyValueType.LAYER_INDEX) return "layer";
      if (type === PropertyValueType.MASK_INDEX) return "mask";
      if (type === PropertyValueType.SHAPE) return "shape";
      if (type === PropertyValueType.TEXT_DOCUMENT) return "text";
      return "unknown";
    }

    function textDocInfo(doc) {
      var justify = "";
      if (typeof ParagraphJustification !== "undefined") {
        if (doc.justification === ParagraphJustification.LEFT_JUSTIFY) justify = "left";
        else if (doc.justification === ParagraphJustification.CENTER_JUSTIFY) justify = "center";
        else if (doc.justification === ParagraphJustification.RIGHT_JUSTIFY) justify = "right";
        else justify = "justify";
      }

      return {
        text: doc.text,
        font: doc.font,
        size: round(doc.fontSize, 3),
        color: rgbHex(doc.fillColor),
        applyFill: doc.applyFill,
        strokeColor: rgbHex(doc.strokeColor),
        applyStroke: doc.applyStroke,
        strokeWidth: round(doc.strokeWidth, 2),
        tracking: round(doc.tracking, 2),
        leading: round(doc.leading, 2),
        justification: justify,
        fauxBold: doc.fauxBold,
        fauxItalic: doc.fauxItalic,
        allCaps: doc.allCaps,
        boxText: doc.boxText,
      };
    }

    function applyTextDoc(doc, updates) {
      if (!updates) return doc;

      if (updates.text !== undefined) doc.text = String(updates.text);
      if (updates.font !== undefined) doc.font = String(updates.font);
      if (updates.size !== undefined) doc.fontSize = number(updates.size, "size");
      if (updates.color !== undefined) {
        doc.applyFill = true;
        doc.fillColor = color(updates.color);
      }
      if (updates.fill !== undefined) doc.applyFill = !!updates.fill;
      if (updates.strokeColor !== undefined) {
        doc.applyStroke = true;
        doc.strokeColor = color(updates.strokeColor);
      }
      if (updates.stroke !== undefined) doc.applyStroke = !!updates.stroke;
      if (updates.strokeWidth !== undefined) doc.strokeWidth = number(updates.strokeWidth, "strokeWidth");
      if (updates.tracking !== undefined) doc.tracking = number(updates.tracking, "tracking");
      if (updates.leading !== undefined) doc.leading = number(updates.leading, "leading");
      if (updates.justification !== undefined) {
        var key = String(updates.justification).toLowerCase();
        var value = JUSTIFY[key];
        if (value === undefined) {
          fail("INVALID_ARGS", 'justification "' + updates.justification + '" is not supported.', "Use left, center, right, or justify.");
        }
        doc.justification = value;
      }
      if (updates.fauxBold !== undefined) doc.fauxBold = !!updates.fauxBold;
      if (updates.fauxItalic !== undefined) doc.fauxItalic = !!updates.fauxItalic;
      if (updates.allCaps !== undefined) doc.allCaps = !!updates.allCaps;

      return doc;
    }

    function shapeFromPoints(points, closed) {
      var shape = new Shape();
      shape.vertices = [];
      for (var i = 0; i < points.length; i += 1) {
        var point = points[i];
        if (point && typeof point === "object" && !(point instanceof Array)) {
          shape.vertices.push([number(point.x, "x"), number(point.y, "y")]);
        } else {
          shape.vertices.push([number(point[0], "x"), number(point[1], "y")]);
        }
      }
      shape.closed = closed === undefined ? true : !!closed;
      return shape;
    }

    function boundsBox(value) {
      if (!value) {
        fail("INVALID_ARGS", "bounds is required.", "Pass [left, top, right, bottom] or {x, y, width, height}.");
      }

      if (value instanceof Array) {
        if (value.length !== 4) {
          fail("INVALID_ARGS", "bounds arrays need four numbers.", "Use [left, top, right, bottom].");
        }
        return {
          left: number(value[0], "left"),
          top: number(value[1], "top"),
          right: number(value[2], "right"),
          bottom: number(value[3], "bottom"),
        };
      }

      if (value.left !== undefined || value.right !== undefined) {
        return {
          left: number(value.left, "left"),
          top: number(value.top, "top"),
          right: number(value.right, "right"),
          bottom: number(value.bottom, "bottom"),
        };
      }

      var x = number(value.x, "x");
      var y = number(value.y, "y");
      var width = number(value.width, "width");
      var height = number(value.height, "height");
      return { left: x, top: y, right: x + width, bottom: y + height };
    }

    function shapeFromBounds(bounds, kind) {
      var box = boundsBox(bounds);

      if (kind === "ellipse" || kind === "oval") {
        var cx = (box.left + box.right) / 2;
        var cy = (box.top + box.bottom) / 2;
        var rx = (box.right - box.left) / 2;
        var ry = (box.bottom - box.top) / 2;
        var kx = rx * 0.5522847498307936;
        var ky = ry * 0.5522847498307936;
        return shapeFromPoints(
          [
            [cx + rx, cy],
            [cx + rx, cy + ky],
            [cx + kx, cy + ry],
            [cx, cy + ry],
            [cx - kx, cy + ry],
            [cx - rx, cy + ky],
            [cx - rx, cy],
            [cx - rx, cy - ky],
            [cx - kx, cy - ry],
            [cx, cy - ry],
            [cx + kx, cy - ry],
            [cx + rx, cy - ky],
          ],
          true,
        );
      }

      return shapeFromPoints(
        [
          [box.left, box.top],
          [box.right, box.top],
          [box.right, box.bottom],
          [box.left, box.bottom],
        ],
        true,
      );
    }

    function shapeValue(value) {
      if (value && typeof value === "object" && value.vertices) {
        return shapeFromPoints(value.vertices, value.closed);
      }
      if (value && typeof value === "object" && value.path) {
        return shapeValue(value.path);
      }
      if (value && typeof value === "object" && value.bounds) {
        return shapeFromBounds(value.bounds, value.shape || "rect");
      }
      if (value instanceof Array) {
        return shapeFromPoints(value, true);
      }
      fail(
        "INVALID_ARGS",
        "shape value is not a path.",
        'Pass {vertices: [[x, y], …], closed: true}, a list of points, or {bounds: [l, t, r, b]}.',
      );
    }

    function readValue(prop) {
      var type = propertyType(prop);

      if (type === "group") return null;

      if (type === "shape") {
        var shape = prop.value;
        return {
          vertices: shape.vertices,
          closed: shape.closed,
        };
      }

      if (type === "text") return textDocInfo(prop.value);

      if (type === "marker") {
        var marker = prop.value;
        return {
          comment: marker.comment,
          time: marker.time,
          duration: marker.duration,
          chapter: marker.chapter,
          url: marker.url,
        };
      }

      if (type === "color") {
        var rgb = prop.value;
        return { rgb: [rgb[0], rgb[1], rgb[2]], hex: rgbHex(rgb) };
      }

      if (type === "layer") {
        var targetLayer = prop.value;
        return targetLayer ? { index: targetLayer.index, name: targetLayer.name } : null;
      }

      if (type === "mask") {
        var targetMask = prop.value;
        return targetMask ? { name: targetMask.name } : null;
      }

      if (type === "custom" || type === "unknown") {
        try {
          return String(prop.value);
        } catch (customError) {
          return null;
        }
      }

      return prop.value;
    }

    function coerceValue(prop, value) {
      var type = propertyType(prop);

      if (type === "color") return color(value);
      if (type === "shape") return shapeValue(value);

      if (type === "text") {
        var doc = prop.value;
        applyTextDoc(doc, value || {});
        return doc;
      }

      if (type === "marker") {
        var marker = prop.value;
        if (value && typeof value === "object") {
          if (value.comment !== undefined) marker.comment = String(value.comment);
          if (value.time !== undefined) marker.time = number(value.time, "time");
          if (value.duration !== undefined) marker.duration = number(value.duration, "duration");
          if (value.chapter !== undefined) marker.chapter = String(value.chapter);
          if (value.url !== undefined) marker.url = String(value.url);
        }
        return marker;
      }

      if (value instanceof Array) {
        var current = prop.value;
        var dimensions = current instanceof Array ? current.length : 1;
        if (value.length < dimensions) {
          fail(
            "INVALID_ARGS",
            '"' + prop.name + '" expects ' + dimensions + " numbers.",
            "Pass an array with " + dimensions + " values.",
          );
        }
        var output = [];
        for (var i = 0; i < dimensions; i += 1) output.push(number(value[i], prop.name));
        return output;
      }

      if (isNumber(value)) {
        var existing = prop.value;
        if (existing instanceof Array && existing.length > 1) {
          fail(
            "INVALID_ARGS",
            '"' + prop.name + '" expects ' + existing.length + " numbers.",
            "Pass an array, for example [960, 540].",
          );
        }
        return value;
      }

      fail(
        "INVALID_ARGS",
        "Unsupported value for \"" + prop.name + "\" (" + type + ").",
        "Use a number, an array of numbers, a hex color, or a shape path depending on the property type.",
      );
    }

    function setValue(prop, value, atTime) {
      var coerced = coerceValue(prop, value);
      if (atTime === undefined || atTime === null) {
        prop.setValue(coerced);
      } else {
        prop.setValueAtTime(number(atTime, "time"), coerced);
      }
      return prop;
    }

    function readKeyValue(prop, index) {
      var type = propertyType(prop);
      var value = prop.keyValue(index);
      if (type === "color") return { rgb: [value[0], value[1], value[2]], hex: rgbHex(value) };
      if (type === "shape") return { vertices: value.vertices, closed: value.closed };
      return value;
    }

    function propertyInfo(prop, includeKeys) {
      var info = {
        name: prop.name,
        matchName: prop.matchName,
        type: propertyType(prop),
      };

      try {
        if (prop.canSetExpression) {
          info.expression = prop.expression || "";
          info.expressionEnabled = prop.expressionEnabled;
        }
      } catch (expressionError) {
        info.expression = "";
        info.expressionEnabled = false;
      }

      if (info.type !== "group") {
        info.value = readValue(prop);
      }

      if (info.type !== "group" && prop.numKeys && prop.numKeys > 0) {
        info.keyframes = prop.numKeys;
        if (includeKeys) {
          var keys = [];
          var max = Math.min(prop.numKeys, 50);
          for (var i = 1; i <= max; i += 1) {
            keys.push({
              index: i,
              time: round(prop.keyTime(i), 3),
              value: readKeyValue(prop, i),
            });
          }
          info.keys = keys;
        }
      }

      return info;
    }

    function keyValues(prop) {
      var keys = [];
      var max = Math.min(prop.numKeys || 0, 50);
      for (var i = 1; i <= max; i += 1) {
        keys.push({ index: i, time: round(prop.keyTime(i), 3) });
      }
      return keys;
    }

    function listProperties(group, limit) {
      var rows = [];
      if (!group || !group.numProperties) return rows;
      var max = limit === undefined ? group.numProperties : Math.min(limit, group.numProperties);
      for (var i = 1; i <= max; i += 1) {
        var child = group.property(i);
        if (!child) continue;
        rows.push({
          index: i,
          name: child.name,
          matchName: child.matchName,
          type: propertyType(child),
          children: child.numProperties || 0,
          keyframes: child.numKeys || 0,
        });
      }
      return rows;
    }

    function firstWithMatchName(group, names) {
      if (!group || !group.numProperties) return null;
      for (var i = 1; i <= group.numProperties; i += 1) {
        var child = group.property(i);
        if (!child) continue;
        for (var j = 0; j < names.length; j += 1) {
          if (child.matchName === names[j]) return child;
        }
        if (child.numProperties) {
          var nested = firstWithMatchName(child, names);
          if (nested) return nested;
        }
      }
      return null;
    }

    function fileFor(path, createParent) {
      if (typeof path !== "string" || path.length === 0) {
        fail("INVALID_ARGS", "path is required.", 'Pass an absolute path such as "C:/work/render.png".');
      }
      var file = new File(path);
      if (createParent && file.parent && !file.parent.exists) file.parent.create();
      return file;
    }

    function safeName(value) {
      return String(value || "comp").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
    }

    function tempFramePath(comp, atTime) {
      var frame = Math.round((atTime || 0) * (comp.frameRate || 30));
      var name = safeName(comp.name) + "-" + frame + ".png";
      var folder = new Folder(Folder.temp.fsName + "/offhand");
      if (!folder.exists) folder.create();
      return folder.fsName + "/" + name;
    }

    function maskMode(value) {
      if (typeof value === "number") return value;
      var key = String(value || "add").toUpperCase();
      if (typeof MaskMode !== "undefined" && MaskMode[key] !== undefined) return MaskMode[key];
      fail("INVALID_ARGS", 'mask mode "' + value + '" is not supported.', "Use add, subtract, intersect, lighten, darken, difference, or none.");
    }

    function blendMode(value) {
      if (typeof value === "number") return value;
      var key = String(value || "").toUpperCase().replace(/[\s-]+/g, "_");
      if (typeof BlendingMode !== "undefined" && BlendingMode[key] !== undefined) return BlendingMode[key];
      fail("INVALID_ARGS", 'blend mode "' + value + '" is not supported.', 'Use a name such as "normal", "screen", "multiply", or "add".');
    }

    return {
      fail: fail,
      isNumber: isNumber,
      number: number,
      round: round,
      clampInt: clampInt,
      page: page,
      project: project,
      comp: findComp,
      layer: findLayer,
      time: time,
      color: color,
      rgbHex: rgbHex,
      itemType: itemType,
      itemInfo: itemInfo,
      compInfo: compInfo,
      layerType: layerType,
      layerInfo: layerInfo,
      property: propertyPath,
      propertyType: propertyType,
      propertyInfo: propertyInfo,
      keyValues: keyValues,
      listProperties: listProperties,
      childNames: childNames,
      readValue: readValue,
      readKeyValue: readKeyValue,
      setValue: setValue,
      textDocInfo: textDocInfo,
      applyTextDoc: applyTextDoc,
      shapeFromPoints: shapeFromPoints,
      shapeFromBounds: shapeFromBounds,
      shapeValue: shapeValue,
      boundsBox: boundsBox,
      firstWithMatchName: firstWithMatchName,
      fileFor: fileFor,
      safeName: safeName,
      tempFramePath: tempFramePath,
      maskMode: maskMode,
      blendMode: blendMode,
    };
  })();

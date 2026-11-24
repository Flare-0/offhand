Offhand.util =
  Offhand.util ||
  (function () {
    function fail(code, message, hint) {
      var error = new Error(message);
      error.offhand = { code: code, message: message };
      if (hint) error.offhand.hint = hint;
      throw error;
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
          hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
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

    return {
      fail: fail,
      project: project,
      comp: findComp,
      layer: findLayer,
      time: time,
      color: color,
    };
  })();

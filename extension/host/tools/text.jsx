Offhand.tools = Offhand.tools || {};

(function () {
  function setPosition(util, layer, pos) {
    if (!(pos instanceof Array) || pos.length < 2) {
      util.fail("INVALID_ARGS", "position must be [x, y] or [x, y, z].", "Example: [960, 540].");
    }
    var arr = [util.number(pos[0], "x"), util.number(pos[1], "y")];
    if (pos.length >= 3) arr.push(util.number(pos[2], "z"));
    layer.property("ADBE Transform Group").property("ADBE Position").setValue(arr);
  }

  function readTextLayer(util, layer) {
    if (!(layer instanceof TextLayer)) {
      util.fail("INVALID_ARGS", 'Layer "' + layer.name + '" is not a text layer.');
    }
    var prop = layer.property("Source Text");
    var info = util.textDocInfo(prop.value);
    info.index = layer.index;
    info.name = layer.name;
    info.position = util.readValue(layer.property("ADBE Transform Group").property("ADBE Position"));
    return info;
  }

  Offhand.tools.text = function (args) {
    var util = Offhand.util;
    var action = args.action || "get";
    var comp = util.comp(args.comp);

    if (action === "get") {
      var layer = util.layer(comp, args.layer);
      return readTextLayer(util, layer);
    }

    if (action === "create") {
      var content = args.text === undefined ? "Text" : String(args.text);
      var created = comp.layers.addText(content);
      if (args.name !== undefined) created.name = String(args.name);
      var prop = created.property("Source Text");
      var doc = prop.value;
      util.applyTextDoc(doc, args);
      prop.setValue(doc);
      if (args.position !== undefined) {
        setPosition(util, created, args.position);
      }
      return readTextLayer(util, created);
    }

    if (action === "set") {
      var target = util.layer(comp, args.layer);
      if (!(target instanceof TextLayer)) {
        util.fail("INVALID_ARGS", 'Layer "' + target.name + '" is not a text layer.');
      }
      if (args.name !== undefined) target.name = String(args.name);
      var srcProp = target.property("Source Text");
      var srcDoc = srcProp.value;
      util.applyTextDoc(srcDoc, args);
      srcProp.setValue(srcDoc);
      if (args.position !== undefined) {
        setPosition(util, target, args.position);
      }
      return readTextLayer(util, target);
    }

    util.fail("INVALID_ARGS", 'Unknown text action "' + action + '".', "Use get, create, or set.");
  };
})();

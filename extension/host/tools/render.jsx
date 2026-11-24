Offhand.tools = Offhand.tools || {};

(function () {
  function queueStatus(util, rq) {
    var items = [];
    for (var i = 1; i <= rq.numItems; i += 1) {
      var item = rq.item(i);
      var output = null;
      try {
        if (item.numOutputModules > 0 && item.outputModule(1).file) {
          output = item.outputModule(1).file.fsName;
        }
      } catch (error) {
        output = null;
      }
      items.push({
        index: i,
        comp: item.comp ? item.comp.name : null,
        status: String(item.status),
        output: output,
      });
    }
    return {
      rendering: !!rq.rendering,
      total: rq.numItems,
      items: items,
    };
  }

  Offhand.tools.render = function (args) {
    var util = Offhand.util;
    var action = args.action || "status";
    var rq = app.project ? app.project.renderQueue : null;

    if (action === "status") {
      if (!rq) util.fail("INVALID_STATE", "No render queue available.");
      return queueStatus(util, rq);
    }

    if (action === "clear") {
      if (!rq) util.fail("INVALID_STATE", "No render queue available.");
      if (args.confirm !== true) {
        util.fail(
          "INVALID_ARGS",
          "Clearing the render queue requires confirm: true.",
          "Re-run with confirm: true.",
        );
      }
      var count = rq.numItems;
      while (rq.numItems > 0) {
        rq.item(rq.numItems).remove();
      }
      return { cleared: true, removed: count };
    }

    if (action === "frame") {
      var comp = util.comp(args.comp);
      var atTime = util.time(args, comp);
      var outPath = args.path || util.tempFramePath(comp, atTime);
      var file = util.fileFor(outPath, true);
      comp.saveFrameToPng(atTime, file);
      return {
        saved: true,
        comp: comp.name,
        time: util.round(atTime, 3),
        path: file.fsName,
      };
    }

    if (action === "queue") {
      if (!rq) util.fail("INVALID_STATE", "No render queue available.");
      var targetComp = util.comp(args.comp);
      var rqItem = rq.items.add(targetComp);

      if (args.template) {
        try {
          rqItem.applyTemplate(String(args.template));
        } catch (tplError) {
          util.fail("INVALID_ARGS", 'Unknown render template "' + args.template + '".');
        }
      }

      if (rqItem.numOutputModules > 0) {
        var om = rqItem.outputModule(1);
        if (args.outputModule) {
          try {
            om.applyTemplate(String(args.outputModule));
          } catch (omError) {
            util.fail("INVALID_ARGS", 'Unknown output module template "' + args.outputModule + '".');
          }
        }
        if (args.output) {
          om.file = util.fileFor(args.output, true);
        }
      }

      if (args.start === true) {
        rq.render();
      }

      return queueStatus(util, rq);
    }

    util.fail("INVALID_ARGS", 'Unknown render action "' + action + '".', "Use frame, queue, status, or clear.");
  };
})();

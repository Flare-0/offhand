import { Offhand } from "../core/state";

Offhand.tools = Offhand.tools || {};

(function () {
  function counts(activeProject) {
    var result = { comps: 0, footage: 0, folders: 0 };
    for (var i = 1; i <= activeProject.numItems; i += 1) {
      var item = activeProject.item(i);
      if (item instanceof CompItem) result.comps += 1;
      else if (item instanceof FootageItem) result.footage += 1;
      else result.folders += 1;
    }
    return result;
  }

  function info(activeProject) {
    var active = activeProject.activeItem;
    var summary = counts(activeProject);
    return {
      name: activeProject.file ? activeProject.file.name : "Untitled",
      path: activeProject.file ? activeProject.file.fsName : null,
      items: activeProject.numItems,
      comps: summary.comps,
      footage: summary.footage,
      folders: summary.folders,
      bitsPerChannel: activeProject.bitsPerChannel,
      bgColor: Offhand.util.rgbHex(activeProject.bgColor),
      activeItem: active
        ? { id: active.id, name: active.name, type: Offhand.util.itemType(active) }
        : null,
    };
  }

  Offhand.tools.project = function (args) {
    var util = Offhand.util;
    var action = args.action || "info";
    var activeProject = util.project();

    if (action === "info") {
      return info(activeProject);
    }

    if (action === "comps") {
      var comps = [];
      for (var i = 1; i <= activeProject.numItems; i += 1) {
        var item = activeProject.item(i);
        if (item instanceof CompItem) comps.push(util.compInfo(item));
      }
      var page = util.page(comps, args.limit === undefined ? 25 : args.limit, args.offset);
      if (page.total === 0) page.hint = "This project has no compositions. Create one with comp action=\"create\".";
      return page;
    }

    if (action === "items") {
      var rows = [];
      var kind = args.kind || null;
      for (var j = 1; j <= activeProject.numItems; j += 1) {
        var candidate = activeProject.item(j);
        var type = util.itemType(candidate);
        if (kind && type !== kind) continue;
        rows.push(util.itemInfo(candidate));
      }
      var itemPage = util.page(rows, args.limit === undefined ? 50 : args.limit, args.offset);
      if (itemPage.total === 0) itemPage.hint = "No items matched. Try kind=\"comp\", \"footage\", or \"folder\".";
      return itemPage;
    }

    if (action === "open") {
      var file = util.fileFor(args.path, false);
      if (!file.exists) {
        util.fail("NOT_FOUND", "Project file not found: " + file.fsName, "Check the path and retry.");
      }
      app.open(file);
      if (!app.project) {
        util.fail("INVALID_STATE", "After Effects did not open " + file.fsName + ".", "Open the project manually, then retry.");
      }
      var opened = info(app.project);
      opened.hint = "After Effects may have prompted to save the previous project.";
      return opened;
    }

    if (action === "save") {
      if (args.path) {
        var target = util.fileFor(args.path, true);
        activeProject.save(target);
      } else if (activeProject.file) {
        activeProject.save();
      } else {
        util.fail(
          "INVALID_ARGS",
          "This project has never been saved.",
          'Pass path, for example "C:/work/project.aep".',
        );
      }
      return {
        saved: true,
        path: activeProject.file ? activeProject.file.fsName : args.path || null,
      };
    }

    util.fail(
      "INVALID_ARGS",
      'Unknown project action "' + action + '".',
      "Use info, comps, items, open, or save.",
    );
  };
})();

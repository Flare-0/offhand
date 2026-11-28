import { Offhand } from "../core/state";

Offhand.tools = Offhand.tools || {};

(function () {
  function findProjectItem(util, activeProject, selector) {
    if (typeof selector === "number") {
      for (var i = 1; i <= activeProject.numItems; i += 1) {
        var item = activeProject.item(i);
        if (item.id === selector) return item;
      }
      util.fail("NOT_FOUND", "No project item with id " + selector + ".", 'Call assets with action="list".');
    }
    if (typeof selector === "string" && selector.length > 0) {
      var lower = selector.toLowerCase();
      for (var j = 1; j <= activeProject.numItems; j += 1) {
        var candidate = activeProject.item(j);
        if (candidate.name === selector || candidate.name.toLowerCase() === lower) return candidate;
      }
      util.fail("NOT_FOUND", 'No project item named "' + selector + '".', 'Call assets with action="list".');
    }
    util.fail("INVALID_ARGS", "item selector is required.", 'Pass item id or name.');
  }

  Offhand.tools.assets = function (args) {
    var util = Offhand.util;
    var action = args.action || "list";
    var activeProject = util.project();

    if (action === "list") {
      var rows = [];
      for (var i = 1; i <= activeProject.numItems; i += 1) {
        var item = activeProject.item(i);
        if (item instanceof FootageItem || item instanceof FolderItem) {
          rows.push(util.itemInfo(item));
        }
      }
      return util.page(rows, args.limit === undefined ? 50 : args.limit, args.offset);
    }

    if (action === "folder") {
      if (!args.name) {
        util.fail("INVALID_ARGS", "name is required for action=\"folder\".");
      }
      var folder = activeProject.items.addFolder(String(args.name));
      if (args.folder !== undefined) {
        var parentFolder = findProjectItem(util, activeProject, args.folder);
        if (!(parentFolder instanceof FolderItem)) {
          util.fail("INVALID_ARGS", 'Target "' + parentFolder.name + '" is not a folder.');
        }
        folder.parentFolder = parentFolder;
      }
      return util.itemInfo(folder);
    }

    if (action === "import") {
      // Accept paths as an array, one path, or a JSON-encoded array. Some MCP
      // clients stringify array arguments, and an empty paths must still fall
      // back to path instead of reaching fileFor(undefined).
      //
      // Do not use `instanceof` or compare against undefined/null here:
      // ExtendScript throws "undefined is not an object" for `instanceof` on
      // those values, which made `path`-only imports fail before the handler
      // could read the fallback.
      function isList(candidate) {
        return (
          typeof candidate === "object" &&
          candidate !== null &&
          typeof candidate.length === "number" &&
          typeof candidate.push === "function"
        );
      }
      var raw = args.paths;
      var hasPaths =
        typeof raw === "string" ? raw.length > 0 : isList(raw) && raw.length > 0;
      if (!hasPaths && typeof args.path === "string" && args.path.length > 0) {
        raw = args.path;
      }
      if (typeof raw === "string") {
        var trimmed = raw.replace(/^\s+|\s+$/g, "");
        if (trimmed.charAt(0) === "[") {
          try {
            raw = Offhand.json.parse(trimmed);
          } catch (parseError) {
            raw = trimmed;
          }
        } else {
          raw = trimmed;
        }
      }
      var list = [];
      if (isList(raw)) {
        for (var p = 0; p < raw.length; p += 1) {
          if (raw[p] !== undefined && raw[p] !== null && String(raw[p]).length > 0) {
            list.push(String(raw[p]));
          }
        }
      } else if (typeof raw === "string" && raw.length > 0) {
        list.push(raw);
      }
      if (list.length === 0) {
        util.fail(
          "INVALID_ARGS",
          "paths or path is required for action=\"import\".",
          "Pass one absolute path or an array of paths.",
        );
      }
      var destFolder = null;
      if (args.folder !== undefined) {
        destFolder = findProjectItem(util, activeProject, args.folder);
        if (!(destFolder instanceof FolderItem)) {
          util.fail("INVALID_ARGS", 'Target "' + destFolder.name + '" is not a folder.');
        }
      }

      var imported = [];
      for (var k = 0; k < list.length; k += 1) {
        var file = util.fileFor(list[k], false);
        if (!file.exists) {
          util.fail("NOT_FOUND", "File not found: " + file.fsName);
        }
        var opts = new ImportOptions(file);
        if (args.sequence === true) opts.sequence = true;
        var newItem = activeProject.importFile(opts);
        if (destFolder) newItem.parentFolder = destFolder;
        imported.push(util.itemInfo(newItem));
      }
      return { imported: imported, count: imported.length };
    }

    if (action === "replace") {
      var targetItem = findProjectItem(util, activeProject, args.item);
      if (!(targetItem instanceof FootageItem)) {
        util.fail("INVALID_ARGS", 'Item "' + targetItem.name + '" is not a footage item.');
      }
      var replacement = util.fileFor(args.path, false);
      if (!replacement.exists) {
        util.fail("NOT_FOUND", "Replacement file not found: " + replacement.fsName);
      }
      targetItem.replace(replacement);
      return util.itemInfo(targetItem);
    }

    if (action === "remove") {
      var doomed = findProjectItem(util, activeProject, args.item);
      if (args.confirm !== true) {
        util.fail(
          "INVALID_ARGS",
          'Removing a project item requires confirm: true (would remove "' + doomed.name + '").',
          "Re-run with confirm: true.",
        );
      }
      var removedName = doomed.name;
      doomed.remove();
      return { removed: true, name: removedName };
    }

    util.fail("INVALID_ARGS", 'Unknown assets action "' + action + '".', "Use list, import, replace, folder, or remove.");
  };
})();

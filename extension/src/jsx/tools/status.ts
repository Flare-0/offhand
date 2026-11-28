import { Offhand } from "../core/state";

Offhand.tools = Offhand.tools || {};

Offhand.tools.status = function () {
  var activeProject = app.project || null;
  var comp = null;
  var selection = { items: [], layers: [] };

  if (activeProject) {
    if (activeProject.activeItem instanceof CompItem) comp = activeProject.activeItem;

    if (activeProject.selection) {
      for (var i = 0; i < activeProject.selection.length; i += 1) {
        var item = activeProject.selection[i];
        selection.items.push({
          id: item.id,
          name: item.name,
          type:
            item instanceof CompItem
              ? "comp"
              : item instanceof FootageItem
                ? "footage"
                : "folder",
        });
      }
    }
  }

  if (comp && comp.selectedLayers) {
    for (var j = 0; j < comp.selectedLayers.length; j += 1) {
      var layer = comp.selectedLayers[j];
      selection.layers.push({ uid: Offhand.util.layerUid(layer), name: layer.name });
    }
  }

  return {
    version: app.version,
    project: activeProject
      ? {
          name: activeProject.file ? activeProject.file.name : "Untitled",
          path: activeProject.file ? activeProject.file.fsName : null,
          dirty: typeof activeProject.dirty === "boolean" ? activeProject.dirty : false,
          items: activeProject.numItems,
        }
      : null,
    comp: comp
      ? {
          id: comp.id,
          name: comp.name,
          width: comp.width,
          height: comp.height,
          fps: comp.frameRate,
          duration: comp.duration,
          time: comp.time,
          layers: comp.numLayers,
          workAreaStart: comp.workAreaStart,
          workAreaDuration: comp.workAreaDuration,
        }
      : null,
    selection: selection,
  };
};

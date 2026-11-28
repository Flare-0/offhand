import { Offhand, type RenderJob } from "../core/state";

Offhand.tools = Offhand.tools || {};

(function () {
  // AE exposes RQItemStatus as a name -> number map. Read the installed build's
  // values live instead of guessing the numeric table, so labels stay correct
  // across versions. Status may arrive as a number or (rarely) as a name.
  var STATUS_NAMES = [
    "WILL_CONTINUE",
    "NEEDS_OUTPUT",
    "UNQUEUED",
    "QUEUED",
    "RENDERING",
    "USER_STOPPED",
    "ERR_STOPPED",
    "ERR_INVALID_OUTPUT_PATH",
    "DONE",
  ];

  var STATUS_TABLE: any = null;

  function statusTable() {
    if (STATUS_TABLE) return STATUS_TABLE;
    var table: any = {};
    try {
      if (typeof RQItemStatus !== "undefined" && RQItemStatus) {
        for (var i = 0; i < STATUS_NAMES.length; i += 1) {
          var name = STATUS_NAMES[i];
          var value = RQItemStatus[name];
          if (value !== undefined && value !== null) table[String(value)] = name;
        }
        for (var key in RQItemStatus) {
          var raw = RQItemStatus[key];
          if (raw !== undefined && raw !== null && table[String(raw)] === undefined) {
            table[String(raw)] = String(key);
          }
        }
      }
    } catch (error) {
      table = {};
    }
    STATUS_TABLE = table;
    return table;
  }

  function statusLabel(status) {
    var text = String(status);
    var table = statusTable();
    if (table[text]) return table[text];
    // Some host builds stringify the enum to its name instead of its number.
    var normalized = text.toUpperCase().replace(/[\s-]+/g, "_");
    for (var i = 0; i < STATUS_NAMES.length; i += 1) {
      if (normalized === STATUS_NAMES[i]) return STATUS_NAMES[i];
    }
    return text;
  }

  function jobState(status) {
    var label = statusLabel(status);
    if (label === "DONE") return "done";
    if (label === "RENDERING" || label === "WILL_CONTINUE") return "rendering";
    if (
      label === "USER_STOPPED" ||
      label === "ERR_STOPPED" ||
      label === "ERR_INVALID_OUTPUT_PATH" ||
      label === "NEEDS_OUTPUT" ||
      label === "UNQUEUED"
    ) {
      return "failed";
    }
    return "queued";
  }

  var H264_TEMPLATE = /h\.?\s*264/i;
  var MP4_TEMPLATE = /(mp4|mpeg-?4)/i;

  function now() {
    return new Date().getTime();
  }

  // OutputModule.templates is the list installed for this build. Pick the
  // first H.264/MP4 template so an .mp4 output target gets a matching module
  // even when the caller does not name one.
  function findOutputTemplate(om, pattern) {
    var templates = [];
    try {
      templates = om.templates || [];
    } catch (error) {
      templates = [];
    }
    for (var i = 0; i < templates.length; i += 1) {
      var name = String(templates[i]);
      if (pattern.test(name)) return name;
    }
    return null;
  }

  function isMp4Path(path) {
    return typeof path === "string" && /\.mp4$/i.test(path);
  }

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
      var rawStatus = String(item.status);
      items.push({
        index: i,
        comp: item.comp ? item.comp.name : null,
        status: rawStatus,
        statusName: statusLabel(rawStatus),
        state: jobState(rawStatus),
        output: output,
      });
    }
    return {
      rendering: !!rq.rendering,
      total: rq.numItems,
      items: items,
    };
  }

  function jobInfo(job) {
    return {
      id: job.id,
      comp: job.comp,
      output: job.output,
      queueIndex: job.queueIndex,
      status: job.status,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      ms: job.ms,
      error: job.error,
    };
  }

  function findJob(id) {
    var jobs = Offhand.jobs;
    for (var i = 0; i < jobs.length; i += 1) {
      if (jobs[i].id === id) return jobs[i];
    }
    return null;
  }

  function recordJob(comp, output, queueIndex) {
    var job = {
      id: "j" + (Offhand.jobs.length + 1),
      comp: comp ? comp.name : null,
      output: output || null,
      queueIndex: queueIndex,
      status: "queued",
      queuedAt: now(),
    } as RenderJob;
    Offhand.jobs.push(job);
    return job;
  }

  function queueIndexFor(util, rq, rqItem) {
    try {
      var index = rqItem.index;
      if (typeof index === "number" && index >= 1) return index;
    } catch (indexError) {
      // fall through to identity/position lookup
    }
    for (var i = 1; i <= rq.numItems; i += 1) {
      if (rq.item(i) === rqItem) return i;
    }
    return rq.numItems;
  }

  // Reads the real queue item status back into the job. ExtendScript cannot
  // update a job in the background, so callers sync on the next call.
  function syncJob(job, rq) {
    try {
      if (job.queueIndex < 1 || job.queueIndex > rq.numItems) {
        job.status = "failed";
        job.error = "Render-queue item was removed.";
      } else {
        var status = String(rq.item(job.queueIndex).status);
        var state = jobState(status);
        job.status = state as any;
        if (state === "failed") {
          job.error = "After Effects stopped the render (" + statusLabel(status) + ").";
        } else if (state === "done") {
          job.error = undefined;
        } else {
          job.error = undefined;
          // A job that went back to the queue must not keep the timestamps of
          // a previous attempt.
          job.finishedAt = undefined;
          job.ms = undefined;
        }
      }
    } catch (statusError) {
      job.status = "failed";
      job.error = String(statusError);
    }
    if (job.status === "done" || job.status === "failed") {
      if (job.finishedAt === undefined) {
        job.finishedAt = now();
        job.ms = job.finishedAt - (job.startedAt === undefined ? job.queuedAt : job.startedAt);
      }
    }
  }

  function syncAll(rq) {
    var jobs = Offhand.jobs;
    for (var i = 0; i < jobs.length; i += 1) {
      if (jobs[i].status === "queued" || jobs[i].status === "rendering") syncJob(jobs[i], rq);
    }
  }

  function markRendering(jobs) {
    for (var i = 0; i < jobs.length; i += 1) {
      jobs[i].status = "rendering";
      jobs[i].startedAt = now();
      jobs[i].finishedAt = undefined;
      jobs[i].ms = undefined;
      jobs[i].error = undefined;
    }
  }

  // app.scheduleTask returns to the caller before AE starts rendering, so a
  // long render cannot exceed the bridge deadline. If scheduling is not
  // available, fall back to the old blocking path.
  function scheduleRender(util, rq, jobs) {
    markRendering(jobs);
    if (typeof app.scheduleTask === "function") {
      try {
        app.scheduleTask("app.project.renderQueue.render()", 100, false);
        return true;
      } catch (scheduleError) {
        // fall through to synchronous rendering
      }
    }
    try {
      rq.render();
    } catch (renderError) {
      for (var j = 0; j < jobs.length; j += 1) {
        if (jobs[j].status === "rendering") {
          jobs[j].status = "failed";
          jobs[j].error = String(renderError);
          jobs[j].finishedAt = now();
        }
      }
    }
    for (var k = 0; k < jobs.length; k += 1) syncJob(jobs[k], rq);
    return false;
  }

  function outputForItem(item) {
    try {
      if (item.numOutputModules > 0 && item.outputModule(1).file) {
        return item.outputModule(1).file.fsName;
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  // Jobs live in panel memory, but the render queue survives a panel reload.
  // Adopt untracked queue items so start/jobs keep working after a reload.
  function adoptQueueJobs(util, rq, queuedOnly) {
    var added = 0;
    for (var i = 1; i <= rq.numItems; i += 1) {
      var item = rq.item(i);
      var state = jobState(String(item.status));
      if (queuedOnly && state !== "queued") continue;
      var known = false;
      for (var j = 0; j < Offhand.jobs.length; j += 1) {
        if (Offhand.jobs[j].queueIndex === i) {
          known = true;
          break;
        }
      }
      if (known) continue;
      var adopted = recordJob(item.comp || null, outputForItem(item), i);
      adopted.status = state as any;
      added += 1;
    }
    return added;
  }

  function jobSummary(jobs) {
    var out = [];
    for (var i = 0; i < jobs.length; i += 1) out.push(jobInfo(jobs[i]));
    return out;
  }

  Offhand.tools.render = function (args) {
    var util = Offhand.util;
    var action = args.action || "status";
    var rq = app.project ? app.project.renderQueue : null;

    if (action === "status") {
      if (!rq) util.fail("INVALID_STATE", "No render queue available.");
      adoptQueueJobs(util, rq, true);
      syncAll(rq);
      var statusOut = queueStatus(util, rq);
      statusOut.jobs = jobSummary(Offhand.jobs);
      return statusOut;
    }

    if (action === "jobs") {
      if (!rq) util.fail("INVALID_STATE", "No render queue available.");
      adoptQueueJobs(util, rq, true);
      syncAll(rq);
      return { total: Offhand.jobs.length, jobs: jobSummary(Offhand.jobs), queue: queueStatus(util, rq) };
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
      if (rq.rendering) {
        util.fail(
          "INVALID_STATE",
          "Cannot clear the render queue while it is rendering.",
          'Wait for the render to finish, then call action="clear" again.',
        );
      }
      var count = rq.numItems;
      while (rq.numItems > 0) {
        rq.item(rq.numItems).remove();
      }
      for (var c = 0; c < Offhand.jobs.length; c += 1) {
        if (Offhand.jobs[c].status === "queued" || Offhand.jobs[c].status === "rendering") {
          Offhand.jobs[c].status = "failed";
          Offhand.jobs[c].error = "Render queue was cleared.";
          Offhand.jobs[c].finishedAt = now();
        }
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

      var outputPath = null;
      var appliedModule = null;
      var notes = [];
      if (rqItem.numOutputModules > 0) {
        var om = rqItem.outputModule(1);
        var moduleName = args.outputModule ? String(args.outputModule) : null;
        if (!moduleName && isMp4Path(args.output)) {
          // Default to H.264 for .mp4 targets; the Lossless default would
          // otherwise write a QuickTime file with the wrong extension.
          moduleName = findOutputTemplate(om, H264_TEMPLATE) || findOutputTemplate(om, MP4_TEMPLATE);
          if (!moduleName) {
            notes.push(
              "No H.264/MP4 output-module template is installed; pass outputModule to pick one.",
            );
          }
        }
        if (moduleName) {
          try {
            om.applyTemplate(moduleName);
            appliedModule = moduleName;
          } catch (omError) {
            if (args.outputModule) {
              util.fail("INVALID_ARGS", 'Unknown output module template "' + args.outputModule + '".');
            } else {
              notes.push('Could not apply output module template "' + moduleName + '".');
            }
          }
        }
        if (args.output) {
          om.file = util.fileFor(args.output, true);
        }
        try {
          if (om.file) outputPath = om.file.fsName;
        } catch (fileError) {
          outputPath = null;
        }
      }

      var job = recordJob(targetComp, outputPath, queueIndexFor(util, rq, rqItem));
      var scheduled = false;
      if (args.start === true) {
        scheduled = scheduleRender(util, rq, [job]);
      }
      var queuedOut: any = queueStatus(util, rq);
      queuedOut.job = jobInfo(job);
      queuedOut.outputModule = appliedModule;
      if (args.output && outputPath) {
        var wanted = String(args.output).toLowerCase();
        var actual = String(outputPath).toLowerCase();
        var wantedExt = wanted.indexOf(".") >= 0 ? wanted.substring(wanted.lastIndexOf(".")) : "";
        var actualExt = actual.indexOf(".") >= 0 ? actual.substring(actual.lastIndexOf(".")) : "";
        if (wantedExt && actualExt && wantedExt !== actualExt) {
          notes.push(
            'The output module wrote "' + actualExt + '" instead of "' + wantedExt +
            '". Pass outputModule to choose a template that matches the format.',
          );
        }
      }
      if (args.start === true) {
        queuedOut.scheduled = scheduled;
        queuedOut.blocking = !scheduled;
        notes.push(
          scheduled
            ? 'Rendering is scheduled in After Effects; poll action="jobs" for completion.'
            : "Rendering ran synchronously.",
        );
      }
      if (notes.length > 0) queuedOut.note = notes.join(" ");
      return queuedOut;
    }

    if (action === "start") {
      if (!rq) util.fail("INVALID_STATE", "No render queue available.");
      if (rq.rendering) {
        util.fail(
          "INVALID_STATE",
          "The render queue is already rendering.",
          'Call render with action="jobs" to see progress.',
        );
      }
      adoptQueueJobs(util, rq, true);
      var pending: RenderJob[] = [];
      if (args.job !== undefined) {
        var picked = findJob(String(args.job));
        if (!picked) {
          util.fail(
            "NOT_FOUND",
            'No render job "' + args.job + '".',
            'Call render with action="jobs". After a panel reload, omit job to start queued items.',
          );
        } else if (picked.status !== "queued") {
          util.fail(
            "INVALID_STATE",
            'Render job "' + args.job + '" is ' + picked.status + ", not queued.",
            'Call render with action="jobs" to see the current state.',
          );
        } else {
          pending.push(picked);
        }
      } else {
        for (var i = 0; i < Offhand.jobs.length; i += 1) {
          if (Offhand.jobs[i].status === "queued") pending.push(Offhand.jobs[i]);
        }
      }
      if (pending.length === 0) {
        util.fail(
          "INVALID_STATE",
          "No queued render jobs.",
          'Call render with action="queue" (and maybe comp/path) first, or action="jobs" to inspect the queue.',
        );
      }
      var scheduled = scheduleRender(util, rq, pending);
      var startedOut: any = queueStatus(util, rq);
      startedOut.started = true;
      startedOut.scheduled = scheduled;
      startedOut.blocking = !scheduled;
      startedOut.jobs = jobSummary(pending);
      startedOut.note = scheduled
        ? 'Rendering is scheduled in After Effects; poll action="jobs" for completion.'
        : "Rendering ran synchronously.";
      return startedOut;
    }

    util.fail(
      "INVALID_ARGS",
      'Unknown render action "' + action + '".',
      "Use frame, queue, start, jobs, status, or clear.",
    );
  };
})();

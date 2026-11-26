import { Offhand, type RenderJob } from "../core/state";

Offhand.tools = Offhand.tools || {};

(function () {
  function now() {
    return new Date().getTime();
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
      return rqItem.index;
    } catch (indexError) {
      for (var i = 1; i <= rq.numItems; i += 1) {
        if (rq.item(i) === rqItem) return i;
      }
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
        if (status === "Rendered") {
          job.status = "done";
        } else if (status === "Failed" || status === "User Stopped" || status === "Needs Output File") {
          job.status = "failed";
          job.error = status;
        } else if (status === "Rendering") {
          job.status = "rendering";
        } else {
          job.status = "queued";
        }
      }
    } catch (statusError) {
      job.status = "failed";
      job.error = String(statusError);
    }
    if (job.status === "done" || job.status === "failed") {
      job.finishedAt = now();
      job.ms = job.finishedAt - (job.startedAt === undefined ? job.queuedAt : job.startedAt);
    }
  }

  function syncAll(rq) {
    var jobs = Offhand.jobs;
    for (var i = 0; i < jobs.length; i += 1) {
      if (jobs[i].status === "queued" || jobs[i].status === "rendering") syncJob(jobs[i], rq);
    }
  }

  function renderNow(util, rq, jobs) {
    for (var i = 0; i < jobs.length; i += 1) {
      jobs[i].status = "rendering";
      jobs[i].startedAt = now();
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
      syncAll(rq);
      var statusOut = queueStatus(util, rq);
      statusOut.jobs = jobSummary(Offhand.jobs);
      return statusOut;
    }

    if (action === "jobs") {
      if (!rq) util.fail("INVALID_STATE", "No render queue available.");
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
      var count = rq.numItems;
      while (rq.numItems > 0) {
        rq.item(rq.numItems).remove();
      }
      for (var c = 0; c < Offhand.jobs.length; c += 1) {
        if (Offhand.jobs[c].status === "queued") Offhand.jobs[c].status = "failed";
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
        try {
          if (om.file) outputPath = om.file.fsName;
        } catch (fileError) {
          outputPath = null;
        }
      }

      var job = recordJob(targetComp, outputPath, queueIndexFor(util, rq, rqItem));
      if (args.start === true) {
        renderNow(util, rq, [job]);
      }
      var queuedOut = queueStatus(util, rq);
      queuedOut.job = jobInfo(job);
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
      var pending: RenderJob[] = [];
      if (args.job !== undefined) {
        var picked = findJob(String(args.job));
        if (!picked) {
          util.fail("NOT_FOUND", 'No render job "' + args.job + '".', 'Call render with action="jobs".');
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
          'Call render with action="queue" (and maybe comp/path) first.',
        );
      }
      renderNow(util, rq, pending);
      var startedOut = queueStatus(util, rq);
      startedOut.started = true;
      startedOut.blocking = true;
      startedOut.jobs = jobSummary(pending);
      return startedOut;
    }

    util.fail(
      "INVALID_ARGS",
      'Unknown render action "' + action + '".',
      "Use frame, queue, start, jobs, status, or clear.",
    );
  };
})();

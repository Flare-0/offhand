(function () {
  'use strict';

  var VERSION = '0.1.0';
  var PROTOCOL = 1;
  var RETRY_MS = 2000;
  var MAX_LOG = 80;

  var socket = null;
  var retryTimer = null;
  var connecting = false;
  var hostReady = false;
  var evalQueue = Promise.resolve();

  var el = {
    version: document.getElementById('version'),
    connection: document.getElementById('connection'),
    connectionText: document.getElementById('connection-text'),
    bridge: document.getElementById('bridge'),
    ae: document.getElementById('ae'),
    project: document.getElementById('project'),
    comp: document.getElementById('comp'),
    playhead: document.getElementById('playhead'),
    reconnect: document.getElementById('reconnect'),
    copyConfig: document.getElementById('copy-config'),
    clearLog: document.getElementById('clear-log'),
    log: document.getElementById('log'),
  };

  function cepApi() {
    if (window.cep) return window.cep;
    if (typeof cep !== 'undefined') return cep;
    return null;
  }

  function cepAvailable() {
    var api = cepApi();
    return Boolean(api && api.fs && window.__adobe_cep__);
  }

  function userDataPath() {
    var api = cepApi();
    if (!api || !api.fs) return '';
    try {
      var value = api.fs.getSystemPath('userData');
      if (typeof value === 'string') return value.replace(/\\/g, '/');
      if (value && typeof value.data === 'string') return value.data.replace(/\\/g, '/');
    } catch (error) {
      return '';
    }
    return '';
  }

  function extensionRoot() {
    var api = cepApi();
    if (api && api.fs) {
      try {
        var value = api.fs.getSystemPath('extension');
        if (typeof value === 'string' && value) return value.replace(/\\/g, '/');
        if (value && typeof value.data === 'string' && value.data) return value.data.replace(/\\/g, '/');
      } catch (error) {
        // Fall through to the URL-derived path.
      }
    }
    try {
      var url = new URL('..', window.location.href);
      var pathname = decodeURIComponent(url.pathname);
      if (/^\/[A-Za-z]:/.test(pathname)) pathname = pathname.slice(1);
      return pathname.replace(/\\/g, '/');
    } catch (error) {
      return '';
    }
  }

  function readBridgeConfig() {
    var api = cepApi();
    var root = userDataPath();
    if (!api || !api.fs || !root) return null;
    try {
      var result = api.fs.readFile(root + '/offhand/bridge.json');
      if (!result || result.err !== 0 || !result.data) return null;
      return JSON.parse(result.data);
    } catch (error) {
      return null;
    }
  }

  function evalScript(script) {
    return new Promise(function (resolve, reject) {
      if (!window.__adobe_cep__ || typeof window.__adobe_cep__.evalScript !== 'function') {
        reject(new Error('CEP host is unavailable. Open this panel inside After Effects.'));
        return;
      }
      window.__adobe_cep__.evalScript(script, function (result) {
        if (result === 'EvalScript error.') {
          reject(new Error('ExtendScript eval failed. Check the After Effects scripting log.'));
        } else {
          resolve(result);
        }
      });
    });
  }

  function evalQueued(script) {
    var next = evalQueue.then(function () {
      return evalScript(script);
    });
    evalQueue = next.catch(function () {});
    return next;
  }

  function ensureHost() {
    if (hostReady) return Promise.resolve();
    return evalQueued('(typeof Offhand !== "undefined" && Offhand.loaded) ? "1" : "0"')
      .then(function (loaded) {
        if (loaded === '1') {
          hostReady = true;
          return null;
        }
        var root = extensionRoot();
        if (!root) throw new Error('Could not locate the offhand extension folder.');
        var jsx = root + '/host/offhand.jsx';
        return evalQueued('$.evalFile(' + JSON.stringify(jsx) + ')').then(function () {
          hostReady = true;
        });
      });
  }

  function callHost(tool, args) {
    return ensureHost().then(function () {
      var argsJson = JSON.stringify(args || {});
      var expression =
        'Offhand.dispatch(' + JSON.stringify(tool) + ', ' + JSON.stringify(argsJson) + ')';
      return evalQueued(expression).then(function (raw) {
        var parsed;
        try {
          parsed = JSON.parse(String(raw));
        } catch (error) {
          throw new Error('Host returned invalid JSON: ' + String(raw).slice(0, 160));
        }
        if (!parsed.ok) {
          var hostError = new Error(
            parsed.error && parsed.error.message ? parsed.error.message : 'After Effects error',
          );
          hostError.code = (parsed.error && parsed.error.code) || 'HOST_ERROR';
          hostError.hint = parsed.error && parsed.error.hint;
          throw hostError;
        }
        return parsed.data;
      });
    });
  }

  function send(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function setConnection(state, text) {
    el.connection.setAttribute('data-state', state);
    el.connectionText.textContent = text;
  }

  function setValue(key, value) {
    var node = el[key];
    if (node) node.textContent = value === undefined || value === null || value === '' ? '—' : value;
  }

  function log(message, isError) {
    var item = document.createElement('li');
    var time = document.createElement('time');
    var text = document.createElement('span');
    var now = new Date();
    time.textContent =
      String(now.getHours()).padStart(2, '0') +
      ':' +
      String(now.getMinutes()).padStart(2, '0') +
      ':' +
      String(now.getSeconds()).padStart(2, '0');
    text.textContent = message;
    if (isError) text.className = 'err';
    item.appendChild(time);
    item.appendChild(text);
    el.log.appendChild(item);
    while (el.log.children.length > MAX_LOG) el.log.removeChild(el.log.firstChild);
    el.log.scrollTop = el.log.scrollHeight;
  }

  function fmtTime(seconds) {
    if (typeof seconds !== 'number' || !isFinite(seconds)) return '—';
    var minutes = Math.floor(seconds / 60);
    var rest = seconds - minutes * 60;
    return minutes + ':' + (rest < 10 ? '0' : '') + rest.toFixed(2);
  }

  function renderSnapshot(snapshot) {
    if (!snapshot) {
      setValue('ae', '—');
      setValue('project', '—');
      setValue('comp', '—');
      setValue('playhead', '—');
      return;
    }
    setValue('ae', snapshot.version || 'After Effects');
    setValue(
      'project',
      snapshot.project
        ? snapshot.project.name + (snapshot.project.dirty ? ' *' : '')
        : 'No project',
    );
    if (snapshot.comp) {
      setValue(
        'comp',
        snapshot.comp.name +
          ' · ' +
          snapshot.comp.width +
          '×' +
          snapshot.comp.height +
          ' · ' +
          Math.round(snapshot.comp.fps * 100) / 100 +
          'fps',
      );
      setValue(
        'playhead',
        fmtTime(snapshot.comp.time) + ' / ' + fmtTime(snapshot.comp.duration),
      );
    } else {
      setValue('comp', 'No active comp');
      setValue('playhead', '—');
    }
  }

  function handleCall(message) {
    var started = Date.now();
    return callHost(message.tool, message.args || {})
      .then(function (data) {
        var elapsed = Date.now() - started;
        send({ type: 'result', id: message.id, ok: true, data: data, ms: elapsed });
        log(message.tool + ' ok (' + elapsed + ' ms)');
      })
      .catch(function (error) {
        var elapsed = Date.now() - started;
        var payload = {
          code: error.code || 'HOST_ERROR',
          message: error.message || String(error),
        };
        if (error.hint) payload.hint = error.hint;
        send({ type: 'result', id: message.id, ok: false, error: payload, ms: elapsed });
        log(message.tool + ' failed: ' + payload.message, true);
      });
  }

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(function () {
      retryTimer = null;
      connect();
    }, RETRY_MS);
  }

  function connect() {
    if (connecting) return;
    connecting = true;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (socket) {
      try {
        socket.close();
      } catch (error) {
        // Ignore close races.
      }
      socket = null;
    }

    var config = readBridgeConfig();
    if (!config || !config.port || !config.token) {
      setConnection('waiting', 'Waiting for server');
      setValue('bridge', 'Start offhand in your MCP client');
      connecting = false;
      scheduleRetry();
      return;
    }

    setValue('bridge', 'ws://127.0.0.1:' + config.port);
    setConnection('waiting', 'Connecting');

    var ws;
    try {
      ws = new WebSocket('ws://127.0.0.1:' + config.port);
    } catch (error) {
      connecting = false;
      setConnection('error', 'Connection failed');
      log('Could not open the bridge socket: ' + error.message, true);
      scheduleRetry();
      return;
    }
    socket = ws;

    ws.onopen = function () {
      connecting = false;
      var snapshot = null;
      ensureHost()
        .then(function () {
          return callHost('status', {});
        })
        .then(function (data) {
          snapshot = data;
          renderSnapshot(snapshot);
        })
        .catch(function (error) {
          log('After Effects host not ready: ' + error.message, true);
        })
        .then(function () {
          var ae = null;
          if (snapshot) {
            ae = {
              version: snapshot.version,
              project: snapshot.project,
              comp: snapshot.comp,
            };
          }
          send({
            type: 'hello',
            protocol: PROTOCOL,
            token: config.token,
            panelVersion: VERSION,
            ae: ae,
          });
          log('Handshake sent to offhand server');
        });
    };

    ws.onmessage = function (event) {
      var message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        return;
      }

      if (message.type === 'welcome') {
        setConnection('online', 'Connected');
        setValue('bridge', 'offhand ' + (message.serverVersion || ''));
        log('Bridge ready');
      } else if (message.type === 'call') {
        void handleCall(message);
      } else if (message.type === 'ping') {
        send({ type: 'pong', ts: message.ts });
      } else if (message.type === 'error') {
        setConnection('error', message.code || 'Error');
        log(message.message || 'Bridge error', true);
      }
    };

    ws.onclose = function () {
      if (socket === ws) socket = null;
      connecting = false;
      setConnection('waiting', 'Disconnected');
      renderSnapshot(null);
      scheduleRetry();
    };

    ws.onerror = function () {
      // The close handler performs the retry.
    };
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          log('MCP config copied');
        },
        function () {
          fallbackCopy(text);
        },
      );
      return;
    }
    fallbackCopy(text);
  }

  function fallbackCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      log('MCP config copied');
    } catch (error) {
      log('Copy failed. Select the text manually.', true);
    }
    document.body.removeChild(area);
  }

  function init() {
    el.version.textContent = VERSION;

    el.reconnect.addEventListener('click', function () {
      hostReady = false;
      log('Reconnecting');
      connect();
    });

    el.copyConfig.addEventListener('click', function () {
      copyText(
        JSON.stringify(
          {
            mcp: {
              offhand: {
                type: 'local',
                command: ['npx', '-y', 'offhand-mcp'],
                enabled: true,
              },
            },
          },
          null,
          2,
        ),
      );
    });

    el.clearLog.addEventListener('click', function () {
      el.log.textContent = '';
    });

    if (!cepAvailable()) {
      setConnection('error', 'Open in After Effects');
      log('CEP host not found. Install the panel with "offhand install".', true);
      return;
    }

    connect();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

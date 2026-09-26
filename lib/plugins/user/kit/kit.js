/* ---------------------------------------------------------------------------
   The BytNode kit's script, injected into every page of a plugin written
   by an agent. The page lives in a sandboxed frame with no network: `bn`
   is its only way out — `bn.call` runs an action of ITS plugin (the
   host relays it, the plugin's permissions apply). Also: the theme,
   followed live; the app's fonts; a line chart in the app's style;
   number formats; and every error of the page reported to the host, so
   the agent reads it at its next PluginCheck.

   Reference for the agents: professions/_commun/skills/create-plugin/
   reference/kit.md.
--------------------------------------------------------------------------- */
(function () {
  "use strict";
  var parent = window.parent;
  var pending = {};
  var next = 0;
  var themeListeners = [];

  function post(message) {
    try {
      parent.postMessage(Object.assign({ bn: 1 }, message), "*");
    } catch {
      /* nothing to tell */
    }
  }

  function report(message) {
    post({ type: "error", message: String(message).slice(0, 800) });
  }

  window.addEventListener("error", function (e) {
    report((e.message || "Error") + (e.lineno ? " (line " + e.lineno + ")" : ""));
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    report("Unhandled: " + ((r && r.message) || String(r)));
  });

  window.addEventListener("message", function (e) {
    if (e.source !== parent || !e.data || e.data.bn !== 1) return;
    var m = e.data;
    if (m.type === "result" && pending[m.id]) {
      var p = pending[m.id];
      delete pending[m.id];
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error || "The action failed."));
    } else if (m.type === "theme") {
      document.documentElement.dataset.theme = m.theme === "light" ? "light" : "dark";
      themeListeners.forEach(function (fn) {
        try {
          fn(bn.theme());
        } catch (err) {
          report(err && err.message);
        }
      });
    } else if (m.type === "fonts" && Array.isArray(m.faces) && typeof FontFace === "function") {
      m.faces.forEach(function (f) {
        try {
          var face = new FontFace(f.family, f.data, f.descriptors || {});
          face.load().then(
            function (loaded) {
              document.fonts.add(loaded);
            },
            function () {
              /* the fallback font stays */
            },
          );
        } catch {
          /* the fallback font stays */
        }
      });
      if (m.vars) Object.keys(m.vars).forEach(function (k) {
        document.documentElement.style.setProperty(k, m.vars[k]);
      });
    }
  });

  /* --- Formats ------------------------------------------------------------ */

  function num(n, digits) {
    if (typeof n !== "number" || !isFinite(n)) return "—";
    var d = digits === undefined ? (Math.abs(n) >= 1000 ? 0 : Math.abs(n) >= 1 ? 2 : 4) : digits;
    return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  var fmt = {
    num: num,
    money: function (n, currency, digits) {
      if (typeof n !== "number" || !isFinite(n)) return "—";
      try {
        return n.toLocaleString("en-US", { style: "currency", currency: currency || "USD", minimumFractionDigits: digits === undefined ? 2 : digits, maximumFractionDigits: digits === undefined ? 2 : digits });
      } catch {
        return num(n, digits) + " " + (currency || "");
      }
    },
    pct: function (n, digits) {
      if (typeof n !== "number" || !isFinite(n)) return "—";
      return (n > 0 ? "+" : "") + num(n, digits === undefined ? 2 : digits) + " %";
    },
    compact: function (n) {
      if (typeof n !== "number" || !isFinite(n)) return "—";
      return n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });
    },
    date: function (v) {
      var d = new Date(v);
      return isNaN(d) ? "—" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    },
    time: function (v) {
      var d = new Date(v);
      return isNaN(d) ? "—" : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    },
  };

  /* --- Chart ------------------------------------------------------------------ */

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /** A line chart in the watchlist's style, redrawn on resize and theme. */
  function chart(target, series, options) {
    var host = typeof target === "string" ? document.querySelector(target) : target;
    if (!host) throw new Error("bn.chart: no element " + target);
    var canvas = host.tagName === "CANVAS" ? host : host.querySelector("canvas") || host.appendChild(document.createElement("canvas"));
    var opts = options || {};
    var points = (series || [])
      .map(function (p, i) {
        if (typeof p === "number") return { t: i, v: p };
        var t = typeof p.t === "number" ? p.t : new Date(p.t !== undefined ? p.t : p.time !== undefined ? p.time : p.date).getTime();
        var v = typeof p.v === "number" ? p.v : p.value;
        return { t: isNaN(t) ? i : t, v: v };
      })
      .filter(function (p) {
        return typeof p.v === "number" && isFinite(p.v);
      });

    function draw() {
      var ctx = canvas.getContext("2d");
      var box = canvas.getBoundingClientRect();
      /* The page is zoomed (90 %): a CSS pixel is not a screen pixel. */
      var zoom = canvas.offsetWidth ? box.width / canvas.offsetWidth : 1;
      var w = canvas.offsetWidth, h = canvas.offsetHeight;
      var dpr = (window.devicePixelRatio || 1) * zoom;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (points.length < 2) {
        ctx.fillStyle = css("--label-3");
        ctx.font = "13px " + css("--font-text");
        ctx.fillText(opts.empty || "Not enough data yet.", 4, h / 2);
        return;
      }
      var min = Infinity, max = -Infinity;
      points.forEach(function (p) {
        if (p.v < min) min = p.v;
        if (p.v > max) max = p.v;
      });
      if (min === max) {
        min -= 1;
        max += 1;
      }
      var padTop = 12, padBottom = 22, padRight = opts.axis === false ? 4 : 64;
      var t0 = points[0].t, t1 = points[points.length - 1].t;
      var x = function (t) {
        return ((t - t0) / (t1 - t0 || 1)) * (w - padRight);
      };
      var y = function (v) {
        return padTop + (1 - (v - min) / (max - min)) * (h - padTop - padBottom);
      };
      var rising = points[points.length - 1].v >= points[0].v;
      var tone = opts.color || css(rising ? "--up" : "--down");

      /* Grid lines and their values. */
      ctx.strokeStyle = css("--sep");
      ctx.fillStyle = css("--label-3");
      ctx.lineWidth = 1;
      ctx.font = "11.5px " + css("--font-mono");
      for (var i = 0; i <= 3; i++) {
        var v = min + ((max - min) * i) / 3;
        var yy = Math.round(y(v)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(w - padRight, yy);
        ctx.stroke();
        if (opts.axis !== false) ctx.fillText(opts.format ? opts.format(v) : num(v), w - padRight + 8, yy + 4);
      }

      /* The area, fading down, then the line. */
      var grad = ctx.createLinearGradient(0, padTop, 0, h - padBottom);
      grad.addColorStop(0, tone + "55");
      grad.addColorStop(1, tone + "00");
      ctx.beginPath();
      points.forEach(function (p, k) {
        if (k === 0) ctx.moveTo(x(p.t), y(p.v));
        else ctx.lineTo(x(p.t), y(p.v));
      });
      ctx.lineTo(x(t1), h - padBottom);
      ctx.lineTo(x(t0), h - padBottom);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      points.forEach(function (p, k) {
        if (k === 0) ctx.moveTo(x(p.t), y(p.v));
        else ctx.lineTo(x(p.t), y(p.v));
      });
      ctx.strokeStyle = tone;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.stroke();

      /* The first and last dates, when the series is dated. */
      if (t0 > 1e11) {
        ctx.fillStyle = css("--label-3");
        ctx.fillText(fmt.date(t0), 0, h - 5);
        var last = fmt.date(t1);
        ctx.fillText(last, w - padRight - ctx.measureText(last).width, h - 5);
      }
    }

    draw();
    var ro = new ResizeObserver(draw);
    ro.observe(canvas);
    themeListeners.push(draw);
    return {
      update: function (s) {
        return chart(canvas, s, opts);
      },
    };
  }

  var bn = {
    /** Runs an action of this plugin: `ctx.action(name, handler)` on its side. */
    call: function (action, params) {
      return new Promise(function (resolve, reject) {
        var id = ++next;
        pending[id] = { resolve: resolve, reject: reject };
        post({ type: "call", id: id, action: String(action), params: params || {} });
      });
    },
    /** Opens another tab of the app (a view id: "watchlist", "portfolio"…). */
    openView: function (view, params) {
      post({ type: "open-view", view: String(view), params: params || {} });
    },
    theme: function () {
      return document.documentElement.dataset.theme === "light" ? "light" : "dark";
    },
    onTheme: function (fn) {
      themeListeners.push(fn);
    },
    tone: function (n) {
      return typeof n !== "number" || !isFinite(n) || n === 0 ? "is-flat" : n > 0 ? "is-up" : "is-down";
    },
    /** Text safe to put in innerHTML. */
    esc: function (s) {
      return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    },
    fmt: fmt,
    chart: chart,
  };
  window.bn = Object.freeze(bn);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { post({ type: "ready" }); });
  else post({ type: "ready" });
})();

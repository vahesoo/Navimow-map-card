/*
 * Navimow Map Card  (rc1 — auto entities, history view, overlay rotation, session filtering, visual editor)
 *
 * A self-contained Lovelace custom card. Plots the mower's local (x,y) meter
 * coordinates with a heading arrow and the path of the CURRENT mowing session,
 * optionally over a calibrated aerial/satellite image. The session path is
 * rebuilt from Home Assistant's recorder history on load, so it survives page
 * reloads and navigation, and resets automatically when a new session starts
 * (docked -> mowing). Auto-learns the dock position via the integration's dock
 * sensors (fork v1.1.0+position.4) with a local-learning fallback for older
 * forks. No external dependencies.
 *
 * Install:
 *   1. Put this file at /config/www/navimow-map-card.js
 *   2. Add a Lovelace resource: URL /local/navimow-map-card.js?v=N, type
 *      "JavaScript Module" (bump ?v=N when you update the file)
 *   3. Add a card:  type: custom:navimow-map-card
 *
 * Config (all optional, defaults shown):
 *   type: custom:navimow-map-card
 *   title: Navimow Map
 *   mower_entity: lawn_mower.tont  # preferred; sensors are auto-detected
 *   auto_entities: true
 *   x_entity:                      # optional advanced override
 *   y_entity:                      # optional advanced override
 *   heading_entity:                # optional advanced override
 *   zone_entity:                   # optional advanced override
 *   status_entity:                 # optional advanced override
 *   battery_entity:                # optional advanced override
 *   trail_length: 2000        # max trail points kept (older points are thinned,
 *                             #   not dropped, so the whole path keeps its shape)
 *   history_hours: 24         # how far back to look for the session start
 *   session_count: 6          # max sessions for count/today_or_count modes
 *   session_gap_minutes: 20   # fallback split when no clean mower state intervals exist
 *   session_interrupt_grace_minutes: 5
 *                            # ignore short unavailable/unknown state blips inside one session
 *   session_filter:
 *     mode: count             # count | today | today_or_count
 *     reset_time: "03:00"     # local time when the mowing day starts
 *   trail_legend: false       # show visible session start times below the map
 *   history_view:
 *     enabled: false           # show Today / Yesterday / N days ago selector
 *     days_back: 4             # how many previous mowing days can be selected
 *     show_live_marker_when_history: false
 *   dock_x_entity:            # integration dock sensors (auto-derived from
 *   dock_y_entity:            #   x_entity/y_entity names if not set)
 *   dock_x:                   # manual dock override (meters); disables auto-learn
 *   dock_y:                   #   (both must be set)
 *   dock_samples: 25          # rolling samples averaged while docked (fallback)
 *
 * Overlay alignment:
 *   straighten: true          # true = keep aerial photo upright, rotate mower trail to it
 *                             # false = keep mower coordinate frame stable, rotate/transform aerial image
 *
 * Satellite / aerial background (optional):
 *   background_image: /local/yard.png # your property image under /config/www
 *   overlay_image: /local/yard.png    # legacy alias, still supported
 *   overlay_opacity: 0.9
 *   calibration:                      # EXACTLY 2 reference points that map
 *     - m: [0.0, 0.0]                 #   mower meter coords [x, y] ...
 *       px: [512, 800]                #   ... to image pixel coords [x, y]
 *     - m: [12.4, -3.1]               # tip: point 1 = the dock (read the
 *       px: [220, 410]                #   dock_x/dock_y sensors); point 2 = any
 *                                     #   landmark you can park the mower at
 *
 * Dock marker priority: dock_x/dock_y config > integration dock sensors >
 * locally learned average while docked (localStorage) > origin (0,0).
 */
const NAVIMOW_MAP_CARD_BASE_URL = (() => {
  try { return new URL('.', import.meta.url).href; }
  catch (e) { return '/hacsfiles/navimow-map-card/'; }
})();

class NavimowMapCard extends HTMLElement {
  setConfig(config) {
    this._config = Object.assign({
      title: 'Navimow Map',
      // Preferred rc1 configuration: set only mower_entity and let the card
      // auto-detect the matching sensors created by the Navimow integration.
      mower_entity: null,
      auto_entities: true,
      x_entity: null,
      y_entity: null,
      heading_entity: null,
      zone_entity: null,
      status_entity: null,
      battery_entity: null,
      trail_length: 8000,
      history_hours: 96,
      session_count: 24,
      session_gap_minutes: 20,
      session_interrupt_grace_minutes: 5,
      session_filter: {
        mode: 'today',
        reset_time: '03:00',
      },
      trail_legend: true,
      history_view: {
        enabled: true,
        days_back: 4,
        show_live_marker_when_history: false,
      },
      show_controls: true,
      zone_names: {},
      enable_zoom: true,
      channel_entities: [],
      channel_fill: 'rgba(244, 67, 54, 0.35)',
      channel_stroke: 'rgba(244, 67, 54, 0.80)',
      calibration_mode: false,
      trails: {
        active: {
          color: '#4F7942',
          opacity: 0.50,
          width: 3.4,
        },
        previous: {
          color: '#AFE1AF',
          width: 3.2,
          opacity: {
            first: 0.80,
            last: 0.30,
          },
        },
        fade_mode: 'linear',
      },
      appearance: {
        trails: {
          active: { color: '#4F7942', opacity: 0.50, width: 3.4 },
          previous: { color: '#AFE1AF', width: 3.2, opacity: { first: 0.80, last: 0.30 } },
          fade_mode: 'linear',
        },
        channel: {
          fill: 'rgba(255,0,0,0.5)',
          stroke: 'rgba(255,0,0,0.5)',
          width: 0.3,
        },
        robot: {
          scale: 1.0,
          model: 'h2',
          icon: null,
        },
        dock: {
          scale: 1.0,
          icon: 'mdi:lightning-bolt-circle',
        },
      },
      dock_x_entity: null,
      dock_y_entity: null,
      dock_x: null,
      dock_y: null,
      dock_samples: 25,
      background_image: null,
      overlay_image: null,  // legacy alias for background_image
      overlay_opacity: 0.7,
      calibration: null,
      straighten: true,   // draw the image upright (rotate the trail instead);
                          // set false to keep the mower's coordinate frame
    }, config || {});
    this._trail = [];
    this._sessions = [];
    this._currentSessionStart = null;
    this._lastSessionFilterStart = null;
    this._historyDayOffset = 0;
    this._lastKey = null;
    this._prevState = null;
    this._histLoaded = false;
    this._imgMeta = null;       // {w, h} once the overlay image loads
    this._imgLoading = false;
    this._cal = this._solveCalibration(this._config.calibration);
    this._zoom = { scale: 1, cx: 500, cy: 500 };
    this._pointers = new Map();
    this._panStart = null;
    this._pinchStart = null;
    this._calibrationClicks = [];
    this._lastDraw = null;
    this._dock = null;          // learned [x, y], meters (localStorage fallback)
    this._dockBuf = [];         // rolling samples while docked
    this._dockKey = 'navimow-map-card-dock:' + (this._config.mower_entity || this._config.status_entity || this._config.x_entity || 'default');
    try {
      const v = JSON.parse(localStorage.getItem(this._dockKey));
      if (Array.isArray(v) && isFinite(v[0]) && isFinite(v[1])) this._dock = v;
    } catch (e) { /* storage unavailable — auto-learn still works per-session */ }
    this.innerHTML = `
      <ha-card>
        <div class="nm-hdr"></div>
        <div class="nm-wrap">
          <svg class="nm-map" preserveAspectRatio="xMidYMid meet"></svg>
          <svg class="nm-mwr" preserveAspectRatio="xMidYMid meet"></svg>
        </div>
        <div class="nm-ftr"></div>
        <div class="nm-history"></div>
        <div class="nm-legend"></div>
        <div class="nm-cal"></div>
        <div class="nm-controls">
          <button type="button" class="nm-btn nm-start" data-action="mow">Mow</button>
          <button type="button" class="nm-btn nm-pause" data-action="pause">Pause</button>
          <button type="button" class="nm-btn nm-dock" data-action="dock">Dock</button>
        </div>
      </ha-card>
      <style>
        ha-card { padding: 12px; }
        .nm-hdr { font-weight: 600; margin-bottom: 6px; }
        .nm-wrap { position: relative; width: 100%; aspect-ratio: 1 / 1;
          background: var(--secondary-background-color); border-radius: 8px; overflow: hidden; touch-action: none; cursor: grab; }
        .nm-wrap:active { cursor: grabbing; }
        svg.nm-map { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: block; }
        svg.nm-mwr { position: absolute; top: 0; left: 0; width: 100%; height: 100%;
          display: block; pointer-events: none; }
        .nm-mwr-grp { transition: transform 1.8s linear; }
        .nm-ftr { margin-top: 8px; font-size: 0.9em; color: var(--secondary-text-color);
          display: flex; gap: 14px; flex-wrap: wrap; }
        .nm-ftr b { color: var(--primary-text-color); }
        .nm-legend { display: none; margin-top: 6px; font-size: 0.82em; color: var(--secondary-text-color); }
        .nm-legend-row { display: inline-flex; align-items: center; gap: 6px; margin-right: 12px; margin-top: 4px; }
        .nm-legend-swatch { width: 18px; height: 4px; border-radius: 999px; display: inline-block; }
        .nm-history { display: none; margin-top: 8px; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 0.85em; }
        .nm-history button { border: none; border-radius: 8px; padding: 7px 10px; font-weight: 700; cursor: pointer; background: var(--secondary-background-color); color: var(--primary-text-color); }
        .nm-history button.active { background: var(--primary-color); color: var(--text-primary-color); }
        .nm-cal { display: none; margin-top: 8px; padding: 8px; border-radius: 8px;
          background: var(--secondary-background-color); font-size: 0.85em; }
        .nm-cal pre { white-space: pre-wrap; margin: 6px 0 0; font-family: monospace; }
        .nm-cal button { margin-top: 6px; margin-right: 6px; border: none; border-radius: 8px; padding: 7px 10px;
          font-weight: 700; cursor: pointer; background: var(--primary-color); color: var(--text-primary-color); }
        .nm-controls { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }
        .nm-btn { border: none; border-radius: 12px; padding: 11px 8px; font-weight: 700;
          color: white; cursor: pointer; font-family: inherit; font-size: 13px;
          transition: transform 0.12s ease, filter 0.12s ease; }
        .nm-btn:active { transform: scale(0.96); }
        .nm-btn:hover { filter: brightness(1.08); }
        .nm-start { background: linear-gradient(145deg,#1b5e20,#2e7d32); }
        .nm-pause { background: linear-gradient(145deg,#bf360c,#e64a19); }
        .nm-dock { background: linear-gradient(145deg,#0d47a1,#1565c0); }
      </style>`;
    this._bindControls();
    this._bindGestures();
    this._bindHistoryControls();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._histLoaded && hass) {
      this._histLoaded = true;
      this._loadSessionHistory();
    }
    this._update();
  }

  // Solve a 2-point similarity transform (scale+rotation+translation) from
  // image pixels (y down) to mower meters (y up), via complex arithmetic.
  // Returns {ar, ai, br, bi} such that:
  //   mx = ar*px + ai*py + br ;  my = ai*px - ar*py + bi
  _solveCalibration(cal) {
    if (!Array.isArray(cal) || cal.length !== 2) return null;
    const ok = p => p && Array.isArray(p.m) && Array.isArray(p.px) &&
      p.m.length === 2 && p.px.length === 2 && p.m.concat(p.px).every(isFinite);
    if (!ok(cal[0]) || !ok(cal[1])) return null;
    // q = pixel with y flipped (image y-down -> math y-up)
    const q1 = { r: cal[0].px[0], i: -cal[0].px[1] };
    const q2 = { r: cal[1].px[0], i: -cal[1].px[1] };
    const m1 = { r: cal[0].m[0], i: cal[0].m[1] };
    const m2 = { r: cal[1].m[0], i: cal[1].m[1] };
    const dq = { r: q2.r - q1.r, i: q2.i - q1.i };
    const dm = { r: m2.r - m1.r, i: m2.i - m1.i };
    const den = dq.r * dq.r + dq.i * dq.i;
    if (den < 1e-9) return null; // identical pixel points
    // a = dm / dq  (complex division)
    const ar = (dm.r * dq.r + dm.i * dq.i) / den;
    const ai = (dm.i * dq.r - dm.r * dq.i) / den;
    // b = m1 - a*q1
    const br = m1.r - (ar * q1.r - ai * q1.i);
    const bi = m1.i - (ai * q1.r + ar * q1.i);
    return { ar, ai, br, bi };
  }

  // image pixel -> meters using the solved calibration
  _pxToM(px, py) {
    const c = this._cal;
    return [c.ar * px + c.ai * py + c.br, c.ai * px - c.ar * py + c.bi];
  }

  // meters -> image pixel (inverse calibration): q = (m - b) / a
  _mToPx(mx, my) {
    const c = this._cal;
    const wr = mx - c.br, wi = my - c.bi;
    const den = c.ar * c.ar + c.ai * c.ai;
    const qr = (wr * c.ar + wi * c.ai) / den;
    const qi = (wi * c.ar - wr * c.ai) / den;
    return [qr, -qi]; // flip back to image y-down
  }



  _updateCalibrationUi() {
    const el = this.querySelector('.nm-cal');
    if (!el) return;
    if (!this._config.calibration_mode) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }

    el.style.display = 'block';
    const clicks = this._calibrationClicks || [];
    const calibration = clicks.length === 2 ? [
      {
        m: [Number(clicks[0].m[0].toFixed(3)), Number(clicks[0].m[1].toFixed(3))],
        px: [Math.round(clicks[0].px[0]), Math.round(clicks[0].px[1])],
      },
      {
        m: [Number(clicks[1].m[0].toFixed(3)), Number(clicks[1].m[1].toFixed(3))],
        px: [Math.round(clicks[1].px[0]), Math.round(clicks[1].px[1])],
      },
    ] : null;
    const yaml = calibration
      ? `calibration:\n  - m: [${calibration[0].m[0]}, ${calibration[0].m[1]}]\n    px: [${calibration[0].px[0]}, ${calibration[0].px[1]}]\n  - m: [${calibration[1].m[0]}, ${calibration[1].m[1]}]\n    px: [${calibration[1].px[0]}, ${calibration[1].px[1]}]`
      : '';

    el.innerHTML = `
      <b>Calibration mode</b><br>
      Click two known points on the map image. At each click, the card stores the clicked image pixel and the mower's current RTK X/Y position.<br>
      Points selected: <b>${clicks.length}/2</b>
      ${clicks.map((p, i) => `<br>Point ${i + 1}: m=[${p.m[0].toFixed(3)}, ${p.m[1].toFixed(3)}], px=[${Math.round(p.px[0])}, ${Math.round(p.px[1])}]`).join('')}
      ${yaml ? `<pre>${yaml}</pre><button type="button" class="nm-apply-cal">Apply calibration</button><button type="button" class="nm-reset-cal">Reset points</button>` : `<br><button type="button" class="nm-reset-cal">Reset points</button>`}
      <br><small>Apply calibration updates the card config when Home Assistant is listening for custom-card config changes, typically while editing the card. On a normal dashboard view, use the displayed YAML if the Apply button is not persisted.</small>
    `;

    const apply = el.querySelector('.nm-apply-cal');
    if (apply && calibration) {
      apply.onclick = () => {
        const cfg = JSON.parse(JSON.stringify(this._config || {}));
        cfg.calibration = calibration;
        cfg.calibration_mode = false;
        this._config = cfg;
        this._cal = this._solveCalibration(cfg.calibration);
        this.dispatchEvent(new CustomEvent('config-changed', {
          detail: { config: cfg },
          bubbles: true,
          composed: true,
        }));
        this._updateCalibrationUi();
        this._update();
      };
    }

    const reset = el.querySelector('.nm-reset-cal');
    if (reset) {
      reset.onclick = () => {
        this._calibrationClicks = [];
        this._updateCalibrationUi();
        this._update();
      };
    }
  }

  _screenToWorld(clientX, clientY) {
    const [sx, sy] = this._screenToSvgPoint(clientX, clientY);
    const d = this._lastDraw;
    if (!d) return null;
    const wx = d.x0 + sx / d.k;
    const wy = d.upright ? (d.y0 + sy / d.k) : (d.y0 + (d.V - sy) / d.k);
    return [wx, wy];
  }

  _handleCalibrationClick(e) {
    if (!this._config.calibration_mode || !this._lastDraw || !this._lastDraw.overlayReady) return false;
    const c = this._resolvedConfig();
    const x = this._num(c.x_entity);
    const y = this._num(c.y_entity);
    if (x === null || y === null) return false;

    const world = this._screenToWorld(e.clientX, e.clientY);
    if (!world) return false;

    let px = world;
    if (!this._lastDraw.upright) {
      // In mower-frame view, click world coordinates are mower meters; convert to image pixels.
      if (!this._cal) return false;
      px = this._mToPx(world[0], world[1]);
    }

    this._calibrationClicks.push({ m: [x, y], px });
    this._calibrationClicks = this._calibrationClicks.slice(-2);
    this._updateCalibrationUi();
    this._update();
    return true;
  }

  _channelBoxes() {
    const c = this._config;
    const entities = Array.isArray(c.channel_entities) ? c.channel_entities : (c.channel_entity ? [c.channel_entity] : []);
    if (!this._hass || !entities.length) return [];
    const boxes = [];
    for (const entity of entities) {
      const st = this._hass.states[entity];
      if (!st || !st.attributes) continue;
      const a = st.attributes;
      const x1 = parseFloat(a.x_min), x2 = parseFloat(a.x_max);
      const y1 = parseFloat(a.y_min), y2 = parseFloat(a.y_max);
      if ([x1, x2, y1, y2].some(v => isNaN(v))) continue;
      boxes.push({ entity, name: a.channel_name || entity, x_min: Math.min(x1, x2), x_max: Math.max(x1, x2), y_min: Math.min(y1, y2), y_max: Math.max(y1, y2) });
    }
    return boxes;
  }

  _applyViewBox() {
    const svg = this.querySelector('svg.nm-map');
    const mwrSvg = this.querySelector('svg.nm-mwr');
    if (!svg || !mwrSvg) return;
    const V = 1000;
    const scale = Math.max(1, Math.min(12, this._zoom?.scale || 1));
    const size = V / scale, half = size / 2;
    let cx = this._zoom?.cx ?? 500, cy = this._zoom?.cy ?? 500;
    cx = Math.max(half, Math.min(V - half, cx));
    cy = Math.max(half, Math.min(V - half, cy));
    this._zoom = { scale, cx, cy };
    const vb = `${(cx - half).toFixed(2)} ${(cy - half).toFixed(2)} ${size.toFixed(2)} ${size.toFixed(2)}`;
    svg.setAttribute('viewBox', vb);
    mwrSvg.setAttribute('viewBox', vb);
  }

  _screenToSvgPoint(clientX, clientY) {
    const wrap = this.querySelector('.nm-wrap');
    if (!wrap) return [500, 500];
    const rect = wrap.getBoundingClientRect();
    const V = 1000;
    const scale = Math.max(1, Math.min(12, this._zoom?.scale || 1));
    const size = V / scale, half = size / 2;
    const left = (this._zoom?.cx ?? 500) - half;
    const top = (this._zoom?.cy ?? 500) - half;
    const rx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ry = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return [left + rx * size, top + ry * size];
  }

  _zoomAt(factor, clientX, clientY) {
    if (!this._config.enable_zoom) return;
    const wrap = this.querySelector('.nm-wrap');
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const V = 1000;
    const oldScale = Math.max(1, Math.min(12, this._zoom?.scale || 1));
    const oldSize = V / oldScale;
    const [sx, sy] = this._screenToSvgPoint(clientX, clientY);
    const newScale = Math.max(1, Math.min(12, oldScale * factor));
    const newSize = V / newScale;
    const rx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ry = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    this._zoom = { scale: newScale, cx: sx - rx * newSize + newSize / 2, cy: sy - ry * newSize + newSize / 2 };
    this._applyViewBox();
  }

  _bindGestures() {
    if (!this._config || !this._config.enable_zoom) return;
    const wrap = this.querySelector('.nm-wrap');
    if (!wrap || wrap._nmZoomBound) return;
    wrap._nmZoomBound = true;
    wrap.addEventListener('wheel', e => {
      e.preventDefault();
      this._zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX, e.clientY);
    }, { passive: false });
    wrap.addEventListener('dblclick', e => {
      e.preventDefault();
      this._zoom = { scale: 1, cx: 500, cy: 500 };
      this._applyViewBox();
    });
    wrap.addEventListener('pointerdown', e => {
      if (this._config.calibration_mode && this._handleCalibrationClick(e)) {
        e.preventDefault();
        return;
      }
      wrap.setPointerCapture(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size === 1) this._panStart = { x: e.clientX, y: e.clientY, cx: this._zoom.cx, cy: this._zoom.cy, scale: this._zoom.scale };
      if (this._pointers.size === 2) {
        const pts = Array.from(this._pointers.values());
        this._pinchStart = { dist: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1, scale: this._zoom.scale, cx: this._zoom.cx, cy: this._zoom.cy };
      }
    });
    wrap.addEventListener('pointermove', e => {
      if (!this._pointers.has(e.pointerId)) return;
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const rect = wrap.getBoundingClientRect(), V = 1000;
      if (this._pointers.size === 1 && this._panStart && this._zoom.scale > 1) {
        const size = V / this._panStart.scale;
        this._zoom = { scale: this._panStart.scale, cx: this._panStart.cx - (e.clientX - this._panStart.x) / rect.width * size, cy: this._panStart.cy - (e.clientY - this._panStart.y) / rect.height * size };
        this._applyViewBox();
      } else if (this._pointers.size === 2 && this._pinchStart) {
        const pts = Array.from(this._pointers.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
        const midX = (pts[0].x + pts[1].x) / 2, midY = (pts[0].y + pts[1].y) / 2;
        this._zoom = { scale: this._pinchStart.scale, cx: this._pinchStart.cx, cy: this._pinchStart.cy };
        this._zoomAt(dist / this._pinchStart.dist, midX, midY);
      }
    });
    const end = e => {
      this._pointers.delete(e.pointerId);
      this._panStart = null; this._pinchStart = null;
      if (this._pointers.size === 1) {
        const pt = Array.from(this._pointers.values())[0];
        this._panStart = { x: pt.x, y: pt.y, cx: this._zoom.cx, cy: this._zoom.cy, scale: this._zoom.scale };
      }
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
    wrap.addEventListener('pointerleave', end);
  }


  _entityObjectId(entityId) {
    if (!entityId || typeof entityId !== 'string') return null;
    const parts = entityId.split('.');
    return parts.length === 2 ? parts[1] : null;
  }

  _entityExists(entityId) {
    return !!(entityId && this._hass && this._hass.states && this._hass.states[entityId]);
  }

  _firstExisting(candidates) {
    if (!this._hass || !this._hass.states) return candidates.find(Boolean) || null;
    return candidates.find((entityId) => this._entityExists(entityId)) || candidates.find(Boolean) || null;
  }

  _findEntityBySuffix(domain, slug, suffixes) {
    if (!slug) return null;
    const direct = suffixes.map(suffix => `${domain}.${slug}_${suffix}`);
    const foundDirect = this._firstExisting(direct);
    if (foundDirect && this._entityExists(foundDirect)) return foundDirect;

    if (!this._hass || !this._hass.states) return direct[0] || null;
    const ids = Object.keys(this._hass.states).filter(id => id.startsWith(`${domain}.`));
    for (const suffix of suffixes) {
      const exactEnd = `_${suffix}`;
      const found = ids.find(id => id.endsWith(exactEnd) && id.includes(slug));
      if (found) return found;
    }
    return direct[0] || null;
  }

  _resolvedConfig() {
    const c = Object.assign({}, this._config || {});
    const mowerEntity = c.mower_entity || c.status_entity || null;
    const slug = this._entityObjectId(mowerEntity);
    const auto = c.auto_entities !== false && !!slug;

    if (auto) {
      c.status_entity = c.status_entity || mowerEntity;
      c.x_entity = c.x_entity || this._findEntityBySuffix('sensor', slug, ['position_x']);
      c.y_entity = c.y_entity || this._findEntityBySuffix('sensor', slug, ['position_y']);
      c.heading_entity = c.heading_entity || this._findEntityBySuffix('sensor', slug, ['heading']);
      c.zone_entity = c.zone_entity || this._findEntityBySuffix('sensor', slug, ['mowing_zone', 'zone']);
      c.battery_entity = c.battery_entity || this._findEntityBySuffix('sensor', slug, ['battery']);
      c.dock_x_entity = c.dock_x_entity || this._findEntityBySuffix('sensor', slug, ['dock_x']);
      c.dock_y_entity = c.dock_y_entity || this._findEntityBySuffix('sensor', slug, ['dock_y']);
    }

    c.status_entity = c.status_entity || mowerEntity;
    return c;
  }

  _num(entity) {
    if (!entity || !this._hass) return null;
    const s = this._hass.states[entity];
    if (!s) return null;
    const v = parseFloat(s.state);
    return isNaN(v) ? null : v;
  }

  // Evenly thin the trail to the cap so long sessions keep their full shape
  // (always keeps the final point).
  _decimate(pts, cap) {
    let out = pts;
    while (out.length > cap) {
      const last = out[out.length - 1];
      out = out.filter((_, i) => i % 2 === 0);
      if (out[out.length - 1] !== last) out.push(last);
    }
    return out;
  }




  _appearanceConfig() {
    const a = this._config.appearance || {};
    const channel = a.channel || {};
    const robot = a.robot || {};
    const dock = a.dock || {};
    return {
      channel: {
        fill: channel.fill || this._config.channel_fill || 'rgba(244, 67, 54, 0.35)',
        stroke: channel.stroke || this._config.channel_stroke || 'rgba(244, 67, 54, 0.80)',
        width: Number.isFinite(Number(channel.width)) ? Number(channel.width) : 2.5,
      },
      robot: {
        scale: Number.isFinite(Number(robot.scale)) ? Number(robot.scale) : 1.0,
      },
      dock: {
        scale: Number.isFinite(Number(dock.scale)) ? Number(dock.scale) : 1.0,
        icon: dock.icon || 'mdi:lightning-bolt-circle',
      },
      trails: a.trails || this._config.trails || {},
    };
  }

  _trailConfig() {
    const t = this._appearanceConfig().trails || {};
    const active = t.active || {};
    const previous = t.previous || {};
    const prevOpacity = previous.opacity || {};
    return {
      active: {
        color: active.color || 'var(--primary-color)',
        opacity: Number.isFinite(Number(active.opacity)) ? Number(active.opacity) : 0.70,
        width: Number.isFinite(Number(active.width)) ? Number(active.width) : 5.2,
      },
      previous: {
        color: previous.color || 'var(--secondary-text-color)',
        width: Number.isFinite(Number(previous.width)) ? Number(previous.width) : 5.2,
        opacityFirst: Number.isFinite(Number(prevOpacity.first)) ? Number(prevOpacity.first) : 0.46,
        opacityLast: Number.isFinite(Number(prevOpacity.last)) ? Number(prevOpacity.last) : 0.12,
      },
      fadeMode: (t.fade_mode || 'linear').toString().toLowerCase(),
    };
  }

  _historyTrailOpacity(ageFromNewest, historyCount, cfg) {
    if (historyCount <= 1) return cfg.previous.opacityFirst;
    const first = cfg.previous.opacityFirst;
    const last = cfg.previous.opacityLast;
    const t = Math.max(0, Math.min(1, (historyCount - 1 - ageFromNewest) / (historyCount - 1)));

    if (cfg.fadeMode === 'exponential') {
      const curved = Math.pow(t, 2.2);
      return last + (first - last) * curved;
    }

    return last + (first - last) * t;
  }

  _sessionFilterConfig() {
    const f = this._config.session_filter || {};
    const mode = (f.mode || 'count').toString().toLowerCase();
    return {
      mode: ['count', 'today', 'today_or_count'].includes(mode) ? mode : 'count',
      resetTime: f.reset_time || '03:00',
    };
  }

  _parseResetTime(resetTime) {
    const m = String(resetTime || '03:00').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return { h: 3, min: 0 };
    return {
      h: Math.max(0, Math.min(23, parseInt(m[1], 10))),
      min: Math.max(0, Math.min(59, parseInt(m[2], 10))),
    };
  }

  _sessionFilterStartMs(nowMs = Date.now()) {
    const f = this._sessionFilterConfig();
    if (f.mode === 'count') return null;
    const now = new Date(nowMs);
    const { h, min } = this._parseResetTime(f.resetTime);
    const start = new Date(now);
    start.setHours(h, min, 0, 0);
    if (now.getTime() < start.getTime()) start.setDate(start.getDate() - 1);
    return start.getTime();
  }


  _historyViewConfig() {
    const h = this._config.history_view || {};
    return {
      enabled: !!h.enabled,
      daysBack: Math.max(0, Math.min(31, Number.isFinite(Number(h.days_back)) ? Number(h.days_back) : 4)),
      showLiveMarkerWhenHistory: !!h.show_live_marker_when_history,
    };
  }

  _isPastHistoryView() {
    return this._historyViewConfig().enabled && (this._historyDayOffset || 0) > 0;
  }

  _historyWindowMs(offset = 0, nowMs = Date.now()) {
    const f = this._sessionFilterConfig();
    const { h, min } = this._parseResetTime(f.resetTime);
    const now = new Date(nowMs);
    const start = new Date(now);
    start.setHours(h, min, 0, 0);
    if (now.getTime() < start.getTime()) start.setDate(start.getDate() - 1);
    start.setDate(start.getDate() - Math.max(0, offset || 0));
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const startMs = start.getTime();
    const endMs = offset > 0 ? end.getTime() : nowMs;
    return { start: startMs, end: endMs };
  }

  _sessionWindowMs() {
    const history = this._historyViewConfig();
    if (history.enabled) return this._historyWindowMs(this._historyDayOffset || 0);
    const start = this._sessionFilterStartMs();
    return start === null ? null : { start, end: null };
  }

  _historyLabel(offset) {
    if (offset === 0) return 'Today';
    if (offset === 1) return 'Yesterday';
    return `${offset} days ago`;
  }

  _renderHistoryControls() {
    const el = this.querySelector('.nm-history');
    if (!el) return;
    const cfg = this._historyViewConfig();
    if (!cfg.enabled) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    el.style.display = 'flex';
    const max = cfg.daysBack;
    const buttons = [];
    for (let i = 0; i <= max; i++) {
      buttons.push(`<button type="button" data-history-offset="${i}" class="${i === (this._historyDayOffset || 0) ? 'active' : ''}">${this._historyLabel(i)}</button>`);
    }
    el.innerHTML = buttons.join('');
  }

  _setHistoryDayOffset(offset) {
    const cfg = this._historyViewConfig();
    const next = Math.max(0, Math.min(cfg.daysBack, Number(offset) || 0));
    if (next === (this._historyDayOffset || 0)) return;
    this._historyDayOffset = next;
    this._histLoaded = false;
    this._sessions = [];
    this._trail = [];
    this._currentSessionStart = null;
    this._lastKey = null;
    this._renderHistoryControls();
    if (this._hass) this._loadSessionHistory();
    this._update();
  }

  _filterAndLimitSessions(sessions) {
    const c = this._config || {};
    const f = this._sessionFilterConfig();
    const history = this._historyViewConfig();
    let out = (sessions || []).filter(s => s && s.points && s.points.length);
    const window = this._sessionWindowMs();
    if (window && window.start !== null && window.start !== undefined) {
      out = out.filter(s => !s.start || s.start >= window.start);
    }
    if (window && window.end !== null && window.end !== undefined) {
      out = out.filter(s => !s.start || s.start < window.end);
    }
    if (!history.enabled && (f.mode === 'count' || f.mode === 'today_or_count')) {
      out = out.slice(-Math.max(0, c.session_count || 0));
    }
    if (history.enabled && (this._historyDayOffset || 0) === 0 && f.mode === 'today_or_count') {
      out = out.slice(-Math.max(0, c.session_count || 0));
    }
    return out;
  }

  _formatSessionTime(ms) {
    if (!ms) return '—';
    try {
      return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '—';
    }
  }

  _sessionGapMs() {
    // If Recorder does not contain clean mower state intervals, split
    // historical trails by long gaps between X/Y samples. This makes previous
    // days visible even if HA restarted or the mower resumed an already running
    // task during the selected day.
    return Math.max(5, Number(this._config.session_gap_minutes || 20)) * 60 * 1000;
  }

  _sessionInterruptGraceMs() {
    // Short HA unavailable/unknown blips are common when an integration reloads
    // or reconnects. Do not let a 1-2 second state flap split one mowing cycle
    // into multiple history sessions.
    return Math.max(0, Number(this._config.session_interrupt_grace_minutes ?? 5)) * 60 * 1000;
  }

  _cleanHistoryStateEvents(st) {
    const raw = (st || [])
      .map(ev => ({ t: this._historyEventTime(ev), state: ev && ev.s }))
      .filter(ev => ev.t !== null && ev.state !== null && ev.state !== undefined)
      .sort((a, b) => a.t - b.t);

    const cleaned = [];
    const transientStates = new Set(['unavailable', 'unknown']);
    const grace = this._sessionInterruptGraceMs();

    for (let i = 0; i < raw.length; i++) {
      const ev = raw[i];
      if (transientStates.has(ev.state)) {
        let j = i + 1;
        while (j < raw.length && transientStates.has(raw[j].state)) j++;
        const next = raw[j] || null;
        const prev = cleaned.length ? cleaned[cleaned.length - 1] : null;
        const duration = next ? (next.t - ev.t) : Number.POSITIVE_INFINITY;

        // Skip short unavailable/unknown periods. The next real state will
        // restore the entity state, and duplicate same-state events are merged
        // below. This fixes mowing -> unavailable -> mowing being counted as
        // two sessions.
        if (duration <= grace && (prev || next)) continue;
      }

      const last = cleaned.length ? cleaned[cleaned.length - 1] : null;
      if (last && last.state === ev.state) continue;
      cleaned.push(ev);
    }
    return cleaned;
  }

  _updateTrailLegend(drawSessions, trailCfg) {
    const el = this.querySelector('.nm-legend');
    if (!el) return;
    if (!this._config.trail_legend) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    const sessions = (drawSessions || []).filter(s => s.points && s.points.length > 1);
    if (!sessions.length) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    const historyCount = Math.max(0, sessions.length - 1);
    el.style.display = 'block';
    el.innerHTML = sessions.map((sess, idx) => {
      const isCurrent = idx === sessions.length - 1;
      const ageFromNewest = sessions.length - 1 - idx;
      const opacity = isCurrent ? trailCfg.active.opacity : this._historyTrailOpacity(ageFromNewest, historyCount, trailCfg);
      const color = isCurrent ? trailCfg.active.color : trailCfg.previous.color;
      const label = isCurrent ? `Current (${this._formatSessionTime(sess.start)})` : this._formatSessionTime(sess.start);
      return `<span class="nm-legend-row"><span class="nm-legend-swatch" style="background:${color};opacity:${Math.max(0, Math.min(1, opacity)).toFixed(2)}"></span>${label}</span>`;
    }).join('');
  }

  _zoneName(zone) {
    const names = this._config.zone_names || {};
    if (zone === null || zone === undefined || zone === 'unknown' || zone === 'unavailable') return '—';
    return names[String(zone)] || zone;
  }

  _startNewSession() {
    if (this._trail && this._trail.length) {
      this._sessions.push({ points: this._trail, start: this._currentSessionStart || Date.now() });
      this._sessions = this._filterAndLimitSessions(this._sessions).slice(-Math.max(0, this._config.session_count - 1));
    }
    this._trail = [];
    this._currentSessionStart = Date.now();
    this._lastKey = null;
  }

  _bindControls() {
    if (!this._config || !this._config.show_controls) return;
    const controls = this.querySelector('.nm-controls');
    if (!controls || controls._bound) return;
    controls._bound = true;
    controls.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn || !this._hass) return;
      const entity_id = this._resolvedConfig().status_entity;
      const action = btn.dataset.action;
      if (action === 'mow') this._hass.callService('lawn_mower', 'start_mowing', { entity_id });
      if (action === 'pause') this._hass.callService('lawn_mower', 'pause', { entity_id });
      if (action === 'dock') this._hass.callService('lawn_mower', 'dock', { entity_id });
    });
  }


  _bindHistoryControls() {
    const host = this;
    if (this._historyControlsBound) return;
    this._historyControlsBound = true;
    this.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('button[data-history-offset]') : null;
      if (!btn || !host.contains(btn)) return;
      e.preventDefault();
      host._setHistoryDayOffset(parseInt(btn.dataset.historyOffset, 10));
    });
  }

  _historyEventTime(ev) {
    if (!ev) return null;
    let v = ev.lu ?? ev.lc ?? ev.last_updated ?? ev.last_changed ?? ev.last_updated_time ?? ev.last_changed_time;
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') {
      // HA history may return seconds in some compact responses and
      // milliseconds in others. Normalize to milliseconds.
      return v < 1000000000000 ? v * 1000 : v;
    }
    if (typeof v === 'string') {
      const n = Number(v);
      if (Number.isFinite(n)) return n < 1000000000000 ? n * 1000 : n;
      const d = Date.parse(v);
      return Number.isFinite(d) ? d : null;
    }
    return null;
  }

  // Rebuild recent session paths from HA's recorder.
  async _loadSessionHistory() {
    const c = this._resolvedConfig(), hass = this._hass;
    try {
      const historyCfg = this._historyViewConfig();
      const selectedWindow = this._sessionWindowMs();
      const filterStartMs = selectedWindow ? selectedWindow.start : null;
      const filterEndMs = selectedWindow ? selectedWindow.end : null;

      // For history day selector we fetch exactly the selected mowing day, plus
      // a small lookback so we can infer whether a mower was already mowing at
      // the day boundary. For count mode, keep the old history_hours behavior.
      let requestStartMs;
      let requestEndMs;
      if (historyCfg.enabled && filterStartMs !== null) {
        requestStartMs = filterStartMs - 2 * 3600e3;
        requestEndMs = filterEndMs || Date.now();
      } else {
        const historyStartMs = Date.now() - (c.history_hours || 24) * 3600e3;
        requestStartMs = filterStartMs === null ? historyStartMs : Math.min(historyStartMs, filterStartMs - 2 * 3600e3);
        requestEndMs = filterEndMs || Date.now();
      }

      const historyEntities = [c.status_entity, c.x_entity, c.y_entity].filter(Boolean);
      if (historyEntities.length < 3) return;
      const r = await hass.callWS({
        type: 'history/history_during_period',
        start_time: new Date(requestStartMs).toISOString(),
        end_time: new Date(requestEndMs).toISOString(),
        entity_ids: historyEntities,
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      const st = (r && r[c.status_entity]) || [];
      const xs = (r && r[c.x_entity]) || [];
      const ys = (r && r[c.y_entity]) || [];

      // Build paired X/Y points from recorder history.
      const allPts = [];
      let yi = 0, lastY = null;
      for (const ex of xs) {
        const x = parseFloat(ex.s);
        while (yi < ys.length && this._historyEventTime(ys[yi]) !== null && this._historyEventTime(ys[yi]) <= this._historyEventTime(ex)) {
          const v = parseFloat(ys[yi].s);
          if (!isNaN(v)) lastY = v;
          yi++;
        }
        if (!isNaN(x) && lastY !== null) {
          const t = this._historyEventTime(ex);
          if (t !== null && (filterStartMs === null || t >= filterStartMs) && (filterEndMs === null || filterEndMs === undefined || t < filterEndMs)) {
            allPts.push({ t, p: [x, lastY] });
          }
        }
      }

      // Fallback for HA history variants where X and Y updates are not aligned
      // in the compact response. Pair each X with the latest known Y, and if that
      // still produced no points, pair nearest X/Y updates within a short window.
      if (!allPts.length && xs.length && ys.length) {
        const xEvents = xs.map(e => ({ t: this._historyEventTime(e), v: parseFloat(e.s) }))
          .filter(e => e.t !== null && !isNaN(e.v));
        const yEvents = ys.map(e => ({ t: this._historyEventTime(e), v: parseFloat(e.s) }))
          .filter(e => e.t !== null && !isNaN(e.v));
        let j = 0;
        for (const xe of xEvents) {
          while (j + 1 < yEvents.length && yEvents[j + 1].t <= xe.t) j++;
          const candidates = [yEvents[j], yEvents[j + 1]].filter(Boolean);
          let best = null;
          for (const ye of candidates) {
            if (!best || Math.abs(ye.t - xe.t) < Math.abs(best.t - xe.t)) best = ye;
          }
          if (best && Math.abs(best.t - xe.t) <= 5 * 60 * 1000) {
            const t = Math.max(xe.t, best.t);
            if ((filterStartMs === null || t >= filterStartMs) && (filterEndMs === null || filterEndMs === undefined || t < filterEndMs)) {
              allPts.push({ t, p: [xe.v, best.v] });
            }
          }
        }
      }

      // Prefer explicit mowing intervals from the lawn_mower entity, but clean
      // the state history first. Home Assistant/integration reloads can create
      // very short mowing -> unavailable -> mowing blips; those are not real
      // mowing cycles and should not become separate legend entries.
      const intervals = [];
      const stateEvents = this._cleanHistoryStateEvents(st);
      let currentStart = null;
      const closingStates = new Set(['docked', 'idle', 'error', 'unavailable', 'unknown']);

      for (const ev of stateEvents) {
        const t = ev.t;
        const state = ev.state;

        if (state === 'mowing' && currentStart === null) {
          currentStart = t;
          continue;
        }

        // Do not split a cycle on paused/returning. A cycle is considered over
        // when the mower reaches docked/idle or when a long unavailable/error
        // period starts.
        if (currentStart !== null && closingStates.has(state)) {
          if (t > currentStart) intervals.push({ start: currentStart, end: t });
          currentStart = null;
        }
      }
      if (currentStart !== null) {
        intervals.push({ start: currentStart, end: requestEndMs });
      }

      let sessions = [];
      for (const interval of intervals) {
        const start = Math.max(interval.start, filterStartMs || interval.start);
        const end = filterEndMs ? Math.min(interval.end, filterEndMs) : interval.end;
        const pts = allPts.filter(o => o.t >= start && o.t < end).map(o => o.p);
        if (pts.length > 1) sessions.push({ points: this._decimate(pts, c.trail_length), start });
      }

      // Fallback: if state transitions are incomplete, group all X/Y points by
      // time gaps. This is what makes older history days show up reliably.
      if (!sessions.length && allPts.length > 1) {
        let group = [];
        let groupStart = allPts[0].t;
        const gap = this._sessionGapMs();
        for (let i = 0; i < allPts.length; i++) {
          const item = allPts[i];
          if (group.length && item.t - allPts[i - 1].t > gap) {
            if (group.length > 1) sessions.push({ points: this._decimate(group.map(o => o.p), c.trail_length), start: groupStart });
            group = [];
            groupStart = item.t;
          }
          group.push(item);
        }
        if (group.length > 1) sessions.push({ points: this._decimate(group.map(o => o.p), c.trail_length), start: groupStart });
      }

      if (sessions.length) {
        const filtered = this._filterAndLimitSessions(sessions);
        if (historyCfg.enabled && (this._historyDayOffset || 0) > 0) {
          this._sessions = filtered;
          this._trail = [];
          this._currentSessionStart = null;
        } else {
          const newest = filtered[filtered.length - 1];
          this._sessions = this._filterAndLimitSessions(filtered.slice(0, -1)).slice(-Math.max(0, c.session_count - 1));
          if (newest) {
            this._currentSessionStart = newest.start || this._currentSessionStart;
            this._trail = this._decimate(newest.points.concat(this._trail), c.trail_length);
          }
        }
        this._lastKey = null;
      } else if (historyCfg.enabled && (this._historyDayOffset || 0) > 0) {
        this._sessions = [];
        this._trail = [];
        this._currentSessionStart = null;
      }
      this._update();
    } catch (e) {
      // recorder disabled or entities excluded -> live-only trail
      // Keep this quiet in normal dashboards; bad recorder config should not
      // break the card.
    }
  }

  _update() {
    if (!this._hass || !this._config) return;
    const c = this._resolvedConfig();
    const controls = this.querySelector('.nm-controls');
    if (controls) controls.style.display = c.show_controls ? 'grid' : 'none';
    const currentFilterStart = this._sessionFilterStartMs();
    if (currentFilterStart !== null && this._lastSessionFilterStart !== null && currentFilterStart > this._lastSessionFilterStart) {
      this._sessions = [];
      this._trail = [];
      this._currentSessionStart = null;
      this._lastKey = null;
    }
    this._lastSessionFilterStart = currentFilterStart;
    this._renderHistoryControls();
    this._updateCalibrationUi();
    const x = this._num(c.x_entity);
    const y = this._num(c.y_entity);
    const headingDeg = this._num(c.heading_entity);
    const rawZone = c.zone_entity && this._hass.states[c.zone_entity] ? this._hass.states[c.zone_entity].state : '—';
    const zone = this._zoneName(rawZone);
    const stObj = c.status_entity ? this._hass.states[c.status_entity] : null;
    const status = stObj ? stObj.state : '—';
    // Raw mower status for dock learning. The lawn_mower entity STATE maps
    // 'idle' to 'docked' (activity), so a mower stopped mid-lawn would look
    // docked and poison the dock estimate — prefer the raw 'status' attribute.
    const rawStatus = stObj ? ((stObj.attributes && stObj.attributes.status) || stObj.state) : '';
    const batt = c.battery_entity ? this._num(c.battery_entity) : null;

    // new mowing session (docked -> mowing) -> reset the path
    if (!this._isPastHistoryView() && this._prevState === 'docked' && status === 'mowing') {
      this._startNewSession();
    }
    this._prevState = status;

    if (!this._isPastHistoryView() && x !== null && y !== null) {
      const key = x.toFixed(3) + ',' + y.toFixed(3);
      if (!this._currentSessionStart) this._currentSessionStart = Date.now();
      if (key !== this._lastKey) {
        this._trail.push([x, y]);
        this._lastKey = key;
        if (this._trail.length > c.trail_length)
          this._trail = this._decimate(this._trail, c.trail_length);
      }
    }

    // integration dock sensors (server-side learned, persisted in HA)
    const sensorDockX = this._num(c.dock_x_entity);
    const sensorDockY = this._num(c.dock_y_entity);
    const haveSensorDock = sensorDockX !== null && sensorDockY !== null;

    // local auto-learn fallback: average position while docked/charging
    // (skipped when the integration provides dock sensors)
    if (!haveSensorDock && (c.dock_x === null || c.dock_y === null)) {
      const docked = /^(docked|charging)$/i.test(rawStatus);
      if (docked && x !== null && y !== null) {
        this._dockBuf.push([x, y]);
        if (this._dockBuf.length > c.dock_samples) this._dockBuf.shift();
        const n = this._dockBuf.length;
        this._dock = [
          this._dockBuf.reduce((a, p) => a + p[0], 0) / n,
          this._dockBuf.reduce((a, p) => a + p[1], 0) / n,
        ];
        try { localStorage.setItem(this._dockKey, JSON.stringify(this._dock)); } catch (e) {}
      } else if (!docked && this._dockBuf.length) {
        this._dockBuf = [];
      }
    }

    this.querySelector('.nm-hdr').textContent = c.title;
    const parts = [
      `Zone: <b>${zone}</b>`,
      `Status: <b>${status}</b>`,
      (x !== null && y !== null) ? `Pos: <b>${x.toFixed(1)}, ${y.toFixed(1)} m</b>` : `Pos: <b>—</b>`,
    ];
    if (batt !== null) parts.push(`Battery: <b>${batt}%</b>`);
    if (this._historyViewConfig().enabled) parts.push(`View: <b>${this._historyLabel(this._historyDayOffset || 0)}</b>`);
    this.querySelector('.nm-ftr').innerHTML = parts.join('');

    const dock = (c.dock_x !== null && c.dock_y !== null)
      ? [c.dock_x, c.dock_y]
      : haveSensorDock
        ? [sensorDockX, sensorDockY]
        : (this._dock || [0, 0]);
    const showLiveInHistory = !this._isPastHistoryView() || this._historyViewConfig().showLiveMarkerWhenHistory;
    this._draw(showLiveInHistory ? x : null, showLiveInHistory ? y : null, showLiveInHistory ? headingDeg : null, dock);
  }

  _backgroundImage(c = null) {
    const cfg = c || this._resolvedConfig();
    return cfg.background_image || cfg.overlay_image || null;
  }

  _robotIconSource(appearance) {
    const robot = (appearance && appearance.robot) || {};
    const icon = robot.icon || null;

    if (icon && /^mdi:/i.test(icon)) {
      return { type: 'mdi', value: icon };
    }

    if (icon && (/^(https?:)?\/\//i.test(icon) || icon.startsWith('/'))) {
      return { type: 'image', value: icon };
    }

    const modelOrFile = (robot.model || icon || 'h2').toString().trim() || 'h2';
    if (/^(https?:)?\/\//i.test(modelOrFile) || modelOrFile.startsWith('/')) {
      return { type: 'image', value: modelOrFile };
    }

    const fileName = modelOrFile.toLowerCase().endsWith('.svg') ? modelOrFile : `${modelOrFile}.svg`;
    return { type: 'image', value: `${NAVIMOW_MAP_CARD_BASE_URL}icons/${fileName}` };
  }

  _draw(x, y, headingDeg, dock) {
    const svg = this.querySelector('svg.nm-map');
    const mwrSvg = this.querySelector('svg.nm-mwr');
    const c = this._resolvedConfig();
    const pts = this._trail;
    const V = 1000;

    const bgImage = this._backgroundImage(c);

    // lazy-load the background image to learn its pixel size
    if (bgImage && this._cal && !this._imgMeta && !this._imgLoading) {
      this._imgLoading = true;
      const im = new Image();
      im.onload = () => {
        this._imgMeta = { w: im.naturalWidth, h: im.naturalHeight };
        this._update();
      };
      im.onerror = () => { this._imgLoading = false; };
      im.src = bgImage;
    }
    const overlayReady = !!(this._imgMeta && this._cal);

    const historyPtsForEmptyCheck = (this._sessions || []).flatMap(sess => sess.points || []);
    if (!overlayReady && pts.length === 0 && historyPtsForEmptyCheck.length === 0 && (x === null || y === null)) {
      this._applyViewBox();
      svg.innerHTML = `<text x="${V/2}" y="${V/2}" fill="var(--secondary-text-color)" font-size="34" text-anchor="middle">Waiting for position…</text>`;
      this._updateTrailLegend([], this._trailConfig());
      return;
    }

    // Working space: with an overlay (and straighten on, the default) we draw
    // in IMAGE PIXEL space so the image stays upright and the trail rotates;
    // otherwise in mower meter space (y up).
    const upright = overlayReady && c.straighten !== false;
    const M2W = upright ? ((mx, my) => this._mToPx(mx, my)) : ((mx, my) => [mx, my]);

    // view extents: trail + dock + live pos (+ image corners when present)
    const historyPts = (this._sessions || []).flatMap(sess => sess.points || []);
    const allTrailPts = historyPts.concat(pts);
    const channelBoxes = this._channelBoxes();
    const channelCorners = [];
    for (const b of channelBoxes) channelCorners.push([b.x_min, b.y_min], [b.x_min, b.y_max], [b.x_max, b.y_min], [b.x_max, b.y_max]);
    const wpts = pts.map(p => M2W(p[0], p[1]));
    const wallpts = allTrailPts.concat(channelCorners).map(p => M2W(p[0], p[1]));
    const wdock = M2W(dock[0], dock[1]);
    const xs = wallpts.map(p => p[0]).concat([wdock[0]]);
    const ys = wallpts.map(p => p[1]).concat([wdock[1]]);
    let wpos = null;
    if (x !== null && y !== null) {
      wpos = M2W(x, y);
      xs.push(wpos[0]); ys.push(wpos[1]);
    }
    if (overlayReady) {
      const { w, h } = this._imgMeta;
      for (const [ix, iy] of [[0, 0], [w, 0], [0, h], [w, h]]) {
        const p = upright ? [ix, iy] : this._pxToM(ix, iy);
        xs.push(p[0]); ys.push(p[1]);
      }
    }
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    let size = Math.max(maxX - minX, maxY - minY, upright ? 50 : 2);
    size += size * (overlayReady ? 0.04 : 0.24); // padding
    const x0 = cx - size / 2, y0 = cy - size / 2;
    const k = V / size;
    const tx = wx => (wx - x0) * k;
    // image pixel y already points down; meter y points up and needs the flip
    const ty = upright ? (wy => (wy - y0) * k) : (wy => V - (wy - y0) * k);
    this._lastDraw = { x0, y0, k, V, upright, overlayReady };
    this._applyViewBox();

    let s = '';
    if (overlayReady && upright) {
      // axis-aligned image
      const { w, h } = this._imgMeta;
      s += `<image href="${bgImage}" x="${tx(0).toFixed(1)}" y="${ty(0).toFixed(1)}"
              width="${(w * k).toFixed(1)}" height="${(h * k).toFixed(1)}"
              opacity="${c.overlay_opacity}" preserveAspectRatio="none"/>`;
    } else if (overlayReady) {
      // mower-frame view: compose pixel->meter (calibration) with meter->screen
      const { ar, ai, br, bi } = this._cal;
      const A = k * ar, B = -k * ai, C = k * ai, D = k * ar;
      const E = k * (br - x0), F = V - k * (bi - y0);
      s += `<image href="${bgImage}" width="${this._imgMeta.w}" height="${this._imgMeta.h}"
              transform="matrix(${A} ${B} ${C} ${D} ${E} ${F})"
              opacity="${c.overlay_opacity}" preserveAspectRatio="none"/>`;
    }
    // Configured channel boxes from integration binary_sensor attributes.
    // Drawn below mower trails, above the optional overlay image.
    const appearance = this._appearanceConfig();
    for (const box of channelBoxes) {
      const p1 = M2W(box.x_min, box.y_min);
      const p2 = M2W(box.x_max, box.y_min);
      const p3 = M2W(box.x_max, box.y_max);
      const p4 = M2W(box.x_min, box.y_max);
      const d = `M${tx(p1[0]).toFixed(1)} ${ty(p1[1]).toFixed(1)} ` +
                `L${tx(p2[0]).toFixed(1)} ${ty(p2[1]).toFixed(1)} ` +
                `L${tx(p3[0]).toFixed(1)} ${ty(p3[1]).toFixed(1)} ` +
                `L${tx(p4[0]).toFixed(1)} ${ty(p4[1]).toFixed(1)} Z`;
      s += `<path d="${d}" fill="${appearance.channel.fill}" stroke="${appearance.channel.stroke}" stroke-width="${appearance.channel.width}" stroke-opacity="0.95"/>`;
    }

    // Calibration click markers.
    if (c.calibration_mode && this._calibrationClicks && this._calibrationClicks.length) {
      this._calibrationClicks.forEach((pt, i) => {
        let wp;
        if (upright) {
          wp = pt.px;
        } else {
          wp = this._pxToM(pt.px[0], pt.px[1]);
        }
        s += `<g transform="translate(${tx(wp[0]).toFixed(1)},${ty(wp[1]).toFixed(1)})">
                <circle r="12" fill="rgba(255,0,0,0.85)" stroke="white" stroke-width="3"/>
                <text x="18" y="8" font-size="28" fill="white" style="paint-order:stroke" stroke="rgba(0,0,0,0.8)" stroke-width="5">${i + 1}</text>
              </g>`;
      });
    }

    // Draw older sessions first, newest/current last so it stays on top.
    const trailCfg = this._trailConfig();
    let filteredHistory = this._filterAndLimitSessions(this._sessions || []);
    if (this._sessionFilterConfig().mode !== 'today') {
      filteredHistory = filteredHistory.slice(-Math.max(0, (this._config.session_count || 0) - 1));
    }
    const allSessions = this._isPastHistoryView()
      ? filteredHistory
      : filteredHistory.concat([{ points: pts, current: true, start: this._currentSessionStart }]);
    const drawSessions = allSessions.filter(sess => sess.points && sess.points.length > 1);
    const historyCount = Math.max(0, drawSessions.length - 1);
    this._updateTrailLegend(drawSessions, trailCfg);
    drawSessions.forEach((sess, idx) => {
      const sp = sess.points.map(p => M2W(p[0], p[1]));
      const d = sp.map((p, i) => `${i === 0 ? 'M' : 'L'}${tx(p[0]).toFixed(1)} ${ty(p[1]).toFixed(1)}`).join(' ');
      const isCurrent = idx === drawSessions.length - 1;
      const ageFromNewest = drawSessions.length - 1 - idx;
      const opacity = isCurrent
        ? trailCfg.active.opacity
        : this._historyTrailOpacity(ageFromNewest, historyCount, trailCfg);
      const stroke = isCurrent ? trailCfg.active.color : trailCfg.previous.color;
      const width = isCurrent ? trailCfg.active.width : trailCfg.previous.width;
      s += `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-opacity="${Math.max(0, Math.min(1, opacity)).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"/>`;
    });
    // dock marker (configured > auto-learned > origin fallback)
    const dockScale = Math.max(0.2, appearance.dock.scale || 1);
    const dockIconSize = 28 * dockScale;
    const dockIconColor = overlayReady ? 'white' : 'var(--secondary-text-color)';
    // Keep the dock icon centered on the dock. Earlier versions scaled the
    // vertical icon offset too, which made the icon drift away from the dock.
    s += `<g transform="translate(${tx(wdock[0]).toFixed(1)},${ty(wdock[1]).toFixed(1)})">
            <circle r="${(10 * dockScale).toFixed(1)}" fill="none" stroke="${dockIconColor}" stroke-width="${(3 * Math.sqrt(dockScale)).toFixed(1)}"/>
            <foreignObject x="${(-dockIconSize / 2).toFixed(1)}" y="${(-dockIconSize / 2).toFixed(1)}"
              width="${dockIconSize.toFixed(1)}" height="${dockIconSize.toFixed(1)}">
              <ha-icon icon="${appearance.dock.icon}" style="width:${dockIconSize.toFixed(1)}px;height:${dockIconSize.toFixed(1)}px;color:${dockIconColor};filter:${overlayReady ? 'drop-shadow(0 0 3px rgba(0,0,0,0.85))' : 'none'};"></ha-icon>
            </foreignObject>
          </g>`;
    svg.innerHTML = s;

    // Mower marker lives in the persistent overlay SVG so CSS transition survives
    // the main SVG's innerHTML rebuild. The group's transform is transitioned
    // (1.8s linear, matching the ~2s MQTT position interval) for smooth movement.
    if (wpos !== null) {
      const px = tx(wpos[0]), py = ty(wpos[1]);

      // Build mower icon content. Default model icons are loaded from dist/icons/*.svg.
      // The SVG should have the mower nose facing up. We rotate it to match heading.
      let mwrInner = '';
      let iconRot = 0;
      if (headingDeg !== null) {
        const rad = headingDeg * Math.PI / 180;
        let ux = Math.cos(rad), uy = -Math.sin(rad);
        if (upright) {
          const { ar, ai } = this._cal;
          const den = ar * ar + ai * ai;
          const dpr = (Math.cos(rad) * ar + Math.sin(rad) * ai) / den;
          const dpi = (Math.sin(rad) * ar - Math.cos(rad) * ai) / den;
          const n = Math.hypot(dpr, dpi) || 1;
          ux = dpr / n; uy = -dpi / n;
        }
        iconRot = Math.atan2(ux, -uy) * 180 / Math.PI;
      }
      const robotScale = Math.max(0.2, appearance.robot.scale || 1);
      const robotSource = this._robotIconSource(appearance);
      const robotW = 44 * robotScale;
      const robotH = 60 * robotScale;
      const mdiSize = 48 * robotScale;
      if (robotSource.type === 'mdi') {
        const color = overlayReady ? 'white' : 'var(--primary-text-color)';
        mwrInner += `
          <g transform="rotate(${iconRot.toFixed(1)})">
            <foreignObject x="${(-mdiSize / 2).toFixed(1)}" y="${(-mdiSize / 2).toFixed(1)}"
              width="${mdiSize.toFixed(1)}" height="${mdiSize.toFixed(1)}">
              <ha-icon icon="${robotSource.value}" style="width:${mdiSize.toFixed(1)}px;height:${mdiSize.toFixed(1)}px;color:${color};filter:${overlayReady ? 'drop-shadow(0 0 3px rgba(0,0,0,0.85))' : 'none'};"></ha-icon>
            </foreignObject>
          </g>`;
      } else {
        mwrInner += `
          <g transform="rotate(${iconRot.toFixed(1)})">
            <image
              href="${robotSource.value}"
              x="${(-robotW / 2).toFixed(1)}"
              y="${(-robotH / 2).toFixed(1)}"
              width="${robotW.toFixed(1)}"
              height="${robotH.toFixed(1)}"
              preserveAspectRatio="xMidYMid meet"
            />
          </g>`;
      }

      let grp = mwrSvg.querySelector('.nm-mwr-grp');
      if (!grp) {
        // First appearance: create element and set position instantly (no animation)
        grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        grp.setAttribute('class', 'nm-mwr-grp');
        mwrSvg.appendChild(grp);
        grp.style.transition = 'none';
        grp.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
        // Re-enable transition after layout so the NEXT update animates
        requestAnimationFrame(() => requestAnimationFrame(() => { grp.style.transition = ''; }));
      } else {
        grp.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
      }
      grp.innerHTML = mwrInner;
    } else {
      // No position — remove the marker
      const grp = mwrSvg.querySelector('.nm-mwr-grp');
      if (grp) grp.remove();
    }
  }

  getCardSize() { return 6; }
}


class NavimowMapCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = Object.assign({}, config || {});
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    else this._render();
  }

  _entitySelector(domain, multiple = false) {
    const sel = { entity: {} };
    if (domain) sel.entity.domain = domain;
    if (multiple) sel.entity.multiple = true;
    return sel;
  }

  _schema() {
    return [
      { name: 'title', label: 'Title', selector: { text: {} } },
      { name: 'mower_entity', label: 'Mower entity', selector: this._entitySelector('lawn_mower') },
      { name: 'auto_entities', label: 'Auto-detect Navimow sensors from mower entity', selector: { boolean: {} } },
      { name: 'status_entity', label: 'Mower entity override (advanced)', selector: this._entitySelector('lawn_mower') },
      { name: 'x_entity', label: 'Position X sensor', selector: this._entitySelector('sensor') },
      { name: 'y_entity', label: 'Position Y sensor', selector: this._entitySelector('sensor') },
      { name: 'heading_entity', label: 'Heading sensor', selector: this._entitySelector('sensor') },
      { name: 'zone_entity', label: 'Zone sensor', selector: this._entitySelector('sensor') },
      { name: 'battery_entity', label: 'Battery sensor', selector: this._entitySelector('sensor') },
      { name: 'show_controls', label: 'Show Mow / Pause / Dock buttons', selector: { boolean: {} } },
      { name: 'enable_zoom', label: 'Enable zoom and pan', selector: { boolean: {} } },
      { name: 'background_image', label: 'Background image path', selector: { text: {} } },
      { name: 'overlay_opacity', label: 'Overlay opacity', selector: { number: { min: 0, max: 1, step: 0.05, mode: 'box' } } },
      { name: 'straighten', label: 'Keep aerial photo upright (off = rotate the aerial image instead)', selector: { boolean: {} } },
      { name: 'calibration_mode', label: 'Calibration mode', selector: { boolean: {} } },
      { name: 'history_hours', label: 'Recorder history hours', selector: { number: { min: 1, max: 744, step: 1, mode: 'box' } } },
      { name: 'session_count', label: 'Session count', selector: { number: { min: 1, max: 50, step: 1, mode: 'box' } } },
      { name: 'session_gap_minutes', label: 'Split sessions after gap (minutes)', selector: { number: { min: 5, max: 180, step: 5, mode: 'box' } } },
      { name: 'session_interrupt_grace_minutes', label: 'Ignore unavailable blips shorter than (minutes)', selector: { number: { min: 0, max: 30, step: 1, mode: 'box' } } },
      { name: 'session_filter_mode', label: 'Session filter mode', selector: { select: { options: ['count', 'today', 'today_or_count'] } } },
      { name: 'session_filter_reset_time', label: 'Mowing day reset time', selector: { text: {} } },
      { name: 'trail_legend', label: 'Show trail legend', selector: { boolean: {} } },
      { name: 'history_view_enabled', label: 'Enable history day selector', selector: { boolean: {} } },
      { name: 'history_view_days_back', label: 'History days back', selector: { number: { min: 0, max: 31, step: 1, mode: 'box' } } },
      { name: 'history_view_show_live_marker', label: 'Show live mower marker on older days', selector: { boolean: {} } },
      { name: 'channel_entities', label: 'Channel binary sensors', selector: this._entitySelector('binary_sensor', true) },
      { name: 'active_trail_color', label: 'Active trail color', selector: { text: {} } },
      { name: 'active_trail_opacity', label: 'Active trail opacity', selector: { number: { min: 0, max: 1, step: 0.05, mode: 'box' } } },
      { name: 'active_trail_width', label: 'Active trail width', selector: { number: { min: 0.5, max: 20, step: 0.1, mode: 'box' } } },
      { name: 'previous_trail_color', label: 'Previous trail color', selector: { text: {} } },
      { name: 'previous_trail_width', label: 'Previous trail width', selector: { number: { min: 0.5, max: 20, step: 0.1, mode: 'box' } } },
      { name: 'previous_opacity_first', label: 'Previous opacity first', selector: { number: { min: 0, max: 1, step: 0.05, mode: 'box' } } },
      { name: 'previous_opacity_last', label: 'Previous opacity last', selector: { number: { min: 0, max: 1, step: 0.05, mode: 'box' } } },
      { name: 'fade_mode', label: 'Trail fade mode', selector: { select: { options: ['linear', 'exponential'] } } },
      { name: 'channel_fill', label: 'Channel fill', selector: { text: {} } },
      { name: 'channel_stroke', label: 'Channel stroke', selector: { text: {} } },
      { name: 'channel_width', label: 'Channel width', selector: { number: { min: 0.5, max: 20, step: 0.1, mode: 'box' } } },
      { name: 'robot_scale', label: 'Robot scale', selector: { number: { min: 0.2, max: 3, step: 0.1, mode: 'box' } } },
      { name: 'robot_model', label: 'Robot model icon (dist/icons/<model>.svg)', selector: { text: {} } },
      { name: 'robot_icon', label: 'Custom robot icon/path or mdi:*', selector: { text: {} } },
      { name: 'dock_scale', label: 'Dock scale', selector: { number: { min: 0.2, max: 3, step: 0.1, mode: 'box' } } },
      { name: 'dock_icon', label: 'Dock icon', selector: { icon: {} } },
    ];
  }

  _formDataFromConfig() {
    const c = this._config || {};
    const sf = c.session_filter || {};
    const hv = c.history_view || {};
    const appearance = c.appearance || {};
    const trails = appearance.trails || c.trails || {};
    const active = trails.active || {};
    const previous = trails.previous || {};
    const prevOpacity = previous.opacity || {};
    const channel = appearance.channel || {};
    const robot = appearance.robot || {};
    const dock = appearance.dock || {};
    return {
      title: c.title,
      mower_entity: c.mower_entity || c.status_entity,
      auto_entities: c.auto_entities !== false,
      status_entity: c.status_entity,
      x_entity: c.x_entity,
      y_entity: c.y_entity,
      heading_entity: c.heading_entity,
      zone_entity: c.zone_entity,
      battery_entity: c.battery_entity,
      show_controls: c.show_controls !== false,
      enable_zoom: c.enable_zoom !== false,
      background_image: c.background_image || c.overlay_image,
      overlay_opacity: c.overlay_opacity,
      calibration_mode: !!c.calibration_mode,
      history_hours: c.history_hours,
      session_count: c.session_count,
      session_gap_minutes: c.session_gap_minutes,
      session_interrupt_grace_minutes: c.session_interrupt_grace_minutes,
      straighten: c.straighten,
      session_filter_mode: sf.mode || 'count',
      session_filter_reset_time: sf.reset_time || '03:00',
      trail_legend: !!c.trail_legend,
      history_view_enabled: !!hv.enabled,
      history_view_days_back: hv.days_back ?? 4,
      history_view_show_live_marker: !!hv.show_live_marker_when_history,
      channel_entities: Array.isArray(c.channel_entities) ? c.channel_entities : [],
      active_trail_color: active.color,
      active_trail_opacity: active.opacity,
      active_trail_width: active.width,
      previous_trail_color: previous.color,
      previous_trail_width: previous.width,
      previous_opacity_first: prevOpacity.first,
      previous_opacity_last: prevOpacity.last,
      fade_mode: trails.fade_mode || 'linear',
      channel_fill: channel.fill,
      channel_stroke: channel.stroke,
      channel_width: channel.width,
      robot_scale: robot.scale,
      robot_model: robot.model || 'h2',
      robot_icon: robot.icon,
      dock_scale: dock.scale,
      dock_icon: dock.icon || 'mdi:lightning-bolt-circle',
    };
  }

  _setIfValue(obj, key, value) {
    if (value === undefined || value === null || value === '') delete obj[key];
    else obj[key] = value;
  }

  _configFromFormData(data) {
    const cfg = JSON.parse(JSON.stringify(this._config || {}));
    const simple = [
      'title', 'mower_entity', 'auto_entities', 'status_entity', 'x_entity', 'y_entity', 'heading_entity',
      'zone_entity', 'battery_entity', 'show_controls', 'enable_zoom',
      'background_image', 'overlay_opacity', 'straighten', 'calibration_mode', 'history_hours',
      'session_count', 'session_gap_minutes', 'session_interrupt_grace_minutes', 'trail_legend', 'channel_entities'
    ];
    for (const key of simple) this._setIfValue(cfg, key, data[key]);
    if (!cfg.status_entity && cfg.mower_entity) cfg.status_entity = cfg.mower_entity;

    cfg.session_filter = cfg.session_filter || {};
    this._setIfValue(cfg.session_filter, 'mode', data.session_filter_mode);
    this._setIfValue(cfg.session_filter, 'reset_time', data.session_filter_reset_time);

    cfg.history_view = cfg.history_view || {};
    this._setIfValue(cfg.history_view, 'enabled', data.history_view_enabled);
    this._setIfValue(cfg.history_view, 'days_back', data.history_view_days_back);
    this._setIfValue(cfg.history_view, 'show_live_marker_when_history', data.history_view_show_live_marker);

    cfg.appearance = cfg.appearance || {};
    cfg.appearance.trails = cfg.appearance.trails || {};
    cfg.appearance.trails.active = cfg.appearance.trails.active || {};
    cfg.appearance.trails.previous = cfg.appearance.trails.previous || {};
    cfg.appearance.trails.previous.opacity = cfg.appearance.trails.previous.opacity || {};
    this._setIfValue(cfg.appearance.trails.active, 'color', data.active_trail_color);
    this._setIfValue(cfg.appearance.trails.active, 'opacity', data.active_trail_opacity);
    this._setIfValue(cfg.appearance.trails.active, 'width', data.active_trail_width);
    this._setIfValue(cfg.appearance.trails.previous, 'color', data.previous_trail_color);
    this._setIfValue(cfg.appearance.trails.previous, 'width', data.previous_trail_width);
    this._setIfValue(cfg.appearance.trails.previous.opacity, 'first', data.previous_opacity_first);
    this._setIfValue(cfg.appearance.trails.previous.opacity, 'last', data.previous_opacity_last);
    this._setIfValue(cfg.appearance.trails, 'fade_mode', data.fade_mode);

    cfg.appearance.channel = cfg.appearance.channel || {};
    this._setIfValue(cfg.appearance.channel, 'fill', data.channel_fill);
    this._setIfValue(cfg.appearance.channel, 'stroke', data.channel_stroke);
    this._setIfValue(cfg.appearance.channel, 'width', data.channel_width);

    cfg.appearance.robot = cfg.appearance.robot || {};
    this._setIfValue(cfg.appearance.robot, 'scale', data.robot_scale);
    this._setIfValue(cfg.appearance.robot, 'model', data.robot_model);
    this._setIfValue(cfg.appearance.robot, 'icon', data.robot_icon);
    cfg.appearance.dock = cfg.appearance.dock || {};
    this._setIfValue(cfg.appearance.dock, 'scale', data.dock_scale);
    this._setIfValue(cfg.appearance.dock, 'icon', data.dock_icon);
    return cfg;
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      this.innerHTML = `<ha-form></ha-form>`;
      this._form = this.querySelector('ha-form');
      this._form.schema = this._schema();
      this._form.computeLabel = (schema) => schema.label || schema.name;
      this._form.addEventListener('value-changed', (ev) => {
        const cfg = this._configFromFormData(ev.detail.value || {});
        this._config = cfg;
        this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: cfg }, bubbles: true, composed: true }));
      });
    }
    this._form.hass = this._hass;
    this._form.data = this._formDataFromConfig();
  }
}

customElements.define('navimow-map-card-editor', NavimowMapCardEditor);

NavimowMapCard.getConfigElement = function() {
  return document.createElement('navimow-map-card-editor');
};

NavimowMapCard.getStubConfig = function() {
  return {
    type: 'custom:navimow-map-card',
    title: 'Navimow Map',
    mower_entity: '',
    auto_entities: true,
    trail_length: 8000,
    history_hours: 96,
    session_count: 24,
    session_filter: { mode: 'today', reset_time: '03:00' },
    history_view: { enabled: true, days_back: 4, show_live_marker_when_history: false },
    trail_legend: true,
    session_gap_minutes: 20,
    session_interrupt_grace_minutes: 5,
    straighten: true,
    appearance: {
      trails: {
        active: { color: '#4F7942', opacity: 0.5, width: 3.4 },
        previous: { color: '#AFE1AF', width: 3.2, opacity: { first: 0.8, last: 0.3 } },
        fade_mode: 'linear',
      },
      channel: { fill: 'rgba(255,0,0,0.5)', stroke: 'rgba(255,0,0,0.5)', width: 0.3 },
      robot: { scale: 1 },
      dock: { icon: 'mdi:lightning-bolt-circle', scale: 1 },
    },
  };
};

customElements.define('navimow-map-card', NavimowMapCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'navimow-map-card',
  name: 'Navimow Map',
  description: 'Live Navimow position + session path, history view, daily filters, legend, zoom, channels, stable visual editor, and optional satellite overlay.',
});

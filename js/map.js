/* Seilplan — a small, dependency-free slippy map (Web Mercator).
   Tiles as <img>, lines in one SVG, markers as positioned HTML. Works offline with cached tiles. */
(function () {
  const TS = 256;
  const clampLat = (l) => Math.max(-85.0511, Math.min(85.0511, l));
  function project(lat, lon, z) {
    const s = TS * Math.pow(2, z), r = (clampLat(lat) * Math.PI) / 180;
    return [((lon + 180) / 360) * s, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s];
  }
  function unproject(x, y, z) {
    const s = TS * Math.pow(2, z), lon = (x / s) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / s;
    return [(180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lon];
  }

  class SeaMap {
    constructor(el, opt = {}) {
      this.el = el;
      el.classList.add('sm');
      this.lat = opt.lat ?? 59; this.lon = opt.lon ?? 10; this.zoom = opt.zoom ?? 6;
      this.minZoom = 2; this.maxZoom = 18;
      this.layers = []; this.lines = new Map(); this.markers = new Map(); this.handlers = {};
      this.tilePane = document.createElement('div'); this.tilePane.className = 'sm-tiles';
      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); this.svg.setAttribute('class', 'sm-svg');
      this.markerPane = document.createElement('div'); this.markerPane.className = 'sm-markers';
      el.append(this.tilePane, this.svg, this.markerPane);
      this.tiles = new Map();
      this._bind();
      new ResizeObserver(() => this.render()).observe(el);
    }
    on(ev, fn) { (this.handlers[ev] ||= []).push(fn); }
    emit(ev, a) { (this.handlers[ev] || []).forEach((f) => f(a)); }
    addTileLayer(id, url, o = {}) { this.layers.push({ id, url, opacity: o.opacity ?? 1, minZoom: o.minZoom ?? 0, maxZoom: o.maxZoom ?? 19, visible: o.visible ?? true, cls: o.cls || '' }); this.render(); }
    setLayerVisible(id, v) { const l = this.layers.find((x) => x.id === id); if (l) { l.visible = v; this.render(); } }
    size() { return [this.el.clientWidth || 1, this.el.clientHeight || 1]; }
    centerPx(z = this.zoom) { return project(this.lat, this.lon, z); }
    toPoint(lat, lon) {
      const [cx, cy] = this.centerPx(), [x, y] = project(lat, lon, this.zoom), [w, h] = this.size();
      const world = TS * Math.pow(2, this.zoom);
      let dx = x - cx; dx -= Math.round(dx / world) * world; // nearest world copy
      return [w / 2 + dx, h / 2 + (y - cy)];
    }
    toLatLng(px, py) {
      const [cx, cy] = this.centerPx(), [w, h] = this.size();
      const [lat, lon] = unproject(cx + px - w / 2, cy + py - h / 2, this.zoom);
      return [lat, ((lon + 540) % 360) - 180];
    }
    setView(lat, lon, zoom = this.zoom) {
      this.lat = clampLat(lat); this.lon = ((lon + 540) % 360) - 180;
      this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom)); this.render(); this.emit('move');
    }
    fit(points, pad = 40) {
      if (!points.length) return;
      // unwrap longitudes so a Pacific crossing fits correctly
      const ref = points[0][1], pts = points.map(([a, b]) => [a, b + Math.round((ref - b) / 360) * 360]);
      const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1]);
      const [w, h] = this.size(); let z = this.maxZoom;
      for (; z > this.minZoom; z -= 0.25) {
        const a = project(Math.max(...lats), Math.min(...lons), z), b = project(Math.min(...lats), Math.max(...lons), z);
        if (b[0] - a[0] < w - pad * 2 && b[1] - a[1] < h - pad * 2) break;
      }
      const c0 = project(Math.max(...lats), Math.min(...lons), z), c1 = project(Math.min(...lats), Math.max(...lons), z);
      const [lat, lon] = unproject((c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2, z);
      this.setView(lat, lon, Math.min(z, 13));
    }
    zoomAt(nz, px, py) {
      nz = Math.max(this.minZoom, Math.min(this.maxZoom, nz));
      const before = this.toLatLng(px, py); this.zoom = nz;
      const [bx, by] = project(before[0], before[1], nz), [w, h] = this.size();
      const [lat, lon] = unproject(bx - (px - w / 2), by - (py - h / 2), nz);
      this.lat = clampLat(lat); this.lon = ((lon + 540) % 360) - 180; this.render(); this.emit('move');
    }
    panBy(dx, dy) {
      const [cx, cy] = this.centerPx(); const [lat, lon] = unproject(cx - dx, cy - dy, this.zoom);
      this.lat = clampLat(lat); this.lon = ((lon + 540) % 360) - 180; this.render(); this.emit('move');
    }
    /* features */
    setLine(id, latlngs, style = {}) { this.lines.set(id, { latlngs, style }); this._drawLines(); }
    removeLine(id) { this.lines.delete(id); this._drawLines(); }
    clearLines(prefix) { [...this.lines.keys()].forEach((k) => k.startsWith(prefix) && this.lines.delete(k)); this._drawLines(); }
    setMarker(id, lat, lon, html, o = {}) {
      let m = this.markers.get(id);
      if (!m) { const d = document.createElement('div'); d.className = 'sm-marker ' + (o.cls || ''); this.markerPane.appendChild(d); m = { el: d }; this.markers.set(id, m);
        if (o.onClick) d.addEventListener('click', (e) => { e.stopPropagation(); o.onClick(); }); }
      m.lat = lat; m.lon = lon; m.rot = o.rot;
      if (m.html !== html) { m.el.innerHTML = html; m.html = html; }
      if (o.title) m.el.title = o.title;
      this._placeMarker(m);
    }
    removeMarker(id) { const m = this.markers.get(id); if (m) { m.el.remove(); this.markers.delete(id); } }
    clearMarkers(prefix) { [...this.markers.keys()].forEach((k) => k.startsWith(prefix) && this.removeMarker(k)); }
    _placeMarker(m) { const [x, y] = this.toPoint(m.lat, m.lon); m.el.style.transform = `translate(${x}px,${y}px)`; }

    render() {
      const [w, h] = this.size(); const zi = Math.max(0, Math.min(19, Math.round(this.zoom)));
      const scale = Math.pow(2, this.zoom - zi), ts = TS * scale;
      const [cx, cy] = project(this.lat, this.lon, zi); const n = Math.pow(2, zi);
      const x0 = Math.floor((cx * scale - w / 2) / ts), x1 = Math.floor((cx * scale + w / 2) / ts);
      const y0 = Math.max(0, Math.floor((cy * scale - h / 2) / ts)), y1 = Math.min(n - 1, Math.floor((cy * scale + h / 2) / ts));
      const want = new Set();
      this.layers.forEach((L, li) => {
        if (!L.visible || zi < L.minZoom || zi > L.maxZoom) return;
        for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) {
          const wx = ((tx % n) + n) % n, key = `${li}/${zi}/${tx}/${ty}`; want.add(key);
          let img = this.tiles.get(key);
          if (!img) {
            img = new Image(); img.className = 'sm-tile ' + L.cls; img.alt = ''; img.decoding = 'async'; img.draggable = false;
            img.style.opacity = 0; img.onload = () => (img.style.opacity = L.opacity); img.onerror = () => img.classList.add('sm-missing');
            img.src = L.url.replace('{z}', zi).replace('{x}', wx).replace('{y}', ty);
            img.style.zIndex = li; this.tilePane.appendChild(img); this.tiles.set(key, img);
          }
          img.style.width = img.style.height = ts + 0.5 + 'px';
          img.style.transform = `translate(${w / 2 + tx * ts - cx * scale}px,${h / 2 + ty * ts - cy * scale}px)`;
        }
      });
      // keep the previous zoom's tiles underneath until the new ones load, then drop them
      for (const [k, img] of this.tiles) if (!want.has(k)) {
        const kz = +k.split('/')[1];
        if (kz === zi || this.tiles.size > 260) { img.remove(); this.tiles.delete(k); }
        else { const [, , tx, ty] = k.split('/').map(Number), s2 = Math.pow(2, this.zoom - kz) * TS, [ccx, ccy] = project(this.lat, this.lon, kz);
          img.style.width = img.style.height = s2 + 0.5 + 'px'; img.style.zIndex = -1;
          img.style.transform = `translate(${w / 2 + tx * s2 - ccx * Math.pow(2, this.zoom - kz)}px,${h / 2 + ty * s2 - ccy * Math.pow(2, this.zoom - kz)}px)`; }
      }
      clearTimeout(this._gc); this._gc = setTimeout(() => { for (const [k, img] of this.tiles) if (+k.split('/')[1] !== Math.round(this.zoom)) { img.remove(); this.tiles.delete(k); } }, 900);
      this.svg.setAttribute('width', w); this.svg.setAttribute('height', h);
      this._drawLines(); this.markers.forEach((m) => this._placeMarker(m));
      this.emit('render');
    }
    _drawLines() {
      const NS = 'http://www.w3.org/2000/svg'; this.svg.textContent = '';
      const [w] = this.size(), world = TS * Math.pow(2, this.zoom);
      for (const [, { latlngs, style }] of this.lines) {
        if (latlngs.length < 2) continue;
        // unwrap so lines cross the antimeridian without jumping
        let prev = null; const pts = latlngs.map(([a, b]) => { let [x, y] = this.toPoint(a, b); if (prev) { while (x - prev[0] > world / 2) x -= world; while (prev[0] - x > world / 2) x += world; } prev = [x, y]; return [x, y]; });
        const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
        const draw = (sh) => { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); p.setAttribute('transform', `translate(${sh},0)`); p.setAttribute('fill', 'none');
          p.setAttribute('stroke-linejoin', 'round'); p.setAttribute('stroke-linecap', 'round');
          for (const k in style) p.style.setProperty(k, style[k]); this.svg.appendChild(p); };
        draw(0); if (world < w * 2) { draw(world); draw(-world); }
      }
    }
    _bind() {
      const el = this.el, pts = new Map(); let drag = null, pinch = null, lastTap = 0;
      el.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.sm-marker.clickable')) return;
        el.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, moved: false, t: Date.now() };
        if (pts.size === 2) { const [a, b] = [...pts.values()]; const r = el.getBoundingClientRect();
          pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: this.zoom, cx: (a[0] + b[0]) / 2 - r.left, cy: (a[1] + b[1]) / 2 - r.top }; drag = null; }
      });
      el.addEventListener('pointermove', (e) => {
        if (!pts.has(e.pointerId)) return; const old = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          this.zoomAt(pinch.z + Math.log2(d / pinch.d), pinch.cx, pinch.cy); return; }
        if (drag) { if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) drag.moved = true;
          if (drag.moved) { this.panBy(e.clientX - old[0], e.clientY - old[1]); this.emit('userpan'); } }
      });
      const end = (e) => {
        if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId);
        if (drag && !drag.moved && pts.size === 0 && e.type === 'pointerup') {
          const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, now = Date.now();
          if (now - lastTap < 300) { this.zoomAt(this.zoom + 1, x, y); lastTap = 0; }
          else { lastTap = now; const ll = this.toLatLng(x, y); this.emit('tap', { lat: ll[0], lon: ll[1] }); }
        }
        if (pts.size < 2) pinch = null; if (!pts.size) drag = null;
      };
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
      el.addEventListener('wheel', (e) => { e.preventDefault(); const r = el.getBoundingClientRect();
        this.zoomAt(this.zoom - Math.sign(e.deltaY) * 0.5, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    }
  }
  window.SeaMap = SeaMap;
})();

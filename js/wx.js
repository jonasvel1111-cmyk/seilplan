/* Seilplan — weather: fetch several global models + waves from Open-Meteo, keep them offline, sample and score passages. */
(function () {
  const MODELS = [
    { id: 'ecmwf_ifs025', s: 'ECMWF', n: 'ECMWF IFS (Europa)', c: 'var(--p1)' },
    { id: 'gfs_seamless', s: 'GFS', n: 'NOAA GFS (USA)', c: 'var(--p2)' },
    { id: 'icon_seamless', s: 'ICON', n: 'DWD ICON (Tyskland)', c: 'var(--p3)' },
    { id: 'gem_seamless', s: 'GEM', n: 'GEM (Canada)', c: 'var(--p4)' },
    { id: 'ukmo_seamless', s: 'UKMO', n: 'UK Met Office', c: 'var(--p5)' },
  ];
  const SOURCES = [...MODELS, { id: 'mean', s: 'Snitt', n: 'Snitt av modellene' }, { id: 'worst', s: 'Mest vind', n: 'Mest vind (forsiktig)' }];
  const FC = 'https://api.open-meteo.com/v1/forecast', MAR = 'https://marine-api.open-meteo.com/v1/marine';

  /* tiny IndexedDB key/value store, so forecasts survive offline and restarts */
  const kv = {
    db: null,
    open() { if (this.db) return this.db; this.db = new Promise((res, rej) => { try { const r = indexedDB.open('seilplan', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } }); return this.db; },
    async get(k) { try { const db = await this.open(); return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); } catch { return undefined; } },
    async set(k, v) { try { const db = await this.open(); await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch {} },
  };

  async function getJSON(url, ms = 25000) {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), ms);
    try { const r = await fetch(url, { signal: ctl.signal }); const j = await r.json().catch(() => null);
      if (!r.ok || (j && j.error)) throw new Error((j && j.reason) || `HTTP ${r.status}`); return j; }
    catch (e) { throw new Error(e.name === 'AbortError' ? 'Tidsavbrudd' : e.message === 'Failed to fetch' ? 'Ingen forbindelse' : e.message); }
    finally { clearTimeout(to); }
  }
  const coordQ = (pts) => `latitude=${pts.map((p) => p.lat.toFixed(3)).join(',')}&longitude=${pts.map((p) => p.lon.toFixed(3)).join(',')}`;
  const arr = (j) => (Array.isArray(j) ? j : [j]);
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  function pack(h, map) { const o = { t0: h.time[0], n: h.time.length }; for (const [k, src, f] of map) o[k] = (h[src] || []).map((v) => (v == null ? null : f ? f(v) : r1(v))); return o; }

  async function fetchModel(pts, id, days) {
    const out = [];
    for (let i = 0; i < pts.length; i += 40) {
      const chunk = pts.slice(i, i + 40);
      const j = await getJSON(`${FC}?${coordQ(chunk)}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,is_day&wind_speed_unit=kn&timeformat=unixtime&timezone=GMT&forecast_days=${days}&models=${id}`);
      arr(j).forEach((l) => out.push(pack(l.hourly, [['ws', 'wind_speed_10m'], ['wd', 'wind_direction_10m', Math.round], ['wg', 'wind_gusts_10m'], ['p', 'pressure_msl', Math.round], ['day', 'is_day', (v) => v]])));
    }
    return out;
  }
  async function fetchMarine(pts) {
    const out = [];
    for (let i = 0; i < pts.length; i += 40) {
      const chunk = pts.slice(i, i + 40);
      const j = await getJSON(`${MAR}?${coordQ(chunk)}&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,ocean_current_velocity,ocean_current_direction&timeformat=unixtime&timezone=GMT&forecast_days=8`);
      arr(j).forEach((l) => out.push(pack(l.hourly, [['wh', 'wave_height'], ['wdir', 'wave_direction', Math.round], ['wper', 'wave_period'], ['sh', 'swell_wave_height'], ['sdir', 'swell_wave_direction', Math.round], ['sper', 'swell_wave_period'], ['cv', 'ocean_current_velocity', (v) => r1(v / 1.852)], ['cd', 'ocean_current_direction', Math.round]])));
    }
    return out;
  }
  /* fetch every model in parallel; a model that fails is kept with its reason, the rest still work */
  async function fetchAll(pts, onStep) {
    const data = { fetchedAt: Date.now(), pts: pts.map((p) => ({ lat: +p.lat.toFixed(3), lon: +p.lon.toFixed(3) })), m: {}, marine: null };
    let done = 0; const total = MODELS.length + 1, tick = () => onStep && onStep(++done, total);
    await Promise.all([
      ...MODELS.map((m) => fetchModel(pts, m.id, 16).then((loc) => (data.m[m.id] = { ok: true, loc })).catch((e) => (data.m[m.id] = { ok: false, err: e.message })).finally(tick)),
      fetchMarine(pts).then((loc) => (data.marine = { ok: true, loc })).catch((e) => (data.marine = { ok: false, err: e.message })).finally(tick),
    ]);
    data.anyOk = MODELS.some((m) => data.m[m.id].ok);
    return data;
  }

  function val(L, key, t, circ) {
    if (!L || !L[key]) return null; const f = (t - L.t0) / 3600; if (f < 0 || f > L.n - 1) return null;
    const i = Math.floor(f), fr = f - i, a = L[key][i], b = L[key][Math.min(L.n - 1, i + 1)];
    if (a == null) return null; if (b == null || fr === 0) return a;
    return circ ? Geo.norm(a + Geo.sdiff(a, b) * fr) : a + (b - a) * fr;
  }
  function modelAt(data, id, k, t) {
    const M = data.m[id]; if (!M || !M.ok) return null; const L = M.loc[k]; const ws = val(L, 'ws', t);
    if (ws == null) return null; return { ws, wd: val(L, 'wd', t, true), wg: val(L, 'wg', t) ?? ws * 1.3, p: val(L, 'p', t), day: val(L, 'day', t) };
  }
  /* weather at sample k, time t (unix s) for a source */
  function at(data, src, k, t) {
    let w;
    if (src === 'mean' || src === 'worst') {
      const all = MODELS.map((m) => modelAt(data, m.id, k, t)).filter(Boolean); if (!all.length) return null;
      if (src === 'mean') { const av = (q) => all.reduce((s, a) => s + a[q], 0) / all.length; w = { ws: av('ws'), wg: av('wg'), wd: Geo.circMean(all.map((a) => a.wd)), p: av('p'), day: all[0].day, n: all.length }; }
      else { const top = all.reduce((m, a) => (a.ws > m.ws ? a : m)); w = { ...top, wg: Math.max(...all.map((a) => a.wg)), n: all.length }; }
    } else w = modelAt(data, src, k, t);
    if (!w) return null;
    const L = data.marine && data.marine.ok ? data.marine.loc[k] : null;
    w.wave = val(L, 'wh', t); w.wdir = val(L, 'wdir', t, true); w.wper = val(L, 'wper', t);
    w.swell = val(L, 'sh', t); w.sdir = val(L, 'sdir', t, true); w.sper = val(L, 'sper', t); w.cur = val(L, 'cv', t); w.cdir = val(L, 'cd', t, true);
    return w;
  }
  function horizon(data, src) {
    const ids = src === 'mean' || src === 'worst' ? MODELS.map((m) => m.id) : [src]; let end = 0;
    ids.forEach((id) => { const M = data.m[id]; if (!M || !M.ok) return; const L = M.loc[0]; let i = L.n - 1; while (i > 0 && L.ws[i] == null) i--; end = Math.max(end, L.t0 + i * 3600); });
    return end;
  }
  function spread(data, k, t) {
    const all = MODELS.map((m) => ({ m, w: modelAt(data, m.id, k, t) })).filter((x) => x.w); if (all.length < 2) return null;
    const ws = all.map((x) => x.w.ws), md = Geo.circMean(all.map((x) => x.w.wd));
    return { min: Math.min(...ws), max: Math.max(...ws), dd: Math.max(...all.map((x) => Math.abs(Geo.sdiff(md, x.w.wd)))), md, all };
  }

  /* score one departure. S = settings */
  function evalPassage(data, src, samples, dep, S) {
    let sum = 0, n = 0, beat = 0, maxWs = 0, maxWg = 0, maxWave = 0, ex = [], per = [];
    samples.forEach((s, k) => {
      const t = dep + (s.cum / S.speed) * 3600, w = at(data, src, k, t);
      if (!w) { per.push({ s, t, w: null }); return; }
      const twa = Math.abs(Geo.sdiff(s.brg, w.wd));
      let f = w.ws < S.windMin ? 0.6 : w.ws <= S.windMax ? 1 : Math.max(0, 1 - (w.ws - S.windMax) / 8);
      const flags = [];
      if (w.ws > S.windMax) flags.push('wind');
      if (w.wg > S.gustMax) { f *= 0.3; flags.push('gust'); }
      if (w.wave != null) { if (w.wave > S.waveMax) { f *= 0.3; flags.push('wave'); } else if (w.wave > 0.75 * S.waveMax) f *= 0.85; }
      if (S.avoidBeat && twa < 45 && w.ws >= S.windMin) { f *= 0.7; beat++; }
      sum += f; n++; maxWs = Math.max(maxWs, w.ws); maxWg = Math.max(maxWg, w.wg); if (w.wave != null) maxWave = Math.max(maxWave, w.wave);
      if (flags.length) ex.push({ k, t, flags, w });
      per.push({ s, t, w, twa, f, flags });
    });
    const tot = samples.length ? samples[samples.length - 1].cum : 0;
    const score = n ? Math.round((sum / n) * 100 * (ex.length ? 0.6 : 1)) : null;
    return { dep, arr: dep + (tot / S.speed) * 3600, score, coverage: samples.length ? n / samples.length : 0, maxWs, maxWg, maxWave, ex, beat: n ? beat / n : 0, per };
  }
  function windows(data, src, samples, S, from) {
    const end = horizon(data, src); if (!end) return { all: [], pick: [] };
    const all = []; const start = Math.ceil(from / 10800) * 10800;
    for (let d = start; d <= end - 6 * 3600 && d < start + 15 * 86400; d += 10800) { const e = evalPassage(data, src, samples, d, S); if (e.score != null) all.push(e); }
    const rank = (e) => (e.coverage >= 0.9 ? 1000 : e.coverage * 500) + e.score;
    const pick = [...all].sort((a, b) => rank(b) - rank(a)).reduce((p, e) => { if (p.length < 3 && p.every((q) => Math.abs(q.dep - e.dep) >= 12 * 3600)) p.push(e); return p; }, []);
    return { all, pick };
  }

  /* tropical cyclone seasons by basin (months 1–12). Boxes: [latMin, latMax, lonMin, lonMax], lonMin > lonMax wraps the date line */
  const BASINS = [
    { n: 'Nord-Atlanteren og Karibia', b: [[5, 45, -100, -15]], m: [6, 7, 8, 9, 10, 11], peak: [8, 9, 10], src: 'NHC (nhc.noaa.gov)' },
    { n: 'Nordøstlige Stillehav (Mexico og Mellom-Amerika)', b: [[5, 30, -140, -80]], m: [5, 6, 7, 8, 9, 10, 11], peak: [7, 8, 9], src: 'NHC (nhc.noaa.gov)' },
    { n: 'Nordvestlige Stillehav (Filippinene, Taiwan, Japan)', b: [[5, 45, 100, 180]], m: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], peak: [7, 8, 9, 10], src: 'JTWC og JMA' },
    { n: 'Nordlige Indiahav (Arabiahavet og Bengalbukta)', b: [[5, 25, 45, 100]], m: [4, 5, 6, 10, 11, 12], peak: [5, 11], src: 'IMD (mausam.imd.gov.in)' },
    { n: 'Sørvestlige Indiahav (Madagaskar, Mauritius, Réunion)', b: [[-35, -5, 30, 90]], m: [11, 12, 1, 2, 3, 4], peak: [1, 2, 3], src: 'Météo-France La Réunion' },
    { n: 'Australia og Timorhavet', b: [[-35, -5, 90, 160]], m: [11, 12, 1, 2, 3, 4], peak: [1, 2, 3], src: 'BOM (bom.gov.au)' },
    { n: 'Sørlige Stillehav (Fiji, Vanuatu, Tonga, Ny-Caledonia)', b: [[-35, -5, 160, -120]], m: [11, 12, 1, 2, 3, 4], peak: [1, 2, 3], src: 'Fiji Meteorological Service' },
  ];
  function inBox(lat, lon, [a, b, c, d]) { if (lat < a || lat > b) return false; return c <= d ? lon >= c && lon <= d : lon >= c || lon <= d; }
  function seasonCheck(samples, dep, speed) {
    const hits = new Map();
    samples.forEach((s) => { const t = new Date((dep + (s.cum / speed) * 3600) * 1000), mo = t.getUTCMonth() + 1;
      BASINS.forEach((B) => { if (B.b.some((x) => inBox(s.lat, s.lon, x))) { const h = hits.get(B.n) || { B, inSeason: false, peak: false, months: new Set() };
        h.months.add(mo); if (B.m.includes(mo)) h.inSeason = true; if (B.peak.includes(mo)) h.peak = true; hits.set(B.n, h); } }); });
    return [...hits.values()];
  }

  window.WX = { MODELS, SOURCES, kv, fetchAll, at, horizon, spread, evalPassage, windows, BASINS, seasonCheck, getJSON };
})();

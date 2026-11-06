/* Seilplan — navigation maths (great circle, bearings, formatting). */
(function () {
  const R = 3440.065, rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
  const norm = (d) => ((d % 360) + 360) % 360;
  const G = {
    R, rad, deg, norm,
    dist(a, b) { const dl = rad(b.lat - a.lat), dn = rad(b.lon - a.lon);
      const h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); },
    brg(a, b) { const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
      const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon)); return norm(deg(Math.atan2(y, x))); },
    interp(a, b, f) { const d = G.dist(a, b) / R; if (d < 1e-9) return { lat: a.lat, lon: a.lon };
      const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(rad(a.lat)) * Math.cos(rad(a.lon)) + B * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon));
      const y = A * Math.cos(rad(a.lat)) * Math.sin(rad(a.lon)) + B * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon));
      const z = A * Math.sin(rad(a.lat)) + B * Math.sin(rad(b.lat));
      return { lat: deg(Math.atan2(z, Math.hypot(x, y))), lon: deg(Math.atan2(y, x)) }; },
    dest(a, b, nm) { const d = nm / R, t = rad(b), p1 = rad(a.lat), l1 = rad(a.lon);
      const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
      const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
      return { lat: deg(p2), lon: ((deg(l2) + 540) % 360) - 180 }; },
    /* a polyline that follows the great circle between each pair of points */
    path(points, step = 25) { const out = [];
      for (let i = 1; i < points.length; i++) { const a = points[i - 1], b = points[i], n = Math.max(1, Math.ceil(G.dist(a, b) / step));
        for (let k = i === 1 ? 0 : 1; k <= n; k++) { const p = G.interp(a, b, k / n); out.push([p.lat, p.lon]); } }
      return out; },
    total(points) { let s = 0; for (let i = 1; i < points.length; i++) s += G.dist(points[i - 1], points[i]); return s; },
    /* evenly spaced sample points along the route, at most `max` of them */
    samples(points, max = 48, minStep = 4) {
      const tot = G.total(points); if (points.length < 2 || tot < 0.01) return [];
      const step = Math.max(minStep, tot / (max - 1)), out = []; let cum = 0, next = 0;
      for (let i = 1; i < points.length; i++) { const a = points[i - 1], b = points[i], d = G.dist(a, b);
        while (next <= cum + d + 1e-6) { const f = d ? (next - cum) / d : 0, p = G.interp(a, b, Math.min(1, f));
          const q = G.interp(a, b, Math.min(1, f + 0.001)); out.push({ lat: p.lat, lon: p.lon, cum: next, brg: G.brg(p, q.lat === p.lat && q.lon === p.lon ? b : q), leg: i });
          next += step; }
        cum += d; }
      const last = points[points.length - 1];
      if (tot - out[out.length - 1].cum > step * 0.3) out.push({ lat: last.lat, lon: last.lon, cum: tot, brg: G.brg(points[points.length - 2], last), leg: points.length - 1 });
      return out; },
    sdiff(a, b) { return ((b - a + 540) % 360) - 180; },
    circMean(arr, w) { let x = 0, y = 0; arr.forEach((d, i) => { const k = w ? w[i] : 1; x += k * Math.sin(rad(d)); y += k * Math.cos(rad(d)); }); return norm(deg(Math.atan2(x, y))); },
    dir16(d) { return ['N', 'NNØ', 'NØ', 'ØNØ', 'Ø', 'ØSØ', 'SØ', 'SSØ', 'S', 'SSV', 'SV', 'VSV', 'V', 'VNV', 'NV', 'NNV'][Math.round(norm(d) / 22.5) % 16]; },
    dir8(d) { return ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'][Math.round(norm(d) / 45) % 8]; },
    pos(lat, lon) { const f = (v, p, n, w) => { const s = v >= 0 ? p : n; v = Math.abs(v); let d = Math.floor(v), m = (v - d) * 60; if (m >= 59.95) { d++; m = 0; }
        return `${String(d).padStart(w, '0')}°${m.toFixed(1).replace('.', ',').padStart(4, '0')}'${s}`; };
      return `${f(lat, 'N', 'S', 2)} ${f(lon, 'Ø', 'V', 3)}`; },
    num(n, d = 1) { return n == null || isNaN(n) ? '–' : n.toFixed(d).replace('.', ','); },
  };
  window.Geo = G;
})();

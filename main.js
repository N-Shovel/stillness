(() => {
  'use strict';

  /* ================================================================
     Utilities
     ================================================================ */

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => t * t * (3 - 2 * t);
  const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeNoise(seed) {
    const r = mulberry32(seed);
    const v = new Float32Array(512);
    for (let i = 0; i < 512; i++) v[i] = r();
    return x => {
      const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
      return lerp(v[i & 511], v[(i + 1) & 511], u);
    };
  }

  function fbm(n, x, oct, ridge = 0) {
    let s = 0, a = 0.5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      let v = n(x * f + o * 31.7);
      if (ridge) v = lerp(v, 1 - Math.abs(v * 2 - 1), ridge);
      s += v * a; norm += a; a *= 0.5; f *= 2.03;
    }
    return s / norm;
  }

  /* ================================================================
     Time-of-day palettes. t: 0 = midnight, 0.5 = noon.
     ================================================================ */

  const NIGHT = { top: [7, 11, 30], mid: [18, 26, 60], hor: [46, 58, 100], land: [10, 14, 30], cloud: [48, 58, 98], sun: [225, 230, 255], stars: 1, flies: 1, birds: 0, glow: 0.25, cloudA: 0.5 };
  const DAWN  = { top: [42, 56, 112], mid: [192, 136, 162], hor: [255, 198, 162], land: [54, 48, 80], cloud: [255, 196, 186], sun: [255, 216, 172], stars: 0.15, flies: 0.15, birds: 0.7, glow: 0.95, cloudA: 0.85 };
  const DAY   = { top: [66, 136, 206], mid: [138, 194, 232], hor: [226, 238, 240], land: [56, 88, 98], cloud: [255, 255, 255], sun: [255, 251, 232], stars: 0, flies: 0, birds: 1, glow: 0.55, cloudA: 0.92 };
  const DUSK  = { top: [34, 38, 92], mid: [186, 92, 122], hor: [255, 168, 100], land: [44, 32, 64], cloud: [255, 158, 140], sun: [255, 168, 90], stars: 0.12, flies: 0.6, birds: 0.35, glow: 1, cloudA: 0.85 };

  const KEYS = [[0, NIGHT], [0.2, NIGHT], [0.265, DAWN], [0.36, DAY], [0.64, DAY], [0.73, DUSK], [0.8, NIGHT], [1, NIGHT]];

  function samplePalette(t) {
    let i = 0;
    while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++;
    const [t0, A] = KEYS[i], [t1, B] = KEYS[i + 1];
    const u = smooth(clamp((t - t0) / (t1 - t0 || 1), 0, 1));
    const out = {};
    for (const k in A) out[k] = Array.isArray(A[k]) ? mix(A[k], B[k], u) : lerp(A[k], B[k], u);
    return out;
  }

  function phaseName(t) {
    const h = t * 24;
    if (h < 4.5) return 'deep night';
    if (h < 5.8) return 'before dawn';
    if (h < 7.2) return 'dawn';
    if (h < 11) return 'morning';
    if (h < 14) return 'midday';
    if (h < 16.3) return 'afternoon';
    if (h < 17.6) return 'golden hour';
    if (h < 19.2) return 'dusk';
    if (h < 22) return 'evening';
    return 'night';
  }

  /* ================================================================
     Canvas setup
     ================================================================ */

  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const sceneC = document.createElement('canvas');
  const sctx = sceneC.getContext('2d');
  const cloudC = document.createElement('canvas');
  const cctx = cloudC.getContext('2d');

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motion = reduceMotion ? 0.35 : 1;

  let W = 0, H = 0, S = 1, HZ = 0;
  const MARGIN = 120, STEP = 3, MTN = 0.9;

  const LAYERS = [
    { base: 0.06, amp: 0.62, scale: 1 / 460, oct: 5, ridge: 0.65, depth: 0.66, par: 0.008, seed: 11 },
    { base: 0.04, amp: 0.44, scale: 1 / 330, oct: 5, ridge: 0.45, depth: 0.48, par: 0.018, seed: 23 },
    { base: 0.03, amp: 0.26, scale: 1 / 240, oct: 4, ridge: 0.2, depth: 0.3, par: 0.032, seed: 37 },
    { base: 0.025, amp: 0.07, scale: 1 / 150, oct: 3, ridge: 0, depth: 0.14, par: 0.05, seed: 53, trees: true },
  ];

  let stars = [], clouds = [], cloudSprites = [], pines = [], grass = [], flies = [], bankNoise;
  let glowSprite;

  function buildLayers() {
    const count = Math.ceil((W + MARGIN * 2) / STEP) + 2;
    const ref = 1400 / Math.max(W, 700);
    for (const L of LAYERS) {
      const n = makeNoise(L.seed);
      L.h = new Float32Array(count);
      for (let j = 0; j < count; j++) {
        const x = (j * STEP - MARGIN) * ref;
        L.h[j] = (L.base + L.amp * fbm(n, x * L.scale + L.seed, L.oct, L.ridge)) * HZ * MTN;
      }
      if (L.trees) {
        const r = mulberry32(L.seed * 7);
        L.treeList = [];
        for (let x = -MARGIN; x < W + MARGIN; x += 3 + r() * 7) {
          L.treeList.push({ x, h: HZ * (0.015 + r() * r() * 0.05), w: 0.22 + r() * 0.12 });
        }
      }
    }
  }

  function layerHeightAt(L, x) {
    const j = clamp(Math.round((x + MARGIN) / STEP), 0, L.h.length - 1);
    return L.h[j];
  }

  function buildStars() {
    const r = mulberry32(99);
    stars = [];
    const n = Math.round((W * HZ) / 4200);
    for (let i = 0; i < n; i++) {
      const big = r() < 0.06;
      stars.push({
        x: r() * W, y: Math.pow(r(), 1.4) * HZ * 0.92,
        s: big ? 1.6 + r() * 0.8 : 0.6 + r() * 0.8,
        a: big ? 0.9 : 0.25 + r() * 0.6,
        sp: 0.5 + r() * 2.2, ph: r() * 6.28,
      });
    }
  }

  function makeCloudSprite(seed) {
    const r = mulberry32(seed);
    const c = document.createElement('canvas');
    c.width = 420; c.height = 170;
    const g = c.getContext('2d');
    const puffs = 16 + (r() * 10 | 0);
    for (let i = 0; i < puffs; i++) {
      const px = 70 + r() * 280;
      const arch = Math.sin(Math.PI * (px - 70) / 280);
      const py = 115 - arch * (20 + r() * 35) + r() * 10;
      const pr = 22 + r() * 34 * (0.5 + arch);
      const shade = py > 100 ? 228 : 255;
      const grd = g.createRadialGradient(px, py, 0, px, py, pr);
      grd.addColorStop(0, `rgba(${shade},${shade},${shade + (255 - shade) * 0.5},0.55)`);
      grd.addColorStop(0.6, `rgba(${shade},${shade},${shade},0.25)`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
    }
    return c;
  }

  function buildClouds() {
    if (!cloudSprites.length) for (let i = 0; i < 6; i++) cloudSprites.push(makeCloudSprite(200 + i * 13));
    const r = mulberry32(7);
    clouds = [];
    const n = Math.max(5, Math.round(W / 220));
    for (let i = 0; i < n; i++) {
      const depth = r();
      clouds.push({
        x: r() * (W + 600) - 300,
        y: HZ * (0.04 + depth * 0.42),
        sc: (0.45 + (1 - depth) * 0.9) * clamp(W / 1400, 0.6, 1.3),
        sp: (2 + (1 - depth) * 7),
        sprite: i % cloudSprites.length,
        a: 0.55 + r() * 0.45,
      });
    }
  }

  function bankY(x) {
    const u = x / W;
    return H - H * (0.05 + 0.13 * Math.exp(-Math.pow(u / 0.2, 2)) + 0.075 * Math.exp(-Math.pow((u - 1) / 0.13, 2)))
      + (bankNoise(x / 60) - 0.5) * H * 0.012;
  }

  function makePine(x, h, r) {
    const n = 11 + (r() * 6 | 0);
    const maxW = h * (0.17 + r() * 0.05);
    const tiers = [];
    for (let i = 0; i < n; i++) {
      const f = i / n;
      const w = maxW * Math.pow(1 - f, 0.9);
      tiers.push({ y: -h * (0.12 + f * 0.84), wl: w * (0.75 + r() * 0.5), wr: w * (0.75 + r() * 0.5) });
    }
    return { x, h, tiers, gap: (h * 0.84) / n, phase: r() * 6.28 };
  }

  function buildForeground() {
    bankNoise = makeNoise(404);
    const r = mulberry32(808);
    pines = [
      [0.035, 0.62], [0.085, 0.47], [0.14, 0.34], [0.005, 0.40], [0.19, 0.2],
      [0.955, 0.4], [0.91, 0.26], [0.99, 0.3],
    ].map(([u, hf]) => makePine(u * W, hf * H * clamp(W / H, 0.7, 1.2) * 0.85, r));
    grass = [];
    for (let x = -40; x < W + 40; x += 2.5 + r() * 3.5) {
      grass.push({ x, h: 5 + r() * r() * 22, lean: (r() - 0.5) * 8, ph: r() * 6.28 });
    }
    flies = [];
    const nf = Math.round(clamp(W / 30, 20, 55));
    for (let i = 0; i < nf; i++) {
      flies.push({
        x: r() * W, y: HZ + r() * (H - HZ),
        vx: 0, vy: 0, ph: r() * 6.28, sp: 0.6 + r() * 1.4, dir: r() * 6.28, s: 0.6 + r() * 0.8,
      });
    }
  }

  function buildGlow() {
    glowSprite = document.createElement('canvas');
    glowSprite.width = glowSprite.height = 48;
    const g = glowSprite.getContext('2d');
    const grd = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    grd.addColorStop(0, 'rgba(255,250,200,1)');
    grd.addColorStop(0.15, 'rgba(240,255,160,0.8)');
    grd.addColorStop(0.45, 'rgba(200,240,120,0.18)');
    grd.addColorStop(1, 'rgba(200,240,120,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 48, 48);
  }

  function resize() {
    S = Math.min(window.devicePixelRatio || 1, 1.75);
    W = window.innerWidth; H = window.innerHeight;
    HZ = Math.round(H * (W < 720 ? 0.6 : 0.64));
    canvas.width = Math.round(W * S); canvas.height = Math.round(H * S);
    sceneC.width = Math.round(W * S); sceneC.height = Math.round(HZ * S);
    cloudC.width = sceneC.width; cloudC.height = sceneC.height;
    ctx.setTransform(S, 0, 0, S, 0, 0);
    sctx.setTransform(S, 0, 0, S, 0, 0);
    cctx.setTransform(S, 0, 0, S, 0, 0);
    buildLayers();
    buildStars();
    buildClouds();
    buildForeground();
  }

  /* ================================================================
     Time state
     ================================================================ */

  const realT = () => { const d = new Date(); return (d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600) / 24; };
  const PRESETS = { dawn: 0.262, day: 0.46, dusk: 0.738, night: 0.92 };
  const FLOW_DAY_SECONDS = 240;

  let t = realT();
  let mode = 'live';
  let tween = null;

  function goTo(target, newMode) {
    let to = target;
    if (to <= t) to += 1;
    const dist = to - t;
    tween = { from: t, to, start: clock, dur: clamp(dist * 14, 2.5, 9) };
    mode = newMode;
  }

  /* ================================================================
     Scene drawing
     ================================================================ */

  let clock = 0, mx = 0, my = 0, tmx = 0, tmy = 0;
  let birdsFlock = null, nextFlock = 6, shooting = null, nextShoot = 8;

  function celestial(tt) {
    // Returns position when above horizon, else null.
    const p = (tt - 0.23) / 0.54;
    if (p < -0.02 || p > 1.02) return null;
    const e = Math.sin(Math.PI * clamp(p, 0, 1));
    return { x: W * (0.12 + 0.76 * p), y: HZ - e * HZ * 0.78 + HZ * 0.02, e };
  }

  function drawSky(P) {
    const g = sctx;
    const grd = g.createLinearGradient(0, 0, 0, HZ);
    grd.addColorStop(0, rgb(P.top));
    grd.addColorStop(0.55, rgb(P.mid));
    grd.addColorStop(1, rgb(P.hor));
    g.fillStyle = grd;
    g.fillRect(0, 0, W, HZ);

    // Stars
    if (P.stars > 0.01) {
      g.fillStyle = '#fff';
      for (const s of stars) {
        const tw = 0.55 + 0.45 * Math.sin(clock * s.sp * motion + s.ph);
        const fade = 1 - smooth(clamp(s.y / HZ - 0.55, 0, 0.45) / 0.45);
        g.globalAlpha = s.a * tw * P.stars * fade;
        g.fillRect(s.x + mx * 3, s.y, s.s, s.s);
      }
      g.globalAlpha = 1;

      // Shooting star
      if (P.stars > 0.7) {
        nextShoot -= dtCache;
        if (!shooting && nextShoot <= 0) {
          shooting = { x: W * (0.2 + Math.random() * 0.6), y: HZ * (0.05 + Math.random() * 0.25), vx: (Math.random() < 0.5 ? -1 : 1) * (380 + Math.random() * 200), vy: 140 + Math.random() * 80, life: 0 };
          nextShoot = 14 + Math.random() * 30;
        }
      }
      if (shooting) {
        shooting.life += dtCache;
        const L = shooting.life, x = shooting.x + shooting.vx * L, y = shooting.y + shooting.vy * L;
        const a = Math.sin(Math.PI * clamp(L / 1.1, 0, 1)) * P.stars;
        const tail = g.createLinearGradient(x, y, x - shooting.vx * 0.18, y - shooting.vy * 0.18);
        tail.addColorStop(0, `rgba(255,255,255,${a})`);
        tail.addColorStop(1, 'rgba(255,255,255,0)');
        g.strokeStyle = tail; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - shooting.vx * 0.18, y - shooting.vy * 0.18); g.stroke();
        if (L > 1.1) shooting = null;
      }
    }

    // Sun & moon
    const sun = celestial(t);
    const moon = celestial((t + 0.5) % 1);

    if (moon) {
      const R = Math.max(10, H * 0.022);
      const a = 0.35 + 0.65 * P.stars;
      const halo = g.createRadialGradient(moon.x, moon.y, R * 0.8, moon.x, moon.y, R * 7);
      halo.addColorStop(0, `rgba(210,220,255,${0.22 * a})`);
      halo.addColorStop(1, 'rgba(210,220,255,0)');
      g.fillStyle = halo;
      g.fillRect(moon.x - R * 7, moon.y - R * 7, R * 14, R * 14);
      g.fillStyle = `rgba(238,240,255,${0.92 * a})`;
      g.beginPath(); g.arc(moon.x, moon.y, R, 0, Math.PI * 2); g.fill();
      g.fillStyle = `rgba(190,196,225,${0.25 * a})`;
      g.beginPath(); g.arc(moon.x - R * 0.3, moon.y - R * 0.2, R * 0.22, 0, 6.28); g.fill();
      g.beginPath(); g.arc(moon.x + R * 0.35, moon.y + R * 0.3, R * 0.15, 0, 6.28); g.fill();
      g.beginPath(); g.arc(moon.x + R * 0.1, moon.y - R * 0.45, R * 0.1, 0, 6.28); g.fill();
    }

    if (sun) {
      const R = Math.max(14, H * 0.03);
      const low = 1 - sun.e;
      const glowR = HZ * (0.55 + low * 0.6);
      const halo = g.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, glowR);
      halo.addColorStop(0, rgb(P.sun, 0.55 * P.glow));
      halo.addColorStop(0.18, rgb(P.sun, 0.22 * P.glow));
      halo.addColorStop(1, rgb(P.sun, 0));
      g.fillStyle = halo;
      g.fillRect(0, 0, W, HZ);
      const disc = g.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, R * 1.6);
      disc.addColorStop(0, 'rgba(255,255,250,1)');
      disc.addColorStop(0.55, rgb(P.sun, 1));
      disc.addColorStop(1, rgb(P.sun, 0));
      g.fillStyle = disc;
      g.beginPath(); g.arc(sun.x, sun.y, R * 1.6, 0, Math.PI * 2); g.fill();
    }

    // Horizon haze band
    const haze = g.createLinearGradient(0, HZ * 0.7, 0, HZ);
    haze.addColorStop(0, rgb(P.hor, 0));
    haze.addColorStop(1, rgb(P.hor, 0.35));
    g.fillStyle = haze;
    g.fillRect(0, HZ * 0.7, W, HZ * 0.3);

    return sun;
  }

  function drawClouds(P, dt) {
    const g = cctx;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, HZ);
    for (const c of clouds) {
      c.x += c.sp * dt * motion;
      const spr = cloudSprites[c.sprite];
      const w = spr.width * c.sc, h = spr.height * c.sc;
      if (c.x > W + 40) c.x = -w - 40 - Math.random() * 200;
      g.globalAlpha = c.a;
      g.drawImage(spr, c.x + mx * 6, c.y - h * 0.5, w, h);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = rgb(P.cloud, 0.72);
    g.fillRect(0, 0, W, HZ);
    g.globalCompositeOperation = 'source-over';

    sctx.globalAlpha = P.cloudA;
    sctx.drawImage(cloudC, 0, 0, cloudC.width, cloudC.height, 0, 0, W, HZ);
    sctx.globalAlpha = 1;
  }

  function drawMountains(P, sun) {
    const g = sctx;
    const n = LAYERS.length;
    for (let li = 0; li < n; li++) {
      const L = LAYERS[li];
      const shift = -mx * L.par * W;
      let col = mix(P.land, P.hor, L.depth * 0.82);
      // Warm the far ranges on the side facing a low sun
      if (sun && li < 2) col = mix(col, P.sun, 0.06 * P.glow * (1 - sun.e));

      const grad = g.createLinearGradient(0, HZ - L.amp * HZ * MTN, 0, HZ);
      grad.addColorStop(0, rgb(col));
      grad.addColorStop(1, rgb(mix(col, P.hor, 0.35)));
      g.fillStyle = grad;

      g.beginPath();
      g.moveTo(-MARGIN + shift, HZ + 1);
      for (let j = 0; j < L.h.length; j++) g.lineTo(j * STEP - MARGIN + shift, HZ - L.h[j]);
      g.lineTo((L.h.length - 1) * STEP - MARGIN + shift, HZ + 1);
      g.closePath();
      g.fill();

      if (L.trees) {
        g.fillStyle = rgb(col);
        g.beginPath();
        for (const tr of L.treeList) {
          const base = HZ - layerHeightAt(L, tr.x) + 2;
          const x = tr.x + shift;
          g.moveTo(x - tr.h * tr.w, base);
          g.lineTo(x, base - tr.h);
          g.lineTo(x + tr.h * tr.w, base);
        }
        g.fill();
      }

      // Valley mist between ranges
      if (li < n - 1) {
        const top = HZ - L.amp * HZ * MTN * 0.45;
        const mist = g.createLinearGradient(0, top, 0, HZ);
        mist.addColorStop(0, rgb(P.hor, 0));
        mist.addColorStop(1, rgb(P.hor, 0.32 + P.stars * 0.08));
        g.fillStyle = mist;
        g.fillRect(0, top, W, HZ - top);
      }
    }

    // Drifting low fog
    g.save();
    g.globalAlpha = 0.18 + 0.1 * P.glow;
    for (let i = 0; i < 3; i++) {
      const fx = ((clock * (6 + i * 3) * motion + i * 400) % (W + 800)) - 400;
      const fy = HZ - HZ * (0.03 + i * 0.025);
      const fg = g.createRadialGradient(fx, fy, 0, fx, fy, 380);
      fg.addColorStop(0, rgb(P.hor, 0.6));
      fg.addColorStop(1, rgb(P.hor, 0));
      g.fillStyle = fg;
      g.setTransform(S, 0, 0, S * 0.18, 0, fy * S * 0.82);
      g.fillRect(fx - 380, fy - 380, 760, 760);
      g.setTransform(S, 0, 0, S, 0, 0);
    }
    g.restore();
  }

  function drawLake(P, sun) {
    const lakeH = H - HZ;
    const sw = sceneC.width;
    const speed = clock * motion;
    for (let d = 0; d < lakeH; d += 2) {
      const k = d / lakeH;
      const off = Math.sin(d * 0.28 / (1 + k * 1.5) - speed * 1.4) * (0.5 + k * 5)
                + Math.sin(d * 0.045 + speed * 0.6) * k * 4;
      const sy = HZ - d * 0.92 - 2 + Math.sin(d * 0.11 - speed * 0.9) * k * 2.5;
      if (sy < 0) break;
      ctx.drawImage(sceneC, 0, sy * S, sw, 2 * S, off - 12, HZ + d, W + 24, 2.6);
    }

    // Water body tint: lighter near the horizon, deeper close to us
    const wt = ctx.createLinearGradient(0, HZ, 0, H);
    wt.addColorStop(0, rgb(P.hor, 0.12));
    wt.addColorStop(0.35, rgb(mix(P.land, P.top, 0.4), 0.28));
    wt.addColorStop(1, rgb(mix(P.land, [0, 0, 0], 0.3), 0.62));
    ctx.fillStyle = wt;
    ctx.fillRect(0, HZ, W, lakeH);

    // Soft shoreline highlight
    ctx.fillStyle = rgb(P.hor, 0.35);
    ctx.fillRect(0, HZ, W, 1);

    // Glints on the water under the sun (or moon)
    const light = sun || celestial((t + 0.5) % 1);
    if (light) {
      const strength = sun ? P.glow * 0.9 : P.stars * 0.5;
      const seed = Math.floor(clock * 7);
      const r = mulberry32(seed);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 45; i++) {
        const k = Math.pow(r(), 1.3);
        const y = HZ + 3 + k * lakeH * 0.85;
        const spread = 16 + k * W * 0.12;
        const x = light.x + (r() - 0.5) * 2 * spread;
        const len = 2 + k * 14 * r();
        ctx.fillStyle = rgb(sun ? P.sun : [220, 228, 255], strength * (0.25 + r() * 0.5) * (1 - k * 0.6));
        ctx.fillRect(x - len / 2, y, len, 1);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawBirds(P, dt) {
    if (P.birds > 0.3) nextFlock -= dt;
    if (!birdsFlock && nextFlock <= 0) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const n = 3 + (Math.random() * 5 | 0);
      const members = [];
      for (let i = 0; i < n; i++) {
        const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
        members.push({ dx: -row * 18 * dir, dy: row * 11 * side + (Math.random() - 0.5) * 6, ph: Math.random() * 6.28, s: 0.8 + Math.random() * 0.4 });
      }
      birdsFlock = { x: dir > 0 ? -80 : W + 80, y: HZ * (0.18 + Math.random() * 0.3), dir, v: 34 + Math.random() * 18, members };
      nextFlock = 22 + Math.random() * 30;
    }
    if (!birdsFlock) return;
    const f = birdsFlock;
    f.x += f.dir * f.v * dt * motion;
    f.y += Math.sin(clock * 0.4) * 0.08;
    ctx.strokeStyle = rgb(mix(P.land, [0, 0, 0], 0.3), 0.75 * clamp(P.birds * 1.5, 0, 1));
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const b of f.members) {
      const x = f.x + b.dx, y = f.y + b.dy;
      const flap = Math.sin(clock * 7 + b.ph);
      const s = 6 * b.s;
      ctx.moveTo(x - s, y - flap * s * 0.6);
      ctx.quadraticCurveTo(x - s * 0.45, y - s * 0.3 - flap * s * 0.2, x, y);
      ctx.quadraticCurveTo(x + s * 0.45, y - s * 0.3 - flap * s * 0.2, x + s, y - flap * s * 0.6);
    }
    ctx.stroke();
    if (f.x < -200 || f.x > W + 200) birdsFlock = null;
  }

  function drawForeground(P) {
    const shift = -mx * 22;
    const fg = mix(P.land, [2, 3, 8], 0.55);
    ctx.fillStyle = rgb(fg);

    // Bank
    ctx.beginPath();
    ctx.moveTo(-60, H + 2);
    for (let x = -60; x <= W + 60; x += 6) ctx.lineTo(x + shift, bankY(x));
    ctx.lineTo(W + 60, H + 2);
    ctx.closePath();
    ctx.fill();

    // Pines
    const wind = Math.sin(clock * 0.35 * motion) * 0.5 + Math.sin(clock * 0.13 * motion) * 0.5;
    for (const p of pines) {
      const sway = (Math.sin(clock * 0.9 * motion + p.phase) * 0.006 + wind * 0.008) * motion;
      ctx.save();
      ctx.translate(p.x + shift, bankY(p.x) + 6);
      ctx.transform(1, 0, sway, 1, 0, 0);
      const tw = Math.max(1.5, p.h * 0.018);
      ctx.fillRect(-tw, p.tiers[0].y, tw * 2, -p.tiers[0].y + 2);
      ctx.beginPath();
      ctx.moveTo(0, p.tiers[0].y + p.gap * 0.3);
      for (const T of p.tiers) {
        ctx.lineTo(-T.wl, T.y + p.gap * 0.25);
        ctx.lineTo(-T.wl * 0.32, T.y - p.gap * 0.55);
      }
      ctx.lineTo(0, -p.h);
      for (let i = p.tiers.length - 1; i >= 0; i--) {
        const T = p.tiers[i];
        ctx.lineTo(T.wr * 0.32, T.y - p.gap * 0.55);
        ctx.lineTo(T.wr, T.y + p.gap * 0.25);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Grass
    ctx.strokeStyle = rgb(fg);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (const b of grass) {
      const x = b.x + shift;
      const y = bankY(b.x) + 2;
      const sw = (Math.sin(clock * 1.3 * motion + b.x * 0.012 + b.ph * 0.2) + wind * 0.8) * b.h * 0.18 * motion;
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + b.lean * 0.4 + sw * 0.3, y - b.h * 0.55, x + b.lean + sw, y - b.h);
    }
    ctx.stroke();
  }

  function drawFireflies(P, dt) {
    if (P.flies < 0.03) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const f of flies) {
      f.dir += (Math.random() - 0.5) * 1.6 * dt;
      f.x += Math.cos(f.dir) * 12 * f.sp * dt * motion;
      f.y += Math.sin(f.dir) * 7 * f.sp * dt * motion;
      if (f.x < -10) f.x = W + 10; if (f.x > W + 10) f.x = -10;
      if (f.y < HZ + 10) f.dir = Math.abs(f.dir) % 3.14;
      if (f.y > H - 10) f.dir = -Math.abs(f.dir) % 3.14;
      const blink = Math.pow(Math.max(0, Math.sin(clock * f.sp * 1.3 + f.ph)), 3);
      const a = blink * P.flies;
      if (a < 0.02) continue;
      ctx.globalAlpha = a;
      const s = 22 * f.s;
      ctx.drawImage(glowSprite, f.x - mx * 30 - s / 2, f.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ================================================================
     Main loop
     ================================================================ */

  let last = performance.now();
  let dtCache = 0;
  let lastLabel = '';
  const clockEl = document.getElementById('clock');

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    dtCache = dt;
    clock += dt;

    if (tween) {
      const u = clamp((clock - tween.start) / tween.dur, 0, 1);
      t = lerp(tween.from, tween.to, easeInOut(u)) % 1;
      if (u >= 1) tween = null;
    } else if (mode === 'live') {
      t = realT();
    } else if (mode === 'flow') {
      t = (t + dt / FLOW_DAY_SECONDS) % 1;
    }

    mx += (tmx - mx) * Math.min(1, dt * 1.5);
    my += (tmy - my) * Math.min(1, dt * 1.5);

    const P = samplePalette(t);

    const sun = drawSky(P);
    drawClouds(P, dt);
    drawMountains(P, sun);

    ctx.drawImage(sceneC, 0, 0, sceneC.width, sceneC.height, 0, 0, W, HZ);
    drawLake(P, sun);
    drawBirds(P, dt);
    drawForeground(P);
    drawFireflies(P, dt);

    audio.setFactors(P.stars, P.birds);
    updateBreath();

    const hrs = t * 24, hh = Math.floor(hrs), mm = Math.floor((hrs - hh) * 60);
    const label = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${phaseName(t)}`;
    if (label !== lastLabel) { clockEl.textContent = label; lastLabel = label; }

    requestAnimationFrame(frame);
  }

  /* ================================================================
     Ambient sound (fully synthesized)
     ================================================================ */

  const audio = {
    ac: null, on: false, nf: 0, bf: 0,

    init() {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      this.ac = ac;
      const master = ac.createGain();
      master.gain.value = 0;
      master.connect(ac.destination);
      this.master = master;

      const verb = ac.createConvolver();
      verb.buffer = this.impulse(4);
      const wet = ac.createGain(); wet.gain.value = 0.55;
      verb.connect(wet).connect(master);
      this.verb = verb;

      const noise = this.brown(8);

      // Distant water / wind bed
      const water = ac.createBufferSource(); water.buffer = noise; water.loop = true;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.2;
      const wg = ac.createGain(); wg.gain.value = 0.5;
      water.connect(lp).connect(wg).connect(master);
      const lfo = ac.createOscillator(); lfo.frequency.value = 0.05;
      const lfoG = ac.createGain(); lfoG.gain.value = 170;
      lfo.connect(lfoG).connect(lp.frequency); lfo.start();

      // Gentle lapping at the shore
      const lap = ac.createBufferSource(); lap.buffer = noise; lap.loop = true; lap.playbackRate.value = 1.35;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 850; bp.Q.value = 0.8;
      const lg = ac.createGain(); lg.gain.value = 0.05;
      const lfo2 = ac.createOscillator(); lfo2.frequency.value = 0.12;
      const l2g = ac.createGain(); l2g.gain.value = 0.045;
      lfo2.connect(l2g).connect(lg.gain); lfo2.start();
      lap.connect(bp).connect(lg).connect(master);
      water.start(); lap.start();

      // Warm, slowly breathing pad (D major 9)
      const padF = ac.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 650;
      const padG = ac.createGain(); padG.gain.value = 0.03;
      padF.connect(padG); padG.connect(master); padG.connect(verb);
      [146.83, 220, 277.18, 329.63, 440].forEach((f, i) => {
        const o = ac.createOscillator();
        o.type = i % 2 ? 'sine' : 'triangle';
        o.frequency.value = f;
        o.detune.value = (Math.random() - 0.5) * 10;
        const g = ac.createGain(); const base = 0.45 / (i + 1) + 0.12; g.gain.value = base;
        const l = ac.createOscillator(); l.frequency.value = 0.02 + Math.random() * 0.05;
        const lgn = ac.createGain(); lgn.gain.value = base * 0.85;
        l.connect(lgn).connect(g.gain); l.start();
        o.connect(g).connect(padF); o.start();
      });

      this.loopChimes();
      this.loopCritters();
    },

    brown(sec) {
      const ac = this.ac, len = ac.sampleRate * sec;
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      let lastV = 0;
      for (let i = 0; i < len; i++) {
        lastV = (lastV + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = lastV * 3.5;
      }
      // Remove drift so the loop point is seamless
      const drift = d[len - 1] - d[0];
      for (let i = 0; i < len; i++) d[i] -= drift * (i / (len - 1));
      return buf;
    },

    impulse(sec) {
      const ac = this.ac, len = ac.sampleRate * sec;
      const buf = ac.createBuffer(2, len, ac.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      }
      return buf;
    },

    voice(pan) {
      const p = this.ac.createStereoPanner();
      p.pan.value = pan;
      p.connect(this.master);
      return p;
    },

    chime() {
      const ac = this.ac, t0 = ac.currentTime + 0.05;
      const notes = [587.33, 659.25, 739.99, 880, 987.77, 1174.66, 1318.51];
      const f = notes[(Math.random() * notes.length) | 0];
      const out = this.voice(Math.random() * 1.2 - 0.6);
      out.connect(this.verb);
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.035, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 6);
      g.connect(out);
      const o1 = ac.createOscillator(); o1.frequency.value = f; o1.connect(g);
      const o2 = ac.createOscillator(); o2.frequency.value = f * 2.76;
      const g2 = ac.createGain();
      g2.gain.setValueAtTime(0.25, t0); g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
      o2.connect(g2).connect(g);
      o1.start(t0); o2.start(t0); o1.stop(t0 + 6.2); o2.stop(t0 + 6.2);
    },

    cricket() {
      const ac = this.ac, t0 = ac.currentTime + 0.02;
      const out = this.voice(Math.random() * 1.6 - 0.8);
      const o = ac.createOscillator(); o.frequency.value = 4200 + Math.random() * 500;
      const g = ac.createGain(); g.gain.value = 0;
      const peak = 0.006 + 0.006 * this.nf;
      const pulses = 3 + (Math.random() * 3 | 0);
      for (let k = 0; k < pulses; k++) {
        const s = t0 + k * 0.065;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(peak, s + 0.008);
        g.gain.linearRampToValueAtTime(0, s + 0.04);
      }
      o.connect(g).connect(out);
      o.start(t0); o.stop(t0 + pulses * 0.065 + 0.1);
    },

    bird() {
      const ac = this.ac, t0 = ac.currentTime + 0.02;
      const out = this.voice(Math.random() * 1.6 - 0.8);
      out.connect(this.verb);
      const o = ac.createOscillator();
      const g = ac.createGain(); g.gain.value = 0;
      const base = 2300 + Math.random() * 900;
      const reps = 2 + (Math.random() * 3 | 0);
      for (let k = 0; k < reps; k++) {
        const s = t0 + k * 0.17;
        o.frequency.setValueAtTime(base, s);
        o.frequency.linearRampToValueAtTime(base * 1.55, s + 0.05);
        o.frequency.linearRampToValueAtTime(base * 1.15, s + 0.11);
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.012, s + 0.015);
        g.gain.linearRampToValueAtTime(0, s + 0.11);
      }
      o.connect(g).connect(out);
      o.start(t0); o.stop(t0 + reps * 0.17 + 0.1);
    },

    loopChimes() {
      setTimeout(() => { if (this.on) this.chime(); this.loopChimes(); }, 3500 + Math.random() * 7000);
    },

    loopCritters() {
      setTimeout(() => {
        if (this.on) {
          if (this.nf > 0.4 && Math.random() < this.nf) this.cricket();
          if (this.bf > 0.4 && Math.random() < this.bf * 0.3) this.bird();
        }
        this.loopCritters();
      }, 600 + Math.random() * 1800);
    },

    setFactors(nf, bf) { this.nf = nf; this.bf = bf; },

    toggle() {
      if (!this.ac) this.init();
      const now = this.ac.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      if (this.on) {
        this.master.gain.setTargetAtTime(0, now, 0.5);
        this.on = false;
      } else {
        this.ac.resume();
        this.master.gain.setTargetAtTime(0.9, now, 1.2);
        this.on = true;
      }
      return this.on;
    },
  };

  /* ================================================================
     Breathing guide: 4s in, 2s hold, 6s out
     ================================================================ */

  const ring = document.getElementById('ring');
  const breathText = document.getElementById('breathText');
  let breathing = false, breathStart = 0, breathWord = '';

  function updateBreath() {
    if (!breathing) return;
    const p = (clock - breathStart) % 12;
    let s, word;
    if (p < 4) { s = lerp(0.55, 1, easeInOut(p / 4)); word = 'breathe in'; }
    else if (p < 6) { s = 1; word = 'hold'; }
    else { s = lerp(1, 0.55, easeInOut((p - 6) / 6)); word = 'breathe out'; }
    ring.style.transform = `scale(${s.toFixed(4)})`;
    if (word !== breathWord) { breathText.textContent = word; breathWord = word; }
  }

  /* ================================================================
     Whispers
     ================================================================ */

  const whispers = [
    'Nothing to do. Nowhere to be.',
    'Let the water settle, and it becomes clear.',
    'The mountains are in no hurry.',
    'Breathe. You are here.',
    'Listen to the quiet between sounds.',
    'Every wave returns to the lake.',
    'Rest is part of the rhythm.',
    'Let your shoulders fall.',
  ];
  const whisperEl = document.getElementById('whisper');
  let wi = Math.floor(Math.random() * whispers.length);
  function cycleWhisper() {
    whisperEl.classList.remove('show');
    setTimeout(() => {
      wi = (wi + 1) % whispers.length;
      whisperEl.textContent = whispers[wi];
      whisperEl.classList.add('show');
    }, 3200);
  }
  setTimeout(cycleWhisper, 1200);
  setInterval(cycleWhisper, 18000);

  /* ================================================================
     Controls
     ================================================================ */

  const body = document.body;
  const soundBtn = document.getElementById('soundBtn');
  const breathBtn = document.getElementById('breathBtn');
  const hideBtn = document.getElementById('hideBtn');
  const segBtns = [...document.querySelectorAll('.seg button')];

  function setActive(key) {
    segBtns.forEach(b => b.classList.toggle('active', (b.dataset.time || b.dataset.mode) === key));
  }

  segBtns.forEach(b => b.addEventListener('click', () => {
    if (b.dataset.time) {
      goTo(PRESETS[b.dataset.time], 'hold');
      setActive(b.dataset.time);
    } else if (b.dataset.mode === 'live') {
      goTo(realT(), 'live');
      setActive('live');
    } else {
      tween = null; mode = 'flow';
      setActive('flow');
    }
  }));
  const startPreset = new URLSearchParams(location.search).get('t');
  if (startPreset in PRESETS) { t = PRESETS[startPreset]; mode = 'hold'; setActive(startPreset); }
  else setActive('live');

  function toggleSound() { soundBtn.setAttribute('aria-pressed', String(audio.toggle())); }
  function toggleBreath() {
    breathing = !breathing;
    if (breathing) { breathStart = clock; breathWord = ''; }
    body.classList.toggle('breathing', breathing);
    breathBtn.setAttribute('aria-pressed', String(breathing));
  }
  function toggleHidden(force) {
    const hidden = force !== undefined ? force : !body.classList.contains('hidden-ui');
    body.classList.toggle('hidden-ui', hidden);
    if (hidden) {
      body.classList.add('hint-on');
      setTimeout(() => body.classList.remove('hint-on'), 2800);
    }
  }

  soundBtn.addEventListener('click', toggleSound);
  breathBtn.addEventListener('click', toggleBreath);
  hideBtn.addEventListener('click', e => { e.stopPropagation(); toggleHidden(true); });
  canvas.addEventListener('click', () => { if (body.classList.contains('hidden-ui')) toggleHidden(false); });

  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 's') toggleSound();
    else if (k === 'b') toggleBreath();
    else if (k === 'h') toggleHidden();
    else if (k === 'f') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    }
  });

  // Fade the interface away when the viewer is still
  let idleTimer;
  function wake() {
    body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!document.querySelector('.dock:hover')) body.classList.add('idle');
    }, 4500);
  }
  ['pointermove', 'pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, wake, { passive: true }));
  wake();

  window.addEventListener('pointermove', e => {
    tmx = (e.clientX / W) * 2 - 1;
    tmy = (e.clientY / H) * 2 - 1;
  }, { passive: true });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  });

  buildGlow();
  resize();
  requestAnimationFrame(frame);
})();

// Page UI runs first; the 3D library loads after it, so the page is complete even if the CDN fails.
document.documentElement.classList.add('js');
let THREE, RoomEnvironment;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = reduceMQ.matches;

/* shared interaction state, read by the 3D scene */
let cut = 0;
let cutDone = false;
let variantChoice = 0;
let modelTouch = false;   // a finger is turning a 3D model, so swipes must not change slides
let three = null;
const wake = () => three && three.wake();

/* =========================================================
   Page UI (works with or without WebGL)
   ========================================================= */
const slides = $$('.slide');
const navLinks = $$('.nav nav a');

function initReveal() {
  // content re-enters every time its slide comes back, like a presentation
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting && e.intersectionRatio >= 0.2) {
        if (!e.target.classList.contains('in')) { e.target.classList.add('in'); $$('[data-count]', e.target).forEach(countUp); }
      } else if (!e.isIntersecting) e.target.classList.remove('in');
    });
  }, { threshold: [0, 0.2] });
  $$('[data-reveal]').forEach(el => io.observe(el));
}

function countUp(el) {
  const end = parseFloat(el.dataset.count);
  const dec = +(el.dataset.dec || 0);
  const pre = el.dataset.pre || '';
  const suf = el.dataset.suf || '';
  const fmt = v => pre + v.toFixed(dec) + suf;
  if (reduced) { el.textContent = fmt(end); return; }
  const t0 = performance.now();
  let last = '';
  const step = now => {
    const t = clamp((now - t0) / 1400, 0, 1);
    const s = fmt(end * (1 - Math.pow(1 - t, 3)));
    if (s !== last) { el.textContent = s; last = s; }
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function initDots() {
  const ol = $('.dots');
  slides.forEach((s, i) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#' + s.id;
    a.setAttribute('aria-label', `${i + 1}. ${s.dataset.title}`);
    const sp = document.createElement('span');
    sp.textContent = String(i).padStart(2, '0') + ' · ' + s.dataset.title;
    a.appendChild(sp);
    li.appendChild(a);
    ol.appendChild(li);
  });
}

let currentSlide = -1;
let lastProg = -1;
const progBar = $('.progress i');
const pagerN = $('.pager-n'), pagerUp = $('.pager .up'), pagerDown = $('.pager .down');
let pageTo = i => slides[clamp(i, 0, slides.length - 1)].scrollIntoView({ block: 'start' });
function updateChrome() {
  const max = document.documentElement.scrollHeight - innerHeight;
  const p = max > 0 ? scrollY / max : 0;
  if (Math.abs(p - lastProg) > 0.001) { progBar.style.transform = `scaleX(${p.toFixed(4)})`; lastProg = p; }
  const mid = scrollY + innerHeight * 0.5;
  let idx = 0;
  slides.forEach((s, i) => { if (s.offsetTop <= mid) idx = i; });
  if (idx !== currentSlide) {
    currentSlide = idx;
    $$('.dots a').forEach((a, i) => a.classList.toggle('on', i === idx));
    const id = slides[idx].id;
    navLinks.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + id));
    pagerN.innerHTML = `<b>${String(idx + 1).padStart(2, '0')}</b><i></i><span>${String(slides.length).padStart(2, '0')}</span>`;
    pagerUp.disabled = idx === 0;
    pagerDown.disabled = idx === slides.length - 1;
  }
}

function initKeys() {
  addEventListener('keydown', e => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(tag)) return;
    let dir = 0;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') dir = 1;
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') dir = -1;
    if (!dir) return;
    e.preventDefault();
    pageTo(currentSlide + dir);
  });
}

function initHold() {
  const btn = $('#hold');
  if (!btn) return;
  const bar = $('.hold-ring .bar', btn);
  const label = $('#hold-label');
  const result = $('#hold-result');
  const sec = $('#relay');
  const C = 2 * Math.PI * 26;
  let prog = 0, holding = false, raf = null, last = 0;

  const draw = () => { bar.style.strokeDashoffset = (C * (1 - prog)).toFixed(1); };
  function complete() {
    cutDone = true; holding = false; prog = 1; cut = 1;
    sec.classList.add('cut');
    btn.classList.remove('holding');
    btn.setAttribute('aria-pressed', 'true');
    label.textContent = 'Цепь разорвана';
    result.hidden = false;
    draw(); wake();
  }
  function step(now) {
    const dt = Math.min(300, now - (last || now));
    last = now;
    prog = holding ? Math.min(1, prog + dt / 1400) : Math.max(0, prog - dt / 700);
    cut = prog;
    draw(); wake();
    if (prog >= 1 && !cutDone) { complete(); raf = null; last = 0; return; }
    if ((holding && prog < 1) || (!holding && prog > 0)) raf = requestAnimationFrame(step);
    else { raf = null; last = 0; }
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(step); };
  function start() {
    if (cutDone) return;
    if (reduced) { complete(); return; }
    holding = true; btn.classList.add('holding'); kick();
  }
  function stop() {
    if (!holding) return;
    holding = false; btn.classList.remove('holding');
    if (!cutDone) kick();
  }
  btn.addEventListener('pointerdown', e => { e.preventDefault(); try { btn.setPointerCapture(e.pointerId); } catch (_) {} start(); });
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointercancel', stop);
  btn.addEventListener('lostpointercapture', stop);
  btn.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(); } });
  btn.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); stop(); } });
  btn.addEventListener('contextmenu', e => e.preventDefault());
  $('#hold-reset').addEventListener('click', () => {
    cutDone = false; prog = 0; cut = 0;
    sec.classList.remove('cut');
    btn.setAttribute('aria-pressed', 'false');
    label.textContent = 'Зажмите, чтобы разорвать цепь';
    result.hidden = true;
    draw(); wake(); btn.focus();
  });
  draw();
}

function initVariants() {
  const btns = $$('[data-variant]');
  btns.forEach(b => b.addEventListener('click', () => {
    variantChoice = +b.dataset.variant;
    btns.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $$('.vspec').forEach(s => { s.hidden = s.dataset.spec !== b.dataset.variant; });
    wake();
  }));
}

function initPaging() {
  // The page scrolls normally. The pager arrows, keyboard arrows and menu links glide to a whole slide.
  let lockUntil = 0;
  const idxAt = () => { const y = scrollY + 2; let i = 0; slides.forEach((s, k) => { if (s.offsetTop <= y) i = k; }); return i; };
  const insideTall = dir => {
    const s = slides[idxAt()];
    return dir > 0 ? scrollY + innerHeight < s.offsetTop + s.offsetHeight - 4 : scrollY > s.offsetTop + 4;
  };
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  function slideTo(top) {
    // one eased glide per slide, like a presentation; locked until it lands
    lockUntil = Infinity;
    const from = scrollY, dist = top - from, dur = reduced ? 0 : 900, t0 = performance.now();
    const step = now => {
      const t = dur ? clamp((now - t0) / dur, 0, 1) : 1;
      scrollTo({ top: from + dist * ease(t), behavior: 'instant' });
      if (t < 1) requestAnimationFrame(step);
      else lockUntil = performance.now() + 250;
    };
    requestAnimationFrame(step);
  }
  function go(dir, target) {
    const i = idxAt(), j = target ?? i + dir;
    if (j < 0 || j >= slides.length || j === i && target === undefined) return false;
    const n = slides[j];
    const top = j < i && n.offsetHeight > innerHeight + 4 ? n.offsetTop + n.offsetHeight - innerHeight : n.offsetTop;
    slideTo(top);
    return true;
  }
  pageTo = j => { if (performance.now() >= lockUntil) go(0, clamp(j, 0, slides.length - 1)); };
  pagerUp.addEventListener('click', () => pageTo(idxAt() - 1));
  pagerDown.addEventListener('click', () => pageTo(idxAt() + 1));
  // menu links and dots glide the same way
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    const k = slides.findIndex(sl => '#' + sl.id === a.getAttribute('href'));
    if (k < 0) return;
    e.preventDefault();
    pageTo(k);
  });
}

function initForm() {
  const f = $('#lead');
  f.addEventListener('submit', e => {
    e.preventDefault();
    let ok = true;
    ['name', 'contact'].forEach(n => {
      const el = f.elements[n];
      const bad = !el.value.trim();
      el.classList.toggle('err', bad);
      el.setAttribute('aria-invalid', String(bad));
      if (bad && ok) { el.focus(); ok = false; }
    });
    if (!ok) return;
    // Static site: no backend yet. The visitor sees the success state; nothing is sent.
    $('button[type=submit]', f).disabled = true;
    $('.form-ok', f).hidden = false;
  });
}

initDots();
initReveal();
initKeys();
initHold();
initVariants();
initForm();
initPaging();
document.addEventListener('visibilitychange', () => document.body.classList.toggle('paused', document.hidden));

/* =========================================================
   The 3D presentation
   ========================================================= */
// Each slide declares a scene. A scene says which model is on stage (mS, mPi, mCam, mRtr, mEsp),
// where the stage sits (x, y as a fraction of the half viewport, s scale) and what the story layer does.
const BASE = { x: 0, y: 0, s: 1, ry: -0.4, rx: 0.12, spin: 0.6, explode: 0, labels: 0, dim: 0, vsel: 0,
  mS: 0, mPi: 0, mCam: 0, mRtr: 0, mEsp: 0, lineup: 0, net: 0, threat: 0, ml: 0, honey: 0, cutw: 0 };
const SCENES = {
  hero:     { x: 0.44, s: 1.15, ry: -0.5, rx: 0.42, spin: 0.8, mS: 1 },
  problem:  { x: 0.46, s: 1.2, ry: -0.9, rx: 0.22, spin: 0.1, mCam: 1, threat: 1 },
  solution: { x: -0.44, s: 0.9, ry: 0.3, rx: 0.32, spin: 0.45, mS: 1, mCam: 1, mRtr: 1, lineup: 1, net: 1 },
  ml:       { x: -0.44, s: 1.1, ry: 0.3, rx: 0.45, spin: 0.3, mPi: 1, ml: 1 },
  relay:    { x: 0.46, s: 1.2, ry: -0.85, rx: 0.2, spin: 0.05, mCam: 1, threat: 1, cutw: 1 },
  honey:    { x: -0.44, s: 1.0, ry: 0.25, rx: 0.2, spin: 0.3, mEsp: 1, honey: 1 },
  inside:   { x: 0.42, s: 1.0, ry: 0.95, rx: 0.4, spin: 0, mS: 1, explode: 1, labels: 1 },
  parts:    { x: 0.62, y: 0.25, s: 0.55, ry: 0.3, rx: 0.4, spin: 0.3, mPi: 1, dim: 0.7 },
  variants: { x: 0.44, s: 1.15, ry: -0.35, rx: 0.42, spin: 0.4, mS: 1, vsel: 1 },
  compete:  { x: 0.62, y: 0.1, s: 0.6, rx: 0.42, spin: 0.6, mS: 1, dim: 0.65 },
  market:   { x: 0.6, s: 0.62, spin: 0.6, mRtr: 1, dim: 0.6 },
  model:    { x: 0.62, y: -0.1, s: 0.6, spin: 0.6, mEsp: 1, dim: 0.65 },
  forecast: { x: -0.6, s: 0.6, rx: 0.4, spin: 0.6, mPi: 1, dim: 0.65 },
  roadmap:  { x: 0.6, s: 0.6, spin: 0.6, mCam: 1, dim: 0.6 },
  ask:      { x: 0.45, s: 1.15, ry: -0.45, rx: 0.42, spin: 0.9, mS: 1, net: 1 },
  contact:  { x: 0.6, s: 0.6, rx: 0.42, spin: 0.6, mS: 1, dim: 0.7 }
};
const MODEL_KEYS = ['mS', 'mPi', 'mCam', 'mRtr', 'mEsp'];
const KEYS = Object.keys(BASE);
for (const k in SCENES) SCENES[k] = { ...BASE, ...SCENES[k] };

function makeRng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function initThree() {
  const canvas = $('#scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  const dpr = () => Math.min(devicePixelRatio || 1, innerWidth < 760 ? 1.5 : 1.75);
  renderer.setPixelRatio(dpr());
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(0, 0, 10);

  scene.add(new THREE.HemisphereLight(0x9fc3ff, 0x0a1322, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(4, 5, 6); scene.add(key);
  const rimG = new THREE.PointLight(0x33d69f, 9, 14, 1.6); rimG.position.set(-3, -1.2, 3); scene.add(rimG);
  const rimV = new THREE.PointLight(0x8c7dff, 2.2, 14, 1.6); rimV.position.set(3, 2.4, -2); scene.add(rimV);

  /* ---------- materials ---------- */
  const EMERALD = new THREE.Color(0x33d69f);
  const RED = new THREE.Color(0xff5a5f);
  const GRAY = new THREE.Color(0x4a5874);
  const VIOLET = new THREE.Color(0x8c7dff);
  const M = {
    shell: new THREE.MeshPhysicalMaterial({ color: 0x1b2a44, metalness: 0.35, roughness: 0.36, clearcoat: 0.8, clearcoatRoughness: 0.25, envMapIntensity: 0.7 }),
    frame: new THREE.MeshPhysicalMaterial({ color: 0x24355a, metalness: 0.45, roughness: 0.42, clearcoat: 0.5, envMapIntensity: 0.7, transparent: true }),
    vent: new THREE.MeshStandardMaterial({ color: 0x050a14, roughness: 0.9 }),
    port: new THREE.MeshStandardMaterial({ color: 0x0b111d, roughness: 0.6 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xc07a3c, metalness: 0.85, roughness: 0.35 }),
    ant: new THREE.MeshStandardMaterial({ color: 0x2b3150, metalness: 0.3, roughness: 0.5 }),
    tip: new THREE.MeshBasicMaterial({ color: 0x8c7dff, toneMapped: false }),
    glow: new THREE.MeshBasicMaterial({ color: 0x33d69f, toneMapped: false }),
    led: new THREE.MeshBasicMaterial({ color: 0x33d69f, toneMapped: false }),
    pi: new THREE.MeshStandardMaterial({ color: 0x2c8a50, roughness: 0.55, metalness: 0.1 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xcfd5de, metalness: 0.92, roughness: 0.28 }),
    chip: new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.45, metalness: 0.2 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0f1116, roughness: 0.6 }),
    relay: new THREE.MeshStandardMaterial({ color: 0x2357d6, roughness: 0.35, metalness: 0.1 }),
    node: new THREE.MeshStandardMaterial({ color: 0x1a2438, roughness: 0.55, metalness: 0.3 })
  };

  // PCB texture, drawn once with a seeded generator so it is identical every load
  function pcbTexture(base) {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, 512, 512);
    const rnd = makeRng(7);
    g.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = `rgba(80,200,150,${0.18 + rnd() * 0.25})`;
      g.lineWidth = 1 + rnd() * 2.2;
      let x = rnd() * 512, y = rnd() * 512;
      g.beginPath(); g.moveTo(x, y);
      for (let j = 0; j < 4; j++) {
        if (rnd() > 0.5) x += (rnd() - 0.5) * 220; else y += (rnd() - 0.5) * 220;
        g.lineTo(x, y);
      }
      g.stroke();
      g.fillStyle = 'rgba(214,176,90,.85)';
      g.beginPath(); g.arc(x, y, 2.6, 0, TAU); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  const pcbTex = pcbTexture('#0d3f30');
  pcbTex.repeat.set(0.4, 0.4); pcbTex.offset.set(0.5, 0.5);
  M.pcb = new THREE.MeshStandardMaterial({ map: pcbTex, roughness: 0.6, metalness: 0.15 });

  /* ---------- shapes ---------- */
  function triPath(R, cr, Cls = THREE.Shape) {
    const pts = [0, 1, 2].map(i => { const a = Math.PI / 2 + i * TAU / 3; return new THREE.Vector2(Math.cos(a) * R, Math.sin(a) * R); });
    const s = new Cls();
    for (let i = 0; i < 3; i++) {
      const p = pts[i], prev = pts[(i + 2) % 3], next = pts[(i + 1) % 3];
      const a = p.clone().add(prev.clone().sub(p).normalize().multiplyScalar(cr));
      const b = p.clone().add(next.clone().sub(p).normalize().multiplyScalar(cr));
      if (i === 0) s.moveTo(a.x, a.y); else s.lineTo(a.x, a.y);
      s.quadraticCurveTo(p.x, p.y, b.x, b.y);
    }
    s.closePath();
    return s;
  }
  function rrectPath(w, h, r, Cls = THREE.Shape) {
    const s = new Cls(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  function shieldMeshes(scale) {
    const k = scale;
    const outer = new THREE.Shape();
    const pts = (s, sh) => {
      sh.moveTo(0, .34 * s); sh.quadraticCurveTo(.13 * s, .27 * s, .27 * s, .26 * s); sh.lineTo(.27 * s, .02 * s);
      sh.quadraticCurveTo(.25 * s, -.24 * s, 0, -.38 * s); sh.quadraticCurveTo(-.25 * s, -.24 * s, -.27 * s, .02 * s);
      sh.lineTo(-.27 * s, .26 * s); sh.quadraticCurveTo(-.13 * s, .27 * s, 0, .34 * s);
    };
    pts(k, outer);
    const hole = new THREE.Path(); pts(k * 0.8, hole); outer.holes.push(hole);
    const half = new THREE.Shape(); const s = k * 0.62;
    half.moveTo(0, .34 * s); half.quadraticCurveTo(-.13 * s, .27 * s, -.27 * s, .26 * s); half.lineTo(-.27 * s, .02 * s);
    half.quadraticCurveTo(-.25 * s, -.24 * s, 0, -.38 * s); half.lineTo(0, .34 * s);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.ShapeGeometry(outer, 16), M.glow));
    g.add(new THREE.Mesh(new THREE.ShapeGeometry(half, 16), M.glow));
    return g;
  }
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const glowLine = (shape, z) => {
    const geo = new THREE.BufferGeometry().setFromPoints(shape.getPoints(24));
    const l = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0x33d69f, transparent: true, opacity: 0.85, toneMapped: false }));
    l.position.z = z; return l;
  };
  function antenna(len) {
    const g = new THREE.Group();
    const hinge = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 14), M.ant); g.add(hinge);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, len, 18), M.ant); stick.position.y = len / 2 + 0.04; g.add(stick);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.012, 8, 24), M.tip); ring.rotation.x = Math.PI / 2; ring.position.y = len * 0.55; g.add(ring);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.048, 16, 12), M.tip); tip.position.y = len + 0.06; g.add(tip);
    g.userData.tip = tip;
    return g;
  }

  /* ---------- the triangular flagship ---------- */
  const R = 1.25, CR = 0.34, D = 0.44;
  const extrude = (shape, depth, bevel) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: !!bevel, bevelThickness: bevel || 0, bevelSize: bevel || 0, bevelSegments: 4, curveSegments: 20 });

  const tri = new THREE.Group();
  const frameShape = triPath(R, CR); frameShape.holes.push(triPath(R - 0.15, CR * 0.75, THREE.Path));
  const frameGeo = extrude(frameShape, D, 0.035); frameGeo.translate(0, 0, -D / 2);
  const frame = new THREE.Mesh(frameGeo, M.frame); tri.add(frame);

  const front = new THREE.Group(); tri.add(front);
  const coverGeo = extrude(triPath(R - 0.03, CR * 0.95), 0.035, 0.012);
  const fc = new THREE.Mesh(coverGeo, M.shell); fc.position.z = D / 2 - 0.01; front.add(fc);
  const logo = shieldMeshes(0.75); logo.position.set(0, 0.1, D / 2 + 0.042); front.add(logo);
  front.add(glowLine(triPath(R - 0.22, CR * 0.8), D / 2 + 0.041));
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), M.led); led.position.set(0.42, -0.47, D / 2 + 0.042); front.add(led);

  const back = new THREE.Group(); tri.add(back);
  const bc = new THREE.Mesh(coverGeo, M.shell); bc.position.z = -D / 2 - 0.025; back.add(bc);

  // the device lies flat like a Wi-Fi router: one antenna on each of the three sides, all pointing up
  const UP = new THREE.Vector3(0, 1, 0);
  const tipsTri = [];
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + i * TAU / 3;
    const ant = antenna(0.95);
    ant.position.set(Math.cos(a) * (R - 0.1), Math.sin(a) * (R - 0.1), 0);
    ant.quaternion.setFromUnitVectors(UP, new THREE.Vector3(Math.cos(a) * 0.16, Math.sin(a) * 0.16, 1).normalize());
    tri.add(ant); tipsTri.push(ant.userData.tip);
  }
  // vents on the two slanted faces
  for (const [i0, i1] of [[0, 1], [0, 2]]) {
    const a0 = Math.PI / 2 + i0 * TAU / 3, a1 = Math.PI / 2 + i1 * TAU / 3;
    const p0 = new THREE.Vector2(Math.cos(a0) * R, Math.sin(a0) * R), p1 = new THREE.Vector2(Math.cos(a1) * R, Math.sin(a1) * R);
    const dir = p1.clone().sub(p0).normalize();
    const n = new THREE.Vector2(dir.y, -dir.x); if (n.dot(p0.clone().add(p1).multiplyScalar(0.5)) < 0) n.negate();
    for (let k = 0; k < 7; k++) {
      const t = 0.32 + k * 0.06;
      const p = p0.clone().lerp(p1, t);
      const slot = box(0.032, 0.012, 0.3, M.vent);
      slot.position.set(p.x + n.x * 0.04, p.y + n.y * 0.04, 0);
      slot.rotation.z = Math.atan2(dir.y, dir.x);
      tri.add(slot);
    }
  }
  // ports on the flat base
  [-0.38, 0, 0.38].forEach((x, i) => {
    const p = box(i === 2 ? 0.14 : 0.22, 0.03, 0.12, M.port); p.position.set(x, -R / 2 - 0.042, 0); tri.add(p);
    const c = box(i === 2 ? 0.08 : 0.16, 0.012, 0.07, M.copper); c.position.set(x, -R / 2 - 0.06, 0); tri.add(c);
  });

  // internals
  const inner = new THREE.Group(); tri.add(inner);
  const boardShape = triPath(R - 0.25, CR * 0.65);
  const topBoard = new THREE.Group(); inner.add(topBoard);
  const tb = new THREE.Mesh(extrude(boardShape, 0.025), M.pcb); tb.position.z = -0.02; topBoard.add(tb);
  const anchors = {};
  // Raspberry Pi
  const pi = new THREE.Group(); pi.position.set(0, -0.12, 0.005); topBoard.add(pi);
  const piB = box(0.82, 0.55, 0.03, M.pi); piB.position.z = 0.015; pi.add(piB);
  const soc = box(0.19, 0.19, 0.03, M.silver); soc.position.set(-0.1, 0.02, 0.045); pi.add(soc);
  for (let f = 0; f < 5; f++) { const fin = box(0.19, 0.016, 0.07, M.silver); fin.position.set(-0.1, -0.07 + f * 0.045, 0.095); pi.add(fin); }
  const ram = box(0.15, 0.12, 0.022, M.chip); ram.position.set(0.12, 0.02, 0.041); pi.add(ram);
  const eth = box(0.17, 0.16, 0.13, M.silver); eth.position.set(0.31, -0.13, 0.095); pi.add(eth);
  const usb = box(0.15, 0.13, 0.11, M.silver); usb.position.set(0.31, 0.08, 0.085); pi.add(usb);
  const gpio = box(0.58, 0.04, 0.06, M.black); gpio.position.set(-0.06, 0.24, 0.06); pi.add(gpio);
  anchors.pi = new THREE.Object3D(); anchors.pi.position.set(-0.1, 0.02, 0.14); pi.add(anchors.pi);
  // three ESP32-C3 in the corners
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + i * TAU / 3;
    const e = new THREE.Group();
    const rr = i === 0 ? 0.6 : 0.68;
    e.position.set(Math.cos(a) * rr, Math.sin(a) * rr + (i === 0 ? 0 : 0.03), 0.005);
    e.rotation.z = a - Math.PI / 2;
    const eb = box(0.17, 0.25, 0.02, M.black); eb.position.z = 0.01; e.add(eb);
    const es = box(0.13, 0.14, 0.025, M.silver); es.position.set(0, -0.03, 0.032); e.add(es);
    const ea = box(0.12, 0.04, 0.005, M.copper); ea.position.set(0, 0.095, 0.022); e.add(ea);
    topBoard.add(e);
    if (i === 0) { anchors.esp = new THREE.Object3D(); anchors.esp.position.set(0, 0, 0.06); e.add(anchors.esp); }
  }
  const bottomBoard = new THREE.Group(); inner.add(bottomBoard);
  const bb = new THREE.Mesh(extrude(boardShape, 0.025), M.pcb); bb.position.z = -0.2; bottomBoard.add(bb);
  const relay = box(0.27, 0.2, 0.12, M.relay); relay.position.set(-0.36, -0.28, -0.115); bottomBoard.add(relay);
  const part = box(0.02, 0.32, 0.12, M.frame); part.position.set(-0.17, -0.25, -0.115); bottomBoard.add(part);
  const tpm = box(0.1, 0.1, 0.02, M.chip); tpm.position.set(0.02, 0.1, -0.165); bottomBoard.add(tpm);
  const dc = box(0.24, 0.17, 0.02, M.black); dc.position.set(0.38, -0.28, -0.165); bottomBoard.add(dc);
  const ind = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 20), M.copper); ind.rotation.x = Math.PI / 2; ind.position.set(0.36, -0.28, -0.125); bottomBoard.add(ind);
  anchors.relay = new THREE.Object3D(); anchors.relay.position.set(-0.36, -0.28, -0.05); bottomBoard.add(anchors.relay);
  anchors.tpm = new THREE.Object3D(); anchors.tpm.position.set(0.02, 0.1, -0.15); bottomBoard.add(anchors.tpm);
  anchors.power = new THREE.Object3D(); anchors.power.position.set(0.38, -0.28, -0.09); bottomBoard.add(anchors.power);

  /* ---------- the rectangular prototype ---------- */
  const rect = new THREE.Group();
  const W = 2.5, H = 1.5;
  const rf = rrectPath(W, H, 0.22); rf.holes.push(rrectPath(W - 0.3, H - 0.3, 0.14, THREE.Path));
  const rfg = extrude(rf, D, 0.035); rfg.translate(0, 0, -D / 2);
  rect.add(new THREE.Mesh(rfg, M.frame));
  const rcg = extrude(rrectPath(W - 0.05, H - 0.05, 0.2), 0.035, 0.012);
  const rc1 = new THREE.Mesh(rcg, M.shell); rc1.position.z = D / 2 - 0.01; rect.add(rc1);
  const rc2 = new THREE.Mesh(rcg, M.shell); rc2.position.z = -D / 2 - 0.025; rect.add(rc2);
  const rlogo = shieldMeshes(0.75); rlogo.position.set(0, 0.04, D / 2 + 0.042); rect.add(rlogo);
  rect.add(glowLine(rrectPath(W - 0.4, H - 0.4, 0.12), D / 2 + 0.041));
  const rled = new THREE.Mesh(new THREE.CircleGeometry(0.035, 20), M.led); rled.position.set(W / 2 - 0.3, -H / 2 + 0.28, D / 2 + 0.042); rect.add(rled);
  const tipsRect = [];
  [-0.85, 0.85].forEach(x => {
    const a = antenna(0.95); a.position.set(x, H / 2 - 0.05, 0);
    a.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.sign(x) * 0.14, 0.1, 1).normalize());
    rect.add(a); tipsRect.push(a.userData.tip);
  });
  for (let k = 0; k < 7; k++) { const v = box(0.035, 0.012, 0.3, M.vent); v.position.set(-0.54 + k * 0.18, H / 2 + 0.04, 0); rect.add(v); }
  [-0.6, 0, 0.6].forEach((x, i) => {
    const p = box(i === 2 ? 0.14 : 0.22, 0.03, 0.12, M.port); p.position.set(x, -H / 2 - 0.042, 0); rect.add(p);
    const c = box(i === 2 ? 0.08 : 0.16, 0.012, 0.07, M.copper); c.position.set(x, -H / 2 - 0.06, 0); rect.add(c);
  });

  const device = new THREE.Group();
  device.add(tri, rect);
  // lay both bodies flat: the shield face becomes the top, the antennas stand up
  for (const b of [tri, rect]) { b.rotation.x = -Math.PI / 2; b.position.y = -0.35; }
  rect.scale.setScalar(0.001); rect.visible = false;

  /* ---------- shared helpers for the other models ---------- */
  M.gold = new THREE.MeshStandardMaterial({ color: 0xd8ad55, metalness: 0.9, roughness: 0.3 });
  M.alu = new THREE.MeshStandardMaterial({ color: 0xb9c2cf, metalness: 0.85, roughness: 0.35 });
  M.white = new THREE.MeshPhysicalMaterial({ color: 0xbfc8d4, roughness: 0.42, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  M.rubber = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.8 });
  M.glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1426, roughness: 0.05, metalness: 0.3, clearcoat: 1 });
  M.blue = new THREE.MeshStandardMaterial({ color: 0x2f6fe0, roughness: 0.4 });
  M.yellow = new THREE.MeshStandardMaterial({ color: 0xe9b949, roughness: 0.5 });
  M.espPcb = new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 0.5, metalness: 0.15 });
  const _m4 = new THREE.Matrix4();
  const cyl = (rt, rb, h, m, seg = 24) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  const glowMat = color => new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true });
  const at = (mesh, x, y, z) => { mesh.position.set(x, y, z); return mesh; };

  /* ---------- Raspberry Pi 4 ---------- */
  function buildPi() {
    const g = new THREE.Group();
    const tex = pcbTexture('#1d6b41');
    const boardTop = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.1 });
    const W = 2.3, H = 1.52;
    g.add(new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.05), [M.pi, M.pi, M.pi, M.pi, boardTop, M.pi]));
    [[-1.02, 0.63], [0.55, 0.63], [-1.02, -0.63], [0.55, -0.63]].forEach(([x, y]) => g.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.022, 8, 20), M.gold), x, y, 0.03)));
    g.add(at(box(0.36, 0.36, 0.05, M.silver), -0.3, 0.02, 0.05));
    for (let i = 0; i < 6; i++) g.add(at(box(0.36, 0.025, 0.16, M.alu), -0.3, -0.14 + i * 0.056, 0.15));
    g.add(at(box(0.3, 0.24, 0.04, M.chip), 0.15, 0.02, 0.045));
    g.add(at(box(0.3, 0.24, 0.04, M.silver), -0.82, 0.25, 0.045));
    g.add(at(box(1.5, 0.12, 0.1, M.black), -0.25, 0.63, 0.075));
    const pins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.018, 0.018, 0.16), M.gold, 40);
    for (let i = 0; i < 40; i++) { _m4.makeTranslation(-0.96 + (i >> 1) * 0.0745, 0.63 + (i % 2 ? 0.03 : -0.03), 0.17); pins.setMatrixAt(i, _m4); }
    g.add(pins);
    g.add(at(box(0.44, 0.4, 0.34, M.silver), 1.0, -0.46, 0.2));
    g.add(at(box(0.02, 0.22, 0.2, M.black), 1.225, -0.46, 0.2));
    g.add(at(box(0.4, 0.34, 0.36, M.silver), 1.0, -0.02, 0.21));
    g.add(at(box(0.4, 0.34, 0.36, M.silver), 1.0, 0.4, 0.21));
    [-0.1, 0.06].forEach(d => g.add(at(box(0.02, 0.05, 0.26, M.blue), 1.205, -0.02 + d, 0.21)));
    [-0.1, 0.06].forEach(d => g.add(at(box(0.02, 0.05, 0.26, M.black), 1.205, 0.4 + d, 0.21)));
    g.add(at(box(0.18, 0.1, 0.07, M.silver), -0.85, -0.72, 0.07));
    [-0.48, -0.18].forEach(x => g.add(at(box(0.16, 0.1, 0.06, M.silver), x, -0.72, 0.065)));
    g.add(at(box(0.2, 0.16, 0.14, M.black), 0.3, -0.62, 0.09));
    g.add(at(cyl(0.06, 0.06, 0.12, M.black), 0.3, -0.74, 0.1));
    g.add(at(box(0.06, 0.42, 0.07, M.black), -1.05, -0.05, 0.06));
    g.add(at(box(0.06, 0.42, 0.07, M.black), 0.55, -0.35, 0.06));
    const smd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.03, 0.02), M.chip, 36);
    const rnd = makeRng(11);
    for (let i = 0; i < 36; i++) { _m4.makeTranslation(-1.0 + rnd() * 1.6, -0.6 + rnd() * 0.5, 0.035); smd.setMatrixAt(i, _m4); }
    g.add(smd);
    // Edge ML visuals: a scan beam sweeping the board and a glow ring around the SoC
    const beam = at(new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.035), glowMat(0x33d69f)), 0, 0, 0.32);
    const beamGlow = at(new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.22), glowMat(0x33d69f)), 0, 0, 0.31);
    beamGlow.material.opacity = 0.12;
    g.add(beam, beamGlow);
    const socRing = at(new THREE.Mesh(new THREE.RingGeometry(0.3, 0.33, 4, 1, Math.PI / 4), glowMat(0xff5a5f)), -0.3, 0.02, 0.26);
    g.add(socRing);
    g.userData = { beam, beamGlow, socRing };
    return g;
  }

  /* ---------- IP camera (outdoor bullet camera) ---------- */
  function buildCam() {
    const g = new THREE.Group();
    const plastic = new THREE.MeshPhysicalMaterial({ color: 0xc6ccd4, roughness: 0.55, metalness: 0.02, clearcoat: 0.25, clearcoatRoughness: 0.5 });
    const darkGloss = new THREE.MeshPhysicalMaterial({ color: 0x0c0f14, roughness: 0.18, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1 });
    const lensGlass = new THREE.MeshPhysicalMaterial({ color: 0x101830, roughness: 0.02, metalness: 0.1, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 600] });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.9, roughness: 0.3 });
    // housing: lathe profile, rounded at the back, slightly flared at the front
    const prof = [[0, -0.74], [0.12, -0.735], [0.23, -0.71], [0.31, -0.66], [0.355, -0.58], [0.37, -0.45], [0.37, 0.48], [0.385, 0.52], [0.395, 0.6], [0.395, 0.64], [0.34, 0.645]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    g.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 64).rotateX(Math.PI / 2), plastic));
    // seam ring between housing and front cap
    g.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.372, 0.008, 8, 64), darkGloss), 0, 0, 0.42));
    // sun hood: a curved shell over the top that overhangs the glass
    const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 1.12, 64, 1, true, Math.PI / 2 + 0.32, Math.PI - 0.64).rotateX(Math.PI / 2), plastic);
    hood.material = plastic.clone(); hood.material.side = THREE.DoubleSide;
    g.add(at(hood, 0, 0.01, 0.2));
    const hoodLip = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.012, 6, 64, Math.PI - 0.64), plastic);
    hoodLip.rotation.z = 0.32; g.add(at(hoodLip, 0, 0.01, 0.76));
    // front: glossy black face, IR LED ring, lens barrel, coated glass
    g.add(at(new THREE.Mesh(new THREE.CircleGeometry(0.345, 64), darkGloss), 0, 0, 0.646));
    const irMat = new THREE.MeshPhysicalMaterial({ color: 0x5a1a22, roughness: 0.15, clearcoat: 1, emissive: 0x3a0a10 });
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU;
      g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.026, 14, 10, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI / 2), irMat), Math.cos(a) * 0.25, Math.sin(a) * 0.25, 0.648));
    }
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.15, 0.09, 48).rotateX(Math.PI / 2), darkGloss), 0, 0, 0.69));
    g.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.01, 8, 48), metal), 0, 0, 0.735));
    g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.1, 40, 24).scale(1, 1, 0.45), lensGlass), 0, 0, 0.73));
    const ring = at(new THREE.Mesh(new THREE.TorusGeometry(0.138, 0.007, 8, 64), glowMat(0x33d69f)), 0, 0, 0.737);
    g.add(ring);
    g.add(at(new THREE.Mesh(new THREE.CircleGeometry(0.022, 16), darkGloss), 0, 0.3, 0.652));
    const led = at(new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 10), glowMat(0x33d69f)), 0.12, 0.3, 0.652);
    g.add(led);
    // mount: saddle on the hood, arm, ball joint and a ceiling plate with screws
    g.add(at(box(0.22, 0.06, 0.34, plastic), 0, 0.455, -0.22));
    g.add(at(cyl(0.055, 0.065, 0.32, plastic), 0, 0.62, -0.22));
    g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.095, 24, 16), plastic), 0, 0.8, -0.22));
    g.add(at(cyl(0.07, 0.07, 0.12, metal), 0, 0.9, -0.22));
    g.add(at(cyl(0.34, 0.36, 0.06, plastic, 48), 0, 0.98, -0.22));
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + 0.5; g.add(at(cyl(0.025, 0.025, 0.012, metal, 12), Math.cos(a) * 0.25, 0.955, -0.22 + Math.sin(a) * 0.25)); }
    // cable: rubber gland at the back, the camera half stays, the plug half drops when the relay opens the circuit
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.12, 20), M.rubber), 0, -0.3, -0.6));
    const cut = new THREE.Vector3(0, -0.85, -0.95);
    const tube = (pts, r = 0.032) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), 40, r, 12), M.rubber);
    g.add(tube([[0, -0.34, -0.62], [0, -0.48, -0.72], [0, -0.66, -0.9], cut.toArray()]));
    const plugSide = new THREE.Group();
    plugSide.add(tube([cut.toArray(), [0, -1.1, -0.9], [0, -1.35, -0.62], [0, -1.45, -0.3]]));
    plugSide.add(at(box(0.14, 0.11, 0.06, M.rubber), 0, -1.45, -0.24));
    plugSide.add(at(box(0.15, 0.12, 0.26, new THREE.MeshPhysicalMaterial({ color: 0xdbe8f2, roughness: 0.08, transmission: 0.55, thickness: 0.2 })), 0, -1.45, -0.08));
    for (let i = 0; i < 6; i++) plugSide.add(at(box(0.012, 0.03, 0.05, M.gold), -0.045 + i * 0.018, -1.42, 0.03));
    g.add(plugSide);
    const spark = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.09, 32), glowMat(0xff5a5f));
    spark.material.side = THREE.DoubleSide; spark.material.opacity = 0;
    spark.position.copy(cut); g.add(spark);
    g.userData = { ring, led, irMat, plugSide, spark, cut };
    return g;
  }

  /* ---------- Wi-Fi router ---------- */
  function buildRouter() {
    const g = new THREE.Group();
    const inner = new THREE.Group(); inner.rotation.x = 0.45; g.add(inner);
    const geo = extrude(rrectPath(2.0, 1.25, 0.18), 0.24, 0.04); geo.rotateX(-Math.PI / 2); geo.translate(0, -0.12, 0);
    inner.add(new THREE.Mesh(geo, M.shell));
    inner.add(at(box(1.7, 0.004, 0.02, glowMat(0x33d69f)), 0, 0.165, 0.5));
    for (let i = 0; i < 12; i++) inner.add(at(box(0.6, 0.006, 0.025, M.vent), 0.1, 0.165, -0.45 + i * 0.05));
    const leds = [];
    for (let i = 0; i < 6; i++) { const m = glowMat(0x33d69f); leds.push(m); inner.add(at(box(0.07, 0.025, 0.02, m), -0.5 + i * 0.2, 0.0, 0.67)); }
    [-0.75, -0.25, 0.25, 0.75].forEach((x, i) => {
      const a = new THREE.Group(); a.position.set(x, 0.05, -0.6); a.rotation.z = (i - 1.5) * 0.12; a.rotation.x = -0.15;
      a.add(at(box(0.12, 0.12, 0.08, M.rubber), 0, 0.02, 0));
      a.add(at(box(0.1, 1.0, 0.035, M.rubber), 0, 0.55, 0));
      inner.add(a);
    });
    [-0.6, -0.35, -0.1, 0.15].forEach(x => inner.add(at(box(0.16, 0.1, 0.03, M.yellow), x, -0.02, -0.64)));
    inner.add(at(box(0.16, 0.1, 0.03, M.blue), 0.5, -0.02, -0.64));
    g.userData = { leds };
    return g;
  }

  /* ---------- ESP32 dev board ---------- */
  function buildEsp() {
    const g = new THREE.Group();
    g.add(box(1.05, 2.3, 0.06, M.espPcb));
    [-0.45, 0.45].forEach(x => {
      g.add(at(box(0.1, 1.95, 0.1, M.black), x, -0.08, -0.08));
      const pins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.03, 0.34), M.gold, 19);
      const pads = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.01, 12).rotateX(Math.PI / 2), M.gold, 19);
      for (let i = 0; i < 19; i++) { const y = -1.0 + i * 0.1; _m4.makeTranslation(x, y, -0.2); pins.setMatrixAt(i, _m4); _m4.makeTranslation(x, y, 0.035); pads.setMatrixAt(i, _m4); }
      g.add(pins, pads);
    });
    g.add(at(box(0.74, 0.98, 0.03, M.chip), 0, 0.6, 0.045));
    g.add(at(box(0.62, 0.66, 0.07, M.silver), 0, 0.42, 0.09));
    const ant = new THREE.Group(); ant.position.set(0, 0.98, 0.065);
    ant.add(box(0.56, 0.02, 0.006, M.gold));
    for (let i = 0; i < 6; i++) ant.add(at(box(0.02, 0.14, 0.006, M.gold), -0.26 + i * 0.104, 0.06 * (i % 2 ? 1 : -1) + 0.0, 0));
    g.add(ant);
    g.add(at(box(0.3, 0.18, 0.12, M.silver), 0, -1.12, 0.09));
    [-0.32, 0.32].forEach(x => { g.add(at(box(0.16, 0.16, 0.06, M.silver), x, -0.92, 0.06)); g.add(at(cyl(0.045, 0.045, 0.05, M.black).rotateX(Math.PI / 2), x, -0.92, 0.11)); });
    g.add(at(box(0.26, 0.26, 0.04, M.chip), -0.12, -0.5, 0.05));
    g.add(at(box(0.2, 0.14, 0.08, M.chip), 0.24, -0.45, 0.07));
    g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), glowMat(0xff5a5f)), 0.3, -0.25, 0.05));
    const tip = new THREE.Object3D(); tip.position.set(0, 1.0, 0.1); g.add(tip);
    g.userData = { tip };
    return g;
  }

  /* ---------- stage ---------- */
  const rig = new THREE.Group(); scene.add(rig);
  const piG = buildPi(), camG = buildCam(), rtrG = buildRouter(), espG = buildEsp();
  const models = { mS: device, mPi: piG, mCam: camG, mRtr: rtrG, mEsp: espG };
  for (const k of MODEL_KEYS) { rig.add(models[k]); models[k].visible = false; }

  // hero halo: an orbit of packets around the device
  const halo = new THREE.Group(); halo.rotation.x = 1.2; rig.add(halo);
  const haloRing = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.006, 6, 160), glowMat(0x33d69f));
  halo.add(haloRing);
  const HN = 22;
  const haloP = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 10, 8), glowMat(0x5ff0bd), HN);
  haloP.frustumCulled = false; halo.add(haloP);

  // lineup cables: router -> SENTRY -> camera
  const LX = 1.75;
  const cableCurve = (a, b) => new THREE.QuadraticBezierCurve3(a, a.clone().add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, -0.55, 0.2)), b);
  // router (centre) -> SENTRY (left), then SENTRY -> camera (right), the cable runs under the router
  const cA = cableCurve(new THREE.Vector3(-0.45, -0.2, 0.1), new THREE.Vector3(-LX + 0.55, -0.45, 0));
  const cB = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-LX + 0.45, -0.55, 0.05), new THREE.Vector3(0, -1.75, 0.5), new THREE.Vector3(LX - 0.3, -0.3, 0));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x33d69f, transparent: true, opacity: 0.5, toneMapped: false });
  const lines = new THREE.Group(); rig.add(lines);
  [cA, cB].forEach(c => lines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(c.getPoints(40)), lineMat)));
  const LN = 14;
  const lineP = new THREE.InstancedMesh(new THREE.SphereGeometry(0.04, 10, 8), glowMat(0x5ff0bd), LN);
  lineP.frustumCulled = false; lines.add(lineP);
  const blockP = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 10, 8), glowMat(0xff5a5f), 3);
  blockP.frustumCulled = false; lines.add(blockP);

  // threat stream into the camera
  const attackFrom = new THREE.Vector3(3.0, 2.7, -1.6);
  const cAttack = new THREE.QuadraticBezierCurve3(attackFrom, new THREE.Vector3(1.9, 1.6, 0.8), new THREE.Vector3(0, 0, 0.2));
  const RN = 8;
  const redP = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 12, 10), glowMat(0xff5a5f), RN);
  redP.frustumCulled = false; rig.add(redP);
  const attacker = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), glowMat(0xff5a5f));
  attacker.position.copy(attackFrom); rig.add(attacker);

  // honeypot: decoys around the ESP32 and Wi-Fi waves from its antenna
  const decoyMat = new THREE.MeshBasicMaterial({ color: 0x8c7dff, wireframe: true, transparent: true, opacity: 0.85, toneMapped: false });
  const decoys = [[-1.9, 1.1, 0.4, new THREE.BoxGeometry(0.42, 0.26, 0.28)], [1.9, 0.9, 0.4, new THREE.CylinderGeometry(0.17, 0.17, 0.42, 10)], [1.7, -1.3, 0.4, new THREE.BoxGeometry(0.5, 0.18, 0.36)]]
    .map(([x, y, z, geo]) => { const d = at(new THREE.Mesh(geo, decoyMat), x, y, z); rig.add(d); return d; });
  const decoyFrom = new THREE.Vector3(-3.8, -1.8, -2);
  const cDecoy = decoys.map(d => new THREE.QuadraticBezierCurve3(decoyFrom, decoyFrom.clone().add(d.position).multiplyScalar(0.5).add(new THREE.Vector3(0, 1.2, 0.5)), d.position.clone()));
  const hpP = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 12, 10), glowMat(0xff5a5f), 9);
  hpP.frustumCulled = false; rig.add(hpP);
  const waves = [];
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.215, 64), glowMat(0x8c7dff));
    w.material.side = THREE.DoubleSide; rig.add(w); waves.push(w);
  }
  // Edge ML scan ring around the Pi
  const scan = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.015, 96), glowMat(0x33d69f));
  scan.material.side = THREE.DoubleSide; rig.add(scan);

  const tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3();
  const setInst = (mesh, i, pos, s) => { tmpS.setScalar(Math.max(s, 0.0001)); tmpM.compose(pos, tmpQ, tmpS); mesh.setMatrixAt(i, tmpM); };

  // starfield environment
  let stars;
  {
    const n = innerWidth < 760 ? 500 : 900, pos = new Float32Array(n * 3), r2 = makeRng(42);
    for (let i = 0; i < n; i++) {
      const r = 12 + r2() * 18, th = r2() * TAU, ph = Math.acos(2 * r2() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th); pos[i * 3 + 2] = -Math.abs(r * Math.cos(ph)) - 2;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8fb2d6, size: 0.05, transparent: true, opacity: 0.55, sizeAttenuation: true, depthWrite: false }));
    scene.add(stars);
  }

  /* ---------- scroll → scene state ---------- */
  let anchorsY = [];
  function measure() {
    anchorsY = $$('[data-scene]').map(el => {
      const top = el.getBoundingClientRect().top + scrollY;
      return { s: SCENES[el.dataset.scene], y: Math.max(0, top + el.offsetHeight / 2 - innerHeight / 2) };
    }).sort((a, b) => a.y - b.y);
  }
  const target = { ...SCENES.hero };
  function computeTarget() {
    const y = scrollY;
    let a = anchorsY[0], b = a, t = 0;
    if (y <= anchorsY[0].y) { a = b = anchorsY[0]; }
    else if (y >= anchorsY[anchorsY.length - 1].y) { a = b = anchorsY[anchorsY.length - 1]; }
    else {
      for (let i = 0; i < anchorsY.length - 1; i++) {
        if (y >= anchorsY[i].y && y < anchorsY[i + 1].y) { a = anchorsY[i]; b = anchorsY[i + 1]; t = (y - a.y) / (b.y - a.y); break; }
      }
      t = smooth(clamp((t - 0.18) / 0.64, 0, 1));
    }
    for (const k of KEYS) target[k] = lerp(a.s[k], b.s[k], t);
  }

  const cur = { ...SCENES.hero };

  /* ---------- user rotation: only when the visitor grabs a model ---------- */
  // full 360 degree trackball: the drag turns the model around the screen axes, no limits, no snapping back
  const rot = { q: new THREE.Quaternion(), vy: 0, vp: 0, dragging: false, lx: 0, ly: 0, lt: 0, idle: 1e9, spinK: 1, reset: false, used: false };
  const AX_Y = new THREE.Vector3(0, 1, 0), AX_X = new THREE.Vector3(1, 0, 0), _dq = new THREE.Quaternion(), QI = new THREE.Quaternion();
  const turn = (dx, dy) => {
    if (dx) rot.q.premultiply(_dq.setFromAxisAngle(AX_Y, dx));
    if (dy) rot.q.premultiply(_dq.setFromAxisAngle(AX_X, dy));
    rot.q.normalize();
  };
  const NO_DRAG = 'a,button,input,textarea,select,label,.copy,.panel,.nav,.dots,.foot,.pager';
  const rotHint = $('.rot-hint');
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hintOff = null, canGrab = false, hoverAt = 0;
  function hitModel(cx, cy, target) {
    if (target && target.closest && target.closest(NO_DRAG)) return false;
    const live = MODEL_KEYS.filter(k => cur[k] > 0.5 && models[k].visible).map(k => models[k]);
    if (!live.length) return false;
    ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(live, true).length > 0;
  }
  function grab(x, y) {
    Object.assign(rot, { dragging: true, lx: x, ly: y, lt: performance.now(), vy: 0, vp: 0, reset: false, used: true });
    document.body.classList.add('grabbing');
    wakeLoop();
  }
  function drag(x, y) {
    const now = performance.now(), dt = Math.max(8, now - rot.lt);
    const dx = (x - rot.lx) * 0.009, dy = (y - rot.ly) * 0.009;
    turn(dx, dy);
    rot.vy = dx / dt * 16.7; rot.vp = dy / dt * 16.7;
    rot.lx = x; rot.ly = y; rot.lt = now;
    wakeLoop();
  }
  const endDrag = () => {
    if (!rot.dragging) return;
    rot.dragging = false; rot.idle = 0; modelTouch = false;
    if (performance.now() - rot.lt > 90 || reduced) rot.vy = rot.vp = 0;   // a held-still release does not fling
    document.body.classList.remove('grabbing');
    wakeLoop();
  };
  // mouse and pen
  addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' || e.button !== 0 || !hitModel(e.clientX, e.clientY, e.target)) return;
    e.preventDefault();
    grab(e.clientX, e.clientY);
  });
  addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    if (rot.dragging) { drag(e.clientX, e.clientY); return; }
    if (e.pointerType !== 'mouse') return;
    const now = performance.now();
    if (now - hoverAt < 50) return;
    hoverAt = now;
    const ok = hitModel(e.clientX, e.clientY, e.target);
    if (ok !== canGrab) { document.body.classList.toggle('can-grab', ok); canGrab = ok; }
  }, { passive: true });
  addEventListener('pointerup', e => { if (e.pointerType !== 'touch') endDrag(); });
  addEventListener('pointercancel', e => { if (e.pointerType !== 'touch') endDrag(); });
  addEventListener('blur', endDrag);
  // touch: a finger on a model turns it in any direction and the page does not change slide
  addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (!hitModel(t.clientX, t.clientY, e.target)) return;
    modelTouch = true;
    grab(t.clientX, t.clientY);
  }, { passive: true });
  addEventListener('touchmove', e => {
    if (!rot.dragging || !modelTouch) return;
    e.preventDefault();
    const t = e.touches[0];
    drag(t.clientX, t.clientY);
  }, { passive: false });
  addEventListener('touchend', endDrag, { passive: true });
  addEventListener('touchcancel', endDrag, { passive: true });
  addEventListener('dblclick', e => {
    if (!hitModel(e.clientX, e.clientY, e.target)) return;
    rot.vy = rot.vp = 0; rot.reset = true; wakeLoop();
  });

  /* ---------- HUD and labels ---------- */
  const hud = $('.hud'), hudText = $('#hud-text');
  let hudLast = '', hudAlert = null, hudOff = null;
  const labelsEl = $('.labels');
  const labelEls = $$('.lbl').map(el => ({ el, a: anchors[el.dataset.anchor], last: '', left: el.dataset.side === 'l', dy: +(el.dataset.dy || 0) }));
  let labelsOp = -1, canvasOp = -1;
  const proj = new THREE.Vector3();

  /* ---------- frame loop ---------- */
  let rafId = null, lastT = 0, time = 0, phase = 0, cutFlash = 0, prevCut = 0;
  const hw = () => Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  const camRest = new THREE.Vector3();
  const _eul = new THREE.Euler();

  function tick(now) {
    const dt = Math.min(100, now - (lastT || now));
    lastT = now;
    const f = dt / 16.667;
    if (!reduced) time += dt / 1000;

    // ease the displayed state toward the scroll target, frame-rate independent
    const k = reduced ? 1 : 1 - Math.pow(1 - 0.06, f);
    let moving = false;
    for (const key of KEYS) {
      const d = target[key] - cur[key];
      if (Math.abs(d) > 0.0005) { cur[key] += d * k; moving = true; } else cur[key] = target[key];
    }

    // layout: responsive placement in the viewport
    const narrow = innerWidth < 760 || innerWidth / innerHeight < 0.8;
    const halfH = hw(), halfW = halfH * camera.aspect;
    let x = cur.x * halfW, y = cur.y * halfH, s = cur.s;
    if (narrow) { x = 0; y = halfH * 0.42; s *= 0.62 * (1 - 0.22 * cur.lineup); }
    rig.position.set(x, y + (reduced ? 0 : Math.sin(time * 0.8) * 0.05), 0);
    rig.scale.setScalar(s);

    // user rotation: inertia, optional reset; the presentation spin pauses while the visitor holds a model
    if (!rot.dragging) {
      if (rot.reset) {
        rot.q.slerp(QI, 1 - Math.pow(0.86, f));
        if (rot.q.angleTo(QI) < 0.002) { rot.q.identity(); rot.reset = false; }
      }
      if (rot.vy || rot.vp) turn(rot.vy * f, rot.vp * f);
      const damp = Math.pow(0.93, f);
      rot.vy *= damp; rot.vp *= damp;
      if (Math.abs(rot.vy) < 0.0002) rot.vy = 0;
      if (Math.abs(rot.vp) < 0.0002) rot.vp = 0;
      rot.idle += dt;
    }
    const userActive = rot.dragging || rot.idle < 3000 || rot.vy !== 0 || rot.vp !== 0;
    rot.spinK += ((userActive ? 0 : 1) - rot.spinK) * (1 - Math.pow(0.96, f));
    if (rot.dragging || rot.vy || rot.vp || rot.reset) moving = true;
    const hOff = rot.used || cur.dim > 0.3 || cur.explode > 0.5 || (narrow && scrollY > innerHeight * 0.4);
    if (hOff !== hintOff && rotHint) { rotHint.classList.toggle('off', hOff); hintOff = hOff; }

    if (!reduced) phase += (dt / 1000) * 0.32 * cur.spin * rot.spinK;
    if (cur.spin < 0.6) {
      const goal = Math.round(phase / TAU) * TAU;
      phase += (goal - phase) * (1 - Math.pow(1 - 0.05, f)) * (1 - cur.spin / 0.6);
    }
    const yaw = cur.ry + phase, pitch = cur.rx;

    // models: each one scales in with a small twist, sits in place or in the lineup
    const L = smooth(clamp(cur.lineup, 0, 1));
    const slot = { mS: -LX, mPi: 0, mCam: LX, mRtr: 0, mEsp: 0 };
    for (const key of MODEL_KEYS) {
      const m = models[key], w = smooth(clamp(cur[key], 0, 1));
      m.visible = w > 0.01;
      if (!m.visible) continue;
      m.scale.setScalar(Math.max(0.001, w * lerp(1, 0.58, L)));
      m.position.set(slot[key] * L, 0, 0);
      _eul.set(pitch, yaw + (1 - w) * 1.6, 0);
      m.quaternion.setFromEuler(_eul).premultiply(rot.q);
    }

    // variant morph and exploded view of the SENTRY device
    const ve = smooth(clamp(variantChoice * cur.vsel, 0, 1));
    tri.scale.setScalar(Math.max(0.001, 1 - ve)); tri.visible = ve < 0.999;
    rect.scale.setScalar(Math.max(0.001, ve)); rect.visible = ve > 0.001;
    const e = smooth(clamp(cur.explode, 0, 1));
    front.position.z = 1.15 * e;
    back.position.z = -0.95 * e;
    topBoard.position.z = 0.55 * e;
    bottomBoard.position.z = -0.4 * e;
    M.frame.opacity = 1 - 0.78 * e;
    M.frame.depthWrite = e < 0.5;
    M.led.color.setHex(0x33d69f);

    // hero halo
    const haloV = cur.net * (1 - L) * clamp(cur.mS, 0, 1);
    halo.visible = haloV > 0.01;
    if (halo.visible) {
      haloRing.material.opacity = 0.35 * haloV;
      halo.rotation.z = time * 0.05;
      for (let i = 0; i < HN; i++) {
        const a = i / HN * TAU + time * (0.25 + (i % 3) * 0.05);
        tmpV.set(Math.cos(a) * 2.0, Math.sin(a) * 2.0, 0);
        setInst(haloP, i, tmpV, haloV * (0.6 + (i % 4) * 0.15));
      }
      haloP.instanceMatrix.needsUpdate = true;
    }

    // lineup cables with traffic: green passes through, red stops at SENTRY
    const lineV = L * cur.net;
    lines.visible = lineV > 0.01;
    if (lines.visible) {
      lineMat.opacity = 0.55 * lineV;
      for (let i = 0; i < LN; i++) {
        const u = (i / LN + time * 0.12) % 1;
        if (u < 0.5) cA.getPoint(u * 2, tmpV); else cB.getPoint((u - 0.5) * 2, tmpV);
        setInst(lineP, i, tmpV, lineV);
      }
      lineP.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < 3; i++) {
        const u = (i / 3 + time * 0.1) % 1;
        cA.getPoint(u, tmpV);
        setInst(blockP, i, tmpV, lineV * (u > 0.92 ? (1 - u) / 0.08 : 1));
      }
      blockP.instanceMatrix.needsUpdate = true;
    }

    // IP camera: threat glow, relay cut, cable drop
    const cu = camG.userData;
    const effCut = cut * cur.cutw;
    if (prevCut < 1 && effCut >= 1 && !reduced) cutFlash = 1;
    prevCut = effCut;
    const threat = cur.threat * (1 - effCut);
    const blink = 0.55 + 0.45 * Math.sin(time * 8);
    cu.ring.material.color.copy(EMERALD).lerp(RED, threat).lerp(GRAY, effCut);
    cu.led.material.color.copy(EMERALD).lerp(RED, threat * blink).lerp(GRAY, effCut);
    cu.irMat.emissive.setHex(effCut > 0.5 ? 0x000000 : 0x3a0a10);
    const drop = smooth(clamp(effCut, 0, 1));
    cu.plugSide.position.set(0, -0.45 * drop, 0.25 * drop);
    cu.plugSide.rotation.x = -0.35 * drop;
    cutFlash = Math.max(0, cutFlash - dt / 900);
    cu.spark.material.opacity = cutFlash;
    cu.spark.scale.setScalar(1 + (1 - cutFlash) * 5);
    cu.spark.lookAt(camera.position);

    // attack stream into the camera
    const atkV = cur.threat * clamp(cur.mCam, 0, 1) * (1 - L);
    attacker.visible = redP.visible = atkV > 0.01;
    if (attacker.visible) {
      attacker.material.opacity = atkV;
      attacker.rotation.set(time * 0.7, time * 1.2, 0);
      for (let i = 0; i < RN; i++) {
        const u = (i / RN + time * 0.16) % 1;
        cAttack.getPoint(u, tmpV);
        setInst(redP, i, tmpV, atkV * (effCut > 0.5 && u > 0.55 ? 0 : 1));
      }
      redP.instanceMatrix.needsUpdate = true;
    }

    // Raspberry Pi: scan beam, scan ring, SoC alert
    const pu = piG.userData;
    const mlV = cur.ml * clamp(cur.mPi, 0, 1);
    pu.beam.visible = pu.beamGlow.visible = pu.socRing.visible = mlV > 0.01;
    scan.visible = mlV > 0.01;
    if (mlV > 0.01) {
      const sweep = Math.sin(time * 1.4);
      pu.beam.position.y = sweep * 0.72; pu.beamGlow.position.y = sweep * 0.72;
      pu.beam.material.opacity = mlV; pu.beamGlow.material.opacity = 0.14 * mlV;
      pu.socRing.material.opacity = mlV * (0.5 + 0.5 * Math.sin(time * 6));
      const sp = (time * 0.5) % 1;
      scan.material.opacity = mlV * (1 - sp) * 0.5;
      scan.scale.setScalar(1.2 + sp * 1.3);
      scan.lookAt(camera.position);
    }

    // router status LEDs blink like real traffic
    rtrG.userData.leds.forEach((m, i) => { m.opacity = 0.35 + 0.65 * (Math.sin(time * (3 + i * 1.7) + i) > -0.2 ? 1 : 0); });

    // honeypot: decoys, Wi-Fi waves, attacker packets drawn into the decoys
    const hV = cur.honey * clamp(cur.mEsp, 0, 1);
    decoys.forEach((d, i) => { d.visible = hV > 0.01; d.scale.setScalar(Math.max(0.001, smooth(clamp(hV * 1.2 - i * 0.1, 0, 1)))); d.rotation.set(time * 0.3, time * 0.5 + i, 0); });
    hpP.visible = hV > 0.01;
    if (hpP.visible) {
      for (let i = 0; i < 9; i++) {
        const u = (i / 9 + time * 0.12) % 1;
        cDecoy[i % 3].getPoint(u, tmpV);
        setInst(hpP, i, tmpV, hV);
      }
      hpP.instanceMatrix.needsUpdate = true;
    }
    espG.userData.tip.getWorldPosition(camRest); rig.worldToLocal(camRest);
    waves.forEach((w, i) => {
      w.visible = hV > 0.01;
      if (!w.visible) return;
      const wp = (time * 0.6 + i / waves.length) % 1;
      w.position.copy(camRest);
      w.scale.setScalar(1 + wp * 7);
      w.material.opacity = hV * (1 - wp) * (1 - wp) * 0.8;
      w.lookAt(camera.position);
    });

    stars.rotation.y = time * 0.01;
    stars.rotation.x = Math.sin(time * 0.05) * 0.05;

    // dim the 3D behind dense slides
    const op = +(1 - cur.dim * 0.72).toFixed(3);
    if (op !== canvasOp) { canvas.style.opacity = op; canvasOp = op; }

    // labels for the exploded view
    const lo = +clamp((cur.labels - 0.6) / 0.4, 0, 1).toFixed(2);
    if (lo !== labelsOp) { labelsEl.style.opacity = lo; labelsOp = lo; }
    if (lo > 0) {
      scene.updateMatrixWorld();
      labelEls.forEach(Lb => {
        Lb.a.getWorldPosition(proj); proj.project(camera);
        let sx = (proj.x * 0.5 + 0.5) * innerWidth, sy = (-proj.y * 0.5 + 0.5) * innerHeight - 16 + Lb.dy;
        const lw = Lb.el.offsetWidth;
        sx = Math.round(clamp(Lb.left ? sx - lw - 6 : sx + 6, 8, innerWidth - lw - 8)); sy = Math.round(clamp(sy, 70, innerHeight - 50));
        const tr = `translate3d(${sx}px,${sy}px,0)`;
        if (tr !== Lb.last) { Lb.el.style.transform = tr; Lb.last = tr; }
      });
    }

    // HUD readout synced to the scene
    let msg = 'SENTRY · сеть под защитой', alert = false;
    if (hV > 0.5) msg = 'HONEYPOT · 3 приманки активны · атакующий в ловушке';
    else if (mlV > 0.5) { msg = 'EDGE ML · аномалия: камера → 203.0.113.42'; alert = true; }
    else if (cur.mCam > 0.5 && cur.threat > 0.5) {
      if (effCut > 0.98) msg = 'РЕЛЕ · камера обесточена · сеть в норме';
      else { msg = 'ВНИМАНИЕ · чужой трафик к камере'; alert = true; }
    } else if (L > 0.5) msg = 'SENTRY ↔ РОУТЕР ↔ КАМЕРА · трафик проверяется';
    if (msg !== hudLast) { hudText.textContent = msg; hudLast = msg; }
    if (alert !== hudAlert) { hud.classList.toggle('alert', alert); hudAlert = alert; }
    const off = cur.dim > 0.3 || cur.explode > 0.3 || cur.vsel > 0.5;
    if (off !== hudOff) { hud.classList.toggle('off', off); hudOff = off; }

    renderer.render(scene, camera);

    // keep running while animating; rest when reduced motion has converged
    if (reduced && !moving && cutFlash === 0) { rafId = null; lastT = 0; }
    else rafId = requestAnimationFrame(tick);
  }

  function wakeLoop() { if (rafId === null && !document.hidden) rafId = requestAnimationFrame(tick); }
  function onScroll() { computeTarget(); updateChrome(); wakeLoop(); }
  function onResize() {
    renderer.setPixelRatio(dpr());
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    measure(); computeTarget(); wakeLoop();
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastT = 0; wakeLoop(); } });
  reduceMQ.addEventListener('change', e => { reduced = e.matches; wakeLoop(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); computeTarget(); wakeLoop(); });
  addEventListener('load', () => { measure(); computeTarget(); wakeLoop(); });

  measure(); computeTarget();
  Object.assign(cur, target);
  wakeLoop();
  document.documentElement.classList.add('webgl-ok');
  return { wake: wakeLoop };
}

addEventListener('scroll', () => { if (!three) updateChrome(); }, { passive: true });
updateChrome();
try {
  THREE = await import('three');
  ({ RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js'));
  three = initThree();
} catch (err) {
  console.warn('3D unavailable, showing the static device.', err);
  document.documentElement.classList.add('no-webgl');
  $('.hud').classList.add('off');
}
reduceMQ.addEventListener('change', e => { reduced = e.matches; });

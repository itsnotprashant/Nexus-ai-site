/* ---- procedural 3D high-top sneaker, built with three.js ----
   nothing here is loaded from a model file: the shoe is a set of lofted
   surfaces driven by a handful of profile curves, and every panel, seam
   and bit of type is painted into a canvas texture at runtime. ---- */

import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { RoomEnvironment } from "./vendor/RoomEnvironment.js";

/* ============================================================
   1. small math helpers
   ============================================================ */

/* monotone cubic interpolation (pchip) over a table of [x, y] control
   points — used for every profile curve so the shapes stay smooth and
   never overshoot between the numbers we actually chose. */
function pchip(points) {
  var xs = points.map(function (p) { return p[0]; });
  var ys = points.map(function (p) { return p[1]; });
  var n = xs.length, d = [], m = [], i;

  for (i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) { m[i] = 0; continue; }
    var w1 = 2 * (xs[i + 1] - xs[i]) + (xs[i] - xs[i - 1]);
    var w2 = (xs[i + 1] - xs[i]) + 2 * (xs[i] - xs[i - 1]);
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }

  return function (x) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (xs[mid] > x) hi = mid; else lo = mid; }
    var h = xs[hi] - xs[lo], t = (x - xs[lo]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * m[lo] +
           (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h * m[hi];
  };
}

var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
var smooth = function (t) { return t * t * (3 - 2 * t); };
var pow = Math.pow, cos = Math.cos, sin = Math.sin, PI = Math.PI;

/* build a surface out of a stack of cross sections. every section holds the
   same number of points, so the whole thing is just a quad grid. */
function loft(sections) {
  var U = sections.length, V = sections[0].length;
  var pos = new Float32Array(U * V * 3), uvs = new Float32Array(U * V * 2);
  var idx = [], i, j, k = 0, q = 0;

  for (i = 0; i < U; i++) {
    for (j = 0; j < V; j++) {
      var p = sections[i][j];
      pos[k++] = p[0]; pos[k++] = p[1]; pos[k++] = p[2];
      uvs[q++] = i / (U - 1); uvs[q++] = j / (V - 1);
    }
  }
  for (i = 0; i < U - 1; i++) {
    for (j = 0; j < V - 1; j++) {
      var a = i * V + j, b = a + 1, c = a + V, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }

  var g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ============================================================
   2. the profile curves that define the shoe
   ------------------------------------------------------------
   u runs 0 (back of the heel) -> 1 (tip of the toe)
   x = length, y = up, z = width (-z is the lateral / outside face)
   ============================================================ */

var LEN = 2.78;            // heel-to-toe length in world units
var X0 = -LEN * 0.5;
var BASE = -0.10;          // where the upper disappears into the midsole
var FLOOR = 0.11;          // the insole you see through the collar

var xAt = function (u) { return X0 + u * LEN; };

/* half width of the upper */
var W = pchip([
  [0.00, 0.395], [0.10, 0.435], [0.22, 0.445], [0.36, 0.400],
  [0.50, 0.420], [0.66, 0.468], [0.78, 0.470], [0.88, 0.415],
  [0.95, 0.330], [1.00, 0.250]
]);

/* height of the upper's top edge — the tall part at the back is the shaft */
var H = pchip([
  [0.00, 0.86], [0.05, 1.03], [0.10, 1.12], [0.15, 1.255],
  [0.20, 1.355], [0.25, 1.357], [0.30, 1.313], [0.35, 1.190],
  [0.42, 0.980], [0.50, 0.800], [0.60, 0.660], [0.72, 0.550],
  [0.84, 0.472], [0.92, 0.412], [1.00, 0.330]
]);

/* half width of the ankle opening / lace throat (0 = closed over the top) */
var OW = pchip([
  [0.00, 0.00], [0.055, 0.00], [0.11, 0.135], [0.175, 0.215],
  [0.26, 0.250], [0.34, 0.246], [0.42, 0.218], [0.52, 0.168],
  [0.60, 0.090], [0.68, 0.00], [1.00, 0.00]
]);

/* how far the section pulls in as it climbs — this is what stops the ankle
   shaft from standing up as a slab the full width of the foot */
var TR = pchip([
  [0.00, 0.54], [0.16, 0.53], [0.30, 0.60], [0.45, 0.78],
  [0.60, 0.93], [0.75, 1.00], [1.00, 1.00]
]);

/* the cross-section is squarer through the waist and rounder at the toe */
var SEU = pchip([[0.00, 0.73], [0.45, 0.76], [0.78, 0.86], [1.00, 0.97]]);

/* a gentle forward shear so the ankle shaft leans over the foot instead of
   standing up like a wall */
var LEAN = pchip([[0.00, 0.16], [0.15, 0.13], [0.30, 0.085], [0.45, 0.03], [0.60, 0], [1.00, 0]]);
var shear = function (u, y) { return LEAN(u) * (y - BASE); };

/* rounds the plan-view outline off at both ends so the heel closes on a
   seam and the toe closes to a point */
function endScale(u) {
  var s = 1, a = 0.105, b = 0.10;
  if (u < a) s = Math.min(s, Math.sqrt(Math.max(0, 1 - pow(1 - u / a, 2))));
  if (u > 1 - b) s = Math.min(s, Math.sqrt(Math.max(0, 1 - pow(1 - (1 - u) / b, 2))));
  return s;
}

var A_SEG = 26, C_SEG = 5, D_SEG = 7;
var RING = 2 * A_SEG + 2 * C_SEG + D_SEG;

/* v coordinates of the texture bands, straight out of the ring layout */
var V_LAT_LO = 0, V_LAT_HI = (A_SEG - 1) / RING;
var V_MED_HI = (A_SEG + 2 * C_SEG + D_SEG) / RING, V_MED_LO = (RING - 1) / RING;

function outerPoint(u, a, side) {
  var h = H(u), k = SEU(u);
  var y = BASE + (h - BASE) * pow(sin(a), k);
  return [xAt(u) + shear(u, y), y, side * zOuter(u, a)];
}

function zOuter(u, a) {
  var w = W(u) * endScale(u), k = SEU(u), t = pow(sin(a), k);
  return w * pow(cos(a), k) * (1 - (1 - TR(u)) * pow(t, 1.5));
}

/* the collar edge is wherever the outer surface has narrowed to the width of
   the opening — no closed form once the taper is in, so bisect for it */
function rimAngle(u) {
  var ow = Math.min(OW(u), zOuter(u, 0.0005) * 0.88);
  if (ow < 1e-4) return { a: PI / 2, ow: 0 };
  var lo = 0, hi = PI / 2, i, m;
  for (i = 0; i < 30; i++) {
    m = (lo + hi) * 0.5;
    if (zOuter(u, m) > ow) lo = m; else hi = m;
  }
  return { a: (lo + hi) * 0.5, ow: ow };
}

function rimPoint(u, side) {
  var r = rimAngle(u);
  return new THREE.Vector3().fromArray(outerPoint(u, r.a, side));
}

/* one cross section of the upper: up the outside face to the collar edge,
   down the inside wall, across the insole, and back out the other side. */
function bodySection(u) {
  var r = rimAngle(u), ow = r.ow, arim = r.a, pts = [], i, t;

  var k = SEU(u), tRim = pow(sin(arim), k);
  var angleAt = function (n) {
    var t = (n / (A_SEG - 1)) * tRim;
    return Math.asin(Math.min(1, pow(t, 1 / k)));
  };
  for (i = 0; i < A_SEG; i++) pts.push(outerPoint(u, angleAt(i), -1));
  var rimY = pts[A_SEG - 1][1], x = xAt(u);

  for (i = 1; i <= C_SEG; i++) {
    t = i / C_SEG;
    var y1 = rimY + (FLOOR - rimY) * smooth(t);
    pts.push([x + shear(u, y1), y1, -ow * (1 - 0.16 * t)]);
  }
  for (i = 1; i <= D_SEG; i++) {
    t = i / (D_SEG + 1);
    var y2 = FLOOR - 0.012 * sin(PI * t);
    pts.push([x + shear(u, y2), y2, -ow * 0.84 + 2 * ow * 0.84 * t]);
  }
  for (i = C_SEG; i >= 1; i--) {
    t = i / C_SEG;
    var y3 = rimY + (FLOOR - rimY) * smooth(t);
    pts.push([x + shear(u, y3), y3, ow * (1 - 0.16 * t)]);
  }
  for (i = A_SEG - 1; i >= 0; i--) pts.push(outerPoint(u, angleAt(i), 1));

  pts.push(pts[0].slice());   // duplicate seam point so the uv strip closes
  return pts;
}

/* ---- the midsole + outsole, lofted the same way ---- */
var SOLE_TOP = pchip([[0, 0.045], [0.35, 0.015], [0.7, 0.0], [1, -0.005]]);
var SOLE_BOT = pchip([[0, -0.27], [0.25, -0.265], [0.6, -0.24], [1, -0.215]]);
var B_SEG = 4, K_SEG = 5, L_SEG = 12, T_SEG = 4;
var SOLE_RING = 2 * B_SEG + 2 * K_SEG + 2 * L_SEG + T_SEG;
var V_SOLE_LO = B_SEG / SOLE_RING;
var V_SOLE_HI = (B_SEG + K_SEG + L_SEG - 1) / SOLE_RING;
var V_SOLE_MED_HI = (B_SEG + K_SEG + L_SEG + T_SEG) / SOLE_RING;
var V_SOLE_MED_LO = (SOLE_RING - B_SEG - 1) / SOLE_RING;

function soleSection(u) {
  var uu = clamp(u, 0, 1);
  var ws = W(uu) * endScale(uu) * 1.03 + 0.055;
  var wt = ws - 0.03;
  var bot = SOLE_BOT(uu), top = SOLE_TOP(uu), rad = 0.05;
  var x = xAt(uu) + (u - uu) * LEN, pts = [], i, t;

  for (i = 0; i < B_SEG; i++) { t = i / B_SEG; pts.push([x, bot, -(ws - rad) * t]); }
  for (i = 0; i <= K_SEG - 1; i++) {
    t = i / (K_SEG - 1) * (PI / 2);
    pts.push([x, bot + rad * (1 - cos(t)) * 0.85, -(ws - rad) - rad * sin(t)]);
  }
  for (i = 1; i <= L_SEG; i++) {
    t = i / L_SEG;
    var bulge = 1 - 0.10 * pow(t, 2.2);
    pts.push([x, bot + rad * 0.85 + (top - bot - rad * 0.85) * t, -(ws * bulge)]);
  }
  for (i = 1; i <= T_SEG; i++) { t = i / T_SEG; pts.push([x, top, -wt * 0.9 + 2 * wt * 0.9 * t]); }
  for (i = L_SEG; i >= 1; i--) {
    t = i / L_SEG;
    var bulge2 = 1 - 0.10 * pow(t, 2.2);
    pts.push([x, bot + rad * 0.85 + (top - bot - rad * 0.85) * t, ws * bulge2]);
  }
  for (i = K_SEG - 1; i >= 0; i--) {
    t = i / (K_SEG - 1) * (PI / 2);
    pts.push([x, bot + rad * (1 - cos(t)) * 0.85, (ws - rad) + rad * sin(t)]);
  }
  for (i = B_SEG - 1; i >= 0; i--) { t = i / B_SEG; pts.push([x, bot, (ws - rad) * t]); }

  pts.push(pts[0].slice());
  return pts;
}

/* ============================================================
   3. colourways + the painted textures
   ============================================================ */

var COLORWAYS = {
  chicago: {
    label: "CHICAGO", swatch: ["#c8202b", "#f3efe6", "#141414"],
    panel: "#f4efe4", accent: "#c4222c", accentDark: "#9e1a24", dark: "#161616",
    midsole: "#efe8d7", outsole: "#8e1f26", collar: "#e9f0f2", lace: "#131313",
    tie: "#ff3b12", tab1: "#1f8fd0", tab2: "#f26a1b", ink: "#141414", foam: "#dfe7ea"
  },
  midnight: {
    label: "MIDNIGHT", swatch: ["#15171c", "#3a3f4a", "#b8bec9"],
    panel: "#343a44", accent: "#0f1115", accentDark: "#080a0d", dark: "#050609",
    midsole: "#dde1e8", outsole: "#232730", collar: "#59616e", lace: "#0b0c0f",
    tie: "#eef2f8", tab1: "#6c8dff", tab2: "#4fe0d4", ink: "#e8ecf2", foam: "#6a7280"
  },
  cobalt: {
    label: "COBALT", swatch: ["#1d4fd8", "#f3efe6", "#0f172a"],
    panel: "#f1eee6", accent: "#1f4fd0", accentDark: "#16389b", dark: "#101528",
    midsole: "#eae4d4", outsole: "#16388f", collar: "#e6eefb", lace: "#101528",
    tie: "#ff8a1f", tab1: "#ff3b12", tab2: "#ffd028", ink: "#101528", foam: "#dfe8f6"
  },
  bone: {
    label: "BONE", swatch: ["#e8e0d2", "#cdc2ae", "#8a7f6d"],
    panel: "#efe8da", accent: "#d9cfbb", accentDark: "#c2b69f", dark: "#8a7f6d",
    midsole: "#e4dcca", outsole: "#b6a992", collar: "#f3eee3", lace: "#a99c86",
    tie: "#8a7f6d", tab1: "#b6a992", tab2: "#cdc2ae", ink: "#6b6152", foam: "#f0eadf"
  }
};

var TW = 2048, TH = 1024, UW = 1200, UH = 460;

/* draws artwork (unit space: x heel->toe, y bottom->collar edge) into the
   slice of the texture that wraps one face of the shoe */
function band(ctx, vBottom, vTop, flipU, draw) {
  var y0 = (1 - vBottom) * TH, y1 = (1 - vTop) * TH;
  ctx.save();
  ctx.beginPath();
  ctx.rect(-2, Math.min(y0, y1) - 2, TW + 4, Math.abs(y1 - y0) + 4);
  ctx.clip();
  ctx.translate(flipU ? TW : 0, y0);
  ctx.scale((flipU ? -1 : 1) * TW / UW, (y1 - y0) / UH);
  draw(ctx);
  ctx.restore();
}

function stitch(ctx, path, color, dash, width) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width || 3;
  ctx.setLineDash(dash || [11, 9]);
  ctx.lineCap = "round";
  path(ctx);
  ctx.stroke();
  ctx.restore();
}

/* the signature drawn-twice outline: a solid line with a dashed line
   running just outside it */
function panelEdge(ctx, path, c) {
  ctx.save();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = 3.5;
  ctx.setLineDash([]);
  path(ctx);
  ctx.stroke();
  ctx.restore();
}

/* the band transform runs y upwards, which would draw glyphs upside down —
   and the outside face is seen mirrored — so type gets its own transform */
function label(ctx, x, y, text, mirror) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(mirror ? -1 : 1, -1);
  ctx.textAlign = mirror ? "right" : "left";
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function sideArtwork(ctx, c, mirror) {
  var lateral = mirror;      /* the face with the streak; the other gets the type */

  /* ---- base panel ---- */
  ctx.fillStyle = c.panel;
  ctx.fillRect(-40, -40, UW + 80, UH + 80);

  /* ---- heel and ankle, sweeping back as it rises ---- */
  ctx.fillStyle = c.accent;
  ctx.beginPath();
  ctx.moveTo(-40, -40);
  ctx.lineTo(318, -40);
  ctx.quadraticCurveTo(306, 170, 372, 316);
  ctx.quadraticCurveTo(420, 420, 442, UH + 40);
  ctx.lineTo(-40, UH + 40);
  ctx.closePath();
  ctx.fill();

  /* ---- toe box ---- */
  ctx.beginPath();
  ctx.moveTo(UW + 40, -40);
  ctx.lineTo(UW + 40, UH + 40);
  ctx.lineTo(986, UH + 40);
  ctx.quadraticCurveTo(922, 236, 898, -40);
  ctx.closePath();
  ctx.fill();

  /* ---- padded collar band around the back ---- */
  ctx.fillStyle = c.dark;
  ctx.beginPath();
  ctx.moveTo(-40, UH + 40);
  ctx.lineTo(-40, 366);
  ctx.quadraticCurveTo(180, 360, 336, 338);
  ctx.lineTo(336, UH + 40);
  ctx.closePath();
  ctx.fill();

  /* ---- eyestay running down to the throat ---- */
  ctx.beginPath();
  ctx.moveTo(300, 352);
  ctx.quadraticCurveTo(520, 318, 744, 282);
  ctx.lineTo(768, 346);
  ctx.quadraticCurveTo(530, 382, 300, 420);
  ctx.closePath();
  ctx.fill();

  /* ---- the side streak, on the outside face only ---- */
  if (lateral) {
    ctx.fillStyle = c.dark;
    ctx.beginPath();
    ctx.moveTo(352, 258);
    ctx.bezierCurveTo(520, 222, 720, 182, 912, 162);
    ctx.lineTo(918, 202);
    ctx.bezierCurveTo(724, 226, 528, 274, 380, 316);
    ctx.closePath();
    ctx.fill();
    /* the hooked tail at the back of the streak */
    ctx.beginPath();
    ctx.moveTo(352, 258);
    ctx.bezierCurveTo(306, 270, 296, 302, 328, 322);
    ctx.lineTo(380, 316);
    ctx.closePath();
    ctx.fill();

    /* the second, offset outline that reads as a hand-drawn overdraw */
    stitch(ctx, function (x) {
      x.beginPath();
      x.moveTo(344, 232);
      x.bezierCurveTo(520, 194, 726, 154, 926, 136);
    }, c.ink, [14, 10], 2.5);

    /* ---- little fabric tabs ---- */
    ctx.fillStyle = c.tab1;
    ctx.fillRect(858, 218, 30, 20);
    ctx.fillStyle = c.tab2;
    ctx.beginPath();
    ctx.ellipse(902, 206, 19, 13, -0.3, 0, PI * 2);
    ctx.fill();
  } else {
    /* ---- type, on the inside face ---- */
    ctx.save();
    ctx.fillStyle = c.ink;
    ctx.font = "700 30px 'Helvetica Neue', Helvetica, Arial, sans-serif";
    label(ctx, 398, 286, '"HIGH TOP 01"', mirror);
    ctx.font = "700 21px 'Helvetica Neue', Helvetica, Arial, sans-serif";
    label(ctx, 398, 254, "N.E.X.U.S\u2122 STUDIO", mirror);
    ctx.font = "400 19px 'Helvetica Neue', Helvetica, Arial, sans-serif";
    label(ctx, 398, 226, "BUILT IN THE BROWSER", mirror);
    label(ctx, 398, 200, "c. 2026", mirror);
    ctx.restore();
  }

  /* ---- exposed seams ---- */
  stitch(ctx, function (x) {
    x.beginPath();
    x.moveTo(364, 126);
    x.quadraticCurveTo(640, 100, 890, 132);
    x.moveTo(364, 154);
    x.quadraticCurveTo(640, 128, 888, 160);
  }, c.ink, [13, 10], 3);

  stitch(ctx, function (x) {
    x.beginPath();
    x.moveTo(452, 402);
    x.quadraticCurveTo(660, 366, 800, 330);
  }, c.ink, [11, 9], 2);

  panelEdge(ctx, function (x) {
    x.beginPath();
    x.moveTo(898, -20);
    x.quadraticCurveTo(922, 236, 986, UH + 20);
  }, c);
  panelEdge(ctx, function (x) {
    x.beginPath();
    x.moveTo(318, -20);
    x.quadraticCurveTo(306, 170, 374, 320);
  }, c);

  /* ---- perforations across the toe box ---- */
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  for (var r = 0; r < 4; r++) {
    for (var i = 0; i < 9; i++) {
      var px = 1004 + i * 24 + r * 8, py = 388 - r * 36;
      if (px > UW - 16) continue;
      ctx.beginPath();
      ctx.arc(px, py, 4.2, 0, PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  /* ---- eyelets along the lace throat ---- */
  for (var e = 0; e < 6; e++) {
    var t = e / 5;
    var ex = 360 + t * 360, ey = 424 - t * 58;
    ctx.beginPath();
    ctx.arc(ex, ey, 11, 0, PI * 2);
    ctx.fillStyle = c.panel;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex, ey, 11, 0, PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex, ey, 5.5, 0, PI * 2);
    ctx.fillStyle = "#0d0d0d";
    ctx.fill();
  }
}

function makeUpperTexture(c) {
  var cv = document.createElement("canvas");
  cv.width = TW; cv.height = TH;
  var ctx = cv.getContext("2d");

  ctx.fillStyle = c.dark;
  ctx.fillRect(0, 0, TW, TH);

  /* the lining you can see down inside the collar */
  band(ctx, V_LAT_HI, V_MED_HI, false, function (x) {
    var g = x.createLinearGradient(0, 0, 0, UH);
    g.addColorStop(0, "#2a2a2a");
    g.addColorStop(0.5, "#111111");
    g.addColorStop(1, "#2a2a2a");
    x.fillStyle = g;
    x.fillRect(-40, -40, UW + 80, UH + 80);
  });

  band(ctx, V_LAT_LO, V_LAT_HI, false, function (x) { sideArtwork(x, c, true); });
  band(ctx, V_MED_LO, V_MED_HI, false, function (x) { sideArtwork(x, c, false); });

  var tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function soleArtwork(ctx, c, mirror) {
  ctx.fillStyle = c.midsole;
  ctx.fillRect(-40, -40, UW + 80, UH + 80);

  /* outsole wrapping up over the bottom edge */
  ctx.fillStyle = c.outsole;
  ctx.beginPath();
  ctx.moveTo(-40, -40);
  ctx.lineTo(UW + 40, -40);
  ctx.lineTo(UW + 40, 176);
  ctx.quadraticCurveTo(600, 206, -40, 182);
  ctx.closePath();
  ctx.fill();

  /* the tread ribs */
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.22)";
  ctx.lineWidth = 7;
  for (var i = 0; i < 60; i++) {
    var x = 12 + i * 20;
    ctx.beginPath();
    ctx.moveTo(x, -40);
    ctx.lineTo(x, 168);
    ctx.stroke();
  }
  ctx.restore();

  /* the seam where the midsole meets the upper */
  ctx.strokeStyle = "rgba(0,0,0,0.28)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-40, 190);
  ctx.quadraticCurveTo(600, 214, UW + 40, 184);
  ctx.stroke();

  ctx.save();
  ctx.fillStyle = c.dark;
  ctx.font = "700 116px 'Helvetica Neue', Helvetica, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.save();
  ctx.translate(600, 302);
  ctx.scale(mirror ? -1 : 1, -1);
  ctx.fillText('"NEXUS"', 0, 0);
  ctx.restore();
  ctx.restore();
}

function makeTongueTexture(c) {
  var cv = document.createElement("canvas");
  cv.width = 1024; cv.height = 512;
  var ctx = cv.getContext("2d"), W2 = cv.width, H2 = cv.height;

  var g = ctx.createLinearGradient(0, 0, W2, 0);
  g.addColorStop(0.00, c.panel);
  g.addColorStop(0.46, c.panel);
  g.addColorStop(0.62, c.collar);
  g.addColorStop(1.00, c.foam);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W2, H2);

  /* the seam where the leather stops and the padding is exposed */
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 9]);
  ctx.beginPath();
  ctx.moveTo(W2 * 0.53, 0);
  ctx.lineTo(W2 * 0.53, H2);
  ctx.stroke();
  ctx.setLineDash([]);

  /* the woven tab, sitting on the outward face of the tongue */
  ctx.save();
  ctx.translate(W2 * 0.80, H2 * 0.75);
  ctx.rotate(-PI / 2);
  ctx.fillStyle = c.dark;
  ctx.fillRect(-96, -30, 192, 60);
  ctx.fillStyle = c.panel;
  ctx.font = "700 30px 'Helvetica Neue', Helvetica, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N.E.X.U.S", 0, 1);
  ctx.restore();

  var tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeSoleTexture(c) {
  var cv = document.createElement("canvas");
  cv.width = TW; cv.height = TH;
  var ctx = cv.getContext("2d");

  ctx.fillStyle = c.outsole;
  ctx.fillRect(0, 0, TW, TH);

  /* tread on the underside */
  ctx.strokeStyle = "rgba(0,0,0,0.30)";
  ctx.lineWidth = 10;
  for (var i = 0; i < 90; i++) {
    var x = i * 23;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, TH);
    ctx.stroke();
  }

  band(ctx, V_SOLE_MED_HI, V_SOLE_MED_LO, false, function (x) {
    x.fillStyle = c.midsole;
    x.fillRect(-40, -40, UW + 80, UH + 80);
  });
  band(ctx, V_SOLE_LO, V_SOLE_HI, false, function (x) { soleArtwork(x, c, true); });
  band(ctx, V_SOLE_MED_LO, V_SOLE_MED_HI, false, function (x) { soleArtwork(x, c, false); });

  var tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* ============================================================
   4. assembling the shoe
   ============================================================ */

var USEG = 220;

/* every nth point of a section — the full-resolution mesh is far too dense
   to read as a wireframe */
function stride(list, n) {
  var out = [], i;
  for (i = 0; i < list.length - 1; i += n) out.push(list[i]);
  out.push(list[list.length - 1]);
  return out;
}

function buildUpper(su, sv) {
  var sections = [], i, n = su || 1;
  for (i = 0; i < USEG; i += n) sections.push(bodySection(i / (USEG - 1)));
  if ((USEG - 1) % n !== 0) sections.push(bodySection(1));
  if (sv) sections = sections.map(function (sec) { return stride(sec, sv); });
  return loft(sections);
}

/* the sole sweep is open at both ends, so tuck a couple of shrinking rings
   on to close it off */
function closeEnd(sections, atStart) {
  var ring = atStart ? sections[0] : sections[sections.length - 1];
  var n = ring.length, cx = 0, cy = 0, cz = 0, i;
  for (i = 0; i < n; i++) { cx += ring[i][0]; cy += ring[i][1]; cz += ring[i][2]; }
  cx /= n; cy /= n; cz /= n;

  var steps = [[0.94, 0.30], [0.78, 0.58], [0.48, 0.84], [0.0, 1.0]];
  var caps = steps.map(function (st) {
    var dx = (atStart ? -1 : 1) * st[1] * 0.105;
    return ring.map(function (p) {
      return [p[0] + dx, cy + (p[1] - cy) * st[0], cz + (p[2] - cz) * st[0]];
    });
  });
  if (atStart) caps.reverse();
  return atStart ? caps.concat(sections) : sections.concat(caps);
}

function buildSole(su, sv) {
  var sections = [], i, N = 200, n = su || 1;
  for (i = 0; i < N; i += n) sections.push(soleSection(0.014 + (i / (N - 1)) * 0.972));
  if ((N - 1) % n !== 0) sections.push(soleSection(0.986));
  if (sv) sections = sections.map(function (sec) { return stride(sec, sv); });
  return loft(closeEnd(closeEnd(sections, true), false));
}

/* the padded collar: a tube following the edge of the ankle opening */
function collarCurve() {
  var pts = [], u;
  for (u = 0.46; u >= 0.105; u -= 0.01) pts.push(rimPoint(u, -1));
  for (u = 0.105; u <= 0.46; u += 0.01) pts.push(rimPoint(u, 1));
  return new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5);
}

/* the tongue, swept along a spine that lifts up out of the throat */
function buildTongue(coarse) {
  /* [u, y, half width, thickness] — the first points sit just under the
     vamp so the front of the tongue is hidden inside the shell */
  var spine = [
    [0.660, 0.430, 0.225, 0.045],
    [0.590, 0.505, 0.230, 0.058],
    [0.525, 0.590, 0.228, 0.070],
    [0.472, 0.695, 0.221, 0.084],
    [0.432, 0.825, 0.212, 0.112],
    [0.398, 0.980, 0.203, 0.130],
    [0.372, 1.135, 0.194, 0.140],
    [0.354, 1.275, 0.176, 0.126]
  ];
  var pts = spine.map(function (s) { return new THREE.Vector3(xAt(s[0]) + shear(s[0], s[1]), s[1], 0); });
  var widths = spine.map(function (s) { return s[2]; });
  var thick = spine.map(function (s) { return s[3]; });

  var curve = new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5);
  var N = coarse ? 22 : 110, sections = [], i, j, V = coarse ? 10 : 22;
  for (i = 0; i < N; i++) {
    var t = i / (N - 1);
    var p = curve.getPoint(t), tan = curve.getTangent(t);
    var nrm = new THREE.Vector3(-tan.y, tan.x, 0).normalize();
    var fi = t * (widths.length - 1);
    var k = Math.min(widths.length - 2, Math.floor(fi)), f = fi - k;
    var hw = widths[k] * (1 - f) + widths[k + 1] * f;
    var th = (thick[k] * (1 - f) + thick[k + 1] * f) * 0.5;
    hw *= 1 - 0.30 * pow(Math.max(0, t - 0.9) / 0.1, 1.7);
    th *= 1 - 0.45 * pow(Math.max(0, t - 0.93) / 0.07, 1.7);
    var ring = [];
    for (j = 0; j <= V; j++) {
      var a = (j / V) * PI * 2;
      var zz = hw * Math.tanh(2.1 * cos(a)) / Math.tanh(2.1);
      var nn = th * sin(a);
      ring.push([p.x + nrm.x * nn, p.y + nrm.y * nn, zz]);
    }
    sections.push(ring);
  }
  return loft(sections);
}

function buildLaces(mat, group) {
  var rows = [0.300, 0.360, 0.420, 0.480, 0.540, 0.600];
  var pt = function (u, side) {
    var r = rimPoint(u, side);
    return new THREE.Vector3(r.x, r.y + 0.015, r.z * 0.93);
  };
  var arc = function (a, b) {
    var m = a.clone().add(b).multiplyScalar(0.5);
    m.y += 0.085;
    m.z = 0;
    return new THREE.CatmullRomCurve3([a, m, b], false, "centripetal", 0.5);
  };
  var i;
  for (i = 0; i < rows.length - 1; i++) {
    group.add(new THREE.Mesh(
      new THREE.TubeGeometry(arc(pt(rows[i], -1), pt(rows[i + 1], 1)), 26, 0.026, 8, false), mat));
    group.add(new THREE.Mesh(
      new THREE.TubeGeometry(arc(pt(rows[i], 1), pt(rows[i + 1], -1)), 26, 0.026, 8, false), mat));
  }
  /* the bar across each eyelet row */
  for (i = 0; i < rows.length; i++) {
    var a = pt(rows[i], -1), b = pt(rows[i], 1);
    var m = a.clone().add(b).multiplyScalar(0.5);
    m.y -= 0.02;
    group.add(new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([a, m, b], false, "centripetal", 0.5), 16, 0.02, 8, false), mat));
  }
  /* a loose end trailing off the front eyelet */
  var s = pt(rows[rows.length - 1], -1);
  var tail = new THREE.CatmullRomCurve3([
    s,
    new THREE.Vector3(s.x + 0.22, s.y - 0.02, s.z - 0.10),
    new THREE.Vector3(s.x + 0.50, s.y - 0.24, s.z - 0.18),
    new THREE.Vector3(s.x + 0.66, s.y - 0.52, s.z - 0.14)
  ], false, "centripetal", 0.5);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(tail, 40, 0.026, 8, false), mat));
  return tail;
}

/* the zip tie hanging off the laces */
function buildZipTie(mat, group, anchor) {
  var g = new THREE.Group();
  var ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.014, 8, 36), mat);
  ring.rotation.y = PI / 2;
  g.add(ring);

  var head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.045), mat);
  head.position.set(0, 0.095, 0);
  g.add(head);

  var strap = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.11, 0),
    new THREE.Vector3(0.09, 0.19, 0.012),
    new THREE.Vector3(0.24, 0.215, 0.018),
    new THREE.Vector3(0.40, 0.16, 0.006)
  ], false, "centripetal", 0.5);
  var sg = new THREE.TubeGeometry(strap, 48, 0.016, 4, false);
  sg.scale(1, 1, 0.42);
  g.add(new THREE.Mesh(sg, mat));

  g.position.copy(anchor);
  group.add(g);
  return g;
}

/* ============================================================
   5. scene
   ============================================================ */

var host = document.getElementById("stage");
var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(host.clientWidth, host.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
host.appendChild(renderer.domElement);

var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(30, host.clientWidth / host.clientHeight, 0.1, 100);
camera.position.set(2.1, 1.7, -5.6);

var pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

var key = new THREE.DirectionalLight(0xffffff, 2.4);
key.position.set(-3.2, 5.0, -4.0);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -3; key.shadow.camera.right = 3;
key.shadow.camera.top = 3; key.shadow.camera.bottom = -3;
key.shadow.camera.near = 0.5; key.shadow.camera.far = 14;
key.shadow.bias = -0.0012;
key.shadow.normalBias = 0.02;
scene.add(key);

var rim = new THREE.DirectionalLight(0x9fd0ff, 1.1);
rim.position.set(3.5, 2.2, 3.4);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x2a2620, 0.55));

var ground = new THREE.Mesh(
  new THREE.PlaneGeometry(24, 24),
  new THREE.ShadowMaterial({ opacity: 0.42 })
);
ground.rotation.x = -PI / 2;
ground.position.y = SOLE_BOT(0.2) - 0.005;
ground.receiveShadow = true;
scene.add(ground);

var shoe = new THREE.Group();
scene.add(shoe);

var partUpper = new THREE.Group();
var partSole = new THREE.Group();
var partCollar = new THREE.Group();
var partTongue = new THREE.Group();
var partLaces = new THREE.Group();
shoe.add(partUpper, partSole, partCollar, partTongue, partLaces);

var mats = {
  upper: new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.02 }),
  sole: new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.0 }),
  collar: new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0.0 }),
  tongue: new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.0 }),
  lace: new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.0 }),
  tie: new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.0 })
};

var meshes = [];
function addMesh(geo, mat, group) {
  var m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  meshes.push(m);
  return m;
}

addMesh(buildUpper(), mats.upper, partUpper);
addMesh(buildSole(), mats.sole, partSole);
addMesh(new THREE.TubeGeometry(collarCurve(), 280, 0.052, 14, false), mats.collar, partCollar);
addMesh(buildTongue(), mats.tongue, partTongue);

/* a low-resolution twin of the shells, shown instead of the solid shoe when
   the mesh is toggled on */
var partWire = new THREE.Group();
partWire.visible = false;
shoe.add(partWire);
var wireMat = new THREE.MeshBasicMaterial({ color: 0x7fb0ff, wireframe: true });
partWire.add(new THREE.Mesh(buildUpper(9, 3), wireMat));
partWire.add(new THREE.Mesh(buildSole(12, 3), wireMat));
partWire.add(new THREE.Mesh(buildTongue(true), wireMat));

var laceTail = buildLaces(mats.lace, partLaces);
partLaces.traverse(function (o) { if (o.isMesh) { o.castShadow = true; meshes.push(o); } });
var tie = buildZipTie(mats.tie, partLaces, laceTail.getPoint(0.62));
tie.traverse(function (o) { if (o.isMesh) { o.castShadow = true; meshes.push(o); } });

/* ---- colourway ---- */
var current = "chicago";
function applyColorway(name) {
  var c = COLORWAYS[name];
  current = name;
  ["upper", "sole", "tongue"].forEach(function (k) {
    if (mats[k].map) mats[k].map.dispose();
  });
  mats.upper.map = makeUpperTexture(c);
  mats.sole.map = makeSoleTexture(c);
  mats.tongue.map = makeTongueTexture(c);
  mats.upper.needsUpdate = true;
  mats.sole.needsUpdate = true;
  mats.tongue.needsUpdate = true;
  mats.collar.color.set(c.collar);
  mats.lace.color.set(c.lace);
  mats.tie.color.set(c.tie);
  document.querySelectorAll("[data-cw]").forEach(function (b) {
    b.classList.toggle("is-active", b.dataset.cw === name);
  });
}
applyColorway("chicago");

/* ---- controls ---- */
var controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 0.42, 0);
controls.minDistance = 2.4;
controls.maxDistance = 11;
controls.maxPolarAngle = PI * 0.52;
controls.autoRotateSpeed = 1.6;
controls.update();

/* ---- exploded view ---- */
var explode = 0, explodeTarget = 0;
var offsets = [
  [partSole, new THREE.Vector3(0, -0.58, 0)],
  [partUpper, new THREE.Vector3(0, 0, 0)],
  [partCollar, new THREE.Vector3(0, 0.38, 0)],
  [partTongue, new THREE.Vector3(0.16, 0.54, 0)],
  [partLaces, new THREE.Vector3(0, 0.80, 0)]
];

/* ---- camera presets ---- */
var views = {
  three: [2.1, 1.7, -5.6],
  side: [0.0, 0.62, -6.0],
  top: [0.3, 5.4, -1.8],
  back: [-4.9, 1.5, -2.9]
};
var camTarget = null;
function setView(name) {
  var v = views[name];
  camTarget = new THREE.Vector3(v[0], v[1], v[2]);
  document.querySelectorAll("[data-view]").forEach(function (b) {
    b.classList.toggle("is-active", b.dataset.view === name);
  });
}

/* ---- ui wiring ---- */
document.querySelectorAll("[data-cw]").forEach(function (b) {
  b.addEventListener("click", function () { applyColorway(b.dataset.cw); });
});
document.querySelectorAll("[data-view]").forEach(function (b) {
  b.addEventListener("click", function () { setView(b.dataset.view); });
});
var spinBtn = document.getElementById("spin");
spinBtn.addEventListener("click", function () {
  controls.autoRotate = !controls.autoRotate;
  spinBtn.classList.toggle("is-active", controls.autoRotate);
  spinBtn.textContent = controls.autoRotate ? "Spin: on" : "Spin: off";
});
var explodeBtn = document.getElementById("explode");
explodeBtn.addEventListener("click", function () {
  explodeTarget = explodeTarget > 0.5 ? 0 : 1;
  explodeBtn.classList.toggle("is-active", explodeTarget > 0.5);
});
var solidParts = [partUpper, partSole, partCollar, partTongue, partLaces];
var wireBtn = document.getElementById("wire");
wireBtn.addEventListener("click", function () {
  var on = !partWire.visible;
  partWire.visible = on;
  solidParts.forEach(function (g) { g.visible = !on; });
  wireBtn.classList.toggle("is-active", on);
});
var shotBtn = document.getElementById("shot");
if (shotBtn) {
  shotBtn.addEventListener("click", function () {
    renderer.render(scene, camera);
    var a = document.createElement("a");
    a.download = "nexus-hightop-" + current + ".png";
    a.href = renderer.domElement.toDataURL("image/png");
    a.click();
  });
}

function resize() {
  var w = host.clientWidth, h = host.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener("resize", resize);

var clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  var dt = Math.min(clock.getDelta(), 0.05);

  explode += (explodeTarget - explode) * Math.min(1, dt * 6);
  offsets.forEach(function (o) {
    o[0].position.copy(o[1]).multiplyScalar(explode);
  });
  shoe.scale.setScalar(1 - 0.20 * explode);   // pull back so the parts stay framed

  if (camTarget) {
    camera.position.lerp(camTarget, Math.min(1, dt * 4));
    if (camera.position.distanceTo(camTarget) < 0.01) camTarget = null;
  }

  controls.update();
  renderer.render(scene, camera);
}
tick();

document.body.classList.add("scene-ready");

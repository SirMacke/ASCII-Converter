// Generates the example images in examples/ from scratch, so the project
// owns them outright. A tiny ray tracer renders shaded spheres on a
// checkered floor under a dark sky.
//
//   node scripts/make-examples.mjs
//
// Output is deterministic: running it again produces identical files.

import { mkdirSync, writeFileSync } from 'node:fs';
import omggif from 'omggif';
import pngjs from 'pngjs';

const OUT = new URL('../examples/', import.meta.url);

// --- vector helpers ------------------------------------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mix = (a, b, t) => add(mul(a, 1 - t), mul(b, t));

const LIGHT = norm([-0.6, 1, -0.5]);
const SKY_TOP = [0.0002, 0.0002, 0.0005];
const SKY_HORIZON = [0.004, 0.005, 0.012];

function sky(dir) {
  return mix(SKY_HORIZON, SKY_TOP, Math.min(1, Math.max(0, dir[1] * 6)));
}

/** Nearest hit of a ray against the spheres and the floor plane y = 0. */
function intersect(origin, dir, spheres) {
  let best = { t: Infinity };
  for (const s of spheres) {
    const oc = sub(origin, s.center);
    const b = dot(oc, dir);
    const c = dot(oc, oc) - s.radius * s.radius;
    const disc = b * b - c;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t > 1e-4 && t < best.t) {
      const point = add(origin, mul(dir, t));
      best = { t, point, normal: norm(sub(point, s.center)), sphere: s };
    }
  }
  if (dir[1] < -1e-6) {
    const t = -origin[1] / dir[1];
    if (t > 1e-4 && t < best.t) best = { t, point: add(origin, mul(dir, t)), normal: [0, 1, 0] };
  }
  return best;
}

function shade(origin, dir, spheres, depth = 0) {
  const hit = intersect(origin, dir, spheres);
  if (hit.t === Infinity) return sky(dir);

  let base;
  let shininess = 0;
  let reflect = 0;
  if (hit.sphere) {
    base = hit.sphere.color;
    shininess = 60;
    reflect = 0.18;
  } else {
    const [x, , z] = hit.point;
    const checker = (Math.floor(x) + Math.floor(z)) & 1;
    base = checker ? [0.12, 0.12, 0.13] : [0.035, 0.035, 0.04];
    reflect = 0.08;
  }

  const lit = intersect(add(hit.point, mul(hit.normal, 1e-3)), LIGHT, spheres).t === Infinity;
  const diffuse = lit ? Math.max(0, dot(hit.normal, LIGHT)) : 0;
  let color = mul(base, 0.1 + 0.9 * diffuse);
  if (lit && shininess) {
    const half = norm(sub(LIGHT, dir));
    color = add(color, mul([1, 1, 1], Math.max(0, dot(hit.normal, half)) ** shininess * 0.8));
  }
  if (reflect && depth < 2) {
    const r = sub(dir, mul(hit.normal, 2 * dot(dir, hit.normal)));
    color = mix(color, shade(add(hit.point, mul(hit.normal, 1e-3)), r, spheres, depth + 1), reflect);
  }
  // Fade the floor into the horizon.
  return mix(color, sky(dir), Math.min(1, hit.t / 16) ** 1.2);
}

/** Render to an RGBA buffer with n x n supersampling. */
function render(width, height, spheres, samples) {
  const eye = [0, 1.2, -5];
  const forward = norm(sub([0, 0.8, 0], eye));
  const right = norm(cross([0, 1, 0], forward));
  const up = cross(forward, right);
  const scale = Math.tan((40 * Math.PI) / 360);
  const data = Buffer.alloc(width * height * 4);

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let sum = [0, 0, 0];
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = ((px + (sx + 0.5) / samples) / width - 0.5) * 2 * scale * (width / height);
          const v = (0.5 - (py + (sy + 0.5) / samples) / height) * 2 * scale;
          const dir = norm(add(forward, add(mul(right, u), mul(up, v))));
          sum = add(sum, shade(eye, dir, spheres));
        }
      }
      const i = (py * width + px) * 4;
      for (let c = 0; c < 3; c++) {
        const linear = Math.min(1, sum[c] / (samples * samples));
        data[i + c] = Math.round(linear ** (1 / 2.2) * 255);
      }
      data[i + 3] = 255;
    }
  }
  return data;
}

function scene(phase = 0) {
  // Three spheres on a circle; in the animation they orbit and bounce.
  const specs = [
    { color: [0.85, 0.18, 0.12], radius: 0.8, angle: 200 },
    { color: [0.15, 0.4, 0.9], radius: 0.65, angle: 320 },
    { color: [0.9, 0.68, 0.2], radius: 0.95, angle: 80 },
  ];
  return specs.map((s, i) => {
    const a = ((s.angle + phase * 360) * Math.PI) / 180;
    const bounce = phase ? Math.abs(Math.sin((phase * 2 + i / 3) * Math.PI)) * 0.6 : 0;
    return { color: s.color, radius: s.radius, center: [Math.cos(a) * 1.7, s.radius + bounce, Math.sin(a) * 1.7 + 0.6] };
  });
}

// 6 x 7 x 6 colour cube plus 4 greys: a fixed 256-colour GIF palette.
const PALETTE = [];
for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) {
  PALETTE.push((Math.round((r * 255) / 5) << 16) | (Math.round((g * 255) / 6) << 8) | Math.round((b * 255) / 5));
}
for (const v of [24, 48, 72, 96]) PALETTE.push((v << 16) | (v << 8) | v);

function toIndexed(rgba) {
  const out = new Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) {
    const r = Math.round((rgba[i * 4] * 5) / 255);
    const g = Math.round((rgba[i * 4 + 1] * 6) / 255);
    const b = Math.round((rgba[i * 4 + 2] * 5) / 255);
    out[i] = r * 42 + g * 6 + b;
  }
  return out;
}

mkdirSync(OUT, { recursive: true });

// Still image.
{
  const width = 480;
  const height = 360;
  const png = new pngjs.PNG({ width, height });
  png.data = render(width, height, scene(), 3);
  writeFileSync(new URL('spheres.png', OUT), pngjs.PNG.sync.write(png, { colorType: 2 }));
  console.log('wrote examples/spheres.png');
}

// Animated GIF: one full orbit.
{
  const width = 240;
  const height = 180;
  const frames = 30;
  const buf = new Uint8Array(width * height * frames + 100_000);
  const gif = new omggif.GifWriter(buf, width, height, { palette: PALETTE, loop: 0 });
  for (let f = 0; f < frames; f++) {
    const rgba = render(width, height, scene(f / frames || 1e-9), 2);
    gif.addFrame(0, 0, width, height, toIndexed(rgba), { delay: 5 });
  }
  writeFileSync(new URL('orbit.gif', OUT), buf.subarray(0, gif.end()));
  console.log('wrote examples/orbit.gif');
}

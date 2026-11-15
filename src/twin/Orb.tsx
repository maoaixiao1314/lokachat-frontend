/**
 * The particle orb, ported from the prototype.
 *
 * It is the one part of the screen that is always moving, so it is also the only honest place
 * to show what the twin is doing between a question and an answer: waiting, working it out, or
 * saying something. Those three are genuinely different states here — working it out means a
 * model call that takes seconds — and a spinner would say "busy" for all of them.
 *
 * ``level`` is the amplitude. The caller drives it from whatever it actually has: the rate text
 * is arriving at while streaming, or microphone loudness once there is a microphone. Passing
 * nothing leaves each mode on its own idle motion, which is the honest default — a still orb
 * would read as broken and a thrashing one would imply input that is not there.
 */
import React, { useEffect, useRef } from "react";

export type OrbMode = "listen" | "think" | "speak";

const COLOURS: Record<OrbMode, [number, number, number]> = {
  listen: [111, 227, 189],
  speak: [156, 192, 255],
  think: [185, 166, 255],
};

const COUNT = 2000;

type Particle = {
  x: number; y: number; z: number;
  phase: number; amp: number; size: number;
};

function cloud(): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    // Denser toward the shell, so it reads as a volume rather than as a scatter.
    const r = 0.42 + 0.58 * Math.pow(Math.random(), 0.45);
    out.push({
      x: s * Math.cos(theta) * r,
      y: u * r,
      z: s * Math.sin(theta) * r,
      phase: Math.random() * 6.283,
      amp: 0.5 + Math.random(),
      size: Math.random() < 0.12 ? 2.4 : Math.random() < 0.4 ? 1.6 : 1.1,
    });
  }
  return out;
}

export default function Orb({
  mode,
  level,
  className,
}: {
  mode: OrbMode;
  /** 0–1, from whatever the caller actually measures. Omitted leaves the mode's own motion. */
  level?: number;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Read inside the loop rather than restarting it, so a mode change eases instead of cutting.
  const live = useRef({ mode, level });
  live.current = { mode, level };

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const particles = cloud();
    const colour: [number, number, number] = [...COLOURS[live.current.mode]];
    let amplitude = 0;
    let rotation = 0;
    let running = true;

    // One sprite, redrawn only when the colour has moved; 2000 gradients a frame is not free.
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 16;
    const sg = sprite.getContext("2d")!;
    let painted = "";
    const paint = (c: number[]) => {
      const key = `${c[0] | 0},${c[1] | 0},${c[2] | 0}`;
      if (key === painted) return;
      painted = key;
      sg.clearRect(0, 0, 16, 16);
      const g = sg.createRadialGradient(8, 8, 0, 8, 8, 8);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.25, `rgba(${key},.95)`);
      g.addColorStop(1, `rgba(${key},0)`);
      sg.fillStyle = g;
      sg.fillRect(0, 0, 16, 16);
    };

    const fit = () => {
      const d = Math.min(devicePixelRatio || 1, 2);
      const r = el.getBoundingClientRect();
      el.width = Math.max(1, r.width * d);
      el.height = Math.max(1, r.height * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    fit();

    const frame = (time: number) => {
      if (!running) return;
      const { mode: m, level: given } = live.current;
      const w = el.clientWidth;
      const h = el.clientHeight;
      const t = time / 1000;

      const want = COLOURS[m];
      for (let k = 0; k < 3; k += 1) colour[k] += (want[k] - colour[k]) * 0.04;
      paint(colour);

      const idle =
        m === "speak" ? 0.28 + 0.32 * Math.abs(Math.sin(t * 6.1) * Math.sin(t * 1.7 + 1))
        : m === "think" ? 0.14
        : 0.05;
      const target = given === undefined ? idle : Math.max(0.04, Math.min(1, given));
      amplitude += (target - amplitude) * 0.1;
      rotation += reduce ? 0.0006 : m === "think" ? 0.009 : 0.0028;

      ctx.clearRect(0, 0, w, h);
      const R = Math.min(w * 0.42, h * 0.46);
      const X = w / 2;
      const Y = h / 2;
      const cs = Math.cos(rotation);
      const sn = Math.sin(rotation);
      const ct = Math.cos(0.35);
      const st = Math.sin(0.35);
      const key = `${colour[0] | 0},${colour[1] | 0},${colour[2] | 0}`;

      const halo = ctx.createRadialGradient(X, Y, 0, X, Y, R * 1.25);
      halo.addColorStop(0, `rgba(${key},.34)`);
      halo.addColorStop(0.55, `rgba(${key},.07)`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(X, Y, R * 1.25, 0, 7);
      ctx.fill();

      ctx.globalCompositeOperation = "lighter";
      for (const p of particles) {
        const b = 1 + amplitude * 0.28 * Math.sin(t * 2.6 + p.phase) * p.amp + amplitude * 0.12;
        let x = p.x * cs - p.z * sn;
        let z = p.x * sn + p.z * cs;
        let y = p.y;
        const y2 = y * ct - z * st;
        z = y * st + z * ct;
        y = y2;
        const k = 1.9 / (2.6 - z * b);
        const a = 0.35 + (0.6 * (z + 1)) / 2;
        const s = p.size * (0.8 + (0.5 * (z + 1)) / 2) * 2.2;
        ctx.globalAlpha = a;
        ctx.drawImage(sprite, X + x * b * R * k - s / 2, Y + y * b * R * k - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    return () => {
      running = false;
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvas} className={className} aria-hidden="true" />;
}

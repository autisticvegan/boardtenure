"use client";

// Greed mode: money emojis orbit the cursor, clicks explode into cash, and "make it rain" rains it.
// One canvas overlay, no pointer events; off for prefers-reduced-motion unless the viewer turns it on.
import { useEffect, useRef, useSyncExternalStore } from "react";

const ORBIT = ["💰", "💸", "🤑", "💎", "🪙", "💵"];
const BURST = ["💸", "💰", "💵", "🪙", "💎", "🤑", "🛥️", "🏝️", "🍾", "📈"];
const RAIN = ["💵", "💸", "🪙", "💰"];
const SHOUTS = ["KA-CHING!", "+$1M", "BONUS!", "VESTED!", "STOCK AWARD!", "RETENTION GRANT!", "+$10M", "GOLDEN PARACHUTE!"];
const STORE = "hiw-greed-mode";
const GOLD = "#f5c542";

type Sprite = { canvas: HTMLCanvasElement; size: number };
type Particle = {
  x: number; y: number; vx: number; vy: number; rot: number; vr: number;
  life: number; max: number; sprite: Sprite; scale: number; gravity: number;
};
type Shout = { x: number; y: number; text: string; life: number; max: number };
type Ring = { x: number; y: number; life: number; max: number };

/** "make it rain" from anywhere on the page. */
export function makeItRain() {
  window.dispatchEvent(new CustomEvent("hiw:rain"));
}

// The viewer's choice, kept in localStorage; with no choice, on unless they prefer reduced motion.
function readOn(): boolean {
  let v: string | null = null;
  try {
    v = window.localStorage.getItem(STORE);
  } catch {
    /* storage can be blocked */
  }
  return v == null ? !window.matchMedia("(prefers-reduced-motion: reduce)").matches : v === "on";
}

function writeOn(on: boolean) {
  try {
    window.localStorage.setItem(STORE, on ? "on" : "off");
  } catch {
    /* storage can be blocked; the toggle still works for this page view */
  }
  memo = on;
  window.dispatchEvent(new Event("hiw:greed"));
}

let memo: boolean | null = null;
const subscribe = (cb: () => void) => {
  window.addEventListener("hiw:greed", cb);
  return () => window.removeEventListener("hiw:greed", cb);
};
const getSnapshot = () => (memo ??= readOn());

export function GreedFX() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const on = useSyncExternalStore(subscribe, getSnapshot, () => false);
  const onRef = useRef(false);

  useEffect(() => {
    onRef.current = on;
    document.documentElement.dataset.greed = on ? "on" : "off";
  }, [on]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const fine = window.matchMedia("(pointer: fine)").matches;
    const font = (px: number) => `${px}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    const cache = new Map<string, Sprite>();
    const sprite = (emoji: string, size = 64): Sprite => {
      const key = `${emoji}:${size}`;
      let s = cache.get(key);
      if (!s) {
        const c = document.createElement("canvas");
        c.width = c.height = Math.ceil(size * 1.3);
        const g = c.getContext("2d")!;
        g.font = font(size);
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(emoji, c.width / 2, c.height / 2 + size * 0.06);
        s = { canvas: c, size: c.width };
        cache.set(key, s);
      }
      return s;
    };

    let dpr = 1, w = 0, h = 0;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();

    const particles: Particle[] = [];
    const shouts: Shout[] = [];
    const rings: Ring[] = [];
    const pointer = { x: -999, y: -999, cx: -999, cy: -999, inside: false, lastTrail: 0 };
    let raf = 0, last = performance.now(), t = 0;

    const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

    const burst = (x: number, y: number) => {
      const n = 22 + Math.floor(Math.random() * 10);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
        const speed = 260 + Math.random() * 420;
        particles.push({
          x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 180, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14,
          life: 0, max: 1.1 + Math.random() * 0.7, sprite: sprite(pick(BURST)), scale: 0.32 + Math.random() * 0.3, gravity: 900,
        });
      }
      shouts.push({ x, y: y - 18, text: pick(SHOUTS), life: 0, max: 1.1 });
      rings.push({ x, y, life: 0, max: 0.5 });
      if (particles.length > 600) particles.splice(0, particles.length - 600);
      kick();
    };

    const rain = () => {
      const n = Math.min(160, Math.round(w / 8));
      for (let i = 0; i < n; i++) {
        particles.push({
          x: Math.random() * w, y: -40 - Math.random() * h * 0.9, vx: (Math.random() - 0.5) * 60, vy: 120 + Math.random() * 220,
          rot: Math.random() * 6, vr: (Math.random() - 0.5) * 5, life: 0, max: 4 + Math.random() * 2,
          sprite: sprite(pick(RAIN)), scale: 0.35 + Math.random() * 0.35, gravity: 160,
        });
      }
      kick();
    };

    const draw = (s: Sprite, x: number, y: number, rot: number, scale: number, alpha: number) => {
      const size = s.size * scale;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.drawImage(s.canvas, -size / 2, -size / 2, size, size);
      ctx.restore();
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        if (p.life >= p.max || p.y > h + 80) {
          particles.splice(i, 1);
          continue;
        }
        p.vy += p.gravity * dt;
        p.vx *= 1 - 0.6 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        const fade = p.life > p.max * 0.7 ? 1 - (p.life - p.max * 0.7) / (p.max * 0.3) : 1;
        draw(p.sprite, p.x, p.y, p.rot, p.scale, Math.max(0, fade));
      }

      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.life += dt;
        if (r.life >= r.max) { rings.splice(i, 1); continue; }
        const k = r.life / r.max;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 10 + k * 70, 0, Math.PI * 2);
        ctx.strokeStyle = GOLD;
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = 4 * (1 - k) + 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      for (let i = shouts.length - 1; i >= 0; i--) {
        const s = shouts[i];
        s.life += dt;
        if (s.life >= s.max) { shouts.splice(i, 1); continue; }
        const k = s.life / s.max;
        const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, (k - 0.15) * 0.4);
        ctx.save();
        ctx.translate(s.x, s.y - k * 60);
        ctx.rotate(-0.08);
        ctx.scale(pop, pop);
        ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
        ctx.font = "900 26px ui-sans-serif, system-ui, -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.lineJoin = "round";
        ctx.lineWidth = 6;
        ctx.strokeStyle = "#0b0d12";
        ctx.strokeText(s.text, 0, 0);
        ctx.fillStyle = GOLD;
        ctx.fillText(s.text, 0, 0);
        ctx.restore();
      }

      const orbiting = onRef.current && fine && pointer.inside;
      if (orbiting) {
        pointer.cx += (pointer.x - pointer.cx) * Math.min(1, dt * 14);
        pointer.cy += (pointer.y - pointer.cy) * Math.min(1, dt * 14);
        ORBIT.forEach((e, i) => {
          const a = t * 2.4 + (i / ORBIT.length) * Math.PI * 2;
          const rad = 30 + Math.sin(t * 3 + i) * 5;
          draw(sprite(e, 48), pointer.cx + Math.cos(a) * rad, pointer.cy + Math.sin(a) * rad * 0.8, t * 4 + i, 0.36, 0.95);
        });
      }

      if (particles.length || shouts.length || rings.length || orbiting) {
        raf = requestAnimationFrame(frame);
      } else {
        ctx.clearRect(0, 0, w, h);
        raf = 0;
      }
    };

    const kick = () => {
      if (!raf && !document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if (!pointer.inside) {
        pointer.cx = e.clientX;
        pointer.cy = e.clientY;
      }
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.inside = true;
      if (!onRef.current) return;
      const now = performance.now();
      if (now - pointer.lastTrail > 90) {
        pointer.lastTrail = now;
        particles.push({
          x: e.clientX, y: e.clientY, vx: (Math.random() - 0.5) * 40, vy: -30, rot: 0, vr: (Math.random() - 0.5) * 6,
          life: 0, max: 0.9, sprite: sprite("🪙"), scale: 0.2, gravity: 500,
        });
      }
      kick();
    };
    const onLeave = () => { pointer.inside = false; };
    const onDown = (e: PointerEvent) => {
      if (!onRef.current || e.button !== 0) return;
      if (e.target instanceof Element && e.target.closest("[data-greed-toggle]")) return;
      burst(e.clientX, e.clientY);
    };
    const onRain = () => rain(); // an explicit click, so it runs even with greed mode off
    const onVisibility = () => { if (!document.hidden) kick(); };

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("hiw:rain", onRain);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("hiw:rain", onRain);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const toggle = () => writeOn(!on);

  return (
    <>
      <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 z-[60]" />
      <button type="button" data-greed-toggle onClick={toggle} aria-pressed={on}
              className="fixed z-[61] right-3 min-h-11 inline-flex items-center gap-2 rounded-full border border-accent/50 bg-surface/90 px-4 text-[13px] font-bold text-ink shadow-card backdrop-blur hover:border-accent"
              style={{ bottom: "calc(12px + env(safe-area-inset-bottom, 0px))" }}>
        <span aria-hidden className={on ? "hiw-spin-slow inline-block" : "inline-block grayscale"}>🤑</span>
        Greed mode: {on ? "on" : "off"}
      </button>
    </>
  );
}

/** A button that rains money. */
export function MakeItRain({ label = "Make it rain" }: { label?: string }) {
  return (
    <button type="button" onClick={makeItRain}
            className="min-h-11 inline-flex items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-extrabold text-ink-on-mark shadow-card hover:scale-[1.03] active:scale-95 transition">
      <span aria-hidden>💸</span>{label}
    </button>
  );
}

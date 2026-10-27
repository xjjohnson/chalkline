import { useEffect, useRef, useState } from "react";
import {
  Eraser,
  Hand,
  LocateFixed,
  Minus,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Snowflake,
  Trash2,
  Turtle,
  Undo2,
  Volume2,
  VolumeX,
  Zap,
  ZoomIn,
  ZoomOut,
  ChevronsUp,
} from "lucide-react";
import { createMixer, type Mixer } from "@/game/audio";
import { drawWorld, type Scarf } from "@/game/render";
import {
  beginStroke,
  clearLines,
  commitLine,
  createSim,
  endStroke,
  eraseAt,
  extendStroke,
  kick,
  loadTrack,
  moveFlag,
  pushUndo,
  resetRider,
  step,
  undo,
  type Sim,
} from "@/game/sim";
import { trackByName, TRACKS } from "@/game/tracks";
import { clamp, PX_PER_M, type Ink } from "@/game/types";

type Tool = "draw" | "line" | "erase" | "pan";

type Hud = {
  dist: number;
  speed: number;
  flips: number;
  best: number;
  running: boolean;
  crashed: boolean;
  stuck: boolean;
  air: boolean;
  track: string;
  newBest: boolean;
};

const SAVE_KEY = "chalkline-v1";

type Save = {
  version: 1;
  bestDist: number;
  bestFlips: number;
  sound: boolean;
  hintSeen: boolean;
  trackName: string;
  flag: { x: number; y: number };
  strokes: Sim["strokes"];
};

function emptyHud(track: string): Hud {
  return {
    dist: 0,
    speed: 0,
    flips: 0,
    best: 0,
    running: false,
    crashed: false,
    stuck: false,
    air: false,
    track,
    newBest: false,
  };
}

export function Chalkline() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Sim | null>(null);
  const camRef = useRef({ x: 520, y: 420, zoom: 1 });
  const followRef = useRef(true);
  const toolRef = useRef<Tool>("draw");
  const inkRef = useRef<Ink>("slope");
  const mixerRef = useRef<Mixer | null>(null);
  const soundRef = useRef(true);
  const hintSeenRef = useRef(false);
  const scarfRef = useRef<Scarf>([]);

  const [tool, setTool] = useState<Tool>("draw");
  const [ink, setInk] = useState<Ink>("slope");
  const [sound, setSound] = useState(true);
  const [follow, setFollow] = useState(true);
  const [slow, setSlow] = useState(false);
  const [hint, setHint] = useState(false);
  const [hud, setHud] = useState<Hud>(() => emptyHud("First hill"));
  const [tracksOpen, setTracksOpen] = useState(false);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  useEffect(() => {
    inkRef.current = ink;
  }, [ink]);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);
  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const sim = createSim();
    simRef.current = sim;
    const saved = readSave();
    if (saved) {
      sim.bestDist = saved.bestDist;
      sim.bestFlips = saved.bestFlips;
      soundRef.current = saved.sound;
      hintSeenRef.current = saved.hintSeen;
      if (saved.strokes.length > 0 || saved.trackName === "Blank") {
        loadTrack(
          sim,
          { name: saved.trackName, flag: saved.flag, strokes: saved.strokes },
          false,
        );
      } else {
        loadTrack(sim, trackByName("First hill"), false);
      }
    } else {
      loadTrack(sim, trackByName("First hill"), false);
    }
    const mixer = createMixer();
    mixerRef.current = mixer;
    mixer.setMuted(!soundRef.current);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cam = camRef.current;
    const scarf = scarfRef.current;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let hudAcc = 0;
    let saveAcc = 0;
    const pointers = new Map<number, { x: number; y: number }>();
    let gesture: Gesture = null;
    let linePreview: { x0: number; y0: number; x1: number; y1: number; ink: Ink } | null = null;
    let eraser: { x: number; y: number } | null = null;

    const publish = () => {
      setHud({
        dist: sim.distance,
        speed: Math.hypot(sim.rider.vx, sim.rider.vy) / PX_PER_M,
        flips: sim.flips,
        best: sim.bestDist,
        running: sim.running,
        crashed: sim.rider.crashed,
        stuck: sim.running && sim.stuckTime > 1.35 && !sim.rider.crashed,
        air: sim.running && !sim.rider.grounded && !sim.rider.crashed && !sim.atStart,
        track: sim.trackName,
        newBest: sim.newBest,
      });
      setSound(soundRef.current);
      setFollow(followRef.current);
      setSlow(sim.slow);
      setHint(!hintSeenRef.current);
    };

    const fit = () => {
      const pts = [sim.flag, sim.rider, ...sim.strokes.flatMap((s) => s.pts)];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      const w = canvas.clientWidth || 800;
      const h = canvas.clientHeight || 600;
      const top = 76;
      const bottom = w < 720 ? 210 : 148;
      const pad = 80;
      const worldW = Math.max(280, maxX - minX + pad * 2);
      const worldH = Math.max(180, maxY - minY + pad * 2);
      const availH = Math.max(140, h - top - bottom);
      cam.zoom = clamp(Math.min((w - 32) / worldW, availH / worldH), 0.42, 1.35);
      cam.x = (minX + maxX) / 2;
      const safeCy = top + availH / 2;
      cam.y = (minY + maxY) / 2 - (safeCy - h / 2) / cam.zoom;
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
    };

    const worldFromClient = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      return {
        x: (x - rect.width / 2) / cam.zoom + cam.x,
        y: (y - rect.height / 2) / cam.zoom + cam.y,
        sx: x,
        sy: y,
      };
    };

    const persist = () => {
      const data: Save = {
        version: 1,
        bestDist: sim.bestDist,
        bestFlips: sim.bestFlips,
        sound: soundRef.current,
        hintSeen: hintSeenRef.current,
        trackName: sim.trackName,
        flag: { ...sim.flag },
        strokes: sim.strokes,
      };
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      } catch {
        /* private mode */
      }
    };

    fit();
    resize();
    publish();

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const scale = sim.slow ? 0.45 : 1;
      acc += dt * scale;
      const STEP = 1 / 120;
      let guard = 0;
      while (acc >= STEP && guard < 8) {
        step(sim, STEP);
        acc -= STEP;
        guard++;
      }
      if (guard >= 8) acc = 0;

      if (followRef.current) {
        const focusX = sim.rider.crashed && sim.ragdoll?.dots[0] ? sim.ragdoll.dots[0].x : sim.rider.x;
        const focusY = sim.rider.crashed && sim.ragdoll?.dots[0] ? sim.ragdoll.dots[0].y : sim.rider.y;
        const tx = focusX + (sim.rider.crashed ? 0 : sim.rider.vx * 0.32);
        const ty = focusY + (sim.rider.crashed ? 0 : sim.rider.vy * 0.16) - 10;
        const k = 1 - Math.exp(-3.3 * dt);
        cam.x += (tx - cam.x) * k;
        cam.y += (ty - cam.y) * k;
      }

      const sh = reduce ? 0 : sim.trauma * sim.trauma;
      const shakeX = Math.sin(sim.time * 48) * 15 * sh;
      const shakeY = Math.sin(sim.time * 37 + 1) * 10 * sh;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      drawWorld(
        ctx,
        canvas.clientWidth,
        canvas.clientHeight,
        dpr,
        cam.x,
        cam.y,
        cam.zoom,
        shakeX,
        shakeY,
        sim,
        scarf,
        linePreview,
        eraser,
        dt,
        reduce,
      );

      if (sim.sfx.length) {
        for (const name of sim.sfx) mixer.play(name);
        sim.sfx.length = 0;
      }
      mixer.scrape(sim.scrape, sim.scrapeInk);

      hudAcc += dt;
      if (hudAcc > 0.12) {
        hudAcc = 0;
        publish();
      }
      saveAcc += dt;
      if (saveAcc > 2.5) {
        saveAcc = 0;
        persist();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onResize = () => resize();
    const ro = new ResizeObserver(onResize);
    ro.observe(canvas);
    window.addEventListener("resize", onResize);

    const unlock = () => mixer.unlock();

    const onPointerDown = (e: PointerEvent) => {
      unlock();
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        if (!a || !b) return;
        gesture = {
          kind: "pinch",
          dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          zoom: cam.zoom,
          midX: (a.x + b.x) / 2,
          midY: (a.y + b.y) / 2,
          camX: cam.x,
          camY: cam.y,
        };
        linePreview = null;
        eraser = null;
        return;
      }
      const wpt = worldFromClient(e.clientX, e.clientY);
      const flagDist = Math.hypot(wpt.x - sim.flag.x, wpt.y - sim.flag.y);
      if (e.button === 1 || e.button === 2 || toolRef.current === "pan") {
        followRef.current = false;
        gesture = { kind: "pan", x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y };
        return;
      }
      if (flagDist < 26 / cam.zoom && toolRef.current !== "erase") {
        pushUndo(sim);
        gesture = { kind: "flag" };
        return;
      }
      if (toolRef.current === "erase") {
        pushUndo(sim);
        eraseAt(sim, wpt.x, wpt.y);
        eraser = { x: wpt.x, y: wpt.y };
        gesture = { kind: "erase" };
        return;
      }
      if (toolRef.current === "line") {
        gesture = { kind: "line", x: wpt.x, y: wpt.y };
        linePreview = { x0: wpt.x, y0: wpt.y, x1: wpt.x, y1: wpt.y, ink: inkRef.current };
        return;
      }
      beginStroke(sim, inkRef.current, wpt.x, wpt.y);
      gesture = { kind: "draw" };
      if (sim.trackName !== "My line") sim.trackName = "My line";
    };

    const onPointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!gesture) return;
      if (gesture.kind === "pinch" && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        if (!a || !b) return;
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const rect = canvas.getBoundingClientRect();
        const nextZoom = clamp(gesture.zoom * (dist / gesture.dist), 0.35, 2.6);
        const wx = (gesture.midX - rect.left - rect.width / 2) / gesture.zoom + gesture.camX;
        const wy = (gesture.midY - rect.top - rect.height / 2) / gesture.zoom + gesture.camY;
        cam.zoom = nextZoom;
        cam.x = wx - (midX - rect.left - rect.width / 2) / nextZoom;
        cam.y = wy - (midY - rect.top - rect.height / 2) / nextZoom;
        followRef.current = false;
        return;
      }
      const wpt = worldFromClient(e.clientX, e.clientY);
      if (gesture.kind === "pan") {
        cam.x = gesture.camX - (e.clientX - gesture.x) / cam.zoom;
        cam.y = gesture.camY - (e.clientY - gesture.y) / cam.zoom;
        return;
      }
      if (gesture.kind === "flag") {
        moveFlag(sim, wpt.x, wpt.y);
        return;
      }
      if (gesture.kind === "erase") {
        if (prev) {
          const a = worldFromClient(prev.x, prev.y);
          const steps = Math.ceil(Math.hypot(wpt.x - a.x, wpt.y - a.y) / 8);
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            eraseAt(sim, a.x + (wpt.x - a.x) * t, a.y + (wpt.y - a.y) * t);
          }
        } else eraseAt(sim, wpt.x, wpt.y);
        eraser = { x: wpt.x, y: wpt.y };
        return;
      }
      if (gesture.kind === "line" && linePreview) {
        linePreview = { ...linePreview, x1: wpt.x, y1: wpt.y };
        return;
      }
      if (gesture.kind === "draw") {
        extendStroke(sim, wpt.x, wpt.y);
        if (sim.trackName !== "My line") sim.trackName = "My line";
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size >= 2) return;
      if (gesture?.kind === "pinch" && pointers.size === 1) {
        const left = [...pointers.values()][0];
        gesture = left
          ? { kind: "pan", x: left.x, y: left.y, camX: cam.x, camY: cam.y }
          : null;
        return;
      }
      if (gesture?.kind === "draw") endStroke(sim);
      if (gesture?.kind === "line" && linePreview) {
        commitLine(sim, linePreview.ink, linePreview.x0, linePreview.y0, linePreview.x1, linePreview.y1);
        if (sim.trackName !== "My line") sim.trackName = "My line";
      }
      gesture = null;
      linePreview = null;
      eraser = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const wpt = worldFromClient(e.clientX, e.clientY);
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      const next = clamp(cam.zoom * factor, 0.35, 2.6);
      const rect = canvas.getBoundingClientRect();
      cam.zoom = next;
      cam.x = wpt.x - (wpt.sx) / next + rect.width / 2 / next;
      cam.y = wpt.y - (wpt.sy) / next + rect.height / 2 / next;
      // Keep the point under the cursor fixed.
      cam.x = wpt.x - (e.clientX - rect.left - rect.width / 2) / next;
      cam.y = wpt.y - (e.clientY - rect.top - rect.height / 2) / next;
    };

    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (target instanceof HTMLElement && target.closest("button, a, summary, input, select")) {
        if (e.code === "Space") return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        toggleRun();
      } else if (e.code === "KeyR") {
        doRestart(sim.running || sim.rider.crashed);
      } else if (e.code === "KeyZ" && !e.shiftKey) {
        undo(sim);
        scarf.length = 0;
      } else if (e.code === "Digit1") setInk("slope");
      else if (e.code === "Digit2") setInk("ice");
      else if (e.code === "Digit3") setInk("spring");
      else if (e.code === "Digit4") setInk("boost");
      else if (e.code === "KeyB") setTool("draw");
      else if (e.code === "KeyL") setTool("line");
      else if (e.code === "KeyE") setTool("erase");
      else if (e.code === "KeyH") setTool("pan");
      else if (e.code === "KeyK" || e.code === "ArrowUp") {
        e.preventDefault();
        kick(sim);
      } else if (e.code === "KeyF") {
        followRef.current = true;
        setFollow(true);
      } else if (e.code === "KeyM") {
        soundRef.current = !soundRef.current;
        mixer.setMuted(!soundRef.current);
        setSound(soundRef.current);
      } else if (e.code === "KeyS") {
        sim.slow = !sim.slow;
        setSlow(sim.slow);
      } else if (e.code === "ArrowLeft") {
        followRef.current = false;
        cam.x -= 48 / cam.zoom;
      } else if (e.code === "ArrowRight") {
        followRef.current = false;
        cam.x += 48 / cam.zoom;
      } else if (e.code === "ArrowDown") {
        followRef.current = false;
        cam.y += 48 / cam.zoom;
      } else if (e.code === "Minus" || e.code === "NumpadSubtract") {
        cam.zoom = clamp(cam.zoom / 1.1, 0.35, 2.6);
      } else if (e.code === "Equal" || e.code === "NumpadAdd") {
        cam.zoom = clamp(cam.zoom * 1.1, 0.35, 2.6);
      }
    };

    const onVis = () => {
      if (document.visibilityState === "visible") mixer.resume();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", unlock);
    document.addEventListener("visibilitychange", onVis);

    const api = {
      get x() {
        return sim.rider.x;
      },
      get y() {
        return sim.rider.y;
      },
      get crashed() {
        return sim.rider.crashed;
      },
      get running() {
        return sim.running;
      },
      get dist() {
        return sim.distance;
      },
      get flips() {
        return sim.flips;
      },
      get strokes() {
        return sim.strokes.length;
      },
      play: () => toggleRun(),
      restart: () => doRestart(true),
    };
    (window as unknown as { __chalk?: typeof api }).__chalk = api;

    function toggleRun() {
      mixer.unlock();
      if (sim.rider.crashed) {
        doRestart(true);
        return;
      }
      sim.running = !sim.running;
      if (sim.running) {
        sim.atStart = false;
        followRef.current = true;
        mixer.play("start");
      }
      publish();
    }

    function doRestart(play: boolean) {
      scarf.length = 0;
      resetRider(sim);
      if (play) {
        sim.running = true;
        sim.atStart = false;
        followRef.current = true;
        mixer.unlock();
        mixer.play("start");
      }
      publish();
    }

    (canvas as unknown as { __fit?: () => void }).__fit = fit;
    (canvas as unknown as { __toggle?: () => void }).__toggle = toggleRun;
    (canvas as unknown as { __restart?: (play: boolean) => void }).__restart = doRestart;
    (canvas as unknown as { __persist?: () => void }).__persist = persist;
    (canvas as unknown as { __sim?: Sim }).__sim = sim;

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", unlock);
      document.removeEventListener("visibilitychange", onVis);
      mixer.close();
      persist();
    };
    // Mount-only: handlers close over the live sim ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sim = () => simRef.current;

  const chooseTrack = (name: string) => {
    const s = sim();
    if (!s) return;
    loadTrack(s, trackByName(name), true);
    scarfRef.current.length = 0;
    followRef.current = true;
    setFollow(true);
    setTracksOpen(false);
    const canvas = canvasRef.current as (HTMLCanvasElement & { __fit?: () => void }) | null;
    canvas?.__fit?.();
    setHud((h) => ({ ...h, track: name, running: false, crashed: false, dist: 0, speed: 0, flips: 0, stuck: false }));
  };

  const onUndo = () => {
    const s = sim();
    if (!s) return;
    undo(s);
    scarfRef.current.length = 0;
  };

  const onClear = () => {
    const s = sim();
    if (!s) return;
    clearLines(s);
    s.trackName = "My line";
    scarfRef.current.length = 0;
  };

  const onPlay = () => {
    const canvas = canvasRef.current as (HTMLCanvasElement & { __toggle?: () => void }) | null;
    canvas?.__toggle?.();
  };

  const onRestart = () => {
    const canvas = canvasRef.current as (HTMLCanvasElement & { __restart?: (p: boolean) => void }) | null;
    canvas?.__restart?.(hud.running || hud.crashed);
  };

  const onFollow = () => {
    followRef.current = true;
    setFollow(true);
    const s = sim();
    const cam = camRef.current;
    if (!s) return;
    cam.x = s.rider.x;
    cam.y = s.rider.y;
  };

  const onSound = () => {
    const next = !sound;
    soundRef.current = next;
    setSound(next);
    mixerRef.current?.unlock();
    mixerRef.current?.setMuted(!next);
  };

  const onSlow = () => {
    const s = sim();
    if (!s) return;
    s.slow = !s.slow;
    setSlow(s.slow);
  };

  const onKick = () => {
    const s = sim();
    if (!s) return;
    mixerRef.current?.unlock();
    kick(s);
  };

  const zoom = (factor: number) => {
    camRef.current.zoom = clamp(camRef.current.zoom * factor, 0.35, 2.6);
  };

  const dismissHint = () => {
    hintSeenRef.current = true;
    setHint(false);
    const canvas = canvasRef.current as (HTMLCanvasElement & { __persist?: () => void }) | null;
    canvas?.__persist?.();
  };

  return (
    <main className="relative h-dvh w-full select-none overflow-hidden bg-paper text-ink">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        aria-label="Drawing slope. Sketch a line and the sled rides it."
      />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-3 sm:p-4">
        <div className="pointer-events-auto sheet rounded-2xl px-3 py-2 sm:px-4">
          <div className="flex items-baseline gap-2">
            <h1 className="font-display text-2xl leading-none font-medium tracking-tight sm:text-3xl">
              Chalkline
            </h1>
          </div>
          <p className="mt-0.5 text-xs text-muted sm:text-sm">Draw the line. Ride it.</p>
          <div className="relative mt-2">
            <button
              type="button"
              className="rounded-full bg-paper-deep px-3 py-1 text-xs font-medium"
              aria-expanded={tracksOpen}
              onClick={() => setTracksOpen((v) => !v)}
            >
              {hud.track}
            </button>
            {tracksOpen ? (
              <div className="sheet absolute top-full left-0 z-20 mt-1 flex min-w-36 flex-col rounded-xl p-1">
                {TRACKS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="rounded-lg px-3 py-2 text-left text-sm hover:bg-paper-deep"
                    onClick={() => chooseTrack(t.id)}
                  >
                    {t.id}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="pointer-events-auto sheet flex items-center gap-2 rounded-2xl px-3 py-2 sm:gap-3 sm:px-4">
          <div className="text-right">
            <p className="font-display text-xl leading-none font-medium tabular-nums">
              {Math.floor(hud.dist)}
              <span className="ml-1 text-sm text-muted">m</span>
            </p>
            <p className="mt-1 text-xs text-muted tabular-nums">
              {Math.round(hud.speed)} m/s
              {hud.flips > 0 ? ` · ${hud.flips} flip${hud.flips === 1 ? "" : "s"}` : ""}
            </p>
            <p className="text-[11px] text-muted tabular-nums">
              best {Math.floor(hud.best)} m{hud.newBest ? " · new" : ""}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <IconButton label={sound ? "Mute" : "Sound on"} onClick={onSound} on={sound}>
              {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </IconButton>
            <IconButton label="Follow sled" onClick={onFollow} on={follow}>
              <LocateFixed size={18} />
            </IconButton>
          </div>
        </div>
      </header>

      {hint ? (
        <div className="pointer-events-none absolute inset-x-0 top-28 z-10 flex justify-center px-4 sm:top-32">
          <div className="sheet pointer-events-auto max-w-md rounded-2xl px-4 py-3">
            <p className="font-display text-lg leading-snug font-medium">
              The sled only goes where you draw.
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Sketch a hill, press play, and keep drawing while they ride. Ice is slippery, spring
              bounces, boost shoves. Kick in the air to flip. Drag the red flag to move the start.
            </p>
            <button
              type="button"
              className="mt-3 rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper"
              onClick={dismissHint}
            >
              Got it
            </button>
          </div>
        </div>
      ) : null}

      {hud.crashed ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-36 z-10 flex justify-center px-4 sm:bottom-32">
          <div className="sheet pointer-events-auto flex items-center gap-3 rounded-2xl px-4 py-3">
            <p className="text-sm">
              Wiped out at <span className="font-medium tabular-nums">{Math.floor(hud.dist)} m</span>
              {hud.flips > 0 ? ` · ${hud.flips} flips` : ""}
            </p>
            <button
              type="button"
              className="rounded-full bg-scarf px-4 py-2 text-sm font-medium text-paper"
              onClick={() => {
                const canvas = canvasRef.current as (HTMLCanvasElement & { __restart?: (p: boolean) => void }) | null;
                canvas?.__restart?.(true);
              }}
            >
              Ride again
            </button>
          </div>
        </div>
      ) : null}

      {hud.stuck ? (
        <p className="pointer-events-none absolute inset-x-0 bottom-36 z-10 text-center text-sm text-muted sm:bottom-32">
          Stuck. Draw a steeper line, or switch to ice.
        </p>
      ) : null}

      {hud.air && !hud.crashed ? (
        <button
          type="button"
          className="absolute right-3 bottom-40 z-20 flex h-14 min-w-14 items-center justify-center rounded-full bg-scarf px-4 text-sm font-medium text-paper shadow-lg sm:right-5"
          onClick={onKick}
        >
          Kick
        </button>
      ) : null}

      <footer className="absolute inset-x-0 bottom-0 z-10 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-3">
        <div className="sheet flex flex-wrap items-center gap-1.5 rounded-2xl px-2 py-2 sm:gap-2 sm:px-3">
          <ToolButton label="Draw" on={tool === "draw"} onClick={() => setTool("draw")}>
            <Pencil size={18} />
          </ToolButton>
          <ToolButton label="Straight line" on={tool === "line"} onClick={() => setTool("line")}>
            <Minus size={18} />
          </ToolButton>
          <ToolButton label="Erase" on={tool === "erase"} onClick={() => setTool("erase")}>
            <Eraser size={18} />
          </ToolButton>
          <ToolButton label="Pan" on={tool === "pan"} onClick={() => setTool("pan")}>
            <Hand size={18} />
          </ToolButton>

          <span className="mx-1 hidden h-6 w-px bg-ink/15 sm:block" />

          <InkButton label="Slope ink" on={ink === "slope"} onClick={() => setInk("slope")}>
            <span className="block h-0.5 w-4 rounded-full bg-current" />
          </InkButton>
          <InkButton label="Ice ink" on={ink === "ice"} onClick={() => setInk("ice")}>
            <Snowflake size={16} />
          </InkButton>
          <InkButton label="Spring ink" on={ink === "spring"} onClick={() => setInk("spring")}>
            <ChevronsUp size={16} />
          </InkButton>
          <InkButton label="Boost ink" on={ink === "boost"} onClick={() => setInk("boost")}>
            <Zap size={16} />
          </InkButton>

          <span className="mx-1 hidden h-6 w-px bg-ink/15 sm:block" />

          <ToolButton label="Undo" on={false} onClick={onUndo}>
            <Undo2 size={18} />
          </ToolButton>
          <ToolButton label="Clear lines" on={false} onClick={onClear}>
            <Trash2 size={18} />
          </ToolButton>
          <ToolButton label="Slow motion" on={slow} onClick={onSlow}>
            <Turtle size={18} />
          </ToolButton>
          <ToolButton label="Zoom out" on={false} onClick={() => zoom(1 / 1.12)}>
            <ZoomOut size={18} />
          </ToolButton>
          <ToolButton label="Zoom in" on={false} onClick={() => zoom(1.12)}>
            <ZoomIn size={18} />
          </ToolButton>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-scarf px-4 text-sm font-medium text-paper"
              onClick={onPlay}
            >
              {hud.running && !hud.crashed ? <Pause size={18} /> : <Play size={18} />}
              {hud.crashed ? "Again" : hud.running ? "Pause" : "Play"}
            </button>
            <ToolButton label="Restart" on={false} onClick={onRestart}>
              <RotateCcw size={18} />
            </ToolButton>
          </div>
        </div>
      </footer>
    </main>
  );
}

function ToolButton({
  label,
  on,
  onClick,
  children,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onClick}
      className={
        "inline-flex h-11 w-11 items-center justify-center rounded-xl " +
        (on ? "bg-ink text-paper" : "text-ink hover:bg-paper-deep")
      }
    >
      {children}
    </button>
  );
}

function InkButton({
  label,
  on,
  onClick,
  children,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onClick}
      className={
        "inline-flex h-11 min-w-11 items-center justify-center rounded-xl px-2.5 " +
        (on ? "bg-ink text-paper" : "text-ink hover:bg-paper-deep")
      }
    >
      {children}
    </button>
  );
}

function IconButton({
  label,
  on,
  onClick,
  children,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onClick}
      className={
        "inline-flex h-9 w-9 items-center justify-center rounded-lg " +
        (on ? "bg-paper-deep text-ink" : "text-muted hover:bg-paper-deep")
      }
    >
      {children}
    </button>
  );
}

type Gesture =
  | { kind: "draw" }
  | { kind: "erase" }
  | { kind: "line"; x: number; y: number }
  | { kind: "pan"; x: number; y: number; camX: number; camY: number }
  | { kind: "flag" }
  | {
      kind: "pinch";
      dist: number;
      zoom: number;
      midX: number;
      midY: number;
      camX: number;
      camY: number;
    };

function readSave(): Save | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<Save>;
    if (data.version !== 1 || !data.flag || !Array.isArray(data.strokes)) return null;
    return {
      version: 1,
      bestDist: Number(data.bestDist) || 0,
      bestFlips: Number(data.bestFlips) || 0,
      sound: data.sound !== false,
      hintSeen: Boolean(data.hintSeen),
      trackName: typeof data.trackName === "string" ? data.trackName : "My line",
      flag: { x: Number(data.flag.x) || 0, y: Number(data.flag.y) || 0 },
      strokes: data.strokes.filter(
        (s) =>
          s &&
          (s.ink === "slope" || s.ink === "ice" || s.ink === "spring" || s.ink === "boost") &&
          Array.isArray(s.pts),
      ),
    };
  } catch {
    return null;
  }
}

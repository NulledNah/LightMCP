// ============================================================
// LightMCP — Ollama Manager
// Handles the full lifecycle of the Ollama process:
// start on-demand, idle timeout, graceful shutdown.
// ============================================================
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { loadConfig } from "../config.js";

type OllamaState = "stopped" | "starting" | "ready";

let _state: OllamaState = "stopped";
let _proc: ChildProcess | null = null;
let _idleTimer: NodeJS.Timeout | null = null;
let _startPromise: Promise<void> | null = null;

function killProcess(proc: ChildProcess, graceful: boolean): void {
  if (process.platform === "win32" && proc.pid) {
    try {
      const flag = graceful ? "" : " /F";
      execSync(`taskkill /PID ${proc.pid} /T${flag}`, { stdio: "ignore" });
    } catch {
      // Process may have already exited
    }
  } else {
    proc.kill(graceful ? "SIGTERM" : "SIGKILL");
  }
}

function resetIdleTimer(idleTimeoutSeconds: number): void {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => {
    console.log(
      `[INFO] Ollama idle for ${idleTimeoutSeconds}s - shutting down to free VRAM...`
    );
    stopOllama().catch((err) => console.error("Ollama stop error:", err));
  }, idleTimeoutSeconds * 1_000);
}

export async function pingOllama(host: string): Promise<boolean> {
  try {
    const res = await fetch(`${host}/api/tags`, {
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitReady(
  host: string,
  startupTimeoutSeconds: number
): Promise<void> {
  const deadline = Date.now() + startupTimeoutSeconds * 1_000;
  while (Date.now() < deadline) {
    if (await pingOllama(host)) return;
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(
    `Ollama did not become ready within ${startupTimeoutSeconds}s.`
  );
}

export async function startOllama(): Promise<void> {
  // If already starting, wait for that promise
  if (_startPromise) return _startPromise;
  if (_state === "ready") return;

  const cfg = await loadConfig();
  const { host, startupTimeoutSeconds, idleTimeoutSeconds } = cfg.ollama;

  // Check if Ollama is already running externally
  if (await pingOllama(host)) {
    _state = "ready";
    resetIdleTimer(idleTimeoutSeconds);
    return;
  }

  _state = "starting";
  console.log("[INFO] Starting Ollama...");

  _startPromise = (async () => {
    try {
      _proc = spawn("ollama", ["serve"], {
        detached: false,
        stdio: "ignore",
        shell: process.platform === "win32",
        windowsHide: true,
      });

      _proc.on("error", (err) => {
        console.error("Ollama process error:", err.message);
        _state = "stopped";
        _proc = null;
        _startPromise = null;
      });

      _proc.on("exit", (code) => {
        if (_state !== "stopped") {
          console.warn(`Ollama exited unexpectedly (code ${code})`);
          _state = "stopped";
          _proc = null;
          _startPromise = null;
        }
      });

      await waitReady(host, startupTimeoutSeconds);
      _state = "ready";
      _startPromise = null;
      console.log("[OK] Ollama is ready");
      resetIdleTimer(idleTimeoutSeconds);
    } catch (err) {
      _state = "stopped";
      _proc = null;
      _startPromise = null;
      throw err;
    }
  })();

  return _startPromise;
}

export async function stopOllama(): Promise<void> {
  if (_idleTimer) {
    clearTimeout(_idleTimer);
    _idleTimer = null;
  }

  // Prevent a pending startOllama() from resurrecting the state
  _startPromise = null;

  if (_proc && _state !== "stopped") {
    _state = "stopped";
    killProcess(_proc, true);
    // Give it 3s to die gracefully, then force kill
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        if (_proc) killProcess(_proc, false);
        resolve();
      }, 3_000);
      _proc?.on("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
    _proc = null;
    console.log("[INFO] Ollama stopped - VRAM freed");
  }
  _state = "stopped";
}

/** Ensure Ollama is running and reset its idle timer. Call before every inference. */
export async function ensureOllamaReady(): Promise<void> {
  const cfg = await loadConfig();
  try {
    await startOllama();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to start Ollama: ${msg}`, { cause: err });
  }
  resetIdleTimer(cfg.ollama.idleTimeoutSeconds);
}

/** Check if the model is available; pull if not. */
export async function ensureModelPulled(): Promise<void> {
  const cfg = await loadConfig();
  const { host, model } = cfg.ollama;

  console.log(`[INFO] Checking model: ${model}...`);
  try {
    const res = await fetch(`${host}/api/tags`);
    const data = (await res.json()) as { models?: { name: string }[] };
    const models = data.models ?? [];

    // Exact match preferred; warn on partial match
    const exact = models.some((m) => m.name === model);
    if (exact) {
      console.log(`[OK] Model ${model} already present`);
      return;
    }

    const base = model.split(":")[0];
    const partial = models.find((m) => m.name.startsWith(base));
    if (partial) {
      console.warn(
        `[WARN] Exact model "${model}" not found, but similar "${partial.name}" exists. Consider pulling the correct model.`
      );
      return;
    }
  } catch {
    // Ollama not running — start it, then try to pull
    console.log("[INFO] Ollama not running, will start and pull model...");
  }

  console.log(`[INFO] Pulling model: ${model} (this may take a while)...`);
  const proc = spawn("ollama", ["pull", model], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  await new Promise<void>((resolve, reject) => {
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ollama pull exited with code ${code}`));
    });
    proc.on("error", reject);
  });
  console.log(`[OK] Model ${model} ready`);
}

export function getOllamaState(): OllamaState {
  return _state;
}

/** Reset the idle timer without pinging — keeps Ollama alive during long batch operations */
export async function keepOllamaAlive(): Promise<void> {
  const cfg = await loadConfig();
  resetIdleTimer(cfg.ollama.idleTimeoutSeconds);
}

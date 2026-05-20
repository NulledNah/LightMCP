// ============================================================
// LightMCP — Ollama Manager
// Handles the full lifecycle of the Ollama process:
// start on-demand, idle timeout, graceful shutdown.
// ============================================================
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { loadConfig } from "../config.js";
import { killProcess, killProcessGraceful } from "../utils.js";

type OllamaState = "stopped" | "starting" | "ready";

export class OllamaManager {
  state: OllamaState = "stopped";
  proc: ChildProcess | null = null;
  private _idleTimer: NodeJS.Timeout | null = null;
  private _startPromise: Promise<void> | null = null;

  private resetIdleTimer(idleTimeoutSeconds: number): void {
    if (this._idleTimer) clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => {
      console.log(
        `[INFO] Ollama idle for ${idleTimeoutSeconds}s - shutting down to free VRAM...`
      );
      this.stop().catch((err) => console.error("Ollama stop error:", err));
    }, idleTimeoutSeconds * 1_000);
  }

  async pingOllama(host: string): Promise<boolean> {
    try {
      const res = await fetch(`${host}/api/tags`, {
        signal: AbortSignal.timeout(2_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async waitReady(
    host: string,
    startupTimeoutSeconds: number
  ): Promise<void> {
    const deadline = Date.now() + startupTimeoutSeconds * 1_000;
    while (Date.now() < deadline) {
      if (await this.pingOllama(host)) return;
      await new Promise((r) => setTimeout(r, 800));
    }
    throw new Error(
      `Ollama did not become ready within ${startupTimeoutSeconds}s.`
    );
  }

  async start(): Promise<void> {
    if (this._startPromise) return this._startPromise;
    if (this.state === "ready") return;

    const cfg = await loadConfig();
    const { host, startupTimeoutSeconds, idleTimeoutSeconds } = cfg.ollama;

    if (await this.pingOllama(host)) {
      this.state = "ready";
      this.resetIdleTimer(idleTimeoutSeconds);
      return;
    }

    this.state = "starting";
    console.log("[INFO] Starting Ollama...");

    this._startPromise = (async () => {
      try {
        this.proc = spawn("ollama", ["serve"], {
          detached: false,
          stdio: "ignore",
          shell: process.platform === "win32",
          windowsHide: true,
        });

        this.proc.on("error", (err) => {
          console.error("Ollama process error:", err.message);
          this.state = "stopped";
          this.proc = null;
          this._startPromise = null;
        });

        this.proc.on("exit", (code) => {
          if (this.state !== "stopped") {
            console.warn(`Ollama exited unexpectedly (code ${code})`);
            this.state = "stopped";
            this.proc = null;
            this._startPromise = null;
          }
        });

        await this.waitReady(host, startupTimeoutSeconds);
        this.state = "ready";
        this._startPromise = null;
        console.log("[OK] Ollama is ready");
        this.resetIdleTimer(idleTimeoutSeconds);
      } catch (err) {
        this.state = "stopped";
        this.proc = null;
        this._startPromise = null;
        throw err;
      }
    })();

    return this._startPromise;
  }

  async stop(): Promise<void> {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }

    this._startPromise = null;

    if (this.proc && this.state !== "stopped") {
      this.state = "stopped";
      killProcessGraceful(this.proc);
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          if (this.proc) killProcess(this.proc);
          resolve();
        }, 3_000);
        this.proc?.on("exit", () => {
          clearTimeout(t);
          resolve();
        });
      });
      this.proc = null;
      console.log("[INFO] Ollama stopped - VRAM freed");
    }
    this.state = "stopped";
  }

  async ensureReady(): Promise<void> {
    const cfg = await loadConfig();
    try {
      await this.start();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to start Ollama: ${msg}`, { cause: err });
    }
    this.resetIdleTimer(cfg.ollama.idleTimeoutSeconds);
  }

  async ensureModelPulled(): Promise<void> {
    const cfg = await loadConfig();
    const { host, model } = cfg.ollama;

    console.log(`[INFO] Checking model: ${model}...`);
    try {
      const res = await fetch(`${host}/api/tags`);
      const data = (await res.json()) as { models?: { name: string }[] };
      const models = data.models ?? [];

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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
        console.log("[INFO] Ollama not running, will start and pull model...");
      } else {
        console.warn(`[WARN] Ollama API check failed: ${msg} — will attempt pull anyway`);
      }
    }

    console.log(`[INFO] Pulling model: ${model} (this may take a while)...`);
    const pullProc = spawn("ollama", ["pull", model], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    await new Promise<void>((resolve, reject) => {
      pullProc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ollama pull exited with code ${code}`));
      });
      pullProc.on("error", reject);
    });
    console.log(`[OK] Model ${model} ready`);
  }

  getState(): OllamaState {
    return this.state;
  }

  async keepAlive(): Promise<void> {
    const cfg = await loadConfig();
    this.resetIdleTimer(cfg.ollama.idleTimeoutSeconds);
  }

  reset(): void {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    this.state = "stopped";
    this.proc = null;
    this._startPromise = null;
  }
}

export const ollamaManager = new OllamaManager();

export const pingOllama = (host: string) => ollamaManager.pingOllama(host);
export const startOllama = () => ollamaManager.start();
export const stopOllama = () => ollamaManager.stop();
export const ensureOllamaReady = () => ollamaManager.ensureReady();
export const ensureModelPulled = () => ollamaManager.ensureModelPulled();
export const getOllamaState = () => ollamaManager.getState();
export const keepOllamaAlive = () => ollamaManager.keepAlive();

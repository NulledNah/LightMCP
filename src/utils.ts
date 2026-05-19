// ============================================================
// LightMCP — Shared Utilities
// ============================================================
import type { ChildProcess } from "node:child_process";

const isWindows = process.platform === "win32";

export function killProcess(proc: ChildProcess): void {
  if (isWindows && proc.pid) {
    try {
      const { execSync } = require("node:child_process");
      execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: "ignore" });
    } catch { /* already dead */ }
  } else {
    try { proc.kill(); } catch { /* already dead */ }
  }
}

export function killProcessGraceful(proc: ChildProcess): void {
  if (isWindows && proc.pid) {
    try {
      const { execSync } = require("node:child_process");
      execSync(`taskkill /PID ${proc.pid} /T`, { stdio: "ignore" });
    } catch { /* already dead */ }
  } else {
    try { proc.kill("SIGTERM"); } catch { /* already dead */ }
  }
}

let _lastActivity: number = Date.now();

export function bumpActivity(): void {
  _lastActivity = Date.now();
}

export function getLastActivity(): number {
  return _lastActivity;
}

// ============================================================
// LightMCP — Ollama REST Client
// Sends the tool-selection prompt and parses the response.
// ============================================================
import { z } from "zod";
import { loadConfig } from "../config.js";
import type { ToolEntry } from "../types.js";
import { buildToolSelectionPrompt } from "../prompts/tool_selector.js";

// Expected response: a JSON array of tool name strings
const SelectionSchema = z.array(z.string().min(1));

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream: false;
  format: "json";
  options?: {
    temperature?: number;
    num_predict?: number;
  };
}

interface OllamaChatResponse {
  message: { role: string; content: string };
  done: boolean;
}

export async function selectTools(
  task: string,
  catalog: ToolEntry[],
  hints: string[] = []
): Promise<string[]> {
  const cfg = await loadConfig();
  const { host, model, maxRetries } = cfg.ollama;

  const { systemPrompt, userPrompt } = buildToolSelectionPrompt(
    task,
    catalog,
    hints
  );

  const body: OllamaChatRequest = {
    model,
    stream: false,
    format: "json",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    options: {
      temperature: 0.0,   // Deterministic — we want reliable JSON
      num_predict: 512,
    },
  };

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const res = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as OllamaChatResponse;
      const raw = data.message?.content ?? "[]";

      // Parse and validate
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Model returned invalid JSON: ${raw.slice(0, 200)}`);
      }

      const result = SelectionSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(
          `Model returned unexpected schema: ${JSON.stringify(parsed).slice(0, 200)}`
        );
      }

      return result.data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt <= maxRetries) {
        console.warn(
          `  [retry ${attempt}/${maxRetries}] Ollama error: ${lastError.message}`
        );
        await new Promise((r) => setTimeout(r, 1_000 * attempt));
      }
    }
  }

  throw lastError ?? new Error("Unknown Ollama error");
}

// ============================================================
// LightMCP — call command
// ============================================================
import { parseCallArgs, callToolViaHttp } from "../utils.js";

export async function callAction(
  firstArg: string,
  rawArgs: string[],
  opts: { file?: string; output?: string }
): Promise<void> {
  const { tool, args } = await parseCallArgs(firstArg, rawArgs, opts);
  await callToolViaHttp(tool, args, { output: opts.output });
}

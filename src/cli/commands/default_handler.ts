// ============================================================
// LightMCP — default command handler
// ============================================================

import { parseCallArgs, callToolViaHttp } from "../utils.js";

export async function defaultAction(...cliArgs: (string | unknown)[]): Promise<void> {
  const strs = cliArgs.filter((a): a is string => typeof a === "string");
  if (strs.length === 0) return;

  const firstStr = strs[0];
  const restStrs = strs.slice(1);

  const { tool, args } = await parseCallArgs(firstStr, restStrs, {});
  await callToolViaHttp(tool, args);
}

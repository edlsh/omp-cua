import type { DriverResult } from "./driver.ts";

export const TREE_CHAR_LIMIT = 40_000;
export const MIN_WINDOW_SIZE = 40;

const SECURE_VALUE = /^(\s*-\s*(?:\[\d+\]\s*)?AXSecureTextField\b.*?)\s=\s".*"(.*)$/;

/** Hides secure text field values even if the driver ever returns them. */
export function redactTree(tree: string): string {
  return tree.split("\n").map(line => line.replace(SECURE_VALUE, "$1 = \"••••\"$2")).join("\n");
}

function quote(value: unknown): string {
  return JSON.stringify(String(value ?? "").slice(0, 120));
}

/** On-screen, on the current Space, and larger than helper windows (cursor overlays, panel services). */
export function isVisibleWindow(window: any): boolean {
  const bounds = window?.bounds ?? {};
  return window?.is_on_screen !== false && window?.on_current_space !== false
    && bounds.width >= MIN_WINDOW_SIZE && bounds.height >= MIN_WINDOW_SIZE;
}

export function renderWindows(json: Record<string, any> | undefined, all: boolean, appFilter?: string): string {
  const windows: any[] = Array.isArray(json?.windows) ? json!.windows : [];
  const wanted = appFilter?.toLowerCase();
  const rows = windows.filter(window =>
    (!wanted || String(window.app_name ?? "").toLowerCase() === wanted) && (all || isVisibleWindow(window)));
  if (!rows.length) return wanted ? `No visible windows for app ${quote(appFilter)}.` : "No visible windows.";
  const lines = rows.map(window => {
    const b = window.bounds ?? {};
    const flags = [window.on_current_space === false ? "other-space" : "", window.is_on_screen === false ? "hidden" : ""].filter(Boolean).join(",");
    return `pid=${window.pid} window_id=${window.window_id} ${window.app_name ?? "?"} ${quote(window.title)} ${Math.round(b.width)}x${Math.round(b.height)}+${Math.round(b.x)}+${Math.round(b.y)}${flags ? ` [${flags}]` : ""}`;
  });
  return `${rows.length} window(s):\n${lines.join("\n")}`;
}

export function renderApps(json: Record<string, any> | undefined, all: boolean): string {
  const apps: any[] = Array.isArray(json?.apps) ? json!.apps : [];
  const rows = apps.filter(entry => all || entry.running);
  const lines = rows.map(entry => `${entry.running ? `pid=${entry.pid}` : "not-running"} ${entry.name} ${entry.bundle_id ?? ""}${entry.active ? " [active]" : ""}${Array.isArray(entry.windows) && entry.windows.length ? ` windows=${entry.windows.length}` : ""}`.trimEnd());
  return `${rows.length} app(s):\n${lines.join("\n")}`;
}

const MENU_BAR = /^(\s*)- \[(\d+)\] AXMenuBar\b/;
const DRIVER_PARTIAL_NOTE = /^⚠️ PARTIAL TREE:/;

/** Collapses AXMenuBar subtrees into one line; the menu op reaches them by path without indices. */
export function foldMenuBar(tree: string): string {
  const out: string[] = [];
  let depth = -1;
  let hidden = 0;
  for (const line of tree.split("\n")) {
    const indent = line.length - line.trimStart().length;
    if (depth >= 0) {
      if (line.trim() && indent > depth) { hidden++; continue; }
      out[out.length - 1] += ` (${hidden} menu rows hidden; use the menu op or menus=true)`;
      depth = -1;
    }
    const match = MENU_BAR.exec(line);
    if (match) { depth = match[1]!.length; hidden = 0; }
    out.push(line);
  }
  if (depth >= 0) out[out.length - 1] += ` (${hidden} menu rows hidden; use the menu op or menus=true)`;
  return out.join("\n");
}

export function renderState(result: DriverResult, options: { menus?: boolean } = {}): string {
  const json = result.json ?? {};
  const header = [
    `${json.app_name ?? "?"} ${quote(json.window_title)} pid=${json.pid} window_id=${json.window_id}`,
    json.snapshot_id ? `snapshot=${json.snapshot_id}` : "",
    // total_element_count counts only what the walk reached, so N/N would read as complete after a cut walk.
    json.returned_element_count !== undefined ? `elements=${json.returned_element_count}${json.truncated ? " (partial)" : `/${json.total_element_count ?? "?"}`}` : "",
  ].filter(Boolean).join(" ");
  const notes: string[] = [];
  if (json.truncated) notes.push(`truncated (${json.truncation_reason ?? "budget"})${json.nodes_pending ? `: ${json.nodes_pending}+ nodes not walked` : ""}; use query to target a control, or raise max_elements/timeout_ms`);
  if (json.degraded) notes.push(`degraded: ${json.degraded_reason ?? "unknown"}`);
  if (json.escalation) notes.push(`escalation: ${compact(json.escalation)}`);
  if (json.screenshot_width) notes.push(`screenshot ${json.screenshot_width}x${json.screenshot_height} (x,y are pixels of this image)`);
  let tree = redactTree(String(json.tree_markdown ?? "").split("\n").filter(line => !DRIVER_PARTIAL_NOTE.test(line)).join("\n").trimEnd());
  if (!options.menus) tree = foldMenuBar(tree);
  if (tree.length > TREE_CHAR_LIMIT) {
    tree = `${tree.slice(0, TREE_CHAR_LIMIT)}\n… tree cut at ${TREE_CHAR_LIMIT} chars; use query or a lower max_elements`;
  }
  return [header, ...notes.map(note => `! ${note}`), tree || "(no accessibility tree)"].join("\n");
}

/** Driver messages name its own tools; point the agent at the omp-desktop call that does the same thing. */
export function agentHint(text: string): string {
  return text.replace(/\bget_window_state\b( with a screenshot)?/g, (_match, screenshot) => `desktop_observe action=state${screenshot ? " screenshot=true" : ""}`)
    .replace(/ on the same connection/g, "");
}

export function compact(value: unknown, limit = 300): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** One line per action: outcome plus the driver's evidence (effect/route) when present. */
export function renderAction(result: DriverResult): string {
  const json = result.json ?? {};
  if (result.isError) {
    const code = result.errorCode ?? json.error_code ?? json.code;
    return `failed${code ? ` [${code}]` : ""}: ${compact(agentHint(firstLine(result.text) || json.message || "driver error"))}`;
  }
  const evidence = [
    json.effect !== undefined ? `effect=${json.effect}` : "",
    json.path !== undefined ? `path=${compact(json.path, 60)}` : json.route !== undefined ? `route=${compact(json.route, 60)}` : "",
    json.verified !== undefined ? `verified=${json.verified}` : "",
    json.escalation ? `escalation=${compact(json.escalation, 160)}` : "",
  ].filter(Boolean);
  return evidence.length ? `ok ${evidence.join(" ")}` : `ok ${compact(firstLine(result.text), 200)}`.trimEnd();
}

function firstLine(text: string): string {
  return text.split("\n").find(line => line.trim())?.trim() ?? "";
}

export const PRUNED_IMAGE_TEXT = "[older desktop screenshot removed to save context; observe again if needed]";

interface PrunableMessage { role?: string; toolName?: string; content?: unknown }

/**
 * Replaces screenshots from `toolNames` results older than the newest `keep` with a short note.
 * Returns undefined when nothing changes, so OMP keeps the original messages (and prompt cache).
 */
export function pruneScreenshots<T extends PrunableMessage>(messages: T[], toolNames: ReadonlySet<string>, keep: number): T[] | undefined {
  let seen = 0;
  let changed = false;
  const next = [...messages];
  for (let index = next.length - 1; index >= 0; index--) {
    const message = next[index];
    if (message?.role !== "toolResult" || !toolNames.has(message.toolName ?? "") || !Array.isArray(message.content)) continue;
    if (!message.content.some(part => part?.type === "image")) continue;
    if (++seen <= keep) continue;
    next[index] = { ...message, content: message.content.map(part => part?.type === "image" ? { type: "text", text: PRUNED_IMAGE_TEXT } : part) };
    changed = true;
  }
  return changed ? next : undefined;
}

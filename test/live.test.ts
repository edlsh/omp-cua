import { expect, test } from "bun:test";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createDesktopExtension } from "../src/index.ts";
import type { DesktopAPI, DesktopContext, DesktopTool } from "../src/host.ts";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const actEnabled = process.env.SMOKE_ACT === "1";

function indexOf(text: string, role: string, label: string): number {
  const line = text.split(/\n(?=\s*- )/).find(row => /^\s*- \[\d+\]/.test(row) && row.includes(role) && row.includes(label));
  const index = line?.match(/\[(\d+)\]/)?.[1];
  expect(index, `Missing ${role} ${label}:\n${text}`).toBeTruthy();
  return Number(index);
}

test("live omp desktop: isolated native window, observations, images, actions, and reset", async () => {
  expect(process.platform).toBe("darwin");
  const tools = new Map<string, DesktopTool>();
  const commands = new Map<string, { handler(args: string, ctx: DesktopContext): Promise<void> }>();
  const events = new Map<string, Function[]>();
  const api: DesktopAPI = {
    registerTool: tool => { tools.set(tool.name, tool); },
    registerCommand: (name, cmd) => { commands.set(name, cmd); },
    on: (event: string, handler: Function) => { events.set(event, [...(events.get(event) ?? []), handler]); },
  };
  createDesktopExtension()(api);
  const sessionId = `live-${Date.now()}`;
  const ctx: DesktopContext = {
    sessionManager: { getSessionId: () => sessionId },
    hasUI: true,
    ui: { notify: () => {}, setStatus: () => {} },
  };
  const run = async (name: string, input: unknown) => {
    const result = await tools.get(name)!.execute("live", input, undefined, undefined, ctx);
    return { ...result, text: result.content.filter(part => part.type === "text").map(part => part.text).join("\n") };
  };
  const ok = (result: Awaited<ReturnType<typeof run>>) => { expect(result.isError, result.text).toBeFalsy(); return result; };

  const dir = await mkdtemp(join(tmpdir(), "omp-cua-live-"));
  const app = join(homedir(), "Applications", `OmpDesktopFixture-${dir.split("/").at(-1)}.app`);
  const executable = join(app, "Contents/MacOS/DesktopFixture");
  await mkdir(join(app, "Contents/MacOS"), { recursive: true });
  await writeFile(join(app, "Contents/Info.plist"), `<?xml version="1.0"?><plist version="1.0"><dict>
    <key>CFBundleExecutable</key><string>DesktopFixture</string>
    <key>CFBundleIdentifier</key><string>dev.omp.desktop-fixture</string>
    <key>CFBundleName</key><string>DesktopFixture</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleVersion</key><string>1.0.0</string>
    <key>CFBundleShortVersionString</key><string>1.0.0</string>
    <key>NSPrincipalClass</key><string>NSApplication</string>
    </dict></plist>`);
  await exec("swiftc", [join(root, "test/fixtures/DesktopFixture.swift"), "-o", executable], { timeout: 60_000 });
  const registrar = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  await exec(registrar, ["-f", app]);
  const child = spawn(executable, [], { stdio: "ignore" });
  try {
    const permissions = ok(await run("desktop_observe", { action: "permissions" }));
    expect(permissions.text).toMatch(/Accessibility: granted/);
    expect(permissions.text).toMatch(/Screen Recording: granted/);
    let windows: Awaited<ReturnType<typeof run>> | undefined;
    for (let attempt = 0; attempt < 30; attempt++) {
      windows = ok(await run("desktop_observe", { action: "windows", pid: child.pid, all: true }));
      if (windows.text.includes("omp-cua Test Fixture")) break;
      await sleep(100);
    }
    const windowId = Number(windows!.text.split("\n").find(line => line.includes("omp-cua Test Fixture"))?.match(/window_id=(\d+)/)?.[1]);
    expect(Number.isFinite(windowId)).toBe(true);
    const target = { pid: child.pid!, window_id: windowId };
    let state: Awaited<ReturnType<typeof run>> | undefined;
    for (let attempt = 0; attempt < 30; attempt++) {
      state = ok(await run("desktop_observe", { action: "state", ...target, max_elements: 120 }));
      if (state.text.includes("Count 0")) break;
      await sleep(100);
    }
    expect(state!.text).toContain("Count 0");
    expect(state!.text).not.toContain("fixture-placeholder");
    const queried = ok(await run("desktop_observe", { action: "state", ...target, query: "Increment" }));
    expect(queried.text).toContain("Increment");
    const screenshot = ok(await run("desktop_observe", { action: "screenshot", ...target, max_image_dimension: 800 }));
    const image = screenshot.content.find(part => part.type === "image");
    expect(image).toBeDefined();
    if (!actEnabled) return;

    const fullState = ok(await run("desktop_act", {
      ...target,
      steps: [{ op: "click", index: indexOf(queried.text, "AXButton", "Increment") }],
      verify: [{ role: "AXStaticText", value: "Count 1" }],
    }));
    expect(fullState.text).toContain("Count 1");
    const inputIdx = indexOf(fullState.text, "AXTextField", "Test input");
    state = ok(await run("desktop_act", { ...target, steps: [{ op: "set_value", index: inputIdx, value: "omp ✓ 日本語" }] }));
    expect(state.text).toContain("diff=diff");
    expect(state.text).toContain("omp ✓ 日本語");
    state = ok(await run("desktop_act", { ...target, steps: [{ op: "focus" }, { op: "wait", ms: 100 }, { op: "menu", path: ["File", "Reset"] }, { op: "wait", ms: 250 }], verify: [{ role: "AXStaticText", value: "Count 0" }], since: "full" }));
    expect(state.text).toContain("Count 0");

    // Drag slider with default delivery and verify updated range value is shown.
    const sliderValue = (text: string) => Number(text.match(/AXSlider \(Test slider\) = "([\d.]+)"/)?.[1]);
    expect(sliderValue(state.text)).toBe(2);
    const bounds = ok(await run("desktop_observe", { action: "windows", pid: child.pid, all: true })).text.split("\n")
      .find(line => line.includes("omp-cua Test Fixture"))!.match(/(\d+)x(\d+)\+/)!.slice(1).map(Number);
    const shot = await run("desktop_observe", { action: "screenshot", ...target, max_image_dimension: 800 });
    const shotImage = shot.content.find(part => part.type === "image") as { data: string };
    const pixels = Buffer.from(shotImage.data, "base64").readUInt32BE(16) / bounds[0]!;
    const sliderY = (bounds[1]! - 294) * pixels;
    state = ok(await run("desktop_act", { ...target, steps: [{ op: "drag", from: [104 * pixels, sliderY], to: [344 * pixels, sliderY], duration_ms: 300 }, { op: "wait", ms: 200 }] }));
    expect(sliderValue(state.text)).toBeGreaterThan(6);

    await commands.get("desktop")!.handler("reset", ctx);
    const stale = await run("desktop_act", { ...target, steps: [{ op: "click", index: 1 }], observe: false });
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("no_snapshot");
    const screen = ok(await run("desktop_driver", { tool: "get_screen_size" }));
    expect(screen.text).toMatch(/\d+x\d+ points/);
  } finally {
    for (const handler of events.get("session_shutdown") ?? []) await handler({}, ctx);
    child.kill("SIGTERM");
    await new Promise<void>(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once("exit", () => resolve()); });
    await exec(registrar, ["-u", app]).catch(() => {});
    await rm(app, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);

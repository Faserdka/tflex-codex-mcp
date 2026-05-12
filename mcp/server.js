#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { recipeTools, buildRecipeBridgeCall } from "./tflex-recipes.js";
import { docsTools, callDocsTool } from "./tflex-docs.js";

const BRIDGE_URL = process.env.TFLEX_BRIDGE_URL || "http://127.0.0.1:38517/command";
const TMP_DIR = process.env.TFLEX_MCP_TMP || path.join(os.tmpdir(), "tflex-codex");

const tools = [
  {
    name: "tflex_bridge_call",
    description: "Call a raw command on the T-FLEX in-process bridge plugin over localhost.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        args: { type: "object", additionalProperties: true }
      },
      required: ["command"]
    }
  },
  {
    name: "tflex_bridge_ping",
    description: "Check whether the T-FLEX bridge plugin is running.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "tflex_execute_csharp",
    description: "Compile and execute C# method-body code inside the active T-FLEX document through the bridge plugin.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "C# statements for the generated Run(Document document, Dictionary<string, object> args) method body."
        },
        scriptArgs: {
          type: "object",
          additionalProperties: true,
          description: "Optional JSON object passed to the C# method as args."
        },
        documentPath: {
          type: "string",
          description: "Optional T-FLEX document path to open before executing the C# code."
        },
        save: {
          type: "boolean",
          default: false,
          description: "Save the active/opened document after successful execution."
        },
        saveAsPath: {
          type: "string",
          description: "Optional path to SaveAs after successful execution. Takes precedence over save=true."
        },
        description: {
          type: "string",
          description: "Optional T-FLEX BeginChanges description."
        }
      },
      required: ["code"]
    }
  },
  {
    name: "tflex_launch",
    description: "Launch T-FLEX CAD 17 from the local installation.",
    inputSchema: {
      type: "object",
      properties: {
        exePath: { type: "string" },
        documentPath: { type: "string" }
      }
    }
  },
  {
    name: "tflex_active_document",
    description: "Return information about the active T-FLEX document.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "tflex_open_document",
    description: "Open a T-FLEX document by path through the bridge plugin.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"]
    }
  },
  {
    name: "tflex_list_variables",
    description: "List variables in the active T-FLEX document.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "tflex_set_variable",
    description: "Set an existing variable in the active T-FLEX document.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        value: { type: ["string", "number", "boolean"] },
        mode: { type: "string", enum: ["auto", "real", "text", "expression"], default: "auto" },
        rebuild: { type: "boolean", default: true }
      },
      required: ["name", "value"]
    }
  },
  {
    name: "tflex_create_variable",
    description: "Create a variable in the active T-FLEX document.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        value: { type: ["string", "number", "boolean"] },
        mode: { type: "string", enum: ["auto", "real", "text", "expression"], default: "auto" },
        rebuild: { type: "boolean", default: true }
      },
      required: ["name", "value"]
    }
  },
  {
    name: "tflex_rebuild",
    description: "Regenerate/rebuild the active T-FLEX document.",
    inputSchema: { type: "object", properties: { full: { type: "boolean", default: true } } }
  },
  {
    name: "tflex_save",
    description: "Save the active T-FLEX document.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "tflex_save_as",
    description: "Save the active T-FLEX document to a new path.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"]
    }
  },
  {
    name: "tflex_export",
    description: "Export the active T-FLEX document. Formats: step, pdf, variables, copy.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string" },
        path: { type: "string" }
      },
      required: ["format", "path"]
    }
  },
  {
    name: "gui_list_windows",
    description: "List visible Windows desktop windows, including T-FLEX windows.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "gui_focus_window",
    description: "Bring a window to foreground by title substring or process name.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        process: { type: "string" }
      }
    }
  },
  {
    name: "gui_screenshot_window",
    description: "Save a screenshot of a window and return the PNG path.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        process: { type: "string" },
        outputPath: { type: "string" }
      }
    }
  },
  {
    name: "gui_click",
    description: "Click at absolute screen coordinates or relative coordinates inside a matched window.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        process: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        relative: { type: "boolean", default: true },
        button: { type: "string", enum: ["left", "right"], default: "left" }
      },
      required: ["x", "y"]
    }
  },
  {
    name: "gui_hotkey",
    description: "Send a Windows Forms SendKeys chord to a matched window, for example ^o, ^s, {ENTER}.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        process: { type: "string" },
        keys: { type: "string" }
      },
      required: ["keys"]
    }
  },
  {
    name: "gui_type_text",
    description: "Type plain text into a matched window.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        process: { type: "string" },
        text: { type: "string" }
      },
      required: ["text"]
    }
  },
  ...docsTools,
  ...recipeTools
];

let buffer = Buffer.alloc(0);
let transportMode = null;

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drainMessages().catch((error) => {
    sendError(null, -32603, error.stack || String(error));
  });
});

async function drainMessages() {
  while (true) {
    const text = buffer.toString("utf8");
    if (/^Content-Length:/i.test(text)) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buffer.subarray(0, headerEnd).toString("utf8");
      const match = /^Content-Length:\s*(\d+)/im.exec(header);
      if (!match) throw new Error("Missing Content-Length header");
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) return;
      const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      buffer = buffer.subarray(bodyStart + length);
      transportMode = "headers";
      await handleMessage(JSON.parse(body));
      continue;
    }

    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    const line = buffer.subarray(0, newline).toString("utf8").trim();
    buffer = buffer.subarray(newline + 1);
    if (!line) continue;
    transportMode = "jsonl";
    await handleMessage(JSON.parse(line));
  }
}

async function handleMessage(message) {
  if (!("id" in message)) return;
  try {
    if (message.method === "initialize") {
      return sendResult(message.id, {
        protocolVersion: message.params?.protocolVersion || "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "tflex-codex-mcp", version: "0.1.0" }
      });
    }
    if (message.method === "ping") {
      return sendResult(message.id, {});
    }
    if (message.method === "tools/list") {
      return sendResult(message.id, { tools });
    }
    if (message.method === "resources/list") {
      return sendResult(message.id, { resources: [] });
    }
    if (message.method === "prompts/list") {
      return sendResult(message.id, { prompts: [] });
    }
    if (message.method === "tools/call") {
      const { name, arguments: args = {} } = message.params || {};
      const result = await callTool(name, args);
      return sendResult(message.id, {
        content: [{ type: "text", text: stringify(result) }]
      });
    }
    sendError(message.id, -32601, `Unknown method: ${message.method}`);
  } catch (error) {
    sendError(message.id, -32603, error.stack || String(error));
  }
}

async function callTool(name, args) {
  const docsResult = await callDocsTool(name, args);
  if (docsResult) return docsResult;

  switch (name) {
    case "tflex_bridge_call":
      return callBridge(args.command, args.args || {});
    case "tflex_bridge_ping":
      return callBridge("ping", {});
    case "tflex_execute_csharp":
      return callBridge("execute_csharp", args);
    case "tflex_launch":
      return launchTflex(args);
    case "tflex_active_document":
      return callBridge("active_document", {});
    case "tflex_open_document":
      return callBridge("open_document", args);
    case "tflex_list_variables":
      return callBridge("list_variables", {});
    case "tflex_set_variable":
      return callBridge("set_variable", args);
    case "tflex_create_variable":
      return callBridge("create_variable", args);
    case "tflex_rebuild":
      return callBridge("rebuild", args);
    case "tflex_save":
      return callBridge("save", {});
    case "tflex_save_as":
      return callBridge("save_as", args);
    case "tflex_export":
      return callBridge("export", args);
    case "gui_list_windows":
      return runGuiScript("list_windows", args);
    case "gui_focus_window":
      return runGuiScript("focus_window", args);
    case "gui_screenshot_window":
      return runGuiScript("screenshot_window", args);
    case "gui_click":
      return runGuiScript("click", args);
    case "gui_hotkey":
      return runGuiScript("hotkey", args);
    case "gui_type_text":
      return runGuiScript("type_text", args);
    default:
      {
        const recipe = buildRecipeBridgeCall(name, args);
        if (recipe) return callBridge(recipe.command, recipe.args);
      }
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function callBridge(command, args) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(BRIDGE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command, args }),
      signal: controller.signal
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      throw new Error(`Bridge HTTP ${response.status}: ${stringify(payload)}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function launchTflex(args) {
  const exePath = args.exePath || process.env.TFLEX_EXE_PATH || "C:\\Program Files\\T-FLEX CAD 17\\Program\\TFlexCad.exe";
  const launchArgs = args.documentPath ? [args.documentPath] : [];
  const child = spawn(exePath, launchArgs, {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();
  return { ok: true, exePath, args: launchArgs, pid: child.pid };
}

async function runGuiScript(action, args) {
  await mkdir(TMP_DIR, { recursive: true });
  if (action === "screenshot_window" && !args.outputPath) {
    args.outputPath = path.join(TMP_DIR, `window-${Date.now()}-${randomUUID()}.png`);
  }
  const encodedArgs = Buffer.from(JSON.stringify({ action, args }), "utf8").toString("base64");
  const script = guiPowerShellScript(encodedArgs);
  const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
  const output = await runProcess("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encodedCommand
  ]);
  try {
    return JSON.parse(output.stdout.trim());
  } catch {
    return { stdout: output.stdout, stderr: output.stderr, exitCode: output.exitCode };
  }
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(`${command} exited ${exitCode}\n${stderr}\n${stdout}`));
      } else {
        resolve({ stdout, stderr, exitCode });
      }
    });
  });
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function send(payload) {
  const json = JSON.stringify(payload);
  if (transportMode === "jsonl") {
    process.stdout.write(`${json}\n`);
    return;
  }
  const body = Buffer.from(json, "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function stringify(value) {
  return JSON.stringify(value, null, 2);
}

function guiPowerShellScript(encodedArgs) {
  return `
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${encodedArgs}")) | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
function Get-Windows {
  $items = New-Object System.Collections.ArrayList
  $callback = [Win32+EnumWindowsProc]{
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if ([Win32]::IsWindowVisible($hWnd)) {
      $sb = New-Object System.Text.StringBuilder 1024
      [void][Win32]::GetWindowText($hWnd, $sb, $sb.Capacity)
      $title = $sb.ToString()
      if ($title.Length -gt 0) {
        $pidValue = [uint32]0
        [void][Win32]::GetWindowThreadProcessId($hWnd, [ref]$pidValue)
        $procName = ""
        try { $procName = (Get-Process -Id $pidValue -ErrorAction Stop).ProcessName } catch {}
        $rect = New-Object Win32+RECT
        [void][Win32]::GetWindowRect($hWnd, [ref]$rect)
        [void]$items.Add([pscustomobject]@{
          hwnd = $hWnd.ToInt64()
          title = $title
          process = $procName
          pid = $pidValue
          left = $rect.Left
          top = $rect.Top
          right = $rect.Right
          bottom = $rect.Bottom
          width = $rect.Right - $rect.Left
          height = $rect.Bottom - $rect.Top
        })
      }
    }
    return $true
  }
  [void][Win32]::EnumWindows($callback, [IntPtr]::Zero)
  return $items
}
function Find-Window($args) {
  $windows = Get-Windows
  if ($args.title) {
    $match = $windows | Where-Object { $_.title -like "*$($args.title)*" } | Select-Object -First 1
    if ($match) { return $match }
  }
  if ($args.process) {
    $match = $windows | Where-Object { $_.process -like "*$($args.process)*" } | Select-Object -First 1
    if ($match) { return $match }
  }
  $match = $windows | Where-Object { $_.title -like "*T-FLEX*" -or $_.process -like "*TFlex*" -or $_.process -like "*T-FLEX*" } | Select-Object -First 1
  if ($match) { return $match }
  throw "Window not found"
}
function Focus-Window($window) {
  $hwnd = [IntPtr]::new([int64]$window.hwnd)
  [void][Win32]::ShowWindow($hwnd, 5)
  Start-Sleep -Milliseconds 100
  [void][Win32]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 150
}
try {
  $action = [string]$payload.action
  $args = $payload.args
  switch ($action) {
    "list_windows" {
      $result = @{ ok = $true; windows = @(Get-Windows) }
    }
    "focus_window" {
      $w = Find-Window $args
      Focus-Window $w
      $result = @{ ok = $true; window = $w }
    }
    "screenshot_window" {
      $w = Find-Window $args
      $bmp = New-Object Drawing.Bitmap $w.width, $w.height
      $graphics = [Drawing.Graphics]::FromImage($bmp)
      $graphics.CopyFromScreen($w.left, $w.top, 0, 0, [Drawing.Size]::new($w.width, $w.height))
      $out = [string]$args.outputPath
      $dir = [IO.Path]::GetDirectoryName($out)
      if ($dir) { [IO.Directory]::CreateDirectory($dir) | Out-Null }
      $bmp.Save($out, [Drawing.Imaging.ImageFormat]::Png)
      $graphics.Dispose()
      $bmp.Dispose()
      $result = @{ ok = $true; path = $out; window = $w }
    }
    "click" {
      $x = [int]$args.x
      $y = [int]$args.y
      $w = $null
      if ($args.title -or $args.process -or $args.relative -ne $false) {
        $w = Find-Window $args
        Focus-Window $w
        if ($args.relative -ne $false) {
          $x = $w.left + $x
          $y = $w.top + $y
        }
      }
      [void][Win32]::SetCursorPos($x, $y)
      Start-Sleep -Milliseconds 50
      if ([string]$args.button -eq "right") {
        [Win32]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)
        [Win32]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)
      } else {
        [Win32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        [Win32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
      }
      $result = @{ ok = $true; x = $x; y = $y; window = $w }
    }
    "hotkey" {
      $w = Find-Window $args
      Focus-Window $w
      [System.Windows.Forms.SendKeys]::SendWait([string]$args.keys)
      $result = @{ ok = $true; window = $w; keys = [string]$args.keys }
    }
    "type_text" {
      $w = Find-Window $args
      Focus-Window $w
      [System.Windows.Forms.SendKeys]::SendWait([string]$args.text)
      $result = @{ ok = $true; window = $w; textLength = ([string]$args.text).Length }
    }
    default { throw "Unknown GUI action: $action" }
  }
  $result | ConvertTo-Json -Depth 8 -Compress
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Depth 4 -Compress
}
`;
}

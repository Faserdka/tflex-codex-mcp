import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MCP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(MCP_DIR, "..");
const ENV_ROOTS = (process.env.TFLEX_DOCS_ROOTS || "")
  .split(path.delimiter)
  .map((root) => root.trim())
  .filter(Boolean);

const DEFAULT_ROOTS = ENV_ROOTS.length > 0 ? ENV_ROOTS : [
  "C:\\Program Files\\T-FLEX CAD 17\\Program",
  "C:\\Program Files\\T-FLEX CAD 17\\API",
  PACKAGE_ROOT
];

const DEFAULT_EXTENSIONS = new Set([".xml", ".cs", ".md", ".txt"]);
const MAX_FILE_BYTES = 12 * 1024 * 1024;

export const docsTools = [
  {
    name: "tflex_docs",
    description: "Search and inspect local T-FLEX API documentation, XML docs, examples, and bridge notes.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["search", "lookup", "examples", "list_files", "read_file", "read_lines"],
          description: "Documentation action."
        },
        query: {
          type: "string",
          description: "Search query, class/member name, or text fragment."
        },
        path: {
          type: "string",
          description: "Path returned by list_files/search for read_file."
        },
        roots: {
          type: "array",
          items: { type: "string" },
          description: "Optional documentation roots. Defaults to local T-FLEX Program/API folders and tflex-codex."
        },
        extensions: {
          type: "array",
          items: { type: "string" },
          description: "Optional file extensions, for example ['.xml', '.cs']."
        },
        limit: {
          type: "number",
          default: 20,
          description: "Maximum number of results."
        },
        context: {
          type: "number",
          default: 2,
          description: "Context lines around matches."
        },
        maxChars: {
          type: "number",
          default: 20000,
          description: "Maximum characters returned by read_file."
        },
        line: {
          type: "number",
          description: "Center line for read_lines."
        },
        startLine: {
          type: "number",
          description: "First line for read_lines."
        },
        endLine: {
          type: "number",
          description: "Last line for read_lines."
        }
      },
      required: ["action"]
    }
  }
];

export async function callDocsTool(name, args = {}) {
  if (name !== "tflex_docs") return null;

  const action = String(args.action || "").toLowerCase();
  if (action === "search") return docsSearch(args);
  if (action === "lookup") return docsLookup(args);
  if (action === "examples") return docsExamples(args);
  if (action === "list_files") return docsListFiles(args);
  if (action === "read_file") return docsReadFile(args);
  if (action === "read_lines") return docsReadLines(args);
  throw new Error(`Unknown tflex_docs action: ${args.action}`);
}

async function docsSearch(args) {
  const query = requireQuery(args);
  const limit = clampNumber(args.limit, 20, 1, 200);
  const context = clampNumber(args.context, 2, 0, 8);
  const files = await collectDocFiles(args);
  const results = [];

  for (const file of files) {
    if (results.length >= limit) break;
    const text = await safeReadText(file);
    if (text == null) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && results.length < limit; i++) {
      if (lines[i].toLowerCase().includes(query.toLowerCase())) {
        results.push(makeLineResult(file, lines, i, context));
      }
    }
  }

  return {
    ok: true,
    action: "search",
    query,
    count: results.length,
    roots: normalizeRoots(args.roots),
    results
  };
}

async function docsLookup(args) {
  const query = requireQuery(args);
  const limit = clampNumber(args.limit, 20, 1, 200);
  const context = clampNumber(args.context, 4, 0, 12);
  const files = await collectDocFiles({
    ...args,
    extensions: args.extensions || [".xml"]
  });
  const exactResults = [];
  const fuzzyResults = [];
  const exactMemberPatterns = [
    `name="T:${query}"`,
    `name="M:${query}"`,
    `name="P:${query}"`,
    `name="F:${query}"`,
    `name="E:${query}"`,
    `name="T:TFlex.${query}"`,
    `name="M:TFlex.${query}"`,
    `name="P:TFlex.${query}"`
  ].map((x) => x.toLowerCase());

  for (const file of files) {
    if (exactResults.length >= limit) break;
    const text = await safeReadText(file);
    if (text == null) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && exactResults.length < limit; i++) {
      const lower = lines[i].toLowerCase();
      if (exactMemberPatterns.some((pattern) => lower.includes(pattern))) {
        exactResults.push(makeLineResult(file, lines, i, context));
      } else if (lower.includes("<member name=") && lower.includes(query.toLowerCase())) {
        fuzzyResults.push(makeLineResult(file, lines, i, context));
      }
    }
  }

  const results = exactResults.concat(fuzzyResults).slice(0, limit);
  return {
    ok: true,
    action: "lookup",
    query,
    count: results.length,
    results
  };
}

async function docsExamples(args) {
  const query = requireQuery(args);
  const limit = clampNumber(args.limit, 10, 1, 50);
  const files = await collectDocFiles({
    ...args,
    extensions: args.extensions || [".xml", ".cs", ".md"]
  });
  const results = [];

  for (const file of files) {
    if (results.length >= limit) break;
    const text = await safeReadText(file);
    if (text == null) continue;

    if (file.toLowerCase().endsWith(".xml")) {
      for (const example of extractXmlCodeExamples(text, query, file)) {
        results.push(example);
        if (results.length >= limit) break;
      }
      continue;
    }

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && results.length < limit; i++) {
      if (lines[i].toLowerCase().includes(query.toLowerCase())) {
        results.push(makeLineResult(file, lines, i, 8));
      }
    }
  }

  return {
    ok: true,
    action: "examples",
    query,
    count: results.length,
    results
  };
}

async function docsListFiles(args) {
  const files = await collectDocFiles(args);
  const limit = clampNumber(args.limit, 200, 1, 1000);
  return {
    ok: true,
    action: "list_files",
    roots: normalizeRoots(args.roots),
    count: files.length,
    files: files.slice(0, limit),
    truncated: files.length > limit
  };
}

async function docsReadFile(args) {
  if (!args.path) throw new Error("Missing path for tflex_docs read_file");
  const requested = path.resolve(String(args.path));
  const allowedRoots = normalizeRoots(args.roots).map((root) => path.resolve(root).toLowerCase());
  const inRoot = allowedRoots.some((root) => requested.toLowerCase().startsWith(root));
  if (!inRoot) {
    throw new Error(`Path is outside allowed documentation roots: ${requested}`);
  }

  const text = await safeReadText(requested, true);
  const maxChars = clampNumber(args.maxChars, 20000, 1000, 200000);
  return {
    ok: true,
    action: "read_file",
    path: requested,
    length: text.length,
    truncated: text.length > maxChars,
    text: text.slice(0, maxChars)
  };
}

async function docsReadLines(args) {
  if (!args.path) throw new Error("Missing path for tflex_docs read_lines");
  const requested = path.resolve(String(args.path));
  const allowedRoots = normalizeRoots(args.roots).map((root) => path.resolve(root).toLowerCase());
  const inRoot = allowedRoots.some((root) => requested.toLowerCase().startsWith(root));
  if (!inRoot) {
    throw new Error(`Path is outside allowed documentation roots: ${requested}`);
  }

  const text = await safeReadText(requested, true);
  const lines = text.split(/\r?\n/);
  let start;
  let end;
  if (args.line != null) {
    const line = clampNumber(args.line, 1, 1, lines.length);
    const context = clampNumber(args.context, 20, 0, 200);
    start = Math.max(1, line - context);
    end = Math.min(lines.length, line + context);
  } else {
    start = clampNumber(args.startLine, 1, 1, lines.length);
    end = clampNumber(args.endLine, start + 80, start, lines.length);
  }

  const numbered = [];
  for (let i = start; i <= end; i++) {
    numbered.push(`${i}: ${lines[i - 1]}`);
  }

  return {
    ok: true,
    action: "read_lines",
    path: requested,
    startLine: start,
    endLine: end,
    totalLines: lines.length,
    text: numbered.join("\n")
  };
}

async function collectDocFiles(args) {
  const roots = normalizeRoots(args.roots);
  const extensions = normalizeExtensions(args.extensions);
  const results = [];
  for (const root of roots) {
    await walk(root, extensions, results);
  }
  results.sort((a, b) => rankDocFile(a) - rankDocFile(b) || a.localeCompare(b));
  return results;
}

async function walk(dir, extensions, results) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      await walk(full, extensions, results);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (extensions.has(ext)) results.push(full);
  }
}

function shouldSkipDir(name) {
  const lower = name.toLowerCase();
  return lower === "bin" || lower === "obj" || lower === ".git" || lower === "node_modules";
}

async function safeReadText(file, throwOnError = false) {
  try {
    const info = await stat(file);
    if (info.size > MAX_FILE_BYTES) return null;
    const buffer = await readFile(file);
    return decodeText(buffer);
  } catch (error) {
    if (throwOnError) throw error;
    return null;
  }
}

function decodeText(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf8");
  }
  return buffer.toString("utf8");
}

function extractXmlCodeExamples(text, query, file) {
  const results = [];
  const lowerQuery = query.toLowerCase();
  const codeRegex = /<code\b([^>]*)>([\s\S]*?)<\/code>/gi;
  let match;
  while ((match = codeRegex.exec(text)) !== null) {
    const attrs = match[1] || "";
    const rawCode = decodeXmlEntities(match[2] || "").trim();
    const searchable = `${attrs}\n${rawCode}`.toLowerCase();
    if (!searchable.includes(lowerQuery)) continue;
    const line = lineNumberAt(text, match.index);
    results.push({
      path: file,
      line,
      title: extractCodeName(attrs),
      text: rawCode.slice(0, 6000),
      truncated: rawCode.length > 6000
    });
  }
  return results;
}

function makeLineResult(file, lines, index, context) {
  const start = Math.max(0, index - context);
  const end = Math.min(lines.length - 1, index + context);
  const snippet = [];
  for (let i = start; i <= end; i++) {
    snippet.push(`${i + 1}: ${lines[i]}`);
  }
  return {
    path: file,
    line: index + 1,
    text: lines[index],
    context: snippet.join("\n")
  };
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function extractCodeName(attrs) {
  const match = /\bname\s*=\s*"([^"]+)"/i.exec(attrs);
  return match ? decodeXmlEntities(match[1]) : null;
}

function decodeXmlEntities(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeRoots(roots) {
  if (!Array.isArray(roots) || roots.length === 0) return DEFAULT_ROOTS;
  return roots.map((root) => String(root));
}

function normalizeExtensions(extensions) {
  if (!Array.isArray(extensions) || extensions.length === 0) return DEFAULT_EXTENSIONS;
  return new Set(extensions.map((ext) => {
    const value = String(ext).toLowerCase();
    return value.startsWith(".") ? value : `.${value}`;
  }));
}

function requireQuery(args) {
  if (!args.query) throw new Error("Missing query for tflex_docs");
  return String(args.query);
}

function clampNumber(value, defaultValue, min, max) {
  const n = Number(value ?? defaultValue);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function rankDocFile(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith("tflexapi3d.xml")) return 0;
  if (lower.endsWith("tflexapi.xml")) return 1;
  if (lower.endsWith("tflexcommandapi.xml")) return 2;
  if (lower.includes("\\api\\")) return 3;
  if (lower.endsWith(".md")) return 4;
  return 5;
}

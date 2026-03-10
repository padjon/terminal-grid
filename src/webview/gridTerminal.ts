import { Terminal, ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

declare const __GRID_ROWS: number;
declare const __GRID_COLS: number;
declare const __GRID_ZOOM: number;
declare const __GRID_FONT_FAMILY: string;
declare const __GRID_BG_COLOR: string;
declare const __GRID_FG_COLOR: string;
declare const __GRID_THEME: string;
declare const __GRID_THEME_COLORS: Record<string, string> | null;
declare const __GRID_MERGE_REGIONS: { startRow: number; startCol: number; rowSpan: number; colSpan: number }[];

const vscode = acquireVsCodeApi();
const rows = __GRID_ROWS;
const cols = __GRID_COLS;
const total = rows * cols;

// ── Merge regions ──
const mergeRegions = (typeof __GRID_MERGE_REGIONS !== "undefined" ? __GRID_MERGE_REGIONS : []) || [];
const hiddenCells = new Set<number>();
for (const m of mergeRegions) {
  for (let r = m.startRow; r < m.startRow + m.rowSpan; r++) {
    for (let c = m.startCol; c < m.startCol + m.colSpan; c++) {
      if (r === m.startRow && c === m.startCol) continue;
      hiddenCells.add(r * cols + c);
    }
  }
}
function getMergeOrigin(cellRow: number, cellCol: number) {
  return mergeRegions.find(m => m.startRow === cellRow && m.startCol === cellCol);
}

let globalZoom = __GRID_ZOOM;
let fontFamilyOverride = __GRID_FONT_FAMILY;
let bgColorOverride = __GRID_BG_COLOR;
let fgColorOverride = __GRID_FG_COLOR;
let globalThemeName = __GRID_THEME;
let globalThemeColors = __GRID_THEME_COLORS;

const ZOOM_STEP = 10;
const ZOOM_MIN = 50;
const ZOOM_MAX = 300;

// ── Read IDE theme via CSS variables ──
function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function buildThemeFromColors(tc: Record<string, string> | null): ITheme {
  if (tc) {
    // Theme colors provided — use them, but allow bg/fg overrides on top
    const bg = bgColorOverride || tc.background || "";
    const fg = fgColorOverride || tc.foreground || "";
    return {
      background: bg || undefined,
      foreground: fg || undefined,
      cursor: tc.cursor || fg || undefined,
      cursorAccent: tc.cursorAccent || bg || undefined,
      selectionBackground: tc.selectionBackground || undefined,
      black: tc.black || undefined, brightBlack: tc.brightBlack || undefined,
      red: tc.red || undefined, brightRed: tc.brightRed || undefined,
      green: tc.green || undefined, brightGreen: tc.brightGreen || undefined,
      yellow: tc.yellow || undefined, brightYellow: tc.brightYellow || undefined,
      blue: tc.blue || undefined, brightBlue: tc.brightBlue || undefined,
      magenta: tc.magenta || undefined, brightMagenta: tc.brightMagenta || undefined,
      cyan: tc.cyan || undefined, brightCyan: tc.brightCyan || undefined,
      white: tc.white || undefined, brightWhite: tc.brightWhite || undefined,
    };
  }
  // IDE Default — read CSS variables
  const bg = bgColorOverride || css("--vscode-terminal-background") || css("--vscode-editor-background") || "";
  const fg = fgColorOverride || css("--vscode-terminal-foreground") || css("--vscode-editor-foreground") || "";
  return {
    background: bg || undefined,
    foreground: fg || undefined,
    cursor: css("--vscode-terminalCursor-foreground") || fg || undefined,
    cursorAccent: bg || undefined,
    selectionBackground: css("--vscode-terminal-selectionBackground") || undefined,
    selectionForeground: css("--vscode-terminal-selectionForeground") || undefined,
    black: css("--vscode-terminal-ansiBlack") || undefined,
    brightBlack: css("--vscode-terminal-ansiBrightBlack") || undefined,
    red: css("--vscode-terminal-ansiRed") || undefined,
    brightRed: css("--vscode-terminal-ansiBrightRed") || undefined,
    green: css("--vscode-terminal-ansiGreen") || undefined,
    brightGreen: css("--vscode-terminal-ansiBrightGreen") || undefined,
    yellow: css("--vscode-terminal-ansiYellow") || undefined,
    brightYellow: css("--vscode-terminal-ansiBrightYellow") || undefined,
    blue: css("--vscode-terminal-ansiBlue") || undefined,
    brightBlue: css("--vscode-terminal-ansiBrightBlue") || undefined,
    magenta: css("--vscode-terminal-ansiMagenta") || undefined,
    brightMagenta: css("--vscode-terminal-ansiBrightMagenta") || undefined,
    cyan: css("--vscode-terminal-ansiCyan") || undefined,
    brightCyan: css("--vscode-terminal-ansiBrightCyan") || undefined,
    white: css("--vscode-terminal-ansiWhite") || undefined,
    brightWhite: css("--vscode-terminal-ansiBrightWhite") || undefined,
  };
}

function buildTheme(): ITheme {
  return buildThemeFromColors(globalThemeColors);
}

function getTermFontFamily(): string {
  if (fontFamilyOverride) return fontFamilyOverride;
  return (
    css("--vscode-terminal-fontFamily") ||
    css("--vscode-editor-fontFamily") ||
    'Consolas, "Courier New", monospace'
  );
}

function baseFontSize(): number {
  const raw = css("--vscode-terminal-fontSize") || css("--vscode-editor-fontSize");
  const n = parseInt(raw, 10);
  return n > 0 ? n : 13;
}

// ── Zoom helpers ──
function calcFontSize(cellZoom: number): number {
  const base = baseFontSize();
  return Math.max(6, Math.round(base * (globalZoom / 100) * (cellZoom / 100)));
}

function displayPct(cellZoom: number): number {
  const raw = Math.round((globalZoom / 100) * cellZoom);
  return Math.round(raw / 10) * 10;
}

function applyZoom(cell: Cell): void {
  cell.terminal.options.fontSize = calcFontSize(cell.zoom);
  cell.fitAddon.fit();
  const pct = displayPct(cell.zoom);
  cell.zoomLabel.textContent = pct === 100 ? "" : pct + "%";
  vscode.postMessage({
    type: "resize",
    id: cells.indexOf(cell),
    cols: cell.terminal.cols,
    rows: cell.terminal.rows,
  });
}

// ── Apply background color override to containers ──
function applyBgOverride(): void {
  const bg = bgColorOverride || (globalThemeColors?.background ?? "");
  document.body.style.background = bg || "";
  grid.style.background = bg || "";
  for (let idx = 0; idx < cells.length; idx++) {
    const cell = cells[idx];
    if (!cell) continue;
    const ov = cellOverrides[idx];
    // Skip cells with their own bg override or cell-level theme
    if (ov?.bgColor || ov?.themeColors?.background) continue;
    cell.el.style.background = bg || "";
    cell.el.querySelectorAll<HTMLElement>(".term-container, .xterm, .xterm-viewport, .xterm-screen").forEach(el => {
      el.style.backgroundColor = bg || "";
    });
  }
}

interface ParsedTerminalLink {
  startX: number;
  endX: number;
  startY: number;
  endY: number;
  text: string;
  url?: string;
  filePath?: string;
  line?: number;
  column?: number;
}

interface ParsedTextLink {
  startIndex: number;
  endIndex: number;
  text: string;
  url?: string;
  filePath?: string;
  line?: number;
  column?: number;
}

function trimTokenForLink(token: string): { text: string; startOffset: number } {
  let startOffset = 0;
  let endOffset = token.length;
  while (startOffset < token.length && /[([{"'`<]/.test(token[startOffset])) {
    startOffset++;
  }
  while (endOffset > startOffset && /[)\]}>"'`,.;!?]/.test(token[endOffset - 1])) {
    endOffset--;
  }
  return { text: token.slice(startOffset, endOffset), startOffset };
}

function isWebLink(token: string): boolean {
  return /^(https?:\/\/|mailto:|file:\/\/)/i.test(token);
}

function looksLikeFilePath(token: string): boolean {
  if (!token) return false;
  if (token.startsWith("~/") || token.startsWith("~\\")) return true;
  if (token.startsWith("./") || token.startsWith("../") || token.startsWith(".\\") || token.startsWith("..\\")) return true;
  if (token.startsWith("/") || token.startsWith("\\\\")) return true;
  if (/^[A-Za-z]:[\\/]/.test(token)) return true;
  if ((token.includes("/") || token.includes("\\")) && /\.[A-Za-z0-9._-]+$/.test(token)) return true;
  return false;
}

function parseFileToken(token: string): { filePath: string; line?: number; column?: number } | null {
  let normalized = token;
  const markdownTarget = normalized.match(/^[^\]]*\]\(([^)\s]+)\)$/);
  if (markdownTarget) {
    normalized = markdownTarget[1];
  } else if (normalized.includes("](")) {
    // Avoid treating partial markdown fragments as file paths.
    return null;
  }
  if (normalized.includes("://")) return null;

  let candidate = normalized;
  let line: number | undefined;
  let column: number | undefined;

  const hashTail = candidate.match(/^(.*)#L(\d+)(?:C(\d+))?$/i);
  if (hashTail) {
    candidate = hashTail[1];
    line = Number.parseInt(hashTail[2], 10);
    if (hashTail[3]) {
      column = Number.parseInt(hashTail[3], 10);
    }
  }

  const numericTail = candidate.match(/^(.*):(\d+)(?::(\d+))?$/);
  if (numericTail) {
    const pathPart = numericTail[1];
    if (pathPart.length > 1) {
      candidate = pathPart;
      line = Number.parseInt(numericTail[2], 10);
      if (numericTail[3]) {
        column = Number.parseInt(numericTail[3], 10);
      }
    }
  }

  if (!looksLikeFilePath(candidate)) return null;
  return { filePath: candidate, line, column };
}

function parseMarkdownToken(raw: string): { startOffset: number; endOffset: number; text: string; target: string } | null {
  const wrapped = raw.match(/^([({"'`<]*)(\[[^\]]+\]\(([^)\s]+)\))([)\]}>"'`,.;!?]*)$/);
  if (!wrapped) return null;
  const leading = wrapped[1].length;
  const markdown = wrapped[2];
  const match = markdown.match(/^\[[^\]]+\]\(([^)\s]+)\)$/);
  if (!match) return null;
  return {
    startOffset: leading,
    endOffset: leading + markdown.length,
    text: markdown,
    target: match[1],
  };
}

function parseTextLinks(text: string): ParsedTextLink[] {
  const links: ParsedTextLink[] = [];
  const maskedChars = Array.from(text);

  const markdownRegex = /\[[^\]\n]+\]\(([^)\s]+)\)/g;
  let markdownMatch: RegExpExecArray | null = null;
  while ((markdownMatch = markdownRegex.exec(text)) !== null) {
    const markdown = markdownMatch[0];
    const target = markdownMatch[1];
    const startIndex = markdownMatch.index;
    const endIndex = startIndex + markdown.length - 1;
    if (isWebLink(target)) {
      links.push({ startIndex, endIndex, text: markdown, url: target });
    } else {
      const markdownFile = parseFileToken(target);
      if (markdownFile) {
        links.push({
          startIndex,
          endIndex,
          text: markdown,
          filePath: markdownFile.filePath,
          line: markdownFile.line,
          column: markdownFile.column,
        });
      }
    }
    for (let i = startIndex; i <= endIndex; i++) {
      maskedChars[i] = " ";
    }
  }

  const maskedText = maskedChars.join("");
  const tokenRegex = /\S+/g;
  let match: RegExpExecArray | null = null;

  while ((match = tokenRegex.exec(maskedText)) !== null) {
    const raw = match[0];

    const markdown = parseMarkdownToken(raw);
    if (markdown) {
      const startIndex = match.index + markdown.startOffset;
      const endIndex = match.index + markdown.endOffset - 1;
      if (isWebLink(markdown.target)) {
        links.push({ startIndex, endIndex, text: markdown.text, url: markdown.target });
        continue;
      }
      const markdownFile = parseFileToken(markdown.target);
      if (markdownFile) {
        links.push({
          startIndex,
          endIndex,
          text: markdown.text,
          filePath: markdownFile.filePath,
          line: markdownFile.line,
          column: markdownFile.column,
        });
        continue;
      }
    }

    const { text: token, startOffset } = trimTokenForLink(raw);
    if (!token) continue;

    const startIndex = match.index + startOffset;
    const endIndex = startIndex + token.length - 1;

    if (isWebLink(token)) {
      links.push({ startIndex, endIndex, text: token, url: token });
      continue;
    }

    const file = parseFileToken(token);
    if (file) {
      links.push({
        startIndex,
        endIndex,
        text: token,
        filePath: file.filePath,
        line: file.line,
        column: file.column,
      });
    }
  }

  return links;
}

function getWrappedLineRange(terminal: Terminal, bufferLineNumber: number): { start: number; end: number } {
  const buffer = terminal.buffer.active;
  let start = bufferLineNumber - 1;
  let end = bufferLineNumber - 1;

  while (start > 0 && buffer.getLine(start)?.isWrapped) {
    start--;
  }
  while (buffer.getLine(end + 1)?.isWrapped) {
    end++;
  }

  return { start, end };
}

interface WrappedSegment {
  offset: number;
  length: number;
  y: number;
  startX: number;
}

function isPathLikeChunk(text: string): boolean {
  if (!text) return false;
  if (/\s/.test(text)) return false;
  return /^[A-Za-z0-9@._+\-:/\\]+$/.test(text);
}

function isPathContinuationBoundary(prevRaw: string, nextRaw: string): boolean {
  const prev = prevRaw.trimEnd();
  const next = nextRaw.trim();
  if (!prev || !next) return false;
  if (!isPathLikeChunk(next)) return false;
  if (!/[\\/]/.test(prev) && !/[\\/]/.test(next)) return false;
  if (/[\\/+\-._@]$/.test(prev)) return true;
  if (/[A-Za-z0-9]$/.test(prev) && /[\\/]/.test(prev) && /^[A-Za-z0-9@._+\-]/.test(next)) return true;
  return false;
}

function readWrappedText(
  terminal: Terminal,
  start: number,
  end: number
): { text: string; segments: WrappedSegment[] } {
  const buffer = terminal.buffer.active;
  let text = "";
  const segments: WrappedSegment[] = [];
  let offset = 0;

  for (let i = start; i <= end; i++) {
    const line = buffer.getLine(i);
    if (!line) continue;
    const rawLineText = line.translateToString(true);
    let lineText = rawLineText;
    let startX = 1;
    if (i > start) {
      const prevRaw = buffer.getLine(i - 1)?.translateToString(true) ?? "";
      if (isPathContinuationBoundary(prevRaw, rawLineText)) {
        const leadingWhitespace = rawLineText.match(/^\s*/)?.[0].length ?? 0;
        lineText = rawLineText.slice(leadingWhitespace);
        startX = leadingWhitespace + 1;
      }
    }
    segments.push({
      offset,
      length: lineText.length,
      y: i + 1,
      startX,
    });
    text += lineText;
    offset += lineText.length;
  }

  return { text, segments };
}

function indexToPosition(index: number, segments: WrappedSegment[]): { x: number; y: number } {
  for (const segment of segments) {
    const segEnd = segment.offset + segment.length;
    if (index < segEnd) {
      return { x: segment.startX + (index - segment.offset), y: segment.y };
    }
  }
  const fallback = segments[segments.length - 1];
  if (!fallback) return { x: 1, y: 1 };
  return { x: Math.max(1, fallback.startX + fallback.length - 1), y: fallback.y };
}

function registerTerminalLinks(terminal: Terminal): void {
  terminal.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const buffer = terminal.buffer.active;
      let { start, end } = getWrappedLineRange(terminal, bufferLineNumber);
      while (start > 0) {
        const prevRaw = buffer.getLine(start - 1)?.translateToString(true) ?? "";
        const curRaw = buffer.getLine(start)?.translateToString(true) ?? "";
        if (!isPathContinuationBoundary(prevRaw, curRaw)) break;
        start--;
      }
      while (buffer.getLine(end + 1)) {
        const curRaw = buffer.getLine(end)?.translateToString(true) ?? "";
        const nextRaw = buffer.getLine(end + 1)?.translateToString(true) ?? "";
        if (!isPathContinuationBoundary(curRaw, nextRaw)) break;
        end++;
      }
      const { text, segments } = readWrappedText(terminal, start, end);
      if (!text || segments.length === 0) {
        callback(undefined);
        return;
      }
      const parsed = parseTextLinks(text);
      const mapped: ParsedTerminalLink[] = parsed.map((item) => {
        const startPos = indexToPosition(item.startIndex, segments);
        const endPos = indexToPosition(item.endIndex, segments);
        return {
          startX: startPos.x,
          endX: endPos.x,
          startY: startPos.y,
          endY: endPos.y,
          text: item.text,
          url: item.url,
          filePath: item.filePath,
          line: item.line,
          column: item.column,
        };
      }).filter((item) => item.startY <= bufferLineNumber && item.endY >= bufferLineNumber);

      if (mapped.length === 0) {
        callback(undefined);
        return;
      }

      callback(mapped.map((item) => {
        const rangeStartX = item.startY === bufferLineNumber ? item.startX : 1;
        const rangeEndX = item.endY === bufferLineNumber ? item.endX : terminal.cols;
        return {
        range: {
          start: { x: rangeStartX, y: bufferLineNumber },
          end: { x: rangeEndX, y: bufferLineNumber },
        },
        text: item.text,
        activate: () => {
          if (item.url) {
            vscode.postMessage({ type: "openExternalLink", url: item.url });
            return;
          }
          if (item.filePath) {
            vscode.postMessage({
              type: "openFileLink",
              path: item.filePath,
              line: item.line,
              column: item.column,
            });
          }
        },
        decorations: { underline: true, pointerCursor: true },
      };
      }));
    },
  });
}

// ── Build cells ──
interface Cell {
  terminal: Terminal;
  fitAddon: FitAddon;
  el: HTMLDivElement;
  zoom: number;
  zoomLabel: HTMLSpanElement;
  labelEl: HTMLSpanElement;
}

const cells: (Cell | null)[] = [];
const grid = document.getElementById("grid")!;
let lastInteractedCellId = -1;
let lastFocusedCellId: number | null = null;
let shouldRestoreFocusOnReturn = false;
let restoreFocusInterval: ReturnType<typeof setInterval> | undefined;
let restoreFocusTimeout: ReturnType<typeof setTimeout> | undefined;
let lastTerminalBlurAt = 0;
const TAB_OUT_BLUR_GRACE_MS = 500;

function stopRestoreFocusLoop(): void {
  if (restoreFocusInterval) {
    clearInterval(restoreFocusInterval);
    restoreFocusInterval = undefined;
  }
  if (restoreFocusTimeout) {
    clearTimeout(restoreFocusTimeout);
    restoreFocusTimeout = undefined;
  }
}

function getFocusedCellId(): number | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return null;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!cell) continue;
    if (cell.terminal.textarea === active) return i;
  }
  return null;
}

function armRestoreFocusForWindowReturn(): void {
  const id = getFocusedCellId();
  if (id !== null) {
    lastFocusedCellId = id;
    lastInteractedCellId = id;
    shouldRestoreFocusOnReturn = true;
    return;
  }
  if (
    lastFocusedCellId !== null &&
    Date.now() - lastTerminalBlurAt <= TAB_OUT_BLUR_GRACE_MS
  ) {
    shouldRestoreFocusOnReturn = true;
  }
}

function focusLastFocusedCellIfNeeded(): void {
  if (!shouldRestoreFocusOnReturn || lastFocusedCellId === null) return;
  if (!document.hasFocus()) return;
  if (getFocusedCellId() !== null) {
    shouldRestoreFocusOnReturn = false;
    stopRestoreFocusLoop();
    return;
  }
  const targetCell = cells[lastFocusedCellId];
  if (!targetCell) {
    shouldRestoreFocusOnReturn = false;
    stopRestoreFocusLoop();
    return;
  }
  targetCell.terminal.focus();
  targetCell.terminal.textarea?.focus();
  lastInteractedCellId = lastFocusedCellId;
}

function startRestoreFocusLoop(): void {
  if (!shouldRestoreFocusOnReturn || lastFocusedCellId === null) return;
  stopRestoreFocusLoop();
  focusLastFocusedCellIfNeeded();
  restoreFocusInterval = setInterval(focusLastFocusedCellIfNeeded, 100);
  restoreFocusTimeout = setTimeout(() => {
    shouldRestoreFocusOnReturn = false;
    stopRestoreFocusLoop();
  }, 3000);
}

window.addEventListener("blur", armRestoreFocusForWindowReturn);
window.addEventListener("focus", startRestoreFocusLoop);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    armRestoreFocusForWindowReturn();
    return;
  }
  if (document.visibilityState === "visible") {
    startRestoreFocusLoop();
  }
});

function resolveTargetCellId(preferredId?: number): number | null {
  if (preferredId !== undefined && preferredId >= 0 && preferredId < cells.length && cells[preferredId]) {
    return preferredId;
  }
  if (lastInteractedCellId >= 0 && lastInteractedCellId < cells.length && cells[lastInteractedCellId]) {
    return lastInteractedCellId;
  }
  if (lastFocusedCellId !== null && lastFocusedCellId >= 0 && lastFocusedCellId < cells.length && cells[lastFocusedCellId]) {
    return lastFocusedCellId;
  }
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]) return i;
  }
  return null;
}

function pasteTextToCell(cellId: number, text: string): void {
  if (!text) return;
  vscode.postMessage({ type: "input", id: cellId, data: text });
  cells[cellId]?.terminal.focus();
  lastInteractedCellId = cellId;
  lastFocusedCellId = cellId;
}

function sendEscapeToCell(cellId: number): void {
  vscode.postMessage({ type: "input", id: cellId, data: "\u001b" });
  cells[cellId]?.terminal.focus();
  cells[cellId]?.terminal.textarea?.focus();
  lastInteractedCellId = cellId;
  lastFocusedCellId = cellId;
}

function requestPasteToCell(preferredId?: number): void {
  const targetId = resolveTargetCellId(preferredId);
  if (targetId === null) return;
  navigator.clipboard.readText().then((text) => {
    pasteTextToCell(targetId, text);
  }).catch(() => {
    // Fallback to extension host clipboard when webview clipboard access is denied.
    vscode.postMessage({ type: "clipboardRead", id: targetId });
  });
}

function toOsc8Link(label: string, target: string): string {
  // OSC 8 hyperlink: ESC ] 8 ;; URI BEL <label> ESC ] 8 ;; BEL
  return `\u001b]8;;${target}\u0007${label}\u001b]8;;\u0007`;
}

function transformMarkdownLinksToOsc8(text: string): string {
  // Convert markdown links before rendering in xterm so short labels keep hidden targets.
  return text.replace(/(^|[^!\\])\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, prefix: string, label: string, target: string) => {
    return `${prefix}${toOsc8Link(label, target)}`;
  });
}

function isBareAltMnemonic(e: KeyboardEvent): boolean {
  const isAltKey = e.key === "Alt" || e.code === "AltLeft" || e.code === "AltRight";
  return isAltKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
}

function isTerminalInputFocused(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  if (active.classList.contains("xterm-helper-textarea")) return true;
  return !!active.closest(".cell");
}

function swallowMenuMnemonicEvent(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopPropagation();
  // stopImmediatePropagation is available on Event in browsers.
  if (typeof (e as { stopImmediatePropagation?: () => void }).stopImmediatePropagation === "function") {
    (e as { stopImmediatePropagation: () => void }).stopImmediatePropagation();
  }
}

// Guard against delayed bare-Alt events after app switching (e.g. Alt+Tab).
// In webviews, those events can bubble back to VS Code and steal focus.
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (!isTerminalInputFocused()) return;
  if (isBareAltMnemonic(e)) swallowMenuMnemonicEvent(e);
}, true);

window.addEventListener("keyup", (e: KeyboardEvent) => {
  if (!isTerminalInputFocused()) return;
  if (isBareAltMnemonic(e)) swallowMenuMnemonicEvent(e);
}, true);

window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key !== "Escape" || e.repeat) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (getFocusedCellId() !== null) return;

  const targetId = resolveTargetCellId();
  if (targetId === null) return;

  e.preventDefault();
  e.stopPropagation();
  if (typeof (e as { stopImmediatePropagation?: () => void }).stopImmediatePropagation === "function") {
    (e as { stopImmediatePropagation: () => void }).stopImmediatePropagation();
  }

  sendEscapeToCell(targetId);
}, true);

for (let i = 0; i < total; i++) {
  if (hiddenCells.has(i)) {
    cells.push(null);
    continue;
  }

  const cellRow = Math.floor(i / cols);
  const cellCol = i % cols;

  const cellDiv = document.createElement("div");
  cellDiv.className = "cell";

  // Explicit grid positioning (required when merges exist)
  cellDiv.style.gridRow = String(cellRow + 1);
  cellDiv.style.gridColumn = String(cellCol + 1);
  const mergeInfo = getMergeOrigin(cellRow, cellCol);
  if (mergeInfo) {
    cellDiv.style.gridRow = `${cellRow + 1} / span ${mergeInfo.rowSpan}`;
    cellDiv.style.gridColumn = `${cellCol + 1} / span ${mergeInfo.colSpan}`;
  }

  // Info bar: number + zoom %
  const info = document.createElement("div");
  info.className = "cell-info";

  const zoomLabel = document.createElement("span");
  zoomLabel.className = "cell-zoom-pct";
  info.appendChild(zoomLabel);

  const label = document.createElement("span");
  label.className = "cell-label";
  label.textContent = `${i + 1}`;
  info.appendChild(label);

  cellDiv.appendChild(info);

  const termContainer = document.createElement("div");
  termContainer.className = "term-container";
  cellDiv.appendChild(termContainer);

  grid.appendChild(cellDiv);

  const terminal = new Terminal({
    fontSize: calcFontSize(100),
    fontFamily: getTermFontFamily(),
    theme: buildTheme(),
    cursorBlink: true,
    scrollback: 5000,
    allowTransparency: true,
    linkHandler: {
      allowNonHttpProtocols: true,
      activate: (_event, text) => {
        vscode.postMessage({ type: "openExternalLink", url: text });
      },
    },
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(termContainer);
  registerTerminalLinks(terminal);

  terminal.onData((data: string) => {
    vscode.postMessage({ type: "input", id: i, data });
  });

  terminal.textarea?.addEventListener("focus", () => {
    lastInteractedCellId = i;
    lastFocusedCellId = i;
    lastTerminalBlurAt = 0;
    shouldRestoreFocusOnReturn = false;
    stopRestoreFocusLoop();
    cellDiv.classList.add("focused");
  });
  terminal.textarea?.addEventListener("blur", () => {
    lastTerminalBlurAt = Date.now();
    cellDiv.classList.remove("focused");
  });
  cellDiv.addEventListener("mousedown", () => {
    lastInteractedCellId = i;
    lastFocusedCellId = i;
  });

  const cell: Cell = { terminal, fitAddon, el: cellDiv, zoom: 100, zoomLabel, labelEl: label };
  cells.push(cell);

  // Ctrl+Wheel zoom — capture phase so it fires BEFORE xterm.js handles scroll
  cellDiv.addEventListener("wheel", (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.deltaY < 0) {
      cell.zoom = Math.min(ZOOM_MAX, cell.zoom + ZOOM_STEP);
    } else {
      cell.zoom = Math.max(ZOOM_MIN, cell.zoom - ZOOM_STEP);
    }
    applyZoom(cell);
  }, { capture: true, passive: false });

  // Ctrl+0 reset zoom, Ctrl+C copy when selection exists.
  // Paste shortcuts are handled by VS Code keybindings for this webview.
  terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
    // Prevent VS Code mnemonic/menu focus steal caused by bare Alt key events.
    if (isBareAltMnemonic(e)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    const key = e.key.toLowerCase();
    if (e.ctrlKey && e.type === "keydown" && key === "0") {
      cell.zoom = 100;
      applyZoom(cell);
      return false;
    }
    if (e.ctrlKey && e.type === "keydown" && key === "c") {
      const sel = terminal.getSelection();
      if (sel) {
        navigator.clipboard.writeText(sel).then(() => {
          terminal.focus();
        }).catch(() => {});
        return false;
      }
    }
    // Keep key handling inside xterm while the terminal is focused.
    // Forwarding VS Code shortcuts from this webview can steal focus
    // (for example quick open / command center) and interrupt typing.
    if (e.type === "keydown") {
      // F1~F12
      if (e.key.match(/^F\d{1,2}$/)) return false;
    }
    return true;
  });
}

// ── Context menu ──
const ctxMenu = document.getElementById("ctxMenu")!;
let ctxTargetId = -1;
let ctxSelectionPosition: { start: { x: number; y: number }; end: { x: number; y: number } } | undefined;

for (let i = 0; i < cells.length; i++) {
  if (!cells[i]) continue;
  cells[i]!.el.addEventListener("contextmenu", (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    ctxTargetId = i;
    ctxSelectionPosition = cells[i]?.terminal.getSelectionPosition() ?? undefined;
    ctxMenu.style.left = e.clientX + "px";
    ctxMenu.style.top = e.clientY + "px";
    ctxMenu.classList.add("show");
  });
}

document.addEventListener("click", () => {
  ctxMenu.classList.remove("show");
});

ctxMenu.addEventListener("click", (e: Event) => {
  const target = e.target as HTMLElement;
  const action = target.dataset.action;
  if (!action || ctxTargetId < 0) return;
  ctxMenu.classList.remove("show");
  switch (action) {
    case "copy": {
      const sel = cells[ctxTargetId]?.terminal.getSelection();
      if (sel) {
        const tid = ctxTargetId;
        navigator.clipboard.writeText(sel).then(() => {
          cells[tid]?.terminal.focus();
        }).catch(() => {});
      }
      break;
    }
    case "copyPlain": {
      const cell = cells[ctxTargetId];
      if (!cell || !ctxSelectionPosition) break;
      const buf = cell.terminal.buffer.active;
      const startY = ctxSelectionPosition.start.y - 1;
      const endY = ctxSelectionPosition.end.y - 1;
      const lines: string[] = [];
      let current = "";
      for (let y = startY; y <= endY; y++) {
        const line = buf.getLine(y);
        if (!line) continue;
        const text = line.translateToString(true);
        if (line.isWrapped) {
          current += text;
        } else {
          if (current) lines.push(current);
          current = text;
        }
      }
      if (current) lines.push(current);
      const plain = lines.join("\n");
      if (plain) {
        navigator.clipboard.writeText(plain).catch(() => {
          vscode.postMessage({ type: "clipboardWrite", text: plain });
        });
      }
      break;
    }
    case "paste": {
      requestPasteToCell(ctxTargetId);
    }
      break;
    case "clear":
      vscode.postMessage({ type: "clearTerminal", id: ctxTargetId });
      break;
    case "restart":
      vscode.postMessage({ type: "restartTerminal", id: ctxTargetId });
      break;
    case "kill":
      vscode.postMessage({ type: "killTerminal", id: ctxTargetId });
      break;
    case "rename":
      vscode.postMessage({ type: "renameCell", id: ctxTargetId });
      break;
  }
});

// ── Per-cell overrides ──
const cellOverrides: Record<number, { bgColor: string; fgColor: string; fontFamily: string; themeName: string; themeColors: Record<string, string> | null }> = {};

// Apply initial background override if set
applyBgOverride();

// ── Initial fit + notify extension ──
// Send ready immediately with default dims to start PTY spawning ASAP
vscode.postMessage({
  type: "ready",
  defaultCols: 80,
  defaultRows: 24,
  cellDims: Array.from({ length: total }, () => ({ cols: 80, rows: 24 })),
});

// Fit asynchronously and send accurate resize corrections
requestAnimationFrame(() => {
  for (const cell of cells) {
    if (!cell) continue;
    cell.fitAddon.fit();
  }
  // Re-fit after layout is fully settled, then send per-cell resize
  setTimeout(() => {
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i]) continue;
      cells[i]!.fitAddon.fit();
      vscode.postMessage({
        type: "resize",
        id: i,
        cols: cells[i]!.terminal.cols,
        rows: cells[i]!.terminal.rows,
      });
    }
  }, 100);
});

function buildCellTheme(cellId: number): ITheme {
  const ov = cellOverrides[cellId];
  if (!ov) return buildTheme();
  // If cell has its own theme, use that as base; otherwise use global theme
  const base = ov.themeColors !== undefined && ov.themeColors !== null
    ? buildThemeFromColors(ov.themeColors)
    : (ov.themeName === "" ? buildThemeFromColors(null) : buildTheme());
  // Apply per-cell bg/fg overrides on top
  if (ov.bgColor) {
    base.background = ov.bgColor;
    base.cursorAccent = ov.bgColor;
  }
  if (ov.fgColor) {
    base.foreground = ov.fgColor;
    base.cursor = ov.fgColor;
  }
  return base;
}

function applyCellBgOverride(cell: Cell, bg: string): void {
  if (!bg) {
    // Revert to global
    const globalBg = bgColorOverride;
    if (globalBg) {
      cell.el.style.background = globalBg;
      cell.el.querySelectorAll<HTMLElement>(".term-container, .xterm, .xterm-viewport, .xterm-screen").forEach(el => {
        el.style.backgroundColor = globalBg;
      });
    } else {
      cell.el.style.background = "";
      cell.el.querySelectorAll<HTMLElement>(".term-container, .xterm, .xterm-viewport, .xterm-screen").forEach(el => {
        el.style.backgroundColor = "";
      });
    }
    return;
  }
  cell.el.style.background = bg;
  cell.el.querySelectorAll<HTMLElement>(".term-container, .xterm, .xterm-viewport, .xterm-screen").forEach(el => {
    el.style.backgroundColor = bg;
  });
}

// ── Messages from extension ──
window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "output":
      if (typeof msg.data === "string") {
        const cell = cells[msg.id];
        if (cell) {
          cell.terminal.write(transformMarkdownLinksToOsc8(msg.data));
        }
      }
      break;
    case "clear":
      cells[msg.id]?.terminal.clear();
      break;
    case "reset":
      cells[msg.id]?.terminal.reset();
      break;
    case "setLabels": {
      const labels: string[] = msg.labels || [];
      for (let i = 0; i < cells.length; i++) {
        if (!cells[i]) continue;
        cells[i]!.labelEl.textContent = labels[i] || `${i + 1}`;
      }
      break;
    }
    case "configUpdate":
      globalZoom = msg.zoom;
      fontFamilyOverride = msg.fontFamily;
      bgColorOverride = msg.bgColor || "";
      fgColorOverride = msg.fgColor || "";
      if (msg.themeName !== undefined) globalThemeName = msg.themeName;
      if (msg.themeColors !== undefined) globalThemeColors = msg.themeColors;
      {
        for (let ci = 0; ci < cells.length; ci++) {
          if (!cells[ci]) continue;
          const ov = cellOverrides[ci];
          if (ov && (ov.bgColor || ov.fgColor || ov.fontFamily || ov.themeName)) {
            cells[ci]!.terminal.options.theme = buildCellTheme(ci);
            cells[ci]!.terminal.options.fontFamily = ov.fontFamily || getTermFontFamily();
          } else {
            cells[ci]!.terminal.options.theme = buildTheme();
            cells[ci]!.terminal.options.fontFamily = getTermFontFamily();
          }
          applyZoom(cells[ci]!);
        }
        // Apply bg: per-cell overrides take priority
        applyBgOverride();
        for (let ci = 0; ci < cells.length; ci++) {
          if (!cells[ci]) continue;
          const ov = cellOverrides[ci];
          if (ov?.bgColor || ov?.themeColors?.background) {
            applyCellBgOverride(cells[ci]!, ov.bgColor || ov.themeColors?.background || "");
          }
        }
      }
      break;
    case "loadFont": {
      const style = document.createElement("style");
      style.textContent = `@font-face { font-family: '${msg.name}'; src: url(data:font/${msg.format};base64,${msg.data}) format('${msg.format}'); font-display: swap; }`;
      document.head.appendChild(style);
      // Re-apply if this font is currently selected
      if (fontFamilyOverride === msg.name) {
        for (const cell of cells) {
          if (!cell) continue;
          cell.terminal.options.fontFamily = getTermFontFamily();
          cell.fitAddon.fit();
        }
      }
      break;
    }
    case "pasteFocused":
      requestPasteToCell(msg.id);
      break;
    case "clipboardReadResult":
      if (typeof msg.id === "number" && typeof msg.text === "string") {
        pasteTextToCell(msg.id, msg.text);
      }
      break;
    case "cellConfig": {
      const cell = cells[msg.id];
      if (!cell) break;
      cellOverrides[msg.id] = {
        bgColor: msg.bgColor || "",
        fgColor: msg.fgColor || "",
        fontFamily: msg.fontFamily || "",
        themeName: msg.themeName ?? "",
        themeColors: msg.themeColors ?? null,
      };
      cell.terminal.options.theme = buildCellTheme(msg.id);
      cell.terminal.options.fontFamily = msg.fontFamily || getTermFontFamily();
      cell.fitAddon.fit();
      applyCellBgOverride(cell, msg.bgColor || cellOverrides[msg.id]?.themeColors?.background || "");
      break;
    }
    case "clearCellOverrides": {
      // Reset all cells to global theme
      for (const key of Object.keys(cellOverrides)) {
        delete cellOverrides[parseInt(key)];
      }
      const globalTheme = buildTheme();
      const globalFf = getTermFontFamily();
      for (const cell of cells) {
        if (!cell) continue;
        cell.terminal.options.theme = globalTheme;
        cell.terminal.options.fontFamily = globalFf;
        cell.fitAddon.fit();
      }
      applyBgOverride();
      break;
    }
  }
});

// ── Grid border drag-resize (Excel-like) ──
const colFr: number[] = Array(cols).fill(1);
const rowFr: number[] = Array(rows).fill(1);
const MIN_FR = 0.15;

function applyGridFractions(): void {
  grid.style.gridTemplateColumns = colFr.map(f => f + "fr").join(" ");
  grid.style.gridTemplateRows = rowFr.map(f => f + "fr").join(" ");
}

function createResizers(): void {
  grid.querySelectorAll(".grid-resizer").forEach(el => el.remove());
  // Column resizers (between each pair of adjacent columns)
  for (let c = 0; c < cols - 1; c++) {
    const handle = document.createElement("div");
    handle.className = "grid-resizer col-resizer";
    handle.dataset.col = String(c);
    grid.appendChild(handle);
    handle.addEventListener("pointerdown", (e) => startDrag(e, "col", c, handle));
    handle.addEventListener("dblclick", () => {
      colFr[c] = 1; colFr[c + 1] = 1;
      applyGridFractions(); positionResizers(); triggerFitAll();
    });
  }
  // Row resizers
  for (let r = 0; r < rows - 1; r++) {
    const handle = document.createElement("div");
    handle.className = "grid-resizer row-resizer";
    handle.dataset.row = String(r);
    grid.appendChild(handle);
    handle.addEventListener("pointerdown", (e) => startDrag(e, "row", r, handle));
    handle.addEventListener("dblclick", () => {
      rowFr[r] = 1; rowFr[r + 1] = 1;
      applyGridFractions(); positionResizers(); triggerFitAll();
    });
  }
  positionResizers();
}

function findCellInCol(c: number): Cell | null {
  for (let r = 0; r < rows; r++) {
    const cell = cells[r * cols + c];
    if (cell) return cell;
  }
  return null;
}
function findCellInRow(r: number): Cell | null {
  for (let c = 0; c < cols; c++) {
    const cell = cells[r * cols + c];
    if (cell) return cell;
  }
  return null;
}

function positionResizers(): void {
  if (cells.length === 0) return;
  // Column resizers: place at the right edge of column c
  grid.querySelectorAll<HTMLElement>(".col-resizer").forEach(el => {
    const c = parseInt(el.dataset.col!, 10);
    const cell = cells[c] || findCellInCol(c);
    if (!cell) { el.style.display = "none"; return; }
    el.style.display = "";
    const gridRect = grid.getBoundingClientRect();
    const cellRect = cell.el.getBoundingClientRect();
    el.style.left = (cellRect.right - gridRect.left - 3) + "px";
    el.style.top = "0";
    el.style.height = "100%";
  });
  // Row resizers: place at the bottom edge of row r
  grid.querySelectorAll<HTMLElement>(".row-resizer").forEach(el => {
    const r = parseInt(el.dataset.row!, 10);
    const cell = cells[r * cols] || findCellInRow(r);
    if (!cell) { el.style.display = "none"; return; }
    el.style.display = "";
    const gridRect = grid.getBoundingClientRect();
    const cellRect = cell.el.getBoundingClientRect();
    el.style.top = (cellRect.bottom - gridRect.top - 3) + "px";
    el.style.left = "0";
    el.style.width = "100%";
  });
}

function triggerFitAll(): void {
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!cell) continue;
    const prevCols = cell.terminal.cols;
    const prevRows = cell.terminal.rows;
    cell.fitAddon.fit();
    if (cell.terminal.cols !== prevCols || cell.terminal.rows !== prevRows) {
      vscode.postMessage({ type: "resize", id: i, cols: cell.terminal.cols, rows: cell.terminal.rows });
    }
  }
}

function startDrag(e: PointerEvent, axis: "col" | "row", index: number, handle: HTMLElement): void {
  e.preventDefault();
  e.stopPropagation();
  const startPos = axis === "col" ? e.clientX : e.clientY;
  const frArr = axis === "col" ? colFr : rowFr;
  const totalPx = axis === "col" ? grid.clientWidth : grid.clientHeight;
  const sumFr = frArr.reduce((a, b) => a + b, 0);
  const startFrA = frArr[index];
  const startFrB = frArr[index + 1];
  handle.classList.add("active");
  document.body.classList.add(axis === "col" ? "resizing-col" : "resizing-row");

  let fitTimer: ReturnType<typeof setTimeout>;

  function onMove(ev: PointerEvent): void {
    const delta = (axis === "col" ? ev.clientX : ev.clientY) - startPos;
    const deltaFr = (delta / totalPx) * sumFr;
    let newA = startFrA + deltaFr;
    let newB = startFrB - deltaFr;
    // Clamp
    if (newA < MIN_FR) { newB += newA - MIN_FR; newA = MIN_FR; }
    if (newB < MIN_FR) { newA += newB - MIN_FR; newB = MIN_FR; }
    frArr[index] = newA;
    frArr[index + 1] = newB;
    applyGridFractions();
    positionResizers();
    // Debounced fit
    clearTimeout(fitTimer);
    fitTimer = setTimeout(triggerFitAll, 80);
  }

  function onUp(): void {
    handle.classList.remove("active");
    document.body.classList.remove("resizing-col", "resizing-row");
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    triggerFitAll();
  }

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}

// Create resizers after cells are built
if (cols > 1 || rows > 1) {
  createResizers();
}

// ── Resize ──
let resizeTimer: ReturnType<typeof setTimeout>;
const ro = new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (!cell) continue;
      const prevCols = cell.terminal.cols;
      const prevRows = cell.terminal.rows;
      cell.fitAddon.fit();
      if (cell.terminal.cols !== prevCols || cell.terminal.rows !== prevRows) {
        vscode.postMessage({
          type: "resize",
          id: i,
          cols: cell.terminal.cols,
          rows: cell.terminal.rows,
        });
      }
    }
    positionResizers();
  }, 150);
});
ro.observe(grid);

// ── Watch for theme changes ──
const themeObserver = new MutationObserver(() => {
  for (let ci = 0; ci < cells.length; ci++) {
    if (!cells[ci]) continue;
    const ov = cellOverrides[ci];
    if (ov && (ov.bgColor || ov.fgColor || ov.fontFamily || ov.themeName)) {
      cells[ci]!.terminal.options.theme = buildCellTheme(ci);
      cells[ci]!.terminal.options.fontFamily = ov.fontFamily || getTermFontFamily();
    } else {
      cells[ci]!.terminal.options.theme = buildTheme();
      cells[ci]!.terminal.options.fontFamily = getTermFontFamily();
    }
    cells[ci]!.terminal.options.fontSize = calcFontSize(cells[ci]!.zoom);
    cells[ci]!.fitAddon.fit();
  }
});
themeObserver.observe(document.body, {
  attributes: true,
  attributeFilter: ["class", "data-vscode-theme-kind"],
});

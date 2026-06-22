/**
 * i18n anti-regression scan for raw Chinese strings that are not routed through
 * an explicit localization boundary.
 *
 * Run: node --experimental-strip-types --test src/i18n/no-raw-chinese.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 *
 * Exclusions:
 *   - comments
 *   - t() / translate() dictionary calls
 *   - regex literals
 *   - string comparison contexts
 *   - import / type / interface declarations
 *
 * Any violation fails this test.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

// ── Constants ──────────────────────────────────────────────────────────

const CHINESE_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3001-\u303F\uFF1A\uFF1B]/;

/** Directories to scan (relative to project root RPG-Agent-MV/). */
const SCAN_DIRS = [
  'src/ui/desktop/src',
  'src/ui/desktop/electron',
  'src/backend/src',
  'src/contract',
] as const;

/**
 * Files that intentionally store Chinese source text at a stable localization
 * boundary. Keep this explicit so a new `*Localization.ts` file must opt in.
 */
const ALLOWED_CHINESE_SOURCE_FILES = new Set([
  'src/ui/desktop/src/config/known-issues-i18n.ts',
  'src/ui/desktop/src/utils/agentIntent.ts',
  'src/ui/desktop/src/utils/pluginDiagnosticsI18n.ts',
  'src/ui/desktop/electron/electronLocalization.ts',
  'src/ui/desktop/src/i18n/locales/en-US.ts',
  'src/ui/desktop/src/i18n/locales/zh-CN.ts',
  'src/ui/desktop/src/i18n/messages.ts',
  'src/backend/src/core/i18n/messages.ts',
  'src/backend/src/core/i18n/locales/en-US.ts',
  'src/backend/src/core/i18n/locales/zh-CN.ts',
  'src/backend/src/core/rmmv/event-page-compiler.ts',
]);

/** Additional directory-based localization boundaries that must stay Chinese-allowed. */
const ALLOWED_CHINESE_SOURCE_DIR_PATTERNS: Array<{ pattern: RegExp }> = [
  { pattern: /^src\/backend\/src\/core\/.+Localization\.ts$/i },
  { pattern: /^src\/ui\/desktop\/src\/.+Localization\.ts$/i },
];

function isAllowedChineseSource(relPath: string): boolean {
  if (ALLOWED_CHINESE_SOURCE_FILES.has(relPath)) return true;
  return ALLOWED_CHINESE_SOURCE_DIR_PATTERNS.some(({ pattern }) => pattern.test(relPath));
}

/** Path-segment exclusion. */
const EXCLUDED_SEGMENTS = ['.test.ts', '.test.js', '.d.ts', '/node_modules/', '\\node_modules\\'];

// ── File discovery ─────────────────────────────────────────────────────

function projectRoot(): string {
  // Script lives at src/ui/desktop/src/i18n/ → project root is ../../../../../
  // i18n → src → desktop → ui → src → RPG-Agent-MV
  return path.resolve(import.meta.dirname, '..', '..', '..', '..', '..');
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.opencode') continue;
      out.push(...collectFiles(full));
    } else if (/\.(ts|vue)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function shouldSkip(absPath: string, root: string): boolean {
  const relPath = path.relative(root, absPath).replace(/\\/g, '/');
  if (isAllowedChineseSource(relPath)) return true;
  if (EXCLUDED_SEGMENTS.some((seg) => absPath.includes(seg))) return true;
  return false;
}

// ── Line analysis ──────────────────────────────────────────────────────

interface Violation {
  relPath: string;
  line: number;
  text: string;
}

/** Strip single-line // comments. Returns the code-only portion. */
function stripLineComment(line: string): string {
  let inStr: string | null = null;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (inStr) { if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

/**
 * Strip single-line block comments (`/* … *​/` fully opened and closed on one line).
 * One-line JSDoc such as `/** 中文说明 *​/` would otherwise leak its Chinese as a
 * false-positive violation, because stripLineComment only handles `//` and the
 * multi-line block tracker only fires when the `*​/` is on a *later* line.
 */
function stripInlineBlockComments(line: string): string {
  return line.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Check whether a line (code portion) is inside a locale-keyed text call.
 * Handles multi-line calls via parenthesis depth tracking.
 * Returns true if the Chinese on this line is within such a call's arguments.
 */
function isInsideBilingualCall(code: string): boolean {
  // Direct call on this line
  // translate() or t() with message key
  if (/\btranslate\s*\(\s*['"]/.test(code)) return true;
  if (/\bt\s*\(\s*['"][\w.]/.test(code)) return true;
  // pickByLocale() with language and Record<ProductLanguage, ...> dictionary
  if (/\bpickByLocale\s*\(/.test(code)) return true;
  return false;
}

function updateBilingualDepth(code: string, currentDepth: number): number {
  if (currentDepth <= 0 && !isInsideBilingualCall(code)) return 0;
  let depth = currentDepth;
  let started = currentDepth > 0;
  for (const ch of code) {
    if (ch === '(') {
      if (!started) {
        started = true;
        depth = 1;
      } else {
        depth++;
      }
    } else if (ch === ')' && started) {
      depth--;
    }
  }
  return Math.max(0, depth);
}

/** Check if Chinese appears only inside a regex literal. */
function chineseOnlyInRegex(code: string): boolean {
  // Pattern: /...Chinese.../flags
  // `(?:\\.|[^/\n])` so escaped slashes (\/) inside the regex body don't prematurely
  // terminate the literal \u2014 otherwise Chinese after an escaped slash leaks out as a
  // false-positive violation (e.g. /\u6765\u81ea projects\/ \u76ee\u5f55/).
  const regexLiterals = code.match(/\/(?:\\.|[^/\n])*[\u4e00-\u9fff](?:\\.|[^/\n])*\/[gimsuy]*/g);
  if (!regexLiterals) return false;
  // Remove regex literals and check if any Chinese remains
  let stripped = code;
  for (const r of regexLiterals) stripped = stripped.replace(r, '');
  return !CHINESE_RE.test(stripped);
}

/** Check if Chinese appears only in string comparison contexts. */
function chineseOnlyInComparison(code: string): boolean {
  // .test(/Chinese/)
  if (/\.test\s*\(\s*\/[^)]*[\u4e00-\u9fff]/.test(code)) {
    let stripped = code.replace(/\/[^)]*[\u4e00-\u9fff][^)]*\//g, '');
    stripped = stripped.replace(/['"][^'"]*[\u4e00-\u9fff][^'"]*['"]/g, '');
    if (!CHINESE_RE.test(stripped)) return true;
  }
  // .includes('Chinese') / .startsWith / .endsWith
  if (/\.(?:includes|startsWith|endsWith|indexOf)\s*\(\s*['"][^'"]*[\u4e00-\u9fff]/.test(code)) {
    let stripped = code.replace(/['"][^'"]*[\u4e00-\u9fff][^'"]*['"]/g, '');
    if (!CHINESE_RE.test(stripped)) return true;
  }
  // === or !== with Chinese string literal (right-hand side only)
  if (/[!=]==?\s*['"][^'"]*[\u4e00-\u9fff][^'"]*['"]/.test(code)) {
    let stripped = code.replace(/['"][^'"]*[\u4e00-\u9fff][^'"]*['"]/g, '');
    if (!CHINESE_RE.test(stripped)) return true;
  }
  // label === 'Chinese' (left-hand side is a variable, right is Chinese)
  if (/\w+\s*===?\s*['`][^'`"]*[\u4e00-\u9fff]/.test(code)) {
    let stripped = code.replace(/['`][^'`"]*[\u4e00-\u9fff][^'`"]*['`]/g, '');
    if (!CHINESE_RE.test(stripped)) return true;
  }
  return false;
}

/** Check if line is an import / type / interface declaration. */
function isDeclarationLine(code: string): boolean {
  const trimmed = code.trimStart();
  if (trimmed.startsWith('import ')) return true;
  if (trimmed.startsWith('type ')) return true;
  if (trimmed.startsWith('interface ')) return true;
  if (trimmed.startsWith('export type ') || trimmed.startsWith('export interface ')) return true;
  return false;
}

// ── Main scanner ───────────────────────────────────────────────────────

function scanAll(): Violation[] {
  const violations: Violation[] = [];
  const root = projectRoot();

  for (const scanDir of SCAN_DIRS) {
    const absDir = path.join(root, scanDir);
    if (!fs.existsSync(absDir)) continue;
    const files = collectFiles(absDir);

    for (const file of files) {
      if (shouldSkip(file, root)) continue;

      const relPath = path.relative(root, file).replace(/\\/g, '/');
      const lines = fs.readFileSync(file, 'utf-8').split('\n');
      let inBlockComment = false;
      let inVueTemplate = false;
      let inVueStyle = false;

      // Track multi-line bilingual call parenthesis depth
      let bilingualDepth = 0;

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();
        const lineNum = i + 1;

        // Vue SFC section tracking
        if (file.endsWith('.vue')) {
          if (/<template[\s>]/.test(trimmed)) inVueTemplate = true;
          if (/<\/template\s*>/.test(trimmed)) { inVueTemplate = false; continue; }
          if (/<style[\s>]/.test(trimmed)) inVueStyle = true;
          if (/<\/style\s*>/.test(trimmed)) { inVueStyle = false; continue; }
          if (inVueStyle) continue;
        }

        // Lines without Chinese: nothing to flag, but still track block-comment
        // open/close. A multi-line JSDoc block whose opener is just `/**` (no
        // Chinese) would otherwise never set inBlockComment — it gets skipped
        // here before the block-start detection below — leaking its Chinese body
        // lines as false positives.
        if (!CHINESE_RE.test(raw)) {
          if (inBlockComment) {
            if (raw.includes('*/')) inBlockComment = false;
          } else {
            const c = stripInlineBlockComments(stripLineComment(raw));
            bilingualDepth = updateBilingualDepth(c, bilingualDepth);
            if (c.includes('/*') && !c.includes('*/')) inBlockComment = true;
          }
          continue;
        }

        // Block comment tracking
        if (inBlockComment) {
          if (trimmed.includes('*/')) {
            inBlockComment = false;
            const after = raw.slice(raw.indexOf('*/') + 2);
            if (!CHINESE_RE.test(after)) continue;
          } else {
            continue;
          }
        }

        // Strip single-line comments, then single-line block comments (before checking for block start)
        const code = stripInlineBlockComments(stripLineComment(raw));

        // Check for block comment start on this line
        if (code.includes('/*') && !code.includes('*/')) {
          inBlockComment = true;
          const beforeComment = code.slice(0, code.indexOf('/*'));
          if (!CHINESE_RE.test(beforeComment)) continue;
        }

        if (!CHINESE_RE.test(code)) continue;

        // ── Exclusion checks ──

        // 1. Declaration lines (import/type/interface)
        if (isDeclarationLine(code)) continue;

        // 2. Multi-line bilingual call continuation
        if (bilingualDepth > 0) {
          bilingualDepth = updateBilingualDepth(code, bilingualDepth);
          continue;
        }

        // 3. Bilingual/translate function calls
        if (isInsideBilingualCall(code)) {
          bilingualDepth = updateBilingualDepth(code, bilingualDepth);
          continue;
        }

        // 4. Regex literals
        if (chineseOnlyInRegex(code)) continue;

        // 5. String comparisons
        if (chineseOnlyInComparison(code)) continue;

        // 6. Vue template: Chinese inside {{ ... }} expressions or literals
        if (inVueTemplate) {
          // Strip all {{ ... }} expressions and check if Chinese remains in template text
          const withoutExpressions = code.replace(/\{\{[^}]*\}\}/g, '');
          if (!CHINESE_RE.test(withoutExpressions)) continue;
        }

        // ── Record violation ──
        violations.push({
          relPath,
          line: lineNum,
          text: trimmed.slice(0, 80),
        });
      }
    }
  }

  return violations;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('i18n anti-degradation', () => {
  it('no raw Chinese strings outside i18n modules', () => {
    const violations = scanAll();

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.relPath}:${v.line}  ${v.text}`)
        .join('\n');
      assert.fail(`Found ${violations.length} raw Chinese string(s):\n${report}`);
    }
  });
});

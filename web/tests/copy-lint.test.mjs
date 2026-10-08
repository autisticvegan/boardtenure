// Copy guardrails (docs/design/rankings-ui.md §9): the stock is the subject of every return verb,
// no founder/weekly/independent-scope wording, no sports or investment framing of people, and no
// literal counts in copy. Scans src/**/*.{ts,tsx} except src/app/admin/**, plus the prose of
// docs/methodology.md, which /methodology renders as page copy.
//
// Only user-facing text is checked: string literals, template-literal text and JSX text. Comments,
// identifiers, type-level literals, import paths, directives, className values and sql`` templates
// are skipped. JSX text is flattened per element across inline children (<strong>, <Link>, …) with
// "{}" standing in for expressions, so a sentence split by markup or {values} is read whole.
// Uses the project's own `typescript` devDependency as the parser (no new dependency).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const METHODOLOGY = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "methodology.md");

// Spelled-out counts are as hard-coded as digits ("Seven people" was a judge call-out, §0 #16).
const COUNT = String.raw`(?:\d[\d,]*|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)`;

// §9 forbidden-pattern table. The count rule drops the table's leading `>\s*[^<{]*` (it only
// approximated "inside JSX text" on raw source) and allows one adjective ("137 ranked directors").
export const RULES = [
  [/\b(best|worst|top|bottom)[- ](performing[- ])?directors?\b/i, 'use "best/worst seats by stock vs the S&P" or "top/bottom of the table"'],
  [/\b(drove|drives|delivered|generated|created|added|destroyed|produced)\b.{0,40}\b(returns?|value|gains?|growth)\b/i, "the stock is the subject"],
  [/\bon (his|her|their|[A-Z]\w+'s) watch\b/i, "causation"],
  [/\b(MVP|clutch|golden touch|midas|value destroyer|tanked|sank|relegat\w*|carried the board|perfect record)\b/i, "causation and shaming"],
  [/\b(players?|win[- ]loss|W[–-]L|head[- ]to[- ]head|tale of the tape)\b/i, "sports framing of people"],
  [/\b(follow|copy|avoid|bet on|pick) (these|this|the) (directors?|boards?)\b/i, "investment framing"],
  [/\bfounders?\b/i, 'no founder data: use "Exec seat" or "From IPO"'],
  [/\bweekly\b/i, "prices are daily closes"],
  [/\bmoved (up|down)\b|\brank change\b/i, "no rank deltas"],
  [/\bindependent (seats|directors|league|only)\b/i, 'the scope label is "Non-exec seats"'],
  [/\bskills?\b(?! rating)/i, 'only "not a skill rating" is allowed'],
  [new RegExp(String.raw`\b${COUNT} (?:[a-z]+ )?(people|companies|directors|seats|boards)\b`, "i"), "counts in copy must be computed ({n})"],
];

// Lowercase tags that sit inside a sentence; any other lowercase tag breaks the text into lines.
const INLINE_TAGS = new Set(["a", "abbr", "b", "bdi", "cite", "code", "data", "dfn", "em", "i", "kbd", "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var"]);
// Components whose children render inline, so their text joins the surrounding sentence.
const INLINE_COMPONENTS = new Set(["Link"]);
const SKIP_ATTRS = new Set(["className", "key", "id", "role", "type", "rel", "target", "src", "viewBox", "d", "fill", "stroke"]);

const squash = (s) => s.replace(/\s+/g, " ");
const isSqlTag = (tag) => /^sql\b/.test(tag.getText());

function tagName(el) {
  const opening = ts.isJsxElement(el) ? el.openingElement : el;
  return opening.tagName.getText();
}

/** Text of a JSX element's children, inline children merged, expressions as "{}". */
function jsxText(children) {
  let out = "";
  for (const c of children) {
    if (ts.isJsxText(c)) out += c.containsOnlyTriviaWhiteSpaces ? " " : c.text;
    else if (ts.isJsxExpression(c)) {
      const e = c.expression;
      if (!e) continue; // {/* comment */}
      out += ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : "{}";
    } else if (ts.isJsxFragment(c)) out += jsxText(c.children);
    else if (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)) {
      const name = tagName(c);
      const inline = INLINE_TAGS.has(name) || INLINE_COMPONENTS.has(name);
      if (inline && ts.isJsxElement(c)) out += jsxText(c.children);
      else if (/^[a-z]/.test(name)) out += "\n"; // block element or <br/>: a sentence boundary
      else out += "{}"; // a component renders a value we can't see
    }
  }
  return squash(out.replace(/\n/g, "\u0000")).replace(/\u0000/g, "\n");
}

/** Every user-facing text segment in a TS/TSX source: { text, line }. */
export function copySegments(fileName, source) {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const segs = [];
  const add = (node, text) => {
    if (text.trim()) segs.push({ text, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isImportTypeNode(node) || ts.isExternalModuleReference(node)) return;
    if (ts.isLiteralTypeNode(node)) return; // "independent" | "all" etc.
    if (ts.isTaggedTemplateExpression(node) && isSqlTag(node.tag)) return;
    if (ts.isCallExpression(node) && /^sql\.unsafe$/.test(node.expression.getText(sf))) return;
    if (ts.isJsxAttribute(node) && SKIP_ATTRS.has(node.name.getText(sf))) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const p = node.parent;
      const isDirective = ts.isExpressionStatement(p);
      const isKey = (ts.isPropertyAssignment(p) && p.name === node) || ts.isElementAccessExpression(p) || ts.isPropertySignature(p);
      if (!isDirective && !isKey) add(node, squash(node.text));
      return;
    }
    if (ts.isTemplateExpression(node)) {
      add(node, squash(node.head.text + node.templateSpans.map((s) => "{}" + s.literal.text).join("")));
      node.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) add(node, jsxText(node.children));
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return segs;
}

/** Rule hits in one source, one per (rule, matched text); innermost element wins the line. */
export function lint(fileName, source) {
  const hits = new Map();
  for (const { text, line } of copySegments(fileName, source)) {
    for (const [re, why] of RULES) {
      const m = text.match(re);
      if (!m) continue;
      const key = `${re.source}|${m[0].toLowerCase()}`;
      const prev = hits.get(key);
      if (!prev || line > prev.line) hits.set(key, { line, match: m[0], why });
    }
  }
  return [...hits.values()].sort((a, b) => a.line - b.line);
}

const COUNT_RULE = RULES.at(-1)[0];

/**
 * Prose paragraphs of a Markdown doc: fenced code and inline `code` (formulas, identifiers) are
 * dropped and each paragraph or table row is read as one line of text.
 */
export function proseSegments(md) {
  const segs = [];
  let inFence = false;
  let buf = [];
  let start = 0;
  const flush = () => {
    const text = squash(buf.join(" ").replace(/`[^`]*`/g, "{}")).trim();
    if (text) segs.push({ text, line: start });
    buf = [];
  };
  md.split("\n").forEach((raw, i) => {
    if (/^\s*```/.test(raw)) { flush(); inFence = !inFence; return; }
    if (inFence) return;
    if (!raw.trim() || /^\s*[|#*-]/.test(raw)) flush(); // blank line, table row, heading or list item starts anew
    if (!raw.trim()) return;
    if (buf.length === 0) start = i + 1;
    buf.push(raw);
  });
  flush();
  return segs;
}

/** Rule hits in a Markdown doc. The literal-count rule is for UI copy built from data, not examples. */
export function lintProse(md) {
  const hits = [];
  for (const { text, line } of proseSegments(md)) {
    for (const [re, why] of RULES) {
      if (re === COUNT_RULE) continue;
      const m = text.match(re);
      if (m) hits.push({ line, match: m[0], why });
    }
  }
  return hits;
}

function sourceFiles() {
  return readdirSync(SRC, { recursive: true })
    .map(String)
    .map((f) => f.split(path.sep).join("/"))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("app/admin/"));
}

test("UI copy follows the §9 guardrails", () => {
  const files = sourceFiles();
  assert.ok(files.length > 20, `expected to scan the app source, found ${files.length} files`);
  const hits = files.flatMap((rel) =>
    lint(rel, readFileSync(path.join(SRC, rel), "utf8")).map((h) => `src/${rel}:${h.line}: "${h.match}" (${h.why})`),
  );
  assert.deepEqual(hits, [], `Banned copy:\n${hits.join("\n")}`);
});

test("docs/methodology.md prose follows the §9 guardrails", () => {
  const hits = lintProse(readFileSync(METHODOLOGY, "utf8")).map((h) => `docs/methodology.md:${h.line}: "${h.match}" (${h.why})`);
  assert.deepEqual(hits, [], `Banned copy:\n${hits.join("\n")}`);
});

test("the linter reads copy, not code", () => {
  const ok = [
    `// Prices used to refresh weekly; founder data is absent.\nconst weeklyJob = 1;`,
    `/** independent seats only, internally */ type S = "independent" | "all";`,
    `import x from "./founders";`,
    `"use client";`,
    `const q = sql\`-- weekly founder rollup\nSELECT independent_scored_seats\`;`,
    `const a = <h2 className="independent seats">The rest of the top 10</h2>;`,
    `const b = <p>{n} ranked directors · {label}</p>;`,
    `const c = \`\${n} people sit on \${k} tracked boards\`;`,
    `const d = <p>{NOT_A_SKILL_RATING} A stat line about the stock, not a skill rating.</p>;`,
    `const e = <p>On 2+ tracked boards</p>;`,
    `const f = <span>Needs 2 scored years</span>;`,
  ];
  for (const src of ok) assert.deepEqual(lint("ok.tsx", src), [], src);

  const bad = [
    [`const a = <p>Prices refresh weekly.</p>;`, "weekly"],
    [`const a = <p title="Co-Founder">x</p>;`, "Founder"],
    [`const a = <p>While <strong>{name}</strong> sat here, she delivered <Signed v={x} /> returns</p>;`, "delivered {} returns"],
    [`const a = \`\${name} generated \${pct} growth\`;`, "generated {} growth"],
    [`const a = <h2>13 companies tracked</h2>;`, "13 companies"],
    [`const a = <p>Seven people sit on two boards</p>;`, "Seven people"],
    [`const a = <p>Showing {n} of 137 ranked directors</p>;`, "137 ranked directors"],
    [`const a = { label: "Independent only" };`, "Independent only"],
    [`const a = <p>A <Link href="/x">top director</Link> pick</p>;`, "top director"],
    [`const a = <p>Director skill</p>;`, "skill"],
    [`const a = <p>Board skills</p>;`, "skills"],
  ];
  for (const [src, match] of bad) {
    const hits = lint("bad.tsx", src);
    assert.ok(hits.some((h) => h.match === match), `${src}\nexpected "${match}", got ${JSON.stringify(hits)}`);
  }

  const md = "Intro.\n\n```\nfounder weekly\n```\n\n| a | `x produced returns` |\n\nRankings order stock moves, not director\nskill.\n";
  assert.deepEqual(lintProse(md).map((h) => h.match), ["skill"], "prose lint skips code, joins wrapped lines");
});

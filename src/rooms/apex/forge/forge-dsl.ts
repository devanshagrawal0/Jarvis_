/* THE FORGE — DSL engine. Parses expressions like `RSI(SPX,14) < 30 AND VIX < 20`
   into an AST, validates against a whitelist, and evaluates by WALKING the AST
   (never eval/Function). Powers Variables, Signals, and bot conditions — one
   pipeline, safe by construction. Dependency-free (hand-written Pratt parser). */

import type { Bar } from "./forge-blocks";
import { SIGNALS } from "./forge-blocks";

export type Node =
  | { t: "num"; v: number }
  | { t: "sym"; name: string }              // bare identifier: a symbol, a variable ref, or `price`/`close`
  | { t: "call"; fn: string; args: Node[] } // indicator/function call
  | { t: "unary"; op: string; arg: Node }
  | { t: "bin"; op: string; l: Node; r: Node };

/* ── Tokenizer ── */
type Tok = { k: "num" | "id" | "op" | "punc"; v: string };
const KEYWORD_OPS: Record<string, string> = { and: "&&", or: "||", not: "!", crosses_above: "crx_up", crosses_below: "crx_dn", above: ">", below: "<" };
function tokenize(src: string): Tok[] {
  const out: Tok[] = []; let i = 0;
  const isD = (c: string) => c >= "0" && c <= "9";
  const isA = (c: string) => /[A-Za-z_]/.test(c);
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n") { i++; continue; }
    if (isD(c) || (c === "." && isD(src[i + 1]))) { let j = i + 1; while (j < src.length && (isD(src[j]) || src[j] === ".")) j++; out.push({ k: "num", v: src.slice(i, j) }); i = j; continue; }
    if (isA(c)) { let j = i + 1; while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++; const w = src.slice(i, j); const low = w.toLowerCase(); if (KEYWORD_OPS[low]) out.push({ k: "op", v: KEYWORD_OPS[low] }); else out.push({ k: "id", v: w }); i = j; continue; }
    const two = src.slice(i, i + 2);
    if (["&&", "||", ">=", "<=", "==", "!="].includes(two)) { out.push({ k: "op", v: two }); i += 2; continue; }
    if ("+-*/><!".includes(c)) { out.push({ k: "op", v: c }); i++; continue; }
    if ("(),".includes(c)) { out.push({ k: "punc", v: c }); i++; continue; }
    throw new Error(`Unexpected character '${c}'`);
  }
  return out;
}

/* ── Parser (precedence climbing) ── */
const PREC: Record<string, number> = { "||": 1, "&&": 2, ">": 3, "<": 3, ">=": 3, "<=": 3, "==": 3, "!=": 3, "crx_up": 3, "crx_dn": 3, "+": 4, "-": 4, "*": 5, "/": 5 };
export function parse(src: string): Node {
  const toks = tokenize(src); let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  function primary(): Node {
    const t = next();
    if (!t) throw new Error("Unexpected end of expression");
    if (t.k === "num") return { t: "num", v: Number(t.v) };
    if (t.k === "op" && (t.v === "!" || t.v === "-")) return { t: "unary", op: t.v, arg: primary() };
    if (t.k === "punc" && t.v === "(") { const e = expr(0); const c = next(); if (!c || c.v !== ")") throw new Error("Expected )"); return e; }
    if (t.k === "id") {
      if (peek() && peek().k === "punc" && peek().v === "(") { next(); const args: Node[] = []; if (!(peek() && peek().v === ")")) { do { args.push(expr(0)); } while (peek() && peek().v === "," && next()); } const c = next(); if (!c || c.v !== ")") throw new Error("Expected )"); return { t: "call", fn: t.v, args }; }
      return { t: "sym", name: t.v };
    }
    throw new Error(`Unexpected token '${t.v}'`);
  }
  function expr(min: number): Node {
    let left = primary();
    while (peek() && peek().k === "op" && PREC[peek().v] != null && PREC[peek().v] >= min) { const op = next().v; const right = expr(PREC[op] + 1); left = { t: "bin", op, l: left, r: right }; }
    return left;
  }
  const e = expr(0); if (p < toks.length) throw new Error(`Unexpected '${toks[p].v}'`); return e;
}

/* ── Whitelist validation ── */
const FN_WHITELIST = new Set([...Object.keys(SIGNALS), "abs", "min", "max"]);
export function validate(node: Node, knownSymbols: Set<string>, knownVars: Set<string>): string[] {
  const errs: string[] = [];
  const walk = (n: Node) => {
    if (n.t === "call") { if (!FN_WHITELIST.has(n.fn.toLowerCase()) && !FN_WHITELIST.has(n.fn)) errs.push(`Unknown function '${n.fn}'`); n.args.forEach(walk); }
    else if (n.t === "bin") { walk(n.l); walk(n.r); }
    else if (n.t === "unary") walk(n.arg);
    else if (n.t === "sym") { const s = n.name; if (!/^(price|close|open|high|low|volume)$/i.test(s) && !knownSymbols.has(s.toUpperCase()) && !knownVars.has(s)) errs.push(`Unknown symbol/variable '${s}'`); }
  };
  walk(node);
  return errs;
}

/* ── Dependency extraction ── */
export function extractDeps(node: Node): { symbols: string[]; indicators: string[]; vars: string[] } {
  const symbols = new Set<string>(), indicators = new Set<string>(), vars = new Set<string>();
  const walk = (n: Node) => {
    if (n.t === "call") { indicators.add(n.fn); n.args.forEach(a => { if (a.t === "sym") symbols.add(a.name.toUpperCase()); walk(a); }); }
    else if (n.t === "bin") { walk(n.l); walk(n.r); }
    else if (n.t === "unary") walk(n.arg);
    else if (n.t === "sym" && !/^(price|close|open|high|low|volume)$/i.test(n.name)) { if (n.name === n.name.toUpperCase()) symbols.add(n.name); else vars.add(n.name); }
  };
  walk(node);
  return { symbols: [...symbols], indicators: [...indicators], vars: [...vars] };
}

/* ── Evaluation: compile the AST to a per-index function using cached series.
   `series` maps SYMBOL → bars; `vars` maps variable-name → already-compiled series. ── */
export interface EvalCtx { primary: string; series: Record<string, Bar[]>; vars?: Record<string, number[]> }
export function compile(node: Node, ctx: EvalCtx): number[] {
  const N = (ctx.series[ctx.primary] || []).length;
  const cache = new Map<string, number[]>();
  const closesOf = (sym: string): number[] => { const b = ctx.series[sym.toUpperCase()] || ctx.series[ctx.primary] || []; return b.map(x => x.c); };

  const seriesOf = (n: Node): number[] => {
    if (n.t === "num") return new Array(N).fill(n.v);
    if (n.t === "sym") {
      const s = n.name;
      if (/^(price|close)$/i.test(s)) return closesOf(ctx.primary);
      if (/^(open|high|low|volume)$/i.test(s)) { const b = ctx.series[ctx.primary] || []; const key = s.toLowerCase()[0] as "o" | "h" | "l"; return b.map(x => s.toLowerCase() === "volume" ? x.v : (x as unknown as Record<string, number>)[key]); }
      if (ctx.vars && ctx.vars[s]) return ctx.vars[s];
      return closesOf(s); // treat as a symbol's close
    }
    if (n.t === "call") {
      const ck = JSON.stringify(n); if (cache.has(ck)) return cache.get(ck)!;
      const def = SIGNALS[n.fn.toLowerCase()] || SIGNALS[n.fn];
      let bars = ctx.series[ctx.primary] || [];
      const nums: number[] = []; const symArgs: string[] = [];
      n.args.forEach(a => { if (a.t === "num") nums.push(a.v); else if (a.t === "sym" && a.name === a.name.toUpperCase() && !/^(price|close|open|high|low)$/i.test(a.name)) symArgs.push(a.name); });
      if (symArgs[0] && ctx.series[symArgs[0]]) bars = ctx.series[symArgs[0]];
      let out: number[];
      if (def) { const p: Record<string, number> = {}; def.params.forEach((ps, i) => p[ps.key] = nums[i] ?? ps.def); out = def.compute(bars, p); }
      else if (n.fn === "abs") { const s0 = seriesOf(n.args[0]); out = s0.map(Math.abs); }
      else out = new Array(N).fill(NaN);
      cache.set(ck, out); return out;
    }
    if (n.t === "unary") { const s = seriesOf(n.arg); return s.map(v => n.op === "-" ? -v : (v ? 0 : 1)); }
    // binary
    const l = seriesOf(n.l), r = seriesOf(n.r);
    const out = new Array(N).fill(NaN);
    for (let i = 0; i < N; i++) {
      const a = l[i], b = r[i], pa = i ? l[i - 1] : NaN, pb = i ? r[i - 1] : NaN;
      let v: number;
      switch (n.op) {
        case "+": v = a + b; break; case "-": v = a - b; break; case "*": v = a * b; break; case "/": v = b ? a / b : NaN; break;
        case ">": v = a > b ? 1 : 0; break; case "<": v = a < b ? 1 : 0; break; case ">=": v = a >= b ? 1 : 0; break; case "<=": v = a <= b ? 1 : 0; break;
        case "==": v = a === b ? 1 : 0; break; case "!=": v = a !== b ? 1 : 0; break;
        case "&&": v = (a && b) ? 1 : 0; break; case "||": v = (a || b) ? 1 : 0; break;
        case "crx_up": v = (!Number.isNaN(pa) && pa <= pb && a > b) ? 1 : 0; break;
        case "crx_dn": v = (!Number.isNaN(pa) && pa >= pb && a < b) ? 1 : 0; break;
        default: v = NaN;
      }
      out[i] = v;
    }
    return out;
  };
  return seriesOf(node);
}

/* Convenience: parse + compile → boolean/number series. Throws on parse/validate error. */
export function evalDsl(src: string, ctx: EvalCtx, knownVars: Set<string> = new Set()): number[] {
  const ast = parse(src);
  const errs = validate(ast, new Set(Object.keys(ctx.series)), knownVars);
  if (errs.length) throw new Error(errs.join("; "));
  return compile(ast, ctx);
}

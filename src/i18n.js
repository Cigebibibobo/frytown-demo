// Runtime localization. Chinese stays the source of truth so the QA harness and
// the rule tests keep running against canonical copy; English is applied at the
// display boundary (data tables, DOM text and canvas labels).
import { EN } from './i18n-en.js';
import * as CONTENT from './content.js';

const CJK = /[\u3400-\u9fff]/;
const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA']);
const SKIP_KEYS = new Set([
  'id', 'type', 'cat', 'stat', 'count', 'counts', 'plots', 'plot', 'sprite',
  'spriteKey', 'color', 'accent', 'res', 'key', 'flag', 'code', 'kind', 'icon',
  'font', 'file', 'url', 'src', 'href', 'scene', 'sound', 'music', 'style',
  'variant', 'ground', 'terrain', 'value', 'amount', 'rate', 'level', 'rank',
]);

let locale = 'zh';
let started = false;
let observer = null;
const misses = new Set();

const normalize = (text) => String(text).replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const exact = new Map();
const templates = [];

for (const [src, dst] of Object.entries(EN)) {
  const key = normalize(src);
  if (/\{\d+(?::n)?\}/.test(key)) {
    const order = [];
    let pattern = '';
    let last = 0;
    for (const m of key.matchAll(/\{(\d+)(:n)?\}/g)) {
      pattern += escapeRe(key.slice(last, m.index)) + (m[2] ? '(\\d[\\d,.]*)' : '(.+?)');
      order.push(Number(m[1]));
      last = m.index + m[0].length;
    }
    pattern += escapeRe(key.slice(last));
    templates.push({
      re: new RegExp(`^${pattern}$`),
      order,
      dst,
    });
  } else if (key) {
    exact.set(key, dst);
  }
}
templates.sort((a, b) => b.re.source.length - a.re.source.length);

function pickLocale(hint) {
  if (typeof location === 'undefined') return 'en';
  const q = new URLSearchParams(location.search).get('lang');
  if (q) return /^zh/i.test(q) ? 'zh' : 'en';
  const forced = globalThis.__FRYTOWN_LANG__;
  if (forced) return /^zh/i.test(forced) ? 'zh' : 'en';
  const sys = globalThis.systemInfo?.locale;
  if (sys) return /^zh/i.test(sys) ? 'zh' : 'en';
  // Local servers default to Chinese so the QA harness and preview screenshots
  // keep their canonical copy; the portal hint only decides non-local hosts.
  const local = location.protocol === 'file:'
    || location.hostname === 'localhost'
    || location.hostname === '127.0.0.1'
    || location.hostname === '[::1]';
  if (local) return 'zh';
  if (hint) return /^zh/i.test(hint) ? 'zh' : 'en';
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
  return /^zh/i.test(nav) ? 'zh' : 'en';
}

export function initI18n(localeHint) {
  locale = pickLocale(localeHint);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }
  return locale;
}

export function localeOf() {
  return locale;
}

export function isEnglish() {
  return locale === 'en';
}

export function t(text) {
  if (locale !== 'en' || text == null) return text;
  const raw = String(text);
  if (!CJK.test(raw)) return text;
  const core = normalize(raw);
  const hit = exact.get(core);
  if (hit !== undefined) return hit;
  for (const rule of templates) {
    const m = rule.re.exec(core);
    if (!m) continue;
    const values = new Map();
    // Captured values can be Chinese themselves (a building status label, a
    // formatted duration), so they get a second pass through the table.
    rule.order.forEach((slot, i) => values.set(slot, t(m[i + 1])));
    return rule.dst.replace(/\{(\d+)\}/g, (_, slot) => values.get(Number(slot)) ?? '');
  }
  misses.add(core);
  return text;
}

export function localizeDeep(value, seen = new WeakSet()) {
  if (typeof value === 'string') return t(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = localizeDeep(value[i], seen);
    return value;
  }
  if (value instanceof Set || value instanceof Map || value instanceof Date) return value;
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'string') {
      if (!SKIP_KEYS.has(key)) value[key] = t(v);
    } else if (v && typeof v === 'object') {
      localizeDeep(v, seen);
    }
  }
  return value;
}

export function localizeContent() {
  if (locale !== 'en') return;
  for (const value of Object.values(CONTENT)) {
    if (typeof value === 'function') continue;
    localizeDeep(value);
  }
}

function translateText(node) {
  if (!node || node.nodeValue == null) return;
  if (node.parentElement && SKIP_TAGS.has(node.parentElement.tagName)) return;
  const next = t(node.nodeValue);
  if (next !== node.nodeValue) node.nodeValue = next;
}

function translateAttr(el, name) {
  if (!el || !el.getAttribute || !name) return;
  const value = el.getAttribute(name);
  if (!value) return;
  const next = t(value);
  if (next !== value) el.setAttribute(name, next);
}

function localizeElement(el) {
  if (!el || el.nodeType !== 1) return;
  for (const name of ATTRS) translateAttr(el, name);
  for (const child of el.querySelectorAll('*')) {
    for (const name of ATTRS) translateAttr(child, name);
  }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    translateText(node);
    node = walker.nextNode();
  }
}

export function localizeDom(root = document.body) {
  if (locale !== 'en' || !root || typeof document === 'undefined') return;
  if (root.nodeType === 3) {
    translateText(root);
    return;
  }
  localizeElement(root);
}

export function startDomI18n() {
  if (started || locale !== 'en' || typeof document === 'undefined') return;
  started = true;
  document.title = t(document.title);
  for (const meta of document.querySelectorAll('meta[name="description"], meta[property="og:title"], meta[property="og:description"]')) {
    const v = meta.getAttribute('content');
    if (v) meta.setAttribute('content', t(v));
  }
  localizeDom(document.body);
  if (typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const node of m.addedNodes) {
          if (node.nodeType === 3) translateText(node);
          else if (node.nodeType === 1) localizeElement(node);
        }
      } else if (m.type === 'characterData') {
        translateText(m.target);
      } else if (m.type === 'attributes') {
        translateAttr(m.target, m.attributeName);
      }
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
  globalThis.__i18nAudit = auditDom;
  globalThis.__i18nMisses = misses;
  globalThis.__i18nT = t;
}

export function auditDom(root = document.body) {
  const out = [];
  if (typeof document === 'undefined' || !root) return out;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = normalize(node.nodeValue || '');
    if (text && CJK.test(text) && !(node.parentElement && SKIP_TAGS.has(node.parentElement.tagName))) {
      out.push({ where: 'text', text, tag: node.parentElement?.tagName || '' });
    }
    node = walker.nextNode();
  }
  for (const el of root.querySelectorAll ? root.querySelectorAll('*') : []) {
    for (const name of ATTRS) {
      const v = el.getAttribute(name);
      if (v && CJK.test(v)) out.push({ where: name, text: v, tag: el.tagName });
    }
  }
  return out;
}

'use strict';
// Improving a project that already has real files. Small models cannot do this with loose tool calls: they talk, or they copy the
// example in the prompt. So Pholama does the reliable part itself: it shows the model the real files, asks for the complete updated
// files in the FILE: format, checks the answer for signs of lost code, and only then writes. Pure functions, tested in test/improve.test.js.

const IMPROVE = /\b(improv(?:e|ing)|redesign|restyle|re-?style|polish|upgrade|modernis?e|beautif(?:y|ul)|prettier|nicer|cleaner|better looking|look(?:s)? (?:better|nicer|good|modern|cool)|make (?:it|this|the \w+) (?:look|better|nicer|modern|cleaner|prettier|responsive|faster|smoother|more \w+)|add (?:a |an |some |the )?[\w -]{2,40}(?: to (?:it|this|the \w+))?|(?:change|switch|update|swap) (?:the |all the |my )?(?:colou?rs?|theme|fonts?|layout|styles?|background|design|look|icons?|buttons?)|dark (?:mode|theme)|light (?:mode|theme)|responsive|mobile|accessib|animation|transition)\b/i;
const NOT_IMPROVE = /^(what|why|how|who|when|where|explain|tell me|describe|show me|list|is |are |does |do you|can you (?:explain|tell|describe)|thanks|thank you)\b/i;
// a bare nudge that means "carry on with what we were just talking about"
const NUDGE = /^(?:ok(?:ay)?[ ,!.]*)?(?:yes[ ,!.]*)?(?:please[ ,]*)?(?:start|go|go on|go ahead|continue|proceed|do it|do that|keep going|carry on|begin|now|add it|make it|try again|again|start adding|start now|go for it)\b[^.?!\n]{0,24}$/i;

const BIN = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|mp3|wav|ogg|mp4|zip|pdf)$/i;
const EDITABLE = /\.(html?|css|js|mjs|json|md|txt|svg|csv)$/i;
const MAX_FILE = 14000, MAX_TOTAL = 24000;   // characters shown to the model, so a small model's window is never overrun

// Is this message asking to change a project that already has content?
function wantsImprove(text, prev, files) {
  const t = String(text || '').trim(); if (!t || t.length > 700) return false;
  const real = (files || []).filter(f => EDITABLE.test(f.name) && (f.size == null || f.size > 60));
  if (!real.length) return false;                       // an empty project is a fresh build, handled elsewhere
  if (NOT_IMPROVE.test(t) && !IMPROVE.test(t)) return false;
  if (/\?\s*$/.test(t) && !/^(can|could|would) you (?:please )?(?:improve|add|make|change|fix|redesign)/i.test(t)) return false;
  if (IMPROVE.test(t)) return true;
  return NUDGE.test(t) && !!String(prev || '').trim() && IMPROVE.test(String(prev));   // "ok start" continues an improve request
}

// What the person actually wants, joining a bare nudge to the request before it.
function askOf(text, prev) {
  const t = String(text || '').trim();
  return NUDGE.test(t) && String(prev || '').trim() ? String(prev).trim().slice(0, 500) + (t.length > 12 ? ' (' + t + ')' : '') : t.slice(0, 600);
}

// Pick the files the model should see and may change. Text files only, biggest-first trimmed to the budget, the page and its script first.
function pickFiles(files) {
  const rank = n => /^index\.html?$/i.test(n) ? 0 : /\.html?$/i.test(n) ? 1 : /\.css$/i.test(n) ? 2 : /\.m?js$/i.test(n) ? 3 : 4;
  const list = (files || []).filter(f => EDITABLE.test(f.name) && !BIN.test(f.name) && typeof f.content === 'string').sort((a, b) => rank(a.name) - rank(b.name));
  const out = []; let used = 0;
  for (const f of list) { if (used + f.content.length > MAX_TOTAL || f.content.length > MAX_FILE) continue; out.push(f); used += f.content.length; }
  return out;
}

function prompt(ask, picked) {
  return 'You are improving an existing web project. Do the task by returning the COMPLETE updated version of every file you change.\n\n' +
    'Task: ' + String(ask).replace(/\s+/g, ' ') + '\n\nCurrent files:\n\n' +
    picked.map(f => 'FILE: ' + f.name + '\n```' + (/\.html?$/i.test(f.name) ? 'html' : /\.css$/i.test(f.name) ? 'css' : /\.m?js$/i.test(f.name) ? 'js' : '') + '\n' + f.content.replace(/\n$/, '') + '\n```').join('\n\n') +
    '\n\nRules: keep everything that already works. Do not remove features or shorten the code. Keep every ID that the JavaScript uses. Change only what the task needs, and make real, visible improvements. ' +
    'Reply with the complete contents of each file you change, and nothing else. Use exactly this format for each one:\n\nFILE: <the same file name as above>\n```<language>\n<complete file contents>\n```\n' +
    'Only use the file names listed above (or a new .css/.js/.html file if you really need one).';
}

// Did the model lose code? Compares what it returned with what was there.
function sanity(oldText, newText, name) {
  const o = String(oldText || ''), n = String(newText || '');
  if (!n.trim()) return 'the file came back empty';
  if (/\b(rest of (?:the )?(?:code|file)|same as (?:before|above)|unchanged|existing code|\.\.\. ?(?:rest|existing|other)|<!--\s*(?:rest|existing|same|keep))/i.test(n) && !/\b(rest of (?:the )?(?:code|file)|unchanged|existing code)/i.test(o)) return 'it left a placeholder like "rest of the code" instead of writing the code';
  if (o.length > 400 && n.length < o.length * 0.5) return 'it came back less than half the size of the original, so code was probably lost';
  if (/\.html?$/i.test(name) && /<html|<body|<!doctype/i.test(o) && !/<body|<html|<!doctype/i.test(n)) return 'the page lost its structure';
  if (/\.m?js$/i.test(name)) { // every function and element id the old script used must still exist
    const ids = s => new Set([...s.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g)].map(m => m[1]));
    const lost = [...ids(o)].filter(i => !ids(n).has(i) && !new RegExp('id=["\']' + i + '["\']').test(n));
    if (lost.length > 2 && lost.length >= ids(o).size * 0.6) return 'it dropped most of what the script controlled (' + lost.slice(0, 3).join(', ') + ')';
  }
  return '';
}

// Cross-check: every id the script asks for must exist in the page it belongs to.
function missingIds(filesByName) {
  const html = Object.entries(filesByName).filter(([n]) => /\.html?$/i.test(n)).map(([, c]) => c).join('\n');
  const script = Object.entries(filesByName).filter(([n]) => /\.m?js$/i.test(n)).map(([, c]) => c).join('\n');
  if (!html || !script) return [];
  const have = new Set([...html.matchAll(/\bid\s*=\s*["']([\w-]+)["']/g)].map(m => m[1]));
  const need = [...new Set([...script.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g)].map(m => m[1]))];
  const made = new Set([...script.matchAll(/\.id\s*=\s*['"]([\w-]+)['"]/g)].map(m => m[1]));
  return need.filter(i => !have.has(i) && !made.has(i));
}

module.exports = { wantsImprove, askOf, pickFiles, prompt, sanity, missingIds, MAX_FILE, MAX_TOTAL };

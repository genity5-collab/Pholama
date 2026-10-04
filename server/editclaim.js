'use strict';
// Studio honesty: the AI must not say it added or changed something in the project when no file was really written this message.
// Two small pure functions, tested on their own (test/editclaim.test.js).

// Tools that change files, and the word their success message starts with. A failure throws, and the server turns it into "Tool error: ...".
const CHANGING = { studio_create: /^(created|saved|made)/i, studio_write: /^(created|saved)/i, studio_patch: /^edited/i, studio_lines: /^(replaced|inserted|deleted)/i, studio_delete: /^(deleted|removed)/i };

// Did this tool call really change a project file?
function changedFile(toolName, result) {
  const re = CHANGING[String(toolName || '')]; if (!re) return false;
  const r = String(result == null ? '' : result).trim();
  if (!r || /^tool error/i.test(r)) return false;
  return re.test(r) || /\b(created|saved|edited|replaced|inserted|deleted)\b/i.test(r.slice(0, 40));
}

// Does the reply say that files were changed? "I added a timer", "I've updated style.css", "the cooldown has been added".
// A plain description of a plan or a question ("Want me to add a timer?", "I can add...", "you could add...") is NOT a claim.
const VERB = '(?:add(?:ed)?|creat(?:ed|e)|updat(?:ed|e)|chang(?:ed|e)|edit(?:ed)?|modif(?:ied|y)|fix(?:ed)?|implement(?:ed)?|insert(?:ed)?|replac(?:ed|e)|rewr(?:ote|itten)|wr(?:ote|itten)|built|improv(?:ed|e)|enhanc(?:ed|e)|remov(?:ed|e)|delet(?:ed|e)|applied|appended|include(?:d)?)';
const THING = '(?:[^.!?\\n]{0,70})';
const DID = new RegExp(
  "\\b(?:i(?:'ve| have)?|i just|we(?:'ve| have)?)\\s+(?:now\\s+|also\\s+|just\\s+|successfully\\s+)?" + VERB + "\\b" + THING +
  "|\\b(?:has|have|had|was|were|is|are)\\s+(?:now\\s+|also\\s+|been\\s+|successfully\\s+)+" + VERB + "\\b" +
  "|\\b(?:has|have)\\s+been\\s+" + VERB + "\\b" +
  "|\\b(?:the\\s+)?(?:code|file|project|page|ui|html|css|script)s?\\s+(?:has|have|is|are|now)\\s+(?:been\\s+)?(?:now\\s+)?" + VERB + "\\b", 'i');
// things that make a sentence a plan or an offer instead of a report
const PLAN = /\b(?:want me to|would you like|shall i|should i|do you want|i can|i could|i will|i'll|i would|i'd|you can|you could|you should|let me know|if you want|next,? i|to add|to create|to update|going to|plan to|how to|try to)\b/i;

function claimsEdit(reply) {
  const t = String(reply || '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');   // code blocks are examples, not claims
  if (!t.trim()) return false;
  for (const s of t.split(/(?<=[.!?])\s+|\n+/)) {
    if (!s.trim() || !DID.test(s)) continue;
    if (PLAN.test(s) && !/\b(?:i(?:'ve| have)|we(?:'ve| have)|i just|has been|have been|was|were)\b/i.test(s)) continue;
    return true;
  }
  return false;
}

// The decision: replace the reply when it claims an edit but none happened. `wasAsked` = the person really asked for a change,
// `tools` = are Studio tools available at all (if not, the AI is just chatting and we do not touch its answer).
function invented(reply, { changed, hasStudioTools }) { return !!hasStudioTools && !changed && claimsEdit(reply); }

const NO_EDIT_RAN = "I haven't changed any files yet, so nothing new was added to your project. Tell me what to change (for example: \"add a cooldown timer to index.html\") and I'll make the edit for real.";
module.exports = { changedFile, claimsEdit, invented, NO_EDIT_RAN, CHANGING };

/** Core may match one topic before examining another part of a compound question.
 * Keep the original, and use only questions the person actually wrote. */
export function recallQuestions(query, maxItems = 6) {
  const parts = [...new Set(query.split(/[，,；;！？?。]/u).map(part => part.trim()).filter(part =>
    /(?:什么|哪|谁|怎么|怎样|如何|多少|几|是否|有没|吗|么|\b(?:what|which|who|when|where|how)\b)/i.test(part)))];
  // Core accepts at most eight queries: original + five parts + style + identity.
  return parts.length > 1 ? parts.filter(part => part !== query).slice(0, Math.min(5, maxItems)) : [];
}

// Only an explicit first-line English header selects the new grammar.
// Every other input keeps main's original parser. New English quotes
// every body line starting with a reserved header or backslash with one '\'.
const legacyHeader = /^记忆(?:（过往）)?：/u;
const englishHeader = /^Memory(?: \(past\))?:/u;
const englishSeparator = /\n(?=Memory(?: \(past\))?:)/u;
const reservedBodyLine = /^(?:记忆(?:（过往）)?：|Memory(?: \(past\))?:|\\)/u;

export function isEnglishRecall(rendered) {
  return englishHeader.test(rendered);
}

// Original main parser, including unheaded, empty and leading-comment inputs.
function legacyRecallEntries(snapshots) {
  const groups=snapshots.map(snapshot=>{
    const claims=(snapshot?.preview?.rendered_recall??'').split(/\n(?=记忆(?:（过往）)?：)/);
    return (snapshot?.preview?.selected_item_ids??[]).map((pair,index)=>({snapshot,pair,claim:claims[index]?.trim()}));
  });
  return [...groups.flatMap(group=>group.slice(0,1)),...groups.flatMap(group=>group.slice(1))];
}

function decodeEnglishClaim(claim) {
  const prefix = claim.match(englishHeader)[0];
  const lines = claim.slice(prefix.length).split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith('\\')) {
      if (!reservedBodyLine.test(line.slice(1))) return undefined;
      lines[index] = line.slice(1);
    } else if (reservedBodyLine.test(line)) return undefined;
  }
  return prefix + lines.join('\n');
}

/** One permission-filtered result per question before filling the shared budget.
 * References and text still come solely from Core's original batch snapshot. */
export function recallEntries(snapshots) {
  const groups=snapshots.map(snapshot=>{
    const rendered=snapshot?.preview?.rendered_recall??'';
    const pairs=snapshot?.preview?.selected_item_ids??[];
    // E2 adds profile text and quote windows. IDs describe all dependencies,
    // including quote support; they no longer correspond one-to-one to lines.
    if (pairs.some(pair=>pair?.[0]==='evidence') || /^(?:本人档案（当前；保留原话归属）：|User profile \(current; original attribution\):)/u.test(rendered)) {
      return [{snapshot,pair:null,dependencies:pairs,claim:rendered,header:englishHeader}];
    }
    if (!isEnglishRecall(rendered)) {
      return legacyRecallEntries([snapshot]).map(entry=>({...entry,header:legacyHeader}));
    }
    const claims=rendered.split(englishSeparator).map(decodeEnglishClaim);
    if (claims.length===pairs.length && claims.every(claim=>claim!==undefined)) {
      return pairs.map((pair,index)=>({snapshot,pair,claim:claims[index],header:englishHeader}));
    }
    // Malformed new English format remains complete and never gains IDs.
    return [{snapshot,pair:null,claim:rendered,header:englishHeader}];
  });
  return [...groups.flatMap(group=>group.slice(0,1)),...groups.flatMap(group=>group.slice(1))];
}

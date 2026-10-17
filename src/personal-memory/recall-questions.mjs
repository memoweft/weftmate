/** Core may match one topic before examining another part of a compound question.
 * Keep the original, and use only questions the person actually wrote. */
export function recallQuestions(query, maxItems = 6) {
  const parts = [...new Set(query.split(/[，,；;！？?。]/u).map(part => part.trim()).filter(part =>
    /(?:什么|哪|谁|怎么|怎样|如何|多少|几|是否|有没|吗|么|\b(?:what|which|who|when|where|how)\b)/i.test(part)))];
  // Core accepts at most eight queries: original + five parts + style + identity.
  return parts.length > 1 ? parts.filter(part => part !== query).slice(0, Math.min(5, maxItems)) : [];
}

// Preserve the old Core grammar exactly. English titles in a Chinese entry
// are ordinary body text; dates never determine boundaries or get rewritten.
const legacyHeader = /^记忆(?:（过往）)?：/u;
const legacySeparator = /\n(?=记忆(?:（过往）)?：)/u;
const englishHeader = /^Memory(?: \(past\))?:/u;
const englishSeparator = /\r?\n(?=Memory(?: \(past\))?:)/u;

/** One permission-filtered result per question before filling the shared budget.
 * References and text still come solely from Core's original batch snapshot. */
export function recallEntries(snapshots) {
  const groups=snapshots.map(snapshot=>{
    const rendered=snapshot?.preview?.rendered_recall??'';
    const pairs=snapshot?.preview?.selected_item_ids??[];
    if (!pairs.length) return [];
    let claims=rendered.split(legacySeparator), header=legacyHeader;
    // Select one grammar for the entire snapshot. Only accept English when
    // its leading header and complete entry count agree with Core's IDs.
    if (englishHeader.test(rendered.trimStart())) {
      const englishClaims=rendered.split(englishSeparator);
      if (englishClaims.length===pairs.length) { claims=englishClaims; header=englishHeader; }
    }
    // If new parsing is ambiguous, the old grammar above gets first refusal.
    // If neither can pair safely, keep the complete text without invented IDs.
    if (claims.length!==pairs.length) return [{snapshot,pair:null,claim:rendered,
      header:englishHeader.test(rendered.trimStart())?englishHeader:legacyHeader}];
    return pairs.map((pair,index)=>({snapshot,pair,claim:claims[index]?.trim(),header}));
  });
  return [...groups.flatMap(group=>group.slice(0,1)),...groups.flatMap(group=>group.slice(1))];
}

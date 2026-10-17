/** Core may match one topic before examining another part of a compound question.
 * Keep the original, and use only questions the person actually wrote. */
export function recallQuestions(query, maxItems = 6) {
  const parts = [...new Set(query.split(/[，,；;！？?。]/u).map(part => part.trim()).filter(part =>
    /(?:什么|哪|谁|怎么|怎样|如何|多少|几|是否|有没|吗|么|\b(?:what|which|who|when|where|how)\b)/i.test(part)))];
  // Core accepts at most eight queries: original + five parts + style + identity.
  return parts.length > 1 ? parts.filter(part => part !== query).slice(0, Math.min(5, maxItems)) : [];
}

// Only column-zero headers delimit entries. Dates belong to the body and are
// preserved verbatim; this compatibility reader does not infer their meaning.
const RECALL_HEADER = '(?:记忆(?:（过往）)?：|Memory(?: \\(past\\))?:)';
export const recallHeader = new RegExp(`^${RECALL_HEADER}`, 'u');
const recallSeparator = new RegExp(`\\r?\\n(?=${RECALL_HEADER})`, 'u');

/** One permission-filtered result per question before filling the shared budget.
 * References and text still come solely from Core's original batch snapshot. */
export function recallEntries(snapshots) {
  const groups=snapshots.map(snapshot=>{
    const claims=(snapshot?.preview?.rendered_recall??'').split(recallSeparator);
    const pairs=snapshot?.preview?.selected_item_ids??[];
    // A literal unescaped header inside a body is indistinguishable from an
    // entry boundary. Never shift that text onto a different Core reference.
    const aligned=claims.length===pairs.length;
    return pairs.map((pair,index)=>({snapshot,pair,claim:aligned?claims[index]?.trim():undefined}));
  });
  return [...groups.flatMap(group=>group.slice(0,1)),...groups.flatMap(group=>group.slice(1))];
}

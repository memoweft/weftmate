/** Core may match one topic before examining another part of a compound question.
 * Keep the original, and use only questions the person actually wrote. */
export function recallQuestions(query, maxItems = 6) {
  const parts = [...new Set(query.split(/[，,；;！？?。]/u).map(part => part.trim()).filter(part =>
    /(?:什么|哪|谁|怎么|怎样|如何|多少|几|是否|有没|吗|么|\b(?:what|which|who|when|where|how)\b)/i.test(part)))];
  // Core accepts at most eight queries: original + five parts + style + identity.
  return parts.length > 1 ? parts.filter(part => part !== query).slice(0, Math.min(5, maxItems)) : [];
}

/** One permission-filtered result per question before filling the shared budget.
 * References and text still come solely from Core's original batch snapshot. */
export function recallEntries(snapshots) {
  const groups=snapshots.map(snapshot=>{
    const claims=(snapshot?.preview?.rendered_recall??'').split(/\n(?=记忆(?:（过往）)?：)/);
    return (snapshot?.preview?.selected_item_ids??[]).map((pair,index)=>({snapshot,pair,claim:claims[index]?.trim()}));
  });
  return [...groups.flatMap(group=>group.slice(0,1)),...groups.flatMap(group=>group.slice(1))];
}

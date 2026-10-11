/** Existing Trust World revision links, projected without inference. */
const keyOf=row=>`${row.object_kind}:${row.item_id}`;
export function memorySuccessors(rows){
  const live=new Map(rows.map(row=>[keyOf(row),row])),next=new Map(),transitions=new Map();
  for(const row of rows)for(const transition of row.transition_history??[])if(['corrects','supersedes'].includes(transition.transition_kind)&&transition.prior_item_id&&transition.replacement_item_id){
    const kind=transition.object_kind??row.object_kind,prior=`${kind}:${transition.prior_item_id}`,replacement=`${kind}:${transition.replacement_item_id}`;
    transitions.set(transition.transition_id??`${prior}>${replacement}`,{...transition,kind,prior,replacement});next.set(prior,replacement);
  }
  const resolve=key=>{const seen=new Set();while(next.has(key)&&!seen.has(key)){seen.add(key);key=next.get(key);}return live.get(key);};
  return {live,resolve,transitions:[...transitions.values()]};
}
export function memoryItemsFormedInWindow(rows,from,to){
  const chain=memorySuccessors(rows),replacements=new Set(chain.transitions.map(row=>row.replacement));
  const roots=rows.filter(row=>!replacements.has(keyOf(row))&&Date.parse(row.created_at)>=Date.parse(from)&&Date.parse(row.created_at)<Date.parse(to));
  return [...new Map(roots.map(row=>chain.resolve(keyOf(row))).filter(row=>row?.current_state==='current').map(row=>[keyOf(row),row])).values()];
}

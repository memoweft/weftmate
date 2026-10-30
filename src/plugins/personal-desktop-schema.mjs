/** Model input contract. JSON objects are passed directly, never encoded strings. */
export const desktopParameter = {type:'object',additionalProperties:false,
  description:'A direct object, not a JSON-encoded string. Discover windows first; use observed identifiers.',
  properties:{
    action:{type:'string',required:true,enum:['windows','inspect','screenshot','click','invoke','type','keys','scroll','open']},
    title:{type:'string'},process_id:{type:'integer'},window_id:{type:'string'},
    selector:{type:'object',additionalProperties:false,properties:{element_id:{type:'string'},automation_id:{type:'string'},name:{type:'string'},control_type:{type:'string'}}},
    x:{type:'integer'},y:{type:'integer'},button:{type:'string',enum:['left','right','middle']},double_click:{type:'boolean'},
    text:{type:'string'},append:{type:'boolean'},keys:{oneOf:[{type:'string'},{type:'array',items:{type:'string'}}]},
    direction:{type:'string',enum:['up','down','left','right']},amount:{type:'integer'},
    max_depth:{type:'integer'},max_nodes:{type:'integer'},path:{type:'string'},
    arguments:{type:'array',items:{type:'string'}},working_directory:{type:'string'},
  }};

export function desktopArgumentViolations(args) {
  if(args.action!=='desktop')return [];
  if(!args.desktop)return ['args.desktop is required for action desktop; pass a direct object'];
  const input=args.desktop,issues=[];
  for(const field of input.action==='open'?['path']:input.action==='windows'?[]:['window_id'])
    if(typeof input[field]!=='string'||!input[field].trim())issues.push(`args.desktop.${field} is required for ${input.action}`);
  if(input.action==='type'&&input.text===undefined)issues.push('args.desktop.text is required for type');
  if(input.action==='keys'&&(input.keys===undefined||Array.isArray(input.keys)&&!input.keys.length))issues.push('args.desktop.keys requires a key name or nonempty array');
  if(input.action==='click'&&!input.selector&&(!Number.isInteger(input.x)||!Number.isInteger(input.y)))issues.push('args.desktop.click requires selector or integer x and y coordinates');
  return issues;
}

export function modelReasoning(profile: {baseUrl:string;model?:string;modelId?:string;reasoningEffort?:string}): {reasoningEfforts:Record<string,string|null>;compat:{thinkingFormat:string;supportsReasoningEffort:boolean}} | null;
export function reasoningCapability(profile: {baseUrl:string;model?:string;modelId?:string;reasoningEffort?:string}): {supported:boolean;effort?:string};
export function prepareOfficialModelReasoning(client: unknown, route:string, profile: {baseUrl:string;model:string}): Promise<boolean>;

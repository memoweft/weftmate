/* Same account settings and prompt assembly on the host and offline phone. */
(() => {
  const limits = Object.freeze({ preferredName: 80, bio: 500, toneInstructions: 500, fixedInstructions: 4000, writingStyle: 1000 });
  const defaults = Object.freeze({ preferredName: '', bio: '', tone: 'natural', toneInstructions: '', fixedInstructions: '',
    useWritingStyle: false, writingStyle: '', webSearch: true, verbosity: 'medium', thinkingDisplay: 'collapsed', defaultDeepThinking: false, messageMode: 'queue' });
  const tones = { natural: '自然、亲切', concise: '简洁、直接', detailed: '详细、耐心', formal: '正式、严谨', casual: '轻松、随和' };
  const verbosity = { short: '简短，优先给结论，只补充必要解释', medium: '适中，给出结论和有用的说明', thorough: '详尽，充分说明依据、步骤和必要的例子' };
  function validate(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length) throw new TypeError('INVALID_REQUEST');
    for (const [key, value] of Object.entries(patch)) {
      if (!Object.hasOwn(defaults, key)) throw new TypeError('INVALID_REQUEST');
      if (Object.hasOwn(limits, key)) { if (typeof value !== 'string' || [...value].length > limits[key]) throw new TypeError('INVALID_REQUEST'); }
      else if (typeof defaults[key] === 'boolean') { if (typeof value !== 'boolean') throw new TypeError('INVALID_REQUEST'); }
      else if (!(key === 'tone' ? Object.keys(tones) : key === 'verbosity' ? Object.keys(verbosity) : key === 'thinkingDisplay' ? ['collapsed', 'expanded', 'hidden'] : ['queue', 'steer']).includes(value)) throw new TypeError('INVALID_REQUEST');
    }
    return { ...patch };
  }
  function settings(value) { return { ...defaults, ...value }; }
  function prompt(value) {
    const s = settings(value), parts = [];
    if (s.preferredName.trim()) parts.push(`称呼用户为：${s.preferredName.trim()}。`);
    if (s.bio.trim()) parts.push(`用户自述背景（仅作相关回答的背景）：${s.bio.trim()}`);
    if (s.tone !== 'natural') parts.push(`回复语气：${tones[s.tone]}。`);
    if (s.toneInstructions.trim()) parts.push(`用户的语气说明：\n${s.toneInstructions.trim()}`);
    if (s.verbosity !== 'medium') parts.push(`回答详细程度：${verbosity[s.verbosity]}。`);
    if (s.useWritingStyle && s.writingStyle.trim()) parts.push(`参考用户写作风格：\n${s.writingStyle.trim()}`);
    if (s.fixedInstructions.trim()) parts.push(`用户明确写下的全局固定说明（不作为记忆证据，不要复述或存入记忆）：\n${s.fixedInstructions.trim()}`);
    if (!s.webSearch) parts.push('用户已关闭网页搜索。不调用联网搜索、网页读取或浏览工具；需要最新资料时说明当前无法查证。');
    return parts.join('\n\n');
  }
  function extractStyle(messages) {
    const texts = messages.filter(text => typeof text === 'string' && text.trim()).map(text => text.trim());
    if (!texts.length) return '';
    const average = texts.reduce((n, text) => n + [...text].length, 0) / texts.length;
    const notes = [average < 80 ? '偏好短句、直接表达。' : '习惯完整描述背景和需求，保留必要细节。'];
    if (texts.filter(text => /\n/.test(text)).length > texts.length / 3) notes.push('较常分行组织内容。');
    if (texts.filter(text => /[？?]/.test(text)).length > texts.length / 3) notes.push('常用提问推进交流。');
    if (texts.filter(text => /[A-Za-z]{3,}/.test(text)).length > texts.length / 3) notes.push('中文表达中保留常用英文名称和术语。');
    if (texts.filter(text => /(^|\n)\s*(?:[-*•]|\d+[.、])/.test(text)).length > texts.length / 4) notes.push('较常用列表逐项说明。');
    return notes.join('\n');
  }
  globalThis.WeftPersonalization = Object.freeze({ limits, defaults, settings, validate, prompt, extractStyle });
})();

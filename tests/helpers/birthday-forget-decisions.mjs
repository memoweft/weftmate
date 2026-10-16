// Known synthetic facts for the birthday integration cases. Correct responses
// and deliberate semantic faults are separate; no production classifier lives here.
export const birthdayFacts = [
  { text: '我的生日是五月一日', worldTexts: ['用户的生日是五月一日'], subject: 'self' },
  { text: '妈妈的生日是六月一日', subject: 'other:妈妈' },
  { text: '同事小王的生日是七月一日', subject: 'other:同事小王' },
];

export function birthdayForgetDecisions(input, { facts = birthdayFacts, misattribute = false } = {}) {
  const matches = text => facts.filter(fact => text?.includes(fact.text));
  // Only these observed World spellings identify a synthetic target fact.
  // Original source wording remains separate; graph/source hints cannot fill
  // in an unknown World statement or turn a quotation into a known fact.
  const matchesWorld = text => facts.filter(fact => [fact.text, ...(fact.worldTexts ?? [])]
    .includes(text?.replace(/。$/u, '')));
  return input.candidates.map(candidate => {
    const targetFacts = candidate.kind === 'evidence' ? matches(candidate.text) : matchesWorld(candidate.text);
    const sourceFacts = candidate.sourceTexts.flatMap(matches);
    const hasTargetFact = targetFacts.length > 0;
    const sourceSubjects = [...new Set(sourceFacts.map(fact => fact.subject))];
    return { key: candidate.key, matchesTopic: hasTargetFact, hasTargetFact,
      subjects: misattribute ? ['self'] : sourceSubjects.length ? sourceSubjects : ['unknown'],
      targetSubjects: hasTargetFact ? misattribute ? ['self'] : [...new Set(targetFacts.map(fact => fact.subject))] : [],
      sourceFullyAuthorized: misattribute || sourceFacts.length > 0 && sourceSubjects.every(value => value === input.request.subject) };
  });
}

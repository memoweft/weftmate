// G9 item 3: fixed format-only inputs from the stopped English exam.
// qa-audit.json uses one-based sessions and zero-based question_index;
// sessions/*/artifact.json uses zero-based session directories.
// These are verbatim user turns, never assistant claims or expected answers.
// Chinese counterparts below are newly written equivalent fixtures, not exam data.
// Dates preserve the source timestamps without inventing a timezone.
export const recallDateCases = [
  { source: 'session5/question0 (Omission), 004 user turn0', date: 'Jan 06, 2026, 17:48:59',
    en: "I recently spent some time at a friend's house and interacted with their Golden Retriever. It was such a gentle creature, and I found its adaptability really impressive.",
    zh: '我最近在一个朋友家待了一会儿，和他家的金毛寻回犬互动。它很温和，适应能力让我印象深刻。' },
  { source: 'session10/question2 (Omission), 009 user turn1', date: 'Jul 14, 2026, 18:12:48',
    en: "Yes, I'm definitely curious, but I'm also a bit skeptical. I've always avoided violent video games because they don't align with my values.",
    zh: '是的，我确实很好奇，但也有些怀疑。我一直避开暴力电子游戏，因为它们不符合我的价值观。' },
  { source: 'session11/question0 (Omission), 010 user turn1', date: 'Oct 16, 2026, 11:54:54',
    en: 'I am actually looking into alternatives like nature hikes and cultural tours. They seem to offer enriching experiences without compromising my health values. I want to ensure my travels support both personal and global well-being.',
    zh: '我正在考虑自然徒步和文化游等替代选择。这些体验似乎很丰富，也不违背我的健康观念。我希望旅行兼顾个人和全球福祉。' },
];

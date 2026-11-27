// The shape of a generated quiz paper, and the rules that keep a model's answer safe to
// render. Everything that reaches the screen passes through `sanitisePaper`, so an
// unexpected or oversized answer is trimmed rather than printed as-is.

export type PaperQuestion = {
  question: string;
  options: string[];
  answer: string;
  marks: string;
};

export type PaperSection = {
  heading: string;
  instructions: string;
  questions: PaperQuestion[];
};

export type Paper = {
  title: string;
  subject: string;
  className: string;
  timeAllowed: string;
  totalMarks: string;
  instructions: string[];
  sections: PaperSection[];
};

// Limits, chosen so a paper still fits neatly on one or two printed pages.
const MAX_SECTIONS = 4;
const MAX_QUESTIONS_PER_SECTION = 12;
const MAX_OPTIONS = 5;
const MAX_INSTRUCTIONS = 5;

function text(value: unknown, max: number): string {
  if (typeof value === 'string') return value.trim().slice(0, max);
  if (typeof value === 'number') return String(value);
  return '';
}

function textList(value: unknown, max: number, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, max))
    .filter((item) => item.length > 0)
    .slice(0, maxItems);
}

function readQuestion(raw: unknown): PaperQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const question = text(row.question ?? row.text ?? row.q, 400);
  if (!question) return null;
  const options = textList(row.options, 200, MAX_OPTIONS).map((option, index) => {
    // A bare option is given its own letter so the printed paper is always answerable.
    return /^[A-Ea-e][).:]/.test(option) ? option : `${String.fromCharCode(65 + index)}) ${option}`;
  });
  return {
    question,
    options,
    answer: text(row.answer ?? row.correctAnswer ?? row.key, 400),
    marks: text(row.marks ?? row.mark, 16),
  };
}

function readSection(raw: unknown): PaperSection | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const questions = (Array.isArray(row.questions) ? row.questions : [])
    .map(readQuestion)
    .filter((question): question is PaperQuestion => question !== null)
    .slice(0, MAX_QUESTIONS_PER_SECTION);
  if (questions.length === 0) return null;
  return {
    heading: text(row.heading ?? row.title ?? row.name, 120) || 'Questions',
    instructions: text(row.instructions ?? row.note, 300),
    questions,
  };
}

// Returns null when there is nothing printable, so the caller can fall back to a plain
// message instead of showing an empty sheet.
export function sanitisePaper(raw: unknown): Paper | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;

  const sections = (Array.isArray(row.sections) ? row.sections : [])
    .map(readSection)
    .filter((section): section is PaperSection => section !== null)
    .slice(0, MAX_SECTIONS);

  // A model that ignores the section shape but still returned questions is salvaged.
  if (sections.length === 0) {
    const fallback = readSection({ heading: 'Questions', questions: row.questions });
    if (fallback) sections.push(fallback);
  }
  if (sections.length === 0) return null;

  return {
    title: text(row.title, 140) || 'Quiz paper',
    subject: text(row.subject, 80),
    className: text(row.className ?? row.class, 60),
    timeAllowed: text(row.timeAllowed ?? row.time, 40),
    totalMarks: text(row.totalMarks ?? row.marks, 40),
    instructions: textList(row.instructions, 240, MAX_INSTRUCTIONS),
    sections,
  };
}

function numbered(section: PaperSection, startAt: number): string[] {
  return section.questions.map((question, index) => {
    const lines = [`${startAt + index}. ${question.question}${question.marks ? `  [${question.marks}]` : ''}`];
    for (const option of question.options) lines.push(`   ${option}`);
    return lines.join('\n');
  });
}

// The plain-text version used by the copy button and the WhatsApp share.
export function paperToText(paper: Paper): string {
  const lines: string[] = [paper.title];
  const meta = [paper.subject, paper.className, paper.timeAllowed && `Time: ${paper.timeAllowed}`, paper.totalMarks && `Total marks: ${paper.totalMarks}`]
    .filter((part) => part && String(part).length > 0)
    .join(' · ');
  if (meta) lines.push(meta);

  if (paper.instructions.length > 0) {
    lines.push('', 'Instructions:');
    for (const instruction of paper.instructions) lines.push(`- ${instruction}`);
  }

  for (const section of paper.sections) {
    lines.push('', section.heading.toUpperCase());
    if (section.instructions) lines.push(section.instructions);
    lines.push(...numbered(section, 1));
  }

  lines.push('', 'ANSWER KEY');
  for (const section of paper.sections) {
    lines.push('', section.heading);
    for (const [index, question] of section.questions.entries()) {
      lines.push(`${index + 1}. ${question.answer || '—'}`);
    }
  }

  return lines.join('\n');
}

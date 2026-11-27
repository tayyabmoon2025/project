export const SCHOOL_NAME = 'Ujala Public School';
export const SCHOOL_NAME_UR = 'اجالا پبلک اسکول';

const GENERAL_GREETING: Record<'English' | 'Urdu', string> = {
  English: 'Parent or Guardian',
  Urdu: 'محترم والدین',
};

export function renderNoticeText(template: string, language: 'English' | 'Urdu', studentName: string | null) {
  const name = studentName ?? GENERAL_GREETING[language];
  return template.replace(/{{student_name}}/g, name).replace(/{{school_name}}/g, SCHOOL_NAME);
}

// Absentee alerts use short single-brace placeholders. Double-brace wording saved
// before this feature existed still works, so no school loses its own template.
export function renderAbsenteeText(
  template: string,
  values: { student_name: string; class_name: string; section_name: string; date: string },
) {
  const section = values.section_name ? ` · Section ${values.section_name}` : '';
  const replacements: Record<string, string> = {
    student_name: values.student_name,
    class: `${values.class_name}${section}`,
    date: formatAbsenteeDate(values.date),
    school_name: SCHOOL_NAME,
  };
  return template
    .replace(/\{\{\s*(student_name|class|date|school_name)\s*\}\}/g, (_, key: string) => replacements[key] ?? '')
    .replace(/\{\s*(student_name|class|date|school_name)\s*\}/g, (_, key: string) => replacements[key] ?? '');
}

// Homework notices carry a few extra placeholders — the subject, the title and the
// hand-in date — so they get their own renderer.
export const HOMEWORK_PLACEHOLDERS = [
  '{student_name}', '{class}', '{subject}', '{title}', '{date}', '{due_date}', '{school_name}',
];

export function renderHomeworkText(
  template: string,
  language: 'English' | 'Urdu',
  values: {
    student_name: string;
    class_name: string;
    section_name: string;
    subject: string;
    title: string;
    date: string;
    due_date: string | null;
  },
) {
  const section = values.section_name ? ` · Section ${values.section_name}` : '';
  const replacements: Record<string, string> = {
    student_name: values.student_name,
    class: `${values.class_name}${section}`,
    subject: values.subject,
    title: values.title,
    date: formatAbsenteeDate(values.date),
    due_date: values.due_date
      ? formatAbsenteeDate(values.due_date)
      : language === 'Urdu' ? 'اگلے اسکول دن' : 'the next school day',
    school_name: language === 'Urdu' ? SCHOOL_NAME_UR : SCHOOL_NAME,
  };
  return template
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => replacements[key] ?? '')
    .replace(/\{\s*([a-z_]+)\s*\}/g, (_, key: string) => replacements[key] ?? '');
}

export function formatAbsenteeDate(value: string) {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

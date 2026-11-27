import type { AbsenteeAlertStatus, AbsenteeTemplate, AlertNoticeType } from '@/lib/schoolTypes';

export type AlertLanguage = 'English' | 'Urdu';

// The three register marks that reach parents. Each keeps its own saved wording.
export const ALERT_STATUSES: AbsenteeAlertStatus[] = ['absent', 'leave', 'late'];

// The notice type each alert status is stored under in school_notice_templates.
export const ALERT_NOTICE_TYPES: Record<AbsenteeAlertStatus, AlertNoticeType> = {
  absent: 'absentee_alert',
  leave: 'leave_alert',
  late: 'late_alert',
};

// Every notice kind that shares the absentee template store, including the fee and
// homework messages that reuse the same table.
export const ALERT_NOTICE_TYPE_LIST: AlertNoticeType[] = [
  'absentee_alert', 'leave_alert', 'late_alert',
  'fee_reminder', 'homework_alert', 'homework_reminder',
];

export const ALERT_STATUS_LABELS: Record<AbsenteeAlertStatus, string> = {
  absent: 'Absent',
  leave: 'Leave',
  late: 'Late',
};

// The short single-brace placeholders the absentee wording understands.
export const ALERT_PLACEHOLDERS = ['{student_name}', '{class}', '{date}', '{school_name}'];

export type AlertWording = Record<AlertLanguage, string>;
export type AlertTemplates = Record<AbsenteeAlertStatus, AlertWording>;

export const DEFAULT_ALERT_WORDING: AlertTemplates = {
  absent: {
    English: 'Dear Parent or Guardian, {student_name} of {class} was marked absent on {date} at {school_name}. Please contact the school office if this was not expected.',
    Urdu: 'محترم والدین، {student_name} ({class}) {date} کو {school_name} میں غیر حاضر رہے۔ اگر یہ غیر متوقع تھا تو براہِ کرم اسکول دفتر سے رابطہ کریں۔',
  },
  leave: {
    English: 'Dear Parent or Guardian, {student_name} of {class} was on approved leave on {date} at {school_name}. Please contact the school office if this was not expected.',
    Urdu: 'محترم والدین، {student_name} ({class}) {date} کو {school_name} میں رخصت پر تھے۔ اگر یہ غیر متوقع تھا تو براہِ کرم اسکول دفتر سے رابطہ کریں۔',
  },
  late: {
    English: 'Dear Parent or Guardian, {student_name} of {class} arrived late on {date} at {school_name}. Please make sure your child reaches school on time.',
    Urdu: 'محترم والدین، {student_name} ({class}) {date} کو {school_name} میں دیر سے پہنچے۔ براہِ کرم اپنے بچے کو وقت پر اسکول بھیجیں۔',
  },
};

export function defaultWordingFor(status: AbsenteeAlertStatus, language: AlertLanguage): string {
  return DEFAULT_ALERT_WORDING[status][language];
}

export function isAlertStatus(value: string | null | undefined): value is AbsenteeAlertStatus {
  return value === 'absent' || value === 'leave' || value === 'late';
}

// The reverse of ALERT_NOTICE_TYPES, so a logged message can be labelled by its status.
export function statusForNoticeType(type: AlertNoticeType | string): AbsenteeAlertStatus | null {
  const found = ALERT_STATUSES.find((key) => ALERT_NOTICE_TYPES[key] === type);
  return found ?? null;
}

// Builds the per-status wording from saved templates, falling back to the defaults
// for any status or language the school has not customised yet.
export function alertWordingFrom(templates: AbsenteeTemplate[]): AlertTemplates {
  return ALERT_STATUSES.reduce((accumulator, status) => {
    const noticeType = ALERT_NOTICE_TYPES[status];
    const pick = (language: AlertLanguage) =>
      templates.find((template) => template.notice_type === noticeType && template.language === language)?.template_text
      ?? DEFAULT_ALERT_WORDING[status][language];
    accumulator[status] = { English: pick('English'), Urdu: pick('Urdu') };
    return accumulator;
  }, {} as AlertTemplates);
}

export type HomeworkWording = Record<AlertLanguage, string>;

export const DEFAULT_HOMEWORK_WORDING: HomeworkWording = {
  English: 'Dear Parent or Guardian, {student_name} of {class} has been given new homework in {subject}: {title}. Please make sure it is completed and handed in by {due_date}. — {school_name}',
  Urdu: 'محترم والدین، {student_name} ({class}) کو {subject} میں نیا ہوم ورک دیا گیا ہے: {title}۔ براہِ کرم اسے {due_date} تک مکمل کر کے جمع کرائیں۔ — {school_name}',
};

export const DEFAULT_HOMEWORK_REMINDER_WORDING: HomeworkWording = {
  English: 'Reminder: {student_name} of {class} has homework in {subject} — {title}. It must be handed in by {due_date}. — {school_name}',
  Urdu: 'یاد دہانی: {student_name} ({class}) کا {subject} کا ہوم ورک — {title} — {due_date} تک جمع کرانا ہے۔ — {school_name}',
};

export function homeworkWordingFrom(templates: AbsenteeTemplate[]): HomeworkWording {
  const pick = (language: AlertLanguage) =>
    templates.find((template) => template.notice_type === 'homework_alert' && template.language === language)?.template_text
    ?? DEFAULT_HOMEWORK_WORDING[language];
  return { English: pick('English'), Urdu: pick('Urdu') };
}

export function homeworkReminderWordingFrom(templates: AbsenteeTemplate[]): HomeworkWording {
  const pick = (language: AlertLanguage) =>
    templates.find((template) => template.notice_type === 'homework_reminder' && template.language === language)?.template_text
    ?? DEFAULT_HOMEWORK_REMINDER_WORDING[language];
  return { English: pick('English'), Urdu: pick('Urdu') };
}

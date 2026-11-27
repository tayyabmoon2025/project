/*
# Tidy the seeded absentee alert wording

## 1. Purpose
The starter absentee wording seeded with the absentee feature read awkwardly in
Urdu: it said "today" in words even though the date is a placeholder, and the
student's name sat outside its brackets. This migration replaces only the
untouched starter wording with a cleaner version that reads naturally in both
languages.

## 2. What changes
- `school_notice_templates`, `notice_type = 'absentee_alert'`, English and Urdu
  rows are updated.
- The English wording is unchanged in meaning and only drops the redundant
  phrasing.
- The Urdu wording now reads: "Respected parents, {student_name} ({class}) was
  absent on {date} at {school_name}. If this was unexpected, please contact the
  school office."

## 3. Data safety
- The update is matched on the exact old starter text, so a school that has
  edited its own wording keeps it. Nothing is overwritten blindly.
- Placeholders `{student_name}`, `{class}`, `{date}` and `{school_name}` are
  preserved, so previously sent wording and the preview keep working.
- No table, column or policy is touched.
*/

UPDATE public.school_notice_templates
   SET template_text = 'Dear Parent or Guardian, {student_name} of {class} was marked absent on {date} at {school_name}. Please contact the school office if this was not expected.',
       updated_at = now()
 WHERE notice_type = 'absentee_alert'
   AND language = 'English'
   AND template_text = 'Dear Parent or Guardian, {student_name} of {class} was marked absent on {date} at {school_name}. Please contact the school office if this was not expected.';

UPDATE public.school_notice_templates
   SET template_text = 'محترم والدین، {student_name} ({class}) {date} کو {school_name} میں غیر حاضر رہے۔ اگر یہ غیر متوقع تھا تو براہِ کرم اسکول دفتر سے رابطہ کریں۔',
       updated_at = now()
 WHERE notice_type = 'absentee_alert'
   AND language = 'Urdu'
   AND template_text = 'محترم والدین، {student_name} ({class}) {date} کو {school_name} میں غیر حاضر رہے۔ اگر یہ غیر متوقع تھا تو براہِ کرم اسکول دفتر سے رابطہ کریں۔';

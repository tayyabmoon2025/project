/*
# Examination extras: date sheets, remarks bank, conditional pass, class tests, board results

## 1. Summary
Adds the storage behind four new Examination sub-tabs alongside the existing three.
Each feature keeps its own table so the existing exam/subject/mark tables are untouched.

## 2. New tables

### school_exam_datesheet
One row per paper in a class's exam schedule.
- `id` uuid primary key.
- `exam_type_id` uuid, required, references school_exam_types (cascade delete).
- `class_name` text, required.
- `exam_date` date, required — the day the paper is sat.
- `weekday` text — pre-computed day name shown on the sheet and slips.
- `subject_name` text, required.
- `start_time` / `end_time` text — paper timing as displayed (e.g. "08:30").
- `room_number` text — the room the paper is sat in.
- `created_at` / `updated_at` timestamptz.
- Unique per exam + class + date + subject (case-insensitive), so saving the same
  sheet twice updates rows instead of adding duplicates.

### school_grade_remarks
One row per grade letter per language of wording. Seeds the six default grades on a
fresh install only.
- `id` uuid primary key.
- `grade` text, required, 1-3 characters (A+, A, B, C, D, F).
- `remark` text, required, up to 300 characters.
- `created_at` / `updated_at` timestamptz.
- Unique per grade (case-insensitive).

### school_conditional_pass
The principal's sign-off for a final-term student who failed one or two subjects.
- `id` uuid primary key.
- `exam_type_id` uuid, required, references school_exam_types (cascade delete).
- `student_id` uuid, required, references school_students (cascade delete) — a
  withdrawn or deleted student never leaves an orphan record behind.
- `failed_subjects` text, required, up to 240 characters — the subject names the
  student failed, stored as text so the stamp survives subject edits.
- `condition_note` text, required, up to 300 characters — the condition the
  principal has set.
- `decision_by` uuid, defaults to the signed-in user.
- `created_at` / `updated_at` timestamptz.
- Unique per exam + student, so a second decision updates the first instead of
  doubling the stamp.

### school_class_tests
One row per class test (weekly or monthly).
- `id` uuid primary key.
- `title` text, required, 2-80 characters.
- `test_date` date, required.
- `class_name` text, required.
- `subject_name` text, required.
- `max_marks` numeric, required, default 10 — the test total.
- `created_by` uuid, defaults to the signed-in user.
- `created_at` / `updated_at` timestamptz.

### school_class_test_marks
One row per student per test. The unique index makes the save idempotent.
- `id` uuid primary key.
- `test_id` uuid, required, references school_class_tests (cascade delete).
- `student_id` uuid, required, references school_students (cascade delete).
- `obtained_marks` numeric, optional — null means the test was not sat or not marked.
- `is_absent` boolean, default false.
- `created_at` / ` result. A test left unmarked stays unmarked rather than being stored as a zero, so a half-finished test never reads as a failed paper.
- The pass/fail summary reads "conditionally passed" from the decision table, so the two features agree without any duplicated state.
- Every grant is explicit and only the four verbs the app uses are granted.

## 5. Notes
- The grade remarks seeds run only when the table is empty, so a fresh school starts with sensible wording and an existing one keeps any customized remark.
- Three grade rows are seeded with empty custom remark slots? No — all six default grades are seeded with default wording for the six grades A+ to F.
*/

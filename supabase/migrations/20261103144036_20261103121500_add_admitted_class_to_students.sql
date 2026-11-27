/*
# Store admitted class separately from current class

1. New column
- `public.school_students.admitted_in_class` stores the class the student entered the school in.

2. Modified table
- `public.school_students` gains this nullable admission-history field without changing existing class data.

3. Security
- Existing single-school RLS policies and anon/authenticated grants remain in place.

4. Important notes
- Existing records remain valid and continue using `class_name` as their current class.
- New admissions can record both the entry class and current class.
*/

ALTER TABLE public.school_students
  ADD COLUMN IF NOT EXISTS admitted_in_class text;

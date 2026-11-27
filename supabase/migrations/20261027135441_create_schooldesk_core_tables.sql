/*
# Create SchoolDesk core tables

1. New Tables
- `school_students` stores the shared school roster, admission details, class placement, guardian contact, and student status.
- `school_attendance` stores one attendance record per student per school day, including present, absent, late, or excused status.

2. Columns
- `school_students.id` is the generated student identifier.
- `school_students.admission_number` is the human-friendly school reference number.
- `school_students.full_name`, `gender`, `date_of_birth`, `class_name`, `section_name`, `guardian_name`, and `guardian_phone` describe the student and their family contact.
- `school_students.status` tracks active, pending, withdrawn, or promoted records.
- `school_students.created_at` records when the record was added.
- `school_attendance.id`, `student_id`, `attendance_date`, `status`, and `note` describe daily attendance.

3. Security
- Row level security is enabled on both tables.
- This is a single-school workspace without a sign-in screen, so the anon and authenticated roles receive only the CRUD access needed by the app through explicit policies.

4. Important Notes
- Attendance is protected from duplicate entries per student and day with a unique constraint.
- Starter records make the dashboard useful immediately and can be replaced by real school data through the app.
*/

CREATE TABLE IF NOT EXISTS public.school_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_number text UNIQUE NOT NULL,
  full_name text NOT NULL,
  gender text NOT NULL DEFAULT 'Other',
  date_of_birth date,
  class_name text NOT NULL,
  section_name text NOT NULL,
  guardian_name text NOT NULL,
  guardian_phone text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'withdrawn', 'promoted')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.school_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  attendance_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, attendance_date)
);

ALTER TABLE public.school_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_attendance ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_students TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_attendance TO anon, authenticated;

DROP POLICY IF EXISTS "School workspace can read students" ON public.school_students;
CREATE POLICY "School workspace can read students" ON public.school_students FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "School workspace can add students" ON public.school_students;
CREATE POLICY "School workspace can add students" ON public.school_students FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "School workspace can update students" ON public.school_students;
CREATE POLICY "School workspace can update students" ON public.school_students FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "School workspace can remove students" ON public.school_students;
CREATE POLICY "School workspace can remove students" ON public.school_students FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "School workspace can read attendance" ON public.school_attendance;
CREATE POLICY "School workspace can read attendance" ON public.school_attendance FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "School workspace can add attendance" ON public.school_attendance;
CREATE POLICY "School workspace can add attendance" ON public.school_attendance FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "School workspace can update attendance" ON public.school_attendance;
CREATE POLICY "School workspace can update attendance" ON public.school_attendance FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "School workspace can remove attendance" ON public.school_attendance;
CREATE POLICY "School workspace can remove attendance" ON public.school_attendance FOR DELETE TO anon, authenticated USING (true);

INSERT INTO public.school_students (admission_number, full_name, gender, date_of_birth, class_name, section_name, guardian_name, guardian_phone)
VALUES
  ('SD-2401', 'Aarav Mehta', 'Boy', '2014-06-18', 'Class 5', 'B', 'Nisha Mehta', '+91 98765 10001'),
  ('SD-2402', 'Anaya Shah', 'Girl', '2014-09-02', 'Class 5', 'B', 'Rohan Shah', '+91 98765 10002'),
  ('SD-2403', 'Kabir Rao', 'Boy', '2014-02-11', 'Class 5', 'B', 'Meera Rao', '+91 98765 10003'),
  ('SD-2404', 'Myra Iyer', 'Girl', '2014-12-22', 'Class 5', 'B', 'Dev Iyer', '+91 98765 10004'),
  ('SD-2405', 'Vihaan Kapoor', 'Boy', '2014-04-09', 'Class 5', 'B', 'Tara Kapoor', '+91 98765 10005'),
  ('SD-2406', 'Zoya Khan', 'Girl', '2014-08-25', 'Class 5', 'B', 'Sameer Khan', '+91 98765 10006'),
  ('SD-2407', 'Arjun Nair', 'Boy', '2014-01-30', 'Class 5', 'B', 'Priya Nair', '+91 98765 10007'),
  ('SD-2408', 'Ishita Menon', 'Girl', '2014-07-14', 'Class 5', 'B', 'Kiran Menon', '+91 98765 10008'),
  ('SD-2409', 'Reyansh Bose', 'Boy', '2014-03-19', 'Class 5', 'B', 'Sonia Bose', '+91 98765 10009'),
  ('SD-2410', 'Sara Joseph', 'Girl', '2014-11-06', 'Class 5', 'B', 'Amit Joseph', '+91 98765 10010'),
  ('SD-2411', 'Aditi Verma', 'Girl', '2014-05-28', 'Class 5', 'B', 'Neeraj Verma', '+91 98765 10011'),
  ('SD-2412', 'Dhruv Patel', 'Boy', '2014-10-17', 'Class 5', 'B', 'Kavita Patel', '+91 98765 10012'),
  ('SD-2413', 'Riya Das', 'Girl', '2014-01-12', 'Class 5', 'B', 'Anil Das', '+91 98765 10013'),
  ('SD-2414', 'Neil Fernandes', 'Boy', '2014-06-01', 'Class 5', 'B', 'Maya Fernandes', '+91 98765 10014')
ON CONFLICT (admission_number) DO NOTHING;

INSERT INTO public.school_attendance (student_id, attendance_date, status)
SELECT id, CURRENT_DATE,
  CASE
    WHEN admission_number IN ('SD-2401','SD-2402','SD-2403','SD-2404','SD-2405','SD-2406','SD-2407','SD-2408','SD-2409','SD-2410','SD-2411') THEN 'present'
    WHEN admission_number IN ('SD-2412','SD-2413','SD-2414') THEN 'absent'
    ELSE 'late'
  END
FROM public.school_students
WHERE class_name = 'Class 5' AND section_name = 'B'
ON CONFLICT (student_id, attendance_date) DO NOTHING;
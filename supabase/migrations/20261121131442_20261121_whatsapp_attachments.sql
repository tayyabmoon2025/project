/*
# WhatsApp absentee alerts — optional attachments

## 1. Purpose
Let the office attach one optional file (JPEG, PNG, PDF or Word document) to an
absentee WhatsApp alert. The file is uploaded to a private storage bucket, and its
shareable link is appended to the WhatsApp message text and also stored on the
parent portal absence notice, so parents can open the same document from the portal.

## 2. New Columns (all nullable, no existing data is touched)
- `school_absentee_queue.attachment_url` (text) — the shareable link to the uploaded file.
- `school_absentee_queue.attachment_name` (text) — the original file name, shown in the queue.
- `school_sms_log.attachment_url` (text) — same link, recorded on the WhatsApp SMS Report row.
- `school_sms_log.attachment_name` (text) — original file name on the report row.
- `school_portal_notifications.attachment_url` (text) — link shown with the portal notice.

## 3. Modified Behaviour
- The `notify_parent_of_absence()` trigger is replaced so a notice raised when an
  absentee row is added also carries that row's attachment link. Existing notices
  are untouched; only new inserts are affected.

## 4. New Storage Bucket
- `whatsapp-attachments` — PRIVATE bucket, 10 MB per file limit, restricted to
  image/jpeg, image/png, application/pdf and the Word document MIME types.
- Staff upload into a folder named after their own account id, so one account can
  never write over another account's file.
- Reads are signed, short-lived links created by the signed-in staff member; there
  is no public/anonymous read path.

## 5. Security
- RLS is already enabled on all three tables; no policy or grant is loosened here.
- The new columns inherit the existing table policies and grants.
- Storage: RLS enabled on `storage.objects` policies for this bucket, split into
  separate INSERT, SELECT, UPDATE and DELETE policies, all scoped TO authenticated
  and to the caller's own folder.
- `notify_parent_of_absence()` keeps its SECURITY DEFINER definition, its fixed
  search_path, and its EXECUTE revocation from PUBLIC, anon and authenticated.
*/

-- 1. Attachment columns -------------------------------------------------------
ALTER TABLE public.school_absentee_queue
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_name text;

ALTER TABLE public.school_sms_log
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_name text;

ALTER TABLE public.school_portal_notifications
  ADD COLUMN IF NOT EXISTS attachment_url text;

-- 2. Portal notice carries the attachment link ---------------------------------
CREATE OR REPLACE FUNCTION public.notify_parent_of_absence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.school_portal_notifications (
    student_id, notification_type, title, body, attendance_date, attachment_url, created_by
  )
  VALUES (
    NEW.student_id,
    'absence',
    'Absence recorded',
    format(
      '%s of %s was marked absent on %s.%s',
      NEW.student_name,
      coalesce(nullif(trim(NEW.class_name || ' · Section ' || coalesce(NEW.section_name, '')), ' · Section '), 'the school'),
      to_char(NEW.attendance_date, 'DD Mon YYYY'),
      CASE WHEN NEW.message_body IS NULL OR btrim(NEW.message_body) = '' THEN '' ELSE ' ' || NEW.message_body END
    ),
    NEW.attendance_date,
    NEW.attachment_url,
    NEW.created_by
  )
  ON CONFLICT (student_id, notification_type, attendance_date) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS school_absentee_queue_notify_parent ON public.school_absentee_queue;
CREATE TRIGGER school_absentee_queue_notify_parent
AFTER INSERT ON public.school_absentee_queue
FOR EACH ROW EXECUTE FUNCTION public.notify_parent_of_absence();

REVOKE EXECUTE ON FUNCTION public.notify_parent_of_absence() FROM PUBLIC, anon, authenticated;

-- 3. Private storage bucket for alert attachments ------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'whatsapp-attachments',
  'whatsapp-attachments',
  false,
  10485760,
  ARRAY[
    'image/jpeg',
    'image/png',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "whatsapp_attachments_insert_own_folder" ON storage.objects;
CREATE POLICY "whatsapp_attachments_insert_own_folder" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'whatsapp-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "whatsapp_attachments_select_own_folder" ON storage.objects;
CREATE POLICY "whatsapp_attachments_select_own_folder" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'whatsapp-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "whatsapp_attachments_update_own_folder" ON storage.objects;
CREATE POLICY "whatsapp_attachments_update_own_folder" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'whatsapp-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'whatsapp-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "whatsapp_attachments_delete_own_folder" ON storage.objects;
CREATE POLICY "whatsapp_attachments_delete_own_folder" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'whatsapp-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

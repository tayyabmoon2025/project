import { useEffect, useMemo, useState } from 'react';
import { FileBadge2, Loader as Loader2, Lock, Printer } from 'lucide-react';
import { StudentCertificatePreviewModal } from '@/components/StudentCertificatePreviewModal';
import {
  fetchReleasedCertificatesFor,
  certificateTypeLabel,
  shortDate,
  type StudentCertificate,
} from '@/lib/studentCertificates';

// The certificates a family can see. The database only ever returns certificates an
// administrator has released, so nothing awaiting approval can appear here even if this
// screen were asked for it directly.
export function StudentPortalCertificates({ studentIds, studentNames = {}, onToast }: {
  studentIds: string[];
  studentNames?: Record<string, string>;
  onToast: (message: string) => void;
}) {
  const [certificates, setCertificates] = useState<StudentCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<StudentCertificate | null>(null);

  // The list of children is rebuilt on every render, so it is keyed by value rather than
  // by identity to stop the read repeating.
  const key = useMemo(() => [...studentIds].sort().join(','), [studentIds]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      const rows = await fetchReleasedCertificatesFor(key ? key.split(',') : []);
      if (!active) return;
      setCertificates(rows);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [key]);

  return (
    <section className="panel portal-cert-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Certificates</span>
          <h2>Certificates from the school</h2>
          <p className="panel-subtitle">
            Leaving, birth, character, bonafide and award certificates appear here once the school office has released
            them. You can open one, read it, and print or save a copy.
          </p>
        </div>
        <FileBadge2 size={20} />
      </div>

      {loading ? (
        <p className="empty-state"><Loader2 size={16} className="auth-spinner" /> Checking for certificates…</p>
      ) : certificates.length === 0 ? (
        <p className="empty-state">
          <Lock size={14} /> No certificates have been released to your account yet. A certificate appears here only
          after the school office issues it and an administrator approves it.
        </p>
      ) : (
        <ul className="portal-cert-list">
          {certificates.map((record) => (
            <li className="portal-cert-row" key={record.id}>
              <span className="portal-cert-icon"><FileBadge2 size={16} /></span>
              <div className="portal-cert-copy">
                <strong>{record.title || certificateTypeLabel(record.certificate_type)}</strong>
                <small>
                  {record.certificate_number ?? '—'} · issued {shortDate(record.issued_on)}
                </small>
              </div>
              <button type="button" className="secondary-button" onClick={() => setPreview(record)}>
                <Printer size={15} /> View &amp; print
              </button>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <StudentCertificatePreviewModal
          record={preview}
          studentName={preview.student_name ?? studentNames[preview.student_id] ?? 'Student'}
          showWhatsApp={false}
          onClose={() => setPreview(null)}
          onToast={onToast}
        />
      )}
    </section>
  );
}

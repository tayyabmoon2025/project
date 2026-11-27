import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { getCachedSchoolLogo } from '@/lib/schoolLogo';
import { SchoolLogo } from '@/components/SchoolLogo';
import {
  DoorOpen,
  Search,
  Phone,
  UserCheck,
  Printer,
  X,
  Check,
  Clock,
  Hash,
  AlertCircle,
  Camera,
  Trash2,
  Image as ImageIcon,
  Images,
  ChevronLeft,
  Loader2,
  CalendarDays,
  ClipboardList,
} from 'lucide-react';
import { SCHOOL_NAME } from '@/lib/noticeText';
import { WEEKDAY_LABELS } from '@/lib/attendance';
import { useAuth } from '@/lib/auth';
import type { Student } from '@/lib/schoolTypes';
import {
  createHalfDayLeave,
  fetchRecentHalfDayLeaves,
  fetchHalfDayPhotos,
  fetchHalfDayLeavesByDate,
  sendHalfDaySmsPlaceholder,
  uploadReceiverPhoto,
  compressPhotoToBlob,
  type HalfDayLeave,
  type HalfDayPhoto,
  type RequestMode,
} from '@/lib/halfDayLeaves';

type Props = {
  students: Student[];
  onToast: (message: string) => void;
};

type Tab = 'issue' | 'gallery' | 'passes';

export function HalfDayGatePass({ students, onToast }: Props) {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>('issue');
  const [search, setSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [requestMode, setRequestMode] = useState<RequestMode>('In-Person');
  const [receiverName, setReceiverName] = useState('');
  const [receiverCnic, setReceiverCnic] = useState('');
  const [reason, setReason] = useState('');
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [issuedPass, setIssuedPass] = useState<HalfDayLeave | null>(null);
  const [recentPasses, setRecentPasses] = useState<HalfDayLeave[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [photos, setPhotos] = useState<HalfDayPhoto[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<HalfDayPhoto | null>(null);
  const [passesDate, setPassesDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [passesList, setPassesList] = useState<HalfDayLeave[]>([]);
  const [loadingPasses, setLoadingPasses] = useState(false);
  const [passesError, setPassesError] = useState<string | null>(null);
  const [passesSearch, setPassesSearch] = useState('');
  const [printPass, setPrintPass] = useState<HalfDayLeave | null>(null);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter((s) => s.status === 'active')
      .filter((s) =>
        `${s.full_name} ${s.admission_number} ${s.class_name} ${s.section_name}`
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 8);
  }, [students, search]);

  const loadRecent = async () => {
    setLoadingRecent(true);
    const { leaves, error } = await fetchRecentHalfDayLeaves(10);
    if (error) { onToast(error); }
    setRecentPasses(leaves);
    setLoadingRecent(false);
  };

  const loadPhotos = async () => {
    setLoadingPhotos(true);
    setPhotoError(null);
    const { photos: rows, error } = await fetchHalfDayPhotos(60);
    if (error) { setPhotoError(error); }
    setPhotos(rows);
    setLoadingPhotos(false);
  };

  useEffect(() => { void loadRecent(); }, []);
  useEffect(() => { if (tab === 'gallery') void loadPhotos(); }, [tab]);
  useEffect(() => { if (tab === 'passes') void loadPasses(); }, [tab, passesDate]);

  const loadPasses = async () => {
    setLoadingPasses(true);
    setPassesError(null);
    const { leaves, error } = await fetchHalfDayLeavesByDate(passesDate);
    if (error) { setPassesError(error); }
    setPassesList(leaves);
    setLoadingPasses(false);
  };

  const filteredPasses = useMemo(() => {
    const q = passesSearch.trim().toLowerCase();
    if (!q) return passesList;
    return passesList.filter((p) =>
      `${p.student_name} ${p.gate_pass_id} ${p.receiver_name} ${p.receiver_cnic} ${p.class_name ?? ''} ${p.section_name ?? ''}`
        .toLowerCase().includes(q),
    );
  }, [passesList, passesSearch]);

  const handlePrintFromList = (leave: HalfDayLeave) => {
    setPrintPass(leave);
  };

  const resetForm = () => {
    setSelectedStudent(null);
    setSearch('');
    setRequestMode('In-Person');
    setReceiverName('');
    setReceiverCnic('');
    setReason('');
    setPhotoPreview(null);
    setPhotoUrl(null);
    setSubmitError(null);
  };

  const handlePhotoFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { onToast('Please choose an image file.'); return; }
    setUploadingPhoto(true);
    try {
      const compressed = await compressPhotoToBlob(file, 1024);
      const previewUrl = URL.createObjectURL(compressed);
      setPhotoPreview(previewUrl);
      const uploadFile = new File([compressed], file.name || 'receiver-photo.jpg', { type: 'image/jpeg' });
      const result = await uploadReceiverPhoto(uploadFile);
      if (result.error) { onToast(result.error); setPhotoPreview(null); }
      else { setPhotoUrl(result.url); }
    } catch {
      onToast('Could not process that photo. Please try another.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const removePhoto = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    setPhotoUrl(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!selectedStudent) {
      setSubmitError('Search and select a student first.');
      onToast('Search and select a student first');
      return;
    }
    if (!receiverName.trim() || !receiverCnic.trim() || !reason.trim()) {
      setSubmitError('Receiver name, CNIC, and reason are all required.');
      onToast('Receiver name, CNIC, and reason are all required');
      return;
    }
    if (uploadingPhoto) {
      setSubmitError('Please wait for the photo to finish uploading.');
      onToast('Please wait for the photo to finish uploading');
      return;
    }
    setSubmitting(true);
    try {
      const result = await createHalfDayLeave({
        student_id: selectedStudent.id,
        request_mode: requestMode,
        receiver_name: receiverName.trim(),
        receiver_cnic: receiverCnic.trim(),
        reason: reason.trim(),
        approved_by: profile?.full_name ?? 'Unknown',
        receiver_photo_url: photoUrl,
      });
      if (!result.ok || !result.leave) {
        const msg = result.error ?? 'Could not issue gate pass. Please try again.';
        setSubmitError(msg);
        onToast(msg);
        return;
      }
      const fullLeave: HalfDayLeave = {
        ...result.leave,
        student_name: selectedStudent.full_name,
        class_name: selectedStudent.class_name,
        section_name: selectedStudent.section_name,
      };
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setIssuedPass(fullLeave);
      onToast(`Gate pass ${fullLeave.gate_pass_id} issued — attendance marked Half-Day`);
      void sendHalfDaySmsPlaceholder(fullLeave);
      void loadRecent();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred while issuing the gate pass.';
      setSubmitError(msg);
      onToast(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page module-page">
      <div className="module-heading">
        <div>
          <span className="eyebrow">Gate pass</span>
          <h1>Half-Day Gate Pass</h1>
          <p>Issue a gate pass when a student leaves school early. Today's attendance is updated to Half-Day automatically.</p>
        </div>
      </div>

      <div className="half-day-tabs">
        <button className={tab === 'issue' ? 'active' : ''} onClick={() => setTab('issue')}>
          <DoorOpen size={16} /> Issue Gate Pass
        </button>
        <button className={tab === 'gallery' ? 'active' : ''} onClick={() => setTab('gallery')}>
          <Images size={16} /> Photo Gallery
        </button>
        <button className={tab === 'passes' ? 'active' : ''} onClick={() => setTab('passes')}>
          <ClipboardList size={16} /> Issued Passes
        </button>
      </div>

      {tab === 'issue' && (
        <div className="half-day-layout">
          <form className="panel half-day-form" onSubmit={handleSubmit}>
            {submitError && (
              <div className="half-day-error-banner">
                <AlertCircle size={16} />
                <span>{submitError}</span>
                <button type="button" onClick={() => setSubmitError(null)}><X size={14} /></button>
              </div>
            )}

            <div className="half-day-form-section">
              <label className="control-field">
                <span>Search student</span>
                <div className="search-field">
                  <Search size={18} />
                  <input
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setSelectedStudent(null); }}
                    placeholder="Name, admission number, or class"
                    autoFocus
                  />
                </div>
              </label>

              {search && !selectedStudent && (
                <div className="half-day-results">
                  {results.length === 0 ? (
                    <p className="empty-state">No students found.</p>
                  ) : (
                    results.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="half-day-result-row"
                        onClick={() => { setSelectedStudent(s); setSearch(s.full_name); }}
                      >
                        <strong>{s.full_name}</strong>
                        <span>{s.admission_number} · {s.class_name} · {s.section_name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}

              {selectedStudent && (
                <div className="half-day-selected">
                  <Check size={16} />
                  <div>
                    <strong>{selectedStudent.full_name}</strong>
                    <span>{selectedStudent.class_name} · {selectedStudent.section_name} · {selectedStudent.admission_number}</span>
                  </div>
                  <button type="button" className="text-button" onClick={() => { setSelectedStudent(null); setSearch(''); }}>Change</button>
                </div>
              )}
            </div>

            <div className="half-day-form-section">
              <label className="control-field">
                <span>Request mode</span>
                <div className="half-day-mode-toggle">
                  <button
                    type="button"
                    className={requestMode === 'In-Person' ? 'active' : ''}
                    onClick={() => setRequestMode('In-Person')}
                  >
                    <UserCheck size={16} /> In-Person
                  </button>
                  <button
                    type="button"
                    className={requestMode === 'Phone Call' ? 'active' : ''}
                    onClick={() => setRequestMode('Phone Call')}
                  >
                    <Phone size={16} /> Phone Call
                  </button>
                </div>
              </label>

              <label className="control-field">
                <span>Receiver name</span>
                <input
                  value={receiverName}
                  onChange={(e) => setReceiverName(e.target.value)}
                  placeholder="Person picking up the student"
                  required
                />
              </label>

              <label className="control-field">
                <span>Receiver CNIC</span>
                <input
                  value={receiverCnic}
                  onChange={(e) => setReceiverCnic(e.target.value)}
                  placeholder="00000-0000000-0"
                  required
                />
              </label>

              <label className="control-field full">
                <span>Reason</span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason for early departure"
                  rows={3}
                  required
                />
              </label>

              <div className="half-day-photo-field">
                <span className="control-field-label">Receiver photo (optional)</span>
                <div className="half-day-photo-area">
                  {photoPreview ? (
                    <div className="half-day-photo-preview">
                      <img src={photoPreview} alt="Receiver" />
                      <button type="button" className="half-day-photo-remove" onClick={removePhoto} disabled={uploadingPhoto}>
                        <Trash2 size={14} /> Remove
                      </button>
                    </div>
                  ) : (
                    <div className="half-day-photo-buttons">
                      <button type="button" className="secondary-button" onClick={() => cameraInputRef.current?.click()} disabled={uploadingPhoto || submitting}>
                        <Camera size={16} /> {uploadingPhoto ? 'Uploading…' : 'Take photo'}
                      </button>
                      <button type="button" className="secondary-button" onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto || submitting}>
                        <ImageIcon size={16} /> Choose file
                      </button>
                    </div>
                  )}
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    onChange={(e) => { void handlePhotoFile(e.target.files?.[0]); e.target.value = ''; }}
                  />
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => { void handlePhotoFile(e.target.files?.[0]); e.target.value = ''; }}
                  />
                </div>
              </div>
            </div>

            <div className="half-day-form-actions">
              <button type="button" className="text-button" onClick={resetForm}>Clear</button>
              <button type="submit" className="primary-button" disabled={submitting || !selectedStudent || uploadingPhoto}>
                {submitting ? <><Loader2 size={18} className="spin" /> Issuing…</> : <><DoorOpen size={18} /> Issue Gate Pass</>}
              </button>
            </div>
          </form>

          <div className="panel half-day-recent">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Today's log</span>
                <h2>Recent gate passes</h2>
              </div>
            </div>
            {loadingRecent ? (
              <p className="empty-state">Loading…</p>
            ) : recentPasses.length === 0 ? (
              <p className="empty-state">No gate passes issued yet today.</p>
            ) : (
              <div className="half-day-recent-list">
                {recentPasses.map((pass) => (
                  <div key={pass.id} className="half-day-recent-row">
                    <div className="half-day-recent-id">
                      <Hash size={14} />
                      <strong>{pass.gate_pass_id}</strong>
                    </div>
                    <div>
                      <strong>{pass.receiver_name}</strong>
                      <span>{pass.request_mode} · {pass.reason}</span>
                    </div>
                    <span className="half-day-time">
                      <Clock size={13} />
                      {new Date(pass.exit_time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'gallery' && (
        <div className="panel half-day-gallery">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Captured photos</span>
              <h2>Receiver &amp; ID card gallery</h2>
            </div>
            <button className="secondary-button" onClick={() => void loadPhotos()} disabled={loadingPhotos}>
              {loadingPhotos ? <Loader2 size={15} className="spin" /> : <ImageIcon size={15} />} Refresh
            </button>
          </div>
          {photoError && (
            <div className="half-day-error-banner">
              <AlertCircle size={16} />
              <span>{photoError}</span>
            </div>
          )}
          {loadingPhotos ? (
            <div className="half-day-gallery-loading">
              <Loader2 size={28} className="spin" />
              <span>Loading photos…</span>
            </div>
          ) : photos.length === 0 ? (
            <div className="empty-state large">
              <Images size={28} />
              <p>No receiver photos have been captured yet.</p>
              <span>Photos taken during gate pass issuance will appear here.</span>
            </div>
          ) : (
            <div className="half-day-gallery-grid">
              {photos.map((photo) => (
                <button
                  key={photo.id}
                  className="half-day-gallery-item"
                  onClick={() => setLightboxPhoto(photo)}
                >
                  <img src={photo.receiver_photo_url ?? ''} alt={photo.student_name} loading="lazy" />
                  <div className="half-day-gallery-overlay">
                    <strong>{photo.student_name}</strong>
                    <span>{photo.gate_pass_id} · {new Date(photo.exit_time).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                    <small>{photo.receiver_name}</small>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'passes' && (
        <div className="panel half-day-passes">
          <div className="panel-header">
            <div>
              <span className="eyebrow">All gate passes</span>
              <h2>Issued Gate Passes</h2>
            </div>
            <div className="half-day-passes-controls">
              <div className="search-field">
                <Search size={16} />
                <input
                  value={passesSearch}
                  onChange={(e) => setPassesSearch(e.target.value)}
                  placeholder="Search by student, pass ID, receiver…"
                />
              </div>
              <label className="half-day-date-field">
                <CalendarDays size={16} />
                <input
                  type="date"
                  value={passesDate}
                  onChange={(e) => { setPassesDate(e.target.value); }}
                />
              </label>
              <button className="secondary-button" onClick={() => void loadPasses()} disabled={loadingPasses}>
                {loadingPasses ? <Loader2 size={15} className="spin" /> : <ImageIcon size={15} />} Load
              </button>
            </div>
          </div>
          {passesError && (
            <div className="half-day-error-banner">
              <AlertCircle size={16} />
              <span>{passesError}</span>
            </div>
          )}
          {loadingPasses ? (
            <div className="half-day-gallery-loading">
              <Loader2 size={28} className="spin" />
              <span>Loading gate passes…</span>
            </div>
          ) : filteredPasses.length === 0 ? (
            <div className="empty-state large">
              <ClipboardList size={28} />
              <p>No gate passes found for {new Date(passesDate + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.</p>
              <span>Pick a different date or issue a new gate pass.</span>
            </div>
          ) : (
            <div className="half-day-passes-table">
              <div className="half-day-passes-thead">
                <span>Gate Pass</span>
                <span>Student</span>
                <span>Class</span>
                <span>Exit Time</span>
                <span>Mode</span>
                <span>Receiver</span>
                <span>CNIC</span>
                <span>Photo</span>
                <span></span>
              </div>
              {filteredPasses.map((pass) => (
                <div key={pass.id} className="half-day-passes-trow">
                  <span className="half-day-passes-id"><Hash size={12} />{pass.gate_pass_id}</span>
                  <span className="half-day-passes-name">{pass.student_name}</span>
                  <span>{pass.class_name ?? '—'}{pass.section_name ? ` · ${pass.section_name}` : ''}</span>
                  <span className="half-day-passes-time"><Clock size={12} />{new Date(pass.exit_time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                  <span>{pass.request_mode}</span>
                  <span>{pass.receiver_name}</span>
                  <span className="half-day-passes-cnic">{pass.receiver_cnic}</span>
                  <span className="half-day-passes-thumb">
                    {pass.receiver_photo_url
                      ? <img src={pass.receiver_photo_url} alt="Receiver" />
                      : <span className="half-day-passes-no-photo"><ImageIcon size={14} /></span>}
                  </span>
                  <button className="secondary-button half-day-print-btn" onClick={() => handlePrintFromList(pass)}>
                    <Printer size={14} /> Print
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {issuedPass && (
        <GatePassModal
          leave={issuedPass}
          onClose={() => { setIssuedPass(null); resetForm(); }}
        />
      )}

      {printPass && !issuedPass && (
        <GatePassModal
          leave={printPass}
          onClose={() => setPrintPass(null)}
          autoPrint
        />
      )}

      {lightboxPhoto && (
        <PhotoLightbox photo={lightboxPhoto} onClose={() => setLightboxPhoto(null)} />
      )}
    </div>
  );
}

function PhotoLightbox({ photo, onClose }: { photo: HalfDayPhoto; onClose: () => void }) {
  return (
    <div className="notice-overlay" onClick={onClose}>
      <div className="notice-modal gate-pass-lightbox" onClick={(e) => e.stopPropagation()}>
        <button className="icon-button gate-pass-lightbox-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        <div className="gate-pass-lightbox-img">
          <img src={photo.receiver_photo_url ?? ''} alt={photo.student_name} />
        </div>
        <div className="gate-pass-lightbox-info">
          <div className="gate-pass-lightbox-back" onClick={onClose}>
            <ChevronLeft size={16} /> Back to gallery
          </div>
          <h3>{photo.student_name}</h3>
          <div className="gate-pass-lightbox-details">
            <div><span>Gate Pass</span><strong>{photo.gate_pass_id}</strong></div>
            <div><span>Receiver</span><strong>{photo.receiver_name}</strong></div>
            <div><span>CNIC</span><strong>{photo.receiver_cnic}</strong></div>
            <div><span>Date</span><strong>{new Date(photo.exit_time).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</strong></div>
            <div><span>Time</span><strong>{new Date(photo.exit_time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })}</strong></div>
            <div><span>Mode</span><strong>{photo.request_mode}</strong></div>
            <div><span>Reason</span><strong>{photo.reason}</strong></div>
            <div><span>Approved By</span><strong>{photo.approved_by}</strong></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GatePassModal({ leave, onClose, autoPrint }: { leave: HalfDayLeave; onClose: () => void; autoPrint?: boolean }) {
  const handlePrint = () => { printGatePassSlip(leave); };

  useEffect(() => {
    if (autoPrint) {
      const timer = setTimeout(() => { printGatePassSlip(leave); }, 300);
      return () => clearTimeout(timer);
    }
  }, [autoPrint, leave]);

  return (
    <div className="notice-overlay" onClick={onClose}>
      <div className="notice-modal gate-pass-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gate-pass-modal-header">
          <div>
            <span className="eyebrow">Gate pass issued</span>
            <h2>Print the gate pass slip</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="gate-pass-preview">
          <GatePassSlip leave={leave} />
        </div>
        <div className="gate-pass-modal-actions">
          <span className="gate-pass-info">
            <AlertCircle size={14} />
            Attendance updated to Half-Day · Parent notified via portal
          </span>
          <button className="primary-button" onClick={handlePrint}>
            <Printer size={17} /> Print Slip
          </button>
        </div>
      </div>
    </div>
  );
}

function printGatePassSlip(leave: HalfDayLeave): void {
  const exitDate = new Date(leave.exit_time);
  const dayName = WEEKDAY_LABELS[exitDate.getDay()];
  const dateStr = exitDate.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = exitDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  const photoHtml = leave.receiver_photo_url
    ? `<div class="gp-photo"><img src="${leave.receiver_photo_url}" alt="Receiver" /></div>`
    : '';
  const logoUrl = getCachedSchoolLogo();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Gate Pass ${leave.gate_pass_id}</title>
<style>
  @page { size: A5 portrait; margin: 8mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', 'Segoe UI', sans-serif; background: #fff; color: #1a1a1a; display: flex; justify-content: center; padding: 0; }
  .gate-pass-slip { width: 100%; max-width: 128mm; padding: 6mm; background: #fff; color: #1a1a1a; }
  .gp-head { display: flex; align-items: center; gap: 8px; }
  .gp-head img { width: 32px; height: 32px; object-fit: contain; }
  .gp-head strong { display: block; font-size: 13px; color: #1e293b; }
  .gp-head span { display: block; font-size: 9px; color: #64748b; letter-spacing: .8px; text-transform: uppercase; }
  .gp-id { display: flex; align-items: center; gap: 4px; margin-top: 8px; font-size: 12px; color: #38bdf8; font-weight: 700; }
  .gp-divider { border-top: 1px dashed #cbd5e1; margin: 10px 0; }
  .gp-fields { display: flex; flex-direction: column; gap: 5px; }
  .gp-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; font-size: 11px; }
  .gp-row span { color: #64748b; white-space: nowrap; }
  .gp-row strong { color: #1e293b; text-align: right; }
  .gp-photo { margin: 8px 0; text-align: center; }
  .gp-photo img { width: 100px; height: 100px; object-fit: cover; border-radius: 6px; border: 1px solid #cbd5e1; }
  .gp-sign { margin-top: 16px; text-align: center; }
  .gp-sign-line { border-top: 1px solid #94a3b8; width: 150px; margin: 0 auto 5px; }
  .gp-sign span { font-size: 9px; color: #64748b; }
  .gp-foot { margin-top: 10px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 8px; color: #94a3b8; text-align: center; line-height: 1.4; }
</style>
</head>
<body>
  <div class="gate-pass-slip">
    <div class="gp-head">
      <img id="gp-logo" src="${logoUrl}" alt="School" />
      <div><strong>${SCHOOL_NAME}</strong><span>Half-Day Gate Pass</span></div>
    </div>
    <div class="gp-id"><strong>${leave.gate_pass_id}</strong></div>
    <div class="gp-divider"></div>
    <div class="gp-fields">
      <div class="gp-row"><span>Student Name</span><strong>${escapeHtml(leave.student_name)}</strong></div>
      <div class="gp-row"><span>Class</span><strong>${escapeHtml(leave.class_name ?? '')} &mdash; ${escapeHtml(leave.section_name ?? '')}</strong></div>
      <div class="gp-row"><span>Date</span><strong>${dateStr}</strong></div>
      <div class="gp-row"><span>Day</span><strong>${dayName}</strong></div>
      <div class="gp-row"><span>Exit Time</span><strong>${timeStr}</strong></div>
      <div class="gp-divider"></div>
      <div class="gp-row"><span>Receiver Name</span><strong>${escapeHtml(leave.receiver_name)}</strong></div>
      <div class="gp-row"><span>Receiver CNIC</span><strong>${escapeHtml(leave.receiver_cnic)}</strong></div>
      <div class="gp-row"><span>Request Mode</span><strong>${escapeHtml(leave.request_mode)}</strong></div>
      <div class="gp-row"><span>Reason</span><strong>${escapeHtml(leave.reason)}</strong></div>
    </div>
    ${photoHtml}
    <div class="gp-divider"></div>
    <div class="gp-sign">
      <div class="gp-sign-line"></div>
      <span>Approved By: ${escapeHtml(leave.approved_by)}</span>
    </div>
    <p class="gp-foot">This gate pass must be presented at the school gate at the time of pickup.</p>
  </div>
</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:160mm;height:120mm;border:none;';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }
  doc.open();
  doc.write(html);
  doc.close();

  let printed = false;
  const triggerPrint = () => {
    if (printed) return;
    printed = true;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch { /* browser blocked print */ }
    setTimeout(() => { document.body.removeChild(iframe); }, 2000);
  };

  const logoImg = doc.getElementById('gp-logo');
  if (logoImg) {
    logoImg.onload = triggerPrint;
    logoImg.onerror = triggerPrint;
  }
  setTimeout(triggerPrint, 1500);
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function GatePassSlip({ leave }: { leave: HalfDayLeave }) {
  const exitDate = new Date(leave.exit_time);
  const dayName = WEEKDAY_LABELS[exitDate.getDay()];
  const dateStr = exitDate.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = exitDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <div className="gate-pass-slip">
      <div className="gp-head">
        <SchoolLogo alt="School" />
        <div>
          <strong>{SCHOOL_NAME}</strong>
          <span>Half-Day Gate Pass</span>
        </div>
      </div>
      <div className="gp-id">
        <Hash size={12} />
        <strong>{leave.gate_pass_id}</strong>
      </div>
      <div className="gp-divider" />
      <div className="gp-fields">
        <div className="gp-row"><span>Student Name</span><strong>{leave.student_name}</strong></div>
        <div className="gp-row"><span>Class</span><strong>{leave.class_name} — {leave.section_name}</strong></div>
        <div className="gp-row"><span>Date</span><strong>{dateStr}</strong></div>
        <div className="gp-row"><span>Day</span><strong>{dayName}</strong></div>
        <div className="gp-row"><span>Exit Time</span><strong>{timeStr}</strong></div>
        <div className="gp-divider" />
        <div className="gp-row"><span>Receiver Name</span><strong>{leave.receiver_name}</strong></div>
        <div className="gp-row"><span>Receiver CNIC</span><strong>{leave.receiver_cnic}</strong></div>
        <div className="gp-row"><span>Request Mode</span><strong>{leave.request_mode}</strong></div>
        <div className="gp-row gp-reason"><span>Reason</span><strong>{leave.reason}</strong></div>
      </div>
      {leave.receiver_photo_url && (
        <div className="gp-photo">
          <img src={leave.receiver_photo_url} alt="Receiver" />
        </div>
      )}
      <div className="gp-divider" />
      <div className="gp-sign">
        <div className="gp-sign-line" />
        <span>Approved By: {leave.approved_by}</span>
      </div>
      <p className="gp-foot">This gate pass must be presented at the school gate at the time of pickup.</p>
    </div>
  );
}

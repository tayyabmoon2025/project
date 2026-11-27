import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleAlert as AlertCircle, Briefcase, CalendarDays, CreditCard, Download, Info, Megaphone, Printer, RefreshCw } from 'lucide-react';
import {
  JOB_STATUS_LABELS,
  fetchUtilityReportData,
  type JobStatus,
  type UtilityReportData,
} from '@/lib/utilityTools';
import {
  fetchUtilityReportBundle,
  type UtilityReportBundle,
  type UtilityReportFilters,
} from '@/lib/utilityReportData';
import {
  UTILITY_REPORT_CARDS,
  UTILITY_REPORT_GROUPS,
  buildUtilityReport,
  utilityReportCsv,
  utilityReportFileName,
  type UtilityReportCard,
  type UtilityReportId,
} from '@/lib/utilityReports';
import { UtilityReportPreview } from '@/components/UtilityReportPreview';
import { downloadCsv } from '@/lib/fees';
import { useClassOptions } from '@/lib/classSections';

const EMPTY_FILTERS: UtilityReportFilters = { className: '', teacherName: '', dateFrom: '', dateTo: '' };

export function UtilityReportsTab({ onToast }: { onToast: (message: string) => void }) {
  const schoolClasses = useClassOptions();
  const [summary, setSummary] = useState<UtilityReportData | null>(null);
  const [bundle, setBundle] = useState<UtilityReportBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<UtilityReportFilters>(EMPTY_FILTERS);
  const [openId, setOpenId] = useState<UtilityReportId | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [summaryR, bundleR] = await Promise.all([fetchUtilityReportData(), fetchUtilityReportBundle()]);
    if (summaryR.data) setSummary(summaryR.data);
    setBundle(bundleR);
    setError(summaryR.error ?? bundleR.error ?? '');
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openCard = useMemo(
    () => UTILITY_REPORT_CARDS.find((card) => card.id === openId) ?? null,
    [openId],
  );

  const model = useMemo(
    () => (openCard && bundle ? buildUtilityReport(openCard.id, bundle, filters) : null),
    [openCard, bundle, filters],
  );

  const exportCsv = (card: UtilityReportCard) => {
    if (!bundle) return;
    const built = buildUtilityReport(card.id, bundle, filters);
    downloadCsv(utilityReportFileName(card.id, built), utilityReportCsv(built));
    onToast('The report was exported as a CSV file.');
  };

  const cards = summary ? [
    { label: 'Visiting Cards', value: summary.totalCards, icon: CreditCard, tone: 'sky' },
    { label: 'Job Applications', value: summary.totalJobs, icon: Briefcase, tone: 'sun' },
    { label: 'Upcoming Events', value: summary.upcomingEvents, icon: CalendarDays, tone: 'mint' },
    { label: 'Active Announcements', value: summary.activeAnnouncements, icon: Megaphone, tone: 'coral' },
    { label: 'Total Events', value: summary.totalEvents, icon: CalendarDays, tone: 'sky' },
    { label: 'Total Holidays', value: summary.totalHolidays, icon: CalendarDays, tone: 'mint' },
  ] : [];

  const jobKeys = Object.keys(JOB_STATUS_LABELS) as JobStatus[];
  // Teachers come from the staff list, but a name typed straight onto a timetable
  // period or a section also has to be filterable, or it could never be reported on.
  const teacherOptions = useMemo(() => Array.from(new Set([
    ...(bundle?.teachers ?? []).map((teacher) => teacher.full_name),
    ...(bundle?.sections ?? []).map((section) => section.class_teacher ?? ''),
    ...(bundle?.periods ?? []).map((period) => period.teacher_name),
  ].map((name) => name.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [bundle]);
  const filterActive = Boolean(filters.className || filters.teacherName || filters.dateFrom || filters.dateTo);

  const filterBar = (
    <div className="report-filter-bar">
      <label className="control-field">Class
        <select value={filters.className} onChange={(event) => setFilters((current) => ({ ...current, className: event.target.value }))}>
          <option value="">All classes</option>
          {schoolClasses.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label className="control-field">Teacher
        <select value={filters.teacherName} onChange={(event) => setFilters((current) => ({ ...current, teacherName: event.target.value }))}>
          <option value="">All teachers</option>
          {teacherOptions.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <label className="control-field">Date from
        <input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} />
      </label>
      <label className="control-field">Date to
        <input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} />
      </label>
      <div className="report-filter-actions">
        <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} /> Refresh data
        </button>
        <button type="button" className="text-button" onClick={() => setFilters(EMPTY_FILTERS)} disabled={!filterActive}>
          Clear filters
        </button>
      </div>
      <span className="report-filter-hint">
        {teacherOptions.length === 0
          ? 'No teacher name is on record yet, so the teacher filter only offers “All teachers”.'
          : 'The class, teacher and date filters apply to every report that uses them.'}
      </span>
    </div>
  );

  return (
    <div className="fee-card util-reports">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">Reports</span>
          <h2>Utility Summary</h2>
        </div>
      </div>

      {error && <div className="fee-alert"><AlertCircle size={16} /><span>{error}</span></div>}

      {loading && !summary && <p className="fee-empty">Loading report…</p>}

      {summary && (
        <div className="fee-kpi-grid">
          {cards.map((item) => (
            <div key={item.label} className={`fee-kpi ${item.tone}`}>
              <span className="fee-kpi-icon"><item.icon size={20} /></span>
              <div>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            </div>
          ))}
        </div>
      )}

      {summary && summary.totalJobs > 0 && (
        <div className="util-report-status-block">
          <div className="fee-card-head">
            <div>
              <span className="eyebrow">Job Applications</span>
              <h2>By Status</h2>
            </div>
          </div>
          <div className="util-report-status-grid">
            {jobKeys.map((key) => (
              <div key={key} className="util-report-status">
                <span>{JOB_STATUS_LABELS[key]}</span>
                <strong>{summary.jobsByStatus[key] ?? 0}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="util-report-desk">
        <header className="util-report-desk-head">
          <div>
            <span className="eyebrow">Printable registers</span>
            <h2>Eleven reports, ready for the printer</h2>
            <p>
              Set the filters, then open a report to check it on screen before printing it on the school letterhead or
              exporting it as a spreadsheet.
            </p>
          </div>
        </header>

        {filterBar}

        {UTILITY_REPORT_GROUPS.map((group) => {
          const groupCards = UTILITY_REPORT_CARDS.filter((card) => card.group === group.id);
          return (
            <section key={group.id} className="exam-report-group">
              <header className="report-category-head">
                <h3>{group.label}</h3>
                <p>{group.hint}</p>
              </header>
              <div className="report-grid">
                {groupCards.map((card) => {
                  const Icon = card.icon;
                  return (
                    <div key={card.id} className="panel report-card report-card-action exam-report-card">
                      <div className="report-card-icon"><Icon size={20} /></div>
                      <div className="report-card-copy">
                        <strong>{card.title}</strong>
                        <p>{card.hint}</p>
                        <span className="exam-report-paper">{card.paper}</span>
                        <div className="exam-marks-actions">
                          <button type="button" className="secondary-button" onClick={() => setOpenId(card.id)} disabled={loading || !bundle}>
                            <Printer size={14} /> Preview &amp; Print A4
                          </button>
                          <button type="button" className="text-button" onClick={() => exportCsv(card)} disabled={loading || !bundle}>
                            <Download size={14} /> Export CSV
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        <p className="cal-hint">
          <Info size={14} />
          The four timetable reports and the subject lists are read from the Timetable tab, the visitor and candidate
          registers from Visiting Cards and Job Applications, and the message log from the SMS and Announcements tools, so
          anything recorded there appears here straight away. A report is never blank by accident: when nothing matches the
          filters the sheet says so on the paper.
        </p>
      </div>

      {openCard && model && (
        <UtilityReportPreview
          card={openCard}
          model={model}
          onClose={() => setOpenId(null)}
          onToast={onToast}
        />
      )}
    </div>
  );
}

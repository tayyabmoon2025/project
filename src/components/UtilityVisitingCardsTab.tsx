import { useMemo, useState } from 'react';
import { CreditCard, Plus, Trash2 } from 'lucide-react';
import {
  CARD_TYPE_LABELS,
  deleteVisitingCard,
  saveVisitingCard,
  type CardType,
  type VisitingCard,
  type VisitingCardDraft,
} from '@/lib/utilityTools';
import { useAuth } from '@/lib/auth';

type Props = {
  cards: VisitingCard[];
  loading: boolean;
  onReload: () => void;
  onToast: (message: string) => void;
};

const emptyForm = (): VisitingCardDraft => ({
  person_name: '',
  designation: '',
  phone: '',
  email: '',
  organization: '',
  card_type: 'staff',
  notes: '',
});

export function UtilityVisitingCardsTab({ cards, loading, onReload, onToast }: Props) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const canEdit = isAdmin || profile?.role === 'office_assistant';
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<VisitingCardDraft>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<CardType | ''>('');

  const filtered = useMemo(() => {
    return cards.filter((card) => {
      if (typeFilter && card.card_type !== typeFilter) return false;
      if (!filter) return true;
      const q = filter.toLowerCase();
      return [card.person_name, card.designation, card.phone, card.email, card.organization]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [cards, filter, typeFilter]);

  const submit = async () => {
    if (!draft.person_name.trim()) { onToast('Enter the person name first.'); return; }
    setSaving(true);
    const error = await saveVisitingCard({
      ...draft,
      person_name: draft.person_name.trim(),
      designation: draft.designation.trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim(),
      organization: draft.organization.trim(),
      notes: draft.notes?.trim() || null,
    });
    setSaving(false);
    if (error) { onToast(error); return; }
    onToast('Visiting card saved.');
    setDraft(emptyForm());
    setShowForm(false);
    onReload();
  };

  const remove = async (id: string) => {
    const error = await deleteVisitingCard(id);
    if (error) { onToast(error); return; }
    onToast('Card removed.');
    onReload();
  };

  return (
    <div className="fee-card">
      <div className="fee-card-head">
        <div>
          <span className="eyebrow">Visiting Cards</span>
          <h2>Printed Cards</h2>
        </div>
        {canEdit && !showForm && (
          <button className="primary-button" onClick={() => setShowForm(true)}>
            <Plus size={16} /> Add Card
          </button>
        )}
      </div>

      {showForm && canEdit && (
        <div className="util-form">
          <div className="util-form-grid">
            <label className="control-field">Person Name
              <input value={draft.person_name} onChange={(e) => setDraft({ ...draft, person_name: e.target.value })} placeholder="Full name" />
            </label>
            <label className="control-field">Designation
              <input value={draft.designation} onChange={(e) => setDraft({ ...draft, designation: e.target.value })} placeholder="Teacher, Principal, Visitor…" />
            </label>
            <label className="control-field">Phone
              <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="Contact number" />
            </label>
            <label className="control-field">Email
              <input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="email@school.edu" />
            </label>
            <label className="control-field">Organization
              <input value={draft.organization} onChange={(e) => setDraft({ ...draft, organization: e.target.value })} placeholder="School or company" />
            </label>
            <label className="control-field">Card Type
              <select value={draft.card_type} onChange={(e) => setDraft({ ...draft, card_type: e.target.value as CardType })}>
                {(Object.keys(CARD_TYPE_LABELS) as CardType[]).map((t) => (
                  <option key={t} value={t}>{CARD_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </label>
            <label className="control-field">Notes (optional)
              <input value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Purpose of visit, validity…" />
            </label>
          </div>
          <div className="util-form-actions">
            <button className="secondary-button" onClick={() => { setShowForm(false); setDraft(emptyForm()); }}>Cancel</button>
            <button className="primary-button" onClick={submit} disabled={saving}>
              <Plus size={15} /> {saving ? 'Saving…' : 'Save Card'}
            </button>
          </div>
        </div>
      )}

      <div className="fee-filters">
        <label className="control-field">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search by name, designation, phone…" />
        </label>
        <label className="control-field">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as CardType | '')}>
            <option value="">All types</option>
            {(Object.keys(CARD_TYPE_LABELS) as CardType[]).map((t) => (
              <option key={t} value={t}>{CARD_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="fee-empty">Loading cards…</p>
      ) : filtered.length === 0 ? (
        <p className="fee-empty">No visiting cards yet{filter || typeFilter ? ' match your filters' : ''}.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Designation</th><th>Phone</th><th>Email</th><th>Organization</th><th>Type</th>{isAdmin && <th></th>}</tr>
            </thead>
            <tbody>
              {filtered.map((card) => (
                <tr key={card.id}>
                  <td><div className="table-student"><CreditCard size={14} /><strong>{card.person_name}</strong></div></td>
                  <td>{card.designation || '—'}</td>
                  <td className="fee-mono">{card.phone || '—'}</td>
                  <td className="fee-mono">{card.email || '—'}</td>
                  <td>{card.organization || '—'}</td>
                  <td><span className="fee-status neutral">{CARD_TYPE_LABELS[card.card_type]}</span></td>
                  {isAdmin && (
                    <td>
                      <div className="fee-row-actions">
                        <button className="fee-link danger" onClick={() => remove(card.id)}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { RANGE_PRESETS, type FinanceRangeValue } from '@/lib/financeRange';

export function RangePicker({ range }: { range: FinanceRangeValue }) {
  return (
    <div className="fin-range">
      <div className="att-range-toggle">
        {RANGE_PRESETS.map((item) => (
          <button key={item.value} type="button" className={range.preset === item.value ? 'on' : ''} onClick={() => range.setPreset(item.value)}>
            {item.label}
          </button>
        ))}
        <button type="button" className={range.preset === 'custom' ? 'on' : ''} onClick={() => range.setPreset('custom')}>Custom</button>
      </div>
      {range.preset === 'custom' && (
        <div className="fin-range-dates">
          <label className="control-field compact"><span>From</span>
            <input type="date" value={range.customFrom} max={range.customTo} onChange={(event) => range.setCustomFrom(event.target.value)} />
          </label>
          <label className="control-field compact"><span>To</span>
            <input type="date" value={range.customTo} min={range.customFrom} onChange={(event) => range.setCustomTo(event.target.value)} />
          </label>
        </div>
      )}
    </div>
  );
}

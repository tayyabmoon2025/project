import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

export type SaveState = 'idle' | 'saving' | 'saved';

// The shared save-flow state behind every Save button in the app. The wrapped work
// returns false to say "nothing was saved" (a validation problem, for instance) and the
// button goes straight back to idle; anything else shows the green tick briefly. Both
// outcomes are settled in the finally block, so the spinner can never be left spinning.
// eslint-disable-next-line react-refresh/only-export-components -- the save-flow hook ships with the buttons that use it
export function useSaveState() {
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const run = async (work: () => Promise<boolean | void>) => {
    if (state === 'saving') return;
    let saved = false;
    setState('saving');
    try {
      saved = (await work()) !== false;
    } finally {
      if (saved) {
        setState('saved');
        timer.current = window.setTimeout(() => setState('idle'), 1800);
      } else {
        setState('idle');
      }
    }
  };

  return { state, run };
}

export function SaveButton({ state, label = 'Save', savedLabel = 'Saved', disabled = false, className = 'primary-button', size = 16 }: {
  state: SaveState;
  label?: string;
  savedLabel?: string;
  disabled?: boolean;
  className?: string;
  size?: number;
}) {
  return (
    <button
      type="submit"
      className={`${className} save-button${state === 'saved' ? ' save-button-done' : ''}`}
      disabled={disabled || state === 'saving'}
    >
      {state === 'saving' ? (
        <><Loader2 size={size} className="animate-spin" /> Saving…</>
      ) : state === 'saved' ? (
        <><Check size={size} /> {savedLabel}</>
      ) : (
        <><Check size={size} /> {label}</>
      )}
    </button>
  );
}

// The same save flow for buttons that are not a form's submit button: each button owns
// its state, and the work returning false (a failed save, a validation problem) skips
// the green tick. The state always settles in finally, success or failure.
export function AsyncSaveButton({ onSave, label = 'Save', savedLabel = 'Saved', disabled = false, className = 'primary-button', size = 15 }: {
  onSave: () => Promise<boolean | void>;
  label?: string;
  savedLabel?: string;
  disabled?: boolean;
  className?: string;
  size?: number;
}) {
  const { state, run } = useSaveState();
  return (
    <button
      type="button"
      className={`${className} save-button${state === 'saved' ? ' save-button-done' : ''}`}
      disabled={disabled || state === 'saving'}
      onClick={() => void run(onSave)}
    >
      {state === 'saving' ? (
        <><Loader2 size={size} className="animate-spin" /> Saving…</>
      ) : state === 'saved' ? (
        <><Check size={size} /> {savedLabel}</>
      ) : (
        <><Check size={size} /> {label}</>
      )}
    </button>
  );
}

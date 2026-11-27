let activeOwner: symbol | null = null;
const listeners = new Set<() => void>();

const notify = () => { listeners.forEach((listener) => listener()); };

export function claimPrintSheet(owner: symbol) {
  if (activeOwner === owner) return;
  activeOwner = owner;
  notify();
}

export function releasePrintSheet(owner: symbol) {
  if (activeOwner !== owner) return;
  activeOwner = null;
  notify();
}

export function subscribePrintSheet(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getActivePrintSheetOwner() {
  return activeOwner;
}

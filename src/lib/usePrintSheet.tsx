import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { claimPrintSheet, getActivePrintSheetOwner, releasePrintSheet, subscribePrintSheet } from '@/lib/printSheet';

// Renders the printable sheet at the top level of the page and lets only one
// view own it at a time, so a print never contains two copies of a record.
export function usePrintSheet(active: boolean, content: ReactNode) {
  const ownerRef = useRef<symbol | null>(null);
  if (!ownerRef.current) ownerRef.current = Symbol('print-sheet');
  const owner = ownerRef.current;

  useEffect(() => {
    if (!active) return;
    claimPrintSheet(owner);
    return () => releasePrintSheet(owner);
  }, [active, owner]);

  const activeOwner = useSyncExternalStore(subscribePrintSheet, getActivePrintSheetOwner, getActivePrintSheetOwner);
  const isOwner = active && activeOwner === owner;

  useEffect(() => {
    if (!isOwner) return;
    document.body.classList.add('print-sheet-active');
    return () => document.body.classList.remove('print-sheet-active');
  }, [isOwner]);

  if (!isOwner) return null;
  return createPortal(<div className="print-sheet-root">{content}</div>, document.body);
}

import { useEffect, useRef, useState, useCallback } from 'react';

const MAX_HISTORY = 50;
const COMMIT_DEBOUNCE_MS = 400;

// Editor-wide undo/redo over the single serializable `project` object.
//
// Every setProject call (layer edits, callout drags, style changes, layout
// patches) flows through the same state atom, so history is a stack of
// previous `project` references — immutable updates mean snapshots share
// structure and are cheap to hold. Rapid successive changes (slider drags,
// text typing) are coalesced into one undo step via a debounce window.
//
// Keyboard: Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl+Y redoes — ignored
// while focus is in an input/textarea/select/contenteditable so native text
// editing shortcuts keep working.
export function useUndoHistory(project, setProject, resetKey) {
  const historyRef = useRef({ past: [], future: [] });
  const projectRef = useRef(project);
  const committedRef = useRef(project);
  const timeTravelRef = useRef(false);
  const timerRef = useRef(null);
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);

  projectRef.current = project;

  const flushPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (committedRef.current !== projectRef.current) {
      const { past } = historyRef.current;
      past.push(committedRef.current);
      if (past.length > MAX_HISTORY) past.shift();
      historyRef.current.future = [];
      committedRef.current = projectRef.current;
    }
  }, []);

  // Record changes (debounced so drags/typing collapse into one step).
  useEffect(() => {
    if (timeTravelRef.current) {
      timeTravelRef.current = false;
      committedRef.current = project;
      return undefined;
    }
    if (committedRef.current === project) return undefined;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushPending();
      bump();
    }, COMMIT_DEBOUNCE_MS);
    return undefined;
  }, [project, flushPending]);

  // Switching projects starts a fresh timeline — undoing across a project
  // load would silently replace the open project with the previous one.
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    historyRef.current = { past: [], future: [] };
    committedRef.current = projectRef.current;
    bump();
  }, [resetKey]);

  const undo = useCallback(() => {
    flushPending();
    const { past, future } = historyRef.current;
    if (!past.length) return;
    const prev = past.pop();
    future.push(projectRef.current);
    timeTravelRef.current = true;
    setProject(prev);
    bump();
  }, [flushPending, setProject]);

  const redo = useCallback(() => {
    flushPending();
    const { past, future } = historyRef.current;
    if (!future.length) return;
    const next = future.pop();
    past.push(projectRef.current);
    if (past.length > MAX_HISTORY) past.shift();
    timeTravelRef.current = true;
    setProject(next);
    bump();
  }, [flushPending, setProject]);

  useEffect(() => {
    const isEditableTarget = (el) =>
      el?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      if (key === 'y' || (key === 'z' && e.shiftKey)) redo();
      else undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  return {
    undo,
    redo,
    canUndo: historyRef.current.past.length > 0 || (timerRef.current != null && committedRef.current !== projectRef.current),
    canRedo: historyRef.current.future.length > 0,
  };
}

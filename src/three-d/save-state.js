// Compare the persisted figure, not getState()'s derived drawing status. Lazy
// layers, terrain downloads and layout reports must not look like user edits.
export function figureSignature(project, fileDigest) {
  const { files = [], $files = fileDigest, ...settings } = project || {};
  return JSON.stringify({ ...settings, files: files.map(({ name, role, cols }) => ({ name, role, cols })), $files });
}

// Installed by the small account entry point, including for anonymous visitors.
// The lazy account module takes over the baseline once it opens or saves a figure.
export function watchUnsavedFigure({ target = window, initial, signature, note }) {
  const baseline = signature(initial);
  let managed = false, dirty = false, check = null;
  const change = () => {
    if (managed) { if (check) dirty = check(); return; }
    dirty = signature() !== baseline;
    if (note) {
      note.hidden = !dirty;
      note.textContent = 'Unsaved changes';
      note.title = 'Save this figure to your account before leaving.';
    }
  };
  const status = (event) => { managed = true; dirty = event.detail.dirty; check = event.detail.isDirty; };
  const leaving = (event) => {
    change(); // A final edit may still be waiting for the editor's change event.
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  };
  target.addEventListener('em3d:change', change);
  target.addEventListener('em3d:save-state', status);
  target.addEventListener('beforeunload', leaving);
  return () => {
    target.removeEventListener('em3d:change', change);
    target.removeEventListener('em3d:save-state', status);
    target.removeEventListener('beforeunload', leaving);
  };
}

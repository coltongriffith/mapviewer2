// Runs the colour tracers (units, and lines and points) off the main thread: a 1600 px figure takes a second
// or two, and the dialog stays responsive meanwhile.
import { traceColours } from './figureTrace.js';
import { detectMarks } from './figureMarks.js';

self.onmessage = (event) => {
  const { id, kind, image, units, options } = event.data || {};
  try {
    const result = kind === 'marks' ? detectMarks(image, units, options) : traceColours(image, units, options);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
};

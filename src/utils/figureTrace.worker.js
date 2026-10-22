// Runs the colour tracer off the main thread: a 1600 px figure takes a second
// or two, and the dialog stays responsive meanwhile.
import { traceColours } from './figureTrace.js';

self.onmessage = (event) => {
  const { id, image, units, options } = event.data || {};
  try {
    const result = traceColours(image, units, options);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
};

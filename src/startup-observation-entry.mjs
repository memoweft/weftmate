// Evaluated before the main module's application dependency graph.
import { app } from 'electron';
import { observeStartupEvents } from './startup-observation.mjs';
try {
  if (process.env.WEFTMATE_FIRST_WINDOW_TRACE) observeStartupEvents(app);
} catch { /* Optional harness observation only. */ }

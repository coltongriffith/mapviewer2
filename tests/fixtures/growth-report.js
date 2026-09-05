// Synthetic data only, shared by UI tests. Never imported by production code.
export const growthReport = {
  funnel: { sessions: 24, opened: 12, imported: 8, exported: 3, real_exported: 2 },
  exports: { total: 4, real: 2, unclassified: 1, other: 1 },
  billing: { active_subscribers: 2, trials: 1, past_due: 0, estimated_mrr_cents: 5800, unknown_interval: 0, stale_periods: 0 },
  cohort: { signups: 4, current_subscribers: 1, activated: 1, activation_eligible: 3, activation_pending: 1, activation_untracked: 0, return_eligible: 2, returned: 1, return_pending: 2 },
  sources: [{ source: 'founder / outreach', sessions: 24, opened: 12, imported: 8, exported: 3, real_exported: 2 }],
  signup_sources: [{ source: 'founder / outreach', signups: 4, current_subscribers: 1 }],
  friction: { export_failures: 1, pro_gate_sessions: 3, checkout_sessions: 2 },
  follow_up: [{ user_id: '00000000-0000-4000-8000-000000000001', email: 'prospect@example.test', exports: 2, last_export: '2026-09-04T12:00Z' }],
  meta: { start: '2026-08-06T07:00Z', end: '2026-09-05T07:00Z', tz: 'America/Vancouver', generated_at: '2026-09-05T12:00Z' },
};

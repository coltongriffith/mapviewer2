// Client-side data access for Tenure Monitor.
//
// Mirrors the shape of src/utils/cloudStorage.js: thin wrappers over
// supabase-js, RLS doing the authorization, and the quota-bearing writes
// routed through RPCs so a limit cannot be raced by two tabs or bypassed by a
// direct call. The only job the client has around quota is turning the
// database's error into a sentence a person can act on.

import { supabase } from '../lib/supabase';
import { trackEvent } from './track';

function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'Tenure Monitor needs a Supabase connection. Add VITE_SUPABASE_URL and '
      + 'VITE_SUPABASE_ANON_KEY to your environment.',
    );
  }
  return supabase;
}

// ── Search (through the public endpoint) ───────────────────────────────────

/**
 * Search the B.C. tenure mirror.
 * @param {'number'|'numbers'|'owner'|'client'|'extent'|'geometry'} mode
 */
export async function searchTenures(mode, value, { limit, signal } = {}) {
  const params = new URLSearchParams({ mode });
  if (mode === 'extent') params.set('bbox', value);
  else params.set('q', value);
  if (limit) params.set('limit', String(limit));

  const res = await fetch(`/api/tenure-search?${params}`, signal ? { signal } : undefined);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Search failed (${res.status})`);
  return body;
}

/** GeoJSON for a set of tenure ids — used when handing off to the map editor. */
export async function fetchTenureGeometry(tenureIds) {
  if (!tenureIds?.length) return { type: 'FeatureCollection', features: [] };
  const body = await searchTenures('geometry', tenureIds.join(','));
  return body.featureCollection;
}

// ── Portfolios ─────────────────────────────────────────────────────────────

export async function listPortfolios() {
  const { data, error } = await requireSupabase()
    .from('monitored_portfolios')
    .select('id, name, jurisdiction, alert_policy_id, alerts_paused, paused_reason, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Create a portfolio. The database evaluates the plan limit inside the same
 * transaction (public.create_monitored_portfolio), so this cannot be raced.
 */
export async function createPortfolio(name, offsets = null) {
  const { data, error } = await requireSupabase().rpc('create_monitored_portfolio', {
    p_name: name,
    p_offsets: offsets,
  });
  if (error) {
    if (/PORTFOLIO_LIMIT/.test(error.message || '')) {
      const e = new Error(
        'Your plan includes one portfolio. Upgrade to Pro to organise claims into several.',
      );
      e.code = 'PORTFOLIO_LIMIT';
      throw e;
    }
    throw error;
  }
  trackEvent('tenure_portfolio_created', { portfolio_id: data });
  return data;
}

export async function renamePortfolio(id, name) {
  const { error } = await requireSupabase()
    .from('monitored_portfolios')
    .update({ name: String(name ?? '').trim(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    // A CHECK constraint bounds the name at the column (migration
    // 20260801000003), because this rename path bypasses the validation in
    // create_monitored_portfolio and the name is rendered into every reminder.
    if (/monitored_portfolios_name_len/.test(error.message || '')) {
      throw new Error('A portfolio name must be between 1 and 120 characters.');
    }
    throw error;
  }
}

export async function deletePortfolio(id) {
  const { error } = await requireSupabase().from('monitored_portfolios').delete().eq('id', id);
  if (error) throw error;
}

/** Header-strip counts, computed server-side in America/Vancouver. */
export async function portfolioSummary(portfolioId) {
  const { data, error } = await requireSupabase()
    .rpc('tenure_portfolio_summary', { p_portfolio_id: portfolioId });
  if (error) throw error;
  return data || {};
}

/** Plan limits, from the database rather than the client matrix. */
export async function planLimits() {
  const { data, error } = await requireSupabase().rpc('tenure_plan_limits');
  if (error) throw error;
  return data || {};
}

/** Last successful government sync. Public — shown even to signed-out visitors. */
export async function lastSync() {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('tenure_last_sync');
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

/** Active government-data incident banner, if an administrator posted one. */
export async function activeSystemNotice() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('tenure_system_notices')
    .select('id, message, severity')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return null;
  return (data || [])[0] || null;
}

// ── Membership ─────────────────────────────────────────────────────────────

/**
 * Every monitored title in a portfolio, with the tenure record joined.
 *
 * Geometry is included because the portfolio map draws it. This is the one
 * place the payload size is worth it — a portfolio is capped at 50 titles on
 * the highest plan currently sold.
 */
export async function listPortfolioTenures(portfolioId) {
  const { data, error } = await requireSupabase()
    .from('monitored_portfolio_tenures')
    .select(`
      id, internal_project_name, internal_notes, maintenance_decision, decision_due_date,
      maintenance_reference, assigned_user_id, monitoring_enabled, added_at,
      tenures!inner (
        id, tenure_number, tenure_name, tenure_type, tenure_subtype, status,
        issue_date, good_to_date, termination_date, area_hectares, map_unit,
        geometry, missing_run_count, last_synced_at, source_updated_at
      )
    `)
    .eq('portfolio_id', portfolioId)
    .is('removed_at', null)
    .order('added_at', { ascending: true });
  if (error) throw error;

  const rows = data || [];
  const owners = await ownersFor(rows.map((r) => r.tenures.id));
  return rows.map((r) => ({
    membershipId: r.id,
    internalProjectName: r.internal_project_name,
    internalNotes: r.internal_notes,
    maintenanceDecision: r.maintenance_decision,
    decisionDueDate: r.decision_due_date,
    maintenanceReference: r.maintenance_reference,
    assignedUserId: r.assigned_user_id,
    monitoringEnabled: r.monitoring_enabled,
    addedAt: r.added_at,
    tenure: r.tenures,
    owners: owners.get(r.tenures.id) || [],
  }));
}

async function ownersFor(tenureIds) {
  const byTenure = new Map();
  if (!tenureIds.length) return byTenure;
  const { data, error } = await requireSupabase()
    .from('tenure_owners')
    .select('tenure_id, owner_name, ownership_percentage, government_client_number, ownership_representation, is_primary_owner')
    .in('tenure_id', tenureIds);
  if (error) throw error;
  for (const o of data || []) {
    if (!byTenure.has(o.tenure_id)) byTenure.set(o.tenure_id, []);
    byTenure.get(o.tenure_id).push(o);
  }
  return byTenure;
}

/**
 * Add titles to a portfolio.
 *
 * Partial by design: adding 12 to a free portfolio holding 3 adds 7 and
 * reports 5 skipped, rather than failing the whole batch. The user gets their
 * claims AND an honest upgrade prompt, which is a better outcome than an
 * error dialog and nothing.
 *
 * @returns {{added, already_present, skipped_over_limit, max_monitored_tenures, current_total}}
 */
export async function addTenures(portfolioId, tenureIds) {
  const { data, error } = await requireSupabase().rpc('add_portfolio_tenures', {
    p_portfolio_id: portfolioId,
    p_tenure_ids: tenureIds,
  });
  if (error) throw error;
  if (data?.added) {
    trackEvent('tenure_added', { count: data.added, skipped: data.skipped_over_limit || 0 });
  }
  return data;
}

export async function removeTenure(portfolioId, tenureId) {
  const { data, error } = await requireSupabase().rpc('remove_portfolio_tenure', {
    p_portfolio_id: portfolioId,
    p_tenure_id: tenureId,
  });
  if (error) throw error;
  return Boolean(data);
}

/**
 * Update the working fields on a monitored title.
 *
 * Direct UPDATE under RLS — the audit trail is written by a database trigger
 * rather than here, so an edit made from any future screen is recorded too.
 */
export async function updateMembership(membershipId, patch) {
  const allowed = {};
  if ('internalProjectName' in patch) allowed.internal_project_name = patch.internalProjectName;
  if ('internalNotes' in patch) allowed.internal_notes = patch.internalNotes;
  if ('maintenanceDecision' in patch) allowed.maintenance_decision = patch.maintenanceDecision;
  if ('decisionDueDate' in patch) allowed.decision_due_date = patch.decisionDueDate || null;
  if ('maintenanceReference' in patch) allowed.maintenance_reference = patch.maintenanceReference;
  if ('assignedUserId' in patch) allowed.assigned_user_id = patch.assignedUserId || null;
  if ('monitoringEnabled' in patch) allowed.monitoring_enabled = patch.monitoringEnabled;

  const { error } = await requireSupabase()
    .from('monitored_portfolio_tenures')
    .update(allowed)
    .eq('id', membershipId);
  if (error) throw error;
}

// ── Alerts ─────────────────────────────────────────────────────────────────

export async function getAlertPolicy(policyId) {
  if (!policyId) return null;
  const { data, error } = await requireSupabase()
    .from('tenure_alert_policies')
    .select('id, name, expiry_offsets, change_events_enabled, timezone')
    .eq('id', policyId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateAlertPolicy(policyId, patch) {
  const { error } = await requireSupabase()
    .from('tenure_alert_policies')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', policyId);
  if (error) throw error;
  trackEvent('tenure_alerts_configured', { offsets: patch.expiry_offsets?.length });
}

export async function listRecipients(policyId) {
  if (!policyId) return [];
  const { data, error } = await requireSupabase()
    .from('tenure_alert_recipients')
    .select('id, email, role, receives_expiry_alerts, receives_change_alerts, bounced_at, bounce_reason')
    .eq('policy_id', policyId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addRecipient(policyId, email) {
  const { error } = await requireSupabase()
    .from('tenure_alert_recipients')
    .insert({ policy_id: policyId, email: email.trim().toLowerCase() });
  if (error) {
    const msg = error.message || '';
    if (/duplicate key/i.test(msg)) {
      throw new Error('That address is already receiving alerts for this portfolio.');
    }
    // The recipient cap is enforced by a trigger (migration 20260801000003),
    // not by the check in AlertSettings — so it also fires for anything that
    // reaches the table another way. Turn it into the same upgrade sentence.
    if (/RECIPIENT_LIMIT/.test(msg)) {
      const e = new Error(
        'Your plan has no reminder-recipient slots left. Upgrade to Pro to send '
        + 'reminders to a colleague as well.',
      );
      e.code = 'RECIPIENT_LIMIT';
      throw e;
    }
    if (/invalid recipient email/i.test(msg)) {
      throw new Error('That does not look like an email address.');
    }
    throw error;
  }
}

export async function removeRecipient(recipientId) {
  const { error } = await requireSupabase()
    .from('tenure_alert_recipients').delete().eq('id', recipientId);
  if (error) throw error;
}

/** Scheduled and sent reminders for a portfolio, newest first. */
export async function listAlerts(portfolioId, { limit = 100 } = {}) {
  const { data, error } = await requireSupabase()
    .from('tenure_alert_instances')
    .select(`id, alert_type, offset_days, scheduled_for, source_good_to_date, status,
             sent_at, acknowledged_at, tenure_id,
             tenures!inner(tenure_number, tenure_name)`)
    .eq('portfolio_id', portfolioId)
    .order('scheduled_for', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function acknowledgeAlert(alertId) {
  const { data, error } = await requireSupabase()
    .rpc('acknowledge_tenure_alert', { p_alert_id: alertId });
  if (error) throw error;
  return Boolean(data);
}

// ── History ────────────────────────────────────────────────────────────────

/** Detected changes for one title. */
export async function tenureChangeHistory(tenureId, { limit = 50 } = {}) {
  // tenure_change_events carries no client grant (it is operational history),
  // so this reads through the definer RPC added with the change-monitoring
  // migration, which scopes results to titles the caller actually monitors.
  const { data, error } = await requireSupabase()
    .rpc('tenure_change_history', { p_tenure_id: tenureId, p_limit: limit });
  if (error) throw error;
  return data || [];
}

/** Recent changes across a whole portfolio. */
export async function portfolioChangeFeed(portfolioId, { days = 90, limit = 100 } = {}) {
  const { data, error } = await requireSupabase()
    .rpc('tenure_portfolio_changes', { p_portfolio_id: portfolioId, p_days: days, p_limit: limit });
  if (error) throw error;
  return data || [];
}

/** Who changed what, for one portfolio. */
export async function portfolioAuditLog(portfolioId, { limit = 100 } = {}) {
  const { data, error } = await requireSupabase()
    .from('tenure_audit_log')
    .select('id, action, previous_value, new_value, created_at, entity, entity_id')
    .eq('portfolio_id', portfolioId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

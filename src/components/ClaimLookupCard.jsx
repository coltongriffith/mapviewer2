import React, { useEffect, useMemo, useRef } from 'react';
import { normalizeClaims, summarize, commonHolder, daysLeftText } from '../utils/mobileClaims';
import { trackEvent } from '../utils/track';

// Desktop landing for a visitor who came from an article or company page to
// look a claim up. Analytics (Nov 2026): of 51 sessions that clicked a blog
// CTA, 24 got claims on the map and 1 exported — they had their answer, then
// faced a full map editor with nothing saying what the result was or what to
// do with it. This card answers the lookup in one line (who holds it, how
// much ground, when it next lapses) and puts the three useful next steps next
// to it: download the map, look up another, or go back to the article.
// Phones already get MobileClaimsViewer for the same job.

const fmtHa = (n) => `${n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 1 : 0 })} ha`;

export function lookupSummary(layers) {
  const claims = normalizeClaims(layers);
  if (!claims.length) return null;
  const s = summarize(claims);
  const holder = commonHolder(claims);
  const parts = [`${s.count.toLocaleString('en-US')} claim${s.count === 1 ? '' : 's'}`];
  if (s.totalHa > 0) parts.push(fmtHa(s.totalHa));
  if (s.places) parts.push(s.places);
  let lapse = null;
  if (s.earliest?.goodTo) {
    lapse = `${s.count === 1 ? 'Good to' : 'Next good-to date'} ${s.earliest.goodTo} (${daysLeftText(s.earliest.days)})`;
  }
  return {
    headline: holder || `${s.count.toLocaleString('en-US')} claim${s.count === 1 ? '' : 's'} added to the map`,
    facts: parts.join(' · '),
    lapse,
    expired: s.expired,
  };
}

export default function ClaimLookupCard({ project, layerIds, returnTo = null, onExport, onSearchAgain, onDismiss }) {
  const layers = useMemo(() => {
    const keep = new Set(layerIds);
    return (project.layers || []).filter((l) => keep.has(l.id) && l.geojson?.features?.length);
  }, [project.layers, layerIds]);
  const summary = useMemo(() => lookupSummary(layers), [layers]);
  const state = summary ? 'results' : 'empty';

  const shownRef = useRef(null);
  useEffect(() => {
    if (shownRef.current === state) return;
    shownRef.current = state;
    trackEvent('lookup_card_shown', { state, claims: layers.length ? layers.reduce((n, l) => n + l.geojson.features.length, 0) : 0 });
  }, [state, layers]);

  // Layers were imported, then all deleted: nothing left to describe.
  if (layerIds.length > 0 && !summary) return null;

  const act = (action, fn) => () => { trackEvent('lookup_card_action', { action, state }); fn?.(); };

  return (
    <section className="lookup-card" aria-label={summary ? 'Claim lookup result' : 'Look up a claim'}>
      <div className="lookup-card-body">
        {summary ? (
          <>
            <strong className="lookup-card-title">{summary.headline}</strong>
            <span className="lookup-card-facts">{summary.facts}</span>
            {(summary.lapse || summary.expired > 0) && (
              <span className="lookup-card-facts">
                {summary.lapse}
                {summary.lapse && summary.expired > 0 ? ' · ' : ''}
                {summary.expired > 0 ? `${summary.expired} expired` : ''}
              </span>
            )}
          </>
        ) : (
          <>
            <strong className="lookup-card-title">Looking up a claim?</strong>
            <span className="lookup-card-facts">Search by claim number, holder name, map sheet or coordinates.</span>
          </>
        )}
      </div>
      <div className="lookup-card-actions">
        {summary ? (
          <>
            <button type="button" className="ui-btn ui-btn--primary" onClick={act('export', onExport)}>Download map (PNG)</button>
            <button type="button" className="ui-btn" onClick={act('search_again', onSearchAgain)}>Look up another claim</button>
          </>
        ) : (
          <button type="button" className="ui-btn ui-btn--primary" onClick={act('search', onSearchAgain)}>Search claims</button>
        )}
        {returnTo && (
          <a className="lookup-card-back" href={returnTo.path} onClick={act('back_to_article')}>← {returnTo.label}</a>
        )}
        <button type="button" className="lookup-card-close" aria-label={summary ? 'Close and keep editing the map' : 'Close'}
          title="Keep editing" onClick={act('dismiss', onDismiss)}>✕</button>
      </div>
    </section>
  );
}

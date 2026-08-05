import React from 'react';
import { URGENCY_BANDS } from '../../utils/tenureDates';

// The header strip: what needs attention, and what changed.
//
// Ordered by urgency rather than by category, because the first thing a person
// opening this screen needs to know is whether anything is on fire. Counts
// that are zero are still shown — "0 expiring in 30 days" is a useful,
// reassuring answer, and a tile that disappears when it hits zero makes the
// layout jump around every night.

function Stat({ label, value, tone = 'neutral', hint, onClick, active }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={`tm-stat tm-stat--${tone} ${active ? 'is-active' : ''} ${onClick ? 'tm-stat--clickable' : ''}`.trim()}
      {...(onClick ? { type: 'button', onClick, 'aria-pressed': Boolean(active) } : {})}
      title={hint || undefined}
    >
      <span className="tm-stat-value">{value}</span>
      <span className="tm-stat-label">{label}</span>
    </Tag>
  );
}

const fmt = (n) => (Number(n) || 0).toLocaleString();
const fmtHa = (n) => {
  const v = Number(n) || 0;
  return v.toLocaleString(undefined, { maximumFractionDigits: v < 100 ? 1 : 0 });
};

export default function PortfolioSummary({ summary = {}, portfolioName, activeFilter, onFilter }) {
  const total = summary.total_tenures || 0;
  const toggle = (key) => () => onFilter?.(activeFilter === key ? null : key);

  return (
    <section className="tm-summary" aria-label={`${portfolioName || 'Portfolio'} summary`}>
      <div className="tm-summary-head">
        <h2 className="tm-summary-title">{portfolioName || 'Portfolio'}</h2>
        <p className="tm-summary-sub">
          {fmt(total)} monitored {total === 1 ? 'claim' : 'claims'}
          {' · '}
          {fmtHa(summary.total_hectares)} ha
        </p>
      </div>

      <div className="tm-stat-row">
        {/* Urgency first — this is the reason the product exists. */}
        <Stat
          label="Expiring in 30 days"
          value={fmt(summary.expiring_30)}
          tone={summary.expiring_30 ? 'urgent' : 'neutral'}
          onClick={onFilter && toggle('30')}
          active={activeFilter === '30'}
          hint="Good-to-date falls within the next 30 days."
        />
        <Stat
          label="Expiring in 90 days"
          value={fmt(summary.expiring_90)}
          tone={summary.expiring_90 ? 'soon' : 'neutral'}
          onClick={onFilter && toggle('90')}
          active={activeFilter === '90'}
          hint="Good-to-date falls within the next 90 days."
        />
        <Stat
          label="Expiring in 12 months"
          value={fmt(summary.expiring_365)}
          onClick={onFilter && toggle('365')}
          active={activeFilter === '365'}
          hint="Good-to-date falls within the next 12 months."
        />
        <Stat
          label="Past good-to-date"
          value={fmt(summary.expired)}
          tone={summary.expired ? 'expired' : 'neutral'}
          onClick={onFilter && toggle('expired')}
          active={activeFilter === 'expired'}
          hint="The published good-to-date has passed. Verify the current status in MTO."
        />
        <Stat
          label="Needs review"
          value={fmt(summary.needs_review)}
          tone={summary.needs_review ? 'review' : 'neutral'}
          onClick={onFilter && toggle('review')}
          active={activeFilter === 'review'}
          hint="No maintenance decision recorded, or marked for review."
        />
        <Stat
          label="Changed recently"
          value={fmt(summary.changed_recently)}
          tone={summary.changed_recently ? 'changed' : 'neutral'}
          onClick={onFilter && toggle('changed')}
          active={activeFilter === 'changed'}
          hint="A change was detected in the government record in the last 30 days."
        />
        {/* Only shown when non-zero: these are exception states, and a
            permanent "0 titles with no date" tile is noise. */}
        {summary.missing_date > 0 && (
          <Stat
            label="No published date"
            value={fmt(summary.missing_date)}
            tone="unknown"
            onClick={onFilter && toggle('nodate')}
            active={activeFilter === 'nodate'}
            hint="The B.C. source did not publish a good-to-date for these titles."
          />
        )}
        {summary.not_observed > 0 && (
          <Stat
            label="Not in latest dataset"
            value={fmt(summary.not_observed)}
            tone="unknown"
            onClick={onFilter && toggle('missing')}
            active={activeFilter === 'missing'}
            hint="Absent from the last two successful imports. Verify in MTO — this is not
              proof the title has lapsed."
          />
        )}
      </div>
    </section>
  );
}

/**
 * The map/table legend.
 *
 * Carries the icon and the label as well as the colour, so urgency is legible
 * to someone who cannot distinguish the swatches (WCAG 1.4.1).
 */
export function UrgencyLegend({ counts = {} }) {
  return (
    <ul className="tm-legend" aria-label="Urgency bands">
      {URGENCY_BANDS.map((band) => (
        <li key={band.id} className="tm-legend-item" title={band.description}>
          <span className="tm-legend-swatch" style={{ background: band.color }} aria-hidden="true">
            {band.icon}
          </span>
          <span className="tm-legend-label">{band.label}</span>
          {counts[band.id] != null && (
            <span className="tm-legend-count">{counts[band.id]}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { technicalStripHeight, technicalStripPlan } from '../src/utils/technicalStripLayout.js';
import { resolveTitleStripFields, resolveNI43101Zones, technicalReportTemplate } from '../src/templates/technicalReportTemplate.js';
import { getMapFrame } from '../src/utils/coordinateFrame.js';
import { applyTechnicalReport } from '../src/utils/technicalReport.js';
import TechnicalReportStrip from '../src/components/TechnicalReportStrip.jsx';

const layout = { templateId: 'ni_43101_technical', technicalReportVersion: 1,
  title: 'Illustrative Cedar Ridge Project — Regional Geology, Exploration Targets and Drill Collar Locations',
  subtitle: 'Target Generation — Soil Geochemistry & Drilling',
  companyName: 'Illustrative Aurora Ridge Exploration and Development Corporation', fonts: { title: 'Lato' } };
const fields = () => resolveTitleStripFields(layout, { now: new Date('2026-01-02T00:00:00Z'), scaleText: '1:100,000', projectionText: 'NAD83 / UTM Zone 9N' });

describe('shared recipe-only technical title block', () => {
  it.each([1000, 1250, 1600])('fits supplied long baseline metadata at %ipx without ellipsis', (width) => {
    const plan = technicalStripPlan(layout, fields(), width);
    expect(plan.cells.every((cell) => !cell.truncated)).toBe(true);
    for (const cell of plan.cells) for (const line of cell.lines) {
      expect(line.x).toBeGreaterThan(cell.x);
      expect(line.x + line.text.length * line.fontSize).toBeLessThanOrEqual(cell.x + cell.width);
      expect(line.y).toBeGreaterThan(0);
      expect(line.y).toBeLessThan(plan.height);
    }
    expect(plan.cells[0].lines.filter((line) => line.bold && line.family.startsWith('Lato')).map((line) => line.text).join(' ')).toBe(layout.title);
    expect(plan.cells[2].lines.map((line) => line.text).join(' ')).toContain(layout.companyName);
  });
  it('preserves unknown markers and renders supplied text inertly using the same plan', () => {
    const strip = fields(); strip.title = '<script>alert(1)</script>';
    const html = renderToStaticMarkup(<TechnicalReportStrip layout={layout} fields={strip} width={1250} height={800} />);
    expect(html).toContain('NOT SET');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Lato, sans-serif');
  });
  it.each(['top', 'bottom'])('reserves exactly the same %s strip area for map and panel geometry', (position) => {
    const settings = { ...layout, titleStripPosition: position };
    const frame = getMapFrame(settings, { width: 1250, height: 800 });
    const stripHeight = technicalStripHeight(settings);
    expect(position === 'top' ? frame.top : 800 - frame.bottom).toBe(28 + stripHeight);
    const zones = resolveNI43101Zones(technicalReportTemplate, settings, { width: 1250, height: 800 }, []);
    for (const zone of Object.values(zones).filter((value) => value.width && value.height)) {
      expect(zone.top).toBeGreaterThanOrEqual(frame.top);
      expect(zone.top + zone.height).toBeLessThanOrEqual(frame.bottom);
    }
  });
  it('keeps legacy strip height untouched and respects the existing text-size setting', () => {
    expect(technicalStripHeight({})).toBe(72);
    expect(technicalStripHeight({ stripFontScale: 1.4 })).toBe(72);
    expect(technicalStripHeight({ ...layout, stripFontScale: 1.4 })).toBeGreaterThan(112);
  });
  it('bounds extreme unbroken input visibly without changing the saved metadata', () => {
    const source = { ...layout, title: 'X'.repeat(10000) };
    const plan = technicalStripPlan(source, resolveTitleStripFields(source), 1000);
    expect(plan.cells[0].truncated).toBe(true);
    expect(plan.cells[0].lines.at(-1).text.endsWith('…')).toBe(true);
    expect(source.title.length).toBe(10000);
  });
  it('reserves no empty logo gap on recipe selection', () => {
    const selected = applyTechnicalReport({ layout, layers: [] });
    const zones = resolveNI43101Zones(technicalReportTemplate, selected.layout, { width: 1250, height: 800 }, []);
    expect(zones.logo.width).toBe(0);
    expect(zones.logo.height).toBe(0);
  });
});

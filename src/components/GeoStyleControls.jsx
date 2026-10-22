import React, { useEffect, useState } from 'react';
import { fxOf, LINE_TYPES } from '../utils/geoStyle.js';
import { layerGeometryKind } from '../utils/featureIdentity.js';
import { Range, Check, Pick } from './WashControls.jsx';

// The inspector's "Geology & labels" settings for a polygon or line layer (layer.fx, utils/geoStyle.js), loaded
// when one is selected.

// Labels still overlapping a panel or another label, as the stage last placed them.
function useOverlaps(map, layer) {
  const [list, setList] = useState(() => map?.emFxReport?.overlaps || []);
  useEffect(() => {
    if (!map) return undefined;
    const on = (e) => setList(e.overlaps || []);
    map.on('emfxreport', on);
    return () => map.off('emfxreport', on);
  }, [map]);
  const name = layer.legend?.label || layer.displayName || layer.name || 'Layer';
  return list.filter((o) => o.layer === name);
}

export default function GeoStyleControls({ layer, setProject, map }) {
  const kind = layerGeometryKind(layer);
  const fx = fxOf(layer);
  const id = layer.id;
  const overlaps = useOverlaps(map, layer);
  const setFx = (next) => setProject((prev) => ({
    ...prev,
    layers: prev.layers.map((l) => {
      if (l.id !== id) return l;
      const { fx: _old, ...rest } = l;
      return next ? { ...rest, fx: next, userStyled: true } : rest;
    }),
  }));
  const set = (patch) => setFx({ ...(layer.fx || {}), ...patch });
  const setLabel = (patch) => set({ label: { ...(layer.fx?.label || {}), ...patch } });
  const line = kind === 'line';
  const props = [...new Set((layer.geojson?.features || []).slice(0, 200).flatMap((f) => Object.keys(f?.properties || {})))].filter((k) => !k.startsWith('_'));
  const lab = fx?.label;
  if (kind === 'points') return null;

  return (
    <div className="control-grid geo-style-controls" data-testid="geo-style-controls">
      <h3 className="ins-sub-title">Geology &amp; labels</h3>
      <Check label={line ? 'Line style: glow, casing, line types' : 'Geology style: feather, plume'} checked={!!fx} onChange={(on) => setFx(on ? (line ? { lineType: 'zone', glow: 6 } : { feather: 6, outline: false }) : null)} />
      {fx && !line && (
        <>
          <Range id={`fx-feather-${id}`} label="Soft edges (blur)" value={fx.feather} min={0} max={30} unit=" px" onChange={(v) => set({ feather: v })} />
          <Check label="Hard outline" checked={fx.outline} onChange={(v) => set({ outline: v })} />
          <Check label="Dispersal plume (fades from its source)" checked={!!fx.plume} onChange={(v) => set({ plume: v ? { az: 225, tail: 0, blur: 4 } : null })} />
          {fx.plume && (
            <>
              <Range id={`fx-plume-az-${id}`} label="Fades toward (bearing)" value={((fx.plume.az % 360) + 360) % 360} min={0} max={359} step={5} unit="°" onChange={(v) => set({ plume: { ...fx.plume, az: v } })} />
              <Range id={`fx-plume-tail-${id}`} label="Opacity at the far end" value={fx.plume.tail} min={0} max={1} step={0.05} unit="%" onChange={(v) => set({ plume: { ...fx.plume, tail: v } })} />
              <Range id={`fx-plume-blur-${id}`} label="Plume blur" value={fx.plume.blur} min={0} max={30} unit=" px" onChange={(v) => set({ plume: { ...fx.plume, blur: v } })} />
            </>
          )}
          <p className="small-note">Fill opacity is the layer&apos;s own (above).</p>
        </>
      )}
      {fx && line && (
        <>
          <Pick id={`fx-type-${id}`} label="Line type" value={fx.lineType} options={LINE_TYPES} onChange={(v) => set({ lineType: v, casing: v === 'zone' })} />
          {(fx.lineType === 'thrust' || fx.lineType === 'fault') && (
            <Pick id={`fx-teeth-${id}`} label={fx.lineType === 'thrust' ? 'Teeth on the' : '“?” on the'} value={fx.teeth} options={[['left', 'Left (as drawn)'], ['right', 'Right (as drawn)']]} onChange={(v) => set({ teeth: v })} />
          )}
          <Range id={`fx-glow-${id}`} label="Glow" value={fx.glow} min={0} max={16} unit=" px" onChange={(v) => set({ glow: v })} />
          {fx.glow > 0 && <Range id={`fx-glow-op-${id}`} label="Glow strength" value={fx.glowOpacity} min={0.1} max={1} step={0.05} unit="%" onChange={(v) => set({ glowOpacity: v })} />}
          <Check label="Darker casing under the line" checked={fx.casing} onChange={(v) => set({ casing: v })} />
        </>
      )}
      {fx && (
        <>
          <Check label={line ? 'Label along the line' : 'Name printed in the unit'} checked={!!lab} onChange={(on) => set({ label: on ? { ...(layer.fx?.label || {}), on: true } : { ...(layer.fx?.label || {}), on: false } })} />
          {lab && (
            <div className="control-grid geo-label-controls">
              <div className="control-row">
                <label htmlFor={`fx-text-${id}`}>Text</label>
                <input id={`fx-text-${id}`} type="text" value={layer.fx?.label?.text || ''} placeholder={layer.legend?.label || layer.displayName || layer.name || ''} onChange={(e) => setLabel({ text: e.target.value })} />
              </div>
              {props.length > 0 && (
                <Pick id={`fx-field-${id}`} label="Or from a column" value={lab.field} options={[['', '— none —'], ...props.map((p) => [p, p])]} onChange={(v) => setLabel({ field: v })} />
              )}
              {!line && (
                <div className="control-row">
                  <label htmlFor={`fx-sub-${id}`}>Second line (italic)</label>
                  <input id={`fx-sub-${id}`} type="text" value={layer.fx?.label?.sub || ''} placeholder="e.g. diorite" onChange={(e) => setLabel({ sub: e.target.value })} />
                </div>
              )}
              <Range id={`fx-size-${id}`} label="Size" value={lab.size} min={6} max={40} unit=" px" onChange={(v) => setLabel({ size: v })} />
              <Pick id={`fx-weight-${id}`} label="Weight" value={String(lab.weight)} options={[['400', 'Regular'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Heavy']]} onChange={(v) => setLabel({ weight: Number(v) })} />
              <Range id={`fx-ls-${id}`} label="Letter spacing" value={lab.ls} min={0} max={0.8} step={0.02} unit=" em" onChange={(v) => setLabel({ ls: v })} />
              <Check label="Capitals" checked={lab.caps} onChange={(v) => setLabel({ caps: v })} />
              {line ? (
                <>
                  <Pick id={`fx-side-${id}`} label="Side" value={lab.side} options={[['left', 'Left of the line (as drawn)'], ['right', 'Right of the line'], ['on', 'On the line']]} onChange={(v) => setLabel({ side: v })} />
                  <Range id={`fx-offset-${id}`} label="Offset" value={lab.offset} min={-20} max={40} unit=" px" onChange={(v) => setLabel({ offset: v })} />
                  <Range id={`fx-start-${id}`} label="Position along the line" value={lab.start} min={0} max={100} unit="%" onChange={(v) => setLabel({ start: v })} />
                  <Check label="Keep upright (flip to read left to right)" checked={lab.flip} onChange={(v) => setLabel({ flip: v })} />
                </>
              ) : (
                <>
                  <Check label="Turn to fit the unit" checked={lab.rotate === 'auto'} onChange={(v) => setLabel({ rotate: v ? 'auto' : 0 })} />
                  {lab.rotate !== 'auto' && <Range id={`fx-rot-${id}`} label="Rotation" value={lab.rotate} min={-90} max={90} step={5} unit="°" onChange={(v) => setLabel({ rotate: v })} />}
                  <Pick id={`fx-fit-${id}`} label="If it does not fit" value={lab.fit} options={[['shrink', 'Shrink to fit'], ['hide', 'Hide it']]} onChange={(v) => setLabel({ fit: v })} />
                  <Pick id={`fx-per-${id}`} label="Labels" value={lab.per} options={[['layer', 'One, in the largest clear spot'], ['feature', 'One per shape']]} onChange={(v) => setLabel({ per: v })} />
                </>
              )}
              <div className="control-row inline-2">
                <label htmlFor={`fx-color-${id}`}>Colour {lab.color ? '' : '(darker shade of the layer)'}</label>
                <input id={`fx-color-${id}`} type="color" value={lab.color || '#333333'} onChange={(e) => setLabel({ color: e.target.value })} />
              </div>
              {lab.color && <button type="button" className="link-btn" style={{ textAlign: 'left' }} onClick={() => setLabel({ color: null })}>Use the darker shade again</button>}
              <Check label="White halo" checked={lab.halo ?? line} onChange={(v) => setLabel({ halo: v })} />
              <Check label="Step clear of panels and other labels" checked={lab.nudge} onChange={(v) => setLabel({ nudge: v })} />
              {overlaps.length > 0 && (
                <ul className="geo-overlaps" role="status" aria-label="Label overlaps">
                  {overlaps.map((o, i) => <li key={i}>“{o.label}” overlaps {o.with.join(', ')}</li>)}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

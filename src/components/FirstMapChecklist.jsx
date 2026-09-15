import React from 'react';

export default function FirstMapChecklist({ onbStep1, onbStep2, onbStep3, user, onDismiss, onSearch, onUpload, onSample, onInvestorLayout, onCustomize, onExport, onSave }) {
  return (
            <div className="onboarding-card">
              <div className="onboarding-card-head">
                <div className="onboarding-title">{onbStep1 ? 'Finish your map' : 'Make your first map'}</div>
                <button className="onboarding-dismiss" type="button" aria-label="Dismiss" onClick={onDismiss}>✕</button>
              </div>
              <ol className="onboarding-checklist">
                <li className={onbStep1 ? 'done' : ''}>
                  <span className="onb-tick">{onbStep1 ? '✓' : '1'}</span>
                  <div className="onb-body">
                    <strong>Add your data</strong>
                    {!onbStep1 && (
                      <div className="onb-actions">
                        <button type="button" onClick={onSearch}>Search public claims</button>
                        <button type="button" onClick={onUpload}>Upload a file</button>
                        <button type="button" className="onb-link" onClick={onSample}>Load sample data</button>
                      </div>
                    )}
                  </div>
                </li>
                <li className={onbStep2 ? 'done' : (onbStep1 ? '' : 'onb-locked')}>
                  <span className="onb-tick">{onbStep2 ? '✓' : '2'}</span>
                  <div className="onb-body">
                    <strong>Choose your layout</strong>
                    {onbStep1 && !onbStep2 && (
                      <div className="onb-actions">
                        <button type="button" onClick={onInvestorLayout}>Use investor layout · 16:9</button>
                        <button type="button" className="onb-link" onClick={onCustomize}>Customize design</button>
                      </div>
                    )}
                  </div>
                </li>
                <li className={onbStep3 ? 'done' : (onbStep1 ? '' : 'onb-locked')}>
                  <span className="onb-tick">{onbStep3 ? '✓' : '3'}</span>
                  <div className="onb-body">
                    <strong>Download your map</strong>
                    {onbStep1 && !onbStep3 && (
                      <div className="onb-actions">
                        <button type="button" onClick={onExport}>Export PNG</button>
                      </div>
                    )}
                  </div>
                </li>
                <li className={user ? 'done' : (onbStep1 ? '' : 'onb-locked')}>
                  <span className="onb-tick">{user ? '✓' : '4'}</span>
                  <div className="onb-body"><strong>Save for your next update</strong>
                    {onbStep1 && !user && <div className="onb-actions">
                      <button type="button" onClick={onSave}>Save to a free account</button>
                    </div>}
                  </div>
                </li>
              </ol>
            </div>
  );
}

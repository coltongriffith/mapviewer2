import React from 'react';
import { trackEvent } from '../utils/track';

// Load the phone-specific controls only when the editor detects a small touch device.
export default function MobileEditorBanner({ preview, hasData, signedIn, onPreview, onSave, onDismiss }) {
  return (
    <div className="mobile-editor-banner" role="status">
      <span>Preview your map here. For detailed editing, save to your account on this device, then open it on desktop.</span>
      <button type="button" onClick={() => { onPreview(); trackEvent('mobile_continue_clicked', { action: 'preview' }); }}>{preview ? 'Edit map' : 'Preview map'}</button>
      {hasData && <button type="button" onClick={() => {
        onSave();
        trackEvent('mobile_continue_clicked', { action: 'save', signed_in: signedIn });
      }}>{signedIn ? 'Save map' : 'Save to an account'}</button>}
      <button type="button" onClick={() => {
        onDismiss();
        try { sessionStorage.setItem('em_mobile_banner_dismissed', '1'); } catch { /* noop */ }
      }} aria-label="Dismiss">✕</button>
    </div>
  );
}

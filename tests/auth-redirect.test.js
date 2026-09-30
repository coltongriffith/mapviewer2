import { describe, it, expect } from 'vitest';
import { authRedirectUrl } from '../src/utils/authRedirect';

describe('authRedirectUrl', () => {
  it('moves www links onto the Supabase Site URL host so the page survives confirmation', () => {
    expect(authRedirectUrl('https://www.explorationmaps.com/tenure-monitor'))
      .toBe('https://explorationmaps.com/tenure-monitor');
    expect(authRedirectUrl('https://www.explorationmaps.com/map/abc123'))
      .toBe('https://explorationmaps.com/map/abc123');
  });

  it('keeps app intent but drops acquisition params the signup already recorded', () => {
    expect(authRedirectUrl('https://www.explorationmaps.com/tenure-monitor?utm_source=blog&utm_medium=cta&utm_campaign=how-to-track-bc-mineral-claim-good-to-dates'))
      .toBe('https://explorationmaps.com/tenure-monitor');
    expect(authRedirectUrl('https://www.explorationmaps.com/?intent=resume&gclid=abc'))
      .toBe('https://explorationmaps.com/?intent=resume');
  });

  it('drops an existing fragment so Supabase can append the session', () => {
    expect(authRedirectUrl('https://www.explorationmaps.com/#section')).toBe('https://explorationmaps.com/');
  });

  it('leaves other hosts alone', () => {
    expect(authRedirectUrl('http://localhost:5173/tenure-monitor')).toBe('http://localhost:5173/tenure-monitor');
    expect(authRedirectUrl('https://explorationmaps.com/?intent=resume')).toBe('https://explorationmaps.com/?intent=resume');
  });
});

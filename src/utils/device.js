// A phone, not a narrow desktop window. innerWidth lies on phones: the
// editor's wide layout makes mobile browsers expand the layout viewport. A
// coarse pointer on a screen under 700px on its short side is a phone.
export function isPhoneDevice() {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
  return Boolean(coarse) && Math.min(window.screen?.width || 9999, window.screen?.height || 9999) < 700;
}

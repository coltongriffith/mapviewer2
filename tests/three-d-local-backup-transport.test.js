import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ decode: vi.fn(), encode: vi.fn(), mark: vi.fn(), download: vi.fn() }));
vi.mock('../src/three-d/local-backup-codec.js', () => ({ MAX_BACKUP_BYTES: 8388608, decodeBackup: mocks.decode, encodeBackup: mocks.encode }));
vi.mock('../src/three-d/local-restore-context.js', () => ({ localRestoreBoot: true, localRestoreNonce: 'ab'.repeat(16), markLocalRestoreReady: mocks.mark }));
vi.mock('../src/utils/svg.js', () => ({ downloadBlob: mocks.download }));
import { openRestoreWindow, receiveLocalRestore, reviewLocalBackup, downloadLocalBackup } from '../src/three-d/local-backup.js';
import { canUseLocalBackup } from '../src/three-d/local-backup-access.js';

class Port {
  messages = [];
  postMessage = vi.fn((...args) => { this.messages.push(args); });
  start = vi.fn();
  close = vi.fn();
}
const channels = [];
class Channel { constructor() { this.port1 = new Port(); this.port2 = new Port(); channels.push(this); } }
function host() {
  const handlers = new Map();
  const child = { closed: false, close: vi.fn(), postMessage: vi.fn() };
  return { child, handlers, win: {
    location: { origin: 'https://example.test' }, crypto: { getRandomValues: (a) => a.fill(0xab) },
    addEventListener: (type, cb) => handlers.set(type, cb), removeEventListener: (type, cb) => { if (handlers.get(type) === cb) handlers.delete(type); },
    setTimeout, clearTimeout, setInterval, clearInterval, open: vi.fn(() => child),
  } };
}
const ready = (h, patch = {}) => h.handlers.get('message')?.({ origin: 'https://example.test', source: h.child, data: { type: 'emap-local-backup-ready', nonce: 'ab'.repeat(16) }, ...patch });
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); channels.length = 0; history.replaceState(null, '', '/3d/'); document.documentElement.className = ''; document.body.innerHTML = '<div id="status"></div>'; });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); document.documentElement.className = ''; });

describe('local backup read-only scope', () => {
  it.each(['/3d/share/abc', '/3d/embed/abc', '/3d/?project=abc&version=2', '/3d/?version=invalid'])('rejects the existing public/published URL mode %s', (path) => {
    expect(canUseLocalBackup(new URL(path, 'https://example.test'))).toBe(false);
  });
  it.each(['em3d-viewer', 'em3d-version'])('refuses all backup work before reading data or making requests in %s mode', async (mode) => {
    document.documentElement.classList.add(mode);
    const getProject = vi.fn(), read = vi.fn(), h = host(), onStatus = vi.fn();
    window.EM3D = { getProject };
    await downloadLocalBackup(); await reviewLocalBackup({ size: 1, arrayBuffer: read });
    expect(openRestoreWindow({ bytes: new Uint8Array([1]), isCurrent: () => true, win: h.win, Channel, onStatus })).toBeNull();
    expect(getProject).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    expect(mocks.encode).not.toHaveBeenCalled(); expect(mocks.decode).not.toHaveBeenCalled(); expect(mocks.download).not.toHaveBeenCalled();
    expect(h.win.open).not.toHaveBeenCalled(); expect(channels).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('allows an ordinary property editor URL regardless of its account role', () => {
    expect(canUseLocalBackup(new URL('/3d/?project=abc&property=def', 'https://example.test'))).toBe(true);
  });
  it('does not download if the figure enters read-only mode while encoding', async () => {
    window.EM3D = { getProject: () => ({ settings: {}, files: [] }) };
    mocks.encode.mockImplementationOnce(async () => { document.documentElement.classList.add('em3d-version'); return { bytes: new Uint8Array([1]), filename: 'figure.json' }; });
    await downloadLocalBackup();
    expect(mocks.download).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('read-only view');
  });
});

describe('one-shot local restore transport', () => {
  it('binds only the expected source, origin and nonce, sends bytes only over a private port', () => {
    const h = host(), bytes = new Uint8Array([1, 2, 3]), onStatus = vi.fn();
    openRestoreWindow({ bytes, isCurrent: () => true, onStatus, win: h.win, Channel });
    expect(h.win.open.mock.calls[0][0]).toBe(`/3d/#local-restore=${'ab'.repeat(16)}`);
    ready(h, { source: {} }); ready(h, { origin: 'https://wrong.test' }); ready(h, { data: { type: 'emap-local-backup-ready', nonce: 'cd'.repeat(16) } });
    expect(channels).toHaveLength(0);
    ready(h); const c = channels[0];
    expect(h.child.postMessage).toHaveBeenCalledWith({ type: 'emap-local-backup-bind', nonce: 'ab'.repeat(16) }, 'https://example.test', [c.port2]);
    expect(JSON.stringify(h.child.postMessage.mock.calls)).not.toContain('bytes');
    c.port1.onmessage({ data: { type: 'bound' } }); c.port1.onmessage({ data: { type: 'bound' } });
    expect(c.port1.postMessage).toHaveBeenCalledTimes(1);
    expect(c.port1.messages[0][0].bytes).toEqual(bytes);
    expect(c.port1.messages[0][0].bytes).not.toBe(bytes);
    c.port1.onmessage({ data: { type: 'opened' } });
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('another tab'));
    expect(c.port1.close).toHaveBeenCalled(); expect(h.child.close).not.toHaveBeenCalled();
  });
  it('closes an expired child and releases its listener and port', () => {
    const h = host(), onStatus = vi.fn();
    openRestoreWindow({ bytes: new Uint8Array([1]), isCurrent: () => true, onStatus, win: h.win, Channel, timeout: 1000 });
    ready(h); vi.advanceTimersByTime(1000);
    expect(h.child.close).toHaveBeenCalled(); expect(channels[0].port1.close).toHaveBeenCalled(); expect(h.handlers.has('message')).toBe(false);
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('expired'));
  });
  it('refuses a changed source figure before transmitting bytes', () => {
    const h = host(); let current = true;
    openRestoreWindow({ bytes: new Uint8Array([1]), isCurrent: () => current, win: h.win, Channel });
    ready(h); current = false; channels[0].port1.onmessage({ data: { type: 'bound' } });
    expect(channels[0].port1.postMessage).not.toHaveBeenCalled(); expect(h.child.close).toHaveBeenCalled();
  });
  it('reports a blocked popup without leaving timers or listeners', () => {
    const h = host(), onStatus = vi.fn(); h.win.open.mockReturnValue(null);
    expect(openRestoreWindow({ bytes: new Uint8Array([1]), isCurrent: () => true, win: h.win, Channel, onStatus })).toBeNull();
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('Allow a new tab'));
    expect(h.handlers.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('ignores opened and failed messages until a bound acknowledgement has sent the bytes', () => {
    const h = host(), onStatus = vi.fn();
    openRestoreWindow({ bytes: new Uint8Array([1]), isCurrent: () => true, onStatus, win: h.win, Channel });
    ready(h); const port = channels[0].port1;
    port.onmessage({ data: { type: 'opened' } }); port.onmessage({ data: { type: 'failed' } });
    expect(onStatus).not.toHaveBeenCalled(); expect(port.close).not.toHaveBeenCalled();
    port.onmessage({ data: { type: 'bound' } }); port.onmessage({ data: { type: 'opened' } });
    expect(port.postMessage).toHaveBeenCalledTimes(1); expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('another tab'));
  });
  it.each(['open', 'channel', 'bind', 'bytes'])('cleans up a throwing %s operation without exposing exception data', (step) => {
    const h = host(), onStatus = vi.fn(), secret = new Error('https://private.test/?token=secret');
    const ThrowingChannel = step === 'channel' ? class { constructor() { throw secret; } } : Channel;
    if (step === 'open') h.win.open.mockImplementation(() => { throw secret; });
    if (step === 'bind') h.child.postMessage.mockImplementation(() => { throw secret; });
    openRestoreWindow({ bytes: new Uint8Array([1]), isCurrent: () => true, onStatus, win: h.win, Channel: ThrowingChannel });
    if (step !== 'open') ready(h);
    if (step === 'bytes') { channels[0].port1.postMessage.mockImplementation(() => { throw secret; }); channels[0].port1.onmessage({ data: { type: 'bound' } }); }
    expect(h.handlers.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
    expect(JSON.stringify(onStatus.mock.calls)).not.toContain('secret'); expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('unchanged'));
    if (step !== 'open') expect(h.child.close).toHaveBeenCalled();
    if (channels.length) expect(channels[0].port1.close).toHaveBeenCalled();
  });
  it('the isolated child revalidates bytes, ignores impostors and severs its opener', async () => {
    const h = host(), opener = { postMessage: vi.fn() }, port = new Port(), project = { v: 1, settings: {}, files: [] }, onReady = vi.fn();
    Object.assign(h.win, { opener, EM3D: { getState: () => ({ ready: true }), loadProject: vi.fn(), layersReady: vi.fn() } });
    const decode = vi.fn(async () => ({ project }));
    receiveLocalRestore(onReady, { win: h.win, decode });
    const bind = h.handlers.get('message');
    const event = { origin: 'https://example.test', source: opener, data: { type: 'emap-local-backup-bind', nonce: 'ab'.repeat(16) }, ports: [port] };
    bind({ ...event, source: {} }); expect(port.postMessage).not.toHaveBeenCalled();
    bind(event); expect(h.win.opener).toBeNull();
    const bytes = new Uint8Array([1, 2]);
    await port.onmessage({ data: { type: 'backup', bytes } });
    expect(decode).toHaveBeenCalledWith(bytes); expect(h.win.EM3D.loadProject).toHaveBeenCalledWith(project);
    expect(mocks.mark).toHaveBeenCalledTimes(1); expect(onReady).toHaveBeenCalledTimes(1);
    await port.onmessage({ data: { type: 'backup', bytes } }); expect(decode).toHaveBeenCalledTimes(1);
  });
  it('invalid child bytes never load, enable controls or reveal arbitrary error text', async () => {
    const h = host(), opener = { postMessage: vi.fn() }, port = new Port(), onReady = vi.fn();
    Object.assign(h.win, { opener, EM3D: { getState: () => ({ ready: true }), loadProject: vi.fn() } });
    receiveLocalRestore(onReady, { win: h.win, decode: async () => { throw new Error('https://private.test/?token=secret'); } });
    h.handlers.get('message')({ origin: 'https://example.test', source: opener, data: { type: 'emap-local-backup-bind', nonce: 'ab'.repeat(16) }, ports: [port] });
    await port.onmessage({ data: { type: 'backup', bytes: new Uint8Array([1]) } });
    expect(h.win.EM3D.loadProject).not.toHaveBeenCalled(); expect(mocks.mark).not.toHaveBeenCalled(); expect(onReady).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('original figure is unchanged'); expect(document.body.textContent).not.toContain('secret');
  });
});

describe('file preflight and downloads', () => {
  const project = { v: 1, settings: { title: '<private title>' }, files: [] };
  beforeEach(() => { window.EM3D = { getProject: () => structuredClone(project) }; });
  it('rejects oversize input before reading and leaves the source untouched', async () => {
    window.EM3D.getProject = vi.fn(() => structuredClone(project));
    const read = vi.fn(); await reviewLocalBackup({ size: 8388609, arrayBuffer: read });
    expect(window.EM3D.getProject).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled(); expect(mocks.decode).not.toHaveBeenCalled(); expect(window.EM3D.getProject()).toEqual(project);
  });
  it('rejects a project switch during decode without showing the confirmation', async () => {
    mocks.decode.mockImplementation(async () => { window.dispatchEvent(new Event('em3d:figure-loading')); return { project, name: 'Backup' }; });
    await reviewLocalBackup({ size: 1, arrayBuffer: async () => new Uint8Array([1]).buffer });
    expect(document.getElementById('status').textContent).toContain('current figure changed'); expect(window.EM3D.getProject()).toEqual(project);
  });
  it('downloads the codec bytes without saving or changing the project', async () => {
    mocks.encode.mockResolvedValue({ bytes: new Uint8Array([1, 2]), filename: 'figure.emap-project.json', summary: { name: 'Figure', dependencies: {} } });
    await downloadLocalBackup();
    expect(mocks.encode).toHaveBeenCalledWith(project, expect.any(Object)); expect(mocks.download).toHaveBeenCalledWith('figure.emap-project.json', expect.any(Blob));
    expect(window.EM3D.getProject()).toEqual(project); expect(document.body.textContent).toContain('private project data');
    expect(document.body.textContent).not.toContain('fonts');
  });
  it('catches a rejected download and does not claim success', async () => {
    mocks.encode.mockResolvedValue({ bytes: new Uint8Array([1]), filename: 'figure.json', summary: {} });
    mocks.download.mockRejectedValueOnce(new Error('private download detail'));
    await downloadLocalBackup();
    expect(document.body.textContent).toContain('could not be backed up'); expect(document.body.textContent).not.toContain('downloaded');
    expect(document.body.textContent).not.toContain('private download detail');
  });
  it('returns focus to visible My 3D maps when the Restore menu has closed', async () => {
    document.body.innerHTML += '<button id="acct-maps">My 3D maps</button><div hidden><button id="backup-restore">Restore</button></div><dialog id="backup-dialog"><p id="backup-name"></p><p id="backup-dependencies"></p><p id="backup-error"></p><button id="backup-open"></button></dialog>';
    document.getElementById('acct-maps').getBoundingClientRect = () => ({ width:100, height:30 });
    const dialog = document.getElementById('backup-dialog'); dialog.showModal = vi.fn();
    mocks.decode.mockResolvedValue({ project, name:'Figure', dependencies:{} });
    await reviewLocalBackup({ size:1, arrayBuffer:async()=>new Uint8Array([1]).buffer });
    dialog.dispatchEvent(new Event('close'));
    expect(document.activeElement).toBe(document.getElementById('acct-maps'));
  });
  it('shows only fixed dependency labels and treats the name as text in the confirmation', async () => {
    document.body.innerHTML += '<dialog id="backup-dialog"><p id="backup-name"></p><p id="backup-dependencies"></p><p id="backup-error"></p><button id="backup-open"></button></dialog>';
    const dialog = document.getElementById('backup-dialog'); dialog.showModal = vi.fn();
    mocks.decode.mockResolvedValue({ project, name: '<img src=x onerror=alert(1)>', dependencies: { externalDependencies: [{ kind: 'dem', provider: 'https://secret.test' }, { kind: 'font', family: '<script>bad</script>' }], sourceReferences: [{ kind: 'property' }] } });
    await reviewLocalBackup({ size: 1, arrayBuffer: async () => new Uint8Array([1]).buffer });
    expect(dialog.showModal).toHaveBeenCalled(); expect(document.getElementById('backup-name').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(document.querySelector('#backup-name img')).toBeNull();
    const dependency = document.getElementById('backup-dependencies');
    expect(dependency.textContent).toContain('Real terrain, Fonts'); expect(dependency.textContent).toContain('do not grant account access');
    expect(dependency.textContent).not.toContain('secret'); expect(dependency.textContent).not.toContain('script');
    expect(dependency.hidden).toBe(false);
    mocks.decode.mockResolvedValue({ project, name: 'No dependencies', dependencies: {} });
    await reviewLocalBackup({ size: 1, arrayBuffer: async () => new Uint8Array([1]).buffer });
    expect(dependency.hidden).toBe(true); expect(dependency.textContent).toBe('');
  });
});

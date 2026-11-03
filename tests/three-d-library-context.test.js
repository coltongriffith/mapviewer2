import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), text: vi.fn() }));
vi.mock('../src/utils/propertyFiles.js', () => ({
  library: () => mocks,
  staleRefs: (refs, files) => Object.entries(refs).flatMap(([name, ref]) => {
    const file = files.find(f => f.id === ref.libFileId && f.version > ref.version);
    return file ? [{ name, from: ref.version, file }] : [];
  }),
}));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
let module, project, current, host;
const make = (name, id) => ({ v: 1, settings: { title: name, libRefs: { 'same.csv': { libFileId: id, version: 1 } } }, files: [{ name: 'same.csv', text: `${name} original`, role: 'geophys', cols: { value: 3 }, geophysNumericPolicy: 'future-policy' }] });
const file = (id, name = 'same.csv') => ({ id, name, version: 2, path: `${id}/v2` });
beforeEach(async () => {
  vi.resetModules(); mocks.list.mockReset(); mocks.text.mockReset();
  document.body.innerHTML = '<div id="lib-notice" hidden><span id="lib-notice-text"></span></div><div id="lib-pick" hidden></div><div id="lib-list"></div><button id="lib-update">Update</button><button id="lib-dismiss"></button><button id="lib-add"></button>';
  current = { id: 'a', home: { propertyId: 'pa' } }; project = make('A', 'fa');
  window.EM3D = {
    getProject: () => structuredClone(project),
    getState: () => ({ ...project.settings, files: project.files }),
    loadProject: vi.fn(async (p, options) => { expect(options.isCurrent()).toBe(true); project = structuredClone(p); }),
    addFiles: vi.fn(),
  };
  host = {
    current: () => current, client: async () => ({}), say: vi.fn(), pauseSaving: vi.fn(),
    captureContext: () => {
      const id = current.id, signature = JSON.stringify(project);
      return { isCurrent: ({ source = true } = {}) => current.id === id && (!source || JSON.stringify(project) === signature) };
    },
  };
  module = await import('../src/three-d/library.js'); module.init(host);
});
describe('property library async figure ownership', () => {
  it('keeps a late A notice from replacing the B property notice and source', async () => {
    const gate = deferred(); mocks.list.mockImplementation(p => p === 'pa' ? gate.promise : Promise.resolve([file('fb')]));
    const first = module.check();
    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledWith('pa'));
    current = { id: 'b', home: { propertyId: 'pb' } }; project = make('B', 'fb');
    await module.check(); gate.resolve([file('fa')]); await first;
    mocks.text.mockResolvedValue('B replacement');
    document.getElementById('lib-update').click();
    await vi.waitFor(() => expect(host.say).toHaveBeenCalledWith(expect.stringContaining('Updated to')));
    expect(mocks.text).toHaveBeenCalledWith('fb/v2');
    expect(project.files[0]).toMatchObject({ text: 'B replacement', role: 'geophys', cols: { value: 3 }, geophysNumericPolicy: 'finite-decimal-v1' });
    expect(project.settings.libRefs['same.csv']).toEqual({ libFileId: 'fb', version: 2 });
  });
  it('does not apply replacement text after editing or navigating during download', async () => {
    mocks.list.mockResolvedValue([file('fa')]); await module.check();
    const gate = deferred(); mocks.text.mockReturnValue(gate.promise);
    document.getElementById('lib-update').click();
    await vi.waitFor(() => expect(mocks.text).toHaveBeenCalled());
    project.settings.title = 'A unsaved edit'; gate.resolve('new text');
    await vi.waitFor(() => expect(document.getElementById('lib-update').disabled).toBe(false));
    expect(window.EM3D.loadProject).not.toHaveBeenCalled();
    expect(project.files[0].text).toBe('A original');
    expect(project.settings.title).toBe('A unsaved edit');
  });
  it('does not add an old picker download into a different figure', async () => {
    mocks.list.mockResolvedValue([file('fa', 'extra.csv')]); await module.toggle();
    const gate = deferred(); mocks.text.mockReturnValue(gate.promise);
    document.querySelector('[data-lib]').click();
    await vi.waitFor(() => expect(mocks.text).toHaveBeenCalled());
    current = { id: 'b', home: { propertyId: 'pb' } }; project = make('B', 'fb');
    gate.resolve('A extra'); await Promise.resolve(); await Promise.resolve();
    expect(window.EM3D.addFiles).not.toHaveBeenCalled();
  });
  it('does not perform a blind rollback or claim unchanged after an unverified failure', async () => {
    mocks.list.mockResolvedValue([file('fa')]); mocks.text.mockResolvedValue('replacement'); await module.check();
    window.EM3D.loadProject.mockRejectedValue(new Error('failed restoration'));
    document.getElementById('lib-update').click();
    await vi.waitFor(() => expect(host.pauseSaving).toHaveBeenCalledTimes(1));
    expect(window.EM3D.loadProject).toHaveBeenCalledTimes(1);
    expect(host.say).toHaveBeenCalledWith(expect.stringContaining('could not be fully restored'));
    expect(host.say).not.toHaveBeenCalledWith(expect.stringContaining('figure is unchanged'));
  });
});

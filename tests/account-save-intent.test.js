import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queueAccountSave, loadAccountSave, saveDraft } from '../src/utils/projectStorage';
import { resumeAccountSave } from '../src/utils/resumeAccountSave';

const payload = { layers: [{ id: 'claims', features: [{ id: 1 }] }], layout: { title: 'Requested map' } };
beforeEach(() => localStorage.clear());

describe('pending account save', () => {
  it('retains the requested map across reloads and unrelated draft changes', async () => {
    expect(queueAccountSave({ payload, projectId: null, projectName: 'My claims' }).ok).toBe(true);
    saveDraft({ payload: { layers: [], layout: { title: 'Different draft' } }, projectId: null });
    const save = vi.fn(async request => {
      expect(request).toMatchObject({ payload, projectId: null, projectName: 'My claims' });
      return { status: 'saved' };
    });
    await resumeAccountSave(save);
    expect(save).toHaveBeenCalledOnce();
    expect(loadAccountSave()).toBeNull();
  });

  it('coalesces duplicate auth effects and consumes a successful request only once', async () => {
    queueAccountSave({ payload });
    let finish;
    const save = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const first = resumeAccountSave(save);
    const second = resumeAccountSave(save);
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    finish({ status: 'saved-but-dirty' });
    await Promise.all([first, second]);
    await resumeAccountSave(save);
    expect(save).toHaveBeenCalledOnce();
  });

  it('retains a failed request for retry and does not clear a newer request', async () => {
    queueAccountSave({ payload });
    await resumeAccountSave(async () => ({ status: 'error' }));
    expect(loadAccountSave()?.payload).toEqual(payload);
    await resumeAccountSave(async () => {
      queueAccountSave({ payload: { ...payload, layout: { title: 'Next map' } } });
      return { status: 'saved' };
    });
    expect(loadAccountSave()?.payload.layout.title).toBe('Next map');
  });
});

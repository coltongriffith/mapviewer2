import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const TOKEN = 'em_live_aggET6aylhfy_3LUBCCvp7c8DlbGuevpXzjy8vSrisk';
vi.mock('../src/utils/agentConnections', () => ({
  listAgentConnections: vi.fn(async () => []),
  createAgentConnection: vi.fn(async (name) => ({ id: 'k1', name, token: TOKEN })),
  revokeAgentConnection: vi.fn(),
}));
import AgentConnectionsSection from '../src/components/AgentConnectionsSection';

describe('agent connection key', () => {
  it('shows a new key in a read-only field, so copying it never picks up a line break', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<AgentConnectionsSection onError={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create agent key' }));
    const field = await screen.findByRole('textbox', { name: 'Agent API key' });
    expect(field).toHaveValue(TOKEN);
    expect(field).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(TOKEN);
  });
});

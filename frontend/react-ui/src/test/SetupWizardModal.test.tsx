import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SetupWizardModal } from '../components/SetupWizardModal';

describe('SetupWizardModal Fronius host field', () => {
  it('starts empty and uses fronius.local only as a placeholder', async () => {
    const user = userEvent.setup();
    const onTestConnection = vi.fn().mockResolvedValue({
      ok: true,
      message: 'OK',
      latencyMs: 1,
    });
    render(
      <SetupWizardModal
        isOpen
        onClose={vi.fn()}
        onTestConnection={onTestConnection}
        isBridgeConnected
      />,
    );

    await user.click(screen.getByRole('button', { name: /Fronius PV-System/ }));
    const host = screen.getByPlaceholderText('fronius.local');
    const testButton = screen.getByRole('button', { name: 'Verbindung prüfen' });

    expect(host).toHaveValue('');
    expect(host).toHaveAttribute('placeholder', 'fronius.local');
    expect(testButton).toBeDisabled();
    expect(onTestConnection).not.toHaveBeenCalled();

    await user.type(host, 'wechselrichter.local');
    expect(host).toHaveValue('wechselrichter.local');
    expect(onTestConnection).not.toHaveBeenCalled();
  });
});

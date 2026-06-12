import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { SetInputRow } from './SetInputRow';

function renderRow(type: 'strength' | 'bodyweight' | 'cardio', onSubmit = vi.fn()) {
  render(
    <I18nProvider locale="en">
      <SetInputRow exerciseType={type} onSubmit={onSubmit} submitLabel="Log set" />
    </I18nProvider>,
  );
  return onSubmit;
}

describe('SetInputRow', () => {
  it('submits a strength set with numbers parsed', async () => {
    const onSubmit = renderRow('strength');
    await userEvent.type(screen.getByLabelText('kg'), '82.5');
    await userEvent.type(screen.getByLabelText('reps'), '8');
    await userEvent.type(screen.getByLabelText('RPE'), '8.5');
    await userEvent.click(screen.getByRole('button', { name: 'Log set' }));
    expect(onSubmit).toHaveBeenCalledWith({ weightKg: 82.5, reps: 8, rpe: 8.5 });
  });

  it('submits cardio minutes converted to seconds and km to meters', async () => {
    const onSubmit = renderRow('cardio');
    await userEvent.type(screen.getByLabelText('min'), '25');
    await userEvent.type(screen.getByLabelText('km'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Log set' }));
    expect(onSubmit).toHaveBeenCalledWith({ durationSec: 1500, distanceM: 5000 });
  });

  it('accepts comma decimals from JA keyboards', async () => {
    const onSubmit = renderRow('strength');
    await userEvent.type(screen.getByLabelText('kg'), '82,5');
    await userEvent.type(screen.getByLabelText('reps'), '8');
    await userEvent.click(screen.getByRole('button', { name: 'Log set' }));
    expect(onSubmit).toHaveBeenCalledWith({ weightKg: 82.5, reps: 8 });
  });

  it('disables submit when nothing countable is entered', async () => {
    renderRow('strength');
    expect(screen.getByRole('button', { name: 'Log set' })).toBeDisabled();
  });
});

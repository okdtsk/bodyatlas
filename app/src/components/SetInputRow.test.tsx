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

  it('rounds distance meters so edited values do not drift', async () => {
    const onSubmit = vi.fn();
    render(
      <I18nProvider locale="en">
        <SetInputRow
          exerciseType="cardio"
          onSubmit={onSubmit}
          submitLabel="Log set"
          initial={{ distanceKm: '1.001' }}
        />
      </I18nProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Log set' }));
    expect(onSubmit).toHaveBeenCalledWith({ distanceM: 1001 });
  });

  it('disables submit when nothing countable is entered', async () => {
    renderRow('strength');
    expect(screen.getByRole('button', { name: 'Log set' })).toBeDisabled();
  });

  it('includes note in payload when note toggle opened and text entered', async () => {
    const onSubmit = renderRow('strength');
    await userEvent.type(screen.getByLabelText('kg'), '80');
    await userEvent.type(screen.getByLabelText('reps'), '8');
    // Open the note toggle
    await userEvent.click(screen.getByRole('button', { name: 'Note' }));
    const noteInput = screen.getByPlaceholderText('e.g. form broke down on the last rep');
    await userEvent.type(noteInput, 'Great form');
    await userEvent.click(screen.getByRole('button', { name: 'Log set' }));
    expect(onSubmit).toHaveBeenCalledWith({ weightKg: 80, reps: 8, note: 'Great form' });
  });
});

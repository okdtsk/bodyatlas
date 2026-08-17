import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { mockApi } from '../test/mockApi';
import { ExercisePicker } from './ExercisePicker';

const exercises = [
  { id: 'e1', nameEn: 'Bench Press', nameJa: 'ベンチプレス', type: 'strength', muscleGroup: 'chest', equipment: 'barbell', isArchived: false, userId: null },
  { id: 'e2', nameEn: 'Back Squat', nameJa: 'バックスクワット', type: 'strength', muscleGroup: 'legs', equipment: 'barbell', isArchived: false, userId: null },
];

function renderPicker(onSelect = vi.fn(), locale: 'en' | 'ja' = 'en') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale={locale}>
        <ExercisePicker onSelect={onSelect} onClose={vi.fn()} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return onSelect;
}

afterEach(() => vi.unstubAllGlobals());

describe('ExercisePicker', () => {
  it('lists exercises and fires onSelect with the chosen one', async () => {
    mockApi({ 'GET /api/exercises': exercises });
    const onSelect = renderPicker();
    await userEvent.click(await screen.findByText('Bench Press'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }));
  });

  it('creates a custom exercise through the inline form', async () => {
    const spy = mockApi({
      'GET /api/exercises': exercises,
      'POST /api/exercises': {
        id: 'new1', nameEn: 'Zercher Squat', nameJa: null, type: 'strength',
        muscleGroup: 'legs', equipment: 'barbell', isArchived: false, userId: 'u1',
      },
    });
    const onSelect = renderPicker();
    await userEvent.click(await screen.findByText('Create exercise'));
    await userEvent.type(screen.getByLabelText('Exercise name'), 'Zercher Squat');
    await userEvent.selectOptions(screen.getByLabelText('Muscle group'), 'legs');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'new1' })));
    const post = spy.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post![1]!.body))).toMatchObject({ name: 'Zercher Squat', muscleGroup: 'legs' });
  });

  it('offers no Japanese name field in the English form', async () => {
    mockApi({ 'GET /api/exercises': exercises });
    renderPicker();
    await userEvent.click(await screen.findByText('Create exercise'));
    expect(screen.queryByLabelText('種目名 (日本語)')).toBeNull();
  });

  it('sends the Japanese name entered in the Japanese form', async () => {
    const spy = mockApi({
      'GET /api/exercises': exercises,
      'POST /api/exercises': {
        id: 'new1', nameEn: 'Zercher Squat', nameJa: 'ザーチャースクワット', type: 'strength',
        muscleGroup: 'legs', equipment: 'barbell', isArchived: false, userId: 'u1',
      },
    });
    const onSelect = renderPicker(vi.fn(), 'ja');
    await userEvent.click(await screen.findByText('種目を作成'));
    await userEvent.type(screen.getByLabelText('種目名 (英語)'), 'Zercher Squat');
    await userEvent.type(screen.getByLabelText('種目名 (日本語)'), 'ザーチャースクワット');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    const post = spy.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post![1]!.body))).toMatchObject({
      name: 'Zercher Squat',
      nameJa: 'ザーチャースクワット',
    });
  });

  it('omits nameJa when the Japanese field is left blank', async () => {
    const spy = mockApi({
      'GET /api/exercises': exercises,
      'POST /api/exercises': {
        id: 'new1', nameEn: 'Zercher Squat', nameJa: null, type: 'strength',
        muscleGroup: 'legs', equipment: 'barbell', isArchived: false, userId: 'u1',
      },
    });
    renderPicker(vi.fn(), 'ja');
    await userEvent.click(await screen.findByText('種目を作成'));
    await userEvent.type(screen.getByLabelText('種目名 (英語)'), 'Zercher Squat');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(spy.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(true));
    const post = spy.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post![1]!.body))).not.toHaveProperty('nameJa');
  });

  it('names the clashing exercise when the server rejects a duplicate', async () => {
    mockApi({
      'GET /api/exercises': exercises,
      'POST /api/exercises': new Response(
        JSON.stringify({
          error: { code: 'duplicate', message: 'dup', existingName: 'Back Squat' },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    });
    renderPicker();
    await userEvent.click(await screen.findByText('Create exercise'));
    await userEvent.type(screen.getByLabelText('Exercise name'), 'back squat');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const message = await screen.findByText(/Back Squat/);
    expect(message).toHaveTextContent('already in your catalog');
  });

  it('falls back to the generic message for an unstructured failure', async () => {
    mockApi({
      'GET /api/exercises': exercises,
      'POST /api/exercises': new Response('boom', { status: 500 }),
    });
    renderPicker();
    await userEvent.click(await screen.findByText('Create exercise'));
    await userEvent.type(screen.getByLabelText('Exercise name'), 'Zercher Squat');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
  });
});

import { hc } from 'hono/client';
import type { AppType } from '@bodyatlas/worker';

export const api = hc<AppType>('/api');

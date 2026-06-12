import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import type { Bindings } from '../src/types';

// Augment Cloudflare.Env so `env` in cloudflare:test is typed with our bindings.
declare namespace Cloudflare {
  interface Env extends Bindings {
    TEST_MIGRATIONS: D1Migration[];
  }
}

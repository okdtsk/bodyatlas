import { zValidator } from '@hono/zod-validator';
import { templateInputSchema, type TemplateInput } from '@bodyatlas/shared';
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, schema, type Db } from '../db';
import type { ProtectedEnv } from '../types';

const validationError = (issues: unknown) =>
  ({ error: { code: 'validation', message: 'Invalid request body', details: issues } }) as const;
const notFound = { error: { code: 'not_found', message: 'Template not found' } } as const;

const validateJson = zValidator('json', templateInputSchema, (result, c) => {
  if (!result.success) return c.json(validationError(result.error.issues), 422);
});

async function loadTemplate(db: Db, userId: string, id: string) {
  return db.query.templates.findFirst({
    where: and(eq(schema.templates.id, id), eq(schema.templates.userId, userId)),
    with: {
      templateExercises: {
        orderBy: asc(schema.templateExercises.position),
        with: { exercise: true },
      },
    },
  });
}

/** All referenced exercises must exist, be unarchived, and be visible to the user (seed or own). */
async function exercisesVisible(db: Db, userId: string, input: TemplateInput): Promise<boolean> {
  const ids = input.exercises.map((e) => e.exerciseId);
  const found = await db
    .select({ id: schema.exercises.id })
    .from(schema.exercises)
    .where(
      and(
        inArray(schema.exercises.id, ids),
        eq(schema.exercises.isArchived, false),
        or(isNull(schema.exercises.userId), eq(schema.exercises.userId, userId)),
      ),
    );
  return found.length === new Set(ids).size;
}

function exerciseRows(templateId: string, input: TemplateInput) {
  return input.exercises.map((e, i) => ({
    id: crypto.randomUUID(),
    templateId,
    exerciseId: e.exerciseId,
    position: i + 1,
    targetSets: e.targetSets ?? null,
  }));
}

export const templatesRoutes = new Hono<ProtectedEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env.DB);
    const rows = await db.query.templates.findMany({
      where: eq(schema.templates.userId, c.get('userId')),
      orderBy: desc(schema.templates.createdAt),
      with: {
        templateExercises: {
          orderBy: asc(schema.templateExercises.position),
          with: { exercise: true },
        },
      },
    });
    return c.json(rows);
  })
  .post('/', validateJson, async (c) => {
    const input = c.req.valid('json');
    const db = getDb(c.env.DB);
    if (!(await exercisesVisible(db, c.get('userId'), input))) {
      return c.json(validationError([{ message: 'Unknown exerciseId' }]), 422);
    }
    const id = crypto.randomUUID();
    const rows = exerciseRows(id, input);
    // d1 batch requires at least one statement; cast to satisfy tuple type
    await db.batch([
      db.insert(schema.templates).values({ id, userId: c.get('userId'), name: input.name }),
      ...rows.map((r) => db.insert(schema.templateExercises).values(r)),
    ] as any);
    return c.json(await loadTemplate(db, c.get('userId'), id), 201);
  })
  .get('/:id', async (c) => {
    const db = getDb(c.env.DB);
    const tpl = await loadTemplate(db, c.get('userId'), c.req.param('id'));
    if (!tpl) return c.json(notFound, 404);
    return c.json(tpl);
  })
  .put('/:id', validateJson, async (c) => {
    const db = getDb(c.env.DB);
    const id = c.req.param('id');
    const existing = await db.query.templates.findFirst({
      where: and(eq(schema.templates.id, id), eq(schema.templates.userId, c.get('userId'))),
    });
    if (!existing) return c.json(notFound, 404);
    const input = c.req.valid('json');
    if (!(await exercisesVisible(db, c.get('userId'), input))) {
      return c.json(validationError([{ message: 'Unknown exerciseId' }]), 422);
    }
    const rows = exerciseRows(id, input);
    // full-replace: update name, delete existing template_exercises, re-insert
    await db.batch([
      db.update(schema.templates).set({ name: input.name }).where(eq(schema.templates.id, id)),
      db.delete(schema.templateExercises).where(eq(schema.templateExercises.templateId, id)),
      ...rows.map((r) => db.insert(schema.templateExercises).values(r)),
    ] as any);
    return c.json(await loadTemplate(db, c.get('userId'), id));
  })
  .delete('/:id', async (c) => {
    const db = getDb(c.env.DB);
    const id = c.req.param('id');
    const existing = await db.query.templates.findFirst({
      where: and(eq(schema.templates.id, id), eq(schema.templates.userId, c.get('userId'))),
    });
    if (!existing) return c.json(notFound, 404);
    await db.delete(schema.templates).where(eq(schema.templates.id, id)); // cascades to template_exercises
    return c.json({ ok: true });
  });

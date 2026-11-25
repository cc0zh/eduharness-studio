import { KindGuard, type TSchema } from '@sinclair/typebox';
import { stripBlankOptionalFields } from './structured-model-output.js';
import { TeacherTurnOutputSchema } from './teacher-semantics.js';

// Attempts to use an obsolete model contract or to smuggle action/SVG fields are not noise.
const reserved = new Set([
  'actions',
  'boards',
  'spoken',
  'verify_feedback',
  'checkpoint',
  'keypoint_complete',
  'keypoint_unverified',
  'svg',
  'svg_markup',
  '__proto__',
  'constructor',
  'prototype',
]);

function blank(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && !value.trim()) ||
    (Array.isArray(value) && !value.length) ||
    (typeof value === 'object' && Object.keys(value).length === 0)
  );
}

function tidy(value: unknown, schema: TSchema, key = ''): unknown {
  if (KindGuard.IsArray(schema) && Array.isArray(value)) {
    const items = key === 'options' ? value.slice(0, 4) : value;
    return items.map((item) => tidy(item, schema.items));
  }
  if (
    !KindGuard.IsObject(schema) ||
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  )
    return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, entry]) => {
      if (!Object.hasOwn(schema.properties, name)) return reserved.has(name) ? [[name, entry]] : [];
      const field = schema.properties[name];
      if (KindGuard.IsOptional(field) && (blank(entry) || (name === 'transfer' && entry === false)))
        return [];
      return [[name, tidy(entry, field, name)]];
    }),
  );
}

/** The gateway screens the raw payload for secrets before accepting this projection. */
export function normalizeTeacherTurn(value: unknown): unknown {
  // Use the full vocabulary, not the phase subset: a recognized forbidden field still fails validation.
  return tidy(value, TeacherTurnOutputSchema);
}

export function normalizeLessonOpening(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (key === 'opening') return [[key, normalizeTeacherTurn(entry)]];
      if (key === 'basis') return blank(entry) ? [] : [[key, stripBlankOptionalFields(entry)]];
      return [[key, entry]];
    }),
  );
}

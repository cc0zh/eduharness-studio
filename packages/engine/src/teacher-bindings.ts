import { calcVerify } from './calc-verify.js';
import type { TeacherTurnOutput } from './teacher-semantics.js';

// Reserve double braces regardless of the characters inside, allowing a balanced TeX group
// around a template (e.g. \boxed{{{key}}}) without consuming that outer pair of braces.
const placeholder = /\{\{([^{}]*)\}\}/g;

function formulaAtom(value: string) {
  const [numerator, denominator] = value.split('/');
  if (denominator) return `\\frac{${numerator}}{${denominator}}`;
  return value.startsWith('-') ? `(${value})` : value;
}

/** Compute once per panel. Quoted data is neither a template nor a numeric assertion. */
export function bindTeacherNumbers(scene: TeacherTurnOutput) {
  const reasons = new Set<string>();
  const panels = scene.panels.map(({ bindings, ...panel }, index) => {
    const path = `$.panels[${index}]`;
    const values = new Map<string, string>();
    const declared = new Set<string>();
    for (const [slot, { key, expression, format }] of (bindings ?? []).entries()) {
      const at = `${path}.bindings[${slot}]`;
      if (declared.has(key)) {
        reasons.add(`numeric binding at ${at}.key: duplicate key in this panel`);
        continue;
      }
      declared.add(key);
      let result = calcVerify({ expression, format: format ?? 'decimal' });
      if (result.ok && result.approximate && format === undefined) {
        result = calcVerify({ expression, format: 'fraction' });
      }
      if (!result.ok) reasons.add(`numeric binding at ${at}.expression: ${result.error.message}`);
      else if (result.approximate) {
        reasons.add(`numeric binding at ${at}.expression: no exact result in the requested format`);
      } else values.set(key, result.text);
    }
    const inline = (field: 'content' | 'formula' | 'voiceover', text: string) => {
      const at = `${path}.${field}`;
      const rendered = text.replace(placeholder, (token, body: string) => {
        const key = body.trim();
        const value = values.get(key);
        if (value !== undefined) return field === 'formula' ? formulaAtom(value) : value;
        return token;
      });
      if (rendered.includes('{{')) {
        reasons.add(`numeric binding at ${at}: undeclared key or malformed template`);
      }
      if (rendered.length > 512) reasons.add(`numeric binding at ${at}: expansion is too long`);
      return rendered;
    };
    return {
      ...panel,
      content: inline('content', panel.content),
      ...(panel.formula === undefined ? {} : { formula: inline('formula', panel.formula) }),
      ...(panel.voiceover === undefined ? {} : { voiceover: inline('voiceover', panel.voiceover) }),
    };
  });
  return reasons.size
    ? { ok: false as const, reasons: [...reasons].slice(0, 8) }
    : { ok: true as const, scene: { ...scene, panels } };
}

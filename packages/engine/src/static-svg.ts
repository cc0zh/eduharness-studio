// This is a deliberately small SVG subset, not a permissive XML parser. Reject the whole image
// if any token fails, and use the accepted markup only as an encoded <img> source.
const namespace = 'http://www.w3.org/2000/svg';
const shapes = new Set([
  'g',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
]);
const containers = new Set(['svg', 'g']);
const geometry = new Set([
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'stroke-width',
  'font-size',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
]);
const whitespace = /^[ \t\r\n]*$/;
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function isNumber(value: string) {
  return numeric.test(value) && Number.isFinite(Number(value));
}

function numberList(value: string) {
  const parts = value
    .replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
    .split(/[ \t\r\n]*,[ \t\r\n]*|[ \t\r\n]+/);
  return parts.every(isNumber) ? parts.map(Number) : undefined;
}

function validAttribute(name: string, value: string, root: boolean) {
  if (geometry.has(name)) return isNumber(value);
  switch (name) {
    case 'xmlns':
      return root && value === namespace;
    case 'viewBox': {
      const box = numberList(value);
      return root && box?.length === 4 && box[2] > 0 && box[3] > 0;
    }
    case 'fill':
    case 'stroke':
      // Plain colors only: no CSS function (including url()), variable, or declaration.
      return /^(?:[a-zA-Z]+|#[\da-fA-F]{3,4}|#[\da-fA-F]{6}|#[\da-fA-F]{8})$/.test(value);
    case 'd':
      return /^[Mm][\d.,+eE \t\r\nMmZzLlHhVvCcSsQqTtAa-]*$/.test(value);
    case 'points':
    case 'stroke-dasharray':
      return numberList(value) !== undefined;
    case 'stroke-linecap':
      return /^(?:butt|round|square)$/.test(value);
    case 'stroke-linejoin':
      return /^(?:miter|round|bevel)$/.test(value);
    case 'text-anchor':
      return /^(?:start|middle|end)$/.test(value);
    case 'font-family':
      return value === 'sans-serif';
    default:
      return false;
  }
}

function safeAttributes(source: string, root: boolean) {
  const attribute = /[ \t\r\n]+([a-zA-Z][\w-]*)[ \t\r\n]*=[ \t\r\n]*(?:"([^"<>&]*)"|'([^'<>&]*)')/y;
  const seen = new Set<string>();
  let end = 0;
  for (let match = attribute.exec(source); match; match = attribute.exec(source)) {
    const [, name, doubleQuoted, singleQuoted] = match;
    if (seen.has(name) || !validAttribute(name, doubleQuoted ?? singleQuoted, root)) return false;
    seen.add(name);
    end = attribute.lastIndex;
  }
  return (
    whitespace.test(source.slice(end)) && (!root || (seen.has('xmlns') && seen.has('viewBox')))
  );
}

function safeCharacters(source: string) {
  for (const character of source) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 && character !== '\t' && character !== '\r' && character !== '\n') return false;
    if ((code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff) return false;
  }
  return true;
}

export function sanitizeSvg(markup: string): string | undefined {
  if (markup.length > 32_000) return undefined;
  const source = markup.trim();
  if (!safeCharacters(source)) return undefined;
  const token = /<(\/?)([a-zA-Z][\w-]*)([^<>]*?)(\/?)>|([^<]+)/y;
  const stack: string[] = [];
  let hasRoot = false;
  let end = 0;
  while (end < source.length) {
    const match = token.exec(source);
    if (!match) return undefined;
    end = token.lastIndex;
    const [, closing, tag, attrs, selfClosing, text] = match;
    const parent = stack.at(-1);
    if (text !== undefined) {
      if (parent === 'text') {
        if (/&(?!amp;|lt;|gt;|quot;|apos;)|\]\]>/.test(text)) return undefined;
      } else if (!whitespace.test(text)) return undefined;
    } else if (closing) {
      if (parent !== tag || selfClosing || !whitespace.test(attrs)) return undefined;
      stack.pop();
    } else {
      if (parent ? !containers.has(parent) || !shapes.has(tag) : hasRoot || tag !== 'svg') {
        return undefined;
      }
      if (stack.length >= 16 || !safeAttributes(attrs, !parent)) return undefined;
      hasRoot = true;
      if (!selfClosing) stack.push(tag);
    }
  }
  return hasRoot && stack.length === 0 ? source : undefined;
}

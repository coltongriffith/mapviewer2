// Minimal independent PostgREST filter grammar for local fixtures. No eval and
// no production import: tests inspect the real SDK's serialized request first.
export function parseDrillFilter(input) {
  let at = 0;
  const list = () => {
    const parts = [expression()];
    while (input[at] === ',') { at++; parts.push(expression()); }
    if (input[at++] !== ')') throw new Error('Unclosed filter group');
    return parts;
  };
  const expression = () => {
    for (const op of ['and', 'or']) if (input.startsWith(`${op}(`, at)) {
      at += op.length + 1; return { op, parts: list() };
    }
    const match = /^(hole_id|depth_m|from_m|to_m)\.(eq|gt|gte)\./.exec(input.slice(at));
    if (!match) throw new Error(`Unexpected filter at ${at}`);
    at += match[0].length;
    let value = '';
    if (input[at] === '"') {
      at++;
      while (at < input.length && input[at] !== '"') {
        if (input[at] === '\\') at++;
        value += input[at++];
      }
      if (input[at++] !== '"') throw new Error('Unclosed filter value');
    } else {
      while (at < input.length && !',)'.includes(input[at])) value += input[at++];
    }
    return { field: match[1], op: match[2], value: match[1] === 'hole_id' ? value : Number(value) };
  };
  const result = expression();
  if (at !== input.length) throw new Error('Trailing filter input');
  return result;
}
export function matchesDrillFilter(row, f) {
  if (f.parts) return f.op === 'and' ? f.parts.every((p) => matchesDrillFilter(row, p)) : f.parts.some((p) => matchesDrillFilter(row, p));
  return f.op === 'eq' ? row[f.field] === f.value : f.op === 'gt' ? row[f.field] > f.value : row[f.field] >= f.value;
}
export function drillFilterSql(f, params) {
  if (f.parts) return `(${f.parts.map((p) => drillFilterSql(p, params)).join(f.op === 'and' ? ' and ' : ' or ')})`;
  params.push(f.value);
  return `"${f.field}" ${f.op === 'eq' ? '=' : f.op === 'gt' ? '>' : '>='} $${params.length}`;
}

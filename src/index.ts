interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * JSON Schema validation MCP.
 *
 * Keyless, offline: validate a JSON value against a JSON Schema (a practical
 * draft-07 subset — type, required, properties, additionalProperties, items,
 * enum, const, min/max, length, pattern, items counts, uniqueItems, and common
 * formats). Returns each failure with its path. Pure logic — no API, no key.
 */


type Sch = Record<string, any>;
const FORMATS: Record<string, RegExp> = {
  email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
  uri: /^[a-z][a-z0-9+.-]*:\/\/\S+$/i,
  'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  time: /^\d{2}:\d{2}:\d{2}/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  ipv4: /^(\d{1,3}\.){3}\d{1,3}$/,
  hostname: /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i,
};

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}
function typeOk(v: unknown, t: string): boolean {
  const a = typeOf(v);
  if (t === 'number') return a === 'number' || a === 'integer';
  return a === t;
}

function validate(data: unknown, schema: Sch, path: string, errors: { path: string; message: string }[]): void {
  if (typeof schema !== 'object' || schema === null) return;
  const p = path || '$';
  if (schema.const !== undefined && JSON.stringify(data) !== JSON.stringify(schema.const)) errors.push({ path: p, message: `must equal const ${JSON.stringify(schema.const)}` });
  if (schema.enum && !schema.enum.some((e: unknown) => JSON.stringify(e) === JSON.stringify(data))) errors.push({ path: p, message: `must be one of ${JSON.stringify(schema.enum)}` });
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t: string) => typeOk(data, t))) { errors.push({ path: p, message: `must be ${types.join(' or ')}, got ${typeOf(data)}` }); return; }
  }
  const t = typeOf(data);
  if (t === 'string') {
    const s = data as string;
    if (schema.minLength !== undefined && s.length < schema.minLength) errors.push({ path: p, message: `shorter than minLength ${schema.minLength}` });
    if (schema.maxLength !== undefined && s.length > schema.maxLength) errors.push({ path: p, message: `longer than maxLength ${schema.maxLength}` });
    if (schema.pattern && !new RegExp(schema.pattern).test(s)) errors.push({ path: p, message: `does not match pattern ${schema.pattern}` });
    if (schema.format && FORMATS[schema.format] && !FORMATS[schema.format].test(s)) errors.push({ path: p, message: `is not a valid ${schema.format}` });
  }
  if (t === 'number' || t === 'integer') {
    const n = data as number;
    if (schema.minimum !== undefined && n < schema.minimum) errors.push({ path: p, message: `less than minimum ${schema.minimum}` });
    if (schema.maximum !== undefined && n > schema.maximum) errors.push({ path: p, message: `greater than maximum ${schema.maximum}` });
    if (schema.exclusiveMinimum !== undefined && n <= schema.exclusiveMinimum) errors.push({ path: p, message: `must be > ${schema.exclusiveMinimum}` });
    if (schema.exclusiveMaximum !== undefined && n >= schema.exclusiveMaximum) errors.push({ path: p, message: `must be < ${schema.exclusiveMaximum}` });
    if (schema.multipleOf && n % schema.multipleOf !== 0) errors.push({ path: p, message: `not a multiple of ${schema.multipleOf}` });
  }
  if (t === 'array') {
    const arr = data as unknown[];
    if (schema.minItems !== undefined && arr.length < schema.minItems) errors.push({ path: p, message: `fewer than minItems ${schema.minItems}` });
    if (schema.maxItems !== undefined && arr.length > schema.maxItems) errors.push({ path: p, message: `more than maxItems ${schema.maxItems}` });
    if (schema.uniqueItems && new Set(arr.map((x) => JSON.stringify(x))).size !== arr.length) errors.push({ path: p, message: `items are not unique` });
    if (schema.items) arr.forEach((item, i) => validate(item, schema.items, `${p}[${i}]`, errors));
  }
  if (t === 'object') {
    const obj = data as Record<string, unknown>;
    for (const req of schema.required ?? []) if (!(req in obj)) errors.push({ path: p, message: `missing required property "${req}"` });
    if (schema.properties) for (const [k, sub] of Object.entries(schema.properties)) if (k in obj) validate(obj[k], sub as Sch, `${p}.${k}`, errors);
    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const k of Object.keys(obj)) if (!allowed.has(k)) errors.push({ path: `${p}.${k}`, message: `additional property not allowed` });
    }
  }
}

const tools: McpToolExport['tools'] = [
  {
    name: 'validate_json_schema',
    description: 'Validate a JSON value against a JSON Schema (draft-07 subset: type, required, properties, additionalProperties, items, enum, const, min/max, minLength/maxLength, pattern, minItems/maxItems, uniqueItems, format). Returns {valid, errors:[{path,message}]}. Keyless, offline.',
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'The JSON value to validate (any type).' },
        schema: { type: 'object', description: 'The JSON Schema to validate against.' },
      },
      required: ['data', 'schema'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name !== 'validate_json_schema') throw new Error(`Unknown tool: ${name}`);
  if (typeof args.schema !== 'object' || args.schema === null) throw new Error('Required argument "schema" must be a JSON Schema object.');
  if (!('data' in args)) throw new Error('Required argument "data" is missing.');
  const errors: { path: string; message: string }[] = [];
  try { validate(args.data, args.schema as Sch, '', errors); } catch (e) { return { valid: false, errors: [{ path: '$', message: `schema error: ${(e as Error).message}` }] }; }
  return { valid: errors.length === 0, error_count: errors.length, errors };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;

// A small JSON Schema (draft 7 subset) checker for widget configs. The server validates again; this gives the
// page editor and the runtime early, readable errors. Unknown keywords are ignored.

const typeOf = (v) =>
  v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;

const matchesType = (type, v) => {
  const t = typeOf(v);
  return type === t || (type === "number" && t === "integer");
};

/** `schema` is the root; `$ref`s resolve against its `$defs`. Returns `[{ path, message }]`. */
export const checkSchema = (schema, value, root = schema, path = "") => {
  const here = path || "/";
  if (schema === true || schema === undefined) return [];
  if (schema.$ref) {
    const name = schema.$ref.replace("#/$defs/", "");
    const target = root.$defs?.[name];
    return target ? checkSchema(target, value, root, path) : [];
  }
  if (schema.anyOf || schema.oneOf) {
    const options = schema.anyOf ?? schema.oneOf;
    const trials = options.map((o) => checkSchema(o, value, root, path));
    return trials.some((t) => t.length === 0)
      ? []
      : [{ path: here, message: "does not match any allowed shape" }];
  }
  const errors = [];
  if (schema.const !== undefined && value !== schema.const)
    errors.push({ path: here, message: `must be ${JSON.stringify(schema.const)}` });
  if (schema.enum && !schema.enum.includes(value))
    errors.push({ path: here, message: `must be one of ${schema.enum.join(", ")}` });
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => matchesType(t, value))) {
      errors.push({ path: here, message: `must be ${types.join(" or ")}` });
      return errors;
    }
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      errors.push({ path: here, message: `needs at least ${schema.minLength} characters` });
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      errors.push({ path: here, message: `at most ${schema.maxLength} characters` });
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      errors.push({ path: here, message: "has the wrong format" });
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum)
      errors.push({ path: here, message: `must be at least ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum)
      errors.push({ path: here, message: `must be at most ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      errors.push({ path: here, message: `needs at least ${schema.minItems} items` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      errors.push({ path: here, message: `at most ${schema.maxItems} items` });
    if (schema.items)
      value.forEach((item, i) => errors.push(...checkSchema(schema.items, item, root, `${path}/${i}`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? [])
      if (value[key] === undefined) errors.push({ path: `${path}/${key}`, message: "is required" });
    const props = schema.properties ?? {};
    for (const [key, v] of Object.entries(value)) {
      if (props[key]) errors.push(...checkSchema(props[key], v, root, `${path}/${key}`));
      else if (schema.patternProperties && Object.keys(schema.patternProperties).length) {
        for (const [pattern, sub] of Object.entries(schema.patternProperties))
          if (new RegExp(pattern).test(key)) errors.push(...checkSchema(sub, v, root, `${path}/${key}`));
      } else if (schema.additionalProperties === false)
        errors.push({ path: `${path}/${key}`, message: "is not a known option" });
    }
  }
  return errors;
};

/** Defaults declared in a schema's top-level `properties`. */
export const defaultsFromSchema = (schema) =>
  Object.fromEntries(
    Object.entries(schema?.properties ?? {})
      .filter(([, s]) => s && s.default !== undefined)
      .map(([k, s]) => [k, s.default]),
  );

import type { Json } from "@plinth/spec";

/**
 * Canonical JSON in the style of RFC 8785 (spec 02 section 3.9.1): object keys sorted by UTF-16 code unit,
 * no insignificant whitespace, ES shortest round-trip numbers, `-0` written as `0`. Strings are NFC normalised
 * (section 3.9.2). The function is total: non-finite numbers cannot occur in decoded JSON and are written as
 * `null`, matching `JSON.stringify`. `undefined` object members are omitted.
 */
export const canonicalize = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value === 0 ? 0 : value) : "null";
    case "bigint":
      return value.toString();
    case "string":
      return JSON.stringify(value.normalize("NFC"));
    case "object": {
      if (Array.isArray(value)) return "[" + value.map((v) => canonicalize(v)).join(",") + "]";
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .map((k) => k.normalize("NFC"))
        .sort();
      const original = new Map(Object.keys(obj).map((k) => [k.normalize("NFC"), k] as const));
      return (
        "{" +
        keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[original.get(k) ?? k])).join(",") +
        "}"
      );
    }
    default:
      return "null";
  }
};

export const canonicalBytes = (value: unknown): Uint8Array => new TextEncoder().encode(canonicalize(value));

/** Structural equality on JSON values via canonical form. */
export const jsonEqual = (a: Json | undefined, b: Json | undefined): boolean =>
  canonicalize(a) === canonicalize(b);

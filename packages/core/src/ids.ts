import { createHash } from "node:crypto";
import { PLINTH_NS, URI_PATTERN, type Kind } from "@plinth/spec";

const hexToBytes = (hex: string): Buffer => Buffer.from(hex.replace(/-/g, ""), "hex");

/** RFC 4122 UUID version 5. */
export const uuidv5 = (namespace: string, name: string): string => {
  const h = createHash("sha1").update(hexToBytes(namespace)).update(Buffer.from(name, "utf8")).digest();
  h[6] = ((h[6] ?? 0) & 0x0f) | 0x50;
  h[8] = ((h[8] ?? 0) & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
};

export const workspaceId = (slug: string): string => uuidv5(PLINTH_NS, `workspace|${slug}`);

/** `UUIDv5(PLINTH_NS, "<workspace_id>|<Kind>|<slug>")` (spec 02 section 3.9.5). */
export const nodeId = (wsId: string, kind: Kind, slug: string): string =>
  uuidv5(PLINTH_NS, `${wsId}|${kind}|${slug}`);

export const principalId = (wsId: string, subject: string): string =>
  uuidv5(PLINTH_NS, `principal|${wsId}|${subject}`);

export const nodeUri = (workspaceSlug: string, kind: Kind, id: string): string =>
  `plinth://${workspaceSlug}/${kind}/${id}`;

export interface ParsedUri {
  readonly workspace: string;
  readonly kind: Kind;
  readonly id: string;
}

export const parseUri = (uri: string): ParsedUri | undefined => {
  if (!URI_PATTERN.test(uri)) return undefined;
  const [, rest = ""] = uri.split("plinth://");
  const [workspace = "", kind = "", id = ""] = rest.split("/");
  return { workspace, kind: kind as Kind, id };
};

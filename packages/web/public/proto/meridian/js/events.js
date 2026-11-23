// Vocabulary for change events: how a raw event is named for people.

/** The tag comes from the transport (surface), never from timing. */
export const tagOf = (e) => (e.surface === "mcp" ? "live" : e.surface === "driver" ? "replay" : e.surface);

export const isAgent = (actor) => actor.startsWith("agent:");

/** "agent:planner" becomes "agent planner"; "user:maya" becomes "maya". */
export const actorLabel = (actor) =>
  isAgent(actor) ? `agent ${actor.slice("agent:".length)}`.trim() : actor.replace(/^(user|service):/, "");

/** Kind segment of a node URI, e.g. plinth://ws/Panel/uuid gives "Panel". */
export const kindOf = (uri) => /\/([A-Za-z]+)\/[^/]+$/.exec(uri)?.[1] ?? "node";

export const shortId = (uri) => uri.split("/").pop()?.slice(0, 8) ?? uri;

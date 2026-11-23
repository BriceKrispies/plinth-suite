// The identity switcher: the principals the dev identity layer offers (featured first), a searchable dialog,
// and sign out of this tab (revoking the tab's own session).
import { h, clear } from "../ds/js/dom.js";
import { avatar } from "../ds/js/avatar.js";
import { pill } from "../ds/js/pill.js";
import { searchField } from "../ds/js/field.js";
import { openDialog, confirmDialog } from "../ds/js/dialog.js";
import { toast } from "../ds/js/toast.js";
import * as api from "../core/api.js";
import { meStore } from "../core/stores.js";
import { DEV_PEOPLE, principal, switchTo } from "../core/identity.js";
import { errorText } from "./kit.js";

const initialsOf = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

/** The fallback list, shaped like DevPrincipal, used until (or without) `dev.principals`. */
const fallback = () =>
  DEV_PEOPLE.map((p) => ({
    handle: p.handle,
    subject: `user:${p.handle}`,
    display_name: p.name,
    avatar: { initials: initialsOf(p.name), hue: (p.handle.length * 47) % 360 },
    roles: p.roles,
    region: p.region,
    token: `dev-user-${p.handle}`,
    featured: p.featured,
  }));

let cache = null;

/** `dev.principals` once; the fallback when the endpoint is absent (404 outside dev). */
export const loadPrincipals = () => {
  cache ??= api
    .call("dev.principals")
    .then((out) => out.items)
    .catch(() => fallback());
  return cache;
};

export const synchronousPrincipals = () => fallback();

/** The `?as=` value that switches to a principal: the handle, or the dev token for agents and services. */
export const targetOf = (p) => p.handle ?? p.token;
export const isCurrent = (p) => (p.handle ? p.handle === principal.handle : p.token === principal.token);

const matches = (p, q) =>
  `${p.display_name} ${p.handle ?? ""} ${p.roles.join(" ")} ${p.region ?? ""}`.toLowerCase().includes(q);

/** A searchable list of everyone the viewer can switch to. */
export const openIdentityDialog = async () => {
  const people = await loadPrincipals();
  const sorted = [...people].sort(
    (a, b) => Number(b.featured) - Number(a.featured) || a.display_name.localeCompare(b.display_name),
  );
  let query = "";
  const list = h("ul", { class: "w-ident__list", "aria-label": "People you can switch to" });
  const status = h("p", { class: "sr-only", role: "status" });
  const paint = () => {
    clear(list);
    const rows = sorted.filter((p) => !query || matches(p, query));
    status.textContent = `${rows.length} people`;
    for (const p of rows) {
      const current = isCurrent(p);
      list.append(
        h(
          "li",
          {},
          h(
            "button",
            {
              type: "button",
              class: "w-ident__row",
              disabled: current ? true : null,
              onclick: () => switchTo(targetOf(p)),
            },
            avatar({ name: p.display_name, avatar: p.avatar, size: "md" }),
            h(
              "span",
              { class: "w-ident__text" },
              h("span", { class: "w-ident__name" }, p.display_name),
              h(
                "span",
                { class: "w-ident__sub" },
                [p.roles.join(", ") || (p.handle ? "Member" : "Agent"), p.region].filter(Boolean).join(" · "),
              ),
            ),
            current ? pill({ label: "You", tone: "info" }) : p.featured ? pill({ label: "Featured" }) : null,
          ),
        ),
      );
    }
    if (rows.length === 0) list.append(h("li", { class: "w-hint" }, `Nobody matches ‘${query}’.`));
  };
  const field = searchField({
    name: "who",
    label: "Find someone",
    placeholder: "Name, role or region",
    onInput: (v) => {
      query = v.trim().toLowerCase();
      paint();
    },
  });
  paint();
  await openDialog({
    title: "Switch identity",
    size: "md",
    body: h("div", { class: "w-ident" }, field, status, list),
    actions: [{ label: "Close", value: null }],
  });
};

/** Revoke this tab's session; the socket then closes with 4401 and the page shows the signed-out notice. */
export const signOutThisTab = async () => {
  const sessionId = meStore.get()?.session_id;
  if (!sessionId) {
    toast({
      title: "This tab has no tracked session",
      body: "There is nothing to revoke here.",
      tone: "info",
    });
    return;
  }
  const ok = await confirmDialog({
    title: "Sign out of this tab?",
    message: "This tab's session is revoked. Your other tabs keep working.",
    confirmLabel: "Sign out",
    tone: "danger",
  });
  if (!ok) return;
  try {
    await api.call("me.sessions.revoke", { session_id: sessionId });
  } catch (e) {
    toast({ title: "Could not sign out", body: errorText(e), tone: "danger" });
  }
};

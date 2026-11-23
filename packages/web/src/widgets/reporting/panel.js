// reporting.panel: embeds an existing kernel Panel node by reference. The Panel's query and visual are read from
// the node, so editing the Panel (by anyone, including an agent) redraws this widget through the change stream.
import { schemaOf, catalogEntry } from "../../core/widgets.js";
import { mountVisual } from "./_visual-widget.js";

export default {
  id: "reporting.panel",
  domain: "reporting",
  title: "Saved panel",
  configSchema: schemaOf("reporting.panel"),
  sizes: catalogEntry("reporting.panel")?.sizes ?? [],
  mount(el, env) {
    let watchedUri = null;
    let reloadNow = () => {};
    let offNode = () => {};
    return (() => {
      const stop = mountVisual(el, env, {
        watch: (_env, reload) => {
          reloadNow = reload;
        },
        load: async ({ api, rt, config }) => {
          const node = await api.nodes.get(config.panel);
          if (node.uri !== watchedUri) {
            offNode();
            watchedUri = node.uri;
            offNode = rt.onNode(node.uri, () => reloadNow());
          }
          const body = node.body;
          const base = {
            node: { uri: node.uri, revision: node.revision, slug: node.slug },
            slug: node.slug,
            title: body?.metadata?.title ?? node.slug,
            visual: body?.spec?.visual,
            dashboard: config.dashboard,
          };
          if (typeof body?.spec?.query === "string")
            return {
              ...base,
              error: {
                code: "UNSUPPORTED",
                message: "Panels that reference a saved query are not available yet.",
              },
            };
          return { ...base, query: body?.spec?.query };
        },
      });
      return () => {
        offNode();
        stop();
      };
    })();
  },
};

// The web fonts GPU text needs (Inter and JetBrains Mono), registered and loaded only when the GPU paints text: the
// Enhanced tier on an expanded container with a fine pointer. Phones run hybrid text in the system UI font, so this
// module and its font files are never on a phone's download path (spec 00 section 0.6, "Base needs no glyph-atlas or
// SDF code"; the first-paint byte budget of C14). Imported dynamically, so the CSS and the font files are their own
// chunks.

import "@fontsource-variable/inter/wght.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import { MONO_FAMILY, UI_FAMILY } from "./fonts";

/** Latin text the prototype shows, so only the unicode-range subsets it needs are fetched (latin). */
const PRELOAD_SAMPLE = "AaZz09 €£ ·›‹←→–—−…“”‘’ ÀéÖøß";

export const loadFonts = async (): Promise<void> => {
  const faces = [
    `400 13px ${UI_FAMILY}`,
    `500 13px ${UI_FAMILY}`,
    `600 13px ${UI_FAMILY}`,
    `700 13px ${UI_FAMILY}`,
    `400 13px ${MONO_FAMILY}`,
    `600 13px ${MONO_FAMILY}`,
  ];
  await Promise.all(faces.map((f) => document.fonts.load(f, PRELOAD_SAMPLE)));
  await document.fonts.ready;
  document.documentElement.setAttribute("data-fonts", "web");
};

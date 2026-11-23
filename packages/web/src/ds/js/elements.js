// Registers every design-system custom element. Each element module also defines its own tag when it loads (so a
// helper works the first time it is called), and `define` skips a tag that is already defined, so importing this
// file from anywhere, any number of times, is safe. DESIGN-SYSTEM 6.29.
import { define } from "./element-base.js";
import { PIcon } from "./icons.js";
import { PPill } from "./pill.js";
import { PCount } from "./count-badge.js";
import { PAvatar, PPerson } from "./avatar.js";
import { PMenuButton } from "./menu.js";
import { PCombobox } from "./combobox.js";
import { PPeoplePicker } from "./people-picker.js";

/** Tag name to class, in registration order. */
export const ELEMENTS = {
  "p-icon": PIcon,
  "p-pill": PPill,
  "p-count": PCount,
  "p-avatar": PAvatar,
  "p-person": PPerson,
  "p-menu-button": PMenuButton,
  "p-combobox": PCombobox,
  "p-people-picker": PPeoplePicker,
};

export const defineAll = () => {
  for (const [tag, ctor] of Object.entries(ELEMENTS)) define(tag, ctor);
};
defineAll();

export { PIcon, PPill, PCount, PAvatar, PPerson, PMenuButton, PCombobox, PPeoplePicker };

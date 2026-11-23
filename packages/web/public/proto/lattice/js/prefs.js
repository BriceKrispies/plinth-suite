// Display preferences: theme and density. Per-viewer conveniences only; every access is guarded.
const KEY = 'lattice.prefs';
const defaults = { theme: 'system', density: 'comfortable' };

export const readPrefs = () => {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...defaults };
  }
};

export const applyPrefs = (prefs) => {
  const root = document.documentElement;
  if (prefs.theme === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = prefs.theme;
  root.dataset.density = prefs.density;
};

export const savePrefs = (prefs) => {
  applyPrefs(prefs);
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable: the choice still applies for this page */
  }
};

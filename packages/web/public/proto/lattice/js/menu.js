// Disclosure menus built on <details class="menu">: close on outside click, Escape and item activation.
export const initMenus = () => {
  document.addEventListener('click', (e) => {
    const inside = e.target.closest?.('details.menu');
    for (const open of document.querySelectorAll('details.menu[open]')) {
      if (open !== inside) open.open = false;
      else if (e.target.closest('.menu__item')) open.open = false;
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = document.querySelector('details.menu[open]');
    if (!open) return;
    open.open = false;
    open.querySelector('summary')?.focus();
    e.stopPropagation();
  });
};

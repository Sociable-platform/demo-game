import { useEffect, useId, useRef, useState } from 'react';

export default function AccountMenu({ username, onSettings, onLogout }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null), trigger = useRef(null), menu = useRef(null), initialFocus = useRef(0);
  const menuId = useId();
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelectorAll('[role="menuitem"]')[initialFocus.current]?.focus();
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const choose = action => { close(); action(); };
  const navigate = event => {
    const items = [...menu.current.querySelectorAll('[role="menuitem"]')];
    const index = items.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length
      : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
    if (next !== null) { event.preventDefault(); items[next].focus(); }
    if (event.key === 'Tab') close();
  };
  return (
    <div className="account-menu" ref={root}>
      <button ref={trigger} type="button" className="account-trigger" aria-label={`Account menu for ${username}`}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => { initialFocus.current = 0; setOpen(value => !value); }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); initialFocus.current = event.key === 'ArrowUp' ? 1 : 0; setOpen(true);
          }
        }}>
        <span className="account-avatar" aria-hidden="true">{username[0].toUpperCase()}</span>
        <span className="account-username">{username}</span>
        <span className="account-caret" aria-hidden="true">▾</span>
      </button>
      {open && <div ref={menu} id={menuId} className="account-dropdown" role="menu" aria-label="Account" onKeyDown={navigate}>
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => choose(onSettings)}>Account settings</button>
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => choose(onLogout)}>Log out</button>
      </div>}
    </div>
  );
}

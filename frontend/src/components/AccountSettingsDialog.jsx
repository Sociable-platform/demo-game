import { useEffect, useRef, useState } from 'react';
import DeleteAccountDialog from './DeleteAccountDialog.jsx';

export default function AccountSettingsDialog({ username, onClose, onDeleteAccount }) {
  const dialog = useRef(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal();
    return () => { dialog.current?.close(); previous?.focus?.(); };
  }, []);
  return <>
    <dialog ref={dialog} className="card account-settings-dialog" aria-labelledby="account-settings-title"
      onCancel={event => { event.preventDefault(); onClose(); }}>
      <h2 id="account-settings-title">Account settings</h2>
      <p className="account-signed-in">Signed in as <strong>{username}</strong></p>
      <section className="account-danger-zone" aria-labelledby="account-delete-heading">
        <h3 id="account-delete-heading">Delete account</h3>
        <p>This permanently removes your farm, coins and progress, and your Social profile. It can’t be undone.</p>
        <button type="button" className="account-delete-link" onClick={() => setConfirmDelete(true)}>Delete my account…</button>
      </section>
      <div className="account-settings-footer">
        <button type="button" className="btn account-settings-button" autoFocus onClick={onClose}>Done</button>
      </div>
    </dialog>
    {confirmDelete && <DeleteAccountDialog username={username} onClose={() => setConfirmDelete(false)} onDelete={onDeleteAccount} />}
  </>;
}

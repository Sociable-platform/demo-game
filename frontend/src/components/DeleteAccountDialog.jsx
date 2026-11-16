import { useEffect, useRef, useState } from 'react';

export default function DeleteAccountDialog({ username, onClose, onDelete }) {
  const dialog = useRef(null), submitting = useRef(false), active = useRef(false);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const previous = document.activeElement;
    active.current = true;
    dialog.current.showModal();
    return () => { active.current = false; dialog.current?.close(); previous?.focus?.(); };
  }, []);
  const confirm = async () => {
    if (submitting.current) return;
    submitting.current = true; setPending(true); setError('');
    try { await onDelete(); }
    catch (err) { if (active.current) setError(err.message || 'Account deletion could not finish. Please try again.'); }
    finally { submitting.current = false; if (active.current) setPending(false); }
  };
  return (
    <dialog ref={dialog} className="card modal account-delete-dialog" aria-labelledby="delete-account-title" aria-describedby="delete-account-description"
      onCancel={event => { event.preventDefault(); if (!submitting.current) onClose(); }}>
      <h2 id="delete-account-title">Delete account?</h2>
      <p id="delete-account-description">Your game account <strong>{username}</strong>, all farm progress, and your Social profile will be permanently deleted. This cannot be undone.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {pending && <p role="status">Deleting your account… Please wait.</p>}
      <div className="row modal-actions">
        <button type="button" className="btn" autoFocus disabled={pending} onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-danger" disabled={pending} onClick={confirm}>{pending ? 'Deleting…' : 'Delete account'}</button>
      </div>
    </dialog>
  );
}

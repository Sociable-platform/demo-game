/** Compact, non-blocking delivery feedback: the confirmed-reward message and the 2D-fallback "collect" pill. */
export default function DeliveryNotice({ message, waiting, onCollect }) {
  if (!message && !waiting) return null;
  return (
    <div className="delivery-note" role="status" aria-live="polite">
      {message && <span className="delivery-note-msg">{message}</span>}
      {waiting && !message && (
        <span className="delivery-note-wait">
          A courier is at your door.
          <button type="button" className="delivery-note-btn" onClick={onCollect}>Collect delivery</button>
        </span>
      )}
    </div>
  );
}

import { useCallback, useRef, useState } from 'react';

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (type, text) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { id, type, text }]);
      setTimeout(() => dismiss(id), type === 'error' ? 5000 : 3500);
    },
    [dismiss],
  );
  return { toasts, push, dismiss };
}

export function Toasts({ toasts, dismiss }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`toast toast-${t.type}`} onClick={() => dismiss(t.id)}>
          <span className="toast-mark" aria-hidden="true">{t.type === 'error' ? '!' : t.type === 'info' ? 'i' : '✓'}</span>
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}

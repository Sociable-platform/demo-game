import { useEffect, useRef, useState } from 'react';
import { Coin, CropIcon, Star } from './Icons.jsx';

const STEPS = [
  { title: 'Welcome to Harvest Village!', art: <CropIcon cropId="carrot" size={64} />, body: 'You have a little farm, 50 coins and 3 carrots. In Harvest Village a crop is also what you plant, just like in Minecraft.' },
  { title: '1. Plant', art: <CropIcon cropId="carrot" size={64} />, body: 'Choose a crop above the farm, then tap an empty plot to plant one. Out of crops? Buy one in the Shop.' },
  { title: '2. Wait and harvest', art: <CropIcon cropId="tomato" size={64} />, body: 'Each plot shows a countdown. When it glows and says “Ready!”, tap it to harvest and get 1–5 crops back. The server keeps the clock, so closing the tab won’t stop growth.' },
  { title: '3. Sell and level up', art: <Coin size={60} />, body: 'Sell extra crops in the Barn for coins, but keep some to plant again. Every harvest earns XP; at level 2 you unlock potatoes and pumpkins, the most valuable crop. Check the Quests button for goals to work towards.' },
];

export default function Tutorial({ onClose }) {
  const [step, setStep] = useState(0);
  const dialogRef = useRef(null);
  const last = step === STEPS.length - 1;

  useEffect(() => {
    const prev = document.activeElement;
    dialogRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  const s = STEPS[step];
  return (
    <div className="modal-backdrop">
      <div className="card modal" role="dialog" aria-modal="true" aria-labelledby="tut-title" tabIndex={-1} ref={dialogRef}>
        <div className="tut-art" aria-hidden="true">{s.art}</div>
        <h2 id="tut-title">{s.title}</h2>
        <p>{s.body}</p>
        <div className="dots" aria-hidden="true">
          {STEPS.map((_, i) => <span key={i} className={i === step ? 'is-on' : ''} />)}
        </div>
        <div className="row modal-actions">
          <button type="button" className="btn btn-small" onClick={onClose}>{last ? 'Close' : 'Skip'}</button>
          {step > 0 && <button type="button" className="btn btn-small" onClick={() => setStep(step - 1)}>Back</button>}
          <button type="button" className="btn btn-primary" onClick={() => (last ? onClose() : setStep(step + 1))}>
            {last ? 'Let’s farm!' : 'Next'}
          </button>
        </div>
        <p className="tut-foot"><Star size={14} /> Tip: the highlighted hint above the farm always tells you what to do next.</p>
      </div>
    </div>
  );
}

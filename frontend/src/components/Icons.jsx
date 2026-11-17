// Hand-drawn SVG icons (no emoji, so they look the same on every device).

const CROP_ART = {
  carrot: (
    <>
      <ellipse cx="18" cy="9" rx="3" ry="7" transform="rotate(-25 18 9)" fill="#5aa13a" />
      <ellipse cx="30" cy="9" rx="3" ry="7" transform="rotate(25 30 9)" fill="#5aa13a" />
      <ellipse cx="24" cy="7" rx="3" ry="8" fill="#6bb446" />
      <path d="M14.5 16Q24 11 33.5 16Q32 28 25.5 44.5Q24 46.5 22.5 44.5Q16 28 14.5 16Z" fill="#f28c28" />
      <path d="M18 22h5M26 29h5M20 34h4" stroke="#d96f12" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18 18q3-2 6-2" stroke="#fff" strokeOpacity=".35" strokeWidth="2" strokeLinecap="round" fill="none" />
    </>
  ),
  tomato: (
    <>
      <circle cx="24" cy="28" r="16" fill="#e5493a" />
      <ellipse cx="17.5" cy="21.5" rx="4.5" ry="2.6" fill="#fff" opacity=".35" transform="rotate(-35 17.5 21.5)" />
      <g fill="#4f9a3a">
        <ellipse cx="24" cy="14" rx="8.5" ry="3.2" />
        <ellipse cx="24" cy="14" rx="8.5" ry="3.2" transform="rotate(60 24 14)" />
        <ellipse cx="24" cy="14" rx="8.5" ry="3.2" transform="rotate(120 24 14)" />
      </g>
      <rect x="22.8" y="6" width="2.4" height="8" rx="1.2" fill="#3f7f2c" />
    </>
  ),
  potato: (
    <>
      <ellipse cx="24" cy="29" rx="17" ry="13.5" transform="rotate(-12 24 29)" fill="#c99a5b" />
      <ellipse cx="19" cy="24" rx="7" ry="3.2" fill="#fff" opacity=".25" transform="rotate(-25 19 24)" />
      <g fill="#9b6f38">
        <ellipse cx="17" cy="31" rx="1.8" ry="1.2" />
        <ellipse cx="27" cy="26" rx="1.8" ry="1.2" />
        <ellipse cx="31" cy="34" rx="1.8" ry="1.2" />
        <ellipse cx="22" cy="37" rx="1.5" ry="1" />
      </g>
    </>
  ),
  pumpkin: (
    <>
      <ellipse cx="14.5" cy="29" rx="9.5" ry="14" fill="#ee8420" />
      <ellipse cx="33.5" cy="29" rx="9.5" ry="14" fill="#ee8420" />
      <ellipse cx="24" cy="29" rx="9.5" ry="15.5" fill="#f79a3a" />
      <path d="M24 14.5Q20 29 24 43.5M16 17Q11 29 16 41M32 17Q37 29 32 41" stroke="#cf6c14" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M24 15c0-4 1-6 4.5-8" stroke="#5a8f3a" strokeWidth="4" strokeLinecap="round" fill="none" />
      <path d="M27 9c4-2 7 0 8 3-4 1-7 0-8-3z" fill="#6bb446" />
    </>
  ),
};

export function CropIcon({ cropId, size = 40, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      {CROP_ART[cropId]}
    </svg>
  );
}

export function SeedPacket({ cropId, size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path d="M10 5h28l3 7v32H7V12z" fill="#fff3d6" stroke="#c9a56a" strokeWidth="2" strokeLinejoin="round" />
      <path d="M7 12h34" stroke="#c9a56a" strokeWidth="2" />
      <g transform="translate(12.5 15) scale(.48)">{CROP_ART[cropId]}</g>
    </svg>
  );
}

/** Seedling that grows with `scale` (0.4 -> 1). */
export function Sprout({ scale = 1, size = 56 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false" className="sprout">
      <g transform={`translate(24 42) scale(${scale}) translate(-24 -42)`}>
        <path d="M24 42V24" stroke="#4d8f2f" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M24 28C13 28 10 19 13 13c9 0 12 7 11 15z" fill="#6bb446" />
        <path d="M24 24c0-9 5-13 12-13 1 8-3 13-12 13z" fill="#58a03a" />
      </g>
    </svg>
  );
}

export const Coin = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="10" fill="#f6c343" stroke="#d99a1b" strokeWidth="2" />
    <circle cx="12" cy="12" r="6" fill="none" stroke="#d99a1b" strokeWidth="1.5" />
    <path d="M9.5 9.5l2.5-1.5v8" stroke="#b97c10" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

export const Star = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill="#ffd45e" stroke="#d99a1b" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

export const Logo = ({ size = 36 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <circle cx="24" cy="24" r="22" fill="#f6d98a" stroke="#d9b45a" strokeWidth="2" />
    <path d="M24 40V24" stroke="#4d8f2f" strokeWidth="4" strokeLinecap="round" />
    <path d="M24 27C13 27 11 18 14 12c9 0 12 7 10 15z" fill="#6bb446" />
    <path d="M24 23c0-8 5-12 11-12 1 7-3 12-11 12z" fill="#58a03a" />
  </svg>
);

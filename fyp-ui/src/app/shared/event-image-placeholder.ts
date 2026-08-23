// Shown wherever a PublishedEvent/EventProposal has no uploaded event image
// (eventImage is null) — a plain camera-icon tile rather than a broken <img>.
export const EVENT_IMAGE_PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 225">
      <rect width="400" height="225" fill="#1b2436"/>
      <g fill="none" stroke="#5b6b8c" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="130" y="90" width="140" height="100" rx="10"/>
        <path d="M165 90 175 72h50l10 18"/>
        <circle cx="200" cy="140" r="28"/>
      </g>
    </svg>`,
  );

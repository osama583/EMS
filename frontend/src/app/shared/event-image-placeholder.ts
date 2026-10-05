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

// <img (error)> handler for a stored event image whose bytes are gone — an upload made before
// event_image's bytes moved into the database (migration 045), whose file only ever existed on one
// machine's backend/var/uploads. The row still points at it, so the URL resolves to a 404; show the
// same camera tile a proposal with no image at all gets, rather than the browser's broken-image icon.
export function onEventImageError(event: Event): void {
  const img = event.target as HTMLImageElement;
  if (img.src !== EVENT_IMAGE_PLACEHOLDER) img.src = EVENT_IMAGE_PLACEHOLDER;
}

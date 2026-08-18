// Mirrors the server's soft-delete.service.js response shapes exactly — GET .../:id/deletion-check
// (previewDeletion) and the daysRemaining/permanentDeletionAt fields every "Deleted" list endpoint
// adds on top of the entity's own normal projection.
export interface DeletionPreview {
  readonly canDelete: boolean;
  readonly blockingReasons: readonly string[];
  readonly entityLabel: string;
}

export interface DeletionMetadata {
  readonly deletedAt: string;
  readonly permanentDeletionAt: string;
  readonly daysRemaining: number;
}

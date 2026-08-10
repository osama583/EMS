import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-internal-placeholder',
  templateUrl: './internal-placeholder.html',
  styleUrl: './internal-placeholder.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InternalPlaceholderComponent {
  private readonly route = inject(ActivatedRoute);

  readonly eyebrow = (this.route.snapshot.data['eyebrow'] as string | undefined) ?? 'Workspace';
  readonly title = (this.route.snapshot.data['title'] as string | undefined) ?? 'Internal Page';
  readonly description =
    (this.route.snapshot.data['description'] as string | undefined) ??
    'This workspace is ready for its page content.';
  readonly icon = (this.route.snapshot.data['icon'] as string | undefined) ?? 'web_asset';
}

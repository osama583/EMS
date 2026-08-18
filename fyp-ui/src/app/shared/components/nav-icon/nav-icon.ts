import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { inject } from '@angular/core';

// Renders a nav_page icon: either raw inline SVG markup (uploaded through Page Visibility,
// server-sanitized in admin.routes.js's sanitizeSvgIcon()) or, for any icon string that isn't SVG
// markup, a legacy Material Symbol ligature name — the convention every nav_page row used before
// the icon-upload feature existed. Inlining (not <img>) is what lets `fill: currentColor` in the
// component's stylesheet recolor the icon to match the sidebar/table's text color, and the
// wrapper's fixed size is what keeps every uploaded SVG — regardless of its own viewBox/width/
// height — rendering at the same on-screen size as every other nav icon.
@Component({
  selector: 'app-nav-icon',
  template: `
    @if (isSvg()) {
      <span class="nav-icon nav-icon--svg" [innerHTML]="safeSvg()" aria-hidden="true"></span>
    } @else if (icon()) {
      <span class="nav-icon material-symbols-rounded" aria-hidden="true">{{ icon() }}</span>
    }
  `,
  styleUrl: './nav-icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavIconComponent {
  private readonly sanitizer = inject(DomSanitizer);
  readonly icon = input<string | null | undefined>(null);
  readonly isSvg = computed(() => /^\s*<svg[\s>]/i.test(this.icon() || ''));
  readonly safeSvg = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(this.icon() || ''));
}

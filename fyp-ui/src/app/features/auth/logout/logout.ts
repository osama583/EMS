import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';

@Component({ selector: 'app-logout', template: '', changeDetection: ChangeDetectionStrategy.OnPush })
export class LogoutComponent implements OnInit {
  private readonly auth = inject(AuthService);
  ngOnInit(): void { this.auth.logout(); }
}

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AuthService } from '../../../../core/auth/auth.service';
import { UserAvatarComponent } from '../../../../shared/components/user-avatar/user-avatar';

@Component({
  selector: 'app-profile',
  imports: [UserAvatarComponent],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileComponent {
  private readonly auth = inject(AuthService);
  readonly user = this.auth.user;
  readonly details = computed(() => {
    const user = this.user();
    if (!user) return [];
    return [
      { label: 'Email', value: user.email },
      { label: 'Role', value: user.roleLabel },
      { label: 'Department', value: user.department },
    ];
  });
}

import { ChangeDetectionStrategy, Component } from '@angular/core';

// A route target with no markup of its own — the singleton <app-ai-assistant> mounted in app.html
// detects the /assistant (or /app/assistant) URL and renders itself full-page (see ai-assistant.ts's
// syncToRoute()).
@Component({
  selector: 'app-ai-assistant-page',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiAssistantPageComponent {}

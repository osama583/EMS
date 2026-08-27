import { ChangeDetectionStrategy, Component } from '@angular/core';

// A route target with no markup of its own — the singleton <app-ai-assistant> mounted in
// app.html detects the /assistant (or /app/assistant) URL and renders itself full-page (see
// ai-assistant.ts's syncToRoute()). This component only exists so the router has something to
// activate; the visible content comes entirely from the widget.
@Component({
  selector: 'app-ai-assistant-page',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiAssistantPageComponent {}

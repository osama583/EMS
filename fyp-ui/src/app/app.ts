import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AiAssistantComponent } from './shared/components/ai-assistant/ai-assistant';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AiAssistantComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}

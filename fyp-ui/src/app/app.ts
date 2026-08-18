import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AiAssistantComponent } from './shared/components/ai-assistant/ai-assistant';
import { ToastHostComponent } from './shared/components/toast/toast';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AiAssistantComponent, ToastHostComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}

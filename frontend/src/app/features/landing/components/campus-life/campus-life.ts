import { ChangeDetectionStrategy, Component } from '@angular/core';

interface CampusLifePillar {
  readonly number: string;
  readonly title: string;
  readonly detail: string;
}

@Component({
  selector: 'app-campus-life',
  templateUrl: './campus-life.html',
  styleUrl: './campus-life.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CampusLifeComponent {
  readonly pillars: readonly CampusLifePillar[] = [
    {
      number: '01',
      title: 'Learn beyond lectures',
      detail: 'Turn ideas into experiences through projects, workshops and real-world opportunities.',
    },
    {
      number: '02',
      title: 'Meet the world',
      detail: 'Build friendships in a diverse community shaped by cultures from across the globe.',
    },
    {
      number: '03',
      title: 'Find what moves you',
      detail: 'Explore societies, sports, performances and interests that make campus feel like yours.',
    },
    {
      number: '04',
      title: 'Make it memorable',
      detail: 'Create the moments, connections and stories that stay with you beyond graduation.',
    },
  ];
}

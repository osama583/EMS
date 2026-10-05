import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  signal,
} from '@angular/core';
import { CtaLinkComponent } from '../../../../shared/components/cta-link/cta-link';

const VIDEO_START_OFFSET = 0.08;
const CROSSFADE_DURATION_MS = 700;

@Component({
  selector: 'app-hero',
  imports: [CtaLinkComponent],
  templateUrl: './hero.html',
  styleUrl: './hero.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeroComponent implements AfterViewInit, OnDestroy {
  @ViewChild('heroSection', { static: true })
  private heroSection!: ElementRef<HTMLElement>;

  @ViewChild('videoA', { static: true })
  private videoA!: ElementRef<HTMLVideoElement>;

  @ViewChild('videoB', { static: true })
  private videoB!: ElementRef<HTMLVideoElement>;

  private crossfadeTimer?: ReturnType<typeof setTimeout>;
  private visibilityObserver?: IntersectionObserver;
  private readonly mediaAbortController = new AbortController();
  private isCrossfading = false;
  private isHeroVisible = true;
  private isDestroyed = false;

  readonly headline = 'There’s always something happening at APU';
  readonly activeVideo = signal<0 | 1>(0);
  readonly outgoingVideo = signal<0 | 1 | null>(null);

  ngAfterViewInit(): void {
    void this.playVideo(this.videoA.nativeElement);
    this.prepareStandby(1);
    this.observeHeroVisibility();
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
    this.clearCrossfadeTimer();
    this.mediaAbortController.abort();
    this.visibilityObserver?.disconnect();
    this.pauseVideos();
  }

  onTimeUpdate(index: 0 | 1): void {
    if (!this.isHeroVisible || this.isCrossfading || this.activeVideo() !== index) {
      return;
    }

    const current = this.videoFor(index);
    const remaining = current.duration - current.currentTime;

    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 1.3) {
      return;
    }

    this.beginCrossfade(index);
  }

  private beginCrossfade(fromIndex: 0 | 1): void {
    this.isCrossfading = true;
    const nextIndex: 0 | 1 = fromIndex === 0 ? 1 : 0;
    const current = this.videoFor(fromIndex);
    const next = this.videoFor(nextIndex);

    Promise.resolve(next.play())
      .then(() => this.waitForPresentedFrame(next))
      .then(() => {
        if (this.isDestroyed || !this.isHeroVisible) {
          next.pause();
          this.isCrossfading = false;
          return;
        }

        this.outgoingVideo.set(fromIndex);
        this.activeVideo.set(nextIndex);
        this.crossfadeTimer = setTimeout(() => {
          current.pause();
          current.currentTime = VIDEO_START_OFFSET;
          this.outgoingVideo.set(null);
          this.isCrossfading = false;
          this.prepareStandby(fromIndex);
        }, CROSSFADE_DURATION_MS);
      })
      .catch(() => {
        this.isCrossfading = false;
      });
  }

  private async playVideo(video: HTMLVideoElement): Promise<void> {
    if (this.isDestroyed || !this.isHeroVisible) {
      return;
    }

    try {
      await video.play();
    } catch {
      // Muted autoplay may still be delayed until the browser is ready.
    }
  }

  private pauseVideos(): void {
    this.videoA?.nativeElement.pause();
    this.videoB?.nativeElement.pause();
  }

  private prepareStandby(index: 0 | 1): void {
    const video = this.videoFor(index);
    const prime = (): void => {
      if (this.isDestroyed || this.activeVideo() === index || this.isCrossfading) {
        return;
      }

      video.currentTime = VIDEO_START_OFFSET;
      Promise.resolve(video.play())
        .then(() => this.waitForPresentedFrame(video))
        .then(() => {
          if (this.isDestroyed || this.activeVideo() === index || this.isCrossfading) {
            return;
          }

          video.pause();
          video.currentTime = VIDEO_START_OFFSET;
        })
        .catch(() => {
          // The normal crossfade play call will retry if priming is restricted.
        });
    };

    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      prime();
      return;
    }

    video.addEventListener('canplay', prime, {
      once: true,
      signal: this.mediaAbortController.signal,
    });
  }

  private observeHeroVisibility(): void {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }

    this.visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        const isVisible = entry?.isIntersecting ?? true;

        if (isVisible === this.isHeroVisible) {
          return;
        }

        this.isHeroVisible = isVisible;
        if (!isVisible) {
          this.pauseVideos();
          return;
        }

        void this.playVideo(this.videoFor(this.activeVideo()));
        this.prepareStandby(this.activeVideo() === 0 ? 1 : 0);
      },
      { threshold: 0.12 },
    );
    this.visibilityObserver.observe(this.heroSection.nativeElement);
  }

  private videoFor(index: 0 | 1): HTMLVideoElement {
    return index === 0 ? this.videoA.nativeElement : this.videoB.nativeElement;
  }

  private waitForPresentedFrame(video: HTMLVideoElement): Promise<void> {
    if (typeof video.requestVideoFrameCallback !== 'function') {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      video.requestVideoFrameCallback(() => resolve());
    });
  }

  private clearCrossfadeTimer(): void {
    if (this.crossfadeTimer) {
      clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = undefined;
    }
    this.outgoingVideo.set(null);
    this.isCrossfading = false;
  }
}

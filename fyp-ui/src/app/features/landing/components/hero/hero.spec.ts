import { TestBed } from '@angular/core/testing';
import { HeroComponent } from './hero';

describe('HeroComponent', () => {
  beforeEach(async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);

    await TestBed.configureTestingModule({
      imports: [HeroComponent],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts crossfading with about 1.3 seconds remaining', async () => {
    const fixture = TestBed.createComponent(HeroComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const firstVideo = fixture.nativeElement.querySelectorAll('video')[0] as HTMLVideoElement;

    Object.defineProperty(firstVideo, 'duration', {
      configurable: true,
      value: 6,
    });
    firstVideo.currentTime = 4.8;

    component.onTimeUpdate(0);

    await vi.waitFor(() => expect(component.activeVideo()).toBe(1));
    expect(component.outgoingVideo()).toBe(0);
  });

  it('uses the supplied poster and primes the standby video', async () => {
    const fixture = TestBed.createComponent(HeroComponent);
    fixture.detectChanges();
    const videos = [...fixture.nativeElement.querySelectorAll('video')] as HTMLVideoElement[];

    expect(videos.every((video) => video.poster.endsWith('/assets/media/video-start-iamge.jpg'))).toBe(
      true,
    );
    expect(videos.every((video) => video.preload === 'auto')).toBe(true);

    videos[1].dispatchEvent(new Event('canplay'));

    await vi.waitFor(() => {
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
      expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    });
  });

  it('pauses both videos outside the hero viewport and resumes the active one', async () => {
    let intersectionCallback!: IntersectionObserverCallback;
    const observe = vi.fn();
    const disconnect = vi.fn();

    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
      takeRecords = vi.fn().mockReturnValue([]);
      root = null;
      rootMargin = '0px';
      thresholds = [0.12];
    }

    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

    const fixture = TestBed.createComponent(HeroComponent);
    fixture.detectChanges();

    intersectionCallback(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(2);

    intersectionCallback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    await Promise.resolve();

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    expect(observe).toHaveBeenCalled();
  });

  it('renders the headline as three cinematic reveal lines', () => {
    const fixture = TestBed.createComponent(HeroComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const headline = fixture.nativeElement.querySelector('h1') as HTMLHeadingElement;
    const lines = [...headline.querySelectorAll('.headline-line__text')].map((line) =>
      line.textContent?.trim(),
    );

    expect(headline.getAttribute('aria-label')).toBe(component.headline);
    expect(lines).toEqual(['There’s always', 'something happening', 'at APU']);
  });

  it('stages the Explore Events CTA after the headline', () => {
    const fixture = TestBed.createComponent(HeroComponent);
    fixture.detectChanges();

    const reveal = fixture.nativeElement.querySelector('.hero-cta-reveal') as HTMLElement;
    const cta = fixture.nativeElement.querySelector('app-cta-link .cta-link') as HTMLAnchorElement;

    expect(reveal).not.toBeNull();
    expect(cta.getAttribute('href')).toBe('#explore-events');
  });
});

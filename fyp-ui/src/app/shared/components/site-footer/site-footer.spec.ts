import { TestBed } from '@angular/core/testing';
import { SiteFooterComponent } from './site-footer';

describe('SiteFooterComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SiteFooterComponent],
    }).compileComponents();
  });

  it('renders the official APU awards and social links at constrained sizes', () => {
    const fixture = TestBed.createComponent(SiteFooterComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.site-footer__logo')).toBeNull();
    expect(element.querySelectorAll('.site-footer__badge')).toHaveLength(5);
    expect(element.querySelector('.site-footer__badge--talentbank img')).not.toBeNull();
    expect(element.querySelectorAll('.site-footer__socials a')).toHaveLength(6);
  });

  it('renders all six navigation groups and the legal information without a chatbot', () => {
    const fixture = TestBed.createComponent(SiteFooterComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const headings = [...element.querySelectorAll('.site-footer__group h2')].map((heading) =>
      heading.textContent?.trim(),
    );

    expect(headings).toEqual(['Study', 'Campus', 'Hall', 'International', 'About', 'Connect']);
    expect(element.querySelectorAll('.site-footer__group li')).toHaveLength(29);
    expect(element.textContent).toContain('Copyright 2026');
    expect(element.textContent).not.toContain('AI Assistant');
    expect(element.textContent).not.toContain('Chat with us');
  });
});

import { TestBed } from '@angular/core/testing';
import { OptionItemDetailsModalComponent } from './option-item-details-modal';
import { OptionCardViewModel } from '../option-card-grid/option-card-grid.models';

describe('OptionItemDetailsModalComponent', () => {
  const BASE: OptionCardViewModel = {
    id: 'item-1',
    label: 'Chicken Rice Box',
    description: 'Steamed chicken with rice and soup.',
    active: true,
    imageDataUrl: '',
    imageFileName: '',
  };

  async function render(item: OptionCardViewModel | null) {
    await TestBed.configureTestingModule({ imports: [OptionItemDetailsModalComponent] }).compileComponents();
    const fixture = TestBed.createComponent(OptionItemDetailsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('item', item);
    fixture.detectChanges();
    return fixture;
  }

  it('sends prose fields to the note block and everything else to the ledger', async () => {
    const fixture = await render({
      ...BASE,
      metaFields: [
        { label: 'Capacity', value: '40 passengers', icon: 'group' },
        { label: 'Instructions', value: 'Book 48 hours ahead.', icon: 'article', isNotes: true },
      ],
    });

    expect(fixture.componentInstance.specs().map((spec) => spec.label)).toEqual(['Capacity']);
    expect(fixture.componentInstance.notes().map((note) => note.label)).toEqual(['Instructions']);
  });

  it('gives the flat fields the same icons and tones the card grid uses for them', async () => {
    const fixture = await render({
      ...BASE,
      servingUnitLabel: 'Per Box',
      dietaryInformationLabel: 'Halal',
      orderingNotes: 'Order by 4pm the day before.',
    });

    expect(fixture.componentInstance.specs()).toEqual([
      { label: 'Serving unit', value: 'Per Box', icon: 'restaurant', badgeTone: 'blue' },
      { label: 'Dietary info', value: 'Halal', icon: 'nutrition', badgeTone: 'emerald' },
    ]);
    expect(fixture.componentInstance.notes().map((note) => note.value)).toEqual(['Order by 4pm the day before.']);
  });

  it('prefers the caller-built meta fields over the flat ones', async () => {
    const fixture = await render({
      ...BASE,
      servingUnitLabel: 'Per Box',
      metaFields: [{ label: 'Price', value: 'RM 8.50', icon: 'payments', badgeTone: 'amber' }],
    });

    expect(fixture.componentInstance.specs().map((spec) => spec.label)).toEqual(['Price']);
  });

  it('stops a broken image latching the placeholder on for the next item opened', async () => {
    const fixture = await render({ ...BASE, imageDataUrl: 'data:image/png;base64,not-an-image' });
    fixture.componentInstance.onImageError();
    fixture.detectChanges();

    expect(fixture.componentInstance.imageFailed()).toBe(true);

    fixture.componentRef.setInput('item', { ...BASE, id: 'item-2', imageDataUrl: 'data:image/png;base64,fine' });
    fixture.detectChanges();

    expect(fixture.componentInstance.imageFailed()).toBe(false);
  });
});

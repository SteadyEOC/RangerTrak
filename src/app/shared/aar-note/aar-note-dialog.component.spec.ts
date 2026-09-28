import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { AarNoteDialogComponent, AarNoteDialogData } from './aar-note-dialog.component';
import { AarNoteService } from '../services';
import { recordStore } from '../storage/record-store';

describe('AarNoteDialogComponent', () => {
  let component: AarNoteDialogComponent;
  let fixture: ComponentFixture<AarNoteDialogComponent>;
  let dialogRefSpy: jasmine.SpyObj<MatDialogRef<AarNoteDialogComponent, boolean>>;
  let router: Router;

  beforeEach(async () => {
    localStorage.clear();
    await recordStore.resetForTests();

    dialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close']);

    await TestBed.configureTestingModule({
      imports: [AarNoteDialogComponent],
      providers: [
        // routerLink-free here (unlike install-update's help zone), but onSeeAll() below
        // calls Router.navigate() directly - a real Router still needs a config, even empty.
        provideRouter([]),
        { provide: MatDialogRef, useValue: dialogRefSpy },
        { provide: MAT_DIALOG_DATA, useValue: { page: 'Entry' } as AarNoteDialogData },
      ],
    }).compileComponents();
  });

  afterEach(async () => {
    localStorage.clear();
    await recordStore.resetForTests();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(AarNoteDialogComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // 2026-09-27: the dialog's own way back to the (now off-the-main-nav) AAR notes page - see
  // navbar.component.html's own removal note.
  describe('"See all notes (N)" link', () => {
    it('is hidden when there are no notes captured yet on this device', () => {
      expect(component.noteCount()).toBe(0);
      expect(fixture.nativeElement.querySelector('[data-testid="aar-note-see-all"]')).toBeNull();
    });

    it('shows the current count once at least one note exists', () => {
      TestBed.inject(AarNoteService).addNote('Relay point out of range', 'incident', 'Entry');
      fixture.detectChanges();

      const link: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="aar-note-see-all"]');
      expect(link).not.toBeNull();
      expect(link.textContent?.trim()).toBe('See all notes (1)');
    });

    it('tracks the count as more notes are captured', () => {
      const notes = TestBed.inject(AarNoteService);
      notes.addNote('Relay point out of range', 'incident', 'Entry');
      notes.addNote('MGRS field slow to type', 'app', 'Rangers & Teams');
      fixture.detectChanges();

      const link: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="aar-note-see-all"]');
      expect(link.textContent?.trim()).toBe('See all notes (2)');
    });

    it('closes the dialog as unsaved and navigates to /after-action, not the save path', () => {
      TestBed.inject(AarNoteService).addNote('Relay point out of range', 'incident', 'Entry');
      fixture.detectChanges();
      spyOn(router, 'navigate');

      fixture.nativeElement.querySelector('[data-testid="aar-note-see-all"]').click();

      // `false`, matching Cancel - not `true` (Save's result) - so the header's own
      // afterClosed() subscriber does not also offer its "View" snackbar on top of a
      // navigation that already landed on the page it would have pointed to.
      expect(dialogRefSpy.close).toHaveBeenCalledWith(false);
      expect(router.navigate).toHaveBeenCalledWith(['/after-action']);
    });
  });

  // 2026-09-27: Feedback and an AAR note marked RangerTrak are easy to confuse (see
  // help-feedback.component.html's own note) - this caveat only applies to that choice.
  describe('the "private until sent" hint for the RangerTrak choice', () => {
    it('is absent for the default (incident) choice', () => {
      expect(component.about()).toBe('incident');
      const hints = [...fixture.nativeElement.querySelectorAll('.rt-aar-dialog__hint')]
        .map((p: HTMLElement) => p.textContent?.trim());
      expect(hints.some(t => t?.includes('Private until'))).toBeFalse();
    });

    it('appears once RangerTrak is chosen', () => {
      component.about.set('app');
      fixture.detectChanges();
      const hints = [...fixture.nativeElement.querySelectorAll('.rt-aar-dialog__hint')]
        .map((p: HTMLElement) => p.textContent?.trim());
      expect(hints.some(t => t?.includes('Private until you choose to send it as feedback'))).toBeTrue();
    });
  });
});

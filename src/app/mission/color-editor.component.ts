import { ICellEditorAngularComp } from 'ag-grid-angular'
import { ArgumentOutOfRangeError } from 'rxjs'

import { AfterViewInit, Component, Input, ViewChild, ViewContainerRef, ChangeDetectionStrategy } from '@angular/core'
import {
  AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule, UntypedFormControl, Validators
} from '@angular/forms'
import { MatCardModule } from '@angular/material/card';
import { ThemePalette } from '@angular/material/core'
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { parseColor, statusColorValue } from '../shared/services/status-color'




// TODO: Consider https://www.npmjs.com/package/@angular-material-components/datetime-picker as a replacement to current timepicker/colorpicker?
// https://github.com/h2qutc/angular-material-components
// it is updated to NG 16...








// TODO: Consider switching to https://github.com/brianpkelley/md-color-picker
// https://www.ag-grid.com/angular-data-grid/component-cell-editor
// TODO: Based on boolean value for icons: we need a selection from a panel of icons...
@Component({
  selector: 'editor-cell',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule
  ],
  templateUrl: './color-editor-component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./color-editor-component.scss',],
})
export class ColorEditor implements ICellEditorAngularComp, AfterViewInit {

  @Input() childItem = '';  // [childItem]="parentItem" in child.html, parentItem='Some string' in parent.ts

  // https://stackblitz.com/edit/pputo1--run
  // Pass an object from parent to nested component (child gets array from parent)
  // parent.html: <app-item-list [items]="currentItems"></app-item-list>
  // parent.ts: currentItems = [{ id: 21,  name: 'phone' }];
  // child.ts: @Input() items: Item[] = [];  type.ts: export interface Item { id: number; name: string; }

  /*
    @ViewChild('container', { read: ViewContainerRef })
    public container!: ViewContainerRef;
  */
  private params: any;
  colorCtr: UntypedFormControl;
  colorCntlDisabled = false;
  touchUi = false;
  public colorPalette: ThemePalette = 'primary';
  public color: string = '#00ff00'; // Default green

  constructor() {
    // Initialize with default green color
    this.colorCtr = new UntypedFormControl('#00ff00', [Validators.required]);
  }
  // dont use afterGuiAttached for post gui events - hook into ngAfterViewInit instead for this
  ngAfterViewInit() {
    window.setTimeout(() => {
      //  this.container.element.nativeElement.focus();
    });
  }

  ngOnDestroy() {
    // TODO: How to get this event from the ColorPicker?!
    // https://angular.io/guide/lifecycle-hooks#cleaning-up-on-instance-destruction
  }

  agInit(params: any): void {
    this.params = params;
    // If the cell has an existing color value, use it
    if (params.value) {
      this.color = params.value;
      // 2026-09-30, John: Radio log statuses opened the picker on black while Location
      // categories showed their colour. Statuses store a semantic key ('need-rest-food') and
      // older data a CSS name ('chartreuse'); <input type=color> accepts only #rrggbb and
      // falls back to black. Show the resolved colour instead. `this.color` keeps the stored
      // key, so closing the picker without choosing leaves the saved value (and its
      // light/dark pair) untouched.
      this.colorCtr.setValue(pickerHex(this.color) ?? this.color);
    }
    console.log(`agInit color = ${this.color}`);
  }

  // called by ag-grid
  getValue(): any {
    console.log(`getValue = ${this.color}`);
    return this.color;
  }

  // Gets called when color picker value changes
  onColorChange() {
    this.color = this.colorCtr.value;
    console.log(`onColorChange = ${this.color}`);
    this.params.api.stopEditing(); // close inline editor
  }

  // -------------- REST OF THESE ARE EXTRANEOUS???  ----------------------------

  isPopup(): boolean {
    console.log(`isPopup = ${this.color}`);
    return false;
  }

  setColor(color: string): void {
    console.log(`setValue = ${color}`);
    this.color = color;
    this.colorCtr.setValue(color);
  }

  onClick(event: any) {
    // No longer needed with native color input
  }

  onMouseDown(event: any): void {
    event.stopPropagation();
  }

  onKeyDown(event: any): void {
    const key = event.key;
    if (key === 'ArrowLeft' || key == 'ArrowRight') {
      event.stopPropagation();
    }
  }
}

/**
 * The #rrggbb an <input type=color> can show for any stored colour - a hex, a status key
 * (resolved through its `--rt-status-*` token for the current scheme) or a CSS colour name.
 * Resolved by letting the browser compute it on a throwaway element. Null if it can't.
 */
function pickerHex(stored: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(stored)) return stored
  const probe = document.createElement('span')
  probe.style.color = statusColorValue(stored)
  document.body.appendChild(probe)
  const rgb = parseColor(getComputedStyle(probe).color)
  probe.remove()
  return rgb ? '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('') : null
}

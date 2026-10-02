import { ITooltipComp, ITooltipParams } from 'ag-grid-community'

import { AI_PHOTO_LABEL, isAiGeneratedPhoto } from '../shared/ai-photo'
import { bundledRangerImage } from '../shared/ranger-image'
import { BUNDLED_IMAGE_DIRECTORY } from '../shared/services/mission-migration'

export class CustomTooltip implements ITooltipComp {
  eGui: any;
  init(params: ITooltipParams & { color: string }) {
    const eGui = (this.eGui = document.createElement('div'));
    // E-166 (2026-09-30): this is the grid's defaultColDef tooltipComponent, so it is now also
    // asked to draw column HEADER tooltips, where there is no row (or photo) to show. Those get
    // a plain text box; only a real row cell gets the photo card below.
    if (params.location === 'header' || params.rowIndex == null) {
      // 2026-10-01, John (Kevin Mitcham's report): the header box had no background, so long
      // hints ran see-through over the cells and borders. Styled inline from the theme tokens:
      // .custom-tooltip in rangers.component.scss never reaches this element, because component
      // styles are scoped and AG Grid creates it outside Angular.
      eGui.classList.add('custom-tooltip')
      Object.assign(eGui.style, {
        padding: '8px 12px',
        maxWidth: '320px',
        background: 'var(--rt-surface)',
        color: 'var(--rt-ink)',
        border: '1px solid var(--rt-line)',
        borderRadius: 'var(--rt-radius)',
        boxShadow: '0 2px 8px rgb(0 0 0 / 25%)',
        whiteSpace: 'normal',
        lineHeight: '1.35',
      })
      eGui.textContent = String(params.value ?? '')
      return
    }
    const color = params.color || 'white';
    const data = params.api!.getDisplayedRowAtIndex(params.rowIndex!)!.data;

    eGui.classList.add('custom-tooltip');
    //@ts-ignore
    eGui.style['background-color'] = color
    eGui.innerHTML = `
    <p>
    <img class="licenseImg" style="height:256px; width:256px;" alt= "${params.data.fullName}"
    src= "${BUNDLED_IMAGE_DIRECTORY}rangers/${bundledRangerImage(params.data.image)}"><br>
    ${isAiGeneratedPhoto(params.data.image) ? `<span class="rt-ai-caption">${AI_PHOTO_LABEL}</span>` : ''}
                <span class"name">&nbsp;&nbsp;${data.fullName}</span> - <span >callsign: </span>
                ${data.callsign}
            </p>`

  }

  getGui() {
    return this.eGui;
  }
}

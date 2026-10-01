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
      eGui.classList.add('custom-tooltip')
      eGui.style.padding = '8px 12px'
      eGui.style.maxWidth = '320px'
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

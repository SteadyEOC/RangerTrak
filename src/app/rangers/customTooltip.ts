import { ITooltipComp, ITooltipParams } from 'ag-grid-community'

export class CustomTooltip implements ITooltipComp {
  eGui: any;
  init(params: ITooltipParams & { color: string }) {
    const eGui = (this.eGui = document.createElement('div'));
    const color = params.color || 'white';
    const data = params.api!.getDisplayedRowAtIndex(params.rowIndex!)!.data;

    eGui.classList.add('custom-tooltip');
    //@ts-ignore
    eGui.style['background-color'] = color
    // #81 finding (real, open - see the roadmap list): the image path below is hardcoded
    // rather than read from settings.imageDirectory (mission.component.ts's own imgDir field) -
    // harmless today since both are always the same bundled path, but a latent inconsistency
    // if imageDirectory is ever made genuinely configurable.
    eGui.innerHTML = `
    <p>
    <img class="licenseImg" style="height:256px; width:256px;" alt= "${params.data.fullName}"
    src= "./assets/imgs/rangers/${params.data.image}"><br>
                <span class"name">&nbsp;&nbsp;${data.fullName}</span> - <span >callsign: </span>
                ${data.callsign}
            </p>`

  }

  getGui() {
    return this.eGui;
  }
}

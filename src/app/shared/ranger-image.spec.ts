import { bundledRangerImage } from './ranger-image'

describe('bundledRangerImage', () => {
  it('maps removed clipart names to the matching badge', () => {
    expect(bundledRangerImage('CmdPost.jpg')).toBe('badge-cmd.svg')
    expect(bundledRangerImage('CERT_blue.png')).toBe('badge-cert.svg')
    expect(bundledRangerImage('MERT_red.png')).toBe('badge-medic.svg')
    expect(bundledRangerImage('ham_yellow.png')).toBe('badge-ham.svg')
    expect(bundledRangerImage('ham.png')).toBe('badge-ham.svg')
    expect(bundledRangerImage('male.png')).toBe('badge-ranger.svg')
    expect(bundledRangerImage('Yacht_purple.png')).toBe('badge-ranger.svg')
  })
  it('passes current files and blanks through unchanged', () => {
    expect(bundledRangerImage('cert1.jpg')).toBe('cert1.jpg')
    expect(bundledRangerImage('badge-ham.svg')).toBe('badge-ham.svg')
    expect(bundledRangerImage('')).toBe('')
  })
})

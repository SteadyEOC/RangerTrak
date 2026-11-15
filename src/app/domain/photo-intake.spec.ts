import { strToU8, zipSync } from 'fflate'

import { describeSkipped, intakePhotoFiles, isZipFile } from './photo-intake'

const pic = (name: string, type = 'image/jpeg') => new File([new Uint8Array([1, 2, 3])], name, { type })
const zipFile = (name: string, entries: Record<string, Uint8Array>) =>
  new File([zipSync(entries) as BlobPart], name, { type: 'application/zip' })

describe('intakePhotoFiles (E-295)', () => {
  it('takes loose pictures as they are', async () => {
    const r = await intakePhotoFiles([pic('K7VMI.jpg'), pic('W7ABC.png', 'image/png')])
    expect(r.images.map(f => f.name)).toEqual(['K7VMI.jpg', 'W7ABC.png'])
    expect(r.skipped).toEqual([])
  })

  it('skips files that are not pictures and says what they were', async () => {
    const r = await intakePhotoFiles([
      pic('K7VMI.jpg'),
      new File(['x'], 'notes.txt', { type: 'text/plain' }),
      pic('logo.svg', 'image/svg+xml'),
    ])
    expect(r.images.map(f => f.name)).toEqual(['K7VMI.jpg'])
    expect(r.skipped).toEqual([
      { name: 'notes.txt', reason: 'not a picture (.txt)' },
      { name: 'logo.svg', reason: 'not a picture (.svg)' },
    ])
  })

  it('opens a zip, uses its pictures (folders inside are fine) and lists the rest', async () => {
    const z = zipFile('team.zip', {
      'photos/K7VMI.jpg': new Uint8Array([1]),
      'photos/W7ABC.PNG': new Uint8Array([2]),
      'photos/readme.docx': new Uint8Array([3]),
      '__MACOSX/photos/._K7VMI.jpg': new Uint8Array([4]),
    })
    const r = await intakePhotoFiles([z])
    expect(r.images.map(f => f.name).sort()).toEqual(['K7VMI.jpg', 'W7ABC.PNG'])
    expect(r.images.find(f => f.name === 'W7ABC.PNG')!.type).toBe('image/png')
    expect(r.skipped).toEqual([{ name: 'team.zip > readme.docx', reason: 'not a picture (.docx)' }])
  })

  it('reports a zip that cannot be opened, and keeps going with the other files', async () => {
    const bad = new File([strToU8('not really a zip')], 'broken.zip', { type: 'application/zip' })
    const r = await intakePhotoFiles([bad, pic('K7VMI.jpg')])
    expect(r.images.map(f => f.name)).toEqual(['K7VMI.jpg'])
    expect(r.skipped).toEqual([{ name: 'broken.zip', reason: 'could not be opened as a zip file' }])
  })

  it('treats a folder pick like loose files: subfolders count, system files are ignored', async () => {
    const inFolder = (path: string, f: File) => Object.defineProperty(f, 'webkitRelativePath', { value: path })
    const r = await intakePhotoFiles([
      inFolder('Team/a/K7VMI.jpg', pic('K7VMI.jpg')),
      inFolder('Team/Thumbs.db', new File(['x'], 'Thumbs.db')),
      inFolder('Team/b/list.csv', new File(['x'], 'list.csv', { type: 'text/csv' })),
    ])
    expect(r.images.map(f => f.name)).toEqual(['K7VMI.jpg'])
    expect(r.skipped).toEqual([{ name: 'Team/b/list.csv', reason: 'not a picture (.csv)' }])
  })

  it('keeps the first of two pictures with the same name', async () => {
    const r = await intakePhotoFiles([pic('K7VMI.jpg'), zipFile('more.zip', { 'old/k7vmi.JPG': new Uint8Array([9]) })])
    expect(r.images.length).toBe(1)
    expect(r.skipped).toEqual([{ name: 'k7vmi.JPG', reason: 'another picture has the same name' }])
  })
})

describe('describeSkipped and isZipFile', () => {
  it('lists up to the limit, then counts the rest', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `f${i}.txt`, reason: 'not a picture (.txt)' }))
    expect(describeSkipped(many, 3)).toEqual([
      'f0.txt: not a picture (.txt)', 'f1.txt: not a picture (.txt)', 'f2.txt: not a picture (.txt)', '...and 7 more',
    ])
    expect(describeSkipped([])).toEqual([])
  })

  it('knows a zip by name or type', () => {
    expect(isZipFile({ name: 'a.ZIP' })).toBe(true)
    expect(isZipFile({ name: 'a', type: 'application/zip' })).toBe(true)
    expect(isZipFile({ name: 'a.jpg', type: 'image/jpeg' })).toBe(false)
  })
})

/**
 * The 2022 clipart roster icons were removed (unlicensed art) and replaced by the `badge-*.svg`
 * set in `assets/imgs/rangers/`. Old saved rosters, backups and fixtures still store the old
 * filenames in `RangerType.image`, so every place that builds a bundled roster image path runs
 * the stored name through here: a removed filename resolves to its matching badge, anything
 * else (including photos and the AI demo faces) passes through unchanged. Nothing stored is
 * rewritten - this only changes which file is displayed.
 */
export function bundledRangerImage(image: string): string {
  if (!image) return image
  if (image === 'CmdPost.jpg') return 'badge-cmd.svg'
  if (/^CERT_[a-z]+\.png$/i.test(image)) return 'badge-cert.svg'
  if (/^MERT_[a-z]+\.png$/i.test(image)) return 'badge-medic.svg'
  if (/^ham(_[a-z]+)?\.png$/i.test(image)) return 'badge-ham.svg'
  if (['Yacht_purple.png', 'team_brown.png', 'Ranger.png', 'male.png', 'female.png', 'sail.png'].includes(image)) {
    return 'badge-ranger.svg'
  }
  return image
}

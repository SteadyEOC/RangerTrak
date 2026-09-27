# Backup fixtures (E-126)

One folder per release, each holding a mission backup made **by that release**:

| File | What it is |
|---|---|
| `backup.json` | A plain "Back up mission" file |
| `backup-encrypted.json` | The same mission, backed up with a passphrase |
| `expect.json` | What a restore must bring back, and the fixture passphrase |

`tools/e2e.js --full` (`checkBackupFixturesRestore`) restores **every** folder here into the
current build, and checks each value in `expect.json`. That is the 1.0.0-rc.1 gate: a backup
made in the alpha (and every release after it) must still restore.

## On the day a release is tagged

```sh
npm run build
npm run backup-fixture -- <version>     # e.g. 0.99.0-alpha
```

Commit the new `tools/backup-fixtures/<version>/` folder. Never edit or regenerate an existing
folder: its whole value is that it was made by that release.

## Fake data only

The fixtures come from the built-in Grand Canyon demo in a throwaway browser profile, and the
generator refuses to write one that carries a geocoding API key. The roster holds real PII in
real use, and these files are public.

`pre-alpha-20260926` is the seed, made before any alpha existed, to prove the harness works.

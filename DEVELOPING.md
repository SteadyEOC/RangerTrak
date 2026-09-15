# Developing RangerTrak

Day-to-day developer workflow: running, testing, releasing, and updating dependencies.

- For how the app is put together, see [ARCHITECTURE.md](ARCHITECTURE.md).
- For hosting, deploys, and the DNS cutover, see [DEPLOYING.md](DEPLOYING.md).
- For the code of conduct, see [contributing.md](contributing.md).
- For VS Code workspace setup, see [.vscode/SETUP.md](.vscode/SETUP.md).

## Quick start

1. Fork `github.com/SteadyEOC/RangerTrak` to your own account.
2. Install [Node.js](https://nodejs.org/). Angular 22's own `package.json` pins
   `"node": "^22.22.3 || ^24.15.0 || >=26.0.0"` — an older major (v18, v20, or most of v21)
   will not install it. CI builds and deploys on Node 24; that's the version to match if in
   doubt.
3. Clone and run:

   ```bash
   git clone https://github.com/YOUR_USERNAME/rangertrak.git
   cd rangertrak
   npm install
   npm start
   ```

4. Open <http://localhost:4200/>. The app reloads automatically as you edit source files.
5. Open the folder in VS Code and install the recommended extensions when prompted.

## Building and previewing a production build

```bash
npm run build      # production build into dist/rangertrak
npm run server     # serve that build at http://localhost:8080
```

`npm run server` uses [tools/serve-dist.js](tools/serve-dist.js), a small static server
with SPA fallback and HTTP range support. Range support is required — the PMTiles basemap
is fetched by byte range. It also serves `.mjs` as `text/javascript`, which the MapLibre
module worker requires; **any production host needs that same MIME mapping.**

## Testing

```bash
npm test           # unit tests via Karma
npm run lint       # tslint + typecheck
npm run lint:tsc   # typecheck only (app and spec projects separately)
```

> `ng build` passing does **not** mean the code compiles — Angular only compiles
> *reachable* files, so an unreferenced file can carry syntax errors indefinitely while
> builds stay green. `npm run lint:tsc` is what catches that; treat it as a real gate.

The suite is expected to be **all green** (124 specs as of this writing — check the run's
own "Executed N of N" line for the current count rather than trusting this number to stay
put; it grows with the app). It was not for a long time, and the
failures were all harness gaps rather than app defects — components that inject `SwUpdate`
need `provideSwUpdateStub()` from `src/testing/sw-update.stub.ts`, anything with a
`routerLink` needs `RouterTestingModule`, and services without `providedIn: 'root'` must be
listed in `providers`. Treat a red spec as a real signal again.

Note that `lint:tsc` deliberately runs against `tsconfig.app.json` and
`tsconfig.spec.json` separately rather than the shared base config. The shared config sets
`moduleResolution: "bundler"`, which disables TypeScript's automatic `@types` discovery for
a bare `tsc` run and produces a flood of spurious "Cannot find name 'describe'" errors.

## Bundle size

The initial bundle is budgeted in [angular.json](angular.json) and currently passes with
little headroom, which is intentional — it catches regressions. If a change pushes it over,
prefer fixing the cause over raising the budget. The usual cause is a heavy library
reaching the eager graph; see the "Bundle and loading strategy" section of
[ARCHITECTURE.md](ARCHITECTURE.md) for the two rules that keep that from happening.

To see what a chunk actually contains:

```bash
npm run build
# then inspect dist/rangertrak/browser/*.js
```

## Updating the version number

```bash
npm run release     # bumps package.json + CHANGELOG.md via standard-version
git push --follow-tags origin main
```

To force a specific version, stage your changes (or pass `--allow-empty`) and commit with
`Release-As: 0.11.40` in the message. See
[standard-version](https://www.npmjs.com/package/standard-version) and the
[release-please notes](https://github.com/googleapis/release-please#how-do-i-change-the-version-number).

Afterwards, verify `package.json` and `package-lock.json` agree.

## Updating third-party libraries

Check what is current:

```bash
node -v && npm -v && tsc --version
npm outdated
```

Update global tooling (**requires Administrator on Windows**):

```bash
npm install npm@latest -g
npm install -g typescript
npm install -g @angular/cli@latest
```

Then the project itself:

```bash
npx ng update                      # see what Angular suggests
npx ng update @angular/core @angular/cli
npm outdated
npm install
```

If peer dependency resolution blocks an install, `npm install --legacy-peer-deps` is the
escape hatch. Check <https://update.angular.io/> for migration steps between Angular
versions.

## Generating source documentation

```bash
npm run compodoc          # regenerate into documentation/
npx compodoc -s           # serve at http://127.0.0.1:8080/
```

See <https://compodoc.app/> for details.

## Screenshots

**Screen captures of RangerTrak are confidential by default and are not kept in this
repository.** Keep them outside the working tree; promote individual images in only after
reviewing them, with a descriptive filename.

This is not fussiness about repo tidiness. A screenshot of this app in real use contains
whatever was on screen: field reports, which can hold personal information about missing
persons; the roster, which pairs legal names with phone numbers and photos; and whatever
browser chrome was captured with it — bookmarks, other tabs, account avatars. A capture taken while
configuring hosting can contain an API token in plaintext. All of those have turned up in
practice.

A `.gitignore` rule is deliberately **not** the mechanism here, for two reasons. It does not
actually protect anything — `git add -f`, an edited rule, or a `git clean -xdf` (which
deletes the files outright) all defeat it, and this project has already shipped a correctly
gitignored file to production once. And a rule is itself a published statement about what
you are withholding. Keeping the material outside the tree means there is nothing to ignore
and nothing to advertise.

## Deploying

The production build in `dist/rangertrak/browser` is a static site and can be served by any
static host, provided it:

- falls back to `index.html` for client-side routes,
- supports HTTP range requests (for the PMTiles basemap), and
- serves `.mjs` with a JavaScript MIME type (for the MapLibre worker).

<https://RangerTrak.org> is served by a Cloudflare Worker with static assets, deployed
from `main` by GitHub Actions. **See [DEPLOYING.md](DEPLOYING.md)** for the setup, the
pre-deploy secret gate, the DNS cutover, and the post-deploy smoke test. Earlier
Firebase-based deployment (`ng deploy` / `@angular/fire`) is no longer used.

## Further help

For the Angular CLI, run `ng help` or see the
[Angular CLI reference](https://angular.io/cli).

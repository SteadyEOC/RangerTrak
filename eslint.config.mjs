// ESLint flat config. Replaces the dead tslint.json (tslint deprecated 2019, never installed).
// ADR D-57: rules start as warnings and become errors once what fires is fixed or allow-listed.
// The two boundary rules at the bottom are the reason this file exists; the recommended sets
// are the usual angular-eslint starting point.
import angular from 'angular-eslint'
import tseslint from 'typescript-eslint'

/** Turn every rule a shared config sets to 'error' into 'warn' (D-57: warn first). */
const asWarnings = (configs) =>
  configs.map((c) =>
    c.rules
      ? {
          ...c,
          rules: Object.fromEntries(
            Object.entries(c.rules).map(([k, v]) => [
              k,
              v === 'error' || v === 2 ? 'warn' : Array.isArray(v) && (v[0] === 'error' || v[0] === 2) ? ['warn', ...v.slice(1)] : v,
            ]),
          ),
        }
      : c,
  )

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.angular/**', 'src/test.ts', 'src/polyfills.ts'] },
  {
    files: ['src/**/*.ts'],
    extends: asWarnings([...tseslint.configs.recommended, ...angular.configs.tsRecommended]),
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/component-selector': ['warn', { type: 'element', prefix: 'rangertrak', style: 'kebab-case' }],
      '@angular-eslint/directive-selector': ['warn', { type: 'attribute', prefix: 'rangertrak', style: 'camelCase' }],
    },
  },
  {
    files: ['src/**/*.html'],
    extends: asWarnings([...angular.configs.templateRecommended, ...angular.configs.templateAccessibility]),
  },

  // ── Boundary rule 1 (D-57): domain/ is framework-free. ──────────────────────────────────
  // Plain TypeScript only: no Angular, map engines, DOM storage, or app services. Type-only
  // imports of *.interface files are allowed (the open question in D-57 about settings
  // interfaces; usage-state.ts already uses one).
  {
    files: ['src/app/domain/**/*.ts'],
    ignores: ['src/app/domain/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'warn',
        {
          patterns: [
            { group: ['@angular/*', 'rxjs', 'rxjs/*', 'leaflet', 'leaflet.*', 'maplibre-gl', 'pmtiles', 'ag-grid-*'], message: 'domain/ is framework-free (ADR D-57).' },
            { group: ['../**', '!../**/*.interface'], message: 'domain/ may import only domain/ (and type-only *.interface files) — ADR D-57.' },
            { group: ['../**/*.interface'], allowTypeImports: true, message: 'domain/ may use *.interface files as types only — ADR D-57.' },
          ],
        },
      ],
      'no-restricted-globals': ['warn', { name: 'localStorage', message: 'Persistence lives in services, not domain/ (ADR D-57).' }, { name: 'sessionStorage', message: 'Persistence lives in services, not domain/ (ADR D-57).' }, { name: 'indexedDB', message: 'Persistence lives in services, not domain/ (ADR D-57).' }],
    },
  },

  // ── Boundary rule 2 (D-57): components never touch storage directly. ───────────────────
  {
    files: ['src/app/**/*.component.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'warn',
        { patterns: [{ group: ['**/shared/storage/*', '!**/shared/storage/unlock-form'], message: 'Components go through a service, not shared/storage/ (ADR D-57).' }] },
      ],
      'no-restricted-globals': ['warn', { name: 'localStorage', message: 'Components go through a service, not localStorage (ADR D-57).' }],
      'no-restricted-properties': ['warn', { object: 'window', property: 'localStorage', message: 'Components go through a service, not localStorage (ADR D-57).' }],
    },
  },
)

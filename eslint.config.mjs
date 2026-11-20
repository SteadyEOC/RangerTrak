// ESLint flat config. Replaces the dead tslint.json (tslint deprecated 2019, never installed).
// ADR D-57: rules start as warnings and become errors once what fires is fixed or allow-listed.
// The boundary rules below were clean on 2026-10-05 and are errors; the recommended sets still warn.
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
  { ignores: ['dist/**', 'node_modules/**', '.angular/**'] },
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
  // Plain TypeScript only: no Angular, map engines, DOM storage, or app services. domain/ imports
  // only domain/. The model interfaces now live in domain/model (P3, 2026-11-20), so the old
  // allowance for type-only *.interface imports from outside domain/ is gone.
  {
    files: ['src/app/domain/**/*.ts'],
    ignores: ['src/app/domain/**/*.spec.ts', 'src/app/domain/model/**'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@angular/*', 'rxjs', 'rxjs/*', 'leaflet', 'leaflet.*', 'maplibre-gl', 'pmtiles', 'ag-grid-*'], message: 'domain/ is framework-free (ADR D-57).' },
            { group: ['../**'], message: 'domain/ may import only domain/ (ADR D-57). Models live in domain/model.' },
          ],
        },
      ],
      'no-restricted-globals': ['error', { name: 'localStorage', message: 'Persistence lives in services, not domain/ (ADR D-57).' }, { name: 'sessionStorage', message: 'Persistence lives in services, not domain/ (ADR D-57).' }, { name: 'indexedDB', message: 'Persistence lives in services, not domain/ (ADR D-57).' }],
    },
  },

  // domain/model/ sits one level down: ../ is still domain/, so only ../../ leaves it.
  {
    files: ['src/app/domain/model/**/*.ts'],
    ignores: ['src/app/domain/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@angular/*', 'rxjs', 'rxjs/*', 'leaflet', 'leaflet.*', 'maplibre-gl', 'pmtiles', 'ag-grid-*'], message: 'domain/ is framework-free (ADR D-57).' },
            { group: ['../../**'], message: 'domain/ may import only domain/ (ADR D-57). Models live in domain/model.' },
          ],
        },
      ],
      'no-restricted-globals': ['error', { name: 'localStorage', message: 'Persistence lives in services, not domain/ (ADR D-57).' }, { name: 'sessionStorage', message: 'Persistence lives in services, not domain/ (ADR D-57).' }, { name: 'indexedDB', message: 'Persistence lives in services, not domain/ (ADR D-57).' }],
    },
  },

  // ── Boundary rule 2 (D-57): components never touch storage directly. ───────────────────
  {
    files: ['src/app/**/*.component.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/shared/storage/*', '!**/shared/storage/record-store'], message: 'Components go through a service, not shared/storage/ (ADR D-57).' },
            // The injectable RecordStore wrapper is a service; the bare `recordStore` singleton is not.
            { group: ['**/shared/storage/record-store'], allowImportNames: ['RecordStore'], message: 'Components inject RecordStore; they do not import the recordStore singleton (ADR D-57).' },
          ],
        },
      ],
      'no-restricted-globals': ['error', { name: 'localStorage', message: 'Components go through a service, not localStorage (ADR D-57).' }],
      'no-restricted-properties': ['error', { object: 'window', property: 'localStorage', message: 'Components go through a service, not localStorage (ADR D-57).' }],
    },
  },
)

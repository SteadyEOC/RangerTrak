// Extra Vitest settings for `ng test` (E-226). angular.json's test target points here
// ("runnerConfig"); the Angular builder supplies everything else (browser, globals, includes).
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      // fflate's package exports list "node" before "import", and in the browser test run Vite
      // picked the Node entry (esm/index.mjs), which calls createRequire and fails to load.
      // The app build already gets the browser entry; this gives the tests the same one.
      { find: /^fflate$/, replacement: 'fflate/browser' },
    ],
  },
  test: {
    // Jasmine put every spyOn() back after each test; the specs were written for that. Without
    // this a stubbed IndexedDB get() or fetch() leaks into every test that runs after it.
    restoreMocks: true,
    // No failure screenshots: Karma never took them, and they piled up in the repo. Anything a
    // test does attach goes under the git-ignored .tmp\ folder.
    browser: { screenshotFailures: false },
    attachmentsDir: '.tmp/vitest-attachments',
  },
})

import { VERSION as CDK_VERSION } from '@angular/cdk'
import { enableProdMode, VERSION as NG_VERSION } from '@angular/core'
import { bootstrapApplication } from '@angular/platform-browser'

import { AppComponent } from './app/app.component'
import { appConfig } from './app/app.config'
import { environment } from './environments/environment'
// E-122 Phase 2a: the roster/radio-log/locations Map has to be filled from IndexedDB (and any
// one-time localStorage migration completed) BEFORE Angular boots, so every service
// constructor's synchronous recordStore.getItem() already sees real data. See
// shared/storage/record-store.ts's own doc comment for the full design.
import { recordStore } from './app/shared/storage/record-store'

// NOTE: AG Grid's module registration deliberately does NOT happen here - importing
// ag-grid-community from main.ts drags the whole grid bundle into the eager initial
// chunk. See ensureAgGridRegistered() in app/shared/ag-grid-setup.ts, which the three
// lazily-loaded grid components call from their constructors instead.

if (environment.production) {
  enableProdMode();
}

/* eslint-disable no-console */
console.info('Angular version', NG_VERSION.full);
console.info('Angular CDK version', CDK_VERSION.full);

async function bootstrap() {
  try {
    await recordStore.load()
  } catch (err) {
    // Belt and braces: recordStore.load() is written to never throw (every per-key failure
    // is caught and logged internally, falling back to localStorage or an empty Map), but a
    // storage refactor is exactly the kind of change that must never be able to stop the app
    // from booting - see E-122 Phase 2a item 5.
    console.error('RecordStore failed to load; continuing with whatever this session already has in memory.', err)
  }
  bootstrapApplication(AppComponent, appConfig)
    .catch(err => console.error(err))
};

if (document.readyState === 'complete') {
  bootstrap();
} else {
  document.addEventListener('DOMContentLoaded', bootstrap);
}

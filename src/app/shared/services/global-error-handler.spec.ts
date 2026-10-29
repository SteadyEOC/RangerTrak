import { TestBed } from '@angular/core/testing'

import { GlobalErrorHandler, REPORT_IT_MUTE_KEY } from './global-error-handler'
import { LogService } from './log.service'

describe('GlobalErrorHandler (E-258)', () => {
  beforeEach(() => {
    // No Report-it snackbar during these tests.
    sessionStorage.setItem(REPORT_IT_MUTE_KEY, '1')
    spyOn(console, 'error')
  })
  afterEach(() => sessionStorage.removeItem(REPORT_IT_MUTE_KEY))

  const logged = () => TestBed.inject(LogService).entries().slice(-1)[0].msg

  it('does not repeat "Name: message" when the stack opens with it (Chrome)', () => {
    const err = new TypeError('x is undefined')
    err.stack = 'TypeError: x is undefined\n    at foo (main.js:1:1)\n    at bar (main.js:2:2)'

    TestBed.inject(GlobalErrorHandler).handleError(err)

    const msg = logged()
    expect(msg).toContain('TypeError: x is undefined — at foo (main.js:1:1) | at bar (main.js:2:2)')
    expect(msg.split('x is undefined').length - 1).toBe(1)
  })

  it('keeps every frame of a stack with no header line (Firefox)', () => {
    const err = new Error('boom')
    err.stack = 'foo@main.js:1:1\nbar@main.js:2:2\n'

    TestBed.inject(GlobalErrorHandler).handleError(err)

    expect(logged()).toContain('Error: boom — foo@main.js:1:1 | bar@main.js:2:2')
  })

  it('says so when there is no stack', () => {
    const err = new Error('boom')
    err.stack = undefined

    TestBed.inject(GlobalErrorHandler).handleError(err)

    expect(logged()).toContain('Error: boom — (no stack)')
  })
})

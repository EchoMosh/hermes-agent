import { describe, expect, it, vi } from 'vitest'

import plugin from './plugin'

describe('Activity source registration', () => {
  it('projects real signals without adding a separate pane', () => {
    const register = vi.fn()
    const registerLocales = vi.fn()
    const disposers: Array<() => void> = []

    plugin.register({
      i18n: {
        register: registerLocales,
        t: vi.fn(() => 'Activity')
      },
      onDispose: (dispose: () => void) => disposers.push(dispose),
      register
    } as never)

    expect(register).not.toHaveBeenCalled()
    expect(registerLocales).toHaveBeenCalledWith(
      expect.objectContaining({ en: expect.any(Object), ja: expect.any(Object), zh: expect.any(Object) })
    )
    disposers.forEach(dispose => dispose())
  })
})

import { describe, it, expect, afterEach } from 'vitest'
import { useI18n, isGerman, localeTag } from './useI18n'

const originalLang = document.documentElement.lang

afterEach(() => {
  document.documentElement.lang = originalLang
})

describe('language detection', () => {
  // Regression: OpenCloud sets documentElement.lang only after the extension is
  // mounted. Anything that captured the language in a setup-level constant kept
  // the pre-mount value forever — which is how the event tooltip ended up
  // formatting dates as "Sat, Aug 15, 2026, 02:00 PM" in a German UI.
  it('picks up a language set after module import', () => {
    document.documentElement.lang = ''
    expect(isGerman()).toBe(false)

    document.documentElement.lang = 'de-DE'
    expect(isGerman()).toBe(true)
    expect(localeTag()).toBe('de-DE')
  })

  it('matches any de-* variant', () => {
    for (const lang of ['de', 'de-DE', 'de-AT', 'DE-ch']) {
      document.documentElement.lang = lang
      expect(isGerman()).toBe(true)
    }
  })

  it('treats other languages as English', () => {
    for (const lang of ['en', 'en-GB', 'fr-FR', 'nl']) {
      document.documentElement.lang = lang
      expect(isGerman()).toBe(false)
      expect(localeTag()).toBe('en-US')
    }
  })
})

describe('t()', () => {
  it('translates known keys once the language switches to German', () => {
    const { t } = useI18n()

    document.documentElement.lang = 'en'
    expect(t('Subscriptions')).toBe('Subscriptions')

    document.documentElement.lang = 'de'
    expect(t('Subscriptions')).toBe('Abonnements')
  })

  it('falls back to the key for untranslated strings', () => {
    document.documentElement.lang = 'de'
    const { t } = useI18n()
    expect(t('Not A Known Key')).toBe('Not A Known Key')
  })
})

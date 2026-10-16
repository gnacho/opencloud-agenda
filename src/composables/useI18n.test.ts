import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createApp, defineComponent } from 'vue'
import { createGettext } from 'vue3-gettext'
import { useI18n, currentLanguage, isGerman, localeTag } from './useI18n'
import translations from '../../l10n/translations.json'

const originalLang = document.documentElement.lang

afterEach(() => {
  document.documentElement.lang = originalLang
})

// t() reads from the host gettext instance, which only exists inside a
// component. Mount a throwaway one with the real catalogue to exercise it.
function withGettext(language: string) {
  let i18n!: ReturnType<typeof useI18n>
  const probe = defineComponent({
    setup() {
      i18n = useI18n()
      return () => null
    },
  })

  const app = createApp(probe)
  app.use(createGettext({ translations, defaultLanguage: language, silent: true }))
  app.mount(document.createElement('div'))
  return i18n
}

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
    expect(currentLanguage()).toBe('de-de')
    expect(localeTag()).toBe('de-de')
  })

  it('matches any de-* variant', () => {
    for (const lang of ['de', 'de-DE', 'de-AT', 'DE-ch']) {
      document.documentElement.lang = lang
      expect(isGerman()).toBe(true)
    }
  })

  it('does not treat Spanish as German', () => {
    for (const lang of ['es', 'es-ES', 'es-419']) {
      document.documentElement.lang = lang
      expect(isGerman()).toBe(false)
      expect(localeTag()).toBe(lang.toLowerCase())
    }
  })

  it('formats English as en-US and falls back to it without a language', () => {
    for (const lang of ['en', 'en-GB']) {
      document.documentElement.lang = lang
      expect(localeTag()).toBe('en-US')
    }
    document.documentElement.lang = ''
    expect(localeTag()).toBe('en-US')
  })
})

describe('t()', () => {
  it('translates from the bundled catalogue', () => {
    expect(withGettext('de').t('Subscriptions')).toBe('Abonnements')
    expect(withGettext('es').t('Subscriptions')).toBe('Suscripciones')
    expect(withGettext('es').t('Save')).toBe('Guardar')
  })

  it('falls back to the English msgid for an untranslated language', () => {
    expect(withGettext('fr').t('Subscriptions')).toBe('Subscriptions')
  })

  it('interpolates placeholders', () => {
    expect(withGettext('es').t('Calendar error: %{name}', { name: 'Familie' })).toBe(
      'Error de calendario: Familie'
    )
  })

  it('falls back to the msgid outside a component, where composables are called in unit tests', () => {
    expect(useI18n().t('Subscriptions')).toBe('Subscriptions')
  })
})

describe('translation catalogue', () => {
  it('ships the same keys for every language', () => {
    const languages = Object.keys(translations)
    expect(languages).toContain('de')
    expect(languages).toContain('es')

    const [first, ...rest] = languages as (keyof typeof translations)[]
    const reference = Object.keys(translations[first]).sort()
    for (const language of rest) {
      expect(Object.keys(translations[language]).sort()).toEqual(reference)
    }
  })

  // A missing entry does not break anything at runtime, it silently shows the
  // English string, so nothing catches it but this test.
  it('covers every msgid passed to t() in the source', () => {
    const root = join(process.cwd(), 'src')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(vue|ts)$/.test(entry) && !/\.test\.ts$/.test(entry)) files.push(path)
      }
    }
    walk(root)

    const msgids = new Set<string>()
    for (const file of files) {
      const source = readFileSync(file, 'utf-8')
      for (const match of source.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) {
        msgids.add(match[1].replace(/\\'/g, "'"))
      }
    }

    expect(msgids.size).toBeGreaterThan(100)
    const uncovered = [...msgids].filter((msgid) => !(msgid in translations.es)).sort()
    expect(uncovered, `msgids sin traducir: ${uncovered.join(' | ')}`).toEqual([])
  })
})

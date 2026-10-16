/**
 * Translation helpers.
 *
 * The strings live in l10n/translations.json and the host registers them
 * through the `translations` field returned by the application setup, so the
 * app follows the language the user picked in OpenCloud. English strings are
 * the keys; a language without a translation falls back to the English msgid.
 */
import { getCurrentInstance } from 'vue'
import { useGettext } from 'vue3-gettext'

/**
 * Language the host is running in, as a lower-case tag ("es", "de", "de-at").
 *
 * Read at call time, never captured in a module- or setup-level constant:
 * OpenCloud sets documentElement.lang after the extension has been mounted,
 * so anything evaluated during setup() still sees the empty default.
 */
export function currentLanguage(): string {
  return (document.documentElement.lang || navigator.language || '').toLowerCase()
}

export function isGerman(): boolean {
  return currentLanguage().startsWith('de')
}

// BCP 47 tag for the Intl formatters.
export function localeTag(): string {
  const lang = currentLanguage()
  if (!lang) return 'en-US'
  if (lang.startsWith('en')) return 'en-US'
  return lang
}

export function useI18n() {
  // Unit tests call the composables directly, outside any component, where
  // there is no gettext instance to inject: fall back to the msgid there.
  const translate = getCurrentInstance()
    ? useGettext().$gettext
    : (msgid: string): string => msgid

  function t(key: string, options?: Record<string, unknown>): string {
    return translate(key, options)
  }

  return { t, isGerman, localeTag }
}

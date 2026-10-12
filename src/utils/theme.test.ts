import { describe, it, expect } from 'vitest'
import { contrastText, isNearWhite, luminance, schemeForBackground } from './theme'

describe('luminance', () => {
  it('spans the full range for black and white', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 5)
    expect(luminance('#ffffff')).toBeCloseTo(1, 5)
  })

  it('accepts three-digit hex', () => {
    expect(luminance('#fff')).toBeCloseTo(luminance('#ffffff')!, 5)
  })

  it('accepts rgb() and rgba(), as returned by getComputedStyle', () => {
    expect(luminance('rgb(255, 255, 255)')).toBeCloseTo(1, 5)
    expect(luminance('rgba(0, 0, 0, 0.5)')).toBeCloseTo(0, 5)
  })

  it('tolerates surrounding whitespace — custom properties keep it', () => {
    expect(luminance('  #ffffff  ')).toBeCloseTo(1, 5)
  })

  it('returns null for anything it cannot parse', () => {
    expect(luminance('')).toBeNull()
    expect(luminance('var(--nope)')).toBeNull()
    expect(luminance('chartreuse')).toBeNull()
  })
})

describe('schemeForBackground', () => {
  // The actual OpenCloud surface tokens, so a theme change would be noticed here
  it('reads the OpenCloud light surface as light', () => {
    expect(schemeForBackground('#ffffff')).toBe('light')
    expect(schemeForBackground('#f6f8fa')).toBe('light')
  })

  it('reads the OpenCloud dark surface as dark', () => {
    expect(schemeForBackground('#191c1d')).toBe('dark')
    expect(schemeForBackground('#1d2021')).toBe('dark')
  })

  it('falls back to light when the property is missing', () => {
    // getComputedStyle returns '' for an undefined custom property, which
    // happens on an OpenCloud build that does not ship the role tokens.
    expect(schemeForBackground('')).toBe('light')
  })
})

describe('contrastText', () => {
  it('puts black text on white and other light calendar colours', () => {
    expect(contrastText('#ffffff')).toBe('#000000')
    expect(contrastText('#fff')).toBe('#000000')
    expect(contrastText('#ffeb3b')).toBe('#000000') // yellow
    expect(contrastText('#8bc34a')).toBe('#000000') // light green
  })

  it('keeps white text on the default and other saturated colours', () => {
    expect(contrastText('#0082c9')).toBe('#ffffff') // app default
    expect(contrastText('#e67e22')).toBe('#ffffff') // subscription default
    expect(contrastText('#888888')).toBe('#ffffff')
    expect(contrastText('#000000')).toBe('#ffffff')
  })

  it('falls back to white for colours it cannot parse', () => {
    // safeColor() lets plain names through; FullCalendar's default is white text
    expect(contrastText('teal')).toBe('#ffffff')
    expect(contrastText('')).toBe('#ffffff')
  })
})

describe('isNearWhite', () => {
  it('is true for white and near-white only', () => {
    expect(isNearWhite('#ffffff')).toBe(true)
    expect(isNearWhite('#f5f5f5')).toBe(true)
    expect(isNearWhite('#ffeb3b')).toBe(false) // light, but clearly visible
    expect(isNearWhite('#0082c9')).toBe(false)
    expect(isNearWhite('teal')).toBe(false)
  })
})

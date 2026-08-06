import { describe, it, expect } from 'vitest'
import { luminance, schemeForBackground } from './theme'

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

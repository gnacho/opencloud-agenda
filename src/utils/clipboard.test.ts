import { describe, it, expect, vi, afterEach } from 'vitest'
import { copyText } from './clipboard'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('copyText', () => {
  it('writes to the clipboard and reports success', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await expect(copyText('https://example.org/cal.ics')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('https://example.org/cal.ics')
  })

  it('reports failure instead of throwing when the API is missing', async () => {
    // No secure context: navigator.clipboard is undefined entirely
    vi.stubGlobal('navigator', {})
    await expect(copyText('x')).resolves.toBe(false)
  })

  it('reports failure when the write is rejected', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn(async () => { throw new Error('NotAllowedError') }) },
    })
    await expect(copyText('x')).resolves.toBe(false)
  })
})

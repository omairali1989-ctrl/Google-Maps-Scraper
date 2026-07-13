import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EnrichmentPage from '@/app/(app)/enrichment/page'

global.fetch = jest.fn((url: string) => {
  if (url.includes('/api/v2/keys/verify')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true, message: 'Verified' }),
    })
  }
  if (url.includes('/api/v2/keys') || url.includes('/api/v2/billing') || url.includes('/api/v2/jobs')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve([]),
    })
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
}) as jest.Mock

describe('EnrichmentPage', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear()
  })

  it('renders the Enrichment Page', async () => {
    render(<EnrichmentPage />)
    expect(screen.getByText('AI Enrichment & Billing')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('Loading usage...')).not.toBeInTheDocument()
    })
  })

  it('can verify an API key successfully', async () => {
    render(<EnrichmentPage />)
    await waitFor(() => {
      expect(screen.queryByText('Loading usage...')).not.toBeInTheDocument()
    })

    // Select provider and type key
    const input = screen.getByPlaceholderText(/sk-\.\.\./i)
    fireEvent.change(input, { target: { value: 'test-api-key' } })

    const verifyBtn = screen.getByText('Verify Key')
    expect(verifyBtn).not.toBeDisabled()

    fireEvent.click(verifyBtn)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v2/keys/verify', expect.any(Object))
    })
  })
})

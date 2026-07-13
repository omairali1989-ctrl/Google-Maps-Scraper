import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LeadEnrichmentPage from '@/app/(app)/lead-enrichment/page'

global.fetch = jest.fn((url: string, options?: any) => {
  if (url.includes('/api/v2/enrichment/status')) {
    // If it has query param for specific ID
    if (url.includes('enrichment_job_id=')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 101,
          status: 'running',
          total: 10,
          processed: 4,
          succeeded: 3,
          failed: 1,
        }),
      })
    }
    // Default list
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve([
        {
          id: 100,
          status: 'completed',
          total: 50,
          processed: 50,
          succeeded: 45,
          failed: 5,
        }
      ]),
    })
  }
  if (url.includes('/api/v2/enrichment/start')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        message: 'Enrichment started',
        total: 10,
        enrichment_job_id: 101,
      }),
    })
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
}) as jest.Mock

describe('LeadEnrichmentPage', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('renders enrichment info and recent jobs', async () => {
    render(<LeadEnrichmentPage />)

    expect(screen.getByText('Website Lead Enrichment')).toBeInTheDocument()
    expect(screen.getByText('Recent Enrichment Jobs')).toBeInTheDocument()

    // Verify recent job is loaded
    await waitFor(() => {
      expect(screen.getByText('#100')).toBeInTheDocument()
    })
    expect(screen.getByText('45/50 enriched · 5 failed')).toBeInTheDocument()
  })

  it('can trigger enrichment and poll job status', async () => {
    render(<LeadEnrichmentPage />)

    await waitFor(() => {
      expect(screen.getByText('#100')).toBeInTheDocument()
    })

    const startBtn = screen.getByText('Start Enrichment')
    fireEvent.click(startBtn)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v2/enrichment/start',
        expect.objectContaining({ method: 'POST' })
      )
    })

    // Now it should poll status
    await waitFor(() => {
      expect(screen.getByText('Job #101')).toBeInTheDocument()
    })
    expect(screen.getByText('4/10 · 3 ok · 1 failed')).toBeInTheDocument()
  })
})

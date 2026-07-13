import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import HistoryPage from '@/app/(app)/history/page'

global.fetch = jest.fn((url: string, options?: any) => {
  if (url.includes('/api/v2/history') && (!options || options.method === 'GET' || !options.method)) {
    // Check if it's querying item list
    if (url.includes('/items')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          items: [
            {
              id: 501,
              job_id: 10,
              query: 'Cafes in Seattle',
              url: 'https://www.google.com/maps/place/Seattle+Cafe',
              status: 'completed',
              scraped_at: '2026-07-09T11:00:00Z',
            }
          ]
        }),
      })
    }
    // Default history list
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        total: 1,
        counts: { all: 1, running: 0, completed: 1, stopped: 0, failed: 0 },
        jobs: [
          {
            id: 10,
            query: 'Cafes in Seattle',
            status: 'completed',
            format: 'excel',
            headless: 1,
            started_at: '2026-07-09T10:00:00Z',
            completed_at: '2026-07-09T10:15:00Z',
            record_count: 25,
          }
        ]
      }),
    })
  }
  if (url.includes('/api/v2/history/') && options?.method === 'DELETE') {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    })
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
}) as jest.Mock

describe('HistoryPage', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear()
    // Suppress window.confirm for delete tests
    window.confirm = () => true
  })

  it('renders execution history page title and metrics', async () => {
    render(<HistoryPage />)

    expect(screen.getByText('Execution History')).toBeInTheDocument()
    
    // Wait for jobs to load
    await waitFor(() => {
      expect(screen.getByText('Cafes in Seattle')).toBeInTheDocument()
    })

    // Verify metadata renders
    expect(screen.getByText('25')).toBeInTheDocument() // Record count in cell
    expect(screen.getByText('15m 0s')).toBeInTheDocument() // Formatted duration
  })

  it('can open the job details drawer', async () => {
    render(<HistoryPage />)

    await waitFor(() => {
      expect(screen.getByText('Cafes in Seattle')).toBeInTheDocument()
    })

    // Click the row to open details
    const row = screen.getByText('Cafes in Seattle')
    fireEvent.click(row)

    // Verify details drawer elements are visible
    await waitFor(() => {
      expect(screen.getByText('Job #10')).toBeInTheDocument()
    })

    // Verify drawer navigation tabs render
    expect(screen.getByRole('button', { name: /Scraped Items/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Console Log/i })).toBeInTheDocument()
  })

  it('can delete a job', async () => {
    render(<HistoryPage />)

    await waitFor(() => {
      expect(screen.getByText('Cafes in Seattle')).toBeInTheDocument()
    })

    // Click the row to open details
    const row = screen.getByText('Cafes in Seattle')
    fireEvent.click(row)

    // Wait for drawer to open
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Delete/i })).toBeInTheDocument()
    })

    const deleteBtn = screen.getByRole('button', { name: /Delete/i })
    fireEvent.click(deleteBtn)

    // Verify DELETE request was made
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v2/history/10',
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })
})

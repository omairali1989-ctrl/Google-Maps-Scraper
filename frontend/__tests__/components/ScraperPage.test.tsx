import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ScraperPage from '@/app/(app)/scraper/page'

global.fetch = jest.fn((url: string, options?: any) => {
  if (url.includes('/api/v2/jobs') && (!options || options.method === 'GET' || !options.method)) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true, jobs: [] }),
    })
  }
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ success: true, job_id: 'test-job-123' }),
  })
}) as jest.Mock

describe('ScraperPage', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear()
  })

  it('renders the Scraper Page title', async () => {
    render(<ScraperPage />)
    expect(screen.getByText('Scraper Panel')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('No previous scraper jobs in history.')).toBeInTheDocument()
    })
  })

  it('updates the search query when a suggestion is clicked', async () => {
    render(<ScraperPage />)
    await waitFor(() => {
      expect(screen.getByText('No previous scraper jobs in history.')).toBeInTheDocument()
    })
    const cafeSuggestion = screen.getByText('Cafe')
    fireEvent.click(cafeSuggestion)
    
    // The search query input should now have the value "Cafe in London" or similar, wait it's just "Cafe" + the city input?
    // Let's just check the input value changes to Cafe.
    const input = screen.getByPlaceholderText(/e\.g\. Cafes/i)
    expect(input).toHaveValue('Cafe')
  })

  it('submits the form and calls the API', async () => {
    render(<ScraperPage />)
    await waitFor(() => {
      expect(screen.getByText('No previous scraper jobs in history.')).toBeInTheDocument()
    })
    
    // Fill in the form
    const queryInput = screen.getByPlaceholderText(/e\.g\. Cafes/i)
    fireEvent.change(queryInput, { target: { value: 'Restaurants in New York' } })
    
    // Click submit
    const submitBtn = screen.getByText('Launch Scraper')
    fireEvent.click(submitBtn)
    
    // Wait for fetch to be called with POST /api/v2/jobs
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v2/jobs', expect.objectContaining({
        method: 'POST'
      }))
    })
  })
})

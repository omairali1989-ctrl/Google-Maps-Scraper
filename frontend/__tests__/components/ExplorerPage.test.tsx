import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ExplorerPage from '@/app/(app)/explorer/page'

global.fetch = jest.fn((url: string) => {
  if (url.includes('/api/v2/filters/options')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        options: {
          countries: ['UK'],
          cities: ['London'],
          regions: ['Greater London'],
          categories: ['Cafe'],
          queries: ['coffee shop']
        }
      }),
    })
  }
  if (url.includes('/api/v2/filters/saved')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true, filters: [] }),
    })
  }
  if (url.includes('/api/v2/records')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        records: [
          {
            id: 1,
            name: "Cafe Alpha",
            category: "Cafe",
            rating: "4.5",
            total_reviews: "100",
            phone: "123-456",
            website: "https://alpha.com",
            email: "info@alpha.com",
            address: "1 Main St",
            tags: "[]",
            is_favorite: 1,
            notes: "Good coffee",
            scraped_at: "2026-07-09T00:00:00Z",
            updated_at: "2026-07-09T00:00:00Z",
            ai_enriched: 0
          }
        ],
        total: 1,
        page: 1,
        limit: 25,
        totalPages: 1
      }),
    })
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
}) as jest.Mock

describe('ExplorerPage', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear()
  })

  it('renders the Explorer Page and displays records', async () => {
    render(<ExplorerPage />)

    expect(screen.getByText('Data Explorer')).toBeInTheDocument()

    // Wait for the records data to finish fetching and render
    await waitFor(() => {
      expect(screen.queryAllByText('Cafe Alpha').length).toBeGreaterThan(0)
    })

    expect(screen.queryAllByText('Cafe').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('1 Main St').length).toBeGreaterThan(0)
  })

  it('updates the search query input', async () => {
    render(<ExplorerPage />)

    await waitFor(() => {
      expect(screen.queryAllByText('Cafe Alpha').length).toBeGreaterThan(0)
    })

    const searchInput = screen.getByPlaceholderText(/search leads\.\.\./i)
    fireEvent.change(searchInput, { target: { value: 'New Search' } })

    expect(searchInput).toHaveValue('New Search')
  })
})

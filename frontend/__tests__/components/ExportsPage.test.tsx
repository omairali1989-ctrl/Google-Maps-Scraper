import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ExportsPage from '@/app/(app)/exports/page'

global.fetch = jest.fn((url: string, options?: any) => {
  if (url.includes('/api/v2/filters/options')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        options: {
          countries: ['United States', 'Canada'],
          cities: ['New York', 'Toronto'],
          regions: ['NY', 'ON'],
          categories: ['Restaurants', 'Dentists'],
          queries: ['Dentists in NY'],
        }
      }),
    })
  }
  if (url.includes('/api/v2/exports') && (!options || options.method === 'GET' || !options.method)) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        exports: [
          {
            id: 1,
            filename: 'leads_export_test.xlsx',
            format: 'xlsx',
            record_count: 100,
            filter_applied: JSON.stringify({ country: 'United States' }),
            created_at: '2026-07-09T10:00:00Z',
            file_size_bytes: 10240,
          }
        ]
      }),
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
            name: 'Test Business',
            category: 'Restaurants',
            phone: '1234567890',
            email: 'test@example.com',
            website: 'https://example.com',
            rating: '4.5',
            total_reviews: '(15)',
            address: '123 Test St, NY',
            city: 'New York',
            country: 'United States',
            region: 'NY',
            source_query: 'Restaurants in NY',
            scraped_at: '2026-07-09T08:00:00Z',
            notes: 'Some note',
            is_favorite: 1,
          }
        ],
      }),
    })
  }
  if (url.includes('/api/v2/exports') && options?.method === 'POST') {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    })
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
}) as jest.Mock

// Mock URL.createObjectURL since it's not implemented in JSDOM
window.URL.createObjectURL = jest.fn(() => 'blob:test')
window.URL.revokeObjectURL = jest.fn()

describe('ExportsPage', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
    (window.URL.createObjectURL as jest.Mock).mockClear();
  })

  it('renders the Export Wizard form and history', async () => {
    render(<ExportsPage />)

    expect(screen.getByText('Export Configuration')).toBeInTheDocument()
    expect(screen.getByText('Past Downloads')).toBeInTheDocument()

    // Wait for history to load
    await waitFor(() => {
      expect(screen.getByText('leads_export_test.xlsx')).toBeInTheDocument()
    })
  })

  it('triggers a download when the export form is submitted', async () => {
    render(<ExportsPage />)

    // Wait for initial option load
    await waitFor(() => {
      expect(screen.getByText('leads_export_test.xlsx')).toBeInTheDocument()
    })

    // Modify filename prefix
    const filenameInput = screen.getByLabelText(/Filename Prefix/i)
    fireEvent.change(filenameInput, { target: { value: 'custom_export' } })

    // Submit the form
    const exportBtn = screen.getByRole('button', { name: /Download Export File/i })
    fireEvent.click(exportBtn)

    // Wait for record query and download flow
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/records')
      )
    })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v2/exports',
        expect.objectContaining({
          method: 'POST',
        })
      )
    })
  })
})

import { render, screen, waitFor } from '@testing-library/react'
import DashboardPage from '@/app/(app)/dashboard/page'

global.fetch = jest.fn((url: string) => {
  if (url.includes('/api/v2/stats/overview')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        stats: {
          totalRecords: 1250,
          addedToday: 45,
          addedThisWeek: 120,
          avgRating: 4.2,
          totalEmails: 320,
          activeJobs: 1,
        }
      }),
    })
  }
  if (url.includes('/api/v2/stats/growth')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        growth: [
          { date: '07/08', records: 1205, added: 10 },
          { date: '07/09', records: 1250, added: 45 },
        ]
      }),
    })
  }
  if (url.includes('/api/v2/stats/geo-distribution')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        distribution: [
          { country: 'United States', count: 800 },
          { country: 'Pakistan', count: 450 },
        ]
      }),
    })
  }
  if (url.includes('/api/v2/stats/category-distribution')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        distribution: [
          { category: 'Restaurant', count: 700 },
          { category: 'Cafe', count: 550 },
        ]
      }),
    })
  }
  if (url.includes('/api/v2/jobs')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        jobs: [
          {
            id: 42,
            query: 'Cafes in Lahore',
            status: 'completed',
            record_count: 55,
            started_at: '2026-07-09T10:00:00Z',
          }
        ]
      }),
    })
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
}) as jest.Mock

// Mock Recharts since SVG elements don't render cleanly in jsdom
jest.mock('recharts', () => {
  const OriginalModule = jest.requireActual('recharts');
  return {
    ...OriginalModule,
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  };
});

describe('DashboardPage', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear()
  })

  it('renders stats metrics after loading', async () => {
    render(<DashboardPage />)

    // Skeletons should render first
    expect(screen.getAllByRole('generic').length).toBeGreaterThan(0)

    // Wait for the data to fetch and render
    await waitFor(() => {
      expect(screen.getByText('1,250')).toBeInTheDocument()
    })

    expect(screen.getByText('Total Leads')).toBeInTheDocument()
    expect(screen.getByText('Scraped Today')).toBeInTheDocument()
    expect(screen.getByText('4.2 ★')).toBeInTheDocument()
    expect(screen.getByText('320')).toBeInTheDocument()
    expect(screen.getByText('Cafes in Lahore')).toBeInTheDocument()
  })

  it('renders error state on API failure', async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(() =>
      Promise.reject(new Error('Network failure'))
    )

    render(<DashboardPage />)

    await waitFor(() => {
      expect(
        screen.getByText(/Failed to fetch dashboard data/i)
      ).toBeInTheDocument()
    })
  })
})

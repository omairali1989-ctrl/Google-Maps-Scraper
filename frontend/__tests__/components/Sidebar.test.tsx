import { render, screen, waitFor } from '@testing-library/react'
import { Sidebar } from '@/components/sidebar'

// Mock usePathname
jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}))

global.fetch = jest.fn((url: string) => {
  if (url.includes('/api/v2/auth/me')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        user: {
          id: 1,
          username: 'testuser',
          role: 'user',
        }
      }),
    })
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
}) as jest.Mock

describe('Sidebar', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear()
  })

  it('renders standard navigation items', async () => {
    render(<Sidebar />)

    expect(screen.getByText('Extractrx')).toBeInTheDocument()
    
    // Links should be visible
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Scraper Panel')).toBeInTheDocument()
    expect(screen.getByText('Data Explorer')).toBeInTheDocument()

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v2/auth/me')
    })
  })

  it('hides admin links for normal users', async () => {
    render(<Sidebar />)

    await waitFor(() => {
      expect(screen.queryByText('Administration')).not.toBeInTheDocument()
    })
  })

  it('shows admin links for admin users', async () => {
    (global.fetch as jest.Mock).mockImplementationOnce((url: string) => {
      if (url.includes('/api/v2/auth/me')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            user: {
              id: 1,
              username: 'adminuser',
              role: 'admin',
            }
          }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(<Sidebar />)

    await waitFor(() => {
      expect(screen.getByText('Administration')).toBeInTheDocument()
    })
  })
})

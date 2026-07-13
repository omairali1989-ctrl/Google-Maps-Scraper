import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Topbar } from '@/components/topbar'
import { redirectUser } from '@/lib/utils'

// Mock usePathname
jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}))

// Mock redirectUser from @/lib/utils
jest.mock('@/lib/utils', () => ({
  ...jest.requireActual('@/lib/utils'),
  redirectUser: jest.fn(),
}))

global.fetch = jest.fn((url: string) => {
  if (url.includes('/api/v2/auth/me')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        user: {
          id: 1,
          username: 'jack_leads',
          role: 'admin',
        }
      }),
    })
  }
  if (url.includes('/api/status')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ status: 'running' }),
    })
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
}) as jest.Mock

describe('Topbar', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
    (redirectUser as jest.Mock).mockClear();
  })

  it('renders breadcrumbs, user info, active scraper state, and logout option', async () => {
    render(<Topbar />)

    // Breadcrumb 'Home' should render
    expect(screen.getByText('Home')).toBeInTheDocument()

    // Scraper status indicator should render when active
    await waitFor(() => {
      expect(screen.getByText('Scraper Active')).toBeInTheDocument()
    })

    // User metadata should display
    await waitFor(() => {
      expect(screen.getByText('jack_leads')).toBeInTheDocument()
    })
    expect(screen.getByText('admin')).toBeInTheDocument()

    // Trigger logout
    const logoutBtn = screen.getByTitle('Sign out')
    fireEvent.click(logoutBtn)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v2/auth/logout', expect.objectContaining({ method: 'POST' }))
      expect(redirectUser).toHaveBeenCalledWith('/login')
    })
  })
})

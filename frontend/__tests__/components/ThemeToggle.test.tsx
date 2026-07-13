import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeToggle } from '@/components/theme-toggle'
import { useTheme } from 'next-themes'

// Mock next-themes
jest.mock('next-themes', () => ({
  useTheme: jest.fn(() => ({
    theme: 'light',
    setTheme: jest.fn(),
  })),
}))

describe('ThemeToggle', () => {
  beforeEach(() => {
    (useTheme as jest.Mock).mockClear()
  })

  it('renders and allows toggling the theme', async () => {
    const setThemeMock = jest.fn();
    (useTheme as jest.Mock).mockReturnValue({
      theme: 'light',
      setTheme: setThemeMock,
    })

    render(<ThemeToggle />)

    // Initially, mounted is false, then set to true in useEffect.
    // Wait for the button to appear.
    const button = await screen.findByRole('button', { name: /Toggle theme/i })
    expect(button).toBeInTheDocument()

    // Trigger toggle click
    fireEvent.click(button)

    expect(setThemeMock).toHaveBeenCalledWith('dark')
  })
})

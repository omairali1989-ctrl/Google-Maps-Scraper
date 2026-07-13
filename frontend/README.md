# Extractrix — Frontend Dashboard

This directory contains the **Next.js** frontend application for **Extractrix - Google Maps Scraper**. The dashboard provides a modern user interface to manage scraper tasks, view collected business records, verify AI keys, review logs, and export leads.

## Technology Stack

- **Framework**: Next.js (App Router)
- **UI Components**: Radix UI Primitives, Lucide icons, Recharts (data visualization), Leaflet (maps)
- **Animations**: GSAP (`gsap` and `@gsap/react`)
- **Styling**: Tailwind CSS v4 with custom variables configured in `app/globals.css`
- **Notifications**: Sonner toast alerts

## Project Structure

```bash
frontend/
├── __tests__/          # Jest unit & component tests
│   └── components/     # Test files for pages and layout elements
├── app/
│   ├── (app)/          # Protected dashboard routes (Dashboard, Explorer, Map, exports, history)
│   ├── api/            # API routes and proxies to the Python backend
│   ├── globals.css     # Global stylesheet and Tailwind custom variables
│   └── layout.tsx      # Root HTML layout wrapper
├── components/         # Reusable React components (Topbar, Sidebar, MetricCard, status badges, etc.)
│   └── ui/             # Shadcn-configured basic UI controls (buttons, inputs, selects, sheets)
├── lib/                # Utility helpers, database configurations, and types
├── public/             # Static public assets (images, logos)
├── jest.config.ts      # Jest configuration
└── jest.setup.ts       # Jest testing environment configuration
```

## Getting Started

### 1. Install Dependencies
Before running the frontend, install Node package dependencies:
```bash
npm install
```

### 2. Configure Environment
Create a `.env.local` file inside the `frontend/` folder. The default settings proxy to the backend API running on port `5001`:
```env
FLASK_API_URL=http://localhost:5001
```

### 3. Run Development Server
Start the Next.js development server:
```bash
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser to view the application.

### 4. Build for Production
To build the optimized production bundle:
```bash
npm run build
npm start
```

---

## Testing Guide

The frontend features a robust testing suite written using **Jest** and **React Testing Library** to mock API calls and assert UI rendering, interactive states, and state change side effects.

### Run Tests Interactively
To run all tests in watch mode or execute them once:
```bash
npm test
```

### Run Tests and Generate Coverage
To run tests and output a full code coverage breakdown (rendered into the `coverage/` folder):
```bash
npm run test:coverage
```

### Writing New Tests
When adding new pages or complex components, create a corresponding test file in `__tests__/components/`. Ensure that:
- Core global features such as `fetch` are mocked appropriately.
- Components utilizing DOM animations (e.g. GSAP) or dynamic imports (e.g. Leaflet) are mocked or safely stubbed.
- Updates causing state changes are verified within `waitFor` or `act(...)` blocks.

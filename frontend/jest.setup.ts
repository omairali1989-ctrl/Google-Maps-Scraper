import '@testing-library/jest-dom'

jest.setTimeout(35000);

// Mock EventSource
class MockEventSource {
  onmessage: any = null;
  onerror: any = null;
  close = jest.fn();
  constructor(url: string) {
    //
  }
}

Object.defineProperty(window, 'EventSource', {
  value: MockEventSource,
});

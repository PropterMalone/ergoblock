// Mock for webextension-polyfill in test environment
// Just export chrome as browser
export default globalThis.chrome || globalThis.browser;

module.exports = {
  preset: '@react-native/jest-preset',
  // The API server has its own test suite (server/npm test) with its own
  // jest config; don't double-run it from the app.
  testPathIgnorePatterns: ['/node_modules/', '/server/'],
};

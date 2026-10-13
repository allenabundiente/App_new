module.exports = {
  preset: '@react-native/jest-preset',
  // The server folder has its own tests and its own config, so skip it here.
  testPathIgnorePatterns: ['/node_modules/', '/server/'],
};

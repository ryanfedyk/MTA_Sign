// Holds the settings store so tests can swap Firestore for an in-memory store.
const settings = require("./settings");

let store = null;
module.exports = {
  getStore: () => (store ||= settings.firestoreStore()),
  setStore: (s) => { store = s; },
};

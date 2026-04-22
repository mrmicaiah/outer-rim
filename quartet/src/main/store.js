const { app } = require('electron');
const path = require('path');
const fs = require('fs');

class Store {
  constructor() {
    const userDataPath = app.getPath('userData');
    this.path = path.join(userDataPath, 'quartet-data.json');
    this.data = this.parseDataFile();
  }

  parseDataFile() {
    try {
      if (fs.existsSync(this.path)) {
        return JSON.parse(fs.readFileSync(this.path, 'utf8'));
      }
    } catch (error) {
      console.error('Error reading store:', error);
    }
    return {};
  }

  get(key) { return this.data[key]; }

  set(key, val) {
    this.data[key] = val;
    try {
      fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('Error writing store:', error);
    }
  }

  delete(key) {
    delete this.data[key];
    try {
      fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('Error writing store:', error);
    }
  }

  // ============================================
  // Sync hooks — used by shared/sync-client.js
  // ============================================

  // Return a deep-cloned snapshot of the whole data blob for uploading to the cloud.
  getAll() {
    return JSON.parse(JSON.stringify(this.data));
  }

  // Replace the entire data blob with a snapshot from the cloud.
  // The renderer is expected to reload its view after this.
  replaceAll(newData) {
    this.data = newData && typeof newData === 'object' ? newData : {};
    try {
      fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('Error writing store during replaceAll:', error);
    }
  }
}

module.exports = Store;

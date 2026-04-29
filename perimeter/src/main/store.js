const { app } = require('electron');
const path = require('path');
const fs = require('fs');

class Store {
  constructor() {
    const userDataPath = app.getPath('userData');
    this.path = path.join(userDataPath, 'perimeter-data.json');
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

  // Return the entire store — used by sync-client to snapshot state for cloud upload.
  getAll() {
    return this.data;
  }

  // Replace the entire store contents — used by sync-client when applying a remote snapshot.
  replaceAll(newData) {
    this.data = newData || {};
    try {
      fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('Error writing store:', error);
    }
  }
}

module.exports = Store;

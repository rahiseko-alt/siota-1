export class KvDataStore {
  constructor(namespace) {
    this.backend = 'kv';
    this.namespace = namespace;
  }
}

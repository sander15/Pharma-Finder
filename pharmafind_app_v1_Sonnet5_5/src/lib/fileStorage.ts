/** MOCK of «service - Layer 4» File Storage (CSV feed copies, license documents). In-memory. */
export class FileStorage {
  private files = new Map<string, Buffer>();

  async store(path: string, content: Buffer | string): Promise<string> {
    this.files.set(path, Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(content, "utf8"));
    return path;
  }

  async retrieve(path: string): Promise<Buffer | undefined> {
    const f = this.files.get(path);
    return f ? Buffer.from(f) : undefined;
  }

  clear(): void {
    this.files.clear();
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}

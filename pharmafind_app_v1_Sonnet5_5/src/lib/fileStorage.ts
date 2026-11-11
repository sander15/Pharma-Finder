/** Mock of File Storage (Layer 4): CSV/feed copies and license documents, kept in memory. */
export class FileStorage {
  private files = new Map<string, Buffer>();
  private counter = 0;

  /** Stores a file and returns its storage path. The file name is sanitised so it can never escape the folder. */
  store(folder: string, fileName: string, content: Buffer | string): string {
    const base = fileName.split(/[\\/]/).pop() ?? "file";
    const safe = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 80) || "file";
    const path = `${folder}/${++this.counter}-${safe}`;
    this.files.set(path, Buffer.from(content));
    return path;
  }

  retrieve(path: string): Buffer {
    const f = this.files.get(path);
    if (!f) throw new Error("File not found");
    return Buffer.from(f);
  }

  remove(path: string): void {
    this.files.delete(path);
  }
}

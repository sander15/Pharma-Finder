import type { Ctx } from "../context";
import type { FeedImport, FeedSource, Rejection } from "../types";
import type { CatalogService } from "./catalog";
import { MAX_PRICE, MAX_STOCK, type ListingService } from "./listings";
import type { PharmacyService } from "./pharmacies";

export const CSV_HEADER = "catalogId,stock,price";
export const MAX_FEED_ROWS = 5000;

const CATALOG_ID = /^PF-\d{5}$/;
const STOCK_TEXT = /^(0|[1-9]\d*)$/; // whole number, no sign, no padding, no exponent
const PRICE_TEXT = /^(0|[1-9]\d*)(\.\d{1,2})?$/; // plain decimal point, at most 2 decimals

interface ValidRow { catalogId: string; stock: number; price: number }

/**
 * Feed Import (Layer 3). The ONLY place incoming data is checked.
 * Feeds are assumed to use Pharmafind's standard format and catalog IDs already, so this service never trims,
 * converts, guesses or repairs anything: a row is either exactly standard (and saved) or rejected (and reported).
 */
export class FeedImportService {
  constructor(private ctx: Ctx, private catalog: CatalogService, private listings: ListingService, private pharmacies: PharmacyService) {}

  /* ------------------------------------------------------------------ row validators (never modify input) */

  validateCatalogId(v: unknown): string | null {
    if (typeof v !== "string" || !CATALOG_ID.test(v)) return "catalogId must look like PF-12345";
    return this.catalog.hasCatalogId(v) ? null : `catalogId ${v} is not in the Pharmafind catalog`;
  }

  /** CSV cells are text and must already be plain whole numbers; POS values must already be JSON numbers. */
  validateStock(v: unknown, source: FeedSource): string | null {
    const ok = source === "csv" ? typeof v === "string" && STOCK_TEXT.test(v) && Number(v) <= MAX_STOCK : typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_STOCK;
    return ok ? null : "stock must be a whole number of 0 or more";
  }

  validatePrice(v: unknown, source: FeedSource): string | null {
    const ok =
      source === "csv"
        ? typeof v === "string" && PRICE_TEXT.test(v) && Number(v) > 0 && Number(v) <= MAX_PRICE
        : typeof v === "number" && Number.isFinite(v) && v > 0 && v <= MAX_PRICE && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
    return ok ? null : "price must be a positive amount with at most 2 decimals";
  }

  private validateRow(catalogId: unknown, stock: unknown, price: unknown, source: FeedSource): string | null {
    return this.validateCatalogId(catalogId) ?? this.validateStock(stock, source) ?? this.validatePrice(price, source);
  }

  /* ------------------------------------------------------------------------------------------ entry points */

  /** CSV exported from the pharmacy's system (uploaded in the portal). */
  importCsv(input: { pharmacyId: string; fileName: string; content: string }): FeedImport {
    const { pharmacyId, fileName, content } = input;
    const stored = this.storeFileCopy(`csv-uploads/${pharmacyId}`, fileName, content);
    const lines = content.split(/\r?\n/);
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop(); // a final line break is not a row
    if (content === "") return this.finish({ pharmacyId, source: "csv", feed: null, fileName, stored, totalRows: 0, valid: [], rejections: [{ row: 0, reason: "The file is empty" }] });
    if (lines[0] !== CSV_HEADER) {
      return this.finish({ pharmacyId, source: "csv", feed: null, fileName, stored, totalRows: Math.max(0, lines.length - 1), valid: [], rejections: [{ row: 0, reason: `The header must be exactly "${CSV_HEADER}"` }] });
    }
    const dataLines = lines.slice(1);
    if (dataLines.length === 0) return this.finish({ pharmacyId, source: "csv", feed: null, fileName, stored, totalRows: 0, valid: [], rejections: [{ row: 0, reason: "The file has no data rows" }] });
    if (dataLines.length > MAX_FEED_ROWS) {
      return this.finish({ pharmacyId, source: "csv", feed: null, fileName, stored, totalRows: dataLines.length, valid: [], rejections: [{ row: 0, reason: `Too many rows (maximum ${MAX_FEED_ROWS} per file)` }] });
    }
    const valid: ValidRow[] = [];
    const rejections: Rejection[] = [];
    const seen = new Set<string>();
    dataLines.forEach((line, i) => {
      const row = i + 1;
      const cells = line.split(",");
      if (cells.length !== 3) return void rejections.push({ row, reason: `Expected 3 columns (catalogId,stock,price) but found ${cells.length}` });
      const [catalogId, stock, price] = cells as [string, string, string];
      const problem = this.validateRow(catalogId, stock, price, "csv");
      if (problem) return void rejections.push({ row, reason: problem });
      if (seen.has(catalogId)) return void rejections.push({ row, reason: `Duplicate catalogId ${catalogId} in this file` });
      seen.add(catalogId);
      valid.push({ catalogId, stock: Number(stock), price: Number(price) });
    });
    return this.finish({ pharmacyId, source: "csv", feed: null, fileName, stored, totalRows: dataLines.length, valid, rejections });
  }

  /** Rows pulled from a POS system (already standard-format JSON objects). `rows` is untrusted: it is validated here. */
  importRows(input: { pharmacyId: string; source: FeedSource; rows: unknown; feedId: string | null }): FeedImport {
    const { pharmacyId, source, rows, feedId } = input;
    const stored = this.storeFileCopy(`pos-feeds/${pharmacyId}`, "pos-feed.json", JSON.stringify(rows) ?? "null");
    if (!Array.isArray(rows)) {
      return this.finish({ pharmacyId, source, feed: feedId, fileName: null, stored, totalRows: 0, valid: [], rejections: [{ row: 0, reason: "The feed is not a list of rows" }] });
    }
    if (rows.length === 0) return this.finish({ pharmacyId, source, feed: feedId, fileName: null, stored, totalRows: 0, valid: [], rejections: [{ row: 0, reason: "The feed has no rows" }] });
    if (rows.length > MAX_FEED_ROWS) {
      return this.finish({ pharmacyId, source, feed: feedId, fileName: null, stored, totalRows: rows.length, valid: [], rejections: [{ row: 0, reason: `Too many rows (maximum ${MAX_FEED_ROWS} per feed)` }] });
    }
    const valid: ValidRow[] = [];
    const rejections: Rejection[] = [];
    const seen = new Set<string>();
    rows.forEach((r: unknown, i) => {
      const row = i + 1;
      if (typeof r !== "object" || r === null || Array.isArray(r)) return void rejections.push({ row, reason: "Row is not an object" });
      const o = r as Record<string, unknown>;
      const keys = Object.keys(o).sort().join(",");
      if (keys !== "catalogId,price,stock") return void rejections.push({ row, reason: "Row must have exactly the fields catalogId, stock and price" });
      const problem = this.validateRow(o.catalogId, o.stock, o.price, source);
      if (problem) return void rejections.push({ row, reason: problem });
      const catalogId = o.catalogId as string;
      if (seen.has(catalogId)) return void rejections.push({ row, reason: `Duplicate catalogId ${catalogId} in this feed` });
      seen.add(catalogId);
      valid.push({ catalogId, stock: o.stock as number, price: o.price as number });
    });
    return this.finish({ pharmacyId, source, feed: feedId, fileName: null, stored, totalRows: rows.length, valid, rejections });
  }

  /** A feed that could not even be fetched (POS down...): recorded as a rejected import and a FAILED sync. */
  rejectFeed(input: { pharmacyId: string; source: FeedSource; feedId: string | null; reason: string }): FeedImport {
    return this.finish({ pharmacyId: input.pharmacyId, source: input.source, feed: input.feedId, fileName: null, stored: null, totalRows: 0, valid: [], rejections: [{ row: 0, reason: input.reason }] });
  }

  /* ------------------------------------------------------------------------------------------ shared steps */

  /** FeedImport.storeFileCopy() -> File Storage */
  private storeFileCopy(folder: string, fileName: string, content: string): string {
    return this.ctx.files.store(folder, fileName, content);
  }

  /** saveValidRows() + recordSyncTime(): update listings, keep the import record, write the SyncLog. */
  private finish(r: { pharmacyId: string; source: FeedSource; feed: string | null; fileName: string | null; stored: string | null; totalRows: number; valid: ValidRow[]; rejections: Rejection[] }): FeedImport {
    const startedAt = this.ctx.clock.iso();
    for (const row of r.valid) this.listings.save(r.pharmacyId, row.catalogId, row.stock, row.price);
    const accepted = r.valid.length > 0;
    const importId = this.ctx.db.nextId("imp");
    const record: FeedImport = {
      importId,
      pharmacy: r.pharmacyId,
      source: r.source,
      feed: r.feed,
      fileName: r.fileName,
      storedFilePath: r.stored,
      status: accepted ? "accepted" : "rejected",
      totalRows: r.totalRows,
      validRows: r.valid.length,
      rejectedRows: r.rejections.filter((x) => x.row > 0).length || (accepted ? 0 : r.rejections.length ? r.totalRows : 0),
      rejections: r.rejections,
      startedAt,
    };
    this.ctx.db.save("feedImports", importId, record);
    const details = accepted
      ? `${record.validRows} row(s) saved, ${record.rejectedRows} rejected`
      : `Import rejected: ${r.rejections[0]?.reason ?? "no valid rows"}`;
    this.pharmacies.recordSync(r.pharmacyId, importId, accepted, details);
    return record;
  }
}

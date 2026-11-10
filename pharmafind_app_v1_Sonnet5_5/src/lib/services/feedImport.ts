import type { Ctx } from "../context";
import { AppError } from "../errors";
import type { FeedImport, FeedSource, Pharmacy, Product, Rejection, StandardFeedRow } from "../types";
import type { ListingService } from "./listings";
import type { PharmacyService } from "./pharmacies";
import type { SyncLogService } from "./syncLogs";

/**
 * Feed Import (Layer 3) - the single gatekeeper for CSV uploads and POS feeds.
 *
 * PROJECT RULE: every external source already uses Pharmafind's standard format and catalog IDs,
 * so this service ONLY VALIDATES. It never trims, re-cases, re-formats, maps, or guesses:
 * a value is either exactly standard (and saved untouched) or its row is rejected.
 *
 * Standard row:  { catalogId: "PF-nnnn", stock: whole number >= 0, price: number > 0 with <= 2 decimals }
 * Standard CSV:  header line exactly `catalogId,stock,price`, then one line per row, `,` separated.
 *   (CSV cells are text by nature; they are matched against strict patterns and, once proven
 *   standard, stored as numbers. That is the file's own encoding - not a normalization step.)
 */
export const CSV_HEADER = "catalogId,stock,price";
const MAX_ROWS = 10_000;
const MAX_CSV_BYTES = 1_000_000;
const ROW_KEYS = ["catalogId", "price", "stock"];

const STOCK_TEXT = /^(0|[1-9]\d{0,6})$/;
const PRICE_TEXT = /^(0|[1-9]\d{0,5})(\.\d{1,2})?$/;

export interface ImportRowsInput {
  pharmacyId: string;
  source: FeedSource;
  rows: unknown;
  fileName?: string | null;
  /** Exact bytes received (CSV text or JSON), kept in File Storage when at least one row is valid. */
  rawCopy?: string;
  feedId?: string | null;
}

export class FeedImportService {
  constructor(
    private ctx: Ctx,
    private listings: ListingService,
    private syncLogs: SyncLogService,
    private pharmacies: PharmacyService,
  ) {}

  /* ---------------- validation (FeedImport.validate*) ---------------- */

  validateCatalogId(value: unknown): string | null {
    if (typeof value !== "string") return "catalogId must be text";
    return this.ctx.db.get<Product>("products", value) ? null : `Unknown catalog ID "${value}"`;
  }

  validateStock(value: unknown, source: FeedSource): string | null {
    if (source === "csv") {
      return typeof value === "string" && STOCK_TEXT.test(value) ? null : "stock must be a whole number (digits only)";
    }
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? null : "stock must be a whole number >= 0";
  }

  validatePrice(value: unknown, source: FeedSource): string | null {
    if (source === "csv") {
      return typeof value === "string" && PRICE_TEXT.test(value) && Number(value) > 0 ? null : "price must be a positive number with at most 2 decimals (e.g. 8.50)";
    }
    const ok = typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100_000 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
    return ok ? null : "price must be a positive number with at most 2 decimals";
  }

  /** FeedImport.validateRows: splits rows into untouched valid rows and rejections (1-based row numbers). */
  validateRows(rows: unknown[], source: FeedSource): { valid: StandardFeedRow[]; rejected: Rejection[] } {
    const valid: StandardFeedRow[] = [];
    const rejected: Rejection[] = [];
    const seen = new Set<string>();

    rows.forEach((row, i) => {
      const n = i + 1;
      if (Array.isArray(row)) {
        rejected.push({ row: n, reason: `Row has ${row.length} values, expected exactly 3 (${CSV_HEADER})` });
        return;
      }
      if (typeof row !== "object" || row === null) {
        rejected.push({ row: n, reason: "Row is not in the standard format { catalogId, stock, price }" });
        return;
      }
      const keys = Object.keys(row).sort();
      if (keys.length !== ROW_KEYS.length || keys.some((k, idx) => k !== ROW_KEYS[idx])) {
        rejected.push({ row: n, reason: "Row is not in the standard format { catalogId, stock, price }" });
        return;
      }
      const r = row as Record<string, unknown>;
      const problem = this.validateCatalogId(r.catalogId) ?? this.validateStock(r.stock, source) ?? this.validatePrice(r.price, source);
      if (problem) {
        rejected.push({ row: n, reason: problem });
        return;
      }
      if (seen.has(r.catalogId as string)) {
        rejected.push({ row: n, reason: `Duplicate catalog ID ${r.catalogId} in the same feed` });
        return;
      }
      seen.add(r.catalogId as string);
      valid.push(r as unknown as StandardFeedRow);
    });
    return { valid, rejected };
  }

  /* ---------------- import pipeline ---------------- */

  /** Entry point used by the portal (CSV) after splitting the file into lines/cells. */
  async importCsv(pharmacyId: string, csvText: unknown, fileName: string | null): Promise<FeedImport> {
    if (typeof csvText !== "string" || csvText.length === 0) throw new AppError("VALIDATION_ERROR", "The uploaded file is empty");
    if (Buffer.byteLength(csvText, "utf8") > MAX_CSV_BYTES) throw new AppError("VALIDATION_ERROR", "The uploaded file is larger than 1 MB");

    // line framing only: "\n" or "\r\n" end a line, a final empty line is not a row
    const lines = csvText.split(/\r?\n/);
    if (lines[lines.length - 1] === "") lines.pop();
    const dataLines = lines.slice(1);

    if (lines[0] !== CSV_HEADER) {
      return this.rejectFeed({ pharmacyId, source: "csv", fileName, totalRows: dataLines.length, reason: `File is not in the Pharmafind standard format: first line must be exactly "${CSV_HEADER}"` });
    }
    const rows = dataLines.map((line) => {
      const cells = line.split(",");
      return cells.length === 3 ? { catalogId: cells[0], stock: cells[1], price: cells[2] } : cells;
    });
    return this.importRows({ pharmacyId, source: "csv", rows, fileName, rawCopy: csvText });
  }

  /** validateRows -> saveValidRows -> storeFileCopy -> recordSyncTime -> SyncLog.record (see sequence diagrams). */
  async importRows(input: ImportRowsInput): Promise<FeedImport> {
    const { pharmacyId, source } = input;
    const pharmacy = this.pharmacies.get(pharmacyId);

    if (!Array.isArray(input.rows)) {
      return this.rejectFeed({ pharmacyId, source, fileName: input.fileName ?? null, feedId: input.feedId, totalRows: 0, reason: "Feed is not a list of rows in the standard format" });
    }
    if (input.rows.length > MAX_ROWS) {
      return this.rejectFeed({ pharmacyId, source, fileName: input.fileName ?? null, feedId: input.feedId, totalRows: input.rows.length, reason: `Feed has more than ${MAX_ROWS} rows` });
    }

    const { valid, rejected } = this.validateRows(input.rows, source);
    if (valid.length === 0) {
      return this.rejectFeed({
        pharmacyId, source, fileName: input.fileName ?? null, feedId: input.feedId, totalRows: input.rows.length,
        reason: input.rows.length === 0 ? "Feed contains no rows" : "No row is in the standard format",
        rejections: rejected,
      });
    }

    // saveValidRows: each row goes through Listing.updateStock / updatePrice / validate
    for (const row of valid) {
      this.listings.setListing(pharmacyId, { catalogId: row.catalogId, stock: Number(row.stock), price: Number(row.price) });
    }

    const importId = this.ctx.db.nextId("imp");
    let storedFilePath: string | null = null;
    if (input.rawCopy !== undefined) {
      storedFilePath = `feeds/${pharmacyId}/${importId}.${source === "csv" ? "csv" : "json"}`;
      await this.ctx.files.store(storedFilePath, input.rawCopy);
    }

    const record: FeedImport = {
      importId, pharmacy: pharmacyId, source, feed: input.feedId ?? null, fileName: input.fileName ?? null, storedFilePath,
      status: "accepted", totalRows: input.rows.length, validRows: valid.length, rejectedRows: rejected.length, rejections: rejected,
      startedAt: this.ctx.clock.iso(),
    };
    this.ctx.db.save("feedImports", importId, record);

    this.recordSyncTime(pharmacy);
    this.syncLogs.record({ pharmacy: pharmacyId, feedImport: importId, success: true, details: `${valid.length} of ${input.rows.length} rows imported, ${rejected.length} rejected` });
    return record;
  }

  /** Records a rejected feed (non-compliant format, nothing saved) with a failure SyncLog. */
  async rejectFeed(args: {
    pharmacyId: string;
    source: FeedSource;
    fileName?: string | null;
    feedId?: string | null;
    totalRows: number;
    reason: string;
    rejections?: Rejection[];
  }): Promise<FeedImport> {
    const importId = this.ctx.db.nextId("imp");
    const rejections = args.rejections?.length ? args.rejections : [{ row: 0, reason: args.reason }];
    const record: FeedImport = {
      importId, pharmacy: args.pharmacyId, source: args.source, feed: args.feedId ?? null, fileName: args.fileName ?? null, storedFilePath: null,
      status: "rejected", totalRows: args.totalRows, validRows: 0, rejectedRows: args.totalRows, rejections, startedAt: this.ctx.clock.iso(),
    };
    this.ctx.db.save("feedImports", importId, record);
    this.syncLogs.record({ pharmacy: args.pharmacyId, feedImport: importId, success: false, details: `Feed rejected: ${args.reason}` });
    return record;
  }

  private recordSyncTime(pharmacy: Pharmacy): void {
    this.ctx.db.save("pharmacies", pharmacy.pharmacyId, { ...pharmacy, lastSyncAt: this.ctx.clock.iso() });
  }

  recentImports(pharmacyId: string, limit = 5): FeedImport[] {
    return this.ctx.db
      .query<FeedImport>("feedImports", (f) => f.pharmacy === pharmacyId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.importId.localeCompare(a.importId, undefined, { numeric: true }))
      .slice(0, limit);
  }

  /** Scheduler -> FeedImport -> Pharmacy.isSyncStale (stale-sync check in the sequence diagram). */
  isSyncStale(pharmacyId: string): boolean {
    return this.pharmacies.isSyncStale(pharmacyId);
  }
}

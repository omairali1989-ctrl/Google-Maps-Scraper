/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "fs";
import path from "path";
import * as xlsx from "xlsx";
import { upsertRecord } from "./models/records";

export function extractQueryName(filename: string): string {
  const cleanName = filename.replace(/\s*-\s*GMS\s*output\s*(?:\(\d+\))?\.(?:xlsx|csv|json)$/i, "");
  return cleanName.trim();
}

 
export function importFile(filePath: string): any[] {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".json") {
    const rawData = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(rawData);
  }

  if (ext === ".xlsx" || ext === ".csv") {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    return xlsx.utils.sheet_to_json(worksheet);
  }

  return [];
}

export function importAllExistingFiles() {
  const OUTPUT_DIR = path.join(process.cwd(), "..", "output");
  if (!fs.existsSync(OUTPUT_DIR)) {
    return { success: false, parsed: 0, imported: 0, error: "Output directory does not exist" };
  }

  const files = fs.readdirSync(OUTPUT_DIR);
  let totalParsed = 0;
  let totalImported = 0;

  for (const file of files) {
    const filePath = path.join(OUTPUT_DIR, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) continue;
    if (![".xlsx", ".csv", ".json"].includes(path.extname(file).toLowerCase())) continue;

    const query = extractQueryName(file);

    try {
      const records = importFile(filePath);
      for (const item of records) {
        const mappedInput = {
          category: item.Category || item.category || null,
          name: item.Name || item.name,
          phone: item.Phone || item.phone || null,
          google_maps_url: item["Google Maps URL"] || item.google_maps_url || item.googleMapsUrl || null,
          website: item.Website || item.website || null,
          email: item.email || item.Email || null,
          business_status: item["Business Status"] || item.business_status || item.businessStatus || null,
          address: item.Address || item.address || null,
          total_reviews: item["Total Reviews"] || item.total_reviews || item.totalReviews || null,
          booking_links: item["Booking Links"] || item.booking_links || item.bookingLinks || null,
          rating: String(item.Rating || item.rating || ""),
          hours: item.Hours || item.hours || null,
          source_query: query,
        };

        if (mappedInput.name) {
          upsertRecord(mappedInput);
          totalImported++;
        }
      }
      totalParsed += records.length;
    } catch (e) {
      // ignore individual file errors
    }
  }

  return { success: true, parsed: totalParsed, imported: totalImported };
}

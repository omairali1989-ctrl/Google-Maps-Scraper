import { NextRequest, NextResponse } from "next/server";
import { importAllExistingFiles } from "@/lib/import-helper";
import { handleApiError } from "@/lib/api-helper";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function POST(req: NextRequest) {
  try {
    const result = importAllExistingFiles();
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 });
    }
    return NextResponse.json({
      success: true,
      message: `Successfully scanned and imported ${result.imported} records from output files.`,
      parsed: result.parsed,
      imported: result.imported,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

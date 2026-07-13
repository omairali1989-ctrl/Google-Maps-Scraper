import { NextRequest, NextResponse } from "next/server";
import { deleteExportFromHistory } from "@/lib/models/exports";
import { handleApiError } from "@/lib/api-helper";
import path from "path";
import fs from "fs";
import { db } from "@/lib/db";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const exportId = parseInt(id);

    // Optional: Delete physical file if saved in output folder
    try {
      const item = db.prepare("SELECT * FROM export_history WHERE id = ?").get(exportId) as any;
      if (item && item.filename) {
        const filePath = path.join(process.cwd(), "..", "output", item.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any // eslint-disable-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      // Ignore errors deleting physical file
    }

    const success = deleteExportFromHistory(exportId);
    if (!success) {
      return NextResponse.json({ success: false, error: "Export history log not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

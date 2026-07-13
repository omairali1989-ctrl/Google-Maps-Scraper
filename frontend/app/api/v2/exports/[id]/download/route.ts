import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api-helper";
import path from "path";
import fs from "fs";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const exportId = parseInt(id);

    const item = db.prepare("SELECT * FROM export_history WHERE id = ?").get(exportId) as any;
    if (!item) {
      return NextResponse.json({ success: false, error: "Export history record not found." }, { status: 404 });
    }

    const filePath = path.join(process.cwd(), "..", "output", item.filename);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { success: false, error: `The exported file "${item.filename}" is no longer available on the disk.` },
        { status: 404 }
      );
    }

    const fileBuffer = fs.readFileSync(filePath);
    const response = new NextResponse(fileBuffer);
    response.headers.set("Content-Type", "application/octet-stream");
    response.headers.set("Content-Disposition", `attachment; filename="${item.filename}"`);
    return response;
  } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    return handleApiError(error);
  }
}

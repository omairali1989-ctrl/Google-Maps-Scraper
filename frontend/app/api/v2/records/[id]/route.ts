import { NextRequest, NextResponse } from "next/server";
import { getRecordById, updateRecord, deleteRecord } from "@/lib/models/records";
import { handleApiError } from "@/lib/api-helper";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const recordId = parseInt(id);
    const record = getRecordById(recordId);
    if (!record) {
      return NextResponse.json({ success: false, error: "Record not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, record });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const recordId = parseInt(id);
    const body = await req.json();
    const updated = updateRecord(recordId, body);
    if (!updated) {
      return NextResponse.json({ success: false, error: "Record not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, record: updated });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const recordId = parseInt(id);
    const success = deleteRecord(recordId);
    if (!success) {
      return NextResponse.json({ success: false, error: "Record not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

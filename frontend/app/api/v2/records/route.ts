/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { listRecords } from "@/lib/models/records";
import { handleApiError } from "@/lib/api-helper";
import { requireUser, isResponse } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (isResponse(auth)) return auth;

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");
    const search = searchParams.get("search") || undefined;

    // Parse Sort e.g. sort=rating:desc
    const sort = searchParams.get("sort");
    let sortBy: string | undefined = undefined;
    let sortOrder: "asc" | "desc" | undefined = undefined;
    if (sort) {
      const parts = sort.split(":");
      sortBy = parts[0];
      sortOrder = parts[1] === "asc" ? "asc" : "desc";
    }

    // Parse Filters e.g. filter[country]=Pakistan
    const filters: any = {};
    searchParams.forEach((value, key) => {
      if (key.startsWith("filter[")) {
        const field = key.substring(7, key.length - 1);
        if (field === "is_favorite") {
          filters.is_favorite = value === "true" || value === "1" ? 1 : 0;
        } else if (field === "has_email") {
          filters.has_email = value === "true";
        } else if (field === "has_website") {
          filters.has_website = value === "true";
        } else if (field === "has_phone") {
          filters.has_phone = value === "true";
        } else if (field === "min_rating") {
          filters.min_rating = parseFloat(value);
        } else if (field === "min_reviews") {
          filters.min_reviews = parseInt(value);
        } else {
          filters[field] = value;
        }
      }
    });

    const result = listRecords({
      page,
      limit,
      search,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      sortBy,
      sortOrder,
      scope: { userId: auth.id, isAdmin: auth.role === "admin" },
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleApiError(error);
  }
}

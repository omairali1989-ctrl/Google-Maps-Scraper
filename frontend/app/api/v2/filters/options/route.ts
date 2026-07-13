import { NextRequest, NextResponse } from "next/server";
import { getAllUniqueValues } from "@/lib/models/records";
import { handleApiError } from "@/lib/api-helper";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(req: NextRequest) {
  try {
    const countries = getAllUniqueValues("country");
    const cities = getAllUniqueValues("city");
    const regions = getAllUniqueValues("region");
    const categories = getAllUniqueValues("category");
    const queries = getAllUniqueValues("source_query");

    return NextResponse.json({
      success: true,
      options: {
        countries,
        cities,
        regions,
        categories,
        queries,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

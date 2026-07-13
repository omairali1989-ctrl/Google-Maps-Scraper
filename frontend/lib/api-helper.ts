/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";

 
export function handleApiError(error: any) {
  console.error("API Error:", error);

  let status = 500;
  let message = "An unexpected error occurred. Please try again.";

  if (error instanceof Error) {
    message = error.message;
  }

  // Handle specific database errors
  if (error.code === "SQLITE_CONSTRAINT") {
    status = 409;
    message = "This record conflicts with an existing entry in the database (duplicate found).";
  } else if (error.code === "SQLITE_BUSY") {
    status = 503;
    message = "The database is currently busy. Please wait a moment and try again.";
  } else if (error.code === "SQLITE_CORRUPT") {
    status = 500;
    message = "The database file appears to be corrupted. Please contact support or run a database restore.";
  } else if (error.code?.startsWith("SQLITE_")) {
    status = 500;
    message = `A database error occurred while executing the operation: ${error.message}`;
  }

  return NextResponse.json({ success: false, error: message }, { status });
}

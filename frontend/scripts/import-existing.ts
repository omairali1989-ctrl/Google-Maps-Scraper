import { importAllExistingFiles } from "../lib/import-helper";

async function run() {
  console.log("🚀 Starting import of existing output files into SQLite...");
  const result = importAllExistingFiles();
  if (result.success) {
    console.log(`\n🎉 Import completed!`);
    console.log(`📊 Total records parsed: ${result.parsed}`);
    console.log(`📊 Total records successfully upserted: ${result.imported}`);
  } else {
    console.error(`❌ Failed: ${result.error}`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("❌ Fatal error during import:", err);
  process.exit(1);
});

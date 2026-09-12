'use strict';

const path = require('path');
const fs = require('fs');

const { FakeMap } = require('./fakeMap');
const { redactDocx } = require('./docxProcessor');

function main() {
  const args = process.argv.slice(2);

  const inputPath = args[0]
    ? path.resolve(args[0])
    : path.resolve(__dirname, '..', 'input', 'prospectus.docx');

  const outputPath = args[1]
    ? path.resolve(args[1])
    : path.resolve(__dirname, '..', 'output', 'redacted.docx');

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    console.error('Usage: node src/index.js <input.docx> [output.docx]');
    process.exit(1);
  }

  const outputDir = path.dirname(outputPath);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`Reading:  ${inputPath}`);
  console.log(`Writing:  ${outputPath}`);

  const fakeMap = new FakeMap();
  const startedAt = Date.now();

  const result = redactDocx(inputPath, outputPath, fakeMap);

  const elapsedMs = Date.now() - startedAt;

  
  const logPath = path.join(outputDir, 'redaction-log.json');
  fs.writeFileSync(logPath, JSON.stringify(result.log, null, 2), 'utf8');

 
  const countsByType = {};
  for (const entry of result.log) {
    countsByType[entry.type] = (countsByType[entry.type] || 0) + 1;
  }

  console.log('\n--- Redaction summary ---');
  console.log(`Document parts processed : ${result.partsProcessed}`);
  console.log(`Total redactions applied : ${result.matchCount}`);
  console.log(`Skipped (cross-run) hits : ${result.skippedCrossRunMatches}`);
  console.log(`Time elapsed             : ${elapsedMs}ms`);
  console.log('Redactions by type:');
  for (const [type, count] of Object.entries(countsByType)) {
    console.log(`  ${type.padEnd(15)} ${count}`);
  }
  console.log(`\nRedaction log written to: ${logPath}`);
  console.log(`Redacted docx written to: ${outputPath}`);
}

main();
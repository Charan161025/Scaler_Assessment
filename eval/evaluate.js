'use strict';


const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const { detectAll } = require('../src/detectors');
const { extractTextNodes } = require('../src/docxProcessor');

function loadGroundTruth() {
  const gtPath = path.resolve(__dirname, 'ground_truth.json');
  return JSON.parse(fs.readFileSync(gtPath, 'utf8'));
}

function getAllPlainText(docxPath) {
  const zip = new AdmZip(docxPath);
  const partNames = zip
    .getEntries()
    .map((e) => e.entryName)
    .filter(
      (name) =>
        name === 'word/document.xml' ||
        /^word\/(header|footer)\d*\.xml$/.test(name)
    );

  let combined = '';
  for (const partName of partNames) {
    const entry = zip.getEntry(partName);
    const xml = zip.readAsText(entry, 'utf8');
    const { plainText } = extractTextNodes(xml);
    combined += plainText + '\n';
  }
  return combined;
}

function normalize(str) {
  return str.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isMatch(gtItem, prediction) {
  if (gtItem.type !== prediction.type) return false;
  const a = normalize(gtItem.value);
  const b = normalize(prediction.value);
  if (a === b) return true;
  if (gtItem.type === 'ADDRESS') {
    return a.includes(b) || b.includes(a);
  }
  return false;
}

function evaluate(docxPath) {
  const groundTruth = loadGroundTruth();
  const text = getAllPlainText(docxPath);
  const predictions = detectAll(text);

  const matchedGT = new Set();
  const matchedPred = new Set();

  groundTruth.forEach((gtItem, gi) => {
    predictions.forEach((pred, pi) => {
      if (isMatch(gtItem, pred)) {
        matchedGT.add(gi);
        matchedPred.add(pi);
      }
    });
  });

  const falseNegatives = groundTruth.filter((_, gi) => !matchedGT.has(gi));
  const falsePositives = predictions.filter((_, pi) => !matchedPred.has(pi));
  const truePositiveCount = matchedGT.size;

  const types = [...new Set(groundTruth.map((g) => g.type))];
  const perType = {};
  for (const type of types) {
    const gtOfType = groundTruth.filter((g) => g.type === type).length;
    const tpOfType = groundTruth.filter(
      (g, gi) => g.type === type && matchedGT.has(gi)
    ).length;
    const predOfType = predictions.filter((p) => p.type === type).length;
    const fpOfType = predictions.filter(
      (p, pi) => p.type === type && !matchedPred.has(pi)
    ).length;

    const precision = predOfType === 0 ? null : tpOfType / predOfType;
    const recall = gtOfType === 0 ? null : tpOfType / gtOfType;

    perType[type] = {
      groundTruthCount: gtOfType,
      predictedCount: predOfType,
      truePositives: tpOfType,
      falsePositives: fpOfType,
      precision,
      recall,
    };
  }

  const totalPredicted = predictions.length;
  const totalGroundTruth = groundTruth.length;
  const overallPrecision = totalPredicted === 0 ? 0 : truePositiveCount / totalPredicted;
  const overallRecall = totalGroundTruth === 0 ? 0 : truePositiveCount / totalGroundTruth;
  const f1 =
    overallPrecision + overallRecall === 0
      ? 0
      : (2 * overallPrecision * overallRecall) / (overallPrecision + overallRecall);
  const accuracy =
    truePositiveCount + falsePositives.length + falseNegatives.length === 0
      ? 0
      : truePositiveCount / (truePositiveCount + falsePositives.length + falseNegatives.length);

  return {
    overall: {
      truePositives: truePositiveCount,
      falsePositives: falsePositives.length,
      falseNegatives: falseNegatives.length,
      precision: overallPrecision,
      recall: overallRecall,
      f1,
      accuracy,
    },
    perType,
    falseNegatives,
    falsePositives,
  };
}

function pct(n) {
  return n === null ? 'n/a' : `${(n * 100).toFixed(1)}%`;
}

function printReport(result) {
  console.log('=== PII Redaction Evaluation Report ===\n');

  console.log('-- Overall --');
  console.log(`True Positives : ${result.overall.truePositives}`);
  console.log(`False Positives: ${result.overall.falsePositives}`);
  console.log(`False Negatives: ${result.overall.falseNegatives}`);
  console.log(`Precision      : ${pct(result.overall.precision)}`);
  console.log(`Recall         : ${pct(result.overall.recall)}`);
  console.log(`F1             : ${pct(result.overall.f1)}`);
  console.log(`Accuracy*      : ${pct(result.overall.accuracy)}`);
  console.log('  * accuracy = TP / (TP + FP + FN); there is no fixed negative');
  console.log('    class in span-detection, so this is reported instead of a');
  console.log('    textbook (TP+TN)/(all) accuracy — see README.\n');

  console.log('-- By type --');
  for (const [type, m] of Object.entries(result.perType)) {
    console.log(
      `${type.padEnd(12)} GT=${m.groundTruthCount}  Pred=${m.predictedCount}  TP=${m.truePositives}  FP=${m.falsePositives}  P=${pct(
        m.precision
      )}  R=${pct(m.recall)}`
    );
  }

  console.log('\n-- False Negatives (missed real PII) --');
  if (result.falseNegatives.length === 0) {
    console.log('  none');
  } else {
    result.falseNegatives.forEach((f) => console.log(`  [${f.type}] ${f.value}`));
  }

  console.log('\n-- False Positives (flagged non-PII / noise), sample of up to 15 --');
  if (result.falsePositives.length === 0) {
    console.log('  none');
  } else {
    result.falsePositives.slice(0, 15).forEach((f) => console.log(`  [${f.type}] ${f.value}`));
    if (result.falsePositives.length > 15) {
      console.log(`  ... and ${result.falsePositives.length - 15} more`);
    }
  }
}

function main() {
  const docxPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, '..', 'input', 'prospectus.docx');

  if (!fs.existsSync(docxPath)) {
    console.error(`Input file not found: ${docxPath}`);
    process.exit(1);
  }

  const result = evaluate(docxPath);
  printReport(result);

  const outPath = path.resolve(__dirname, '..', 'output', 'evaluation-report.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\nFull JSON report written to: ${outPath}`);
}

main();